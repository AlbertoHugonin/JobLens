use std::{env, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use serde_json::json;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use time::OffsetDateTime;
use tokio::{sync::watch, time::sleep};
use url::Url;
use uuid::Uuid;

use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires PostgreSQL and creates a temporary database"]
async fn worker_db_integration_claims_dummy_and_handles_concurrency() -> Result<()> {
    if env::var("JOBLENS_WORKER_DB_TEST").ok().as_deref() != Some("1") {
        eprintln!("skipping worker DB integration test; set JOBLENS_WORKER_DB_TEST=1");
        return Ok(());
    }

    let base_database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let database_name = format!("joblens_worker_m3_{}", Uuid::new_v4().simple());
    let admin_database_url = database_url_with_path(&base_database_url, "postgres")?;
    let test_database_url = database_url_with_path(&base_database_url, &database_name)?;
    let admin_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&admin_database_url)
        .await?;

    sqlx::query(&format!(
        "CREATE DATABASE {}",
        quote_identifier(&database_name)
    ))
    .execute(&admin_pool)
    .await?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&test_database_url)
        .await?;
    create_worker_test_schema(&pool).await?;
    let test_prefix = format!("m3_test_{}", Uuid::new_v4());

    let result = run_worker_db_assertions(&pool, &test_prefix).await;
    cleanup_test_activities(&pool, &test_prefix).await?;
    pool.close().await;
    drop_test_database(&admin_pool, &database_name).await?;
    admin_pool.close().await;

    result
}

