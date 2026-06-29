use anyhow::{Context, Result, anyhow};
use sqlx::{PgPool, Row};

use crate::{
    activities::{HeartbeatOutcome, insert_activity_log},
    config::WorkerConfig,
    util::duration_as_i64_seconds,
};

pub(crate) async fn heartbeat_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
    phase: &str,
    message: &str,
    progress_current: i32,
    progress_total: i32,
) -> Result<HeartbeatOutcome> {
    let row = sqlx::query(
        r#"
        UPDATE activities
        SET
          heartbeat_at = now(),
          lease_expires_at = now() + ($3::text || ' seconds')::interval,
          phase = $4,
          message = $5,
          progress_current = $6,
          progress_total = $7
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
        RETURNING cancel_requested_at IS NOT NULL AS cancel_requested
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .bind(duration_as_i64_seconds(config.lease_duration))
    .bind(phase)
    .bind(message)
    .bind(progress_current)
    .bind(progress_total)
    .fetch_optional(pool)
    .await
    .context("heartbeat activity query failed")?;

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

pub(crate) async fn mark_activity_succeeded(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
) -> Result<()> {
    let rows = sqlx::query(
        r#"
        UPDATE activities
        SET
          status = 'success',
          progress_current = COALESCE(progress_total, progress_current),
          phase = 'completed',
          message = 'Completed successfully',
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          finished_at = now()
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .execute(pool)
    .await
    .context("mark success query failed")?
    .rows_affected();

    if rows == 0 {
        return Err(anyhow!(
            "cannot mark activity success because lease was lost"
        ));
    }

    insert_activity_log(
        pool,
        activity_id,
        "info",
        "Completed activity",
        serde_json::json!({ "worker_id": config.worker_id }),
    )
    .await
}

pub(crate) async fn mark_activity_failed(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
    error_message: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE activities
        SET
          status = 'failed',
          phase = 'failed',
          message = 'Activity failed',
          error = $3,
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          finished_at = now()
        WHERE id = $1::uuid
          AND lease_owner = $2
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .bind(error_message)
    .execute(pool)
    .await
    .context("mark failed query failed")?;

    insert_activity_log(
        pool,
        activity_id,
        "error",
        "Failed activity",
        serde_json::json!({
            "worker_id": config.worker_id,
            "error": error_message,
        }),
    )
    .await
}

pub(crate) async fn mark_activity_cancelled(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE activities
        SET
          status = 'cancelled',
          phase = 'cancelled',
          message = 'Cancelled by request',
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          finished_at = now()
        WHERE id = $1::uuid
          AND lease_owner = $2
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .execute(pool)
    .await
    .context("mark cancelled query failed")?;

    insert_activity_log(
        pool,
        activity_id,
        "warn",
        "Cancelled activity",
        serde_json::json!({ "worker_id": config.worker_id }),
    )
    .await
}

pub(crate) async fn mark_activity_interrupted(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
    message: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE activities
        SET
          status = 'interrupted',
          phase = 'interrupted',
          message = $3,
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          finished_at = now()
        WHERE id = $1::uuid
          AND lease_owner = $2
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .bind(message)
    .execute(pool)
    .await
    .context("mark interrupted query failed")?;

    insert_activity_log(
        pool,
        activity_id,
        "warn",
        "Interrupted activity",
        serde_json::json!({
            "worker_id": config.worker_id,
            "message": message,
        }),
    )
    .await
}
