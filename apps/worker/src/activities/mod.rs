pub(crate) mod claim;
pub(crate) mod log;
pub(crate) mod state;

use std::{sync::Arc, sync::atomic::Ordering};

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::{sync::watch, time::sleep};
use tracing::{error, info, warn};

use crate::{
    config::WorkerConfig, handlers::process_activity, scheduler::enqueue_due_searches,
    telemetry::WorkerMetrics,
};

pub(crate) use claim::claim_next_activity;
pub(crate) use log::insert_activity_log;
pub(crate) use state::{
    heartbeat_activity, mark_activity_cancelled, mark_activity_failed, mark_activity_interrupted,
    mark_activity_succeeded,
};

#[derive(Debug, Clone)]
pub(crate) struct ClaimedActivity {
    pub(crate) activity_type: String,
    pub(crate) id: String,
    pub(crate) payload: Value,
    pub(crate) subject_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeartbeatOutcome {
    CancelRequested,
    LeaseLost,
    Running,
}

pub(crate) async fn run_worker_loop(
    pool: PgPool,
    config: WorkerConfig,
    metrics: Arc<WorkerMetrics>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    info!(worker_id = %config.worker_id, "worker activity loop started");

    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        if let Err(err) = enqueue_due_searches(&pool, OffsetDateTime::now_utc()).await {
            warn!(error = %err, "cannot enqueue scheduled searches");
        }

        match claim_next_activity(&pool, &config).await {
            Ok(Some(activity)) => {
                metrics.activities_claimed.fetch_add(1, Ordering::Relaxed);
                if let Err(err) =
                    process_activity(&pool, &config, &metrics, activity.clone(), &mut shutdown_rx)
                        .await
                {
                    metrics.activities_failed.fetch_add(1, Ordering::Relaxed);
                    error!(
                        activity_id = %activity.id,
                        activity_type = %activity.activity_type,
                        error = %err,
                        "activity processing failed"
                    );
                    mark_activity_failed(&pool, &config, &activity.id, &err.to_string()).await?;
                }
            }
            Ok(None) => {
                tokio::select! {
                    _ = sleep(config.poll_interval) => {}
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() || *shutdown_rx.borrow() {
                            break;
                        }
                    }
                }
            }
            Err(err) => {
                metrics.claim_errors.fetch_add(1, Ordering::Relaxed);
                error!(error = %err, "cannot claim activity");
                tokio::select! {
                    _ = sleep(config.poll_interval) => {}
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() || *shutdown_rx.borrow() {
                            break;
                        }
                    }
                }
            }
        }
    }

    info!(worker_id = %config.worker_id, "worker activity loop stopped");
    Ok(())
}
