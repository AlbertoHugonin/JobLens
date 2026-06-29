import type { DatabasePool } from '../db/pool.js';

export type ActivityStatus =
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'queued'
  | 'running'
  | 'success';

export interface ActivityRecord {
  activityType: string;
  attempt: number;
  cancelRequestedAt: string | null;
  createdAt: string;
  error: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  id: string;
  leaseExpiresAt: string | null;
  leaseOwner: string | null;
  maxAttempts: number;
  message: string | null;
  payload: unknown;
  phase: string | null;
  progressCurrent: number;
  progressTotal: number | null;
  queuedAt: string;
  source: string;
  startedAt: string | null;
  status: ActivityStatus;
  subjectId: string | null;
  subjectType: string | null;
  updatedAt: string;
}

export interface ActivityLogRecord {
  activityId: string;
  createdAt: string;
  data: unknown;
  id: string;
  level: 'debug' | 'error' | 'info' | 'warn';
  message: string;
}

export interface PaginatedActivities {
  items: ActivityRecord[];
  total: number;
}

export interface PaginatedActivityLogs {
  items: ActivityLogRecord[];
  total: number;
}

export interface ActivityCountRecord {
  count: number;
  key: string;
}

export interface ActivitySummaryRecord {
  active: ActivityRecord[];
  byStatus: ActivityCountRecord[];
  byType: ActivityCountRecord[];
  total: number;
}

export type ActivityMutationReason = 'not_cancellable' | 'not_retryable';
export type AiReviewMode = 'automatic' | 'benchmark' | 'manual';
export type ExportActivityKind = 'debug_bundle' | 'jobs_reviews_jsonl';

export interface ActivityMutationResult {
  activity: ActivityRecord | null;
  reason?: ActivityMutationReason | undefined;
}

export interface ActivityQueueCancellationResult {
  cancelled: number;
  items: ActivityRecord[];
  requested: number;
  total: number;
}

export interface LinkedInRawPayloadDebugRecord {
  contentType: string | null;
  createdAt: string;
  elapsedMs: number | null;
  error: string | null;
  id: string;
  payloadKind: 'empty' | 'json' | 'text';
  requestParams: unknown;
  requestUrl: string | null;
  responseStatus: number | null;
  snippet: string | null;
}

export interface LinkedInRawPayloadStatusCount {
  count: number;
  status: string;
}

export interface LinkedInActivityDebugRecord {
  activityId: string;
  activityType: string;
  failed: number;
  items: LinkedInRawPayloadDebugRecord[];
  latestStatus: number | null;
  providerKey: 'linkedin';
  statusCounts: LinkedInRawPayloadStatusCount[];
  total: number;
}

export interface SearchRunSkipRecord {
  reason: 'not_found_or_disabled';
  searchId: string;
}

export interface SearchRunManyResult {
  queued: ActivityRecord[];
  skipped: SearchRunSkipRecord[];
  total: number;
}

const RETRYABLE_ACTIVITY_TYPES = new Set([
  'ai_review',
  'dummy',
  'export',
  'linkedin_availability',
  'linkedin_collect',
  'linkedin_describe',
  'model_install',
]);

type ActivityRow = {
  activity_type: string;
  attempt: number;
  cancel_requested_at: Date | null;
  created_at: Date;
  error: string | null;
  finished_at: Date | null;
  heartbeat_at: Date | null;
  id: string;
  lease_expires_at: Date | null;
  lease_owner: string | null;
  max_attempts: number;
  message: string | null;
  payload: unknown;
  phase: string | null;
  progress_current: number;
  progress_total: number | null;
  queued_at: Date;
  source: string;
  started_at: Date | null;
  status: ActivityStatus;
  subject_id: string | null;
  subject_type: string | null;
  updated_at: Date;
};

type LinkedInRawPayloadRow = {
  content_type: string | null;
  created_at: Date;
  elapsed_ms: number | null;
  id: string;
  payload: unknown;
  payload_text: string | null;
  request_params: unknown;
  request_url: string | null;
  response_status: number | null;
};

const SECRET_KEY_PATTERN =
  /authorization|cookie|csrf|jsessionid|li_at|password|secret|token|x-li-track/i;
