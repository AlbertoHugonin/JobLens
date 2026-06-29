use std::collections::HashMap;

use anyhow::Result;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};

use crate::util::read_json_string;

use super::types::{JobUpsertOutcome, NormalizedJob};

pub(crate) fn extract_total_results(payload: &Value) -> Option<i32> {
    payload
        .pointer("/data/paging/total")
        .or_else(|| payload.pointer("/paging/total"))
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
}

pub(crate) fn extract_jobs_from_payload(payload: &Value) -> Vec<NormalizedJob> {
    let mut jobs = HashMap::new();
    collect_normalized_jobs(payload, &mut jobs);

    jobs.into_values().collect()
}

fn collect_normalized_jobs(value: &Value, jobs: &mut HashMap<String, NormalizedJob>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_normalized_jobs(item, jobs);
            }
        }
        Value::Object(object) => {
            if let Some(job) = normalize_linkedin_job_object(value) {
                let should_replace = jobs
                    .get(&job.external_id)
                    .map(|existing| {
                        normalized_job_quality(&job) >= normalized_job_quality(existing)
                    })
                    .unwrap_or(true);

                if should_replace {
                    jobs.insert(job.external_id.clone(), job);
                }
            }

            for item in object.values() {
                collect_normalized_jobs(item, jobs);
            }
        }
        _ => {}
    }
}

fn normalize_linkedin_job_object(value: &Value) -> Option<NormalizedJob> {
    // Only treat job posting / job card entities as jobs. Without this gate the
    // container CollectionResponse (and other auxiliary records that happen to
    // carry searchable text and a digit-bearing urn) produced a phantom job.
    if let Some(type_name) = read_json_string(value, "$type") {
        let lower = type_name.to_ascii_lowercase();
        if !lower.contains("jobposting") && !lower.contains("jobcard") {
            return None;
        }
    }

    let external_id = find_external_job_id(value)?;
    let title = find_string_for_keys(value, &["jobPostingTitle", "title", "jobTitle"]);
    let company_name = find_string_for_keys(
        value,
        &[
            "companyName",
            "company",
            "companyDisplayName",
            "primaryDescription",
        ],
    );
    let location_text =
        find_string_for_keys(value, &["formattedLocation", "location", "locationName"])
            .or_else(|| find_string_for_keys(value, &["secondaryDescription"]));

    if title.is_none() && company_name.is_none() && location_text.is_none() {
        return None;
    }

    let external_url = find_string_for_keys(value, &["jobPostingUrl", "externalUrl", "url"])
        .or_else(|| Some(format!("https://www.linkedin.com/jobs/view/{external_id}/")));
    let workplace_type =
        find_string_for_keys(value, &["workplaceType", "workplace"]).or_else(|| {
            location_text
                .as_deref()
                .and_then(extract_parenthesized_suffix)
        });
    let employment_type = find_string_for_keys(value, &["employmentType", "jobType"]);
    let seniority = find_string_for_keys(value, &["seniority", "experienceLevel"]);
    let published_at_ms =
        find_i64_for_keys(value, &["listedAt", "publishedAt", "originalListedAt"])
            .or_else(|| find_footer_time_at(value));
    let title = title.unwrap_or_else(|| format!("LinkedIn job {external_id}"));

    Some(NormalizedJob {
        company_name: company_name.unwrap_or_else(|| "Unknown company".to_string()),
        employment_type,
        external_id,
        external_url,
        location_text,
        metadata: json!({
            "provider": "linkedin",
            "rawCard": value,
        }),
        published_at_ms,
        seniority,
        title,
        workplace_type,
    })
}

fn normalized_job_quality(job: &NormalizedJob) -> i32 {
    let mut quality = 0;

    if !job.title.starts_with("LinkedIn job ") {
        quality += 4;
    }
    if job.company_name != "Unknown company" {
        quality += 3;
    }
    if job.location_text.is_some() {
        quality += 2;
    }
    if job.published_at_ms.is_some() {
        quality += 1;
    }

    quality
}

pub(crate) fn find_string_for_keys(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(found) = object.get(*key).and_then(read_text_value) {
                    return Some(found);
                }
            }

            for child in object.values() {
                if let Some(found) = find_string_for_keys(child, keys) {
                    return Some(found);
                }
            }

            None
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_string_for_keys(item, keys)),
        _ => None,
    }
}

fn find_external_job_id(value: &Value) -> Option<String> {
    for key in ["jobPostingId", "jobId", "listedJobPostingId"] {
        if let Some(id) = read_json_string(value, key) {
            return Some(id);
        }
        if let Some(id) = value.get(key).and_then(Value::as_i64) {
            return Some(id.to_string());
        }
    }

    for key in [
        "entityUrn",
        "dashEntityUrn",
        "jobPosting",
        "jobPostingUrn",
        "trackingUrn",
    ] {
        if let Some(value) =
            read_json_string(value, key).and_then(|text| extract_digits_from_urn(&text))
        {
            return Some(value);
        }
    }

    None
}

