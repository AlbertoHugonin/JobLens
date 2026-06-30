use std::{env, time::Duration};

use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct WorkerConfig {
    pub(crate) ai_review_cooldown: Duration,
    pub(crate) ai_review_max_attempts: u32,
    pub(crate) collection_page_delay: Duration,
    pub(crate) database_url: Option<String>,
    pub(crate) linkedin_availability_cooldown: Duration,
    pub(crate) linkedin_description_cooldown: Duration,
    pub(crate) dummy_duration: Duration,
    pub(crate) heartbeat_interval: Duration,
    pub(crate) host: String,
    pub(crate) lease_duration: Duration,
    pub(crate) poll_interval: Duration,
    pub(crate) port: u16,
    pub(crate) run_loop: bool,
    pub(crate) worker_id: String,
}

pub fn read_config() -> WorkerConfig {
    let host = env::var("WORKER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = read_u16("WORKER_PORT", 8090);
    let database_url = env::var("DATABASE_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let worker_id = env::var("WORKER_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("joblens-worker-{}", Uuid::new_v4()));

    WorkerConfig {
        // When an AI endpoint failure re-queues a review, ai_review claiming is
        // paused for this long so the queue waits instead of churning.
        ai_review_cooldown: read_duration_secs("WORKER_AI_COOLDOWN_SECONDS", 60),
        // Max claim attempts for a review that fails for non-connectivity reasons
        // before it is marked failed with a diagnostic review. Connectivity
        // failures (endpoint down) are not capped — they wait for it to return.
        ai_review_max_attempts: read_u32("WORKER_AI_MAX_REVIEW_ATTEMPTS", 3).max(1),
        // Gentle pacing between LinkedIn collection pages to avoid hammering the
        // API; set WORKER_LINKEDIN_PAGE_DELAY_MS=0 to disable.
        collection_page_delay: read_duration_ms("WORKER_LINKEDIN_PAGE_DELAY_MS", 1_200),
        database_url,
        // Cooldown between live LinkedIn availability checks. They may still
        // interleave with other work; this only spaces consecutive checks so
        // they don't fire back to back.
        linkedin_availability_cooldown: read_duration_ms(
            "WORKER_LINKEDIN_AVAILABILITY_COOLDOWN_MS",
            5_000,
        ),
        // LinkedIn job-description pages are fetched one at a time; this is the
        // cooldown before another live description fetch can be claimed.
        linkedin_description_cooldown: read_duration_ms(
            "WORKER_LINKEDIN_DESCRIPTION_COOLDOWN_MS",
            5_000,
        ),
        dummy_duration: read_duration_ms("WORKER_DUMMY_ACTIVITY_MS", 250),
        heartbeat_interval: read_duration_ms("WORKER_HEARTBEAT_MS", 1_000),
        host,
        lease_duration: read_duration_secs("WORKER_LEASE_SECONDS", 30),
        poll_interval: read_duration_ms("WORKER_POLL_MS", 1_000),
        port,
        run_loop: read_bool("WORKER_RUN_LOOP", true),
        worker_id,
    }
}

fn read_bool(key: &str, fallback: bool) -> bool {
    env::var(key)
        .ok()
        .map(|value| matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(fallback)
}

fn read_u16(key: &str, fallback: u16) -> u16 {
    env::var(key)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(fallback)
}

fn read_u32(key: &str, fallback: u32) -> u32 {
    env::var(key)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(fallback)
}

fn read_duration_ms(key: &str, fallback_ms: u64) -> Duration {
    Duration::from_millis(
        env::var(key)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(fallback_ms),
    )
}

fn read_duration_secs(key: &str, fallback_secs: u64) -> Duration {
    Duration::from_secs(
        env::var(key)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(fallback_secs),
    )
}
