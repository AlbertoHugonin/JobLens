use std::sync::atomic::Ordering;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use sqlx::{PgPool, Row};
use tokio::sync::watch;

use crate::{
    activities::{
        ClaimedActivity, HeartbeatOutcome, heartbeat_activity, mark_activity_cancelled,
        mark_activity_interrupted, mark_activity_succeeded,
    },
    config::WorkerConfig,
    telemetry::WorkerMetrics,
    util::{duration_as_i64_seconds, read_json_bool, read_json_i32, read_json_string},
};

use super::{
    session::{build_linkedin_headers, linkedin_user_agent, read_optional_active_linkedin_session},
    types::{AvailabilityCheckResult, LinkedInAvailabilityTarget},
};

pub(crate) async fn run_availability_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    if *shutdown_rx.borrow() {
        mark_activity_interrupted(pool, config, &activity.id, "Worker shutdown requested").await?;
        metrics
            .activities_interrupted
            .fetch_add(1, Ordering::Relaxed);
        return Ok(());
    }

    let target = read_linkedin_availability_target(pool, activity).await?;
    if job_has_search_presence(pool, &target.job_id).await? {
        update_linkedin_availability_activity(
            pool,
            config,
            &activity.id,
            "active",
            None,
            "Skipped availability because job is present in a search",
        )
        .await?;
        mark_activity_succeeded(pool, config, &activity.id).await?;
        metrics.activities_succeeded.fetch_add(1, Ordering::Relaxed);
        return Ok(());
    }

    match heartbeat_activity(
        pool,
        config,
        &activity.id,
        "checking",
        "Checking LinkedIn job availability",
        0,
        1,
    )
    .await?
    {
        HeartbeatOutcome::Running => {}
        HeartbeatOutcome::CancelRequested => {
            mark_activity_cancelled(pool, config, &activity.id).await?;
            metrics.activities_cancelled.fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }
        HeartbeatOutcome::LeaseLost => return Err(anyhow!("activity lease was lost")),
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(linkedin_user_agent(None))
        .build()
        .context("cannot build LinkedIn availability HTTP client")?;
    let result = match read_fixture_availability(&activity.payload) {
        Some(result) => result,
        None => fetch_linkedin_availability(pool, &client, &target).await?,
    };
    update_job_availability_if_outside(pool, &target.job_id, &activity.id, &result).await?;
    update_linkedin_availability_activity(
        pool,
        config,
        &activity.id,
        result.status,
        result.http_status,
        "Completed LinkedIn availability check",
    )
    .await?;
    mark_activity_succeeded(pool, config, &activity.id).await?;
    metrics.activities_succeeded.fetch_add(1, Ordering::Relaxed);

    Ok(())
}

async fn read_linkedin_availability_target(
    pool: &PgPool,
    activity: &ClaimedActivity,
) -> Result<LinkedInAvailabilityTarget> {
    let job_id = activity
        .subject_id
        .clone()
        .or_else(|| read_json_string(&activity.payload, "jobId"))
        .context("linkedin_availability activity is missing job id")?;
    let row = sqlx::query(
        r#"
        SELECT
          jobs.id::text AS job_id,
          providers.id::text AS provider_id,
          COALESCE(external_jobs.external_url, jobs.provider_url, jobs.source_url) AS url
        FROM jobs
        JOIN external_jobs ON external_jobs.job_id = jobs.id
        JOIN providers ON providers.id = external_jobs.provider_id
        WHERE jobs.id = $1::uuid
          AND providers.provider_key = 'linkedin'
        ORDER BY external_jobs.created_at ASC
        LIMIT 1
        "#,
    )
    .bind(&job_id)
    .fetch_optional(pool)
    .await
    .context("read LinkedIn availability target failed")?
    .context("LinkedIn availability target was not found")?;

    Ok(LinkedInAvailabilityTarget {
        job_id: row.try_get("job_id")?,
        provider_id: row.try_get("provider_id")?,
        url: row.try_get("url")?,
    })
}

async fn job_has_search_presence(pool: &PgPool, job_id: &str) -> Result<bool> {
    let row = sqlx::query(
        r#"
        SELECT EXISTS(
          SELECT 1
          FROM job_search_presence
          WHERE job_id = $1::uuid
        ) AS has_presence
        "#,
    )
    .bind(job_id)
    .fetch_one(pool)
    .await
    .context("read job search presence failed")?;

    Ok(row.try_get("has_presence")?)
}

