use std::collections::HashSet;

use serde_json::{Map, Value, json};
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

#[derive(Debug, Clone)]
pub(crate) struct ReviewField {
    pub(crate) description: String,
    pub(crate) enabled: bool,
    pub(crate) key: String,
    pub(crate) label: String,
    pub(crate) max_items: usize,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum ReviewOutputLanguage {
    English,
    Italian,
    JobLanguage,
    ProfileLanguage,
}

impl ReviewOutputLanguage {
    pub(crate) fn as_key(self) -> &'static str {
        match self {
            ReviewOutputLanguage::English => "en",
            ReviewOutputLanguage::Italian => "it",
            ReviewOutputLanguage::JobLanguage => "job_language",
            ReviewOutputLanguage::ProfileLanguage => "profile_language",
        }
    }
}

pub(crate) fn default_review_fields() -> Vec<ReviewField> {
    vec![
        ReviewField {
            description: "Only true deal-breakers.".to_string(),
            enabled: true,
            key: "blockers".to_string(),
            label: "Bloccanti".to_string(),
            max_items: 3,
        },
        ReviewField {
            description: "Direct matches between the candidate profile and the offer.".to_string(),
            enabled: true,
            key: "matching_points".to_string(),
            label: "Punti di match".to_string(),
            max_items: 3,
        },
        ReviewField {
            description: "Optional or preferred items explicitly mentioned in the offer and present in the profile.".to_string(),
            enabled: true,
            key: "explicit_optional_matches".to_string(),
            label: "Match opzionali".to_string(),
            max_items: 3,
        },
        ReviewField {
            description: "Only missing mandatory or core requirements.".to_string(),
            enabled: true,
            key: "mandatory_gaps".to_string(),
            label: "Gap obbligatori".to_string(),
            max_items: 3,
        },
        ReviewField {
            description: "Real but non-blocking concerns, weak evidence or partial fit.".to_string(),
            enabled: true,
            key: "caution_notes".to_string(),
            label: "Note di attenzione".to_string(),
            max_items: 3,
        },
    ]
}

pub(crate) fn normalize_review_output_language(value: Option<&Value>) -> ReviewOutputLanguage {
    match value.and_then(Value::as_str).map(str::trim) {
        Some("en") => ReviewOutputLanguage::English,
        Some("job_language") => ReviewOutputLanguage::JobLanguage,
        Some("profile_language") => ReviewOutputLanguage::ProfileLanguage,
        _ => ReviewOutputLanguage::Italian,
    }
}

pub(crate) fn normalize_review_fields(value: Option<&Value>) -> Vec<ReviewField> {
    let Some(Value::Array(items)) = value else {
        return default_review_fields();
    };

    let mut seen = HashSet::new();
    let mut fields = Vec::new();

    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        let key = object
            .get("key")
            .and_then(Value::as_str)
            .map(normalize_field_key)
            .unwrap_or_default();

        if key.len() < 2
            || is_reserved_field_key(&key)
            || !key
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_lowercase())
            || !key.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
            })
            || !seen.insert(key.clone())
        {
            continue;
        }

        fields.push(ReviewField {
            description: object
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .chars()
                .take(500)
                .collect(),
            enabled: object
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            label: object
                .get("label")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(80).collect())
                .unwrap_or_else(|| humanize_field_key(&key)),
            max_items: object
                .get("maxItems")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(3)
                .clamp(1, 10),
            key,
        });
    }

    if fields.is_empty() {
        default_review_fields()
    } else {
        fields
    }
}

pub(crate) fn review_fields_json(fields: &[ReviewField]) -> Value {
    Value::Array(
        fields
            .iter()
            .map(|field| {
                json!({
                    "description": field.description,
                    "enabled": field.enabled,
                    "key": field.key,
                    "label": field.label,
                    "maxItems": field.max_items,
                })
            })
            .collect(),
    )
}

