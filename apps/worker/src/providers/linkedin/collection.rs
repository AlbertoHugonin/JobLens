use std::{sync::atomic::Ordering, time::Duration};

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tokio::sync::watch;

use crate::{
    activities::{
        ClaimedActivity, HeartbeatOutcome, insert_activity_log, mark_activity_cancelled,
        mark_activity_interrupted, mark_activity_succeeded,
    },
    config::WorkerConfig,
    telemetry::WorkerMetrics,
    util::{duration_as_i64_seconds, read_json_i32, read_json_string},
};

use super::{
    jobs::{extract_jobs_from_payload, extract_total_results, upsert_linkedin_job},
    request::{
        build_fixture_page, build_linkedin_request, fetch_linkedin_page, insert_raw_payload,
        read_fixture_pages,
    },
    session::{linkedin_user_agent, read_active_linkedin_session, read_linkedin_search},
    types::LinkedInCollectStats,
};

pub(crate) async fn run_collect_activity(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &WorkerMetrics,
    activity: &ClaimedActivity,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    let search_id = activity
        .subject_id
        .clone()
        .or_else(|| read_json_string(&activity.payload, "searchId"))
        .context("linkedin_collect activity is missing search id")?;
    let search = read_linkedin_search(pool, &search_id).await?;
    let fixture_pages = read_fixture_pages(&activity.payload);
    let session = if fixture_pages.is_some() {
        None
    } else {
        Some(read_active_linkedin_session(pool, &search.provider_id).await?)
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(linkedin_user_agent(session.as_ref()))
        .build()
        .context("cannot build LinkedIn HTTP client")?;
    let mut start = read_json_i32(&activity.payload, "start").unwrap_or(0);
    let count = read_json_i32(&activity.payload, "count")
        .unwrap_or(25)
        .max(1);
    let mut stats = LinkedInCollectStats::default();

    loop {
        if *shutdown_rx.borrow() {
            mark_activity_interrupted(pool, config, &activity.id, "Worker shutdown requested")
                .await?;
            metrics
                .activities_interrupted
                .fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }

        let request = build_linkedin_request(&search.query, session.as_ref(), start, count)?;
        let page = match &fixture_pages {
            Some(pages) => match pages.get(stats.pages_fetched as usize) {
                Some(payload) => build_fixture_page(payload, &request),
                None => break,
            },
            None => {
                fetch_linkedin_page(
                    &client,
                    session.as_ref().context("missing session")?,
                    &request,
                )
                .await?
            }
        };

        insert_raw_payload(pool, &search.provider_id, &activity.id, &page).await?;
        stats.raw_payloads += 1;

        if !page
            .response_status
            .map(|status| (200..300).contains(&status))
            .unwrap_or(true)
        {
            return Err(anyhow!(
                "LinkedIn collection failed with HTTP {}",
                page.response_status.unwrap_or(0)
            ));
        }

        let payload = page.payload.as_ref().context("LinkedIn page is not JSON")?;
        let jobs = extract_jobs_from_payload(payload);

        if stats.total_results.is_none() {
            stats.total_results = extract_total_results(payload);
        }

        for job in jobs {
            let outcome = upsert_linkedin_job(
                pool,
                &search.provider_id,
                &search.search_id,
                &activity.id,
                &job,
            )
            .await?;
            stats.jobs_seen += 1;
            if outcome.created {
                stats.jobs_created += 1;
            } else {
                stats.jobs_updated += 1;
            }
        }

        stats.pages_fetched += 1;
        start += request.count;

        match update_linkedin_collect_progress(pool, config, &activity.id, &stats).await? {
            HeartbeatOutcome::Running => {}
            HeartbeatOutcome::CancelRequested => {
                mark_activity_cancelled(pool, config, &activity.id).await?;
                metrics.activities_cancelled.fetch_add(1, Ordering::Relaxed);
                return Ok(());
            }
            HeartbeatOutcome::LeaseLost => {
                return Err(anyhow!("activity lease was lost"));
            }
        }

        if let Some(total_results) = stats.total_results
            && stats.jobs_seen >= total_results
        {
            break;
        }

        if fixture_pages.is_some()
            && stats.pages_fetched as usize >= fixture_pages.as_ref().map_or(0, Vec::len)
        {
            break;
        }

        // Be gentle with the LinkedIn API between pages; wake early on shutdown.
        if fixture_pages.is_none() && !config.collection_page_delay.is_zero() {
            tokio::select! {
                _ = tokio::time::sleep(config.collection_page_delay) => {}
                _ = shutdown_rx.changed() => {}
            }
        }
    }

    let complete_collection = stats
        .total_results
        .is_some_and(|total_results| stats.jobs_seen >= total_results);
    mark_search_run_completed(pool, &search.search_id).await?;
    stats.descriptions_queued =
        enqueue_missing_linkedin_descriptions(pool, &search.search_id, &activity.id).await?;
    if complete_collection {
        let availability_outcome = mark_missing_linkedin_jobs_and_enqueue_availability(
            pool,
            &search.search_id,
            &activity.id,
        )
        .await?;
        stats.jobs_marked_missing = availability_outcome.0;
        stats.availability_queued = availability_outcome.1;
    } else {
        insert_activity_log(
            pool,
            &activity.id,
            "warn",
            "Skipped destructive presence sync because collection was not complete",
            linkedin_stats_json(&stats),
        )
        .await?;
    }
    update_linkedin_collect_progress(pool, config, &activity.id, &stats).await?;
    insert_activity_log(
        pool,
        &activity.id,
        "info",
        "Completed LinkedIn collection",
        linkedin_stats_json(&stats),
    )
    .await?;
    mark_activity_succeeded(pool, config, &activity.id).await?;
    metrics.activities_succeeded.fetch_add(1, Ordering::Relaxed);

    Ok(())
}

async fn enqueue_missing_linkedin_descriptions(
    pool: &PgPool,
    search_id: &str,
    activity_id: &str,
) -> Result<i32> {
    let result = sqlx::query(
        r#"
        WITH candidates AS (
          SELECT DISTINCT ON (jobs.id)
            jobs.id AS job_id,
            external_jobs.external_id,
            COALESCE(external_jobs.external_url, jobs.provider_url, jobs.source_url) AS external_url,
            source_activity.payload -> 'fixtureDescriptions' -> external_jobs.external_id AS fixture_description
          FROM job_search_presence
          JOIN jobs ON jobs.id = job_search_presence.job_id
          JOIN external_jobs ON external_jobs.job_id = jobs.id
          JOIN providers ON providers.id = external_jobs.provider_id
          JOIN activities AS source_activity ON source_activity.id = $2::uuid
          WHERE job_search_presence.search_id = $1::uuid
            AND job_search_presence.last_activity_id = $2::uuid
            AND providers.provider_key = 'linkedin'
            AND NOT EXISTS (
              SELECT 1
              FROM job_descriptions
              WHERE job_descriptions.job_id = jobs.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM activities existing_activity
              WHERE existing_activity.activity_type = 'linkedin_describe'
                AND existing_activity.subject_type = 'job'
                AND existing_activity.subject_id = jobs.id
                AND existing_activity.status IN ('queued', 'running', 'interrupted')
            )
          ORDER BY jobs.id, external_jobs.created_at ASC
        ),
        inserted AS (
          INSERT INTO activities(
            activity_type,
            status,
            subject_type,
            subject_id,
            payload,
            source,
            phase,
            message,
            progress_current,
            progress_total
          )
          SELECT
            'linkedin_describe',
            'queued',
            'job',
            candidates.job_id,
            jsonb_strip_nulls(jsonb_build_object(
              'providerKey', 'linkedin',
              'jobId', candidates.job_id,
              'externalId', candidates.external_id,
              'url', candidates.external_url,
              'fixtureDescription', candidates.fixture_description
            )),
            'worker',
            'queued',
            'LinkedIn description queued',
            0,
            1
          FROM candidates
          RETURNING id
        )
        SELECT COUNT(*)::int AS queued FROM inserted
        "#,
    )
    .bind(search_id)
    .bind(activity_id)
    .fetch_one(pool)
    .await
    .context("enqueue LinkedIn descriptions failed")?;

    Ok(result.try_get("queued")?)
}

async fn mark_missing_linkedin_jobs_and_enqueue_availability(
    pool: &PgPool,
    search_id: &str,
    activity_id: &str,
) -> Result<(i32, i32)> {
    let result = sqlx::query(
        r#"
        WITH stale_presence AS (
          SELECT job_search_presence.job_id
          FROM job_search_presence
          WHERE job_search_presence.search_id = $1::uuid
            AND (
              job_search_presence.last_activity_id IS NULL
              OR job_search_presence.last_activity_id <> $2::uuid
            )
        ),
        outside AS (
          SELECT DISTINCT stale_presence.job_id
          FROM stale_presence
          WHERE NOT EXISTS (
            SELECT 1
            FROM job_search_presence other_presence
            WHERE other_presence.job_id = stale_presence.job_id
              AND other_presence.search_id <> $1::uuid
          )
        ),
        removed AS (
          DELETE FROM job_search_presence
          USING stale_presence
          WHERE job_search_presence.search_id = $1::uuid
            AND job_search_presence.job_id = stale_presence.job_id
          RETURNING job_search_presence.job_id
        ),
        updated AS (
          UPDATE jobs
          SET availability_status = 'missing_from_searches'
          FROM outside
          WHERE jobs.id = outside.job_id
            AND jobs.availability_status = 'active'
          RETURNING jobs.id AS job_id
        ),
        candidates AS (
          SELECT DISTINCT ON (updated.job_id)
            updated.job_id,
            external_jobs.external_id,
            COALESCE(external_jobs.external_url, jobs.provider_url, jobs.source_url) AS external_url,
            source_activity.payload -> 'fixtureAvailabilities' -> external_jobs.external_id AS fixture_availability
          FROM updated
          JOIN jobs ON jobs.id = updated.job_id
          JOIN external_jobs ON external_jobs.job_id = jobs.id
          JOIN providers ON providers.id = external_jobs.provider_id
          JOIN activities AS source_activity ON source_activity.id = $2::uuid
          WHERE providers.provider_key = 'linkedin'
            AND NOT EXISTS (
              SELECT 1
              FROM activities existing_activity
              WHERE existing_activity.activity_type = 'linkedin_availability'
                AND existing_activity.subject_type = 'job'
                AND existing_activity.subject_id = updated.job_id
                AND existing_activity.status IN ('queued', 'running', 'interrupted')
            )
          ORDER BY updated.job_id, external_jobs.created_at ASC
        ),
        inserted AS (
          INSERT INTO activities(
            activity_type,
            status,
            subject_type,
            subject_id,
            payload,
            source,
            phase,
            message,
            progress_current,
            progress_total
          )
          SELECT
            'linkedin_availability',
            'queued',
            'job',
            candidates.job_id,
            jsonb_strip_nulls(jsonb_build_object(
              'providerKey', 'linkedin',
              'jobId', candidates.job_id,
              'externalId', candidates.external_id,
              'url', candidates.external_url,
              'fixtureAvailability', candidates.fixture_availability
            )),
            'worker',
            'queued',
            'LinkedIn availability check queued',
            0,
            1
          FROM candidates
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*)::int FROM updated) AS marked_missing,
          (SELECT COUNT(*)::int FROM inserted) AS queued_availability
        "#,
    )
    .bind(search_id)
    .bind(activity_id)
    .fetch_one(pool)
    .await
    .context("mark missing LinkedIn jobs failed")?;

    Ok((
        result.try_get("marked_missing")?,
        result.try_get("queued_availability")?,
    ))
}

