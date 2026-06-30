import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { Client } from 'pg';

export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://localhost:3000';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://joblens:joblens@localhost:5432/joblens';

export interface AiStateSnapshot {
  activeEndpointId: string | null;
  settings: {
    candidateProfile: string;
    enabled: boolean;
    evaluationRules: string;
    outputLanguage: 'en' | 'it' | 'job_language' | 'profile_language';
    pauses: Array<{
      dayOfWeek: number;
      enabled: boolean;
      endTime: string;
      startTime: string;
    }>;
    reviewFields: Array<{
      description: string;
      enabled: boolean;
      key: string;
      label: string;
      maxItems: number;
    }>;
    runtime: {
      keepAlive: string;
      modelName: string;
      numCtx: number;
      numPredict: number;
      priorityModelName: string;
      retryAttempts: number;
      retryDelaySeconds: number;
      temperature: number;
      think: boolean;
      timeoutSeconds: number;
    };
  };
}

export interface SeededJobScenario {
  jobId: string;
  searchId: string;
  title: string;
}

export interface SeededActivityQueueScenario {
  aiReviewActivityId: string;
  aiReviewMessage: string;
  dummyActivityId: string;
  dummyMessage: string;
}

export interface SeededLinkedInDebugScenario {
  activityId: string;
  message: string;
}

