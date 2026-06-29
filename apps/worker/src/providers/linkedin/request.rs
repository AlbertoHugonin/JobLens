use std::time::Instant;

use anyhow::{Context, Result};
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::util::{
    elapsed_millis_i32, read_json_bool, read_json_i32, read_json_string, read_json_string_array,
};

use super::{
    session::{build_linkedin_headers, read_session_decoration_id},
    types::{CollectedPage, LinkedInRequest, LinkedInSession},
};

const LINKEDIN_JOB_SEARCH_ORIGIN: &str = "JOB_SEARCH_PAGE_JOB_FILTER";
const PRESERVED_FILTERS: [(&str, &str); 2] = [("f_TPR", "timePostedRange"), ("f_JT", "jobType")];

pub(crate) fn build_linkedin_request(
    query: &Value,
    session: Option<&LinkedInSession>,
    start: i32,
    count: i32,
) -> Result<LinkedInRequest> {
    let voyager_query = build_linkedin_voyager_query(query)?;
    // JobSearchCardsCollection-220 returns the *rich* job cards (title, company,
    // location, posted date) that the parser needs (verified against real HAR
    // responses). The "Lite" variant returns near-empty cards, so a Lite id
    // captured from a HAR prefetch is ignored (see read_session_decoration_id).
    // Decoration ids can drift over time.
    let decoration_id = session
        .and_then(read_session_decoration_id)
        .unwrap_or_else(|| {
            "com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220".to_string()
        });
    let url = build_linkedin_job_cards_url(&decoration_id, &voyager_query, start, count);

    let request_params = json!({
        "count": count,
        "decorationId": decoration_id,
        "q": "jobSearch",
        "query": voyager_query,
        "start": start,
    });

    Ok(LinkedInRequest {
        count,
        request_params,
        url,
    })
}

pub(crate) fn build_linkedin_job_cards_url(
    decoration_id: &str,
    voyager_query: &str,
    start: i32,
    count: i32,
) -> String {
    format!(
        "https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards?count={count}&decorationId={decoration_id}&q=jobSearch&query={query}&start={start}",
        decoration_id = encode_linkedin_query_component(decoration_id),
        query = encode_linkedin_restli_query(voyager_query),
    )
}

fn encode_linkedin_query_component(value: &str) -> String {
    percent_encode(value, is_standard_query_char)
}

fn encode_linkedin_restli_query(value: &str) -> String {
    percent_encode(value, is_restli_query_char)
}

fn percent_encode(value: &str, is_allowed: fn(u8) -> bool) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::with_capacity(value.len());

    for byte in value.bytes() {
        if is_allowed(byte) {
            output.push(char::from(byte));
        } else {
            output.push('%');
            output.push(char::from(HEX[(byte >> 4) as usize]));
            output.push(char::from(HEX[(byte & 0x0F) as usize]));
        }
    }

    output
}

fn is_standard_query_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

fn is_restli_query_char(byte: u8) -> bool {
    is_standard_query_char(byte) || matches!(byte, b'(' | b')' | b',' | b':')
}

