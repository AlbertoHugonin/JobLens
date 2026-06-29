pub(crate) mod ai_review;
pub(crate) mod availability;
pub(crate) mod collection;
pub(crate) mod description;
pub(crate) mod dummy;
pub(crate) mod export;
pub(crate) mod model_install;

use std::sync::atomic::Ordering;

use anyhow::{Result, anyhow};
use serde_json::json;
use sqlx::PgPool;
use tokio::sync::watch;

use crate::{
    activities::{ClaimedActivity, insert_activity_log},
    config::WorkerConfig,
    telemetry::WorkerMetrics,
};

pub(crate) async fn process_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    insert_activity_log(
        pool,
        &activity.id,
        "info",
        "Started activity",
        json!({
            "activity_type": activity.activity_type,
            "worker_id": config.worker_id,
        }),
    )
    .await?;

    match activity.activity_type.as_str() {
        "dummy" => {
            dummy::run_dummy_activity(pool, config, metrics, &activity.id, shutdown_rx).await
        }
        "linkedin_collect" => {
            collection::run_linkedin_collect_activity(pool, config, metrics, &activity, shutdown_rx)
                .await
        }
        "linkedin_describe" => {
            description::run_linkedin_describe_activity(
                pool,
                config,
                metrics,
                &activity,
                shutdown_rx,
            )
            .await
        }
        "linkedin_availability" => {
            availability::run_linkedin_availability_activity(
                pool,
                config,
                metrics,
                &activity,
                shutdown_rx,
            )
            .await
        }
        "model_install" => {
            model_install::run_model_install_activity(pool, config, metrics, &activity, shutdown_rx)
                .await
        }
        "ai_review" => {
            ai_review::run_ai_review_activity(pool, config, metrics, &activity, shutdown_rx).await
        }
        "export" => {
            export::run_export_activity(pool, config, metrics, &activity, shutdown_rx).await
        }
        unsupported => {
            metrics
                .unsupported_activities
                .fetch_add(1, Ordering::Relaxed);
            Err(anyhow!("unsupported activity type: {unsupported}"))
        }
    }
}