export interface SeededAiReviewScenario {
  activityId: string;
  jobId: string;
  title: string;
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function uniqueRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export async function withDb<T>(callback: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function captureAiState(request: APIRequestContext): Promise<AiStateSnapshot> {
  const response = await request.get(apiUrl('/api/v1/ai/settings'));
  expect(response.ok()).toBeTruthy();
  const settings = (await response.json()).data;
  const activeEndpointId = await withDb(async (client) => {
    const result = await client.query<{ id: string }>(
      'SELECT id::text AS id FROM ai_endpoints WHERE is_active = true LIMIT 1',
    );
    return result.rows[0]?.id ?? null;
  });

  return {
    activeEndpointId,
    settings: {
      candidateProfile: settings.candidateProfile,
      enabled: settings.enabled,
      evaluationRules: settings.evaluationRules,
      outputLanguage: settings.outputLanguage,
      pauses: settings.pauses,
      reviewFields: settings.reviewFields,
      runtime: settings.runtime,
    },
  };
}

export async function restoreAiState(
  request: APIRequestContext,
  snapshot: AiStateSnapshot,
): Promise<void> {
  const response = await request.patch(apiUrl('/api/v1/ai/settings'), {
    data: snapshot.settings,
  });
  expect(response.ok()).toBeTruthy();

  await withDb(async (client) => {
    await client.query('UPDATE ai_endpoints SET is_active = false WHERE is_active = true');
    if (snapshot.activeEndpointId) {
      await client.query('UPDATE ai_endpoints SET is_active = true WHERE id = $1::uuid', [
        snapshot.activeEndpointId,
      ]);
    }
    await client.query(
      `
        INSERT INTO settings(key, value, description)
        VALUES (
          'ai.active_endpoint_id',
          $1::jsonb,
          'Active AI endpoint id used for future activities.'
        )
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            description = EXCLUDED.description,
            updated_at = now()
      `,
      [JSON.stringify(snapshot.activeEndpointId)],
    );
  });
}

export async function cleanupE2eData(runId: string): Promise<void> {
  await withDb(async (client) => {
    const likeRun = `%${runId}%`;
    const endpointIds = (
      await client.query<{ id: string }>(
        `
          SELECT id::text AS id
          FROM ai_endpoints
          WHERE name ILIKE $1 OR base_url ILIKE $1
        `,
        [likeRun],
      )
    ).rows.map((row) => row.id);
    const modelIds = (
      await client.query<{ id: string }>(
        `
          SELECT ai_models.id::text AS id
          FROM ai_models
          LEFT JOIN ai_endpoints ON ai_endpoints.id = ai_models.endpoint_id
          WHERE ai_models.name ILIKE $1
             OR ai_models.metadata::text ILIKE $1
             OR ai_endpoints.name ILIKE $1
        `,
        [likeRun],
      )
    ).rows.map((row) => row.id);
    const jobIds = (
      await client.query<{ id: string }>(
        `
          SELECT id::text AS id
          FROM jobs
          WHERE title ILIKE $1
             OR company_name ILIKE $1
             OR metadata->>'e2eRunId' = $2
        `,
        [likeRun, runId],
      )
    ).rows.map((row) => row.id);
    const searchIds = (
      await client.query<{ id: string }>(
        `
          SELECT id::text AS id
          FROM searches
          WHERE name ILIKE $1 OR query::text ILIKE $1
        `,
        [likeRun],
      )
    ).rows.map((row) => row.id);

    await client.query(
      `
        DELETE FROM raw_payloads
        WHERE activity_id IN (
          SELECT id
          FROM activities
          WHERE payload::text ILIKE $1
             OR subject_id = ANY($2::uuid[])
             OR subject_id = ANY($3::uuid[])
             OR subject_id = ANY($4::uuid[])
        )
           OR request_params::text ILIKE $1
           OR payload::text ILIKE $1
           OR payload_text ILIKE $1
      `,
      [likeRun, modelIds, jobIds, searchIds],
    );
    await client.query(
      `
        DELETE FROM activity_logs
        WHERE activity_id IN (
          SELECT id
          FROM activities
          WHERE payload::text ILIKE $1
             OR subject_id = ANY($2::uuid[])
             OR subject_id = ANY($3::uuid[])
             OR subject_id = ANY($4::uuid[])
        )
      `,
      [likeRun, modelIds, jobIds, searchIds],
    );
    await client.query(
      `
        DELETE FROM activities
        WHERE payload::text ILIKE $1
           OR subject_id = ANY($2::uuid[])
           OR subject_id = ANY($3::uuid[])
           OR subject_id = ANY($4::uuid[])
      `,
      [likeRun, modelIds, jobIds, searchIds],
    );
    await client.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobIds]);
    await client.query('DELETE FROM searches WHERE id = ANY($1::uuid[])', [searchIds]);
    await client.query(
      `
        UPDATE settings
        SET value = 'null'::jsonb,
            updated_at = now()
        WHERE key = 'ai.active_endpoint_id'
          AND value #>> '{}' = ANY($1::text[])
      `,
      [endpointIds],
    );
    await client.query('DELETE FROM ai_models WHERE id = ANY($1::uuid[])', [modelIds]);
    await client.query('DELETE FROM ai_models WHERE endpoint_id = ANY($1::uuid[])', [endpointIds]);
    await client.query('DELETE FROM ai_endpoints WHERE id = ANY($1::uuid[])', [endpointIds]);
  });
}

// Seeds a run-scoped active LinkedIn session so the search wizard exposes the
// provider and enables saving/running. Use removeLinkedInSession in a finally
// block; it only deletes the session this run created, never the user's own.
export async function seedLinkedInSession(runId: string): Promise<void> {
  await withDb(async (client) => {
    const provider = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM providers WHERE provider_key = 'linkedin'",
    );
    const providerId = provider.rows[0]?.id;
    if (!providerId) {
      throw new Error('LinkedIn provider seed is missing');
    }

    await client.query(
      `
        INSERT INTO provider_sessions(provider_id, label, status, session_data, last_verified_at)
        VALUES ($1::uuid, $2, 'active', $3::jsonb, now())
      `,
      [
        providerId,
        `E2E Session ${runId}`,
        JSON.stringify({ secrets: { li_at: `e2e-${runId}`, jsessionid: 'ajax:e2e' } }),
      ],
    );
  });
}

export async function removeLinkedInSession(runId: string): Promise<void> {
  await withDb(async (client) => {
    await client.query('DELETE FROM provider_sessions WHERE label = $1', [`E2E Session ${runId}`]);
  });
}

