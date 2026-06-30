import type { DatabasePool } from '../db/pool.js';

export type JobAvailabilityStatus =
  | 'active'
  | 'available_outside_searches'
  | 'missing_from_searches'
  | 'unavailable';

export type JobLocalStatus = 'applied' | 'new' | 'saved' | 'viewed';
export type JobReviewDecision = 'apply' | 'maybe' | 'reject';
export type JobScope = 'all' | 'standard';
export type JobSortBy = 'aiScore' | 'publishedAt' | 'repostedAt';
export type JobSortDir = 'asc' | 'desc';
export type JobWorkplaceMode = 'hybrid' | 'onsite' | 'remote';

export interface JobExternalRecord {
  externalId: string;
  externalUrl: string | null;
  firstSeenAt: string;
  id: string;
  lastSeenAt: string;
  providerKey: string;
  providerName: string;
}

export interface JobSearchPresenceRecord {
  firstSeenAt: string;
  lastActivityId: string | null;
  lastSeenAt: string;
  providerKey: string;
  searchId: string;
  searchName: string;
}

export interface JobReviewSummaryRecord {
  createdAt: string;
  decision: JobReviewDecision | null;
  id: string;
  isPriority: boolean;
  modelName: string;
  priorityReason: string;
  reviewMode: string | null;
  score: number | null;
  status: 'failed' | 'success';
}

export interface JobReviewDetailRecord extends JobReviewSummaryRecord {
  endpointId: string | null;
  endpointName: string | null;
  error: string | null;
  metrics: unknown;
  modelId: string | null;
  profileHash: string;
  rawOutput: string | null;
  result: unknown;
  rulesHash: string;
}

export interface JobDescriptionRecord {
  fetchedAt: string;
  html: string | null;
  htmlAvailable: boolean;
  id: string;
  source: string;
  text: string;
}

export interface JobSummaryRecord {
  availabilityStatus: JobAvailabilityStatus;
  companyName: string;
  createdAt: string;
  employmentType: string | null;
  externalJobs: JobExternalRecord[];
  id: string;
  latestReview: JobReviewSummaryRecord | null;
  localStatus: JobLocalStatus;
  locationText: string | null;
  providerUrl: string | null;
  publishedAt: string | null;
  repostedAt: string | null;
  searches: JobSearchPresenceRecord[];
  seniority: string | null;
  sourceUrl: string | null;
  title: string;
  updatedAt: string;
  workplaceType: string | null;
}

export interface JobDetailRecord extends JobSummaryRecord {
  description: JobDescriptionRecord | null;
}

export interface PaginatedJobs {
  items: JobSummaryRecord[];
  total: number;
}

export interface JobDecisionCountRecord {
  count: number;
  key: JobReviewDecision | 'none';
}

export interface JobInsightsRecord {
  averageScore: number | null;
  byDecision: JobDecisionCountRecord[];
  reviewed: number;
  topMatches: JobSummaryRecord[];
  totalActive: number;
  unreviewed: number;
}

export interface JobFilters {
  availabilityStatus?: JobAvailabilityStatus | undefined;
  decision?: JobReviewDecision[] | undefined;
  limit: number;
  localStatus?: JobLocalStatus | undefined;
  location?: string | undefined;
  modelName?: string | undefined;
  offset: number;
  providerKey?: string | undefined;
  scope: JobScope;
  searchId?: string | undefined;
  sortBy: JobSortBy;
  sortDir: JobSortDir;
  text?: string | undefined;
  workplace?: JobWorkplaceMode | undefined;
}

interface JobRow {
  availability_status: JobAvailabilityStatus;
  company_name: string;
  created_at: Date;
  description: unknown;
  employment_type: string | null;
  external_jobs: unknown;
  id: string;
  latest_review: unknown;
  local_status: JobLocalStatus;
  location_text: string | null;
  provider_url: string | null;
  published_at: Date | null;
  reposted_at: Date | null;
  searches: unknown;
  seniority: string | null;
  source_url: string | null;
  title: string;
  updated_at: Date;
  workplace_type: string | null;
}

interface QueryParts {
  conditions: string[];
  params: unknown[];
}

