use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tracing_subscriber::EnvFilter;

#[derive(Debug, Default)]
pub struct WorkerMetrics {
    pub(crate) activities_cancelled: AtomicU64,
    pub(crate) activities_claimed: AtomicU64,
    pub(crate) activities_failed: AtomicU64,
    pub(crate) activities_interrupted: AtomicU64,
    pub(crate) activities_succeeded: AtomicU64,
    pub(crate) claim_errors: AtomicU64,
    pub(crate) heartbeats: AtomicU64,
    pub(crate) unsupported_activities: AtomicU64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetricsSnapshot {
    activities_cancelled: u64,
    activities_claimed: u64,
    activities_failed: u64,
    activities_interrupted: u64,
    activities_succeeded: u64,
    claim_errors: u64,
    heartbeats: u64,
    unsupported_activities: u64,
}

pub(crate) fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
}

pub(crate) fn build_metrics_snapshot(metrics: &WorkerMetrics) -> MetricsSnapshot {
    MetricsSnapshot {
        activities_cancelled: metrics.activities_cancelled.load(Ordering::Relaxed),
        activities_claimed: metrics.activities_claimed.load(Ordering::Relaxed),
        activities_failed: metrics.activities_failed.load(Ordering::Relaxed),
        activities_interrupted: metrics.activities_interrupted.load(Ordering::Relaxed),
        activities_succeeded: metrics.activities_succeeded.load(Ordering::Relaxed),
        claim_errors: metrics.claim_errors.load(Ordering::Relaxed),
        heartbeats: metrics.heartbeats.load(Ordering::Relaxed),
        unsupported_activities: metrics.unsupported_activities.load(Ordering::Relaxed),
    }
}

pub(crate) fn utc_timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