pub(crate) fn build_linkedin_voyager_query(query: &Value) -> Result<String> {
    let keywords = read_json_string(query, "keywords").context("LinkedIn keywords are required")?;
    let geo_id = read_json_string(query, "geoId").context("LinkedIn geoId is required")?;
    let exact_match = read_json_bool(query, "exactMatch").unwrap_or(false);
    let distance = read_json_string(query, "distance").unwrap_or_else(|| "25".to_string());
    let current_job_id = read_json_string(query, "currentJobId");
    let experience_levels = read_json_string_array(query, "experienceLevels");
    let workplace_types = read_json_string_array(query, "workplaceTypes");
    let keyword_value = if exact_match {
        format!("\"{}\"", keywords)
    } else {
        keywords
    };
    let mut selected_filters = vec![format!("distance:List({distance})")];

    if !experience_levels.is_empty() {
        selected_filters.push(format!("experience:List({})", experience_levels.join(",")));
    }

    if !workplace_types.is_empty() {
        selected_filters.push(format!("workplaceType:List({})", workplace_types.join(",")));
    }

    for (source_name, target_name) in PRESERVED_FILTERS {
        let values = read_preserved_filter_values(query, source_name);
        if !values.is_empty() {
            selected_filters.push(format!("{target_name}:List({})", values.join(",")));
        }
    }

    let mut parts = vec![
        // Matches browser job-card calls after public search filters are applied.
        format!("origin:{LINKEDIN_JOB_SEARCH_ORIGIN}"),
        format!("keywords:{keyword_value}"),
        format!("locationUnion:(geoId:{geo_id})"),
        format!("selectedFilters:({})", selected_filters.join(",")),
        "spellCorrectionEnabled:true".to_string(),
    ];

    if let Some(current_job_id) = current_job_id {
        parts.push(format!("currentJobId:{current_job_id}"));
    }

    Ok(format!("({})", parts.join(",")))
}

fn read_preserved_filter_values(query: &Value, key: &str) -> Vec<String> {
    query
        .get("preservedParams")
        .and_then(Value::as_object)
        .and_then(|params| params.get(key))
        .and_then(Value::as_str)
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) async fn fetch_linkedin_page(
    client: &reqwest::Client,
    session: &LinkedInSession,
    request: &LinkedInRequest,
) -> Result<CollectedPage> {
    let started = Instant::now();
    let response = client
        .get(&request.url)
        .headers(build_linkedin_headers(session)?)
        .send()
        .await
        .context("LinkedIn request failed")?;
    let status = i32::from(response.status().as_u16());
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let text = response
        .text()
        .await
        .context("read LinkedIn response failed")?;
    let payload = serde_json::from_str::<Value>(&text).ok();
    let payload_text = if payload.is_some() { None } else { Some(text) };

    Ok(CollectedPage {
        content_type,
        elapsed_ms: Some(elapsed_millis_i32(started)),
        payload,
        payload_text,
        request_params: request.request_params.clone(),
        request_url: request.url.clone(),
        response_status: Some(status),
    })
}

pub(crate) fn build_fixture_page(value: &Value, request: &LinkedInRequest) -> CollectedPage {
    let payload = value
        .get("payload")
        .cloned()
        .or_else(|| value.get("data").cloned())
        .unwrap_or_else(|| value.clone());

    CollectedPage {
        content_type: read_json_string(value, "contentType")
            .or_else(|| Some("application/json".to_string())),
        elapsed_ms: read_json_i32(value, "elapsedMs").or(Some(0)),
        payload: Some(payload),
        payload_text: None,
        request_params: request.request_params.clone(),
        request_url: request.url.clone(),
        response_status: read_json_i32(value, "status").or(Some(200)),
    }
}

pub(crate) fn read_fixture_pages(payload: &Value) -> Option<Vec<Value>> {
    payload
        .get("fixturePages")
        .or_else(|| payload.get("fixture_pages"))
        .and_then(Value::as_array)
        .map(|items| items.to_vec())
}

pub(crate) async fn insert_raw_payload(
    pool: &PgPool,
    provider_id: &str,
    activity_id: &str,
    page: &CollectedPage,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO raw_payloads(
          provider_id,
          activity_id,
          request_url,
          request_params,
          response_status,
          content_type,
          elapsed_ms,
          payload,
          payload_text
        )
        VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9)
        "#,
    )
    .bind(provider_id)
    .bind(activity_id)
    .bind(&page.request_url)
    .bind(&page.request_params)
    .bind(page.response_status)
    .bind(&page.content_type)
    .bind(page.elapsed_ms)
    .bind(page.payload.as_ref())
    .bind(&page.payload_text)
    .execute(pool)
    .await
    .context("insert raw LinkedIn payload failed")?;

    Ok(())
}
