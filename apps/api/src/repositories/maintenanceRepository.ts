import type { DatabasePool } from '../db/pool.js';

export interface ModelMetricsRecord {
  avgDurationMs: number | null;
  avgOutputTokens: number | null;
  avgPromptTokens: number | null;
  avgScore: number | null;
  avgTokensPerSecond: number | null;
  endpointId: string | null;
  endpointName: string | null;
  failedCount: number;
  lastReviewedAt: string;
  modelName: string;
  reviewCount: number;
  successCount: number;
}

export interface ApplicationResetRecord {
  deleted: Record<string, number>;
  resetAt: string;
  seeded: {
    providers: number;
    settings: number;
  };
}

export interface OperationalClearRecord {
  clearedAt: string;
  deleted: Record<string, number>;
}

interface ModelMetricsRow {
  avg_duration_ms: string | null;
  avg_output_tokens: string | null;
  avg_prompt_tokens: string | null;
  avg_score: string | null;
  avg_tokens_per_second: string | null;
  endpoint_id: string | null;
  endpoint_name: string | null;
  failed_count: string;
  last_reviewed_at: Date;
  model_name: string;
  review_count: string;
  success_count: string;
}

function parseNullableNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapModelMetrics(row: ModelMetricsRow): ModelMetricsRecord {
  return {
    avgDurationMs: parseNullableNumber(row.avg_duration_ms),
    avgOutputTokens: parseNullableNumber(row.avg_output_tokens),
    avgPromptTokens: parseNullableNumber(row.avg_prompt_tokens),
    avgScore: parseNullableNumber(row.avg_score),
    avgTokensPerSecond: parseNullableNumber(row.avg_tokens_per_second),
    endpointId: row.endpoint_id,
    endpointName: row.endpoint_name,
    failedCount: parseInteger(row.failed_count),
    lastReviewedAt: row.last_reviewed_at.toISOString(),
    modelName: row.model_name,
    reviewCount: parseInteger(row.review_count),
    successCount: parseInteger(row.success_count),
  };
}

function normalizeDeletedCounts(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [
      key,
      typeof count === 'number' && Number.isFinite(count) ? count : 0,
    ]),
  );
}

export async function listModelMetrics(pool: DatabasePool): Promise<ModelMetricsRecord[]> {
  const result = await pool.query<ModelMetricsRow>(
    `
      SELECT
        job_reviews.model_name,
        job_reviews.endpoint_id::text AS endpoint_id,
        ai_endpoints.name AS endpoint_name,
        COUNT(*)::text AS review_count,
        COUNT(*) FILTER (WHERE job_reviews.status = 'success')::text AS success_count,
        COUNT(*) FILTER (WHERE job_reviews.status = 'failed')::text AS failed_count,
        AVG(job_reviews.score)::text AS avg_score,
        AVG(NULLIF(job_reviews.metrics #>> '{ai,durationMs}', '')::numeric)::text AS avg_duration_ms,
        AVG(NULLIF(job_reviews.metrics #>> '{ai,promptTokens}', '')::numeric)::text AS avg_prompt_tokens,
        AVG(NULLIF(job_reviews.metrics #>> '{ai,outputTokens}', '')::numeric)::text AS avg_output_tokens,
        AVG(NULLIF(job_reviews.metrics #>> '{ai,tokensPerSecond}', '')::numeric)::text
          AS avg_tokens_per_second,
        MAX(job_reviews.created_at) AS last_reviewed_at
      FROM job_reviews
      LEFT JOIN ai_endpoints ON ai_endpoints.id = job_reviews.endpoint_id
      GROUP BY job_reviews.model_name, job_reviews.endpoint_id, ai_endpoints.name
      ORDER BY MAX(job_reviews.created_at) DESC, job_reviews.model_name ASC
    `,
  );

  return result.rows.map(mapModelMetrics);
}

export async function deleteJobReviews(
  pool: DatabasePool,
  input: { all?: boolean | undefined; modelName?: string | undefined },
): Promise<number> {
  const modelName = input.modelName?.trim();

  if (!input.all && !modelName) {
    return 0;
  }

  const result = input.all
    ? await pool.query('DELETE FROM job_reviews')
    : await pool.query('DELETE FROM job_reviews WHERE model_name = $1', [modelName]);

  return result.rowCount ?? 0;
}

export async function listBenchmarkJobIds(pool: DatabasePool): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `
      SELECT jobs.id::text AS id
      FROM jobs
      WHERE jobs.availability_status = 'active'
      ORDER BY jobs.published_at DESC NULLS LAST, jobs.created_at DESC, jobs.id DESC
    `,
  );

  return result.rows.map((row) => row.id);
}

