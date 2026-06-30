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
    let activity_queues = read_debug_activity_queues(pool).await?;
    let linkedin = read_debug_linkedin(pool).await?;
    let model_metrics = read_debug_model_metrics(pool).await?;
    let bundle = json!({
        "activityQueues": activity_queues,
        "ai": {
            "endpoints": endpoints,
            "modelMetrics": model_metrics,
            "settings": settings,
        },
        "counts": counts,
        "generatedAt": utc_timestamp(),
        "linkedin": linkedin,
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

async fn read_debug_activity_queues(pool: &PgPool) -> Result<Value> {
    let row = sqlx::query(
        r#"
        SELECT COALESCE(jsonb_object_agg(activity_type, status_counts), '{}'::jsonb) AS queues
        FROM (
          SELECT
            activity_type,
            jsonb_object_agg(status, count ORDER BY status) AS status_counts
          FROM (
            SELECT activity_type, status, COUNT(*) AS count
            FROM activities
            WHERE activity_type IN (
              'ai_review',
              'linkedin_availability',
              'linkedin_collect',
              'linkedin_describe'
            )
            GROUP BY activity_type, status
          ) counts
          GROUP BY activity_type
        ) grouped
        "#,
    )
    .fetch_one(pool)
    .await
    .context("read debug activity queues failed")?;

    row.try_get("queues")
        .context("read debug activity queues JSON failed")
}

async fn read_debug_linkedin(pool: &PgPool) -> Result<Value> {
    let recent_activities = read_debug_linkedin_activities(pool).await?;
    let raw_payloads = read_debug_linkedin_raw_payloads(pool).await?;

    Ok(json!({
        "activities": recent_activities,
        "rawPayloads": raw_payloads,
    }))
}

async fn read_debug_linkedin_activities(pool: &PgPool) -> Result<Value> {
    let row = sqlx::query(
        r#"
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'activityType', activity_type,
            'createdAt', created_at,
            'error', error,
            'id', id,
            'latestHttpStatus', latest_http_status,
            'message', message,
            'phase', phase,
            'rawFailed', raw_failed,
            'rawTotal', raw_total,
            'source', source,
            'status', status,
            'subjectId', subject_id,
            'subjectType', subject_type,
            'updatedAt', updated_at
          )
        ), '[]'::jsonb) AS items
        FROM (
          SELECT
            activities.*,
            (
              SELECT COUNT(*)
              FROM raw_payloads
              JOIN providers ON providers.id = raw_payloads.provider_id
              WHERE raw_payloads.activity_id = activities.id
                AND providers.provider_key = 'linkedin'
            ) AS raw_total,
            (
              SELECT COUNT(*)
              FROM raw_payloads
              JOIN providers ON providers.id = raw_payloads.provider_id
              WHERE raw_payloads.activity_id = activities.id
                AND providers.provider_key = 'linkedin'
                AND raw_payloads.response_status >= 400
            ) AS raw_failed,
            (
              SELECT raw_payloads.response_status
              FROM raw_payloads
              JOIN providers ON providers.id = raw_payloads.provider_id
              WHERE raw_payloads.activity_id = activities.id
                AND providers.provider_key = 'linkedin'
              ORDER BY raw_payloads.created_at DESC, raw_payloads.id DESC
              LIMIT 1
            ) AS latest_http_status
          FROM activities
          WHERE activity_type LIKE 'linkedin_%'
            OR payload->>'providerKey' = 'linkedin'
            OR EXISTS (
              SELECT 1
              FROM raw_payloads
              JOIN providers ON providers.id = raw_payloads.provider_id
              WHERE raw_payloads.activity_id = activities.id
                AND providers.provider_key = 'linkedin'
            )
          ORDER BY activities.updated_at DESC, activities.id DESC
          LIMIT 25
        ) recent
        "#,
    )
    .fetch_one(pool)
    .await
    .context("read debug LinkedIn activities failed")?;

    row.try_get("items")
        .context("read debug LinkedIn activities JSON failed")
}

