import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrations.js';
import { createDatabasePool, type DatabasePool } from '../src/db/pool.js';

const { Client } = pg;
const DEFAULT_DATABASE_URL = 'postgresql://joblens:joblens@localhost:5432/joblens';
const EXPECTED_TABLES = [
  'activities',
  'activity_logs',
  'ai_endpoints',
  'ai_models',
  'external_jobs',
  'job_descriptions',
  'job_reviews',
  'job_search_presence',
  'jobs',
  'provider_sessions',
  'providers',
  'raw_payloads',
  'schema_migrations',
  'searches',
  'settings',
];
const LINKEDIN_TEST_HAR = {
  log: {
    entries: [
      {
        request: {
          headers: [
            {
              name: 'cookie',
              value: 'li_at=test-session; JSESSIONID="ajax:123456789"',
            },
            {
              name: 'csrf-token',
              value: 'ajax:123456789',
            },
            {
              name: 'user-agent',
              value: 'Mozilla/5.0 Test Browser',
            },
            {
              name: 'accept-language',
              value: 'en-US,en;q=0.9',
            },
            {
              name: 'x-li-lang',
              value: 'en_US',
            },
            {
              name: 'x-restli-protocol-version',
              value: '2.0.0',
            },
          ],
          method: 'GET',
          queryString: [
            { name: 'decorationId', value: 'test-decoration' },
            { name: 'count', value: '25' },
            { name: 'start', value: '0' },
          ],
          url:
            'https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards?' +
            'decorationId=test-decoration&count=25&start=0&q=jobSearch&' +
            'query=(origin:JOB_SEARCH_PAGE_JOB_FILTER,selectedFilters:(experience:List(1,2)))',
        },
      },
    ],
  },
};
const LINKEDIN_PUBLIC_SEARCH_HAR = {
  log: {
    entries: [
      {
        request: {
          headers: [
            {
              name: 'cookie',
              value: 'li_at=test-session; JSESSIONID="ajax:123456789"',
            },
            {
              name: 'user-agent',
              value: 'Mozilla/5.0 Test Browser',
            },
            {
              name: 'accept-language',
              value: 'en-US,en;q=0.9',
            },
          ],
          method: 'GET',
          queryString: [
            { name: 'keywords', value: 'React Developer' },
            { name: 'location', value: 'Italy' },
          ],
          url: 'https://www.linkedin.com/jobs/search/?keywords=React+Developer&location=Italy',
        },
      },
    ],
  },
};

function getDatabaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

function getAdminDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function getTemporaryDatabaseName(): string {
  return `joblens_schema_test_${process.pid}_${Date.now()}`;
}

