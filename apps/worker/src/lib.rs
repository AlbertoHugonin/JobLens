pub mod error;

pub(crate) mod activities;
pub(crate) mod ai;
pub(crate) mod config;
pub(crate) mod db;
pub(crate) mod handlers;
pub(crate) mod http;
pub(crate) mod providers;
pub(crate) mod scheduler;
pub(crate) mod telemetry;
pub(crate) mod util;

use std::{net::SocketAddr, sync::Arc, time::Instant};

use anyhow::Context;
use tokio::{net::TcpListener, sync::watch};
use tracing::info;

use crate::{
    activities::run_worker_loop,
    config::read_config,
    db::connect_database,
    error::WorkerResult,
    http::{AppState, build_router},
    telemetry::{WorkerMetrics, init_tracing},
};

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use activities::{claim_next_activity, mark_activity_failed, mark_activity_succeeded};
#[cfg(test)]
pub(crate) use ai::client::AiRuntime;
#[cfg(test)]
pub(crate) use ai::enqueue::{AutomaticReviewQueueOutcome, enqueue_automatic_review_for_job};
#[cfg(test)]
pub(crate) use ai::queue::is_ai_paused;
#[cfg(test)]
pub(crate) use config::WorkerConfig;
#[cfg(test)]
pub(crate) use handlers::ai_review::read_fixture_completion as read_ai_fixture_completion;
#[cfg(test)]
pub(crate) use handlers::dummy::{DUMMY_ACTIVITY_STEPS, dummy_activity_steps};
#[cfg(test)]
pub(crate) use handlers::process_activity;
#[cfg(test)]
pub(crate) use http::{AppState as TestAppState, build_health_response};
#[cfg(test)]
pub(crate) use providers::linkedin::{
    build_linkedin_job_cards_url, build_linkedin_voyager_query, description_content_hash,
    extract_jobs_from_payload, extract_total_results, normalize_description_text,
    strip_html_to_text,
};
#[cfg(test)]
pub(crate) use scheduler::{enqueue_due_searches, is_search_due};
#[cfg(test)]
pub(crate) use telemetry::WorkerMetrics as TestWorkerMetrics;
#[cfg(test)]
pub(crate) use util::{divided_duration, duration_as_i64_seconds};

pub async fn run() -> WorkerResult<()> {
    init_tracing();

    let config = read_config();
    let metrics = Arc::new(WorkerMetrics::default());
    let pool = connect_database(&config).await?;
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let state = AppState {
        database_configured: pool.is_some(),
        metrics: Arc::clone(&metrics),
        pool: pool.clone(),
        run_loop: config.run_loop,
        started_at: Instant::now(),
        version: env!("CARGO_PKG_VERSION"),
        worker_id: config.worker_id.clone(),
    };
    let app = build_router(state);
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .with_context(|| {
            format!(
                "invalid worker bind address {}:{}",
                config.host, config.port
            )
        })?;
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("cannot bind worker on {addr}"))?;

    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        let _ = shutdown_tx.send(true);
    });

    let worker_handle = if config.run_loop {
        pool.clone().map(|pool| {
            tokio::spawn(run_worker_loop(
                pool,
                config.clone(),
                Arc::clone(&metrics),
                shutdown_rx.clone(),
            ))
        })
    } else {
        None
    };

    info!(%addr, worker_id = %config.worker_id, "joblens worker server listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(wait_for_shutdown(shutdown_rx.clone()))
        .await
        .context("worker server failed")?;

    if let Some(handle) = worker_handle {
        handle.await.context("worker loop task failed")??;
    }

    Ok(())
}

async fn wait_for_shutdown(mut shutdown_rx: watch::Receiver<bool>) {
    while !*shutdown_rx.borrow() {
        if shutdown_rx.changed().await.is_err() {
            break;
        }
    }
}