async fn read_debug_linkedin_raw_payloads(pool: &PgPool) -> Result<Value> {
    let (summary_result, status_result, recent_result) = tokio::try_join!(
        sqlx::query(
            r#"
            SELECT
              COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE response_status >= 400)::bigint AS failed
            FROM raw_payloads
            JOIN providers ON providers.id = raw_payloads.provider_id
            WHERE providers.provider_key = 'linkedin'
            "#
        )
        .fetch_one(pool),
        sqlx::query(
            r#"
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object('count', count, 'status', status)
              ORDER BY status
            ), '[]'::jsonb) AS items
            FROM (
              SELECT COALESCE(response_status::text, 'unknown') AS status, COUNT(*) AS count
              FROM raw_payloads
              JOIN providers ON providers.id = raw_payloads.provider_id
              WHERE providers.provider_key = 'linkedin'
              GROUP BY COALESCE(response_status::text, 'unknown')
            ) status_counts
            "#
        )
        .fetch_one(pool),
        sqlx::query(
            r#"
            SELECT
              raw_payloads.id::text AS id,
              raw_payloads.activity_id::text AS activity_id,
              raw_payloads.request_url,
              raw_payloads.request_params,
              raw_payloads.response_status,
              raw_payloads.content_type,
              raw_payloads.elapsed_ms,
              raw_payloads.payload,
              raw_payloads.payload_text,
              raw_payloads.created_at::text AS created_at
            FROM raw_payloads
            JOIN providers ON providers.id = raw_payloads.provider_id
            WHERE providers.provider_key = 'linkedin'
            ORDER BY raw_payloads.created_at DESC, raw_payloads.id DESC
            LIMIT 20
            "#
        )
        .fetch_all(pool)
    )
    .context("read debug LinkedIn raw payloads failed")?;

    let total: i64 = summary_result.try_get("total")?;
    let failed: i64 = summary_result.try_get("failed")?;
    let status_counts: Value = status_result.try_get("items")?;
    let mut recent = Vec::with_capacity(recent_result.len());

    for row in recent_result {
        let payload: Option<Value> = row.try_get("payload")?;
        let payload_text: Option<String> = row.try_get("payload_text")?;
        recent.push(json!({
            "activityId": row.try_get::<Option<String>, _>("activity_id")?,
            "contentType": row.try_get::<Option<String>, _>("content_type")?,
            "createdAt": row.try_get::<String, _>("created_at")?,
            "elapsedMs": row.try_get::<Option<i32>, _>("elapsed_ms")?,
            "id": row.try_get::<String, _>("id")?,
            "payloadKind": if payload.is_some() { "json" } else if payload_text.is_some() { "text" } else { "empty" },
            "requestParams": sanitize_debug_value(row.try_get::<Value, _>("request_params")?, 0),
            "requestUrl": row
                .try_get::<Option<String>, _>("request_url")?
                .map(|value| redact_debug_text(&value)),
            "responseStatus": row.try_get::<Option<i32>, _>("response_status")?,
            "snippet": debug_payload_snippet(payload.as_ref(), payload_text.as_deref()),
        }));
    }

    Ok(json!({
        "failed": failed,
        "recent": recent,
        "statusCounts": status_counts,
        "total": total,
    }))
}

fn sanitize_debug_value(value: Value, depth: usize) -> Value {
    if depth > 6 {
        return Value::String("[truncated]".to_string());
    }

    match value {
        Value::String(text) => Value::String(truncate_debug_text(&redact_debug_text(&text), 1000)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .take(50)
                .map(|item| sanitize_debug_value(item, depth + 1))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| {
                    let sanitized = if is_secret_debug_key(&key) {
                        Value::String("[redacted]".to_string())
                    } else {
                        sanitize_debug_value(item, depth + 1)
                    };
                    (key, sanitized)
                })
                .collect(),
        ),
        other => other,
    }
}

fn debug_payload_snippet(payload: Option<&Value>, payload_text: Option<&str>) -> Option<String> {
    let snippet = match (payload, payload_text) {
        (Some(payload), _) => serde_json::to_string(payload).ok()?,
        (None, Some(text)) => text.to_string(),
        (None, None) => return None,
    };

    Some(truncate_debug_text(&redact_debug_text(&snippet), 4000))
}

fn is_secret_debug_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    [
        "authorization",
        "cookie",
        "csrf",
        "jsessionid",
        "li_at",
        "password",
        "secret",
        "token",
        "x-li-track",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn redact_debug_text(value: &str) -> String {
    let mut output = value.to_string();
    for prefix in ["li_at=", "JSESSIONID=", "csrf-token=", "authorization="] {
        output = redact_after_prefix(&output, prefix);
    }
    output
}

fn redact_after_prefix(value: &str, prefix: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let prefix_lower = prefix.to_ascii_lowercase();
    let mut output = String::with_capacity(value.len());
    let mut index = 0;

    while let Some(relative) = lower[index..].find(&prefix_lower) {
        let start = index + relative;
        let value_start = start + prefix.len();
        output.push_str(&value[index..value_start]);
        output.push_str("[redacted]");
        let end = value[value_start..]
            .char_indices()
            .find_map(|(offset, character)| {
                matches!(character, ';' | '&' | '"' | '\'' | ' ' | '\n' | '\r' | '\t')
                    .then_some(value_start + offset)
            })
            .unwrap_or(value.len());
        index = end;
    }

    output.push_str(&value[index..]);
    output
}

fn truncate_debug_text(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }

    let truncated: String = value.chars().take(limit).collect();
    format!("{truncated}... [truncated]")
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
