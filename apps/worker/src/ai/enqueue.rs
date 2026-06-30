use anyhow::{Context, Result};
use sqlx::{PgPool, Row};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AutomaticReviewQueueOutcome {
    Disabled,
    AlreadyCovered,
    Queued(String),
}

struct AutomaticReviewTarget {
    endpoint_id: String,
    endpoint_name: String,
    model_id: String,
    model_name: String,
}

pub(crate) async fn enqueue_automatic_review_for_job(
    pool: &PgPool,
    job_id: &str,
    source_activity_id: &str,
) -> Result<AutomaticReviewQueueOutcome> {
    let Some(target) = read_automatic_review_target(pool).await? else {
        return Ok(AutomaticReviewQueueOutcome::Disabled);
    };

    let row = sqlx::query(
        r#"
        INSERT INTO activities(
          activity_type,
          status,
          subject_type,
          subject_id,
          phase,
          message,
          payload,
          progress_current,
          progress_total,
          source
        )
        SELECT
          'ai_review',
          'queued',
          'job',
          $1::uuid,
          'queued',
          'AI review queued',
          jsonb_build_object(
            'endpointId', $2,
            'endpointName', $3,
            'jobId', $1::text,
            'mode', 'automatic',
            'modelId', $4,
            'modelName', $5,
            'requestedByActivityId', $6
          ),
          0,
          4,
          'worker'
        WHERE EXISTS (
          SELECT 1
          FROM job_descriptions
          WHERE job_descriptions.job_id = $1::uuid
            AND length(trim(job_descriptions.text)) > 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM activities
          WHERE activity_type = 'ai_review'
            AND subject_type = 'job'
            AND subject_id = $1::uuid
            AND (
              status IN ('queued', 'running', 'interrupted')
              OR (
                status = 'failed'
                AND payload->>'mode' = 'automatic'
                AND payload->>'modelName' = $5
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM job_reviews
          WHERE job_id = $1::uuid
            AND model_name = $5
            AND metrics->>'mode' = 'automatic'
        )
        RETURNING id::text AS id
        "#,
    )
    .bind(job_id)
    .bind(&target.endpoint_id)
    .bind(&target.endpoint_name)
    .bind(&target.model_id)
    .bind(&target.model_name)
    .bind(source_activity_id)
    .fetch_optional(pool)
    .await
    .context("enqueue automatic AI review for job failed")?;

    Ok(match row {
        Some(row) => AutomaticReviewQueueOutcome::Queued(row.try_get("id")?),
        None => AutomaticReviewQueueOutcome::AlreadyCovered,
    })
}

pub(crate) async fn enqueue_automatic_reviews_for_search_ready_jobs(
    pool: &PgPool,
    search_id: &str,
    source_activity_id: &str,
) -> Result<i32> {
    let Some(target) = read_automatic_review_target(pool).await? else {
        return Ok(0);
    };

    let row = sqlx::query(
        r#"
        WITH candidates AS (
          SELECT DISTINCT jobs.id AS job_id
          FROM job_search_presence
          JOIN jobs ON jobs.id = job_search_presence.job_id
          WHERE job_search_presence.search_id = $1::uuid
            AND EXISTS (
              SELECT 1
              FROM job_descriptions
              WHERE job_descriptions.job_id = jobs.id
                AND length(trim(job_descriptions.text)) > 0
            )
            AND NOT EXISTS (
              SELECT 1
              FROM activities
              WHERE activity_type = 'ai_review'
                AND subject_type = 'job'
                AND subject_id = jobs.id
                AND (
                  status IN ('queued', 'running', 'interrupted')
                  OR (
                    status = 'failed'
                    AND payload->>'mode' = 'automatic'
                    AND payload->>'modelName' = $5
                  )
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM job_reviews
              WHERE job_id = jobs.id
                AND model_name = $5
                AND metrics->>'mode' = 'automatic'
            )
        ),
        inserted AS (
          INSERT INTO activities(
            activity_type,
            status,
            subject_type,
            subject_id,
            phase,
            message,
            payload,
            progress_current,
            progress_total,
            source
          )
          SELECT
            'ai_review',
            'queued',
            'job',
            candidates.job_id,
            'queued',
            'AI review queued',
            jsonb_build_object(
              'endpointId', $2,
              'endpointName', $3,
              'jobId', candidates.job_id::text,
              'mode', 'automatic',
              'modelId', $4,
              'modelName', $5,
              'requestedByActivityId', $6
            ),
            0,
            4,
            'worker'
          FROM candidates
          RETURNING id
        )
        SELECT COUNT(*)::int AS queued FROM inserted
        "#,
    )
    .bind(search_id)
    .bind(&target.endpoint_id)
    .bind(&target.endpoint_name)
    .bind(&target.model_id)
    .bind(&target.model_name)
    .bind(source_activity_id)
    .fetch_one(pool)
    .await
    .context("enqueue automatic AI reviews for search failed")?;

    row.try_get("queued")
        .context("read automatic AI review queue count failed")
}

async fn read_automatic_review_target(pool: &PgPool) -> Result<Option<AutomaticReviewTarget>> {
    let settings = sqlx::query(
        r#"
        SELECT
          COALESCE(
            (SELECT value = 'true'::jsonb FROM settings WHERE key = 'ai.enabled'),
            false
          ) AS enabled,
          (
            SELECT NULLIF(trim(value #>> '{}'), '')
            FROM settings
            WHERE key = 'ai.active_endpoint_id'
          ) AS active_endpoint_id,
          COALESCE(
            (
              SELECT NULLIF(trim(value ->> 'modelName'), '')
              FROM settings
              WHERE key = 'ai.runtime'
            ),
            (
              SELECT NULLIF(trim(value ->> 'priorityModelName'), '')
              FROM settings
              WHERE key = 'ai.runtime'
            )
          ) AS model_name
        "#,
    )
    .fetch_one(pool)
    .await
    .context("read automatic AI review settings failed")?;

    let enabled: bool = settings.try_get("enabled")?;
    if !enabled {
        return Ok(None);
    }

    let active_endpoint_id: Option<String> = settings.try_get("active_endpoint_id")?;
    let Some(model_name) = settings.try_get::<Option<String>, _>("model_name")? else {
        return Ok(None);
    };

    let endpoint = sqlx::query(
        r#"
        SELECT id::text AS id, name
        FROM ai_endpoints
        WHERE enabled = true
          AND (
            ($1::text IS NOT NULL AND id::text = $1)
            OR ($1::text IS NULL AND is_active = true)
          )
        ORDER BY is_active DESC, name ASC
        LIMIT 1
        "#,
    )
    .bind(active_endpoint_id.as_deref())
    .fetch_optional(pool)
    .await
    .context("read automatic AI review endpoint failed")?;
    let Some(endpoint) = endpoint else {
        return Ok(None);
    };

    let endpoint_id: String = endpoint.try_get("id")?;
    let endpoint_name: String = endpoint.try_get("name")?;
    let model = sqlx::query(
        r#"
        INSERT INTO ai_models(endpoint_id, name, installed, metadata)
        VALUES (
          $1::uuid,
          $2,
          false,
          jsonb_build_object('lastReviewQueuedAt', now())
        )
        ON CONFLICT (endpoint_id, name) DO UPDATE
        SET updated_at = now(),
            metadata = ai_models.metadata || jsonb_build_object('lastReviewQueuedAt', now())
        RETURNING id::text AS id
        "#,
    )
    .bind(&endpoint_id)
    .bind(&model_name)
    .fetch_one(pool)
    .await
    .context("upsert automatic AI review model failed")?;

    Ok(Some(AutomaticReviewTarget {
        endpoint_id,
        endpoint_name,
        model_id: model.try_get("id")?,
        model_name,
    }))
}