async fn update_linkedin_collect_progress(
    pool: &PgPool,
    config: &WorkerConfig,
    activity_id: &str,
    stats: &LinkedInCollectStats,
) -> Result<HeartbeatOutcome> {
    let total = stats.total_results.unwrap_or(stats.jobs_seen.max(1));
    let row = sqlx::query(
        r#"
        UPDATE activities
        SET
          heartbeat_at = now(),
          lease_expires_at = now() + ($3::text || ' seconds')::interval,
          phase = 'collecting',
          message = $4,
          progress_current = $5,
          progress_total = $6,
          payload = payload || jsonb_build_object('stats', $7::jsonb)
        WHERE id = $1::uuid
          AND status = 'running'
          AND lease_owner = $2
        RETURNING cancel_requested_at IS NOT NULL AS cancel_requested
        "#,
    )
    .bind(activity_id)
    .bind(&config.worker_id)
    .bind(duration_as_i64_seconds(config.lease_duration))
    .bind(format!(
        "Collected {} of {} LinkedIn jobs",
        stats.jobs_seen, total
    ))
    .bind(stats.jobs_seen)
    .bind(total)
    .bind(linkedin_stats_json(stats))
    .fetch_optional(pool)
    .await
    .context("update LinkedIn collection progress failed")?;

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

async fn mark_search_run_completed(pool: &PgPool, search_id: &str) -> Result<()> {
    sqlx::query("UPDATE searches SET last_run_at = now() WHERE id = $1::uuid")
        .bind(search_id)
        .execute(pool)
        .await
        .context("update search last_run_at failed")?;
    Ok(())
}

fn linkedin_stats_json(stats: &LinkedInCollectStats) -> Value {
    json!({
        "availabilityQueued": stats.availability_queued,
        "descriptionsQueued": stats.descriptions_queued,
        "jobsCreated": stats.jobs_created,
        "jobsMarkedMissing": stats.jobs_marked_missing,
        "jobsSeen": stats.jobs_seen,
        "jobsUpdated": stats.jobs_updated,
        "pagesFetched": stats.pages_fetched,
        "rawPayloads": stats.raw_payloads,
        "totalResults": stats.total_results,
    })
}
