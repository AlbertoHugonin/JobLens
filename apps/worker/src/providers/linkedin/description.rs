use std::sync::atomic::Ordering;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tokio::sync::watch;

use crate::{
    activities::{
        ClaimedActivity, HeartbeatOutcome, heartbeat_activity, insert_activity_log,
        mark_activity_cancelled, mark_activity_interrupted, mark_activity_succeeded,
    },
    config::WorkerConfig,
    telemetry::WorkerMetrics,
    util::{duration_as_i64_seconds, read_json_i32, read_json_string},
};

use super::{
    jobs::find_string_for_keys,
    session::{linkedin_user_agent, read_optional_active_linkedin_session},
    text::{description_content_hash, normalize_description_text, strip_html_to_text},
    types::{DescriptionContent, LinkedInDescriptionTarget},
};

pub(crate) async fn run_describe_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    if *shutdown_rx.borrow() {
        mark_activity_interrupted(pool, config, &activity.id, "Worker shutdown requested").await?;
        metrics
            .activities_interrupted
            .fetch_add(1, Ordering::Relaxed);
        return Ok(());
    }

    match heartbeat_activity(
        pool,
        config,
        &activity.id,
        "describing",
        "Fetching LinkedIn job description",
        0,
        1,
    )
    .await?
    {
        HeartbeatOutcome::Running => {}
        HeartbeatOutcome::CancelRequested => {
            mark_activity_cancelled(pool, config, &activity.id).await?;
            metrics.activities_cancelled.fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }
        HeartbeatOutcome::LeaseLost => return Err(anyhow!("activity lease was lost")),
    }

    let target = read_linkedin_description_target(pool, activity).await?;
    let session = read_optional_active_linkedin_session(pool, &target.provider_id).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(linkedin_user_agent(session.as_ref()))
        .build()
        .context("cannot build LinkedIn description HTTP client")?;
    let content = match read_fixture_description(&activity.payload) {
        Some(content) => content?,
        None => fetch_linkedin_description(&client, &target).await?,
    };
    let normalized_text = normalize_description_text(&content.text);

    if normalized_text.is_empty() {
        return Err(anyhow!("LinkedIn description text is empty"));
    }

    let content_hash = description_content_hash(&normalized_text);
    let inserted = insert_job_description(
        pool,
        &target.job_id,
        &content_hash,
        content.html.as_deref(),
        &normalized_text,
        &target.external_id,
        &activity.id,
    )
    .await?;

    update_linkedin_description_progress(pool, config, &activity.id, inserted, &content_hash)
        .await?;
    insert_activity_log(
        pool,
        &activity.id,
        "info",
        "Stored LinkedIn job description",
        json!({
            "contentHash": content_hash,
            "inserted": inserted,
            "jobId": target.job_id,
        }),
    )
    .await?;
    mark_activity_succeeded(pool, config, &activity.id).await?;
    metrics.activities_succeeded.fetch_add(1, Ordering::Relaxed);

    Ok(())
}

async fn read_linkedin_description_target(
    pool: &PgPool,
    activity: &ClaimedActivity,
) -> Result<LinkedInDescriptionTarget> {
    let job_id = activity
        .subject_id
        .clone()
        .or_else(|| read_json_string(&activity.payload, "jobId"))
        .context("linkedin_describe activity is missing job id")?;
    let row = sqlx::query(
        r#"
        SELECT
          jobs.id::text AS job_id,
          providers.id::text AS provider_id,
          external_jobs.external_id,
          COALESCE(external_jobs.external_url, jobs.provider_url, jobs.source_url) AS url
        FROM jobs
        JOIN external_jobs ON external_jobs.job_id = jobs.id
        JOIN providers ON providers.id = external_jobs.provider_id
        WHERE jobs.id = $1::uuid
          AND providers.provider_key = 'linkedin'
        ORDER BY external_jobs.created_at ASC
        LIMIT 1
        "#,
    )
    .bind(&job_id)
    .fetch_optional(pool)
    .await
    .context("read LinkedIn description target failed")?
    .context("LinkedIn job target was not found")?;

    Ok(LinkedInDescriptionTarget {
        external_id: row.try_get("external_id")?,
        job_id: row.try_get("job_id")?,
        provider_id: row.try_get("provider_id")?,
        url: row.try_get("url")?,
    })
}

fn read_fixture_description(payload: &Value) -> Option<Result<DescriptionContent>> {
    let fixture = payload
        .get("fixtureDescription")
        .or_else(|| payload.get("fixture_description"))?;

    Some(match fixture {
        Value::String(text) => Ok(DescriptionContent {
            html: None,
            text: text.clone(),
        }),
        Value::Object(_) => {
            if let Some(status) = read_json_i32(fixture, "status")
                && !(200..300).contains(&status)
            {
                return Some(Err(anyhow!(
                    "LinkedIn description fixture failed with HTTP {status}"
                )));
            }

            let html = read_json_string(fixture, "html");
            let text = read_json_string(fixture, "text")
                .or_else(|| html.as_deref().map(strip_html_to_text))
                .context("LinkedIn description fixture is missing text");

            text.map(|text| DescriptionContent { html, text })
        }
        _ => Err(anyhow!("LinkedIn description fixture is invalid")),
    })
}

async fn fetch_linkedin_description(
    client: &reqwest::Client,
    target: &LinkedInDescriptionTarget,
) -> Result<DescriptionContent> {
    let url = target.url.as_ref().context("LinkedIn job URL is missing")?;
    let mut urls = vec![format!(
        "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{}",
        target.external_id
    )];

    if !urls.iter().any(|candidate| candidate == url) {
        urls.push(url.to_string());
    }

    let mut last_error = None;

    for description_url in urls {
        match fetch_linkedin_description_url(client, &description_url).await {
            Ok(content) => return Ok(content),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow!("LinkedIn description URL is missing")))
}

