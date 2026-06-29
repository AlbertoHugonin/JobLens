use anyhow::{Context, Result};
use sqlx::{PgPool, Row};
use time::OffsetDateTime;

use crate::{
    activities::{ClaimedActivity, insert_activity_log},
    ai::queue::is_ai_review_paused_now,
    config::WorkerConfig,
    util::duration_as_i64_seconds,
};

pub(crate) async fn claim_next_activity(
    pool: &PgPool,
    config: &WorkerConfig,
) -> Result<Option<ClaimedActivity>> {
    let lease_seconds = duration_as_i64_seconds(config.lease_duration);
    let ai_paused = is_ai_review_paused_now(pool, OffsetDateTime::now_utc()).await?;
    let row = sqlx::query(
        r#"
        WITH candidate AS (
          SELECT id
          FROM activities
          WHERE cancel_requested_at IS NULL
            AND (
              status = 'queued'
              OR status = 'interrupted'
              OR (status = 'running' AND lease_expires_at < now())
            )
            AND ($3::boolean = false OR activity_type <> 'ai_review')
          ORDER BY queued_at ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE activities AS a
        SET
          status = 'running',
          lease_owner = $1,
          lease_expires_at = now() + ($2::text || ' seconds')::interval,
          heartbeat_at = now(),
          started_at = COALESCE(a.started_at, now()),
          attempt = CASE WHEN a.status = 'queued' THEN a.attempt + 1 ELSE a.attempt END,
          phase = 'claimed',
          message = 'Claimed by worker',
          error = NULL
        FROM candidate
        WHERE a.id = candidate.id
        RETURNING a.id::text AS id, a.activity_type, a.payload, a.subject_id::text AS subject_id
        "#,
    )
    .bind(&config.worker_id)
    .bind(lease_seconds)
    .bind(ai_paused)
    .fetch_optional(pool)
    .await
    .context("claim activity query failed")?;

    match row {
        Some(row) => {
            let activity = ClaimedActivity {
                activity_type: row.try_get("activity_type")?,
                id: row.try_get("id")?,
                payload: row.try_get("payload")?,
                subject_id: row.try_get("subject_id")?,
            };
            insert_activity_log(
                pool,
                &activity.id,
                "info",
                "Claimed activity",
                serde_json::json!({
                    "worker_id": config.worker_id,
                    "lease_seconds": lease_seconds,
                }),
            )
            .await?;
            Ok(Some(activity))
        }
        None => Ok(None),
    }
}