fn read_fixture_availability(payload: &Value) -> Option<AvailabilityCheckResult> {
    let fixture = payload
        .get("fixtureAvailability")
        .or_else(|| payload.get("fixture_availability"))?;

    match fixture {
        Value::Bool(available) => Some(AvailabilityCheckResult {
            http_status: Some(if *available { 200 } else { 404 }),
            status: if *available {
                "available_outside_searches"
            } else {
                "unavailable"
            },
        }),
        Value::Object(_) => {
            let status_text = read_json_string(fixture, "status");
            let available = read_json_bool(fixture, "available");
            let http_status = read_json_i32(fixture, "httpStatus")
                .or_else(|| read_json_i32(fixture, "http_status"));
            let status = match (status_text.as_deref(), available, http_status) {
                (Some("available_outside_searches"), _, _) => "available_outside_searches",
                (Some("unavailable"), _, _) => "unavailable",
                (_, Some(true), _) => "available_outside_searches",
                (_, Some(false), _) => "unavailable",
                (_, _, Some(404 | 410)) => "unavailable",
                (_, _, Some(status)) if (200..400).contains(&status) => {
                    "available_outside_searches"
                }
                _ => "unavailable",
            };

            Some(AvailabilityCheckResult {
                http_status,
                status,
            })
        }
        _ => None,
    }
}

async fn fetch_linkedin_availability(
    pool: &PgPool,
    client: &reqwest::Client,
    target: &LinkedInAvailabilityTarget,
) -> Result<AvailabilityCheckResult> {
    let url = target
        .url
        .as_ref()
        .context("LinkedIn availability URL is missing")?;
    let session = read_optional_active_linkedin_session(pool, &target.provider_id).await?;
    let mut request = client.get(url);

    if let Some(session) = session.as_ref() {
        request = request.headers(build_linkedin_headers(session)?);
    }

    let response = request
        .send()
        .await
        .context("LinkedIn availability request failed")?;
    let status = i32::from(response.status().as_u16());

    match status {
        200..=399 => Ok(AvailabilityCheckResult {
            http_status: Some(status),
            status: "available_outside_searches",
        }),
        404 | 410 => Ok(AvailabilityCheckResult {
            http_status: Some(status),
            status: "unavailable",
        }),
        _ => Err(anyhow!("LinkedIn availability failed with HTTP {status}")),
    }
}

async fn update_job_availability_if_outside(
    pool: &PgPool,
    job_id: &str,
    activity_id: &str,
    result: &AvailabilityCheckResult,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE jobs
        SET
          availability_status = $2,
          metadata = metadata || jsonb_build_object(
            'lastAvailabilityCheck',
            jsonb_build_object(
              'activityId', $3::uuid,
              'httpStatus', $4,
              'provider', 'linkedin',
              'status', $2,
              'checkedAt', now()
            )
          )
        WHERE id = $1::uuid
          AND NOT EXISTS (
            SELECT 1
            FROM job_search_presence
            WHERE job_search_presence.job_id = jobs.id
          )
        "#,
    )
    .bind(job_id)
    .bind(result.status)
    .bind(activity_id)
    .bind(result.http_status)
    .execute(pool)
    .await
    .context("update LinkedIn availability failed")?;

    Ok(())
}

async fn update_linkedin_availability_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
    availability_status: &str,
    http_status: Option<i32>,
    message: &str,
) -> Result<HeartbeatOutcome> {
    let row = sqlx::query(
        r#"
        UPDATE activities
        SET
          heartbeat_at = now(),
          lease_expires_at = now() + ($3::text || ' seconds')::interval,
          phase = 'availability_checked',
          message = $4,
          progress_current = 1,
          progress_total = 1,
          payload = payload || jsonb_build_object(
            'availability', jsonb_build_object(
              'httpStatus', $5,
              'status', $6
            )
          )
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
        RETURNING cancel_requested_at IS NOT NULL AS cancel_requested
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .bind(duration_as_i64_seconds(config.lease_duration))
    .bind(message)
    .bind(http_status)
    .bind(availability_status)
    .fetch_optional(pool)
    .await
    .context("update LinkedIn availability activity failed")?;

    match row {
        Some(row) => {
            let cancel_requested: bool = row.try_get("cancel_requested")?;
            if cancel_requested {
                Ok(HeartbeatOutcome::CancelRequested)
            } else {
                Ok(HeartbeatOutcome::Running)
            }
        }
        None => Ok(HeartbeatOutcome::LeaseLost),
    }
}
