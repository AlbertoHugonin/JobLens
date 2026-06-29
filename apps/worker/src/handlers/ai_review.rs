use std::{sync::atomic::Ordering, time::Duration};

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tokio::{sync::watch, time::sleep};

use crate::{
    activities::{
        ClaimedActivity, HeartbeatOutcome, heartbeat_activity, insert_activity_log,
        mark_activity_cancelled, mark_activity_interrupted, mark_activity_succeeded,
    },
    ai::{
        client::{AiCompletion, AiRuntime, request_ai_review},
        review::{
            NormalizedReview, ReviewExternalJob, ReviewJobContext, build_review_prompt,
            diagnostic_review, hash_text, normalize_review_output,
        },
    },
    config::WorkerConfig,
    telemetry::WorkerMetrics,
    util::read_json_string,
};

#[derive(Debug, Clone)]
struct AiReviewSettings {
    active_endpoint_id: Option<String>,
    candidate_profile: String,
    evaluation_rules: String,
    runtime: Value,
}

#[derive(Debug, Clone)]
struct AiReviewTarget {
    endpoint_base_url: String,
    endpoint_id: String,
    endpoint_name: String,
    job: ReviewJobContext,
    mode: String,
    model_id: String,
    model_name: String,
    settings: AiReviewSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DescriptionRecoveryOutcome {
    Deferred,
    Ready,
}

const DEFAULT_CANDIDATE_PROFILE: &str = "\
Role target: software engineer.
Priority: concrete impact, technical quality, autonomy and collaborative context.
Constraints: evaluate location, seniority, stack and role clarity before applying.";

const DEFAULT_EVALUATION_RULES: &str = "\
Decision:
- apply: strong match with role, skills and constraints.
- maybe: interesting potential with gaps or missing information.
- reject: clear incompatibility or substantial blockers.

Score:
- 80-100 for a strong match and few risks.
- 50-79 for partial match or manageable uncertainty.
- 0-49 for weak fit or blockers.";

pub(crate) async fn run_ai_review_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    if !advance_review_activity(
        pool,
        config,
        metrics,
        activity,
        shutdown_rx,
        ReviewProgress {
            message: "Preparing AI review",
            phase: "composing",
            progress_current: 1,
        },
    )
    .await?
    {
        return Ok(());
    }

    let target = read_ai_review_target(pool, activity).await?;
    if queue_missing_description_recovery(pool, config, activity, &target.job).await?
        == DescriptionRecoveryOutcome::Deferred
    {
        return Ok(());
    }
    let prompt = build_review_prompt(
        &target.settings.candidate_profile,
        &target.settings.evaluation_rules,
        &target.job,
    );
    let profile_hash = hash_text(&target.settings.candidate_profile);
    let rules_hash = hash_text(&target.settings.evaluation_rules);
    let runtime = AiRuntime::from_value(&target.settings.runtime);

    if !advance_review_activity(
        pool,
        config,
        metrics,
        activity,
        shutdown_rx,
        ReviewProgress {
            message: "Calling AI endpoint",
            phase: "calling_ai",
            progress_current: 2,
        },
    )
    .await?
    {
        return Ok(());
    }

    let completion = request_ai_review_with_retry(
        pool,
        &activity.id,
        &target,
        &prompt,
        &runtime,
        &activity.payload,
    )
    .await;

    if !advance_review_activity(
        pool,
        config,
        metrics,
        activity,
        shutdown_rx,
        ReviewProgress {
            message: "Normalizing AI review",
            phase: "normalizing",
            progress_current: 3,
        },
    )
    .await?
    {
        return Ok(());
    }

    let (review, raw_output, ai_metrics) = match completion {
        Ok(completion) => {
            let review = normalize_review_output(&completion.raw_output);
            (review, Some(completion.raw_output), completion.metrics)
        }
        Err(error) => (
            diagnostic_review(&format!("{error:#}")),
            None,
            json!({
                "requestFailed": true,
            }),
        ),
    };
    let review_id = insert_job_review(
        pool,
        &target,
        JobReviewInsert {
            ai_metrics,
            profile_hash: &profile_hash,
            raw_output: raw_output.as_deref(),
            review: &review,
            rules_hash: &rules_hash,
            source_activity_id: &activity.id,
        },
    )
    .await?;