pub(crate) fn review_json_schema(fields: &[ReviewField]) -> Value {
    let short_string = json!({
        "maxLength": 220,
        "type": "string",
    });
    let mut properties = Map::new();
    properties.insert(
        "decision".to_string(),
        json!({
            "enum": ["apply", "maybe", "reject"],
            "type": "string",
        }),
    );
    properties.insert(
        "score".to_string(),
        json!({
            "maximum": 100,
            "minimum": 0,
            "type": "integer",
        }),
    );
    properties.insert(
        "seniority_fit".to_string(),
        json!({
            "enum": ["good", "borderline", "bad"],
            "type": "string",
        }),
    );
    properties.insert(
        "skill_fit".to_string(),
        json!({
            "enum": ["good", "partial", "bad"],
            "type": "string",
        }),
    );
    properties.insert(
        "location_fit".to_string(),
        json!({
            "enum": ["good", "partial", "bad", "unknown"],
            "type": "string",
        }),
    );

    let mut required = vec![
        json!("decision"),
        json!("score"),
        json!("seniority_fit"),
        json!("skill_fit"),
        json!("location_fit"),
    ];
    for field in active_review_fields(fields) {
        properties.insert(
            field.key.clone(),
            json!({
                "default": [],
                "items": short_string,
                "maxItems": field.max_items,
                "type": "array",
            }),
        );
        required.push(json!(field.key.clone()));
    }
    properties.insert(
        "reason".to_string(),
        json!({
            "maxLength": 500,
            "type": "string",
        }),
    );
    required.push(json!("reason"));

    json!({
        "additionalProperties": false,
        "properties": properties,
        "required": required,
        "type": "object",
    })
}

pub(crate) fn build_review_prompt(
    profile: &str,
    rules: &str,
    job: &ReviewJobContext,
    output_language: ReviewOutputLanguage,
    fields: &[ReviewField],
) -> String {
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
    let json_contract = build_json_contract(fields);
    let language_instruction = build_language_instruction(output_language, fields);

    format!(
        "You are reviewing a job for one candidate.\n\nJSON contract:\n{json_contract}\n\n{language_instruction}\n\nCandidate profile:\n{profile}\n\nEvaluation rules:\n{rules}\n\nJob offer JSON:\n{}\n\nReturn only the JSON object.",
        serde_json::to_string_pretty(&job_json).unwrap_or_else(|_| job_json.to_string())
    )
}

