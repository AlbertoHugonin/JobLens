use std::sync::atomic::Ordering;

use anyhow::{Context, Result, anyhow};
use serde_json::{Map, Value, json};
use sqlx::{PgPool, Row};
use tokio::sync::watch;
use url::Url;

use crate::{
    activities::{
        ClaimedActivity, HeartbeatOutcome, heartbeat_activity, insert_activity_log,
        mark_activity_cancelled, mark_activity_interrupted, mark_activity_succeeded,
    },
    ai::review::hash_text,
    config::WorkerConfig,
    db::read_queue_snapshot,
    telemetry::{WorkerMetrics, utc_timestamp},
    util::read_json_string,
};

pub(crate) async fn run_export_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    let kind = read_json_string(&activity.payload, "kind")
        .unwrap_or_else(|| "jobs_reviews_jsonl".to_string());

    if !advance_export_activity(
        pool,
        config,
        metrics,
        activity,
        shutdown_rx,
        ExportProgress {
            message: "Preparing export",
            phase: "preparing",
            progress_current: 1,
        },
    )
    .await?
    {
        return Ok(());
    }

    let artifact = match kind.as_str() {
        "debug_bundle" => build_debug_bundle(pool).await?,
        "jobs_reviews_jsonl" => build_jobs_reviews_jsonl(pool).await?,
        unsupported => return Err(anyhow!("unsupported export kind: {unsupported}")),
    };

    if !advance_export_activity(
        pool,
        config,
        metrics,
        activity,
        shutdown_rx,
        ExportProgress {
            message: "Storing export artifact",
            phase: "storing",
            progress_current: 3,
        },
    )
    .await?
    {
        return Ok(());
    }

    store_export_artifact(pool, activity, &artifact).await?;
    advance_export_activity(
        pool,
        config,
        metrics,
        activity,
        shutdown_rx,
        ExportProgress {
            message: "Export artifact stored",
            phase: "stored",
            progress_current: 4,
        },
    )
    .await?;
    insert_activity_log(
        pool,
        &activity.id,
        "info",
        "Export completed",
        json!({
            "byteLength": artifact.byte_length,
            "fileName": artifact.file_name,
            "kind": artifact.kind,
            "lineCount": artifact.line_count,
        }),
    )
    .await?;
    mark_activity_succeeded(pool, config, &activity.id).await?;
    metrics.activities_succeeded.fetch_add(1, Ordering::Relaxed);

    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct ExportProgress {
    message: &'static str,
    phase: &'static str,
    progress_current: i32,
}

#[derive(Debug)]
struct ExportArtifact {
    byte_length: usize,
    content: String,
    content_type: &'static str,
    file_name: String,
    kind: &'static str,
    line_count: usize,
}

async fn advance_export_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
    progress: ExportProgress,
) -> Result<bool> {
    if *shutdown_rx.borrow() {
        mark_activity_interrupted(pool, config, &activity.id, "Worker shutdown requested").await?;
        metrics
            .activities_interrupted
            .fetch_add(1, Ordering::Relaxed);
        return Ok(false);
    }

    match heartbeat_activity(
        pool,
        config,
        &activity.id,
        progress.phase,
        progress.message,
        progress.progress_current,
        4,
    )
    .await?
    {
        HeartbeatOutcome::Running => {
            metrics.heartbeats.fetch_add(1, Ordering::Relaxed);
            Ok(true)
        }
        HeartbeatOutcome::CancelRequested => {
            mark_activity_cancelled(pool, config, &activity.id).await?;
            metrics.activities_cancelled.fetch_add(1, Ordering::Relaxed);
            Ok(false)
        }
        HeartbeatOutcome::LeaseLost => Err(anyhow!("activity lease was lost")),
    }
}

