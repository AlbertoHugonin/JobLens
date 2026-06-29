use axum::{Json, extract::State};
use serde::Serialize;

use super::AppState;
use crate::telemetry::utc_timestamp;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HealthResponse {
    pub(crate) database_configured: bool,
    pub(crate) loop_enabled: bool,
    pub(crate) service: &'static str,
    pub(crate) status: &'static str,
    pub(crate) timestamp: String,
    pub(crate) uptime_seconds: u64,
    pub(crate) version: &'static str,
    pub(crate) worker_id: String,
}

pub(crate) fn build_health_response(state: &AppState) -> HealthResponse {
    HealthResponse {
        database_configured: state.database_configured,
        loop_enabled: state.run_loop,
        service: "worker",
        status: "ok",
        timestamp: utc_timestamp(),
        uptime_seconds: state.started_at.elapsed().as_secs(),
        version: state.version,
        worker_id: state.worker_id.clone(),
    }
}

pub(crate) async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(build_health_response(&state))
}