fn database_url_with_path(database_url: &str, database_name: &str) -> Result<String> {
    let mut url = Url::parse(database_url)?;
    url.set_path(database_name);
    Ok(url.to_string())
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

async fn create_worker_test_schema(pool: &PgPool) -> Result<()> {
    sqlx::query("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        .execute(pool)
        .await?;
    sqlx::query(
        r#"
            CREATE TABLE providers (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              provider_key TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              enabled BOOLEAN NOT NULL DEFAULT true,
              config JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE provider_sessions (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              label TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'active',
              session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
              last_verified_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE settings (
              key TEXT PRIMARY KEY,
              value JSONB NOT NULL,
              description TEXT,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE ai_endpoints (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              name TEXT NOT NULL,
              base_url TEXT NOT NULL,
              enabled BOOLEAN NOT NULL DEFAULT true,
              is_active BOOLEAN NOT NULL DEFAULT false,
              config JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE ai_models (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              endpoint_id UUID NOT NULL REFERENCES ai_endpoints(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              installed BOOLEAN NOT NULL DEFAULT false,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              UNIQUE(endpoint_id, name)
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE searches (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
              name TEXT NOT NULL,
              query JSONB NOT NULL DEFAULT '{}'::jsonb,
              enabled BOOLEAN NOT NULL DEFAULT true,
              schedule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
              last_run_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
            r#"
            CREATE TABLE activities (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              activity_type TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled', 'interrupted')),
              subject_type TEXT,
              subject_id UUID,
              progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
              progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= 0),
              phase TEXT,
              message TEXT,
              error TEXT,
              payload JSONB NOT NULL DEFAULT '{}'::jsonb,
              source TEXT NOT NULL DEFAULT 'api',
              attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
              max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
              lease_owner TEXT,
              lease_expires_at TIMESTAMPTZ,
              heartbeat_at TIMESTAMPTZ,
              cancel_requested_at TIMESTAMPTZ,
              queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              started_at TIMESTAMPTZ,
              finished_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
        )
        .execute(pool)
        .await?;
    sqlx::query(
        r#"
            CREATE TABLE jobs (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              title TEXT NOT NULL,
              company_name TEXT NOT NULL,
              location_text TEXT,
              workplace_type TEXT,
              employment_type TEXT,
              seniority TEXT,
              published_at TIMESTAMPTZ,
              reposted_at TIMESTAMPTZ,
              local_status TEXT NOT NULL DEFAULT 'new',
              availability_status TEXT NOT NULL DEFAULT 'active',
              source_url TEXT,
              provider_url TEXT,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE external_jobs (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
              job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
              external_id TEXT NOT NULL,
              external_url TEXT,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              UNIQUE(provider_id, external_id)
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE job_search_presence (
              job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
              search_id UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
              first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              last_activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              PRIMARY KEY (job_id, search_id)
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE job_descriptions (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
              content_hash TEXT NOT NULL,
              html TEXT,
              text TEXT NOT NULL,
              source TEXT NOT NULL DEFAULT 'provider',
              fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              UNIQUE(job_id, content_hash)
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE job_reviews (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
              endpoint_id UUID REFERENCES ai_endpoints(id) ON DELETE SET NULL,
              model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
              model_name TEXT NOT NULL,
              profile_hash TEXT NOT NULL,
              rules_hash TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
              decision TEXT CHECK (decision IS NULL OR decision IN ('apply', 'maybe', 'reject')),
              score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
              result JSONB NOT NULL DEFAULT '{}'::jsonb,
              raw_output TEXT,
              error TEXT,
              metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE raw_payloads (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
              activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
              external_job_id UUID REFERENCES external_jobs(id) ON DELETE SET NULL,
              request_url TEXT,
              request_params JSONB NOT NULL DEFAULT '{}'::jsonb,
              response_status INTEGER,
              content_type TEXT,
              elapsed_ms INTEGER,
              payload JSONB,
              payload_text TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            CREATE TABLE activity_logs (
              id BIGSERIAL PRIMARY KEY,
              activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
              level TEXT NOT NULL DEFAULT 'info'
                CHECK (level IN ('debug', 'info', 'warn', 'error')),
              message TEXT NOT NULL,
              data JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn drop_test_database(admin_pool: &PgPool, database_name: &str) -> Result<()> {
    sqlx::query(
        r#"
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = $1
            "#,
    )
    .bind(database_name)
    .execute(admin_pool)
    .await?;
    sqlx::query(&format!(
        "DROP DATABASE IF EXISTS {}",
        quote_identifier(database_name)
    ))
    .execute(admin_pool)
    .await?;

    Ok(())
}

async fn run_worker_db_assertions(pool: &PgPool, test_prefix: &str) -> Result<()> {
    let metrics = Arc::new(TestWorkerMetrics::default());
    let config = test_config("m3-worker-a");
    let (_shutdown_tx, shutdown_rx) = watch::channel(false);
    let activity_id = insert_test_activity(pool, &format!("{test_prefix}_dummy"), "queued").await?;
    let claimed = claim_next_activity(pool, &config)
        .await?
        .context("expected queued activity to be claimed")?;

    assert_eq!(claimed.id, activity_id);
    assert_eq!(claimed.activity_type, format!("{test_prefix}_dummy"));
    mark_activity_failed(pool, &config, &claimed.id, "unsupported test type").await?;

    let dummy_id = insert_test_activity(pool, "dummy", "queued").await?;
    let dummy = claim_next_activity(pool, &config)
        .await?
        .context("expected dummy activity to be claimed")?;
    assert_eq!(dummy.id, dummy_id);
    let mut process_shutdown = shutdown_rx.clone();
    process_activity(pool, &config, &metrics, dummy, &mut process_shutdown).await?;
    assert_activity_status(pool, &dummy_id, "success").await?;
    assert_activity_has_logs(pool, &dummy_id).await?;

    let expired_id = insert_running_expired_activity(pool, test_prefix).await?;
    let expired = claim_next_activity(pool, &config)
        .await?
        .context("expected expired lease to be reclaimed")?;
    assert_eq!(expired.id, expired_id);
    mark_activity_succeeded(pool, &config, &expired.id).await?;
    assert_activity_status(pool, &expired_id, "success").await?;

    let scheduled_search_id = insert_due_scheduled_search(pool).await?;
    let first_scheduled_count = enqueue_due_searches(pool, OffsetDateTime::now_utc()).await?;
    let second_scheduled_count = enqueue_due_searches(pool, OffsetDateTime::now_utc()).await?;
    assert_eq!(first_scheduled_count, 1);
    assert_eq!(second_scheduled_count, 0);
    assert_scheduled_collection_count(pool, &scheduled_search_id, 1).await?;

    let concurrent_id = insert_test_activity(pool, "dummy", "queued").await?;
    let config_a = test_config("m3-worker-concurrent-a");
    let config_b = test_config("m3-worker-concurrent-b");
    let (claim_a, claim_b) = tokio::join!(
        claim_next_activity(pool, &config_a),
        claim_next_activity(pool, &config_b)
    );
    let claims = [claim_a?, claim_b?]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0].id, concurrent_id);
    let owner = read_activity_lease_owner(pool, &concurrent_id).await?;
    assert!(owner == "m3-worker-concurrent-a" || owner == "m3-worker-concurrent-b");

    let cancel_id = insert_test_activity(pool, "dummy", "queued").await?;
    let cancel_config = WorkerConfig {
        dummy_duration: Duration::from_millis(500),
        heartbeat_interval: Duration::from_millis(50),
        ..test_config("m3-worker-cancel")
    };
    let cancel_activity = claim_next_activity(pool, &cancel_config)
        .await?
        .context("expected cancellable activity to be claimed")?;
    assert_eq!(cancel_activity.id, cancel_id);
    let pool_for_cancel = pool.clone();
    let cancel_id_for_update = cancel_id.clone();
    let cancel_task = tokio::spawn(async move {
        sleep(Duration::from_millis(75)).await;
        sqlx::query("UPDATE activities SET cancel_requested_at = now() WHERE id = $1::uuid")
            .bind(cancel_id_for_update)
            .execute(&pool_for_cancel)
            .await
    });
    let mut cancel_shutdown = shutdown_rx.clone();
    process_activity(
        pool,
        &cancel_config,
        &metrics,
        cancel_activity,
        &mut cancel_shutdown,
    )
    .await?;
    cancel_task.await??;
    assert_activity_status(pool, &cancel_id, "cancelled").await?;

    let collect_fixture = insert_linkedin_collect_fixture(pool).await?;
    let collect_activity = claim_next_activity(pool, &config)
        .await?
        .context("expected LinkedIn collection activity to be claimed")?;
    assert_eq!(collect_activity.id, collect_fixture.activity_id);
    let mut collect_shutdown = shutdown_rx.clone();
    process_activity(
        pool,
        &config,
        &metrics,
        collect_activity,
        &mut collect_shutdown,
    )
    .await?;
    assert_activity_status(pool, &collect_fixture.activity_id, "success").await?;
    assert_linkedin_collection_results(pool, &collect_fixture).await?;

    for _ in 0..3 {
        let description_id = process_next_activity_of_type(
            pool,
            &config,
            &metrics,
            shutdown_rx.clone(),
            "linkedin_describe",
        )
        .await?;
        assert_activity_status(pool, &description_id, "success").await?;
    }
    let availability_id = process_next_activity_of_type(
        pool,
        &config,
        &metrics,
        shutdown_rx.clone(),
        "linkedin_availability",
    )
    .await?;
    assert_activity_status(pool, &availability_id, "success").await?;
    assert_linkedin_m9_followups(pool, &collect_fixture).await?;

    let duplicate_description_id = insert_linkedin_description_fixture_activity(
        pool,
        &collect_fixture.provider_id,
        "m7-1",
        " updated   FRONTEND role ",
    )
    .await?;
    let duplicate_description = claim_next_activity(pool, &config)
        .await?
        .context("expected duplicate description activity")?;
    assert_eq!(duplicate_description.id, duplicate_description_id);
    let mut duplicate_shutdown = shutdown_rx.clone();
    process_activity(
        pool,
        &config,
        &metrics,
        duplicate_description,
        &mut duplicate_shutdown,
    )
    .await?;
    assert_activity_status(pool, &duplicate_description_id, "success").await?;
    assert_description_count(pool, &collect_fixture.provider_id, "m7-1", 1).await?;

    let skipped_availability_id = insert_linkedin_availability_fixture_activity(
        pool,
        &collect_fixture.provider_id,
        "m7-2",
        false,
    )
    .await?;
    let skipped_availability = claim_next_activity(pool, &config)
        .await?
        .context("expected skipped availability activity")?;
    assert_eq!(skipped_availability.id, skipped_availability_id);
    let mut skipped_shutdown = shutdown_rx.clone();
    process_activity(
        pool,
        &config,
        &metrics,
        skipped_availability,
        &mut skipped_shutdown,
    )
    .await?;
    assert_activity_status(pool, &skipped_availability_id, "success").await?;
    assert_job_availability(pool, &collect_fixture.provider_id, "m7-2", "active").await?;

    let model_fixture = insert_model_install_fixture(pool).await?;
    let model_activity = claim_next_activity(pool, &config)
        .await?
        .context("expected model install activity")?;
    assert_eq!(model_activity.id, model_fixture.activity_id);
    let mut model_shutdown = shutdown_rx.clone();
    process_activity(pool, &config, &metrics, model_activity, &mut model_shutdown).await?;
    assert_activity_status(pool, &model_fixture.activity_id, "success").await?;
    assert_model_installed(pool, &model_fixture.model_id).await?;

    let ai_fixture = insert_ai_review_fixture(pool, true).await?;
    let ai_activity = claim_next_activity(pool, &config)
        .await?
        .context("expected AI review activity")?;
    assert_eq!(ai_activity.id, ai_fixture.activity_id);
    let mut ai_shutdown = shutdown_rx.clone();
    process_activity(pool, &config, &metrics, ai_activity, &mut ai_shutdown).await?;
    assert_activity_status(pool, &ai_fixture.activity_id, "success").await?;
    assert_ai_review_success(pool, &ai_fixture.job_id).await?;

    let invalid_ai_fixture = insert_ai_review_fixture(pool, false).await?;
    let invalid_ai_activity = claim_next_activity(pool, &config)
        .await?
        .context("expected invalid AI review activity")?;
    assert_eq!(invalid_ai_activity.id, invalid_ai_fixture.activity_id);
    let mut invalid_ai_shutdown = shutdown_rx.clone();
    process_activity(
        pool,
        &config,
        &metrics,
        invalid_ai_activity,
        &mut invalid_ai_shutdown,
    )
    .await?;
    assert_activity_status(pool, &invalid_ai_fixture.activity_id, "success").await?;
    assert_ai_review_failed(pool, &invalid_ai_fixture.job_id).await?;

    let jsonl_export_id = insert_export_fixture(pool, "jobs_reviews_jsonl").await?;
    let jsonl_export = claim_next_activity(pool, &config)
        .await?
        .context("expected jobs/reviews export activity")?;
    assert_eq!(jsonl_export.id, jsonl_export_id);
    let mut jsonl_shutdown = shutdown_rx.clone();
    process_activity(pool, &config, &metrics, jsonl_export, &mut jsonl_shutdown).await?;
    assert_activity_status(pool, &jsonl_export_id, "success").await?;
    assert_export_artifact(pool, &jsonl_export_id, "jobs_reviews_jsonl").await?;

    let debug_export_id = insert_export_fixture(pool, "debug_bundle").await?;
    let debug_export = claim_next_activity(pool, &config)
        .await?
        .context("expected debug bundle activity")?;
    assert_eq!(debug_export.id, debug_export_id);
    let mut debug_shutdown = shutdown_rx.clone();
    process_activity(pool, &config, &metrics, debug_export, &mut debug_shutdown).await?;
    assert_activity_status(pool, &debug_export_id, "success").await?;
    assert_export_artifact(pool, &debug_export_id, "debug_bundle").await?;

    Ok(())
}

struct LinkedInCollectFixture {
    activity_id: String,
    provider_id: String,
    search_id: String,
}

struct ModelInstallFixture {
    activity_id: String,
    model_id: String,
}

struct AiReviewFixture {
    activity_id: String,
    job_id: String,
}

async fn insert_test_activity(pool: &PgPool, activity_type: &str, status: &str) -> Result<String> {
    let row = sqlx::query(
        r#"
            INSERT INTO activities(activity_type, status, payload, source, progress_total)
            VALUES ($1, $2, '{}'::jsonb, 'worker-test', 1)
            RETURNING id::text AS id
            "#,
    )
    .bind(activity_type)
    .bind(status)
    .fetch_one(pool)
    .await?;

    Ok(row.try_get("id")?)
}

async fn insert_running_expired_activity(pool: &PgPool, test_prefix: &str) -> Result<String> {
    let row = sqlx::query(
        r#"
            INSERT INTO activities(
              activity_type,
              status,
              payload,
              source,
              lease_owner,
              lease_expires_at,
              heartbeat_at,
              started_at
            )
            VALUES (
              'dummy',
              'running',
              '{}'::jsonb,
              'worker-test',
              $1,
              now() - interval '1 second',
              now() - interval '2 seconds',
              now() - interval '3 seconds'
            )
            RETURNING id::text AS id
            "#,
    )
    .bind(format!("{test_prefix}_dead_worker"))
    .fetch_one(pool)
    .await?;

    Ok(row.try_get("id")?)
}

async fn insert_due_scheduled_search(pool: &PgPool) -> Result<String> {
    let provider = sqlx::query(
        r#"
            INSERT INTO providers(provider_key, name, enabled, config)
            VALUES ('linkedin', 'LinkedIn', true, '{}'::jsonb)
            ON CONFLICT (provider_key) DO UPDATE SET enabled = true
            RETURNING id::text AS id
            "#,
    )
    .fetch_one(pool)
    .await?;
    let provider_id: String = provider.try_get("id")?;
    let search = sqlx::query(
        r#"
            INSERT INTO searches(provider_id, name, query, enabled, schedule_config, last_run_at)
            VALUES (
              $1::uuid,
              'Scheduled Rust search',
              '{"providerKey":"linkedin","keywords":"Rust","location":"Italy"}'::jsonb,
              true,
              '{"enabled":true,"intervalMinutes":60,"extraDelayMinutes":10}'::jsonb,
              now() - interval '2 hours'
            )
            RETURNING id::text AS id
            "#,
    )
    .bind(provider_id)
    .fetch_one(pool)
    .await?;

    search.try_get("id").context("read scheduled search id")
}

async fn assert_scheduled_collection_count(
    pool: &PgPool,
    search_id: &str,
    expected: i64,
) -> Result<()> {
    let row = sqlx::query(
        r#"
            SELECT COUNT(*)::bigint AS count
            FROM activities
            WHERE activity_type = 'linkedin_collect'
              AND source = 'scheduler'
              AND subject_id = $1::uuid
              AND status IN ('queued', 'running')
            "#,
    )
    .bind(search_id)
    .fetch_one(pool)
    .await?;
    let count: i64 = row.try_get("count")?;
    assert_eq!(count, expected);
    Ok(())
}

async fn insert_model_install_fixture(pool: &PgPool) -> Result<ModelInstallFixture> {
    let endpoint = sqlx::query(
        r#"
            INSERT INTO ai_endpoints(name, base_url, enabled, is_active, config)
            VALUES ('M10 fixture endpoint', 'http://localhost:11434', true, true, '{}'::jsonb)
            RETURNING id::text AS id
            "#,
    )
    .fetch_one(pool)
    .await?;
    let endpoint_id: String = endpoint.try_get("id")?;
    let model = sqlx::query(
        r#"
            INSERT INTO ai_models(endpoint_id, name, installed, metadata)
            VALUES ($1::uuid, 'm10-fixture-model', false, '{}'::jsonb)
            RETURNING id::text AS id
            "#,
    )
    .bind(&endpoint_id)
    .fetch_one(pool)
    .await?;
    let model_id: String = model.try_get("id")?;
    let payload = json!({
        "endpointId": endpoint_id,
        "modelId": model_id,
        "modelName": "m10-fixture-model",
    });
    let activity = sqlx::query(
            r#"
            INSERT INTO activities(activity_type, status, subject_type, subject_id, payload, source, progress_total)
            VALUES ('model_install', 'queued', 'ai_model', $1::uuid, $2::jsonb, 'worker-test', 3)
            RETURNING id::text AS id
            "#,
        )
        .bind(&model_id)
        .bind(&payload)
        .fetch_one(pool)
        .await?;

    Ok(ModelInstallFixture {
        activity_id: activity.try_get("id")?,
        model_id,
    })
}

async fn insert_ai_review_fixture(pool: &PgPool, valid_json: bool) -> Result<AiReviewFixture> {
    let suffix = Uuid::new_v4().simple().to_string();
    let endpoint = sqlx::query(
        r#"
            INSERT INTO ai_endpoints(name, base_url, enabled, is_active, config)
            VALUES ($1, 'http://localhost:11434', true, true, '{}'::jsonb)
            RETURNING id::text AS id
            "#,
    )
    .bind(format!("M11 fixture endpoint {suffix}"))
    .fetch_one(pool)
    .await?;
    let endpoint_id: String = endpoint.try_get("id")?;
    let model = sqlx::query(
        r#"
            INSERT INTO ai_models(endpoint_id, name, installed, metadata)
            VALUES ($1::uuid, $2, true, '{}'::jsonb)
            RETURNING id::text AS id
            "#,
    )
    .bind(&endpoint_id)
    .bind(format!("m11-fixture-model-{suffix}"))
    .fetch_one(pool)
    .await?;
    let model_id: String = model.try_get("id")?;
    let job = sqlx::query(
        r#"
            INSERT INTO jobs(title, company_name, location_text, workplace_type, employment_type, seniority)
            VALUES ('M11 Rust Engineer', 'Review Co', 'Remote', 'remote', 'full-time', 'mid')
            RETURNING id::text AS id
            "#,
    )
    .fetch_one(pool)
    .await?;
    let job_id: String = job.try_get("id")?;

    sqlx::query(
        r#"
            INSERT INTO job_descriptions(job_id, content_hash, text, source)
            VALUES ($1::uuid, $2, 'Build Rust services with Tokio and PostgreSQL.', 'provider')
            "#,
    )
    .bind(&job_id)
    .bind(format!("m11-description-{suffix}"))
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
            INSERT INTO settings(key, value, description)
            VALUES
              ('ai.candidate_profile', '"Rust backend candidate"'::jsonb, 'test profile'),
              ('evaluation.rules', '"Prefer Rust, PostgreSQL and remote roles"'::jsonb, 'test rules'),
              ('ai.runtime', $1::jsonb, 'test runtime')
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                description = EXCLUDED.description,
                updated_at = now()
            "#,
    )
    .bind(json!({
        "modelName": format!("m11-fixture-model-{suffix}"),
        "priorityModelName": format!("m11-fixture-model-{suffix}"),
        "timeoutSeconds": 5
    }))
    .execute(pool)
    .await?;

    let fixture_output = if valid_json {
        json!({
            "decision": "apply",
            "score": 87,
            "seniority_fit": "good",
            "skill_fit": "good",
            "location_fit": "good",
            "blockers": [],
            "matching_points": ["Rust", "Tokio", "PostgreSQL"],
            "explicit_optional_matches": [],
            "mandatory_gaps": [],
            "caution_notes": [],
            "reason": "Strong backend fit"
        })
        .to_string()
    } else {
        "this is not json".to_string()
    };
    let payload = json!({
        "endpointId": endpoint_id,
        "endpointName": format!("M11 fixture endpoint {suffix}"),
        "fixtureAiOutput": fixture_output,
        "jobId": job_id,
        "mode": if valid_json { "manual" } else { "automatic" },
        "modelId": model_id,
        "modelName": format!("m11-fixture-model-{suffix}")
    });
    let activity = sqlx::query(
        r#"
            INSERT INTO activities(activity_type, status, subject_type, subject_id, payload, source, progress_total)
            VALUES ('ai_review', 'queued', 'job', $1::uuid, $2::jsonb, 'worker-test', 4)
            RETURNING id::text AS id
            "#,
    )
    .bind(&job_id)
    .bind(&payload)
    .fetch_one(pool)
    .await?;

    Ok(AiReviewFixture {
        activity_id: activity.try_get("id")?,
        job_id,
    })
}

async fn insert_export_fixture(pool: &PgPool, kind: &str) -> Result<String> {
    let activity = sqlx::query(
        r#"
            INSERT INTO activities(activity_type, status, subject_type, payload, source, progress_total)
            VALUES ('export', 'queued', $1, $2::jsonb, 'worker-test', 4)
            RETURNING id::text AS id
            "#,
    )
    .bind(if kind == "debug_bundle" {
        "debug"
    } else {
        "export"
    })
    .bind(json!({
        "kind": kind,
    }))
    .fetch_one(pool)
    .await?;

    activity.try_get("id").context("read export activity id")
}

async fn process_next_activity_of_type(
    pool: &PgPool,
    config: &WorkerConfig,
    metrics: &TestWorkerMetrics,
    mut shutdown_rx: watch::Receiver<bool>,
    expected_type: &str,
) -> Result<String> {
    let activity = claim_next_activity(pool, config)
        .await?
        .with_context(|| format!("expected {expected_type} activity"))?;
    assert_eq!(activity.activity_type, expected_type);
    let activity_id = activity.id.clone();
    process_activity(pool, config, metrics, activity, &mut shutdown_rx).await?;
    Ok(activity_id)
}

async fn insert_linkedin_collect_fixture(pool: &PgPool) -> Result<LinkedInCollectFixture> {
    let provider = sqlx::query(
        r#"
            INSERT INTO providers(provider_key, name, enabled, config)
            VALUES ('linkedin', 'LinkedIn', true, '{}'::jsonb)
            ON CONFLICT (provider_key) DO UPDATE SET enabled = true
            RETURNING id::text AS id
            "#,
    )
    .fetch_one(pool)
    .await?;
    let provider_id: String = provider.try_get("id")?;
    let search_query = json!({
        "distance": "25",
        "exactMatch": false,
        "experienceLevels": ["1", "2"],
        "geoId": "103350119",
        "keywords": "Rust Engineer",
        "location": "Italy",
        "providerKey": "linkedin",
        "publicUrl": "https://www.linkedin.com/jobs/search/?keywords=Rust+Engineer&location=Italy&geoId=103350119&distance=25&f_E=1,2&position=1&pageNum=0",
    });
    let search = sqlx::query(
        r#"
            INSERT INTO searches(provider_id, name, query, enabled)
            VALUES ($1::uuid, 'M7 fixture search', $2::jsonb, true)
            RETURNING id::text AS id
            "#,
    )
    .bind(&provider_id)
    .bind(&search_query)
    .fetch_one(pool)
    .await?;
    let search_id: String = search.try_get("id")?;
    let existing_job = sqlx::query(
            r#"
            INSERT INTO jobs(title, company_name, location_text, availability_status, source_url, provider_url)
            VALUES ('Old title', 'Old company', 'Old location', 'unavailable', 'https://www.linkedin.com/jobs/view/m7-1/', 'https://www.linkedin.com/jobs/view/m7-1/')
            RETURNING id::text AS id
            "#,
        )
        .fetch_one(pool)
        .await?;
    let existing_job_id: String = existing_job.try_get("id")?;

    sqlx::query(
            r#"
            INSERT INTO external_jobs(provider_id, job_id, external_id, external_url, metadata)
            VALUES ($1::uuid, $2::uuid, 'm7-1', 'https://www.linkedin.com/jobs/view/m7-1/', '{}'::jsonb)
            "#,
        )
        .bind(&provider_id)
        .bind(&existing_job_id)
        .execute(pool)
        .await?;

    let stale_job = sqlx::query(
            r#"
            INSERT INTO jobs(title, company_name, location_text, source_url, provider_url)
            VALUES ('Stale title', 'Stale company', 'Stale location', 'https://www.linkedin.com/jobs/view/m7-stale/', 'https://www.linkedin.com/jobs/view/m7-stale/')
            RETURNING id::text AS id
            "#,
        )
        .fetch_one(pool)
        .await?;
    let stale_job_id: String = stale_job.try_get("id")?;

    sqlx::query(
            r#"
            INSERT INTO external_jobs(provider_id, job_id, external_id, external_url, metadata)
            VALUES ($1::uuid, $2::uuid, 'm7-stale', 'https://www.linkedin.com/jobs/view/m7-stale/', '{}'::jsonb)
            "#,
        )
        .bind(&provider_id)
        .bind(&stale_job_id)
        .execute(pool)
        .await?;
    sqlx::query(
        r#"
            INSERT INTO job_search_presence(job_id, search_id, metadata)
            VALUES ($1::uuid, $2::uuid, '{"provider":"linkedin","externalId":"m7-stale"}'::jsonb)
            "#,
    )
    .bind(&stale_job_id)
    .bind(&search_id)
    .execute(pool)
    .await?;

    let payload = json!({
        "fixturePages": [
            {
                "payload": {
                    "data": {
                        "paging": { "total": 3 },
                        "elements": [
                            {
                                "jobPostingId": "m7-1",
                                "title": "Updated Frontend Engineer",
                                "companyName": "Acme",
                                "formattedLocation": "Milan, Italy",
                                "jobPostingUrl": "https://www.linkedin.com/jobs/view/m7-1/"
                            },
                            {
                                "jobPostingId": "m7-2",
                                "title": "Backend Engineer",
                                "companyName": "Beta",
                                "formattedLocation": "Remote",
                                "jobPostingUrl": "https://www.linkedin.com/jobs/view/m7-2/"
                            }
                        ]
                    }
                }
            },
            {
                "payload": {
                    "data": {
                        "paging": { "total": 3 },
                        "elements": [
                            {
                                "jobPostingId": "m7-3",
                                "title": "Platform Engineer",
                                "companyName": "Gamma",
                                "formattedLocation": "Rome, Italy",
                                "jobPostingUrl": "https://www.linkedin.com/jobs/view/m7-3/"
                            }
                        ]
                    }
                }
            }
        ],
        "fixtureDescriptions": {
            "m7-1": { "html": "<p>Updated frontend role</p>" },
            "m7-2": { "text": "Backend role description" },
            "m7-3": { "text": "Platform role description" }
        },
        "fixtureAvailabilities": {
            "m7-stale": { "available": false, "httpStatus": 404 }
        },
        "providerKey": "linkedin",
        "searchId": search_id
    });
    let activity = sqlx::query(
        r#"
            INSERT INTO activities(activity_type, status, subject_type, subject_id, payload, source)
            VALUES ('linkedin_collect', 'queued', 'search', $1::uuid, $2::jsonb, 'worker-test')
            RETURNING id::text AS id
            "#,
    )
    .bind(&search_id)
    .bind(&payload)
    .fetch_one(pool)
    .await?;

    Ok(LinkedInCollectFixture {
        activity_id: activity.try_get("id")?,
        provider_id,
        search_id,
    })
}

async fn read_job_id_by_external_id(
    pool: &PgPool,
    provider_id: &str,
    external_id: &str,
) -> Result<String> {
    let row = sqlx::query(
        r#"
            SELECT job_id::text AS job_id
            FROM external_jobs
            WHERE provider_id = $1::uuid
              AND external_id = $2
            "#,
    )
    .bind(provider_id)
    .bind(external_id)
    .fetch_one(pool)
    .await?;

    Ok(row.try_get("job_id")?)
}

async fn insert_linkedin_description_fixture_activity(
    pool: &PgPool,
    provider_id: &str,
    external_id: &str,
    text: &str,
) -> Result<String> {
    let job_id = read_job_id_by_external_id(pool, provider_id, external_id).await?;
    let payload = json!({
        "externalId": external_id,
        "fixtureDescription": { "text": text },
        "jobId": job_id,
        "providerKey": "linkedin",
    });
    let row = sqlx::query(
        r#"
            INSERT INTO activities(activity_type, status, subject_type, subject_id, payload, source)
            VALUES ('linkedin_describe', 'queued', 'job', $1::uuid, $2::jsonb, 'worker-test')
            RETURNING id::text AS id
            "#,
    )
    .bind(&job_id)
    .bind(&payload)
    .fetch_one(pool)
    .await?;

    Ok(row.try_get("id")?)
}

async fn insert_linkedin_availability_fixture_activity(
    pool: &PgPool,
    provider_id: &str,
    external_id: &str,
    available: bool,
) -> Result<String> {
    let job_id = read_job_id_by_external_id(pool, provider_id, external_id).await?;
    let payload = json!({
        "externalId": external_id,
        "fixtureAvailability": {
            "available": available,
            "httpStatus": if available { 200 } else { 404 }
        },
        "jobId": job_id,
        "providerKey": "linkedin",
    });
    let row = sqlx::query(
        r#"
            INSERT INTO activities(activity_type, status, subject_type, subject_id, payload, source)
            VALUES ('linkedin_availability', 'queued', 'job', $1::uuid, $2::jsonb, 'worker-test')
            RETURNING id::text AS id
            "#,
    )
    .bind(&job_id)
    .bind(&payload)
    .fetch_one(pool)
    .await?;

    Ok(row.try_get("id")?)
}

async fn assert_activity_status(pool: &PgPool, activity_id: &str, status: &str) -> Result<()> {
    let row = sqlx::query("SELECT status FROM activities WHERE id = $1::uuid")
        .bind(activity_id)
        .fetch_one(pool)
        .await?;
    let actual: String = row.try_get("status")?;
    assert_eq!(actual, status);
    Ok(())
}

async fn assert_linkedin_collection_results(
    pool: &PgPool,
    fixture: &LinkedInCollectFixture,
) -> Result<()> {
    let counts = sqlx::query(
            r#"
            SELECT
              (SELECT COUNT(*)::bigint FROM raw_payloads WHERE activity_id = $1::uuid) AS raw_count,
              (SELECT COUNT(*)::bigint FROM external_jobs WHERE provider_id = $2::uuid) AS external_count,
              (SELECT COUNT(*)::bigint FROM job_search_presence WHERE search_id = $3::uuid) AS presence_count,
              (SELECT COUNT(*)::bigint FROM jobs) AS jobs_count,
              (SELECT COUNT(*)::bigint FROM activities WHERE activity_type = 'linkedin_describe' AND status = 'queued') AS description_queue_count,
              (SELECT COUNT(*)::bigint FROM activities WHERE activity_type = 'linkedin_availability' AND status = 'queued') AS availability_queue_count
            "#,
        )
        .bind(&fixture.activity_id)
        .bind(&fixture.provider_id)
        .bind(&fixture.search_id)
        .fetch_one(pool)
        .await?;

    let raw_count: i64 = counts.try_get("raw_count")?;
    let external_count: i64 = counts.try_get("external_count")?;
    let presence_count: i64 = counts.try_get("presence_count")?;
    let jobs_count: i64 = counts.try_get("jobs_count")?;
    let description_queue_count: i64 = counts.try_get("description_queue_count")?;
    let availability_queue_count: i64 = counts.try_get("availability_queue_count")?;

    assert_eq!(raw_count, 2);
    assert_eq!(external_count, 4);
    assert_eq!(presence_count, 3);
    assert_eq!(jobs_count, 4);
    assert_eq!(description_queue_count, 3);
    assert_eq!(availability_queue_count, 1);

    let updated = sqlx::query(
        r#"
            SELECT
              jobs.title,
              jobs.availability_status,
              searches.last_run_at IS NOT NULL AS search_ran,
              activities.payload #>> '{stats,descriptionsQueued}' AS descriptions_queued,
              activities.payload #>> '{stats,availabilityQueued}' AS availability_queued,
              activities.payload #>> '{stats,jobsMarkedMissing}' AS jobs_marked_missing
            FROM external_jobs
            JOIN jobs ON jobs.id = external_jobs.job_id
            CROSS JOIN searches
            CROSS JOIN activities
            WHERE external_jobs.provider_id = $1::uuid
              AND external_jobs.external_id = 'm7-1'
              AND searches.id = $2::uuid
              AND activities.id = $3::uuid
            "#,
    )
    .bind(&fixture.provider_id)
    .bind(&fixture.search_id)
    .bind(&fixture.activity_id)
    .fetch_one(pool)
    .await?;
    let title: String = updated.try_get("title")?;
    let availability_status: String = updated.try_get("availability_status")?;
    let search_ran: bool = updated.try_get("search_ran")?;
    let descriptions_queued: String = updated.try_get("descriptions_queued")?;
    let availability_queued: String = updated.try_get("availability_queued")?;
    let jobs_marked_missing: String = updated.try_get("jobs_marked_missing")?;

    assert_eq!(title, "Updated Frontend Engineer");
    assert_eq!(availability_status, "active");
    assert!(search_ran);
    assert_eq!(descriptions_queued, "3");
    assert_eq!(availability_queued, "1");
    assert_eq!(jobs_marked_missing, "1");

    assert_job_availability(
        pool,
        &fixture.provider_id,
        "m7-stale",
        "missing_from_searches",
    )
    .await?;

    Ok(())
}

async fn assert_linkedin_m9_followups(
    pool: &PgPool,
    fixture: &LinkedInCollectFixture,
) -> Result<()> {
    let counts = sqlx::query(
        r#"
            SELECT
              (SELECT COUNT(*)::bigint FROM job_descriptions) AS description_count,
              (SELECT COUNT(DISTINCT job_id)::bigint FROM job_descriptions) AS described_jobs
            "#,
    )
    .fetch_one(pool)
    .await?;
    let description_count: i64 = counts.try_get("description_count")?;
    let described_jobs: i64 = counts.try_get("described_jobs")?;

    assert_eq!(description_count, 3);
    assert_eq!(described_jobs, 3);
    assert_description_count(pool, &fixture.provider_id, "m7-1", 1).await?;
    assert_job_availability(pool, &fixture.provider_id, "m7-stale", "unavailable").await?;

    Ok(())
}

async fn assert_description_count(
    pool: &PgPool,
    provider_id: &str,
    external_id: &str,
    expected: i64,
) -> Result<()> {
    let row = sqlx::query(
        r#"
            SELECT COUNT(*)::bigint AS count
            FROM job_descriptions
            JOIN external_jobs ON external_jobs.job_id = job_descriptions.job_id
            WHERE external_jobs.provider_id = $1::uuid
              AND external_jobs.external_id = $2
            "#,
    )
    .bind(provider_id)
    .bind(external_id)
    .fetch_one(pool)
    .await?;
    let actual: i64 = row.try_get("count")?;
    assert_eq!(actual, expected);
    Ok(())
}

async fn assert_job_availability(
    pool: &PgPool,
    provider_id: &str,
    external_id: &str,
    expected: &str,
) -> Result<()> {
    let row = sqlx::query(
        r#"
            SELECT jobs.availability_status
            FROM external_jobs
            JOIN jobs ON jobs.id = external_jobs.job_id
            WHERE external_jobs.provider_id = $1::uuid
              AND external_jobs.external_id = $2
            "#,
    )
    .bind(provider_id)
    .bind(external_id)
    .fetch_one(pool)
    .await?;
    let actual: String = row.try_get("availability_status")?;
    assert_eq!(actual, expected);
    Ok(())
}

async fn assert_model_installed(pool: &PgPool, model_id: &str) -> Result<()> {
    let row = sqlx::query(
        r#"
            SELECT
              installed,
              metadata ? 'lastInstallActivityId' AS has_install_activity
            FROM ai_models
            WHERE id = $1::uuid
            "#,
    )
    .bind(model_id)
    .fetch_one(pool)
    .await?;
    let installed: bool = row.try_get("installed")?;
    let has_install_activity: bool = row.try_get("has_install_activity")?;

    assert!(installed);
    assert!(has_install_activity);
    Ok(())
}

async fn assert_ai_review_success(pool: &PgPool, job_id: &str) -> Result<()> {
    let row = sqlx::query(
        r#"
            SELECT status, decision, score, result, raw_output, error, metrics
            FROM job_reviews
            WHERE job_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT 1
            "#,
    )
    .bind(job_id)
    .fetch_one(pool)
    .await?;
    let status: String = row.try_get("status")?;
    let decision: String = row.try_get("decision")?;
    let score: i32 = row.try_get("score")?;
    let result: serde_json::Value = row.try_get("result")?;
    let raw_output: Option<String> = row.try_get("raw_output")?;
    let error: Option<String> = row.try_get("error")?;
    let metrics: serde_json::Value = row.try_get("metrics")?;

    assert_eq!(status, "success");
    assert_eq!(decision, "apply");
    assert_eq!(score, 87);
    assert_eq!(result["skill_fit"], "good");
    assert!(raw_output.is_some());
    assert!(error.is_none());
    assert_eq!(metrics["mode"], "manual");
    Ok(())
}

async fn assert_ai_review_failed(pool: &PgPool, job_id: &str) -> Result<()> {
    let row = sqlx::query(
        r#"
            SELECT status, decision, score, result, raw_output, error, metrics
            FROM job_reviews
            WHERE job_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT 1
            "#,
    )
    .bind(job_id)
    .fetch_one(pool)
    .await?;
    let status: String = row.try_get("status")?;
    let decision: Option<String> = row.try_get("decision")?;
    let score: Option<i32> = row.try_get("score")?;
    let result: serde_json::Value = row.try_get("result")?;
    let raw_output: Option<String> = row.try_get("raw_output")?;
    let error: Option<String> = row.try_get("error")?;
    let metrics: serde_json::Value = row.try_get("metrics")?;

    assert_eq!(status, "failed");
    assert!(decision.is_none());
    assert!(score.is_none());
    assert!(raw_output.as_deref() == Some("this is not json"));
    let error = error.context("failed review should store an error")?;
    assert!(error.contains("not valid JSON"));
    assert_eq!(result["diagnostic"].as_str(), Some(error.as_str()));
    assert_eq!(metrics["mode"], "automatic");
    Ok(())
}

async fn assert_export_artifact(
    pool: &PgPool,
    activity_id: &str,
    expected_kind: &str,
) -> Result<()> {
    let row = sqlx::query(
        r#"
            SELECT payload
            FROM activities
            WHERE id = $1::uuid
            "#,
    )
    .bind(activity_id)
    .fetch_one(pool)
    .await?;
    let payload: serde_json::Value = row.try_get("payload")?;
    let artifact = payload
        .get("artifact")
        .context("export activity should store an artifact")?;

    assert_eq!(artifact["kind"], expected_kind);
    assert!(artifact["byteLength"].as_u64().unwrap_or_default() > 0);
    assert!(
        artifact["fileName"]
            .as_str()
            .is_some_and(|value| value.starts_with("joblens-"))
    );

    let content = artifact["content"]
        .as_str()
        .context("export artifact should contain content")?;
    if expected_kind == "jobs_reviews_jsonl" {
        assert!(content.contains("M11 Rust Engineer"));
        assert!(content.contains("m11-fixture-model"));
    } else {
        assert!(content.contains("\"counts\""));
        assert!(content.contains("\"queue\""));
        assert!(!content.contains("Rust backend candidate"));
        assert!(!content.contains("Prefer Rust, PostgreSQL and remote roles"));
    }

    Ok(())
}

async fn assert_activity_has_logs(pool: &PgPool, activity_id: &str) -> Result<()> {
    let row = sqlx::query(
        "SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE activity_id = $1::uuid",
    )
    .bind(activity_id)
    .fetch_one(pool)
    .await?;
    let count: i64 = row.try_get("count")?;
    assert!(count >= 2);
    Ok(())
}

async fn read_activity_lease_owner(pool: &PgPool, activity_id: &str) -> Result<String> {
    let row = sqlx::query("SELECT lease_owner FROM activities WHERE id = $1::uuid")
        .bind(activity_id)
        .fetch_one(pool)
        .await?;
    Ok(row.try_get("lease_owner")?)
}

async fn cleanup_test_activities(pool: &PgPool, test_prefix: &str) -> Result<()> {
    sqlx::query(
        r#"
            DELETE FROM activity_logs
            WHERE activity_id IN (
              SELECT id
              FROM activities
              WHERE source = 'worker-test'
                OR activity_type LIKE $1 || '%'
            )
            "#,
    )
    .bind(test_prefix)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
            DELETE FROM activities
            WHERE source = 'worker-test'
              OR activity_type LIKE $1 || '%'
            "#,
    )
    .bind(test_prefix)
    .execute(pool)
    .await?;

    Ok(())
}