async fn build_jobs_reviews_jsonl(pool: &PgPool) -> Result<ExportArtifact> {
    let rows = sqlx::query(
        r#"
        SELECT jsonb_build_object(
          'job', jsonb_build_object(
            'availabilityStatus', jobs.availability_status,
            'companyName', jobs.company_name,
            'createdAt', jobs.created_at,
            'employmentType', jobs.employment_type,
            'id', jobs.id,
            'localStatus', jobs.local_status,
            'locationText', jobs.location_text,
            'providerUrl', jobs.provider_url,
            'publishedAt', jobs.published_at,
            'repostedAt', jobs.reposted_at,
            'seniority', jobs.seniority,
            'sourceUrl', jobs.source_url,
            'title', jobs.title,
            'updatedAt', jobs.updated_at,
            'workplaceType', jobs.workplace_type
          ),
          'externalJobs', COALESCE(external_agg.items, '[]'::jsonb),
          'latestDescription', latest_description.item,
          'reviews', COALESCE(review_agg.items, '[]'::jsonb)
        ) AS item
        FROM jobs
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'externalId', external_jobs.external_id,
              'externalUrl', external_jobs.external_url,
              'firstSeenAt', external_jobs.first_seen_at,
              'id', external_jobs.id,
              'lastSeenAt', external_jobs.last_seen_at,
              'providerKey', providers.provider_key,
              'providerName', providers.name
            )
            ORDER BY providers.provider_key ASC, external_jobs.external_id ASC
          ) AS items
          FROM external_jobs
          JOIN providers ON providers.id = external_jobs.provider_id
          WHERE external_jobs.job_id = jobs.id
        ) external_agg ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_build_object(
            'fetchedAt', job_descriptions.fetched_at,
            'htmlAvailable', job_descriptions.html IS NOT NULL,
            'id', job_descriptions.id,
            'source', job_descriptions.source,
            'text', job_descriptions.text
          ) AS item
          FROM job_descriptions
          WHERE job_descriptions.job_id = jobs.id
          ORDER BY job_descriptions.fetched_at DESC, job_descriptions.created_at DESC
          LIMIT 1
        ) latest_description ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'createdAt', job_reviews.created_at,
              'decision', job_reviews.decision,
              'error', job_reviews.error,
              'id', job_reviews.id,
              'metrics', job_reviews.metrics,
              'modelName', job_reviews.model_name,
              'profileHash', job_reviews.profile_hash,
              'result', job_reviews.result,
              'rulesHash', job_reviews.rules_hash,
              'score', job_reviews.score,
              'status', job_reviews.status
            )
            ORDER BY job_reviews.created_at DESC, job_reviews.id DESC
          ) AS items
          FROM job_reviews
          WHERE job_reviews.job_id = jobs.id
        ) review_agg ON true
        ORDER BY jobs.created_at ASC, jobs.id ASC
        "#,
    )
    .fetch_all(pool)
    .await
    .context("read jobs/reviews export rows failed")?;

    let mut lines = Vec::with_capacity(rows.len());
    for row in rows {
        let item: Value = row.try_get("item")?;
        lines.push(serde_json::to_string(&item).context("serialize JSONL row failed")?);
    }
    let content = if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    };

    Ok(ExportArtifact {
        byte_length: content.len(),
        content,
        content_type: "application/x-ndjson",
        file_name: format!("joblens-jobs-reviews-{}.jsonl", compact_timestamp()),
        kind: "jobs_reviews_jsonl",
        line_count: lines.len(),
    })
}

async fn build_debug_bundle(pool: &PgPool) -> Result<ExportArtifact> {
    let queue = read_queue_snapshot(pool)
        .await
        .ok()
        .and_then(|snapshot| serde_json::to_value(snapshot).ok());
    let settings = read_sanitized_settings(pool).await?;
    let endpoints = read_sanitized_ai_endpoints(pool).await?;
    let counts = read_debug_counts(pool).await?;
    let recent_activities = read_recent_activities(pool).await?;
    let recent_errors = read_recent_errors(pool).await?;
    let model_metrics = read_debug_model_metrics(pool).await?;
    let bundle = json!({
        "ai": {
            "endpoints": endpoints,
            "modelMetrics": model_metrics,
            "settings": settings,
        },
        "counts": counts,
        "generatedAt": utc_timestamp(),
        "queue": queue,
        "recentActivities": recent_activities,
        "recentErrors": recent_errors,
        "service": {
            "name": "joblens-worker",
            "version": env!("CARGO_PKG_VERSION"),
        },
    });
    let content = serde_json::to_string_pretty(&bundle).context("serialize debug bundle failed")?;

    Ok(ExportArtifact {
        byte_length: content.len(),
        content,
        content_type: "application/json",
        file_name: format!("joblens-debug-{}.json", compact_timestamp()),
        kind: "debug_bundle",
        line_count: 1,
    })
}

