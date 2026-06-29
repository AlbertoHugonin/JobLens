use anyhow::{Context, Result};
use sqlx::PgPool;

pub(crate) async fn insert_activity_log(
    pool: &PgPool,
    activity_id: &str,
    level: &str,
    message: &str,
    data: serde_json::Value,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO activity_logs(activity_id, level, message, data)
        VALUES ($1::uuid, $2, $3, $4::jsonb)
        "#,
    )
    .bind(activity_id)
    .bind(level)
    .bind(message)
    .bind(data)
    .execute(pool)
    .await
    .context("insert activity log failed")?;

    Ok(())
}
