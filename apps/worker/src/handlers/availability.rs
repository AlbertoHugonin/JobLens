use anyhow::Result;
use sqlx::PgPool;
use tokio::sync::watch;

use crate::{activities::ClaimedActivity, config::WorkerConfig, telemetry::WorkerMetrics};

pub(crate) async fn run_linkedin_availability_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    crate::providers::linkedin::run_availability_activity(
        pool,
        config,
        metrics,
        activity,
        shutdown_rx,
    )
    .await
}