async fn store_export_artifact(
    pool: &PgPool,
    activity: &ClaimedActivity,
    artifact: &ExportArtifact,
) -> Result<()> {
    let payload = json!({
        "artifact": {
            "byteLength": artifact.byte_length,
            "content": artifact.content,
            "contentType": artifact.content_type,
            "createdAt": utc_timestamp(),
            "fileName": artifact.file_name,
            "kind": artifact.kind,
            "lineCount": artifact.line_count,
        }
    });

    sqlx::query(
        r#"
        UPDATE activities
        SET payload = payload || $2::jsonb
        WHERE id = $1::uuid
        "#,
    )
    .bind(&activity.id)
    .bind(payload)
    .execute(pool)
    .await
    .context("store export artifact failed")?;

    Ok(())
}

async fn read_sanitized_settings(pool: &PgPool) -> Result<Value> {
    let rows = sqlx::query(
        r#"
        SELECT key, value
        FROM settings
        WHERE key IN (
          'ai.active_endpoint_id',
          'ai.candidate_profile',
          'ai.enabled',
          'ai.pauses',
          'ai.runtime',
          'evaluation.rules',
          'evaluation.rules.template_version'
        )
        ORDER BY key ASC
        "#,
    )
    .fetch_all(pool)
    .await
    .context("read debug settings failed")?;
    let mut output = Map::new();

    for row in rows {
        let key: String = row.try_get("key")?;
        let value: Value = row.try_get("value")?;
        let sanitized = match key.as_str() {
            "ai.candidate_profile" | "evaluation.rules" => {
                let text = value.as_str().unwrap_or_default();
                json!({
                    "hash": hash_text(text),
                    "length": text.chars().count(),
                })
            }
            _ => value,
        };
        output.insert(key, sanitized);
    }

    Ok(Value::Object(output))
}

async fn read_sanitized_ai_endpoints(pool: &PgPool) -> Result<Value> {
    let rows = sqlx::query(
        r#"
        SELECT
          id::text AS id,
          name,
          base_url,
          enabled,
          is_active,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM ai_endpoints
        ORDER BY is_active DESC, name ASC
        "#,
    )
    .fetch_all(pool)
    .await
    .context("read debug AI endpoints failed")?;
    let mut items = Vec::with_capacity(rows.len());

    for row in rows {
        let base_url: String = row.try_get("base_url")?;
        items.push(json!({
            "baseOrigin": sanitize_url_origin(&base_url),
            "createdAt": row.try_get::<String, _>("created_at")?,
            "enabled": row.try_get::<bool, _>("enabled")?,
            "id": row.try_get::<String, _>("id")?,
            "isActive": row.try_get::<bool, _>("is_active")?,
            "name": row.try_get::<String, _>("name")?,
            "updatedAt": row.try_get::<String, _>("updated_at")?,
        }));
    }

    Ok(Value::Array(items))
}