async fn fetch_linkedin_description_url(
    client: &reqwest::Client,
    url: &str,
) -> Result<DescriptionContent> {
    let response = client
        .get(url)
        .send()
        .await
        .context("LinkedIn description request failed")?;
    let status = i32::from(response.status().as_u16());
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let text = response
        .text()
        .await
        .context("read LinkedIn description response failed")?;

    if !(200..300).contains(&status) {
        return Err(anyhow!("LinkedIn description failed with HTTP {status}"));
    }

    let description_text = extract_linkedin_description_text(&text);
    let html = content_type
        .as_deref()
        .filter(|value| value.contains("html"))
        .map(|_| text);

    Ok(DescriptionContent {
        html,
        text: description_text,
    })
}

fn extract_linkedin_description_text(text: &str) -> String {
    let parsed = serde_json::from_str::<Value>(text).ok();
    if let Some(description) = parsed.as_ref().and_then(|value| {
        find_string_for_keys(value, &["description", "jobDescription", "descriptionText"])
    }) {
        // LinkedIn often returns the description field as HTML even inside JSON;
        // strip it so the AI receives plain text, not markup.
        return strip_html_to_text(&description);
    }

    let mut sections = Vec::new();
    if let Some(description) = extract_html_block_by_class(text, "show-more-less-html__markup") {
        sections.push(strip_html_to_text(&description));
    }
    if let Some(criteria) = extract_html_block_by_class(text, "description__job-criteria-list") {
        sections.push(strip_html_to_text(&criteria));
    }

    if sections.is_empty() {
        strip_html_to_text(text)
    } else {
        sections.join("\n\n")
    }
}

fn extract_html_block_by_class(html: &str, class_name: &str) -> Option<String> {
    let class_index = html.find(class_name)?;
    let tag_start = html[..class_index].rfind('<')?;
    let tag_end = class_index + html[class_index..].find('>')?;
    let tag_name = html[tag_start + 1..tag_end]
        .split_whitespace()
        .next()?
        .trim_start_matches('/');

    if tag_name.is_empty() {
        return None;
    }

    let end_tag = format!("</{tag_name}>");
    let body_end = tag_end + html[tag_end..].find(&end_tag)? + end_tag.len();

    Some(html[tag_start..body_end].to_string())
}

async fn insert_job_description(
    pool: &PgPool,
    job_id: &str,
    content_hash: &str,
    html: Option<&str>,
    text: &str,
    external_id: &str,
    activity_id: &str,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        INSERT INTO job_descriptions(content_hash, html, job_id, metadata, source, text)
        VALUES (
          $1,
          $2,
          $3::uuid,
          jsonb_build_object(
            'activityId', $4::uuid,
            'externalId', $5,
            'provider', 'linkedin'
          ),
          'provider',
          $6
        )
        ON CONFLICT (job_id, content_hash) DO NOTHING
        "#,
    )
    .bind(content_hash)
    .bind(html)
    .bind(job_id)
    .bind(activity_id)
    .bind(external_id)
    .bind(text)
    .execute(pool)
    .await
    .context("insert LinkedIn job description failed")?;

    Ok(result.rows_affected() == 1)
}

async fn update_linkedin_description_progress(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
    inserted: bool,
    content_hash: &str,
) -> Result<HeartbeatOutcome> {
    let row = sqlx::query(
        r#"
        UPDATE activities
        SET
          heartbeat_at = now(),
          lease_expires_at = now() + ($3::text || ' seconds')::interval,
          phase = 'described',
          message = $4,
          progress_current = 1,
          progress_total = 1,
          payload = payload || jsonb_build_object(
            'description', jsonb_build_object(
              'contentHash', $5,
              'inserted', $6
            )
          )
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
        RETURNING cancel_requested_at IS NOT NULL AS cancel_requested
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .bind(duration_as_i64_seconds(config.lease_duration))
    .bind(if inserted {
        "Stored LinkedIn job description"
    } else {
        "LinkedIn job description already stored"
    })
    .bind(content_hash)
    .bind(inserted)
    .fetch_optional(pool)
    .await
    .context("update LinkedIn description progress failed")?;

    match row {
        Some(row) => {
            let cancel_requested: bool = row.try_get("cancel_requested")?;
            if cancel_requested {
                Ok(HeartbeatOutcome::CancelRequested)
            } else {
                Ok(HeartbeatOutcome::Running)
            }
        }
        None => Ok(HeartbeatOutcome::LeaseLost),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_linkedin_guest_description_and_criteria() {
        let html = r#"
          <section class="description">
            <div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5">
              <p>Descrizione azienda</p>
              <p><strong>MC Engineering</strong> cerca un Platform Engineer.</p>
            </div>
            <ul class="description__job-criteria-list">
              <li><h3>Seniority level</h3><span>Entry level</span></li>
              <li><h3>Employment type</h3><span>Full-time</span></li>
            </ul>
          </section>
        "#;

        let text = normalize_description_text(&extract_linkedin_description_text(html));

        assert!(text.contains("Descrizione azienda"));
        assert!(text.contains("MC Engineering cerca un Platform Engineer."));
        assert!(text.contains("Seniority level"));
        assert!(text.contains("Entry level"));
        assert!(!text.contains("description__job-criteria-list"));
    }
}
