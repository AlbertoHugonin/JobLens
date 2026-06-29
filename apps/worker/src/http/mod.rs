mod health;
mod metrics;

use std::{sync::Arc, time::Instant};

use axum::{Router, routing::get};
use sqlx::PgPool;

use crate::telemetry::WorkerMetrics;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) database_configured: bool,
    pub(crate) metrics: Arc<WorkerMetrics>,
    pub(crate) pool: Option<PgPool>,
    pub(crate) run_loop: bool,
    pub(crate) started_at: Instant,
    pub(crate) version: &'static str,
    pub(crate) worker_id: String,
}

#[cfg(test)]
pub(crate) use health::build_health_response;

pub(crate) fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route("/api/v1/health", get(health::health))
        .route("/metrics", get(metrics::metrics))
        .route("/api/v1/metrics", get(metrics::metrics))
        .with_state(state)
}