    advance_review_activity(
        pool,
        config,
        metrics,
        activity,
        shutdown_rx,
        ReviewProgress {
            message: "Stored AI review",
            phase: "stored",
            progress_current: 4,
        },
    )
    .await?;
    insert_activity_log(
        pool,
        &activity.id,
        "info",
        "Stored AI review",
        json!({
            "decision": review.decision,
            "jobId": target.job.id,
            "modelName": target.model_name,
            "reviewId": review_id,
            "score": review.score,
            "status": review.status,
        }),
    )
    .await?;
    mark_activity_succeeded(pool, config, &activity.id).await?;
    metrics.activities_succeeded.fetch_add(1, Ordering::Relaxed);

    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct ReviewProgress {
    message: &'static str,
    phase: &'static str,
    progress_current: i32,
}

async fn advance_review_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
    progress: ReviewProgress,
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

async fn read_ai_review_target(
    pool: &PgPool,
    activity: &ClaimedActivity,
) -> Result<AiReviewTarget> {
    let job_id = activity
        .subject_id
        .clone()
        .or_else(|| read_json_string(&activity.payload, "jobId"))
        .context("ai_review activity is missing job id")?;
    let settings = read_ai_review_settings(pool).await?;
    let endpoint_id = read_json_string(&activity.payload, "endpointId")
        .or_else(|| settings.active_endpoint_id.clone())
        .context("ai_review activity is missing endpoint id")?;
    let mode = read_json_string(&activity.payload, "mode").unwrap_or_else(|| "manual".to_string());
    let endpoint = read_ai_endpoint(pool, &endpoint_id).await?;
    let model_name = read_json_string(&activity.payload, "modelName")
        .or_else(|| runtime_string(&settings.runtime, "modelName"))
        .or_else(|| runtime_string(&settings.runtime, "priorityModelName"))
        .context("ai_review activity is missing model name")?;
    let model_id = if let Some(model_id) = read_json_string(&activity.payload, "modelId") {
        model_id
    } else {
        upsert_ai_model(pool, &endpoint_id, &model_name).await?
    };
    let job = read_review_job_context(pool, &job_id).await?;

    Ok(AiReviewTarget {
        endpoint_base_url: endpoint.base_url,
        endpoint_id,
        endpoint_name: endpoint.name,
        job,
        mode,
        model_id,
        model_name,
        settings,
    })
}

#[derive(Debug, Clone)]
struct AiEndpoint {
    base_url: String,
    name: String,
}

async fn read_ai_endpoint(pool: &PgPool, endpoint_id: &str) -> Result<AiEndpoint> {
    let row = sqlx::query(
        r#"
        SELECT name, base_url
        FROM ai_endpoints
        WHERE id = $1::uuid
          AND enabled = true
        "#,
    )
    .bind(endpoint_id)
    .fetch_optional(pool)
    .await
    .context("read AI endpoint failed")?
    .context("enabled AI endpoint was not found")?;

    Ok(AiEndpoint {
        base_url: row.try_get("base_url")?,
        name: row.try_get("name")?,
    })
}

async fn read_ai_review_settings(pool: &PgPool) -> Result<AiReviewSettings> {
    let active_endpoint_id = read_setting_value(pool, "ai.active_endpoint_id")
        .await?
        .and_then(|value| value.as_str().map(str::trim).map(ToString::to_string))
        .filter(|value| !value.is_empty());
    let candidate_profile = read_setting_value(pool, "ai.candidate_profile")
        .await?
        .and_then(|value| value.as_str().map(ToString::to_string))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CANDIDATE_PROFILE.to_string());
    let evaluation_rules = read_setting_value(pool, "evaluation.rules")
        .await?
        .and_then(|value| value.as_str().map(ToString::to_string))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_EVALUATION_RULES.to_string());
    let runtime = read_setting_value(pool, "ai.runtime")
        .await?
        .unwrap_or_else(|| json!({}));

    Ok(AiReviewSettings {
        active_endpoint_id,
        candidate_profile,
        evaluation_rules,
        runtime,
    })
}