fn extract_digits_from_urn(value: &str) -> Option<String> {
    let mut current = String::new();
    let mut last = None;

    for character in value.chars() {
        if character.is_ascii_digit() {
            current.push(character);
        } else if !current.is_empty() {
            last = Some(current.clone());
            current.clear();
        }
    }

    if !current.is_empty() {
        last = Some(current);
    }

    last
}

fn read_text_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.trim().to_string()).filter(|text| !text.is_empty()),
        Value::Object(object) => object
            .get("text")
            .or_else(|| object.get("value"))
            .or_else(|| object.get("accessibilityText"))
            .and_then(read_text_value),
        _ => None,
    }
}

fn find_i64_for_keys(value: &Value, keys: &[&str]) -> Option<i64> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(found) = object.get(*key).and_then(read_i64_value) {
                    return Some(found);
                }
            }

            for child in object.values() {
                if let Some(found) = find_i64_for_keys(child, keys) {
                    return Some(found);
                }
            }

            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_i64_for_keys(item, keys)),
        _ => None,
    }
}

fn read_i64_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
}

fn find_footer_time_at(value: &Value) -> Option<i64> {
    value
        .get("footerItems")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|item| match item.get("type").and_then(Value::as_str) {
            Some("LISTED_DATE") => item.get("timeAt").and_then(read_i64_value),
            _ => None,
        })
        .next()
}

fn extract_parenthesized_suffix(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let start = trimmed.rfind('(')?;

    if !trimmed.ends_with(')') || start + 1 >= trimmed.len() - 1 {
        return None;
    }

    Some(trimmed[start + 1..trimmed.len() - 1].trim().to_string()).filter(|text| !text.is_empty())
}

pub(crate) async fn upsert_linkedin_job(
    pool: &PgPool,
    provider_id: &str,
    search_id: &str,
    activity_id: &str,
    job: &NormalizedJob,
) -> Result<JobUpsertOutcome> {
    let mut tx = pool.begin().await?;
    let existing = sqlx::query(
        r#"
        SELECT id::text AS external_job_id, job_id::text AS job_id
        FROM external_jobs
        WHERE provider_id = $1::uuid AND external_id = $2
        FOR UPDATE
        "#,
    )
    .bind(provider_id)
    .bind(&job.external_id)
    .fetch_optional(&mut *tx)
    .await?;
    let created;
    let job_id: String;

    if let Some(row) = existing {
        created = false;
        job_id = row.try_get("job_id")?;
        sqlx::query(
            r#"
            UPDATE jobs
            SET
              title = $2,
              company_name = $3,
              location_text = $4,
              workplace_type = $5,
              employment_type = $6,
              seniority = $7,
              published_at = COALESCE(to_timestamp($8::double precision / 1000), published_at),
              source_url = $9,
              provider_url = $9,
              availability_status = 'active',
              metadata = metadata || $10::jsonb
            WHERE id = $1::uuid
            "#,
        )
        .bind(&job_id)
        .bind(&job.title)
        .bind(&job.company_name)
        .bind(&job.location_text)
        .bind(&job.workplace_type)
        .bind(&job.employment_type)
        .bind(&job.seniority)
        .bind(job.published_at_ms)
        .bind(&job.external_url)
        .bind(&job.metadata)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            UPDATE external_jobs
            SET external_url = $3, metadata = metadata || $4::jsonb, last_seen_at = now()
            WHERE provider_id = $1::uuid AND external_id = $2
            "#,
        )
        .bind(provider_id)
        .bind(&job.external_id)
        .bind(&job.external_url)
        .bind(&job.metadata)
        .execute(&mut *tx)
        .await?;
    } else {
        created = true;
        let row = sqlx::query(
            r#"
            INSERT INTO jobs(
              title,
              company_name,
              location_text,
              workplace_type,
              employment_type,
              seniority,
              published_at,
              source_url,
              provider_url,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7::double precision / 1000), $8, $8, $9::jsonb)
            RETURNING id::text AS id
            "#,
        )
        .bind(&job.title)
        .bind(&job.company_name)
        .bind(&job.location_text)
        .bind(&job.workplace_type)
        .bind(&job.employment_type)
        .bind(&job.seniority)
        .bind(job.published_at_ms)
        .bind(&job.external_url)
        .bind(&job.metadata)
        .fetch_one(&mut *tx)
        .await?;
        job_id = row.try_get("id")?;
        sqlx::query(
            r#"
            INSERT INTO external_jobs(provider_id, job_id, external_id, external_url, metadata)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
            "#,
        )
        .bind(provider_id)
        .bind(&job_id)
        .bind(&job.external_id)
        .bind(&job.external_url)
        .bind(&job.metadata)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO job_search_presence(job_id, search_id, last_activity_id, metadata)
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb)
        ON CONFLICT (job_id, search_id) DO UPDATE
        SET
          last_seen_at = now(),
          last_activity_id = EXCLUDED.last_activity_id,
          metadata = job_search_presence.metadata || EXCLUDED.metadata
        "#,
    )
    .bind(&job_id)
    .bind(search_id)
    .bind(activity_id)
    .bind(json!({
        "externalId": job.external_id,
        "provider": "linkedin",
    }))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(JobUpsertOutcome { created })
}