const SORT_COLUMNS: Record<JobSortBy, string> = {
  aiScore: 'latest_review.score',
  publishedAt: 'jobs.published_at',
  repostedAt: 'jobs.reposted_at',
};

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function mapJsonArray<TItem>(
  value: unknown,
  mapper: (item: Record<string, unknown>) => TItem,
): TItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map(mapper);
}

function mapExternalJob(value: Record<string, unknown>): JobExternalRecord {
  return {
    externalId: readString(value.externalId) ?? '',
    externalUrl: readString(value.externalUrl),
    firstSeenAt: readString(value.firstSeenAt) ?? '',
    id: readString(value.id) ?? '',
    lastSeenAt: readString(value.lastSeenAt) ?? '',
    providerKey: readString(value.providerKey) ?? '',
    providerName: readString(value.providerName) ?? '',
  };
}

function mapSearchPresence(value: Record<string, unknown>): JobSearchPresenceRecord {
  return {
    firstSeenAt: readString(value.firstSeenAt) ?? '',
    lastActivityId: readString(value.lastActivityId),
    lastSeenAt: readString(value.lastSeenAt) ?? '',
    providerKey: readString(value.providerKey) ?? '',
    searchId: readString(value.searchId) ?? '',
    searchName: readString(value.searchName) ?? '',
  };
}

function mapReview(value: unknown): JobReviewSummaryRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    createdAt: readString(value.createdAt) ?? '',
    decision: readString(value.decision) as JobReviewDecision | null,
    id: readString(value.id) ?? '',
    isPriority: readBoolean(value.isPriority),
    modelName: readString(value.modelName) ?? '',
    priorityReason: readString(value.priorityReason) ?? 'latest_review',
    reviewMode: readString(value.reviewMode),
    score: readNumber(value.score),
    status: readString(value.status) === 'failed' ? 'failed' : 'success',
  };
}

function mapReviewDetail(value: Record<string, unknown>): JobReviewDetailRecord {
  return {
    ...mapReview(value)!,
    endpointId: readString(value.endpointId),
    endpointName: readString(value.endpointName),
    error: readString(value.error),
    metrics: value.metrics ?? {},
    modelId: readString(value.modelId),
    profileHash: readString(value.profileHash) ?? '',
    rawOutput: readString(value.rawOutput),
    result: value.result ?? {},
    rulesHash: readString(value.rulesHash) ?? '',
  };
}

function mapDescription(value: unknown): JobDescriptionRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    fetchedAt: readString(value.fetchedAt) ?? '',
    html: readString(value.html),
    htmlAvailable: value.htmlAvailable === true,
    id: readString(value.id) ?? '',
    source: readString(value.source) ?? '',
    text: readString(value.text) ?? '',
  };
}

function mapJobSummary(row: JobRow): JobSummaryRecord {
  return {
    availabilityStatus: row.availability_status,
    companyName: row.company_name,
    createdAt: row.created_at.toISOString(),
    employmentType: row.employment_type,
    externalJobs: mapJsonArray(row.external_jobs, mapExternalJob),
    id: row.id,
    latestReview: mapReview(row.latest_review),
    localStatus: row.local_status,
    locationText: row.location_text,
    providerUrl: row.provider_url,
    publishedAt: formatDate(row.published_at),
    repostedAt: formatDate(row.reposted_at),
    searches: mapJsonArray(row.searches, mapSearchPresence),
    seniority: row.seniority,
    sourceUrl: row.source_url,
    title: row.title,
    updatedAt: row.updated_at.toISOString(),
    workplaceType: row.workplace_type,
  };
}

function mapJobDetail(row: JobRow): JobDetailRecord {
  return {
    ...mapJobSummary(row),
    description: mapDescription(row.description),
  };
}