async fn read_debug_counts(pool: &PgPool) -> Result<Value> {
    let row = sqlx::query(
        r#"
        SELECT jsonb_build_object(
          'activities', (SELECT COUNT(*) FROM activities),
          'aiEndpoints', (SELECT COUNT(*) FROM ai_endpoints),
          'aiModels', (SELECT COUNT(*) FROM ai_models),
          'externalJobs', (SELECT COUNT(*) FROM external_jobs),
          'jobDescriptions', (SELECT COUNT(*) FROM job_descriptions),
          'jobReviews', (SELECT COUNT(*) FROM job_reviews),
          'jobs', (SELECT COUNT(*) FROM jobs),
          'providers', (SELECT COUNT(*) FROM providers),
          'rawPayloads', (SELECT COUNT(*) FROM raw_payloads),
          'searches', (SELECT COUNT(*) FROM searches)
        ) AS counts
        "#,
    )
    .fetch_one(pool)
    .await
    .context("read debug counts failed")?;

    row.try_get("counts")
        .context("read debug counts JSON failed")
}

async fn read_recent_activities(pool: &PgPool) -> Result<Value> {
    let row = sqlx::query(
        r#"
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'activityType', activity_type,
            'createdAt', created_at,
            'error', error,
            'id', id,
            'message', message,
            'phase', phase,
            'progressCurrent', progress_current,
            'progressTotal', progress_total,
            'source', source,
            'status', status,
            'subjectId', subject_id,
            'subjectType', subject_type,
            'updatedAt', updated_at
          )
        ), '[]'::jsonb) AS items
        FROM (
          SELECT *
          FROM activities
          ORDER BY created_at DESC, id DESC
          LIMIT 25
        ) recent
        "#,
    )
    .fetch_one(pool)
    .await
    .context("read recent activities failed")?;

    row.try_get("items")
        .context("read recent activities JSON failed")
}

async fn read_recent_errors(pool: &PgPool) -> Result<Value> {
    let row = sqlx::query(
        r#"
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'activityId', activity_id,
            'createdAt', created_at,
            'level', level,
            'message', message
          )
        ), '[]'::jsonb) AS items
        FROM (
          SELECT activity_id, created_at, level, message
          FROM activity_logs
          WHERE level IN ('error', 'warn')
          ORDER BY created_at DESC, id DESC
          LIMIT 25
        ) recent
        "#,
    )
    .fetch_one(pool)
    .await
    .context("read recent errors failed")?;

    row.try_get("items")
        .context("read recent errors JSON failed")
}

async fn read_debug_model_metrics(pool: &PgPool) -> Result<Value> {
    let row = sqlx::query(
        r#"
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'avgDurationMs', avg_duration_ms,
            'avgOutputTokens', avg_output_tokens,
            'avgPromptTokens', avg_prompt_tokens,
            'avgScore', avg_score,
            'avgTokensPerSecond', avg_tokens_per_second,
            'failedCount', failed_count,
            'lastReviewedAt', last_reviewed_at,
            'modelName', model_name,
            'reviewCount', review_count,
            'successCount', success_count
          )
          ORDER BY last_reviewed_at DESC, model_name ASC
        ), '[]'::jsonb) AS items
        FROM (
          SELECT
            model_name,
            COUNT(*) AS review_count,
            COUNT(*) FILTER (WHERE status = 'success') AS success_count,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
            AVG(score) AS avg_score,
            AVG(NULLIF(metrics #>> '{ai,durationMs}', '')::numeric) AS avg_duration_ms,
            AVG(NULLIF(metrics #>> '{ai,promptTokens}', '')::numeric) AS avg_prompt_tokens,
            AVG(NULLIF(metrics #>> '{ai,outputTokens}', '')::numeric) AS avg_output_tokens,
            AVG(NULLIF(metrics #>> '{ai,tokensPerSecond}', '')::numeric)
              AS avg_tokens_per_second,
            MAX(created_at) AS last_reviewed_at
          FROM job_reviews
          GROUP BY model_name
        ) metrics
        "#,
    )
    .fetch_one(pool)
    .await
    .context("read debug model metrics failed")?;

    row.try_get("items")
        .context("read debug model metrics JSON failed")
}

fn sanitize_url_origin(value: &str) -> Option<String> {
    let mut url = Url::parse(value).ok()?;
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    Some(format!(
        "{}://{}{}",
        url.scheme(),
        url.host_str()?,
        url.port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default()
    ))
}

fn compact_timestamp() -> String {
    utc_timestamp()
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .collect()
}
