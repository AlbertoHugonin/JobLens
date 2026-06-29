use std::sync::atomic::Ordering;

use anyhow::{Context, Result, anyhow};
use serde_json::json;
use sqlx::{PgPool, Row};
use tokio::{sync::watch, time::sleep};

use crate::{
    activities::{
        ClaimedActivity, HeartbeatOutcome, heartbeat_activity, insert_activity_log,
        mark_activity_cancelled, mark_activity_interrupted, mark_activity_succeeded,
    },
    config::WorkerConfig,
    telemetry::WorkerMetrics,
    util::{divided_duration, read_json_string},
};

#[derive(Debug, Clone)]
struct ModelInstallTarget {
    endpoint_id: String,
    model_id: String,
    model_name: String,
}

pub(crate) async fn run_model_install_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    let target = read_model_install_target(pool, activity).await?;
    let total_steps = 3;
    let step_duration = divided_duration(config.dummy_duration, total_steps as u32);

    for step in 1..=total_steps {
        if *shutdown_rx.borrow() {
            mark_activity_interrupted(pool, config, &activity.id, "Worker shutdown requested")
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
                    mark_activity_interrupted(pool, config, &activity.id, "Worker shutdown requested").await?;
                    metrics.activities_interrupted.fetch_add(1, Ordering::Relaxed);
                    return Ok(());
                }
            }
        }

        let message = match step {
            1 => "Preparing model install",
            2 => "Installing model",
            _ => "Finalizing model install",
        };
        match heartbeat_activity(
            pool,
            config,
            &activity.id,
            "installing",
            message,
            step,
            total_steps,
        )
        .await?
        {
            HeartbeatOutcome::Running => {
                metrics.heartbeats.fetch_add(1, Ordering::Relaxed);
            }
            HeartbeatOutcome::CancelRequested => {
                mark_activity_cancelled(pool, config, &activity.id).await?;
                metrics.activities_cancelled.fetch_add(1, Ordering::Relaxed);
                return Ok(());
            }
            HeartbeatOutcome::LeaseLost => return Err(anyhow!("activity lease was lost")),
        }
    }

    mark_model_installed(pool, &target, &activity.id).await?;
    insert_activity_log(
        pool,
        &activity.id,
        "info",
        "Model install completed",
        json!({
            "endpointId": target.endpoint_id,
            "modelId": target.model_id,
            "modelName": target.model_name,
        }),
    )
    .await?;
    mark_activity_succeeded(pool, config, &activity.id).await?;
    metrics.activities_succeeded.fetch_add(1, Ordering::Relaxed);

    Ok(())
}

async fn read_model_install_target(
    pool: &PgPool,
    activity: &ClaimedActivity,
) -> Result<ModelInstallTarget> {
    let model_id = activity
        .subject_id
        .clone()
        .or_else(|| read_json_string(&activity.payload, "modelId"))
        .context("model_install activity is missing model id")?;
    let row = sqlx::query(
        r#"
        SELECT
          ai_models.id::text AS model_id,
          ai_models.endpoint_id::text AS endpoint_id,
          ai_models.name AS model_name
        FROM ai_models
        JOIN ai_endpoints ON ai_endpoints.id = ai_models.endpoint_id
        WHERE ai_models.id = $1::uuid
          AND ai_endpoints.enabled = true
        "#,
    )
    .bind(&model_id)
    .fetch_optional(pool)
    .await
    .context("read model install target failed")?
    .context("enabled AI model target was not found")?;

    Ok(ModelInstallTarget {
        endpoint_id: row.try_get("endpoint_id")?,
        model_id: row.try_get("model_id")?,
        model_name: row.try_get("model_name")?,
    })
}

async fn mark_model_installed(
    pool: &PgPool,
    target: &ModelInstallTarget,
    activity_id: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE ai_models
        SET
          installed = true,
          metadata = metadata || jsonb_build_object(
            'installedAt', now(),
            'lastInstallActivityId', $2::uuid
          )
        WHERE id = $1::uuid
        "#,
    )
    .bind(&target.model_id)
    .bind(activity_id)
    .execute(pool)
    .await
    .context("mark model installed failed")?;

    Ok(())
}