export async function mockLinkedInGeoTypeahead(page: Page): Promise<void> {
  await page.route('**/api/v1/providers/linkedin/geo-typeahead**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        data: [],
      },
      status: 200,
    });
  });
}

export async function seedActivityQueueScenario(
  runId: string,
): Promise<SeededActivityQueueScenario> {
  return withDb(async (client) => {
    const dummyMessage = `E2E dummy activity ${runId}`;
    const aiReviewMessage = `E2E AI review activity ${runId}`;
    const inserted = await client.query<{
      activity_type: string;
      id: string;
      message: string;
    }>(
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
          started_at,
          heartbeat_at
        )
        VALUES
          (
            'dummy',
            'running',
            'running',
            $1,
            'e2e',
            $3::jsonb,
            1,
            5,
            'e2e-test',
            now() + interval '1 hour',
            now(),
            now()
          ),
          (
            'ai_review',
            'running',
            'running',
            $2,
            'e2e',
            $3::jsonb,
            1,
            4,
            'e2e-test',
            now() + interval '1 hour',
            now(),
            now()
          )
        RETURNING id::text AS id, activity_type, message
      `,
      [
        dummyMessage,
        aiReviewMessage,
        JSON.stringify({
          e2eRunId: runId,
        }),
      ],
    );
    const dummy = inserted.rows.find((row) => row.activity_type === 'dummy');
    const aiReview = inserted.rows.find((row) => row.activity_type === 'ai_review');

    if (!dummy || !aiReview) {
      throw new Error('Unable to seed activity queue scenario');
    }

    return {
      aiReviewActivityId: aiReview.id,
      aiReviewMessage: aiReview.message,
      dummyActivityId: dummy.id,
      dummyMessage: dummy.message,
    };
  });
}

export async function seedLinkedInDebugScenario(
  runId: string,
): Promise<SeededLinkedInDebugScenario> {
  return withDb(async (client) => {
    const provider = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM providers WHERE provider_key = 'linkedin'",
    );
    const providerId = provider.rows[0]?.id;
    if (!providerId) {
      throw new Error('LinkedIn provider seed is missing');
    }

    const message = `E2E LinkedIn failed collection ${runId}`;
    const insertedActivity = await client.query<{ id: string }>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          phase,
          message,
          error,
          source,
          payload,
          progress_current,
          progress_total,
          started_at,
          finished_at
        )
        VALUES (
          'linkedin_collect',
          'failed',
          'collecting',
          $1,
          'LinkedIn collection failed with HTTP 500',
          'e2e',
          $2::jsonb,
          0,
          1,
          now(),
          now()
        )
        RETURNING id::text AS id
      `,
      [
        message,
        JSON.stringify({
          e2eRunId: runId,
          providerKey: 'linkedin',
        }),
      ],
    );
    const activityId = insertedActivity.rows[0]?.id;
    if (!activityId) {
      throw new Error('Unable to seed LinkedIn debug activity');
    }

    await client.query(
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
          'https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards?li_at=e2e-secret',
          $3::jsonb,
          500,
          'application/json',
          84,
          $4::jsonb
        )
      `,
      [
        providerId,
        activityId,
        JSON.stringify({
          cookie: 'li_at=e2e-secret; JSESSIONID="ajax:e2e-secret"',
          e2eRunId: runId,
          query: 'jobSearch',
        }),
        JSON.stringify({
          message: 'LinkedIn fixture failure',
          trackingId: `tracking-${runId}`,
          token: 'e2e-secret',
        }),
      ],
    );

    return {
      activityId,
      message,
    };
  });
}

export async function seedAiReviewScenario(runId: string): Promise<SeededAiReviewScenario> {
  return withDb(async (client) => {
    const provider = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM providers WHERE provider_key = 'linkedin'",
    );
    const providerId = provider.rows[0]?.id;
    if (!providerId) {
      throw new Error('LinkedIn provider seed is missing');
    }

    const endpoint = await client.query<{ id: string }>(
      `
        INSERT INTO ai_endpoints(name, base_url, enabled, is_active, config)
        VALUES ($1, $2, true, false, $3::jsonb)
        RETURNING id::text AS id
      `,
      [
        `E2E AI Endpoint ${runId}`,
        `http://127.0.0.1:9/e2e-${runId}`,
        JSON.stringify({ e2eRunId: runId }),
      ],
    );
    const endpointId = endpoint.rows[0]!.id;
    const modelName = `e2e-review-model-${runId}`;
    const model = await client.query<{ id: string }>(
      `
        INSERT INTO ai_models(endpoint_id, name, installed, metadata)
        VALUES ($1::uuid, $2, true, $3::jsonb)
        RETURNING id::text AS id
      `,
      [endpointId, modelName, JSON.stringify({ e2eRunId: runId })],
    );
    const modelId = model.rows[0]!.id;
    const title = `E2E AI Fixture Engineer ${runId}`;
    const externalId = `e2e-ai-${runId}`;

    const job = await client.query<{ id: string }>(
      `
        INSERT INTO jobs(
          title,
          company_name,
          location_text,
          workplace_type,
          employment_type,
          seniority,
          published_at,
          local_status,
          availability_status,
          source_url,
          provider_url,
          metadata
        )
        VALUES (
          $1,
          $2,
          'Milano, Lombardia, Italia',
          'Remoto',
          'Tempo pieno',
          'Senior',
          now() - interval '1 day',
          'new',
          'active',
          $3,
          $3,
          $4::jsonb
        )
        RETURNING id::text AS id
      `,
      [
        title,
        `E2E AI Company ${runId}`,
        `https://www.linkedin.com/jobs/view/${externalId}/`,
        JSON.stringify({ e2eRunId: runId }),
      ],
    );
    const jobId = job.rows[0]!.id;
    const search = await client.query<{ id: string }>(
      `
        INSERT INTO searches(provider_id, name, query, enabled)
        VALUES ($1::uuid, $2, $3::jsonb, true)
        RETURNING id::text AS id
      `,
      [
        providerId,
        `E2E AI Search ${runId}`,
        JSON.stringify({
          currentJobId: null,
          distance: '25',
          exactMatch: false,
          experienceLevels: ['4'],
          geoId: '103350119',
          keywords: `AI Fixture Engineer ${runId}`,
          location: 'Italy',
          preservedParams: {},
          providerKey: 'linkedin',
          publicUrl: `https://www.linkedin.com/jobs/search/?keywords=AI+Fixture+Engineer+${encodeURIComponent(
            runId,
          )}`,
          unsupportedParams: {},
          workplaceTypes: [],
        }),
      ],
    );
    const searchId = search.rows[0]!.id;

    await client.query(
      `
        INSERT INTO external_jobs(provider_id, job_id, external_id, external_url, metadata)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
      `,
      [
        providerId,
        jobId,
        externalId,
        `https://www.linkedin.com/jobs/view/${externalId}/`,
        JSON.stringify({ e2eRunId: runId }),
      ],
    );
    await client.query(
      `
        INSERT INTO job_search_presence(job_id, search_id, metadata)
        VALUES ($1::uuid, $2::uuid, $3::jsonb)
      `,
      [jobId, searchId, JSON.stringify({ e2eRunId: runId })],
    );
    await client.query(
      `
        INSERT INTO job_descriptions(job_id, content_hash, text, source, metadata)
        VALUES ($1::uuid, $2, $3, 'provider', $4::jsonb)
      `,
      [
        jobId,
        `e2e-ai-${runId}`,
        `Descrizione AI fixture per ${title}. Richiede TypeScript, Rust, PostgreSQL e autonomia.`,
        JSON.stringify({ e2eRunId: runId }),
      ],
    );
    await client.query(
      `
        INSERT INTO settings(key, value, description)
        VALUES
          ('ai.runtime', $1::jsonb, 'AI runtime settings used by worker reviews.'),
          ('ai.pauses', '[]'::jsonb, 'AI pause windows.')
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            description = EXCLUDED.description,
            updated_at = now()
      `,
      [
        JSON.stringify({
          keepAlive: '1m',
          modelName,
          numCtx: 4096,
          numPredict: 512,
          priorityModelName: modelName,
          retryAttempts: 2,
          retryDelaySeconds: 0,
          temperature: 0.2,
          think: false,
          timeoutSeconds: 15,
        }),
      ],
    );

    const activity = await client.query<{ id: string }>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          subject_type,
          subject_id,
          phase,
          message,
          source,
          payload,
          progress_current,
          progress_total
        )
        VALUES (
          'ai_review',
          'queued',
          'job',
          $1::uuid,
          'queued',
          $2,
          'e2e',
          $3::jsonb,
          0,
          4
        )
        RETURNING id::text AS id
      `,
      [
        jobId,
        `E2E queued AI review ${runId}`,
        JSON.stringify({
          e2eRunId: runId,
          endpointId,
          fixtureAiFailuresBeforeSuccess: 1,
          fixtureAiOutput: JSON.stringify({
            blockers: [],
            caution_notes: ['Verificare compenso e seniority effettiva'],
            decision: 'apply',
            explicit_optional_matches: ['Esperienza PostgreSQL'],
            location_fit: 'good',
            mandatory_gaps: [],
            matching_points: ['Stack TypeScript e Rust', 'Autonomia operativa'],
            reason: `Review fixture E2E ${runId}`,
            score: 88,
            seniority_fit: 'good',
            skill_fit: 'good',
          }),
          fixtureAiMetrics: {
            e2eRunId: runId,
            fixture: true,
          },
          jobId,
          mode: 'e2e',
          modelId,
          modelName,
        }),
      ],
    );

    return {
      activityId: activity.rows[0]!.id,
      jobId,
      title,
    };
  });
}

// Seeds a batch of active/new offers (all sharing a title prefix) tied to a
// single search so they show up under the default "standard" jobs filter. Used
// by the layout tests that need a list taller than the mobile viewport.
export async function seedJobsBatch(
  runId: string,
  count: number,
): Promise<{ searchId: string; titlePrefix: string }> {
  return withDb(async (client) => {
    const provider = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM providers WHERE provider_key = 'linkedin'",
    );
    const providerId = provider.rows[0]?.id;
    if (!providerId) {
      throw new Error('LinkedIn provider seed is missing');
    }

    const titlePrefix = `E2E Batch ${runId}`;
    const search = await client.query<{ id: string }>(
      `
        INSERT INTO searches(provider_id, name, query, enabled)
        VALUES ($1::uuid, $2, $3::jsonb, true)
        RETURNING id::text AS id
      `,
      [
        providerId,
        `E2E Batch Search ${runId}`,
        JSON.stringify({ keywords: titlePrefix, location: 'Italy', providerKey: 'linkedin' }),
      ],
    );
    const searchId = search.rows[0]!.id;

    for (let index = 0; index < count; index += 1) {
      const job = await client.query<{ id: string }>(
        `
          INSERT INTO jobs(
            title,
            company_name,
            location_text,
            workplace_type,
            employment_type,
            seniority,
            published_at,
            local_status,
            availability_status,
            metadata
          )
          VALUES ($1, $2, $3, 'Ibrido', 'Tempo pieno', 'Mid', now() - ($4 || ' hours')::interval,
                  'new', 'active', $5::jsonb)
          RETURNING id::text AS id
        `,
        [
          `${titlePrefix} #${index}`,
          `Batch Company ${index}`,
          'Torino, Piemonte, Italia (Ibrido)',
          String(index),
          JSON.stringify({ e2eRunId: runId }),
        ],
      );
      await client.query(
        `
          INSERT INTO job_search_presence(job_id, search_id, metadata)
          VALUES ($1::uuid, $2::uuid, $3::jsonb)
        `,
        [job.rows[0]!.id, searchId, JSON.stringify({ e2eRunId: runId })],
      );
    }

    return { searchId, titlePrefix };
  });
}

