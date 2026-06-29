use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};

use crate::config::WorkerConfig;

#[derive(Debug, Serialize)]
pub(crate) struct QueueSnapshot {
    cancelled: i64,
    failed: i64,
    interrupted: i64,
    queued: i64,
    running: i64,
    success: i64,
}

pub(crate) async fn connect_database(config: &WorkerConfig) -> Result<Option<PgPool>> {
    match &config.database_url {
        Some(database_url) => Ok(Some(
            PgPoolOptions::new()
                .max_connections(5)
                .connect(database_url)
                .await
                .context("cannot connect worker to PostgreSQL")?,
        )),
        None => Ok(None),
    }
}

pub(crate) async fn read_queue_snapshot(pool: &PgPool) -> Result<QueueSnapshot> {
    let rows = sqlx::query(
        r#"
        SELECT status, COUNT(*)::bigint AS count
        FROM activities
        GROUP BY status
        "#,
    )
    .fetch_all(pool)
    .await
    .context("queue metrics query failed")?;

    let mut snapshot = QueueSnapshot {
        cancelled: 0,
        failed: 0,
        interrupted: 0,
        queued: 0,
        running: 0,
        success: 0,
    };

    for row in rows {
        let status: String = row.try_get("status")?;
        let count: i64 = row.try_get("count")?;

        match status.as_str() {
            "cancelled" => snapshot.cancelled = count,
            "failed" => snapshot.failed = count,
            "interrupted" => snapshot.interrupted = count,
            "queued" => snapshot.queued = count,
            "running" => snapshot.running = count,
            "success" => snapshot.success = count,
            _ => {}
        }
    }

    Ok(snapshot)
}
