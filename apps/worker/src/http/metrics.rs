use axum::{Json, extract::State};
use serde::Serialize;
use tracing::warn;

use super::AppState;
use crate::{
    db::QueueSnapshot,
    telemetry::{MetricsSnapshot, build_metrics_snapshot, utc_timestamp},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetricsResponse {
    metrics: MetricsSnapshot,
    queue: Option<QueueSnapshot>,
    service: &'static str,
    timestamp: String,
    uptime_seconds: u64,
    version: &'static str,
    worker_id: String,
}

pub(crate) async fn metrics(State(state): State<AppState>) -> Json<MetricsResponse> {
    let queue = match &state.pool {
        Some(pool) => match crate::db::read_queue_snapshot(pool).await {
            Ok(snapshot) => Some(snapshot),
            Err(err) => {
                warn!(error = %err, "cannot read worker queue metrics");
                None
            }
        },
        None => None,
    };

    Json(MetricsResponse {
        metrics: build_metrics_snapshot(&state.metrics),
        queue,
        service: "worker",
        timestamp: utc_timestamp(),
        uptime_seconds: state.started_at.elapsed().as_secs(),
        version: state.version,
        worker_id: state.worker_id.clone(),
    })
}