function buildJobConditions(filters: JobFilters): QueryParts {
  const conditions: string[] = [];
  const params: unknown[] = [];

  function addParam(value: unknown): string {
    params.push(value);
    return `$${params.length}`;
  }

  if (filters.scope === 'standard') {
    conditions.push("jobs.availability_status = 'active'");
    conditions.push(
      'EXISTS (SELECT 1 FROM job_search_presence standard_presence WHERE standard_presence.job_id = jobs.id)',
    );
  }

  if (filters.providerKey) {
    const param = addParam(filters.providerKey);
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM external_jobs provider_filter
        JOIN providers provider_filter_provider ON provider_filter_provider.id = provider_filter.provider_id
        WHERE provider_filter.job_id = jobs.id
          AND provider_filter_provider.provider_key = ${param}
      )
    `);
  }

  if (filters.searchId) {
    const param = addParam(filters.searchId);
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM job_search_presence search_filter
        WHERE search_filter.job_id = jobs.id
          AND search_filter.search_id = ${param}::uuid
      )
    `);
  }

  if (filters.location) {
    const param = addParam(`%${filters.location}%`);
    conditions.push(`jobs.location_text ILIKE ${param}`);
  }

  if (filters.workplace) {
    const patternsByWorkplace: Record<JobWorkplaceMode, string[]> = {
      hybrid: ['%hybrid%', '%ibrid%'],
      onsite: ['%on-site%', '%onsite%', '%in sede%', '%presenza%', '%presenzial%'],
      remote: ['%remote%', '%remot%'],
    };
    const workplaceConditions = patternsByWorkplace[filters.workplace].map((pattern) => {
      const param = addParam(pattern);
      return `(jobs.workplace_type ILIKE ${param} OR jobs.location_text ILIKE ${param})`;
    });
    conditions.push(`(${workplaceConditions.join(' OR ')})`);
  }

  if (filters.localStatus) {
    const param = addParam(filters.localStatus);
    conditions.push(`jobs.local_status = ${param}`);
  }

  if (filters.availabilityStatus) {
    const param = addParam(filters.availabilityStatus);
    conditions.push(`jobs.availability_status = ${param}`);
  }

  if (filters.decision && filters.decision.length > 0) {
    const params = filters.decision.map((decision) => addParam(decision));
    conditions.push(`latest_review.decision IN (${params.join(', ')})`);
  }

  if (filters.modelName) {
    const param = addParam(`%${filters.modelName}%`);
    conditions.push(`latest_review.model_name ILIKE ${param}`);
  }

  if (filters.text) {
    const param = addParam(`%${filters.text}%`);
    conditions.push(`(
      jobs.title ILIKE ${param}
      OR jobs.company_name ILIKE ${param}
      OR jobs.location_text ILIKE ${param}
      OR EXISTS (
        SELECT 1
        FROM external_jobs text_external
        WHERE text_external.job_id = jobs.id
          AND (
            text_external.external_id ILIKE ${param}
            OR text_external.external_url ILIKE ${param}
          )
      )
    )`);
  }

  return { conditions, params };
}

function buildWhereClause(conditions: string[]): string {
  if (conditions.length === 0) {
    return '';
  }

  return `WHERE ${conditions.join('\nAND ')}`;
}