async fn read_setting_value(pool: &PgPool, key: &str) -> Result<Option<Value>> {
    let row = sqlx::query(
        r#"
        SELECT value
        FROM settings
        WHERE key = $1
        "#,
    )
    .bind(key)
    .fetch_optional(pool)
    .await
    .with_context(|| format!("read setting {key} failed"))?;

    Ok(row.map(|row| row.try_get("value")).transpose()?)
}

async fn upsert_ai_model(pool: &PgPool, endpoint_id: &str, model_name: &str) -> Result<String> {
    let row = sqlx::query(
        r#"
        INSERT INTO ai_models(endpoint_id, name, installed, metadata)
        VALUES ($1::uuid, $2, false, '{}'::jsonb)
        ON CONFLICT (endpoint_id, name) DO UPDATE
        SET updated_at = now()
        RETURNING id::text AS id
        "#,
    )
    .bind(endpoint_id)
    .bind(model_name)
    .fetch_one(pool)
    .await
    .context("upsert AI model for review failed")?;

    row.try_get("id").context("read AI model id failed")
}

async fn read_review_job_context(pool: &PgPool, job_id: &str) -> Result<ReviewJobContext> {
    let row = sqlx::query(
        r#"
        SELECT
          jobs.id::text AS id,
          jobs.title,
          jobs.company_name,
          jobs.location_text,
          jobs.workplace_type,
          jobs.employment_type,
          jobs.seniority,
          jobs.source_url,
          jobs.provider_url,
          latest_description.text AS description
        FROM jobs
        LEFT JOIN LATERAL (
          SELECT text
          FROM job_descriptions
          WHERE job_descriptions.job_id = jobs.id
          ORDER BY fetched_at DESC, created_at DESC
          LIMIT 1
        ) latest_description ON true
        WHERE jobs.id = $1::uuid
        "#,
    )
    .bind(job_id)
    .fetch_optional(pool)
    .await
    .context("read review job failed")?
    .context("review job was not found")?;

    let external_jobs = read_review_external_jobs(pool, job_id).await?;

    Ok(ReviewJobContext {
        company_name: row.try_get("company_name")?,
        description: row.try_get("description")?,
        employment_type: row.try_get("employment_type")?,
        external_jobs,
        id: row.try_get("id")?,
        location_text: row.try_get("location_text")?,
        provider_url: row.try_get("provider_url")?,
        seniority: row.try_get("seniority")?,
        source_url: row.try_get("source_url")?,
        title: row.try_get("title")?,
        workplace_type: row.try_get("workplace_type")?,
    })
}

async fn read_review_external_jobs(pool: &PgPool, job_id: &str) -> Result<Vec<ReviewExternalJob>> {
    let rows = sqlx::query(
        r#"
        SELECT
          providers.provider_key,
          providers.name AS provider_name,
          external_jobs.external_id,
          external_jobs.external_url
        FROM external_jobs
        JOIN providers ON providers.id = external_jobs.provider_id
        WHERE external_jobs.job_id = $1::uuid
        ORDER BY providers.provider_key ASC, external_jobs.external_id ASC
        "#,
    )
    .bind(job_id)
    .fetch_all(pool)
    .await
    .context("read review external jobs failed")?;

    rows.into_iter()
        .map(|row| {
            Ok(ReviewExternalJob {
                external_id: row.try_get("external_id")?,
                external_url: row.try_get("external_url")?,
                provider_key: row.try_get("provider_key")?,
                provider_name: row.try_get("provider_name")?,
            })
        })
        .collect()
}

