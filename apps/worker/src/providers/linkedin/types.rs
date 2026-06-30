use serde_json::Value;

#[derive(Debug, Clone)]
pub(crate) struct LinkedInSearch {
    pub(crate) provider_id: String,
    pub(crate) query: Value,
    pub(crate) search_id: String,
}

#[derive(Debug, Clone)]
pub(crate) struct LinkedInSession {
    pub(crate) data: Value,
}

#[derive(Debug, Clone)]
pub(crate) struct LinkedInRequest {
    pub(crate) count: i32,
    pub(crate) request_params: Value,
    pub(crate) url: String,
}

#[derive(Debug, Clone)]
pub(crate) struct CollectedPage {
    pub(crate) content_type: Option<String>,
    pub(crate) elapsed_ms: Option<i32>,
    pub(crate) payload: Option<Value>,
    pub(crate) payload_text: Option<String>,
    pub(crate) request_params: Value,
    pub(crate) request_url: String,
    pub(crate) response_status: Option<i32>,
}

#[derive(Debug, Clone)]
pub(crate) struct NormalizedJob {
    pub(crate) company_name: String,
    pub(crate) employment_type: Option<String>,
    pub(crate) external_id: String,
    pub(crate) external_url: Option<String>,
    pub(crate) location_text: Option<String>,
    pub(crate) metadata: Value,
    pub(crate) published_at_ms: Option<i64>,
    pub(crate) seniority: Option<String>,
    pub(crate) title: String,
    pub(crate) workplace_type: Option<String>,
}

#[derive(Debug, Default)]
pub(crate) struct JobUpsertOutcome {
    pub(crate) created: bool,
}

#[derive(Debug, Default)]
pub(crate) struct LinkedInCollectStats {
    pub(crate) ai_reviews_queued: i32,
    pub(crate) availability_queued: i32,
    pub(crate) descriptions_queued: i32,
    pub(crate) jobs_created: i32,
    pub(crate) jobs_marked_missing: i32,
    pub(crate) jobs_seen: i32,
    pub(crate) jobs_updated: i32,
    pub(crate) pages_fetched: i32,
    pub(crate) raw_payloads: i32,
    pub(crate) total_results: Option<i32>,
}

#[derive(Debug, Clone)]
pub(crate) struct LinkedInDescriptionTarget {
    pub(crate) external_id: String,
    pub(crate) job_id: String,
    pub(crate) provider_id: String,
    pub(crate) url: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct DescriptionContent {
    pub(crate) html: Option<String>,
    pub(crate) text: String,
}

#[derive(Debug, Clone)]
pub(crate) struct LinkedInAvailabilityTarget {
    pub(crate) job_id: String,
    pub(crate) provider_id: String,
    pub(crate) url: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct AvailabilityCheckResult {
    pub(crate) http_status: Option<i32>,
    pub(crate) status: &'static str,
}
