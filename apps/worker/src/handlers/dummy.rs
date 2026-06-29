use std::sync::atomic::Ordering;

use anyhow::{Result, anyhow};
use sqlx::PgPool;
use tokio::{sync::watch, time::sleep};

use crate::{
    activities::{
        HeartbeatOutcome, heartbeat_activity, mark_activity_cancelled, mark_activity_interrupted,
        mark_activity_succeeded,
    },
    config::WorkerConfig,
    telemetry::WorkerMetrics,
    util::divided_duration,
};

pub(crate) const DUMMY_ACTIVITY_STEPS: i32 = 5;

pub(crate) async fn run_dummy_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity_id: &str,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    let total_steps = dummy_activity_steps(config);
    let step_duration = divided_duration(config.dummy_duration, total_steps as u32);

    for step in 1..=total_steps {
        if *shutdown_rx.borrow() {
            mark_activity_interrupted(pool, config, activity_id, "Worker shutdown requested")
                .await?;
            metrics
                .activities_interrupted
                .fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }

        tokio::select! {
            _ = sleep(step_duration) => {}
            changed = shutdown_rx.changed() => {
                if changed.is_err() || *shutdown_rx.borrow() {
                    mark_activity_interrupted(pool, config, activity_id, "Worker shutdown requested").await?;
                    metrics.activities_interrupted.fetch_add(1, Ordering::Relaxed);
                    return Ok(());
                }
            }
        }

        match heartbeat_activity(
            pool,
            config,
            activity_id,
            "running",
            "Dummy activity running",
            step,
            total_steps,
        )
        .await?
        {
            HeartbeatOutcome::Running => {
                metrics.heartbeats.fetch_add(1, Ordering::Relaxed);
            }
            HeartbeatOutcome::CancelRequested => {
                mark_activity_cancelled(pool, config, activity_id).await?;
                metrics.activities_cancelled.fetch_add(1, Ordering::Relaxed);
                return Ok(());
            }
            HeartbeatOutcome::LeaseLost => {
                return Err(anyhow!("activity lease was lost"));
            }
        }
    }

    mark_activity_succeeded(pool, config, activity_id).await?;
    metrics.activities_succeeded.fetch_add(1, Ordering::Relaxed);
    Ok(())
}

pub(crate) fn dummy_activity_steps(config: &WorkerConfig) -> i32 {
    let duration_ms = config.dummy_duration.as_millis().max(1);
    let heartbeat_ms = config.heartbeat_interval.as_millis().max(1);
    let heartbeat_steps = duration_ms.div_ceil(heartbeat_ms);
    let steps = heartbeat_steps.max(DUMMY_ACTIVITY_STEPS as u128).min(100);

    i32::try_from(steps).unwrap_or(100)
}