async fn queue_missing_description_recovery(
    pool: &PgPool,
    config: &WorkerConfig,
    activity: &ClaimedActivity,
    job: &ReviewJobContext,
) -> Result<DescriptionRecoveryOutcome> {
    if job
        .description
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Ok(DescriptionRecoveryOutcome::Ready);
    }

    if !job_has_linkedin_external_job(pool, &job.id).await? {
        return Ok(DescriptionRecoveryOutcome::Ready);
    }

    let row = sqlx::query(
        r#"
        INSERT INTO activities(
          activity_type,
          status,
          subject_type,
          subject_id,
          phase,
          message,
          payload,
          progress_current,
          progress_total,
          source
        )
        SELECT
          'linkedin_describe',
          'queued',
          'job',
          $1::uuid,
          'queued',
          'LinkedIn description queued before AI review',
          jsonb_build_object(
            'jobId', $1::text,
            'providerKey', 'linkedin',
            'requestedByActivityId', $2::text,
            'reason', 'ai_review_missing_description'
          ),
          0,
          1,
          'worker'
        WHERE EXISTS (
          SELECT 1
          FROM external_jobs
          JOIN providers ON providers.id = external_jobs.provider_id
          WHERE external_jobs.job_id = $1::uuid
            AND providers.provider_key = 'linkedin'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM activities
          WHERE activity_type = 'linkedin_describe'
            AND subject_id = $1::uuid
            AND status IN ('queued', 'running')
        )
        RETURNING id::text AS id
        "#,
    )
    .bind(&job.id)
    .bind(&activity.id)
    .fetch_optional(pool)
    .await
    .context("queue missing description recovery failed")?;

    if let Some(row) = row {
        let recovery_id: String = row.try_get("id")?;
        insert_activity_log(
            pool,
            &activity.id,
            "info",
            "Queued description recovery before AI review",
            json!({
                "descriptionActivityId": recovery_id,
                "jobId": job.id,
            }),
        )
        .await?;
    } else {
        insert_activity_log(
            pool,
            &activity.id,
            "info",
            "Waiting for existing description recovery before AI review",
            json!({
                "jobId": job.id,
            }),
        )
        .await?;
    }

    defer_ai_review_for_description(pool, config, &activity.id).await?;
    Ok(DescriptionRecoveryOutcome::Deferred)
}

async fn job_has_linkedin_external_job(pool: &PgPool, job_id: &str) -> Result<bool> {
    let row = sqlx::query(
        r#"
        SELECT EXISTS (
          SELECT 1
          FROM external_jobs
          JOIN providers ON providers.id = external_jobs.provider_id
          WHERE external_jobs.job_id = $1::uuid
            AND providers.provider_key = 'linkedin'
        ) AS exists
        "#,
    )
    .bind(job_id)
    .fetch_one(pool)
    .await
    .context("check LinkedIn external job for description recovery failed")?;

    row.try_get("exists")
        .context("read LinkedIn external job existence failed")
}