const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/(li_at=)[^;\s&"]+/gi, '$1[redacted]'],
  [/(JSESSIONID=)"?[^;\s&"]+"?/gi, '$1"[redacted]"'],
  [/(csrf-token["'=:\s]+)[^,\s;"&}]+/gi, '$1[redacted]'],
  [/(authorization["'=:\s]+Bearer\s+)[^,\s;"&}]+/gi, '$1[redacted]'],
];
const DEBUG_SNIPPET_LIMIT = 4_000;
const DEBUG_VALUE_LIMIT = 1_000;

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapActivity(row: ActivityRow): ActivityRecord {
  return {
    activityType: row.activity_type,
    attempt: row.attempt,
    cancelRequestedAt: formatDate(row.cancel_requested_at),
    createdAt: row.created_at.toISOString(),
    error: row.error,
    finishedAt: formatDate(row.finished_at),
    heartbeatAt: formatDate(row.heartbeat_at),
    id: row.id,
    leaseExpiresAt: formatDate(row.lease_expires_at),
    leaseOwner: row.lease_owner,
    maxAttempts: row.max_attempts,
    message: row.message,
    payload: row.payload,
    phase: row.phase,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    queuedAt: row.queued_at.toISOString(),
    source: row.source,
    startedAt: formatDate(row.started_at),
    status: row.status,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    updatedAt: row.updated_at.toISOString(),
  };
}

