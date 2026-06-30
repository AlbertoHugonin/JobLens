use std::time::Duration;

use super::*;

fn test_config(worker_id: &str) -> WorkerConfig {
    WorkerConfig {
        ai_review_cooldown: Duration::from_secs(60),
        ai_review_max_attempts: 3,
        collection_page_delay: Duration::ZERO,
        database_url: None,
        linkedin_availability_cooldown: Duration::ZERO,
        linkedin_description_cooldown: Duration::ZERO,
        dummy_duration: Duration::from_millis(100),
        heartbeat_interval: Duration::from_millis(25),
        host: "127.0.0.1".to_string(),
        lease_duration: Duration::from_secs(2),
        poll_interval: Duration::from_millis(10),
        port: 8090,
        run_loop: true,
        worker_id: worker_id.to_string(),
    }
}

mod db_integration;
mod unit;