export async function seedJobScenario(runId: string): Promise<SeededJobScenario> {
  return withDb(async (client) => {
    const provider = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM providers WHERE provider_key = 'linkedin'",
    );
    const providerId = provider.rows[0]?.id;
    if (!providerId) {
      throw new Error('LinkedIn provider seed is missing');
    }

    const searchName = `E2E Search ${runId}`;
    const title = `E2E Platform Engineer ${runId}`;
    const externalId = `e2e-${runId}`;
    const query = {
      currentJobId: null,
      distance: '25',
      exactMatch: false,
      experienceLevels: ['2', '3'],
      geoId: '106742401',
      keywords: `Platform Engineer ${runId}`,
      location: 'Turin, Piedmont, Italy',
      preservedParams: {},
      providerKey: 'linkedin',
      publicUrl: `https://www.linkedin.com/jobs/search/?keywords=Platform+Engineer+${encodeURIComponent(
        runId,
      )}&location=Turin,+Piedmont,+Italy&geoId=106742401&distance=25&f_E=2,3&position=1&pageNum=0`,
      unsupportedParams: {},
      workplaceTypes: [],
    };

    const search = await client.query<{ id: string }>(
      `
        INSERT INTO searches(provider_id, name, query, enabled)
        VALUES ($1::uuid, $2, $3::jsonb, true)
        RETURNING id::text AS id
      `,
      [providerId, searchName, JSON.stringify(query)],
    );
    const searchId = search.rows[0]!.id;

    const job = await client.query<{ id: string }>(
      `
        INSERT INTO jobs(
          title,
          company_name,
          location_text,
          workplace_type,
          employment_type,
          seniority,
          published_at,
          local_status,
          availability_status,
          source_url,
          provider_url,
          metadata
        )
        VALUES (
          $1,
          $2,
          'Torino, Piemonte, Italia (Ibrido)',
          'Ibrido',
          'Tempo pieno',
          'Mid-Senior',
          now() - interval '2 days',
          'new',
          'active',
          $3,
          $3,
          $4::jsonb
        )
        RETURNING id::text AS id
      `,
      [
        title,
        `E2E Company ${runId}`,
        `https://www.linkedin.com/jobs/view/${externalId}/`,
        JSON.stringify({ e2eRunId: runId }),
      ],
    );
    const jobId = job.rows[0]!.id;

    await client.query(
      `
        INSERT INTO external_jobs(provider_id, job_id, external_id, external_url, metadata)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
      `,
      [
        providerId,
        jobId,
        externalId,
        `https://www.linkedin.com/jobs/view/${externalId}/`,
        JSON.stringify({ e2eRunId: runId }),
      ],
    );
    await client.query(
      `
        INSERT INTO job_search_presence(job_id, search_id, metadata)
        VALUES ($1::uuid, $2::uuid, $3::jsonb)
      `,
      [jobId, searchId, JSON.stringify({ e2eRunId: runId })],
    );
    await client.query(
      `
        INSERT INTO job_descriptions(job_id, content_hash, text, source, metadata)
        VALUES ($1::uuid, $2, $3, 'provider', $4::jsonb)
      `,
      [
        jobId,
        `e2e-${runId}`,
        `Descrizione controllata per ${title}. Stack TypeScript, Rust e PostgreSQL.`,
        JSON.stringify({ e2eRunId: runId }),
      ],
    );
    await client.query(
      `
        INSERT INTO job_reviews(job_id, model_name, profile_hash, rules_hash, decision, score, result, metrics)
        VALUES ($1::uuid, $2, 'e2e-profile', 'e2e-rules', 'apply', 91, $3::jsonb, $4::jsonb)
      `,
      [
        jobId,
        `e2e-review-model-${runId}`,
        JSON.stringify({ fit: 'high', e2eRunId: runId }),
        JSON.stringify({ mode: 'automatic', e2eRunId: runId }),
      ],
    );

    return { jobId, searchId, title };
  });
}
