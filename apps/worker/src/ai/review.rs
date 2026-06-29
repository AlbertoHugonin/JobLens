use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub(crate) struct ReviewExternalJob {
    pub(crate) external_id: String,
    pub(crate) external_url: Option<String>,
    pub(crate) provider_key: String,
    pub(crate) provider_name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ReviewJobContext {
    pub(crate) company_name: String,
    pub(crate) description: Option<String>,
    pub(crate) employment_type: Option<String>,
    pub(crate) external_jobs: Vec<ReviewExternalJob>,
    pub(crate) id: String,
    pub(crate) location_text: Option<String>,
    pub(crate) provider_url: Option<String>,
    pub(crate) seniority: Option<String>,
    pub(crate) source_url: Option<String>,
    pub(crate) title: String,
    pub(crate) workplace_type: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct NormalizedReview {
    pub(crate) decision: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) result: Value,
    pub(crate) score: Option<i32>,
    pub(crate) status: &'static str,
}

const JSON_CONTRACT: &str = r#"Return exactly one JSON object and no markdown:
{
  "decision": "apply" | "maybe" | "reject",
  "score": 0-100,
  "seniority_fit": "good" | "borderline" | "bad",
  "skill_fit": "good" | "partial" | "bad",
  "location_fit": "good" | "partial" | "bad" | "unknown",
  "blockers": ["max 3 short strings"],
  "matching_points": ["max 3 short strings"],
  "explicit_optional_matches": ["max 3 short strings"],
  "mandatory_gaps": ["max 3 short strings"],
  "caution_notes": ["max 3 short strings"],
  "reason": "max 500 chars"
}"#;

pub(crate) fn build_review_prompt(profile: &str, rules: &str, job: &ReviewJobContext) -> String {
    let job_json = json!({
        "companyName": job.company_name,
        "description": job.description,
        "employmentType": job.employment_type,
        "externalJobs": job.external_jobs.iter().map(|item| json!({
            "externalId": item.external_id,
            "externalUrl": item.external_url,
            "providerKey": item.provider_key,
            "providerName": item.provider_name,
        })).collect::<Vec<_>>(),
        "id": job.id,
        "locationText": job.location_text,
        "providerUrl": job.provider_url,
        "seniority": job.seniority,
        "sourceUrl": job.source_url,
        "title": job.title,
        "workplaceType": job.workplace_type,
    });

    format!(
        "You are reviewing a job for one candidate.\n\nJSON contract:\n{JSON_CONTRACT}\n\nCandidate profile:\n{profile}\n\nEvaluation rules:\n{rules}\n\nJob offer JSON:\n{}\n\nReturn only the JSON object.",
        serde_json::to_string_pretty(&job_json).unwrap_or_else(|_| job_json.to_string())
    )
}

pub(crate) fn normalize_review_output(raw_output: &str) -> NormalizedReview {
    let parsed = match serde_json::from_str::<Value>(raw_output.trim()) {
        Ok(Value::Object(object)) => Value::Object(object),
        Ok(_) => {
            return failed_review("AI response JSON was not an object");
        }
        Err(error) => {
            return failed_review(&format!("AI response was not valid JSON: {error}"));
        }
    };

    let decision = normalize_decision(parsed.get("decision"));
    let score = normalize_score(parsed.get("score"));
    let result = json!({
        "decision": decision,
        "score": score,
        "seniority_fit": normalize_enum(parsed.get("seniority_fit"), &["good", "borderline", "bad"], "borderline"),
        "skill_fit": normalize_enum(parsed.get("skill_fit"), &["good", "partial", "bad"], "partial"),
        "location_fit": normalize_enum(parsed.get("location_fit"), &["good", "partial", "bad", "unknown"], "unknown"),
        "blockers": normalize_string_array(parsed.get("blockers")),
        "matching_points": normalize_string_array(parsed.get("matching_points")),
        "explicit_optional_matches": normalize_string_array(parsed.get("explicit_optional_matches")),
        "mandatory_gaps": normalize_string_array(parsed.get("mandatory_gaps")),
        "caution_notes": normalize_string_array(parsed.get("caution_notes")),
        "reason": truncate_string(read_string(parsed.get("reason")).unwrap_or_default(), 500),
    });

    NormalizedReview {
        decision: Some(decision),
        error: None,
        result,
        score,
        status: "success",
    }
}

pub(crate) fn diagnostic_review(error: &str) -> NormalizedReview {
    failed_review(error)
}

pub(crate) fn hash_text(value: &str) -> String {
    let hash = Sha256::digest(value.as_bytes());
    hash.iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn failed_review(error: &str) -> NormalizedReview {
    NormalizedReview {
        decision: None,
        error: Some(error.to_string()),
        result: json!({
            "diagnostic": error,
        }),
        score: None,
        status: "failed",
    }
}

fn normalize_decision(value: Option<&Value>) -> String {
    match read_string(value)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "apply" => "apply".to_string(),
        "reject" => "reject".to_string(),
        _ => "maybe".to_string(),
    }
}

fn normalize_score(value: Option<&Value>) -> Option<i32> {
    let score = value.and_then(|item| {
        item.as_i64()
            .or_else(|| item.as_f64().map(|number| number.round() as i64))
            .or_else(|| item.as_str()?.trim().parse::<i64>().ok())
    })?;

    Some(i32::try_from(score.clamp(0, 100)).unwrap_or(0))
}

fn normalize_enum(value: Option<&Value>, allowed: &[&str], fallback: &str) -> String {
    let normalized = read_string(value)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace('-', "_");
    if allowed.contains(&normalized.as_str()) {
        normalized
    } else {
        fallback.to_string()
    }
}

fn normalize_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| read_string(Some(item)))
                .map(|item| truncate_string(item, 240))
                .take(3)
                .collect()
        })
        .unwrap_or_default()
}

fn read_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn truncate_string(value: String, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}
