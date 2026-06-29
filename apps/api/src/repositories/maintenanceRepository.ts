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