function canRetryActivityRow(row: ActivityRow): boolean {
  return row.status === 'failed' && RETRYABLE_ACTIVITY_TYPES.has(row.activity_type);
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}... [truncated]`;
}

function redactSecretsFromText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

function sanitizeDebugValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[truncated]';
  }

  if (typeof value === 'string') {
    return truncateText(redactSecretsFromText(value), DEBUG_VALUE_LIMIT);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDebugValue(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeDebugValue(item, depth + 1),
    ]),
  );
}

function stringifyDebugPayload(payload: unknown, payloadText: string | null): string | null {
  const source =
    payload !== null && payload !== undefined
      ? JSON.stringify(sanitizeDebugValue(payload), null, 2)
      : payloadText;

  if (!source) {
    return null;
  }

  return truncateText(redactSecretsFromText(source), DEBUG_SNIPPET_LIMIT);
}

function findPayloadError(value: unknown, depth = 0): string | null {
  if (depth > 5 || value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPayloadError(item, depth + 1);
      if (found) {
        return found;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;
  const preferredKeys = ['message', 'errorMessage', 'error', 'detail', 'title'];

  for (const key of preferredKeys) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) {
      return truncateText(redactSecretsFromText(item.trim()), 500);
    }
  }

  for (const item of Object.values(record)) {
    const found = findPayloadError(item, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function mapLinkedInDebugRawPayload(row: LinkedInRawPayloadRow): LinkedInRawPayloadDebugRecord {
  const payloadKind =
    row.payload !== null && row.payload !== undefined
      ? 'json'
      : row.payload_text
        ? 'text'
        : 'empty';
  const snippet = stringifyDebugPayload(row.payload, row.payload_text);
  const error =
    row.payload !== null && row.payload !== undefined
      ? findPayloadError(row.payload)
      : row.payload_text
        ? truncateText(redactSecretsFromText(row.payload_text), 500)
        : row.response_status && row.response_status >= 400
          ? `HTTP ${row.response_status}`
          : null;

  return {
    contentType: row.content_type,
    createdAt: row.created_at.toISOString(),
    elapsedMs: row.elapsed_ms,
    error,
    id: row.id,
    payloadKind,
    requestParams: sanitizeDebugValue(row.request_params),
    requestUrl: row.request_url ? redactSecretsFromText(row.request_url) : null,
    responseStatus: row.response_status,
    snippet,
  };
}

async function insertActivityLog(
  pool: Pick<DatabasePool, 'query'>,
  input: {
    activityId: string;
    data?: unknown | undefined;
    level: ActivityLogRecord['level'];
    message: string;
  },
): Promise<void> {
  await pool.query(
    `
      INSERT INTO activity_logs(activity_id, level, message, data)
      VALUES ($1, $2, $3, $4::jsonb)
    `,
    [input.activityId, input.level, input.message, JSON.stringify(input.data ?? {})],
  );
}

export async function createDummyActivity(
  pool: DatabasePool,
  input: { payload?: unknown | undefined } = {},
): Promise<ActivityRecord> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query<ActivityRow>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          phase,
          message,
          payload,
          progress_current,
          progress_total,
          source
        )
        VALUES (
          'dummy',
          'queued',
          'queued',
          'Dummy activity queued',
          $1::jsonb,
          0,
          5,
          'api'
        )
        RETURNING *
      `,
      [JSON.stringify(input.payload ?? {})],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error('Unable to create dummy activity');
    }

    await insertActivityLog(client, {
      activityId: row.id,
      data: { activityType: 'dummy', source: 'api' },
      level: 'info',
      message: 'Queued dummy activity',
    });
    await client.query('COMMIT');

    return mapActivity(row);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createLinkedInCollectionActivity(
  pool: DatabasePool,
  searchId: string,
): Promise<ActivityRecord | null> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const search = await client.query<{ id: string; name: string; provider_key: string }>(
      `
        SELECT searches.id, searches.name, providers.provider_key
        FROM searches
        JOIN providers ON providers.id = searches.provider_id
        WHERE searches.id = $1
          AND searches.enabled = true
      `,
      [searchId],
    );
    const row = search.rows[0];

    if (!row || row.provider_key !== 'linkedin') {
      await client.query('ROLLBACK');
      return null;
    }

    const result = await client.query<ActivityRow>(
      `
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
        VALUES (
          'linkedin_collect',
          'queued',
          'search',
          $1,
          'queued',
          'LinkedIn collection queued',
          $2::jsonb,
          0,
          NULL,
          'api'
        )
        RETURNING *
      `,
      [
        searchId,
        JSON.stringify({
          providerKey: 'linkedin',
          searchId,
          searchName: row.name,
        }),
      ],
    );
    const activity = result.rows[0];

    if (!activity) {
      throw new Error('Unable to create LinkedIn collection activity');
    }

    await insertActivityLog(client, {
      activityId: activity.id,
      data: { providerKey: 'linkedin', searchId },
      level: 'info',
      message: 'Queued LinkedIn collection',
    });
    await client.query('COMMIT');

    return mapActivity(activity);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createLinkedInCollectionActivities(
  pool: DatabasePool,
  input: { searchIds?: string[] | undefined } = {},
): Promise<SearchRunManyResult> {
  const searchIds = input.searchIds?.filter((id) => id.trim()) ?? [];
  const uniqueSearchIds = Array.from(new Set(searchIds));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const searches = await client.query<{ id: string; name: string }>(
      `
        SELECT searches.id::text AS id, searches.name
        FROM searches
        JOIN providers ON providers.id = searches.provider_id
        WHERE providers.provider_key = 'linkedin'
          AND searches.enabled = true
          AND (
            cardinality($1::uuid[]) = 0
            OR searches.id = ANY($1::uuid[])
          )
        ORDER BY searches.created_at ASC, searches.id ASC
      `,
      [uniqueSearchIds],
    );
    const runnableIds = new Set(searches.rows.map((row) => row.id));
    const skipped = uniqueSearchIds
      .filter((searchId) => !runnableIds.has(searchId))
      .map((searchId): SearchRunSkipRecord => ({ reason: 'not_found_or_disabled', searchId }));
    const queued: ActivityRecord[] = [];

    for (const search of searches.rows) {
      const result = await client.query<ActivityRow>(
        `
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
          VALUES (
            'linkedin_collect',
            'queued',
            'search',
            $1::uuid,
            'queued',
            'LinkedIn collection queued',
            $2::jsonb,
            0,
            NULL,
            'api'
          )
          RETURNING *
        `,
        [
          search.id,
          JSON.stringify({
            providerKey: 'linkedin',
            searchId: search.id,
            searchName: search.name,
          }),
        ],
      );
      const activity = result.rows[0];

      if (!activity) {
        throw new Error(`Unable to create LinkedIn collection activity for ${search.id}`);
      }

      await insertActivityLog(client, {
        activityId: activity.id,
        data: { providerKey: 'linkedin', searchId: search.id },
        level: 'info',
        message: 'Queued LinkedIn collection',
      });
      queued.push(mapActivity(activity));
    }

    await client.query('COMMIT');

    return {
      queued,
      skipped,
      total: queued.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createModelInstallActivity(
  pool: DatabasePool,
  input: {
    endpointId: string;
    endpointName: string;
    modelId: string;
    modelName: string;
  },
): Promise<ActivityRecord> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query<ActivityRow>(
      `
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
        VALUES (
          'model_install',
          'queued',
          'ai_model',
          $1,
          'queued',
          'Model install queued',
          $2::jsonb,
          0,
          3,
          'api'
        )
        RETURNING *
      `,
      [
        input.modelId,
        JSON.stringify({
          endpointId: input.endpointId,
          endpointName: input.endpointName,
          modelId: input.modelId,
          modelName: input.modelName,
        }),
      ],
    );
    const activity = result.rows[0];

    if (!activity) {
      throw new Error('Unable to create model install activity');
    }

    await insertActivityLog(client, {
      activityId: activity.id,
      data: {
        endpointId: input.endpointId,
        modelId: input.modelId,
        modelName: input.modelName,
      },
      level: 'info',
      message: 'Queued model install',
    });
    await client.query('COMMIT');

    return mapActivity(activity);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createAiReviewActivity(
  pool: DatabasePool,
  input: {
    endpointId: string;
    endpointName: string;
    jobId: string;
    mode: AiReviewMode;
    modelId: string;
    modelName: string;
  },
): Promise<ActivityRecord> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query<ActivityRow>(
      `
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
        VALUES (
          'ai_review',
          'queued',
          'job',
          $1,
          'queued',
          'AI review queued',
          $2::jsonb,
          0,
          4,
          'api'
        )
        RETURNING *
      `,
      [
        input.jobId,
        JSON.stringify({
          endpointId: input.endpointId,
          endpointName: input.endpointName,
          jobId: input.jobId,
          mode: input.mode,
          modelId: input.modelId,
          modelName: input.modelName,
        }),
      ],
    );
    const activity = result.rows[0];

    if (!activity) {
      throw new Error('Unable to create AI review activity');
    }

    await insertActivityLog(client, {
      activityId: activity.id,
      data: {
        endpointId: input.endpointId,
        jobId: input.jobId,
        mode: input.mode,
        modelId: input.modelId,
        modelName: input.modelName,
      },
      level: 'info',
      message: 'Queued AI review',
    });
    await client.query('COMMIT');

    return mapActivity(activity);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createExportActivity(
  pool: DatabasePool,
  input: {
    kind: ExportActivityKind;
    payload?: Record<string, unknown> | undefined;
  },
): Promise<ActivityRecord> {
  const client = await pool.connect();
  const labels: Record<ExportActivityKind, string> = {
    debug_bundle: 'Debug bundle queued',
    jobs_reviews_jsonl: 'Jobs/reviews JSONL export queued',
  };

  try {
    await client.query('BEGIN');
    const result = await client.query<ActivityRow>(
      `
        INSERT INTO activities(
          activity_type,
          status,
          subject_type,
          phase,
          message,
          payload,
          progress_current,
          progress_total,
          source
        )
        VALUES (
          'export',
          'queued',
          $1,
          'queued',
          $2,
          $3::jsonb,
          0,
          4,
          'api'
        )
        RETURNING *
      `,
      [
        input.kind === 'debug_bundle' ? 'debug' : 'export',
        labels[input.kind],
        JSON.stringify({
          kind: input.kind,
          requestedAt: new Date().toISOString(),
          ...(input.payload ?? {}),
        }),
      ],
    );
    const activity = result.rows[0];

    if (!activity) {
      throw new Error('Unable to create export activity');
    }

    await insertActivityLog(client, {
      activityId: activity.id,
      data: { kind: input.kind },
      level: 'info',
      message: labels[input.kind],
    });
    await client.query('COMMIT');

    return mapActivity(activity);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listActivities(
  pool: DatabasePool,
  input: {
    activityType?: string | undefined;
    limit: number;
    offset: number;
    subjectId?: string | undefined;
    subjectType?: string | undefined;
    status?: ActivityStatus | undefined;
  },
): Promise<PaginatedActivities> {
  const status = input.status ?? null;
  const activityType = input.activityType?.trim() || null;
  const subjectType = input.subjectType?.trim() || null;
  const subjectId = input.subjectId?.trim() || null;
  const [itemsResult, countResult] = await Promise.all([
    pool.query<ActivityRow>(
      `
        SELECT *
        FROM activities
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR activity_type = $2)
          AND ($3::text IS NULL OR subject_type = $3)
          AND ($4::uuid IS NULL OR subject_id = $4)
        ORDER BY created_at DESC, id DESC
        LIMIT $5 OFFSET $6
      `,
      [status, activityType, subjectType, subjectId, input.limit, input.offset],
    ),
    pool.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM activities
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR activity_type = $2)
          AND ($3::text IS NULL OR subject_type = $3)
          AND ($4::uuid IS NULL OR subject_id = $4)
      `,
      [status, activityType, subjectType, subjectId],
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapActivity),
    total: Number.parseInt(countResult.rows[0]?.total ?? '0', 10),
  };
}

export async function readActivitiesSummary(
  pool: DatabasePool,
  input: { activeLimit: number },
): Promise<ActivitySummaryRecord> {
  const [totalResult, statusResult, typeResult, activeResult] = await Promise.all([
    pool.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM activities'),
    pool.query<{ count: string; key: ActivityStatus }>(
      `
        SELECT status AS key, COUNT(*)::text AS count
        FROM activities
        GROUP BY status
        ORDER BY status ASC
      `,
    ),
    pool.query<{ count: string; key: string }>(
      `
        SELECT activity_type AS key, COUNT(*)::text AS count
        FROM activities
        GROUP BY activity_type
        ORDER BY activity_type ASC
      `,
    ),
    pool.query<ActivityRow>(
      `
        SELECT *
        FROM activities
        WHERE status IN ('queued', 'running')
        ORDER BY queued_at ASC, created_at ASC, id ASC
        LIMIT $1
      `,
      [input.activeLimit],
    ),
  ]);

  return {
    active: activeResult.rows.map(mapActivity),
    byStatus: statusResult.rows.map((row) => ({
      count: Number.parseInt(row.count, 10),
      key: row.key,
    })),
    byType: typeResult.rows.map((row) => ({
      count: Number.parseInt(row.count, 10),
      key: row.key,
    })),
    total: Number.parseInt(totalResult.rows[0]?.total ?? '0', 10),
  };
}

export async function readActivity(pool: DatabasePool, id: string): Promise<ActivityRecord | null> {
  const result = await pool.query<ActivityRow>(
    `
      SELECT *
      FROM activities
      WHERE id = $1
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapActivity(row) : null;
}

export async function readLinkedInActivityDebug(
  pool: DatabasePool,
  input: { activityId: string; limit: number },
): Promise<LinkedInActivityDebugRecord | null> {
  const activityResult = await pool.query<{ activity_type: string; id: string }>(
    `
      SELECT id::text AS id, activity_type
      FROM activities
      WHERE id = $1::uuid
        AND (
          activity_type LIKE 'linkedin_%'
          OR payload->>'providerKey' = 'linkedin'
          OR EXISTS (
            SELECT 1
            FROM raw_payloads
            JOIN providers ON providers.id = raw_payloads.provider_id
            WHERE raw_payloads.activity_id = activities.id
              AND providers.provider_key = 'linkedin'
          )
        )
    `,
    [input.activityId],
  );
  const activity = activityResult.rows[0];

  if (!activity) {
    return null;
  }

  const [itemsResult, countsResult, totalResult] = await Promise.all([
    pool.query<LinkedInRawPayloadRow>(
      `
        SELECT
          raw_payloads.id::text AS id,
          raw_payloads.request_url,
          raw_payloads.request_params,
          raw_payloads.response_status,
          raw_payloads.content_type,
          raw_payloads.elapsed_ms,
          raw_payloads.payload,
          raw_payloads.payload_text,
          raw_payloads.created_at
        FROM raw_payloads
        JOIN providers ON providers.id = raw_payloads.provider_id
        WHERE raw_payloads.activity_id = $1::uuid
          AND providers.provider_key = 'linkedin'
        ORDER BY raw_payloads.created_at DESC, raw_payloads.id DESC
        LIMIT $2
      `,
      [input.activityId, input.limit],
    ),
    pool.query<{ count: string; status: string }>(
      `
        SELECT COALESCE(response_status::text, 'unknown') AS status, COUNT(*)::text AS count
        FROM raw_payloads
        JOIN providers ON providers.id = raw_payloads.provider_id
        WHERE raw_payloads.activity_id = $1::uuid
          AND providers.provider_key = 'linkedin'
        GROUP BY COALESCE(response_status::text, 'unknown')
        ORDER BY status ASC
      `,
      [input.activityId],
    ),
    pool.query<{
      failed: string;
      latest_status: number | null;
      total: string;
    }>(
      `
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE response_status >= 400)::text AS failed,
          (
            SELECT latest.response_status
            FROM raw_payloads latest
            JOIN providers latest_provider ON latest_provider.id = latest.provider_id
            WHERE latest.activity_id = $1::uuid
              AND latest_provider.provider_key = 'linkedin'
            ORDER BY latest.created_at DESC, latest.id DESC
            LIMIT 1
          ) AS latest_status
        FROM raw_payloads
        JOIN providers ON providers.id = raw_payloads.provider_id
        WHERE raw_payloads.activity_id = $1::uuid
          AND providers.provider_key = 'linkedin'
      `,
      [input.activityId],
    ),
  ]);
  const totals = totalResult.rows[0];

  return {
    activityId: activity.id,
    activityType: activity.activity_type,
    failed: Number.parseInt(totals?.failed ?? '0', 10),
    items: itemsResult.rows.map(mapLinkedInDebugRawPayload),
    latestStatus: totals?.latest_status ?? null,
    providerKey: 'linkedin',
    statusCounts: countsResult.rows.map((row) => ({
      count: Number.parseInt(row.count, 10),
      status: row.status,
    })),
    total: Number.parseInt(totals?.total ?? '0', 10),
  };
}

export async function requestActivityQueueCancellation(
  pool: DatabasePool,
  input: {
    activityType?: string | undefined;
    source?: string | undefined;
  } = {},
): Promise<ActivityQueueCancellationResult> {
  const activityType = input.activityType?.trim() || null;
  const source = input.source?.trim() || null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const updated = await client.query<ActivityRow & { previous_status: ActivityStatus }>(
      `
        WITH candidates AS (
          SELECT id, status AS previous_status
          FROM activities
          WHERE status IN ('queued', 'running')
            AND ($1::text IS NULL OR activity_type = $1)
            AND ($2::text IS NULL OR source = $2)
          ORDER BY queued_at ASC, created_at ASC, id ASC
          FOR UPDATE
        ),
        updated AS (
          UPDATE activities
          SET
            status = CASE
              WHEN candidates.previous_status = 'queued' THEN 'cancelled'
              ELSE activities.status
            END,
            cancel_requested_at = COALESCE(activities.cancel_requested_at, now()),
            phase = CASE
              WHEN candidates.previous_status = 'queued' THEN 'cancelled'
              ELSE activities.phase
            END,
            message = CASE
              WHEN candidates.previous_status = 'queued' THEN 'Cancelled by queue cancellation'
              ELSE 'Cancellation requested by queue cancellation'
            END,
            lease_owner = CASE
              WHEN candidates.previous_status = 'queued' THEN NULL
              ELSE activities.lease_owner
            END,
            lease_expires_at = CASE
              WHEN candidates.previous_status = 'queued' THEN NULL
              ELSE activities.lease_expires_at
            END,
            heartbeat_at = now(),
            finished_at = CASE
              WHEN candidates.previous_status = 'queued' THEN now()
              ELSE activities.finished_at
            END
          FROM candidates
          WHERE activities.id = candidates.id
          RETURNING activities.*, candidates.previous_status
        )
        SELECT * FROM updated
        ORDER BY queued_at ASC, created_at ASC, id ASC
      `,
      [activityType, source],
    );

    for (const row of updated.rows) {
      await insertActivityLog(client, {
        activityId: row.id,
        data: { previousStatus: row.previous_status },
        level: 'warn',
        message:
          row.previous_status === 'queued'
            ? 'Cancelled queued activity via queue cancellation'
            : 'Cancellation requested via queue cancellation',
      });
    }

    await client.query('COMMIT');

    const items = updated.rows.map(mapActivity);
    const cancelled = updated.rows.filter((row) => row.previous_status === 'queued').length;
    const requested = updated.rows.filter((row) => row.previous_status === 'running').length;

    return {
      cancelled,
      items,
      requested,
      total: items.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function requestActivityCancellation(
  pool: DatabasePool,
  id: string,
): Promise<ActivityMutationResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const locked = await client.query<ActivityRow>(
      `
        SELECT *
        FROM activities
        WHERE id = $1
        FOR UPDATE
      `,
      [id],
    );
    const row = locked.rows[0];

    if (!row) {
      await client.query('ROLLBACK');
      return { activity: null };
    }

    if (row.status === 'queued') {
      const updated = await client.query<ActivityRow>(
        `
          UPDATE activities
          SET
            status = 'cancelled',
            cancel_requested_at = COALESCE(cancel_requested_at, now()),
            phase = 'cancelled',
            message = 'Cancelled before worker start',
            lease_owner = NULL,
            lease_expires_at = NULL,
            heartbeat_at = now(),
            finished_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [id],
      );

      await insertActivityLog(client, {
        activityId: id,
        data: { previousStatus: row.status },
        level: 'warn',
        message: 'Cancelled queued activity',
      });
      await client.query('COMMIT');

      return { activity: mapActivity(updated.rows[0] ?? row) };
    }

    if (row.status === 'running') {
      const updated = await client.query<ActivityRow>(
        `
          UPDATE activities
          SET
            cancel_requested_at = COALESCE(cancel_requested_at, now()),
            message = 'Cancellation requested'
          WHERE id = $1
          RETURNING *
        `,
        [id],
      );

      if (!row.cancel_requested_at) {
        await insertActivityLog(client, {
          activityId: id,
          data: { previousStatus: row.status },
          level: 'warn',
          message: 'Cancellation requested',
        });
      }

      await client.query('COMMIT');

      return { activity: mapActivity(updated.rows[0] ?? row) };
    }

    await client.query('ROLLBACK');
    return { activity: mapActivity(row), reason: 'not_cancellable' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function retryActivity(
  pool: DatabasePool,
  id: string,
): Promise<ActivityMutationResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const locked = await client.query<ActivityRow>(
      `
        SELECT *
        FROM activities
        WHERE id = $1
        FOR UPDATE
      `,
      [id],
    );
    const row = locked.rows[0];

    if (!row) {
      await client.query('ROLLBACK');
      return { activity: null };
    }

    if (!canRetryActivityRow(row)) {
      await client.query('ROLLBACK');
      return { activity: mapActivity(row), reason: 'not_retryable' };
    }

    const updated = await client.query<ActivityRow>(
      `
        UPDATE activities
        SET
          status = 'queued',
          phase = 'queued',
          message = 'Retry queued',
          error = NULL,
          progress_current = 0,
          max_attempts = GREATEST(max_attempts, attempt + 1),
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = NULL,
          cancel_requested_at = NULL,
          queued_at = now(),
          started_at = NULL,
          finished_at = NULL
        WHERE id = $1
        RETURNING *
      `,
      [id],
    );

    await insertActivityLog(client, {
      activityId: id,
      data: { previousAttempt: row.attempt, previousStatus: row.status },
      level: 'info',
      message: 'Retry queued',
    });
    await client.query('COMMIT');

    return { activity: mapActivity(updated.rows[0] ?? row) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listActivityLogs(
  pool: DatabasePool,
  input: { activityId: string; limit: number; offset: number },
): Promise<PaginatedActivityLogs> {
  const [itemsResult, countResult] = await Promise.all([
    pool.query<{
      activity_id: string;
      created_at: Date;
      data: unknown;
      id: string;
      level: 'debug' | 'error' | 'info' | 'warn';
      message: string;
    }>(
      `
        SELECT id::text, activity_id, level, message, data, created_at
        FROM activity_logs
        WHERE activity_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT $2 OFFSET $3
      `,
      [input.activityId, input.limit, input.offset],
    ),
    pool.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM activity_logs
        WHERE activity_id = $1
      `,
      [input.activityId],
    ),
  ]);

  return {
    items: itemsResult.rows.map((row) => ({
      activityId: row.activity_id,
      createdAt: row.created_at.toISOString(),
      data: row.data,
      id: row.id,
      level: row.level,
      message: row.message,
    })),
    total: Number.parseInt(countResult.rows[0]?.total ?? '0', 10),
  };
}