pub(crate) fn normalize_review_output(
    raw_output: &str,
    fields: &[ReviewField],
) -> NormalizedReview {
    let parsed = match parse_review_json(raw_output) {
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
    let mut result = Map::new();
    result.insert("decision".to_string(), json!(decision));
    result.insert("score".to_string(), json!(score));
    result.insert(
        "seniority_fit".to_string(),
        json!(normalize_enum(
            parsed.get("seniority_fit"),
            &["good", "borderline", "bad"],
            "borderline",
        )),
    );
    result.insert(
        "skill_fit".to_string(),
        json!(normalize_enum(
            parsed.get("skill_fit"),
            &["good", "partial", "bad"],
            "partial",
        )),
    );
    result.insert(
        "location_fit".to_string(),
        json!(normalize_enum(
            parsed.get("location_fit"),
            &["good", "partial", "bad", "unknown"],
            "unknown",
        )),
    );
    for field in active_review_fields(fields) {
        result.insert(
            field.key.clone(),
            json!(normalize_string_array(
                parsed.get(&field.key),
                field.max_items
            )),
        );
    }
    result.insert(
        "reason".to_string(),
        json!(truncate_string(
            read_string(parsed.get("reason")).unwrap_or_default(),
            500,
        )),
    );

    NormalizedReview {
        decision: Some(decision),
        error: None,
        result: Value::Object(result),
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

fn active_review_fields(fields: &[ReviewField]) -> Vec<&ReviewField> {
    fields.iter().filter(|field| field.enabled).collect()
}

fn build_json_contract(fields: &[ReviewField]) -> String {
    let mut entries = vec![
        r#"  "decision": "apply" | "maybe" | "reject""#.to_string(),
        r#"  "score": 0-100"#.to_string(),
        r#"  "seniority_fit": "good" | "borderline" | "bad""#.to_string(),
        r#"  "skill_fit": "good" | "partial" | "bad""#.to_string(),
        r#"  "location_fit": "good" | "partial" | "bad" | "unknown""#.to_string(),
    ];

    for field in active_review_fields(fields) {
        let hint = if field.description.trim().is_empty() {
            format!("max {} short strings", field.max_items)
        } else {
            format!(
                "max {} short strings; {}",
                field.max_items,
                compact_prompt_text(&field.description)
            )
        };
        entries.push(format!(
            "  \"{}\": [{}]",
            field.key,
            serde_json::to_string(&hint).unwrap_or_else(|_| "\"max short strings\"".to_string())
        ));
    }

    entries.push(r#"  "reason": "max 500 chars""#.to_string());

    let mut output = String::from("Return exactly one JSON object and no markdown:\n{\n");
    for (index, entry) in entries.iter().enumerate() {
        output.push_str(entry);
        if index + 1 < entries.len() {
            output.push(',');
        }
        output.push('\n');
    }
    output.push('}');
    output
}

fn build_language_instruction(
    output_language: ReviewOutputLanguage,
    fields: &[ReviewField],
) -> String {
    let mut free_text_fields = vec!["reason".to_string()];
    free_text_fields.extend(
        active_review_fields(fields)
            .into_iter()
            .map(|field| field.key.clone()),
    );
    let target = match output_language {
        ReviewOutputLanguage::English => "English".to_string(),
        ReviewOutputLanguage::Italian => "Italian".to_string(),
        ReviewOutputLanguage::JobLanguage => {
            "the same language used by the job offer; if unclear, use English".to_string()
        }
        ReviewOutputLanguage::ProfileLanguage => {
            "the same language used by the candidate profile; if unclear, use English".to_string()
        }
    };

    format!(
        "Language:\nWrite every free-text value ({}) in {target}. Keep enum fields (decision, seniority_fit, skill_fit, location_fit) exactly as the lowercase English keywords listed in the JSON contract.",
        free_text_fields.join(", "),
    )
}

fn compact_prompt_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_field_key(value: &str) -> String {
    let mut key = String::new();
    let mut previous_was_underscore = false;

    for character in value.trim().chars() {
        let normalized = character.to_ascii_lowercase();
        if normalized.is_ascii_alphanumeric() {
            key.push(normalized);
            previous_was_underscore = false;
        } else if !previous_was_underscore {
            key.push('_');
            previous_was_underscore = true;
        }
        if key.len() >= 60 {
            break;
        }
    }

    key.trim_matches('_').to_string()
}

fn humanize_field_key(key: &str) -> String {
    key.split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_reserved_field_key(key: &str) -> bool {
    matches!(
        key,
        "decision"
            | "diagnostic"
            | "location_fit"
            | "missing_skills"
            | "optional_strengths"
            | "reason"
            | "score"
            | "seniority_fit"
            | "skill_fit"
    )
}

fn parse_review_json(raw_output: &str) -> Result<Value, String> {
    let cleaned = strip_markdown_fence(raw_output.trim());
    if cleaned.is_empty() {
        return Err("empty response".to_string());
    }

    match serde_json::from_str::<Value>(&cleaned) {
        Ok(value) => return Ok(value),
        Err(error) if cleaned == "{" || cleaned == "[" => {
            return Err(format!("truncated JSON ({error})"));
        }
        Err(_) => {}
    }

    let Some(candidate) = extract_first_json_object(&cleaned) else {
        return Err("no JSON object found".to_string());
    };

    serde_json::from_str::<Value>(candidate).map_err(|error| error.to_string())
}

fn strip_markdown_fence(value: &str) -> String {
    let trimmed = value.trim();
    let Some(after_opening) = trimmed.strip_prefix("```") else {
        return trimmed.to_string();
    };

    let content = after_opening
        .split_once('\n')
        .map(|(_, rest)| rest)
        .unwrap_or(after_opening)
        .trim();
    content
        .strip_suffix("```")
        .unwrap_or(content)
        .trim()
        .to_string()
}

fn extract_first_json_object(value: &str) -> Option<&str> {
    let start = value.find('{')?;
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, character) in value[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }

        match character {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let end = start + offset + character.len_utf8();
                    return Some(&value[start..end]);
                }
            }
            _ => {}
        }
    }

    None
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

fn normalize_string_array(value: Option<&Value>, max_items: usize) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| read_string(Some(item)))
            .map(|item| truncate_string(item, 240))
            .take(max_items)
            .collect(),
        Some(Value::String(_)) => read_string(value)
            .map(|item| vec![truncate_string(item, 240)])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_schema_requires_canonical_fields_only() {
        let fields = default_review_fields();
        let schema = review_json_schema(&fields);

        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert!(
            schema["required"]
                .as_array()
                .expect("required fields")
                .contains(&json!("mandatory_gaps"))
        );
        assert!(schema["properties"].get("missing_skills").is_none());
        assert!(schema["properties"].get("optional_strengths").is_none());
    }

    #[test]
    fn normalize_review_output_recovers_json_from_markdown_or_text() {
        let fields = default_review_fields();
        let raw = r#"Here is the review:
```json
{
  "decision": "apply",
  "score": "91",
  "seniority_fit": "good",
  "skill_fit": "good",
  "location_fit": "good",
  "blockers": [],
  "matching_points": "Rust backend",
  "explicit_optional_matches": [],
  "mandatory_gaps": [],
  "caution_notes": [],
  "reason": "Fit concreto"
}
```
Thanks."#;

        let review = normalize_review_output(raw, &fields);

        assert_eq!(review.status, "success");
        assert_eq!(review.decision.as_deref(), Some("apply"));
        assert_eq!(review.score, Some(91));
        assert_eq!(review.result["matching_points"], json!(["Rust backend"]));
    }

    #[test]
    fn normalize_review_output_rejects_non_json_output() {
        let fields = default_review_fields();
        let review = normalize_review_output("this is not json", &fields);

        assert_eq!(review.status, "failed");
        assert!(
            review
                .error
                .as_deref()
                .expect("error")
                .contains("not valid JSON")
        );
    }

    #[test]
    fn dynamic_review_fields_drive_schema_prompt_and_normalization() {
        let fields = normalize_review_fields(Some(&json!([
            {
                "description": "Reasons the role can grow the candidate.",
                "enabled": true,
                "key": "growth-opportunities",
                "label": "Growth opportunities",
                "maxItems": 2
            },
            {
                "description": "Disabled field.",
                "enabled": false,
                "key": "disabled_notes",
                "label": "Disabled notes",
                "maxItems": 3
            }
        ])));
        let schema = review_json_schema(&fields);
        let prompt = build_language_instruction(ReviewOutputLanguage::English, &fields);
        let review = normalize_review_output(
            r#"{
              "decision": "maybe",
              "score": 70,
              "seniority_fit": "borderline",
              "skill_fit": "partial",
              "location_fit": "unknown",
              "growth_opportunities": ["Rust ownership", "Platform scope", "Ignored extra"],
              "reason": "Useful but unclear."
            }"#,
            &fields,
        );

        assert!(
            schema["required"]
                .as_array()
                .unwrap()
                .contains(&json!("growth_opportunities"))
        );
        assert!(
            !schema["required"]
                .as_array()
                .unwrap()
                .contains(&json!("disabled_notes"))
        );
        assert!(prompt.contains("growth_opportunities"));
        assert_eq!(
            review.result["growth_opportunities"],
            json!(["Rust ownership", "Platform scope"])
        );
        assert!(review.result.get("disabled_notes").is_none());
    }
}