describe('database migrations', () => {
  let adminClient: pg.Client;
  let databaseName: string;
  let databaseUrl: string;
  let pool: DatabasePool;

  beforeAll(async () => {
    const baseDatabaseUrl = getDatabaseUrl();
    const url = new URL(baseDatabaseUrl);
    databaseName = getTemporaryDatabaseName();
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();

    adminClient = new Client({ connectionString: getAdminDatabaseUrl(baseDatabaseUrl) });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

    pool = createDatabasePool(databaseUrl);
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await adminClient.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
      `,
      [databaseName],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    await adminClient.end();
  }, 30_000);

  it('creates the initial schema and base seed data idempotently', async () => {
    const firstRun = await runMigrations(pool);
    const secondRun = await runMigrations(pool);

    expect(firstRun.applied.map((migration) => migration.id)).toEqual([1, 2, 3]);
    expect(firstRun.latestVersion).toBe(3);
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.latestVersion).toBe(3);

    const tables = await pool.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name ASC
      `,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);

    const providers = await pool.query<{ provider_key: string }>(
      'SELECT provider_key FROM providers ORDER BY provider_key ASC',
    );
    expect(providers.rows).toEqual([{ provider_key: 'linkedin' }]);

    const settings = await pool.query<{ key: string }>('SELECT key FROM settings ORDER BY key ASC');
    expect(settings.rows.map((row) => row.key)).toEqual([
      'ai.active_endpoint_id',
      'ai.enabled',
      'app.name',
      'app.schema_target',
      'evaluation.rules.template_version',
    ]);
  }, 30_000);

  it('allows the API to read schema version and base settings', async () => {
    await runMigrations(pool);
    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });

    const schemaResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/schema',
    });
    const settingsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/base',
    });

    await app.close();

    expect(schemaResponse.statusCode).toBe(200);
    expect(schemaResponse.json()).toMatchObject({
      data: {
        schemaVersion: 3,
      },
    });
    expect(settingsResponse.statusCode).toBe(200);
    expect(settingsResponse.json()).toMatchObject({
      data: {
        providers: [{ key: 'linkedin', name: 'LinkedIn', enabled: true }],
        schemaVersion: 3,
      },
    });
  }, 30_000);

  it('serves minimal settings and read-only activities endpoints', async () => {
    await runMigrations(pool);
    const insertedActivity = await pool.query<{ id: string }>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          message,
          payload,
          progress_current,
          progress_total,
          source
        )
        VALUES (
          'dummy',
          'queued',
          'Waiting for worker',
          '{"kind":"test"}'::jsonb,
          0,
          1,
          'test'
        )
        RETURNING id
      `,
    );
    const activityId = insertedActivity.rows[0]?.id;
    expect(activityId).toBeTruthy();

    await pool.query(
      `
        INSERT INTO activity_logs(activity_id, level, message, data)
        VALUES ($1, 'info', 'Queued activity', '{"step":1}'::jsonb)
      `,
      [activityId],
    );

    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });

    const settingsListResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/settings?prefix=app.&limit=10&offset=0',
    });
    const settingResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/app.name',
    });
    const activitiesResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/activities?status=queued&type=dummy&limit=10&offset=0',
    });
    const activityResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${activityId}`,
    });
    const logsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${activityId}/logs`,
    });

    await app.close();

    expect(settingsListResponse.statusCode).toBe(200);
    expect(settingsListResponse.json()).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ key: 'app.name', value: 'JobLens' }),
      ]),
      meta: {
        limit: 10,
        offset: 0,
      },
    });
    expect(settingResponse.statusCode).toBe(200);
    expect(settingResponse.json()).toMatchObject({
      data: {
        key: 'app.name',
        value: 'JobLens',
      },
    });
    expect(activitiesResponse.statusCode).toBe(200);
    expect(activitiesResponse.json()).toMatchObject({
      data: [
        expect.objectContaining({
          activityType: 'dummy',
          id: activityId,
          message: 'Waiting for worker',
          status: 'queued',
        }),
      ],
      meta: {
        limit: 10,
        offset: 0,
        total: 1,
      },
    });
    expect(activityResponse.statusCode).toBe(200);
    expect(activityResponse.json()).toMatchObject({
      data: {
        activityType: 'dummy',
        id: activityId,
        status: 'queued',
      },
    });
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json()).toMatchObject({
      data: [
        expect.objectContaining({
          activityId,
          level: 'info',
          message: 'Queued activity',
        }),
      ],
    });
  }, 30_000);

  it('creates, cancels, and retries activities through the API', async () => {
    await runMigrations(pool);
    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });

    const createResponse = await app.inject({
      method: 'POST',
      payload: {
        payload: { scenario: 'm5' },
        type: 'dummy',
      },
      url: '/api/v1/activities',
    });
    const created = createResponse.json().data;
    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/activities/${created.id}/cancel`,
    });
    const cancelled = cancelResponse.json().data;
    const invalidRetryResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/activities/${created.id}/retry`,
    });
    const failedActivity = await pool.query<{ id: string }>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          phase,
          message,
          error,
          source,
          progress_current,
          progress_total
        )
        VALUES (
          'dummy',
          'failed',
          'failed',
          'Activity failed',
          'boom',
          'test',
          2,
          5
        )
        RETURNING id
      `,
    );
    const failedActivityId = failedActivity.rows[0]?.id;
    expect(failedActivityId).toBeTruthy();

    const retryResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/activities/${failedActivityId}/retry`,
    });
    const queueType = 'queue_cancel_test';
    const queueSource = 'api-test';
    const queuedForQueueCancel = await pool.query<{ id: string }>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          phase,
          message,
          source,
          payload,
          progress_current,
          progress_total
        )
        VALUES (
          $1,
          'queued',
          'queued',
          'Queued for bulk cancellation',
          $2,
          '{"scenario":"queue-cancel"}'::jsonb,
          0,
          1
        )
        RETURNING id
      `,
      [queueType, queueSource],
    );
    const runningForQueueCancel = await pool.query<{ id: string }>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          phase,
          message,
          source,
          payload,
          progress_current,
          progress_total,
          lease_owner,
          lease_expires_at,
          started_at
        )
        VALUES (
          $1,
          'running',
          'running',
          'Running for bulk cancellation',
          $2,
          '{"scenario":"queue-cancel"}'::jsonb,
          1,
          2,
          'worker-test',
          now() + interval '10 minutes',
          now()
        )
        RETURNING id
      `,
      [queueType, queueSource],
    );
    const otherQueuedActivity = await pool.query<{ id: string }>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          phase,
          message,
          source,
          payload,
          progress_current,
          progress_total
        )
        VALUES (
          $1,
          'queued',
          'queued',
          'Queued outside bulk cancellation source',
          'other-source',
          '{"scenario":"queue-cancel-other"}'::jsonb,
          0,
          1
        )
        RETURNING id
      `,
      [queueType],
    );
    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/activities/summary?activeLimit=25',
    });
    const queueCancelResponse = await app.inject({
      method: 'POST',
      payload: {
        source: queueSource,
        type: queueType,
      },
      url: '/api/v1/activities/cancel',
    });
    const queueCancel = queueCancelResponse.json().data;
    const otherQueuedStatus = await pool.query<{ status: string }>(
      'SELECT status FROM activities WHERE id = $1::uuid',
      [otherQueuedActivity.rows[0]?.id],
    );
    const queueCancelLogs = await pool.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM activity_logs
        WHERE activity_id = ANY($1::uuid[])
      `,
      [[queuedForQueueCancel.rows[0]?.id, runningForQueueCancel.rows[0]?.id]],
    );
    const logsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${failedActivityId}/logs`,
    });

    await app.close();

    expect(createResponse.statusCode).toBe(201);
    expect(created).toMatchObject({
      activityType: 'dummy',
      payload: { scenario: 'm5' },
      progressCurrent: 0,
      progressTotal: 5,
      status: 'queued',
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelled).toMatchObject({
      id: created.id,
      status: 'cancelled',
    });
    expect(cancelled.cancelRequestedAt).toBeTruthy();
    expect(invalidRetryResponse.statusCode).toBe(409);
    expect(invalidRetryResponse.json()).toMatchObject({
      error: {
        code: 'conflict',
      },
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json()).toMatchObject({
      data: {
        error: null,
        id: failedActivityId,
        message: 'Retry queued',
        progressCurrent: 0,
        status: 'queued',
      },
    });
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toMatchObject({
      data: {
        active: expect.arrayContaining([
          expect.objectContaining({
            activityType: queueType,
            id: queuedForQueueCancel.rows[0]?.id,
            status: 'queued',
          }),
          expect.objectContaining({
            activityType: queueType,
            id: runningForQueueCancel.rows[0]?.id,
            status: 'running',
          }),
        ]),
        byType: expect.arrayContaining([
          expect.objectContaining({
            key: queueType,
          }),
        ]),
      },
    });
    expect(
      summaryResponse.json().data.byType.find((item: { key: string }) => item.key === queueType)
        ?.count,
    ).toBeGreaterThanOrEqual(3);
    expect(queueCancelResponse.statusCode).toBe(200);
    expect(queueCancel).toMatchObject({
      cancelled: 1,
      requested: 1,
      total: 2,
    });
    expect(queueCancel.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: queuedForQueueCancel.rows[0]?.id,
          status: 'cancelled',
        }),
        expect.objectContaining({
          cancelRequestedAt: expect.any(String),
          id: runningForQueueCancel.rows[0]?.id,
          status: 'running',
        }),
      ]),
    );
    expect(otherQueuedStatus.rows[0]?.status).toBe('queued');
    expect(queueCancelLogs.rows[0]?.total).toBe('2');
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json()).toMatchObject({
      data: [
        expect.objectContaining({
          activityId: failedActivityId,
          level: 'info',
          message: 'Retry queued',
        }),
      ],
    });
  }, 30_000);

  it('serves sanitized LinkedIn raw payload debug for failed activities', async () => {
    await runMigrations(pool);
    const provider = await pool.query<{ id: string }>(
      "SELECT id::text AS id FROM providers WHERE provider_key = 'linkedin'",
    );
    const providerId = provider.rows[0]?.id;
    expect(providerId).toBeTruthy();
    const insertedActivity = await pool.query<{ id: string }>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          phase,
          message,
          error,
          payload,
          progress_current,
          progress_total,
          source
        )
        VALUES (
          'linkedin_collect',
          'failed',
          'collecting',
          'LinkedIn collection failed',
          'LinkedIn collection failed with HTTP 500',
          '{"providerKey":"linkedin","e2eRunId":"api-linkedin-debug"}'::jsonb,
          0,
          1,
          'test'
        )
        RETURNING id::text AS id
      `,
    );
    const activityId = insertedActivity.rows[0]?.id;
    expect(activityId).toBeTruthy();

    await pool.query(
      `
        INSERT INTO raw_payloads(
          provider_id,
          activity_id,
          request_url,
          request_params,
          response_status,
          content_type,
          elapsed_ms,
          payload
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          'https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards?csrf-token=secret-token&li_at=secret-cookie',
          '{"cookie":"li_at=secret-cookie; JSESSIONID=\\"ajax:secret-session\\"","query":"jobSearch"}'::jsonb,
          500,
          'application/json',
          123,
          '{"message":"LinkedIn upstream exploded","li_at":"secret-cookie","nested":{"JSESSIONID":"ajax:secret-session"}}'::jsonb
        )
      `,
      [providerId, activityId],
    );

    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${activityId}/linkedin-debug?limit=5`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload).toMatchObject({
      data: {
        activityId,
        failed: 1,
        latestStatus: 500,
        providerKey: 'linkedin',
        statusCounts: [{ count: 1, status: '500' }],
        total: 1,
      },
    });
    const item = payload.data.items[0];
    expect(item).toMatchObject({
      contentType: 'application/json',
      error: 'LinkedIn upstream exploded',
      responseStatus: 500,
    });
    expect(item.requestParams.cookie).toBe('[redacted]');
    expect(item.snippet).toContain('LinkedIn upstream exploded');
    expect(JSON.stringify(payload)).not.toContain('secret-cookie');
    expect(JSON.stringify(payload)).not.toContain('secret-session');
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  }, 30_000);

  it('serves jobs with server-side filters, detail state updates, and sanitized export', async () => {
    await runMigrations(pool);
    const provider = await pool.query<{ id: string }>(
      "SELECT id FROM providers WHERE provider_key = 'linkedin'",
    );
    const providerId = provider.rows[0]?.id;
    expect(providerId).toBeTruthy();

    const search = await pool.query<{ id: string }>(
      `
        INSERT INTO searches(provider_id, name, query, enabled)
        VALUES (
          $1,
          'M8 React Italy',
          '{
            "currentJobId": null,
            "distance": "25",
            "exactMatch": false,
            "experienceLevels": ["1", "2", "3"],
            "geoId": "103350119",
            "keywords": "React",
            "location": "Italy",
            "preservedParams": {},
            "providerKey": "linkedin",
            "publicUrl": "https://www.linkedin.com/jobs/search/?keywords=React&location=Italy",
            "unsupportedParams": {},
            "workplaceTypes": []
          }'::jsonb,
          true
        )
        RETURNING id
      `,
      [providerId],
    );
    const searchId = search.rows[0]?.id;
    expect(searchId).toBeTruthy();

    const insertedJobs = await pool.query<{ id: string; title: string }>(
      `
        INSERT INTO jobs(
          title,
          company_name,
          location_text,
          workplace_type,
          published_at,
          local_status,
          availability_status,
          provider_url,
          metadata
        )
        VALUES
          (
            'M8 Frontend Engineer',
            'Acme',
            'Milan, Italy',
            'Ibrido',
            '2026-06-01T10:00:00Z',
            'new',
            'active',
            'https://www.linkedin.com/jobs/view/m8-frontend',
            '{"rawCard":{"secret":"do-not-export"}}'::jsonb
          ),
          (
            'M8 Outside Search Engineer',
            'Outside',
            'Remote',
            'Remote',
            '2026-06-03T10:00:00Z',
            'new',
            'active',
            'https://www.linkedin.com/jobs/view/m8-outside',
            '{"rawCard":{"secret":"do-not-export"}}'::jsonb
          ),
          (
            'M8 Saved Backend Engineer',
            'Beta',
            'Rome, Italy',
            'In sede',
            '2026-06-02T10:00:00Z',
            'saved',
            'active',
            'https://www.linkedin.com/jobs/view/m8-backend',
            '{}'::jsonb
          )
        RETURNING id, title
      `,
    );
    const frontendJobId = insertedJobs.rows.find((job) => job.title.includes('Frontend'))?.id;
    const outsideJobId = insertedJobs.rows.find((job) => job.title.includes('Outside'))?.id;
    const backendJobId = insertedJobs.rows.find((job) => job.title.includes('Backend'))?.id;
    expect(frontendJobId).toBeTruthy();
    expect(outsideJobId).toBeTruthy();
    expect(backendJobId).toBeTruthy();

    await pool.query(
      `
        INSERT INTO external_jobs(provider_id, job_id, external_id, external_url)
        VALUES
          ($1, $2, 'm8-frontend', 'https://www.linkedin.com/jobs/view/m8-frontend'),
          ($1, $3, 'm8-outside', 'https://www.linkedin.com/jobs/view/m8-outside'),
          ($1, $4, 'm8-backend', 'https://www.linkedin.com/jobs/view/m8-backend')
      `,
      [providerId, frontendJobId, outsideJobId, backendJobId],
    );
    await pool.query(
      `
        INSERT INTO job_search_presence(job_id, search_id)
        VALUES ($1, $3), ($2, $3)
      `,
      [frontendJobId, backendJobId, searchId],
    );
    await pool.query(
      `
        INSERT INTO job_descriptions(job_id, content_hash, text, html, source)
        VALUES ($1, 'm8-description', 'Frontend role description', '<p>Frontend</p>', 'provider')
      `,
      [frontendJobId],
    );
    await pool.query(
      `
        INSERT INTO job_reviews(job_id, model_name, profile_hash, rules_hash, decision, score, result)
        VALUES ($1, 'm8-priority', 'profile', 'rules', 'apply', 88, '{"fit":"high"}'::jsonb)
      `,
      [frontendJobId],
    );

    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });

    const defaultListResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?text=M8&limit=1&offset=0&sortBy=publishedAt&sortDir=desc',
    });
    const savedFilterResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?text=M8&localStatus=saved&limit=10&offset=0',
    });
    const allScopeResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?text=M8&scope=all&limit=10&offset=0',
    });
    const remoteFilterResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?text=M8&scope=all&workplace=remote&limit=10&offset=0',
    });
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${frontendJobId}`,
    });
    const stateResponse = await app.inject({
      method: 'PATCH',
      payload: {
        localStatus: 'applied',
      },
      url: `/api/v1/jobs/${frontendJobId}/state`,
    });
    const exportResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${frontendJobId}/export`,
    });

    await app.close();
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [
      [frontendJobId, outsideJobId, backendJobId],
    ]);
    await pool.query('DELETE FROM searches WHERE id = $1', [searchId]);

    expect(defaultListResponse.statusCode).toBe(200);
    expect(defaultListResponse.json()).toMatchObject({
      data: [
        expect.objectContaining({
          id: backendJobId,
          localStatus: 'saved',
          title: 'M8 Saved Backend Engineer',
        }),
      ],
      meta: {
        limit: 1,
        offset: 0,
        total: 2,
      },
    });
    expect(JSON.stringify(defaultListResponse.json())).not.toContain('M8 Outside Search Engineer');

    expect(savedFilterResponse.statusCode).toBe(200);
    expect(savedFilterResponse.json()).toMatchObject({
      data: [expect.objectContaining({ id: backendJobId })],
      meta: {
        total: 1,
      },
    });

    expect(allScopeResponse.statusCode).toBe(200);
    expect(allScopeResponse.json()).toMatchObject({
      meta: {
        total: 3,
      },
    });

    expect(remoteFilterResponse.statusCode).toBe(200);
    expect(remoteFilterResponse.json()).toMatchObject({
      data: [expect.objectContaining({ id: outsideJobId, workplaceType: 'Remote' })],
      meta: {
        total: 1,
      },
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      data: {
        description: {
          html: '<p>Frontend</p>',
          htmlAvailable: true,
          text: 'Frontend role description',
        },
        externalJobs: [expect.objectContaining({ externalId: 'm8-frontend' })],
        latestReview: {
          decision: 'apply',
          modelName: 'm8-priority',
          score: 88,
        },
        searches: [expect.objectContaining({ searchId })],
      },
    });

    expect(stateResponse.statusCode).toBe(200);
    expect(stateResponse.json()).toMatchObject({
      data: {
        id: frontendJobId,
        localStatus: 'applied',
      },
    });

    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.json()).toMatchObject({
      data: {
        externalJobs: [expect.objectContaining({ externalId: 'm8-frontend' })],
        job: {
          id: frontendJobId,
          localStatus: 'applied',
        },
      },
    });
    expect(JSON.stringify(exportResponse.json())).not.toContain('rawCard');
    expect(JSON.stringify(exportResponse.json())).not.toContain('do-not-export');
  }, 30_000);

  it('manages AI configuration and queues offline model installs', async () => {
    await runMigrations(pool);
    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });
    const endpointName = `M10 Offline ${Date.now()}`;
    const modelName = `m10-test-model-${Date.now()}`;

    const defaultSettingsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/settings',
    });
    const saveSettingsResponse = await app.inject({
      method: 'PATCH',
      payload: {
        candidateProfile: 'M10 candidate profile',
        enabled: true,
        evaluationRules: 'M10 custom evaluation rules',
        pauses: [
          {
            dayOfWeek: 1,
            enabled: true,
            endTime: '18:00',
            startTime: '09:00',
          },
        ],
        runtime: {
          keepAlive: '5m',
          modelName: 'm10-review-model',
          numCtx: 4096,
          numPredict: 512,
          priorityModelName: 'm10-priority-model',
          retryAttempts: 2,
          retryDelaySeconds: 10,
          temperature: 0.4,
          think: true,
          timeoutSeconds: 45,
        },
      },
      url: '/api/v1/ai/settings',
    });
    const createEndpointResponse = await app.inject({
      method: 'POST',
      payload: {
        baseUrl: 'http://127.0.0.1:11434',
        enabled: true,
        name: endpointName,
      },
      url: '/api/v1/ai/endpoints',
    });
    const endpoint = createEndpointResponse.json().data;
    const activateEndpointResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/ai/endpoints/${endpoint.id}/activate`,
    });
    const installResponse = await app.inject({
      method: 'POST',
      payload: {
        modelName,
      },
      url: '/api/v1/ai/models/install',
    });
    const install = installResponse.json().data;
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: [
              {
                digest: 'sha256:m10-model',
                model: modelName,
                modified_at: '2026-06-26T10:00:00.000Z',
                name: modelName,
                size: 1024,
              },
              {
                model: 'm10-live-extra:latest',
                name: 'm10-live-extra:latest',
              },
            ],
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const syncModelsResponse = await (async () => {
      try {
        return await app.inject({
          method: 'POST',
          payload: {
            endpointId: endpoint.id,
          },
          url: '/api/v1/ai/models/sync',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    })();
    const modelsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/ai/models?endpointId=${endpoint.id}`,
    });
    const resetRulesResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/settings/rules/reset',
    });

    await app.close();
    await pool.query('DELETE FROM activity_logs WHERE activity_id = $1', [install.activity.id]);
    await pool.query('DELETE FROM activities WHERE id = $1', [install.activity.id]);
    await pool.query('DELETE FROM ai_models WHERE id = $1', [install.model.id]);
    await pool.query('DELETE FROM ai_endpoints WHERE id = $1', [endpoint.id]);
    await pool.query(
      "DELETE FROM settings WHERE key IN ('ai.candidate_profile', 'ai.pauses', 'ai.runtime', 'evaluation.rules')",
    );
    await pool.query("UPDATE settings SET value = 'false'::jsonb WHERE key = 'ai.enabled'");
    await pool.query(
      "UPDATE settings SET value = 'null'::jsonb WHERE key = 'ai.active_endpoint_id'",
    );

    expect(defaultSettingsResponse.statusCode).toBe(200);
    expect(defaultSettingsResponse.json()).toMatchObject({
      data: {
        activeEndpointId: null,
        enabled: false,
      },
    });

    expect(saveSettingsResponse.statusCode).toBe(200);
    expect(saveSettingsResponse.json()).toMatchObject({
      data: {
        candidateProfile: 'M10 candidate profile',
        enabled: true,
        evaluationRules: 'M10 custom evaluation rules',
        pauses: [
          {
            dayOfWeek: 1,
            enabled: true,
          },
        ],
        runtime: {
          modelName: 'm10-review-model',
          priorityModelName: 'm10-priority-model',
          think: true,
        },
      },
    });

    expect(createEndpointResponse.statusCode).toBe(201);
    expect(createEndpointResponse.json()).toMatchObject({
      data: {
        baseUrl: 'http://127.0.0.1:11434',
        enabled: true,
        isActive: false,
        name: endpointName,
      },
    });
    expect(activateEndpointResponse.statusCode).toBe(200);
    expect(activateEndpointResponse.json()).toMatchObject({
      data: {
        id: endpoint.id,
        isActive: true,
      },
    });

    expect(installResponse.statusCode).toBe(202);
    expect(install).toMatchObject({
      activity: {
        activityType: 'model_install',
        payload: {
          endpointId: endpoint.id,
          modelName,
        },
        progressCurrent: 0,
        progressTotal: 3,
        status: 'queued',
        subjectId: install.model.id,
        subjectType: 'ai_model',
      },
      model: {
        endpointId: endpoint.id,
        installed: false,
        name: modelName,
      },
    });
    expect(modelsResponse.statusCode).toBe(200);
    expect(modelsResponse.json()).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          endpointId: endpoint.id,
          id: install.model.id,
          installed: true,
          name: modelName,
        }),
        expect.objectContaining({
          endpointId: endpoint.id,
          installed: true,
          name: 'm10-live-extra:latest',
        }),
      ]),
    });
    expect(syncModelsResponse.statusCode).toBe(200);
    expect(syncModelsResponse.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpointId: endpoint.id,
          installed: true,
          name: modelName,
        }),
        expect.objectContaining({
          endpointId: endpoint.id,
          installed: true,
          name: 'm10-live-extra:latest',
        }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(resetRulesResponse.statusCode).toBe(200);
    expect(resetRulesResponse.json().data.evaluationRules).toBe(
      resetRulesResponse.json().data.rulesTemplate,
    );
    expect(resetRulesResponse.json().data.evaluationRules).not.toBe('M10 custom evaluation rules');
  }, 30_000);

  it('queues AI reviews and uses the priority model for job summaries', async () => {
    await runMigrations(pool);
    const endpoint = await pool.query<{ id: string }>(
      `
        INSERT INTO ai_endpoints(name, base_url, enabled, is_active, config)
        VALUES ('M11 endpoint', 'http://127.0.0.1:11434', true, true, '{}'::jsonb)
        RETURNING id
      `,
    );
    const endpointId = endpoint.rows[0]?.id;
    expect(endpointId).toBeTruthy();
    const provider = await pool.query<{ id: string }>(
      "SELECT id FROM providers WHERE provider_key = 'linkedin'",
    );
    const providerId = provider.rows[0]?.id;
    const search = await pool.query<{ id: string }>(
      `
        INSERT INTO searches(provider_id, name, query, enabled)
        VALUES ($1, 'M11 search', '{"providerKey":"linkedin"}'::jsonb, true)
        RETURNING id
      `,
      [providerId],
    );
    const searchId = search.rows[0]?.id;
    const jobs = await pool.query<{ id: string; title: string }>(
      `
        INSERT INTO jobs(title, company_name, location_text, published_at, availability_status)
        VALUES
          ('M11 Priority Engineer', 'Acme', 'Milan', now(), 'active'),
          ('M11 Reviewed Engineer', 'Beta', 'Remote', now(), 'active'),
          ('M11 Batch Engineer', 'Gamma', 'Rome', now(), 'active')
        RETURNING id, title
      `,
    );
    const priorityJobId = jobs.rows.find((job) => job.title.includes('Priority'))?.id;
    const reviewedJobId = jobs.rows.find((job) => job.title.includes('Reviewed'))?.id;
    const batchJobId = jobs.rows.find((job) => job.title.includes('Batch'))?.id;
    expect(priorityJobId).toBeTruthy();
    expect(reviewedJobId).toBeTruthy();
    expect(batchJobId).toBeTruthy();

    await pool.query(
      `
        INSERT INTO job_search_presence(job_id, search_id)
        VALUES ($1, $4), ($2, $4), ($3, $4)
      `,
      [priorityJobId, reviewedJobId, batchJobId, searchId],
    );
    await pool.query(
      `
        INSERT INTO external_jobs(provider_id, job_id, external_id)
        VALUES
          ($1, $2, 'm11-priority'),
          ($1, $3, 'm11-reviewed'),
          ($1, $4, 'm11-batch')
      `,
      [providerId, priorityJobId, reviewedJobId, batchJobId],
    );
    await pool.query(
      `
        INSERT INTO settings(key, value, description)
        VALUES
          ('ai.enabled', 'true'::jsonb, 'AI enabled'),
          ('ai.active_endpoint_id', to_jsonb($1::text), 'Active endpoint'),
          ('ai.runtime', $2::jsonb, 'AI runtime')
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            description = EXCLUDED.description,
            updated_at = now()
      `,
      [
        endpointId,
        JSON.stringify({
          modelName: 'm11-review-model',
          priorityModelName: 'm11-priority-model',
        }),
      ],
    );
    await pool.query(
      `
        INSERT INTO job_reviews(
          job_id,
          endpoint_id,
          model_name,
          profile_hash,
          rules_hash,
          status,
          decision,
          score,
          result,
          metrics,
          created_at
        )
        VALUES
          ($1, $2, 'm11-priority-model', 'profile', 'rules', 'success', 'apply', 92, '{}'::jsonb, '{}'::jsonb, now() - interval '1 day'),
          ($1, $2, 'm11-other-model', 'profile', 'rules', 'success', 'reject', 12, '{}'::jsonb, '{}'::jsonb, now()),
          ($3, $2, 'm11-review-model', 'profile', 'rules', 'success', 'maybe', 70, '{}'::jsonb, '{"mode":"automatic"}'::jsonb, now())
      `,
      [priorityJobId, endpointId, reviewedJobId],
    );

    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${priorityJobId}`,
    });
    const priorityFilterResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?text=M11&decision=apply&modelName=priority&limit=10&offset=0',
    });
    const aiScoreSortResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?text=M11&sortBy=aiScore&sortDir=desc&limit=10&offset=0',
    });
    const insightsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/insights?topLimit=2',
    });
    const reviewsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${priorityJobId}/reviews`,
    });
    const manualReviewOne = await app.inject({
      method: 'POST',
      payload: {
        mode: 'manual',
      },
      url: `/api/v1/jobs/${priorityJobId}/reviews`,
    });
    const manualReviewTwo = await app.inject({
      method: 'POST',
      payload: {
        mode: 'manual',
      },
      url: `/api/v1/jobs/${priorityJobId}/reviews`,
    });
    const missingJobId = '00000000-0000-4000-8000-000000000011';
    const batchReview = await app.inject({
      method: 'POST',
      payload: {
        jobIds: [reviewedJobId, batchJobId, missingJobId],
        mode: 'automatic',
      },
      url: '/api/v1/jobs/batch-reviews',
    });
    const activityIds = [
      manualReviewOne.json().data?.id,
      manualReviewTwo.json().data?.id,
      ...(batchReview.json().data?.queued ?? []).map((activity: { id: string }) => activity.id),
    ].filter(Boolean);

    await app.close();
    await pool.query('DELETE FROM activity_logs WHERE activity_id = ANY($1::uuid[])', [
      activityIds,
    ]);
    await pool.query('DELETE FROM activities WHERE id = ANY($1::uuid[])', [activityIds]);
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [
      [priorityJobId, reviewedJobId, batchJobId],
    ]);
    await pool.query('DELETE FROM searches WHERE id = $1', [searchId]);
    await pool.query('DELETE FROM ai_models WHERE endpoint_id = $1', [endpointId]);
    await pool.query('DELETE FROM ai_endpoints WHERE id = $1', [endpointId]);
    await pool.query("UPDATE settings SET value = 'false'::jsonb WHERE key = 'ai.enabled'");
    await pool.query(
      "UPDATE settings SET value = 'null'::jsonb WHERE key = 'ai.active_endpoint_id'",
    );
    await pool.query("DELETE FROM settings WHERE key = 'ai.runtime'");

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      data: {
        latestReview: {
          decision: 'apply',
          modelName: 'm11-priority-model',
          score: 92,
        },
      },
    });
    expect(priorityFilterResponse.statusCode).toBe(200);
    expect(priorityFilterResponse.json()).toMatchObject({
      meta: {
        total: 1,
      },
    });
    expect(aiScoreSortResponse.statusCode).toBe(200);
    expect(
      aiScoreSortResponse
        .json()
        .data.map((job: { id: string }) => job.id)
        .slice(0, 2),
    ).toEqual([priorityJobId, reviewedJobId]);
    expect(insightsResponse.statusCode).toBe(200);
    expect(insightsResponse.json()).toMatchObject({
      data: {
        reviewed: 2,
        topMatches: [
          expect.objectContaining({
            id: priorityJobId,
            latestReview: expect.objectContaining({
              isPriority: true,
              priorityReason: 'priority_model',
            }),
          }),
        ],
        totalActive: 3,
        unreviewed: 1,
      },
    });
    expect(reviewsResponse.statusCode).toBe(200);
    expect(reviewsResponse.json().data).toHaveLength(2);
    expect(reviewsResponse.json().data[0]).toMatchObject({
      decision: 'apply',
      isPriority: true,
      modelName: 'm11-priority-model',
      priorityReason: 'priority_model',
      status: 'success',
    });
    expect(manualReviewOne.statusCode).toBe(202);
    expect(manualReviewTwo.statusCode).toBe(202);
    expect(manualReviewOne.json().data).toMatchObject({
      activityType: 'ai_review',
      payload: {
        mode: 'manual',
        modelName: 'm11-review-model',
      },
      status: 'queued',
      subjectId: priorityJobId,
      subjectType: 'job',
    });
    expect(manualReviewTwo.json().data.id).not.toBe(manualReviewOne.json().data.id);
    expect(batchReview.statusCode).toBe(202);
    expect(batchReview.json()).toMatchObject({
      data: {
        queued: [
          expect.objectContaining({
            activityType: 'ai_review',
            payload: expect.objectContaining({
              mode: 'automatic',
              modelName: 'm11-review-model',
            }),
            subjectId: batchJobId,
          }),
        ],
        skipped: expect.arrayContaining([
          { jobId: reviewedJobId, reason: 'already_reviewed_with_automatic_model' },
          { jobId: missingJobId, reason: 'job_not_found' },
        ]),
      },
    });
  }, 30_000);

  it('queues debug/export activities, benchmarks models, and deletes reviews by model', async () => {
    await runMigrations(pool);
    const endpoint = await pool.query<{ id: string }>(
      `
        INSERT INTO ai_endpoints(name, base_url, enabled, is_active, config)
        VALUES ('M12 endpoint', 'http://127.0.0.1:11434', true, true, '{}'::jsonb)
        RETURNING id
      `,
    );
    const endpointId = endpoint.rows[0]?.id;
    expect(endpointId).toBeTruthy();
    const jobs = await pool.query<{ id: string }>(
      `
        INSERT INTO jobs(title, company_name, location_text, availability_status)
        VALUES
          ('M12 Benchmark One', 'Acme', 'Remote', 'active'),
          ('M12 Benchmark Two', 'Beta', 'Milan', 'active')
        RETURNING id
      `,
    );
    const jobIds = jobs.rows.map((job) => job.id);
    expect(jobIds).toHaveLength(2);
    await pool.query(
      `
        INSERT INTO settings(key, value, description)
        VALUES ('ai.active_endpoint_id', to_jsonb($1::text), 'M12 active endpoint')
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            description = EXCLUDED.description,
            updated_at = now()
      `,
      [endpointId],
    );
    await pool.query(
      `
        INSERT INTO job_reviews(
          job_id,
          endpoint_id,
          model_name,
          profile_hash,
          rules_hash,
          status,
          decision,
          score,
          result,
          metrics
        )
        VALUES
          ($1, $3, 'm12-metrics-model', 'profile', 'rules', 'success', 'apply', 80, '{}'::jsonb, '{"ai":{"durationMs":1000,"promptTokens":20,"outputTokens":40,"tokensPerSecond":30}}'::jsonb),
          ($2, $3, 'm12-metrics-model', 'profile', 'rules', 'failed', NULL, NULL, '{}'::jsonb, '{"ai":{"durationMs":2000}}'::jsonb),
          ($2, $3, 'm12-delete-model', 'profile', 'rules', 'success', 'maybe', 60, '{}'::jsonb, '{}'::jsonb)
      `,
      [jobIds[0], jobIds[1], endpointId],
    );

    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });
    const exportResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/exports/jobs-reviews',
    });
    const debugResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/debug/bundle',
    });
    const metricsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/models/metrics',
    });
    const benchmarkResponse = await app.inject({
      method: 'POST',
      payload: {
        modelName: 'm12-benchmark-model',
      },
      url: '/api/v1/ai/benchmark',
    });
    const unsafeDeleteResponse = await app.inject({
      method: 'DELETE',
      payload: {},
      url: '/api/v1/ai/reviews',
    });
    const deleteResponse = await app.inject({
      method: 'DELETE',
      payload: {
        modelName: 'm12-delete-model',
      },
      url: '/api/v1/ai/reviews',
    });
    const remainingDeletedModelReviews = await pool.query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM job_reviews WHERE model_name = 'm12-delete-model'",
    );
    const activityIds = [
      exportResponse.json().data?.id,
      debugResponse.json().data?.id,
      ...(benchmarkResponse.json().data?.queued ?? []).map(
        (activity: { id: string }) => activity.id,
      ),
    ].filter(Boolean);

    await app.close();
    await pool.query('DELETE FROM activity_logs WHERE activity_id = ANY($1::uuid[])', [
      activityIds,
    ]);
    await pool.query('DELETE FROM activities WHERE id = ANY($1::uuid[])', [activityIds]);
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobIds]);
    await pool.query('DELETE FROM ai_models WHERE endpoint_id = $1', [endpointId]);
    await pool.query('DELETE FROM ai_endpoints WHERE id = $1', [endpointId]);
    await pool.query(
      "UPDATE settings SET value = 'null'::jsonb WHERE key = 'ai.active_endpoint_id'",
    );

    expect(exportResponse.statusCode).toBe(202);
    expect(exportResponse.json()).toMatchObject({
      data: {
        activityType: 'export',
        payload: {
          kind: 'jobs_reviews_jsonl',
        },
        status: 'queued',
        subjectType: 'export',
      },
    });
    expect(debugResponse.statusCode).toBe(202);
    expect(debugResponse.json()).toMatchObject({
      data: {
        activityType: 'export',
        payload: {
          kind: 'debug_bundle',
        },
        subjectType: 'debug',
      },
    });
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          avgDurationMs: 1500,
          avgOutputTokens: 40,
          avgPromptTokens: 20,
          avgScore: 80,
          failedCount: 1,
          modelName: 'm12-metrics-model',
          reviewCount: 2,
          successCount: 1,
        }),
      ]),
    );
    expect(benchmarkResponse.statusCode).toBe(202);
    expect(benchmarkResponse.json()).toMatchObject({
      data: {
        model: {
          name: 'm12-benchmark-model',
        },
        queued: [
          expect.objectContaining({
            activityType: 'ai_review',
            payload: expect.objectContaining({
              mode: 'benchmark',
              modelName: 'm12-benchmark-model',
            }),
          }),
          expect.objectContaining({
            activityType: 'ai_review',
            payload: expect.objectContaining({
              mode: 'benchmark',
              modelName: 'm12-benchmark-model',
            }),
          }),
        ],
        totalJobs: 2,
      },
    });
    expect(unsafeDeleteResponse.statusCode).toBe(400);
    expect(unsafeDeleteResponse.json()).toMatchObject({
      error: {
        code: 'bad_request',
        message: 'Review deletion requires all=true or modelName',
      },
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      data: {
        deleted: 1,
      },
    });
    expect(remainingDeletedModelReviews.rows[0]?.total).toBe('0');
  }, 30_000);

  it('imports LinkedIn HAR sessions and manages LinkedIn search wizard data', async () => {
    await runMigrations(pool);
    const app = await buildApp(readConfig({ NODE_ENV: 'test', API_RUN_MIGRATIONS: 'false' }), {
      db: pool,
    });

    const debugResponse = await app.inject({
      method: 'POST',
      payload: {
        har: LINKEDIN_TEST_HAR,
      },
      url: '/api/v1/providers/linkedin/har-debug',
    });
    const importSessionResponse = await app.inject({
      method: 'POST',
      payload: {
        har: LINKEDIN_TEST_HAR,
        label: 'Synthetic LinkedIn session',
      },
      url: '/api/v1/providers/linkedin/sessions/har',
    });
    const importPublicSearchSessionResponse = await app.inject({
      method: 'POST',
      payload: {
        har: LINKEDIN_PUBLIC_SEARCH_HAR,
        label: 'Synthetic LinkedIn public search session',
      },
      url: '/api/v1/providers/linkedin/sessions/har',
    });
    const previewResponse = await app.inject({
      method: 'POST',
      payload: {
        providerKey: 'linkedin',
        query: {
          distance: '25',
          exactMatch: true,
          experienceLevels: ['1', '2', '3'],
          geoId: '103350119',
          keywords: 'React Developer',
          location: 'Italy',
          workplaceTypes: ['2', '3'],
        },
      },
      url: '/api/v1/searches/preview-url',
    });
    const preview = previewResponse.json().data;
    const importUrlResponse = await app.inject({
      method: 'POST',
      payload: {
        providerKey: 'linkedin',
        url: preview.url,
      },
      url: '/api/v1/searches/import-url',
    });
    const createSearchResponse = await app.inject({
      method: 'POST',
      payload: {
        name: 'React Italy',
        providerKey: 'linkedin',
        query: importUrlResponse.json().data.query,
      },
      url: '/api/v1/searches',
    });
    const createdSearch = createSearchResponse.json().data;
    const createSecondSearchResponse = await app.inject({
      method: 'POST',
      payload: {
        name: 'React Italy secondary',
        providerKey: 'linkedin',
        query: importUrlResponse.json().data.query,
      },
      url: '/api/v1/searches',
    });
    const secondSearch = createSecondSearchResponse.json().data;
    const updateSearchResponse = await app.inject({
      method: 'PATCH',
      payload: {
        enabled: false,
      },
      url: `/api/v1/searches/${createdSearch.id}`,
    });
    const reenableSearchResponse = await app.inject({
      method: 'PATCH',
      payload: {
        enabled: true,
      },
      url: `/api/v1/searches/${createdSearch.id}`,
    });
    const runSearchResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/searches/${createdSearch.id}/run`,
    });
    const runActivity = runSearchResponse.json().data;
    const fakeSearchId = '00000000-0000-0000-0000-000000000000';
    const runSelectedSearchesResponse = await app.inject({
      method: 'POST',
      payload: {
        searchIds: [createdSearch.id, fakeSearchId],
      },
      url: '/api/v1/searches/run',
    });
    const runAllSearchesResponse = await app.inject({
      method: 'POST',
      payload: {
        all: true,
        providerKey: 'linkedin',
      },
      url: '/api/v1/searches/run',
    });
    const runActivitiesResponse = await app.inject({
      method: 'GET',
      url:
        `/api/v1/activities?type=linkedin_collect&subjectType=search&subjectId=${createdSearch.id}` +
        '&limit=10&offset=0',
    });
    const listSearchesResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/searches?providerKey=linkedin&limit=10&offset=0',
    });
    const deleteSearchResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/searches/${createdSearch.id}`,
    });
    const deleteSecondSearchResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/searches/${secondSearch.id}`,
    });

    const storedSession = await pool.query<{ session_data: unknown }>(
      'SELECT session_data FROM provider_sessions WHERE id = $1::uuid',
      [importSessionResponse.json().data.id],
    );

    await app.close();

    expect(debugResponse.statusCode).toBe(200);
    expect(debugResponse.json()).toMatchObject({
      data: {
        jobCardRequestCount: 1,
        selectedRequest: {
          count: '25',
          decorationId: 'test-decoration',
          hasCookie: true,
          hasCsrfToken: true,
          recognizedFilters: ['experience'],
          start: '0',
        },
      },
    });
    expect(JSON.stringify(debugResponse.json())).not.toContain('li_at=test-session');
    expect(JSON.stringify(debugResponse.json())).not.toContain('ajax:123456789');

    expect(importSessionResponse.statusCode).toBe(201);
    expect(importSessionResponse.json()).toMatchObject({
      data: {
        label: 'Synthetic LinkedIn session',
        providerKey: 'linkedin',
        summary: {
          decorationId: 'test-decoration',
          hasJsessionid: true,
          hasLiAt: true,
          jobCardRequestCount: 1,
        },
      },
    });
    expect(JSON.stringify(importSessionResponse.json())).not.toContain('li_at=test-session');
    expect(JSON.stringify(importSessionResponse.json())).not.toContain('ajax:123456789');
    expect(storedSession.rowCount).toBe(1);
    expect(JSON.stringify(storedSession.rows[0]?.session_data)).toContain('"li_at":"test-session"');
    expect(JSON.stringify(storedSession.rows[0]?.session_data)).toContain(
      '"jsessionid":"ajax:123456789"',
    );
    expect(JSON.stringify(storedSession.rows[0]?.session_data)).not.toContain('"entries"');
    expect(importPublicSearchSessionResponse.statusCode).toBe(201);
    expect(importPublicSearchSessionResponse.json()).toMatchObject({
      data: {
        label: 'Synthetic LinkedIn public search session',
        providerKey: 'linkedin',
        summary: {
          decorationId: null,
          hasJsessionid: true,
          hasLiAt: true,
          jobCardRequestCount: 0,
        },
      },
    });
    expect(JSON.stringify(importPublicSearchSessionResponse.json())).not.toContain(
      'li_at=test-session',
    );
    expect(JSON.stringify(importPublicSearchSessionResponse.json())).not.toContain(
      'ajax:123456789',
    );

    expect(previewResponse.statusCode).toBe(200);
    expect(preview.url).toContain('keywords=%22React+Developer%22');
    expect(preview.url).toContain('geoId=103350119');
    expect(preview.url).toContain('f_E=1,2,3');
    expect(preview.url).toContain('f_WT=2,3');

    expect(importUrlResponse.statusCode).toBe(200);
    expect(importUrlResponse.json()).toMatchObject({
      data: {
        query: {
          exactMatch: true,
          experienceLevels: ['1', '2', '3'],
          geoId: '103350119',
          keywords: 'React Developer',
          location: 'Italy',
          workplaceTypes: ['2', '3'],
        },
      },
    });

    expect(createSearchResponse.statusCode).toBe(201);
    expect(createdSearch).toMatchObject({
      enabled: true,
      name: 'React Italy',
      providerKey: 'linkedin',
      query: {
        exactMatch: true,
        publicUrl: preview.url,
      },
    });
    expect(createSecondSearchResponse.statusCode).toBe(201);
    expect(updateSearchResponse.statusCode).toBe(200);
    expect(updateSearchResponse.json()).toMatchObject({
      data: {
        enabled: false,
        id: createdSearch.id,
      },
    });
    expect(reenableSearchResponse.statusCode).toBe(200);
    expect(runSearchResponse.statusCode).toBe(202);
    expect(runActivity).toMatchObject({
      activityType: 'linkedin_collect',
      payload: {
        providerKey: 'linkedin',
        searchId: createdSearch.id,
      },
      status: 'queued',
      subjectId: createdSearch.id,
      subjectType: 'search',
    });
    expect(runSelectedSearchesResponse.statusCode).toBe(202);
    expect(runSelectedSearchesResponse.json()).toMatchObject({
      data: {
        queued: [
          expect.objectContaining({
            activityType: 'linkedin_collect',
            subjectId: createdSearch.id,
          }),
        ],
        skipped: [
          {
            reason: 'not_found_or_disabled',
            searchId: fakeSearchId,
          },
        ],
        total: 1,
      },
    });
    expect(runAllSearchesResponse.statusCode).toBe(202);
    expect(runAllSearchesResponse.json().data.queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectId: createdSearch.id }),
        expect.objectContaining({ subjectId: secondSearch.id }),
      ]),
    );
    expect(runAllSearchesResponse.json().data.total).toBeGreaterThanOrEqual(2);
    expect(runActivitiesResponse.statusCode).toBe(200);
    expect(runActivitiesResponse.json()).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: runActivity.id,
          subjectId: createdSearch.id,
        }),
      ]),
    });
    expect(listSearchesResponse.statusCode).toBe(200);
    expect(listSearchesResponse.json()).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: createdSearch.id,
          name: 'React Italy',
        }),
      ]),
      meta: {
        limit: 10,
        offset: 0,
      },
    });
    expect(deleteSearchResponse.statusCode).toBe(200);
    expect(deleteSearchResponse.json()).toMatchObject({
      data: {
        deleted: true,
        id: createdSearch.id,
      },
    });
    expect(deleteSecondSearchResponse.statusCode).toBe(200);
    expect(deleteSecondSearchResponse.json()).toMatchObject({
      data: {
        deleted: true,
        id: secondSearch.id,
      },
    });
  }, 30_000);
});