/**
 * Clear operational data — every collected offer and queued/finished activity,
 * plus their dependents — while keeping configuration: settings, searches,
 * providers, provider sessions and AI endpoints/models. Lets the user restart
 * collections from scratch without reconfiguring the app.
 */
export async function clearOperationalData(pool: DatabasePool): Promise<OperationalClearRecord> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const counts = await client.query<{ deleted: unknown }>(`
      SELECT jsonb_build_object(
        'activities', (SELECT COUNT(*) FROM activities),
        'activityLogs', (SELECT COUNT(*) FROM activity_logs),
        'externalJobs', (SELECT COUNT(*) FROM external_jobs),
        'jobDescriptions', (SELECT COUNT(*) FROM job_descriptions),
        'jobReviews', (SELECT COUNT(*) FROM job_reviews),
        'jobSearchPresence', (SELECT COUNT(*) FROM job_search_presence),
        'jobs', (SELECT COUNT(*) FROM jobs),
        'rawPayloads', (SELECT COUNT(*) FROM raw_payloads)
      ) AS deleted
    `);

    // Only operational tables. None of the kept tables (settings, searches,
    // providers, provider_sessions, ai_endpoints, ai_models) reference these,
    // so CASCADE cannot reach them.
    await client.query(`
      TRUNCATE TABLE
        activity_logs,
        raw_payloads,
        job_reviews,
        job_descriptions,
        job_search_presence,
        external_jobs,
        jobs,
        activities
      RESTART IDENTITY CASCADE
    `);

    await client.query('COMMIT');

    return {
      clearedAt: new Date().toISOString(),
      deleted: normalizeDeletedCounts(counts.rows[0]?.deleted),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resetApplicationData(pool: DatabasePool): Promise<ApplicationResetRecord> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const schemaVersionResult = await client.query<{ schema_version: number }>(`
      SELECT COALESCE(MAX(id), 0)::integer AS schema_version
      FROM schema_migrations
    `);
    const schemaVersion = schemaVersionResult.rows[0]?.schema_version ?? 0;

    const counts = await client.query<{ deleted: unknown }>(`
      SELECT jsonb_build_object(
        'activities', (SELECT COUNT(*) FROM activities),
        'activityLogs', (SELECT COUNT(*) FROM activity_logs),
        'aiEndpoints', (SELECT COUNT(*) FROM ai_endpoints),
        'aiModels', (SELECT COUNT(*) FROM ai_models),
        'externalJobs', (SELECT COUNT(*) FROM external_jobs),
        'jobDescriptions', (SELECT COUNT(*) FROM job_descriptions),
        'jobReviews', (SELECT COUNT(*) FROM job_reviews),
        'jobSearchPresence', (SELECT COUNT(*) FROM job_search_presence),
        'jobs', (SELECT COUNT(*) FROM jobs),
        'providerSessions', (SELECT COUNT(*) FROM provider_sessions),
        'providers', (SELECT COUNT(*) FROM providers),
        'rawPayloads', (SELECT COUNT(*) FROM raw_payloads),
        'searches', (SELECT COUNT(*) FROM searches),
        'settings', (SELECT COUNT(*) FROM settings)
      ) AS deleted
    `);

    await client.query(`
      TRUNCATE TABLE
        activity_logs,
        raw_payloads,
        job_reviews,
        job_descriptions,
        job_search_presence,
        external_jobs,
        jobs,
        activities,
        searches,
        provider_sessions,
        ai_models,
        ai_endpoints,
        providers,
        settings
      RESTART IDENTITY CASCADE
    `);

    const providers = await client.query(`
      INSERT INTO providers(provider_key, name, enabled, config)
      VALUES
        (
          'linkedin',
          'LinkedIn',
          true,
          jsonb_build_object(
            'publicSearchBaseUrl',
            'https://www.linkedin.com/jobs/search/',
            'voyagerJobCardsPath',
            '/voyager/api/voyagerJobsDashJobCards'
          )
        )
    `);

    const settings = await client.query(
      `
      INSERT INTO settings(key, value, description)
      VALUES
        ('app.name', to_jsonb('JobLens'::text), 'Display name for this installation.'),
        ('app.schema_target', to_jsonb($1::integer), 'Latest schema version expected by this build.'),
        ('ai.enabled', to_jsonb(false), 'External AI integration is optional and disabled by default.'),
        ('ai.active_endpoint_id', 'null'::jsonb, 'Active AI endpoint id, when configured.'),
        (
          'evaluation.rules.template_version',
          to_jsonb(1),
          'Default evaluation rules template version for future AI review settings.'
        )
    `,
      [schemaVersion],
    );

    await client.query('COMMIT');

    return {
      deleted: normalizeDeletedCounts(counts.rows[0]?.deleted),
      resetAt: new Date().toISOString(),
      seeded: {
        providers: providers.rowCount ?? 0,
        settings: settings.rowCount ?? 0,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