async fn defer_ai_review_for_description(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
) -> Result<()> {
    let result = sqlx::query(
        r#"
        UPDATE activities
        SET
          status = 'queued',
          phase = 'waiting_description',
          message = 'Waiting for description recovery before AI review',
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          queued_at = now()
        WHERE id = $1::uuid
          AND lease_owner = $2
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .execute(pool)
    .await
    .context("defer AI review until description recovery failed")?;
    if result.rows_affected() == 0 {
        return Err(anyhow!("activity lease was lost while deferring AI review"));
    }
    insert_activity_log(
        pool,
        activity_id,
        "info",
        "Deferred AI review until description recovery completes",
        json!({}),
    )
    .await?;

    Ok(())
}

async fn request_ai_review_with_retry(
    pool: &PgPool,
    activity_id: &str,
    target: &AiReviewTarget,
    prompt: &str,
    runtime: &AiRuntime,
    payload: &Value,
) -> Result<AiCompletion> {
    let max_attempts = runtime.retry_attempts.saturating_add(1).max(1);
    let mut last_error = None;

    for attempt in 1..=max_attempts {
        let completion = match read_fixture_completion(payload, attempt) {
            Some(completion) => completion,
            None => {
                request_ai_review(
                    &target.endpoint_base_url,
                    &target.model_name,
                    prompt,
                    runtime,
                )
                .await
            }
        };

        match completion {
            Ok(mut completion) => {
                if max_attempts > 1 {
                    if let Value::Object(metrics) = &mut completion.metrics {
                        metrics.insert("retryAttempt".to_string(), json!(attempt));
                        metrics.insert(
                            "retryAttemptsConfigured".to_string(),
                            json!(runtime.retry_attempts),
                        );
                    } else {
                        let raw_metrics = std::mem::take(&mut completion.metrics);
                        completion.metrics = json!({
                            "rawMetrics": raw_metrics,
                            "retryAttempt": attempt,
                            "retryAttemptsConfigured": runtime.retry_attempts,
                        });
                    }
                }
                return Ok(completion);
            }
            Err(error) => {
                let retryable = attempt < max_attempts;
                insert_activity_log(
                    pool,
                    activity_id,
                    if retryable { "warn" } else { "error" },
                    if retryable {
                        "AI review request failed, retrying"
                    } else {
                        "AI review request failed"
                    },
                    json!({
                        "attempt": attempt,
                        "maxAttempts": max_attempts,
                        "retryDelaySeconds": runtime.retry_delay_seconds,
                        "error": format!("{error:#}"),
                    }),
                )
                .await?;
                last_error = Some(error);

                if retryable && runtime.retry_delay_seconds > 0 {
                    sleep(Duration::from_secs(runtime.retry_delay_seconds)).await;
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow!("AI review request failed")))
}

pub(crate) fn read_fixture_completion(
    payload: &Value,
    attempt: u64,
) -> Option<Result<AiCompletion>> {
    let fixture = payload
        .get("fixtureAiOutput")
        .or_else(|| payload.get("fixture_ai_output"))?;
    let failures_before_success = payload
        .get("fixtureAiFailuresBeforeSuccess")
        .or_else(|| payload.get("fixture_ai_failures_before_success"))
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str()?.trim().parse::<u64>().ok())
        })
        .unwrap_or(0);

    if attempt <= failures_before_success {
        return Some(Err(anyhow!("fixture AI failure before success")));
    }

    let raw_output = fixture
        .as_str()
        .map(ToString::to_string)
        .or_else(|| {
            fixture
                .get("response")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| fixture.to_string());
    let metrics = payload
        .get("fixtureAiMetrics")
        .or_else(|| payload.get("fixture_ai_metrics"))
        .cloned()
        .unwrap_or_else(|| json!({ "fixture": true }));

    Some(Ok(AiCompletion {
        metrics,
        raw_output,
    }))
}

struct JobReviewInsert<'a> {
    ai_metrics: Value,
    profile_hash: &'a str,
    raw_output: Option<&'a str>,
    review: &'a NormalizedReview,
    rules_hash: &'a str,
    source_activity_id: &'a str,
}

async fn insert_job_review(
    pool: &PgPool,
    target: &AiReviewTarget,
    input: JobReviewInsert<'_>,
) -> Result<String> {
    let metrics = json!({
        "ai": input.ai_metrics,
        "endpointName": target.endpoint_name,
        "mode": target.mode,
        "sourceActivityId": input.source_activity_id,
    });
    let row = sqlx::query(
        r#"
        INSERT INTO job_reviews(
          job_id,
          endpoint_id,
          model_id,
          model_name,
          profile_hash,
          rules_hash,
          status,
          decision,
          score,
          result,
          raw_output,
          error,
          metrics
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::jsonb,
          $11,
          $12,
          $13::jsonb
        )
        RETURNING id::text AS id
        "#,
    )
    .bind(&target.job.id)
    .bind(&target.endpoint_id)
    .bind(&target.model_id)
    .bind(&target.model_name)
    .bind(input.profile_hash)
    .bind(input.rules_hash)
    .bind(input.review.status)
    .bind(input.review.decision.as_deref())
    .bind(input.review.score)
    .bind(&input.review.result)
    .bind(input.raw_output)
    .bind(input.review.error.as_deref())
    .bind(metrics)
    .fetch_one(pool)
    .await
    .context("insert AI job review failed")?;

    row.try_get("id").context("read AI job review id failed")
}

fn runtime_string(runtime: &Value, key: &str) -> Option<String> {
    runtime
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}