function buildJobSelect(description: boolean): string {
  return `
    SELECT
      jobs.id,
      jobs.title,
      jobs.company_name,
      jobs.location_text,
      jobs.workplace_type,
      jobs.employment_type,
      jobs.seniority,
      jobs.published_at,
      jobs.reposted_at,
      jobs.local_status,
      jobs.availability_status,
      jobs.source_url,
      jobs.provider_url,
      jobs.created_at,
      jobs.updated_at,
      COALESCE(external_agg.items, '[]'::jsonb) AS external_jobs,
      COALESCE(search_agg.items, '[]'::jsonb) AS searches,
      latest_review.item AS latest_review,
      ${description ? 'latest_description.item' : 'NULL::jsonb'} AS description
    FROM jobs
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', external_jobs.id,
          'providerKey', providers.provider_key,
          'providerName', providers.name,
          'externalId', external_jobs.external_id,
          'externalUrl', external_jobs.external_url,
          'firstSeenAt', external_jobs.first_seen_at,
          'lastSeenAt', external_jobs.last_seen_at
        )
        ORDER BY providers.provider_key ASC, external_jobs.external_id ASC
      ) AS items
      FROM external_jobs
      JOIN providers ON providers.id = external_jobs.provider_id
      WHERE external_jobs.job_id = jobs.id
    ) external_agg ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'searchId', searches.id,
          'searchName', searches.name,
          'providerKey', providers.provider_key,
          'firstSeenAt', job_search_presence.first_seen_at,
          'lastSeenAt', job_search_presence.last_seen_at,
          'lastActivityId', job_search_presence.last_activity_id
        )
        ORDER BY job_search_presence.last_seen_at DESC, searches.name ASC
      ) AS items
      FROM job_search_presence
      JOIN searches ON searches.id = job_search_presence.search_id
      JOIN providers ON providers.id = searches.provider_id
      WHERE job_search_presence.job_id = jobs.id
    ) search_agg ON true
    LEFT JOIN LATERAL (
      SELECT NULLIF(value->>'priorityModelName', '') AS priority_model_name
      FROM settings
      WHERE key = 'ai.runtime'
      LIMIT 1
    ) ai_runtime ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', job_reviews.id,
        'decision', job_reviews.decision,
        'isPriority',
          job_reviews.status = 'success'
          AND ai_runtime.priority_model_name IS NOT NULL
          AND job_reviews.model_name = ai_runtime.priority_model_name,
        'score', job_reviews.score,
        'modelName', job_reviews.model_name,
        'priorityReason',
          CASE
            WHEN job_reviews.status = 'success'
              AND ai_runtime.priority_model_name IS NOT NULL
              AND job_reviews.model_name = ai_runtime.priority_model_name THEN 'priority_model'
            WHEN job_reviews.status = 'success' THEN 'latest_success'
            ELSE 'latest_review'
          END,
        'reviewMode', job_reviews.metrics->>'mode',
        'status', job_reviews.status,
        'createdAt', job_reviews.created_at
      ) AS item,
      job_reviews.decision,
      job_reviews.model_name,
      job_reviews.score
      FROM job_reviews
      WHERE job_reviews.job_id = jobs.id
      ORDER BY
        CASE
          WHEN job_reviews.status = 'success'
            AND ai_runtime.priority_model_name IS NOT NULL
            AND job_reviews.model_name = ai_runtime.priority_model_name THEN 0
          WHEN job_reviews.status = 'success' THEN 1
          ELSE 2
        END,
        job_reviews.created_at DESC,
        job_reviews.id DESC
      LIMIT 1
    ) latest_review ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', job_descriptions.id,
        'text', job_descriptions.text,
        'html', job_descriptions.html,
        'htmlAvailable', job_descriptions.html IS NOT NULL,
        'source', job_descriptions.source,
        'fetchedAt', job_descriptions.fetched_at
      ) AS item
      FROM job_descriptions
      WHERE job_descriptions.job_id = jobs.id
      ORDER BY job_descriptions.fetched_at DESC, job_descriptions.created_at DESC
      LIMIT 1
    ) latest_description ON ${description ? 'true' : 'false'}
  `;
}

export async function listJobs(pool: DatabasePool, filters: JobFilters): Promise<PaginatedJobs> {
  const { conditions, params } = buildJobConditions(filters);
  const whereClause = buildWhereClause(conditions);
  const sortColumn = SORT_COLUMNS[filters.sortBy];
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const [itemsResult, countResult] = await Promise.all([
    pool.query<JobRow>(
      `
        ${buildJobSelect(false)}
        ${whereClause}
        ORDER BY ${sortColumn} ${sortDir} NULLS LAST, jobs.created_at DESC, jobs.id DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      [...params, filters.limit, filters.offset],
    ),
    pool.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM jobs
        LEFT JOIN LATERAL (
          SELECT NULLIF(value->>'priorityModelName', '') AS priority_model_name
          FROM settings
          WHERE key = 'ai.runtime'
          LIMIT 1
        ) ai_runtime ON true
        LEFT JOIN LATERAL (
          SELECT job_reviews.decision, job_reviews.model_name
          FROM job_reviews
          WHERE job_reviews.job_id = jobs.id
          ORDER BY
            CASE
              WHEN job_reviews.status = 'success'
                AND ai_runtime.priority_model_name IS NOT NULL
                AND job_reviews.model_name = ai_runtime.priority_model_name THEN 0
              WHEN job_reviews.status = 'success' THEN 1
              ELSE 2
            END,
            job_reviews.created_at DESC,
            job_reviews.id DESC
          LIMIT 1
        ) latest_review ON true
        ${whereClause}
      `,
      params,
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapJobSummary),
    total: Number.parseInt(countResult.rows[0]?.total ?? '0', 10),
  };
}

export async function readJobInsights(
  pool: DatabasePool,
  input: { topLimit: number },
): Promise<JobInsightsRecord> {
  const [summaryResult, decisionResult, topMatches] = await Promise.all([
    pool.query<{
      average_score: string | null;
      reviewed: string;
      total_active: string;
      unreviewed: string;
    }>(
      `
        SELECT
          COUNT(*)::text AS total_active,
          COUNT(*) FILTER (WHERE latest_review.status = 'success')::text AS reviewed,
          COUNT(*) FILTER (WHERE latest_review.status IS DISTINCT FROM 'success')::text AS unreviewed,
          AVG(latest_review.score)::text AS average_score
        FROM jobs
        LEFT JOIN LATERAL (
          SELECT NULLIF(value->>'priorityModelName', '') AS priority_model_name
          FROM settings
          WHERE key = 'ai.runtime'
          LIMIT 1
        ) ai_runtime ON true
        LEFT JOIN LATERAL (
          SELECT job_reviews.status, job_reviews.score
          FROM job_reviews
          WHERE job_reviews.job_id = jobs.id
          ORDER BY
            CASE
              WHEN job_reviews.status = 'success'
                AND ai_runtime.priority_model_name IS NOT NULL
                AND job_reviews.model_name = ai_runtime.priority_model_name THEN 0
              WHEN job_reviews.status = 'success' THEN 1
              ELSE 2
            END,
            job_reviews.created_at DESC,
            job_reviews.id DESC
          LIMIT 1
        ) latest_review ON true
        WHERE jobs.availability_status = 'active'
          AND EXISTS (
            SELECT 1
            FROM job_search_presence standard_presence
            WHERE standard_presence.job_id = jobs.id
          )
      `,
    ),
    pool.query<{ count: string; key: JobReviewDecision | null }>(
      `
        SELECT COALESCE(latest_review.decision, 'none') AS key, COUNT(*)::text AS count
        FROM jobs
        LEFT JOIN LATERAL (
          SELECT NULLIF(value->>'priorityModelName', '') AS priority_model_name
          FROM settings
          WHERE key = 'ai.runtime'
          LIMIT 1
        ) ai_runtime ON true
        LEFT JOIN LATERAL (
          SELECT job_reviews.decision, job_reviews.status
          FROM job_reviews
          WHERE job_reviews.job_id = jobs.id
          ORDER BY
            CASE
              WHEN job_reviews.status = 'success'
                AND ai_runtime.priority_model_name IS NOT NULL
                AND job_reviews.model_name = ai_runtime.priority_model_name THEN 0
              WHEN job_reviews.status = 'success' THEN 1
              ELSE 2
            END,
            job_reviews.created_at DESC,
            job_reviews.id DESC
          LIMIT 1
        ) latest_review ON true
        WHERE jobs.availability_status = 'active'
          AND EXISTS (
            SELECT 1
            FROM job_search_presence standard_presence
            WHERE standard_presence.job_id = jobs.id
          )
        GROUP BY COALESCE(latest_review.decision, 'none')
        ORDER BY key ASC
      `,
    ),
    listJobs(pool, {
      decision: ['apply'],
      limit: input.topLimit,
      offset: 0,
      scope: 'standard',
      sortBy: 'aiScore',
      sortDir: 'desc',
    }),
  ]);

  const summary = summaryResult.rows[0];
  const parsedAverageScore = summary?.average_score
    ? Number.parseFloat(summary.average_score)
    : Number.NaN;

  return {
    averageScore: Number.isFinite(parsedAverageScore)
      ? Math.round(parsedAverageScore * 10) / 10
      : null,
    byDecision: decisionResult.rows.map((row) => ({
      count: Number.parseInt(row.count, 10),
      key: row.key ?? 'none',
    })),
    reviewed: Number.parseInt(summary?.reviewed ?? '0', 10),
    topMatches: topMatches.items,
    totalActive: Number.parseInt(summary?.total_active ?? '0', 10),
    unreviewed: Number.parseInt(summary?.unreviewed ?? '0', 10),
  };
}

export async function readJob(pool: DatabasePool, id: string): Promise<JobDetailRecord | null> {
  const result = await pool.query<JobRow>(
    `
      ${buildJobSelect(true)}
      WHERE jobs.id = $1
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapJobDetail(row) : null;
}

export async function readJobReviews(
  pool: DatabasePool,
  jobId: string,
): Promise<JobReviewDetailRecord[]> {
  const result = await pool.query<{ item: unknown }>(
    `
      SELECT jsonb_build_object(
        'id', job_reviews.id,
        'createdAt', job_reviews.created_at,
        'decision', job_reviews.decision,
        'endpointId', job_reviews.endpoint_id,
        'endpointName', ai_endpoints.name,
        'error', job_reviews.error,
        'isPriority',
          job_reviews.status = 'success'
          AND ai_runtime.priority_model_name IS NOT NULL
          AND job_reviews.model_name = ai_runtime.priority_model_name,
        'metrics', job_reviews.metrics,
        'modelId', job_reviews.model_id,
        'modelName', job_reviews.model_name,
        'priorityReason',
          CASE
            WHEN job_reviews.status = 'success'
              AND ai_runtime.priority_model_name IS NOT NULL
              AND job_reviews.model_name = ai_runtime.priority_model_name THEN 'priority_model'
            WHEN job_reviews.status = 'success' THEN 'latest_success'
            ELSE 'latest_review'
          END,
        'profileHash', job_reviews.profile_hash,
        'rawOutput', job_reviews.raw_output,
        'result', job_reviews.result,
        'reviewMode', job_reviews.metrics->>'mode',
        'rulesHash', job_reviews.rules_hash,
        'score', job_reviews.score,
        'status', job_reviews.status
      ) AS item
      FROM job_reviews
      LEFT JOIN ai_endpoints ON ai_endpoints.id = job_reviews.endpoint_id
      LEFT JOIN LATERAL (
        SELECT NULLIF(value->>'priorityModelName', '') AS priority_model_name
        FROM settings
        WHERE key = 'ai.runtime'
        LIMIT 1
      ) ai_runtime ON true
      WHERE job_reviews.job_id = $1::uuid
      ORDER BY
        CASE
          WHEN job_reviews.status = 'success'
            AND ai_runtime.priority_model_name IS NOT NULL
            AND job_reviews.model_name = ai_runtime.priority_model_name THEN 0
          WHEN job_reviews.status = 'success' THEN 1
          ELSE 2
        END,
        job_reviews.created_at DESC,
        job_reviews.id DESC
    `,
    [jobId],
  );

  return result.rows
    .map((row) => row.item)
    .filter(isRecord)
    .map(mapReviewDetail);
}

export async function updateJobLocalStatus(
  pool: DatabasePool,
  id: string,
  localStatus: JobLocalStatus,
): Promise<JobDetailRecord | null> {
  const result = await pool.query<{ id: string }>(
    `
      UPDATE jobs
      SET local_status = $2
      WHERE id = $1
      RETURNING id
    `,
    [id, localStatus],
  );

  if (!result.rows[0]) {
    return null;
  }

  return readJob(pool, id);
}

export async function exportJob(
  pool: DatabasePool,
  id: string,
): Promise<Record<string, unknown> | null> {
  const job = await readJob(pool, id);

  if (!job) {
    return null;
  }

  return {
    exportedAt: new Date().toISOString(),
    externalJobs: job.externalJobs,
    job: {
      availabilityStatus: job.availabilityStatus,
      companyName: job.companyName,
      createdAt: job.createdAt,
      employmentType: job.employmentType,
      id: job.id,
      localStatus: job.localStatus,
      locationText: job.locationText,
      providerUrl: job.providerUrl,
      publishedAt: job.publishedAt,
      repostedAt: job.repostedAt,
      seniority: job.seniority,
      sourceUrl: job.sourceUrl,
      title: job.title,
      updatedAt: job.updatedAt,
      workplaceType: job.workplaceType,
    },
    latestDescription: job.description,
    latestReview: job.latestReview,
    reviews: await readJobReviews(pool, id),
    searches: job.searches,
  };
}

export async function readExistingJobIds(pool: DatabasePool, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }

  const result = await pool.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM jobs
      WHERE id = ANY($1::uuid[])
    `,
    [ids],
  );

  return new Set(result.rows.map((row) => row.id));
}

export async function hasSuccessfulAutomaticJobReview(
  pool: DatabasePool,
  input: { jobId: string; modelName: string },
): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM job_reviews
        WHERE job_id = $1::uuid
          AND model_name = $2
          AND status = 'success'
          AND metrics->>'mode' = 'automatic'
      ) AS exists
    `,
    [input.jobId, input.modelName],
  );

  return result.rows[0]?.exists === true;
}
