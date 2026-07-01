import type { DatabasePool } from '../db/pool.js';
import { readAiSettings } from './aiRepository.js';

export const backupSectionValues = [
  'searches',
  'jobs',
  'jobSearchPresence',
  'jobDescriptions',
  'jobReviews',
  'providerSessions',
  'aiSettings',
  'aiEndpoints',
] as const;

export type BackupSection = (typeof backupSectionValues)[number];
export type BackupImportMode = 'merge' | 'replace';

export interface JobLensBackupDocument {
  exportedAt: string;
  format: 'joblens.backup';
  schemaVersion: number;
  sections: Partial<Record<BackupSection, unknown>>;
  version: 1;
}

export interface BackupSectionResult {
  deleted: number;
  imported: number;
  skipped: number;
}

export interface BackupImportResult {
  importedAt: string;
  mode: BackupImportMode;
  sections: Partial<Record<BackupSection, BackupSectionResult>>;
}

type Queryable = Pick<DatabasePool, 'query'>;

const BACKUP_FORMAT = 'joblens.backup';
const BACKUP_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const backupSectionSet = new Set<string>(backupSectionValues);
const localStatusValues = new Set(['applied', 'new', 'saved', 'viewed']);
const availabilityStatusValues = new Set([
  'active',
  'available_outside_searches',
  'missing_from_searches',
  'unavailable',
]);
const sessionStatusValues = new Set(['active', 'disabled', 'expired', 'invalid']);
const reviewStatusValues = new Set(['failed', 'success']);
const reviewDecisionValues = new Set(['apply', 'maybe', 'reject']);
const reviewOutputLanguageValues = new Set(['en', 'it', 'job_language', 'profile_language']);

export class BackupImportError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  const text = readString(value)?.trim();
  return text ? text : null;
}

function readUuid(value: unknown): string | null {
  const text = readNonEmptyString(value);
  return text && UUID_PATTERN.test(text) ? text : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readJson(value: unknown, fallback: unknown): unknown {
  return value === undefined ? fallback : value;
}

function readTimestamp(value: unknown): string {
  const text = readString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : new Date().toISOString();
}

function readNullableTimestamp(value: unknown): string | null {
  const text = readString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function readEnum(value: unknown, allowed: Set<string>, fallback: string): string {
  const text = readString(value);
  return text && allowed.has(text) ? text : fallback;
}

function readNullableEnum(value: unknown, allowed: Set<string>): string | null {
  const text = readString(value);
  return text && allowed.has(text) ? text : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readArraySection(backup: JobLensBackupDocument, section: BackupSection): unknown[] {
  const value = backup.sections[section];
  return Array.isArray(value) ? value : [];
}

function readBackup(input: unknown): JobLensBackupDocument {
  if (!isRecord(input)) {
    throw new BackupImportError('Il file non contiene un backup JobLens valido');
  }

  if (
    input.format !== BACKUP_FORMAT ||
    input.version !== BACKUP_VERSION ||
    !isRecord(input.sections)
  ) {
    throw new BackupImportError('Formato backup JobLens non supportato');
  }

  return input as unknown as JobLensBackupDocument;
}

export function normalizeBackupSections(input: readonly string[] | undefined): BackupSection[] {
  const sections = Array.from(new Set(input ?? [])).filter((section): section is BackupSection =>
    backupSectionSet.has(section),
  );

  if (sections.length === 0) {
    throw new BackupImportError('Seleziona almeno una sezione da esportare o importare');
  }

  return sections;
}

function emptyResult(deleted = 0): BackupSectionResult {
  return { deleted, imported: 0, skipped: 0 };
}

async function readSchemaVersion(pool: Queryable): Promise<number> {
  const result = await pool.query<{ version: number }>(`
    SELECT COALESCE(MAX(id), 0)::integer AS version
    FROM schema_migrations
  `);

  return result.rows[0]?.version ?? 0;
}

async function readJsonArray(pool: Queryable, query: string): Promise<unknown[]> {
  const result = await pool.query<{ items: unknown }>(query);
  const items = result.rows[0]?.items;
  return Array.isArray(items) ? items : [];
}

async function exportSearches(pool: Queryable): Promise<unknown[]> {
  return readJsonArray(
    pool,
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'createdAt', searches.created_at,
          'enabled', searches.enabled,
          'id', searches.id,
          'lastRunAt', searches.last_run_at,
          'name', searches.name,
          'providerKey', providers.provider_key,
          'query', searches.query,
          'scheduleConfig', searches.schedule_config,
          'updatedAt', searches.updated_at
        )
        ORDER BY searches.created_at ASC, searches.id ASC
      ), '[]'::jsonb) AS items
      FROM searches
      JOIN providers ON providers.id = searches.provider_id
    `,
  );
}

async function exportJobs(pool: Queryable): Promise<unknown[]> {
  return readJsonArray(
    pool,
    `
      SELECT COALESCE(jsonb_agg(item ORDER BY created_at ASC, id ASC), '[]'::jsonb) AS items
      FROM (
        SELECT
          jobs.created_at,
          jobs.id,
          jsonb_build_object(
            'availabilityStatus', jobs.availability_status,
            'companyName', jobs.company_name,
            'createdAt', jobs.created_at,
            'employmentType', jobs.employment_type,
            'externalJobs', COALESCE(external_agg.items, '[]'::jsonb),
            'id', jobs.id,
            'localStatus', jobs.local_status,
            'locationText', jobs.location_text,
            'metadata', jobs.metadata,
            'providerUrl', jobs.provider_url,
            'publishedAt', jobs.published_at,
            'repostedAt', jobs.reposted_at,
            'seniority', jobs.seniority,
            'sourceUrl', jobs.source_url,
            'title', jobs.title,
            'updatedAt', jobs.updated_at,
            'workplaceType', jobs.workplace_type
          ) AS item
        FROM jobs
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'createdAt', external_jobs.created_at,
              'externalId', external_jobs.external_id,
              'externalUrl', external_jobs.external_url,
              'firstSeenAt', external_jobs.first_seen_at,
              'id', external_jobs.id,
              'lastSeenAt', external_jobs.last_seen_at,
              'metadata', external_jobs.metadata,
              'providerKey', providers.provider_key,
              'updatedAt', external_jobs.updated_at
            )
            ORDER BY providers.provider_key ASC, external_jobs.external_id ASC
          ) AS items
          FROM external_jobs
          JOIN providers ON providers.id = external_jobs.provider_id
          WHERE external_jobs.job_id = jobs.id
        ) external_agg ON true
      ) exported_jobs
    `,
  );
}

async function exportJobSearchPresence(pool: Queryable): Promise<unknown[]> {
  return readJsonArray(
    pool,
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'firstSeenAt', first_seen_at,
          'jobId', job_id,
          'lastSeenAt', last_seen_at,
          'metadata', metadata,
          'searchId', search_id
        )
        ORDER BY first_seen_at ASC, job_id ASC, search_id ASC
      ), '[]'::jsonb) AS items
      FROM job_search_presence
    `,
  );
}

async function exportJobDescriptions(pool: Queryable): Promise<unknown[]> {
  return readJsonArray(
    pool,
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'contentHash', content_hash,
          'createdAt', created_at,
          'fetchedAt', fetched_at,
          'html', html,
          'id', id,
          'jobId', job_id,
          'metadata', metadata,
          'source', source,
          'text', text
        )
        ORDER BY created_at ASC, id ASC
      ), '[]'::jsonb) AS items
      FROM job_descriptions
    `,
  );
}

async function exportJobReviews(pool: Queryable): Promise<unknown[]> {
  return readJsonArray(
    pool,
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'createdAt', created_at,
          'decision', decision,
          'endpointId', endpoint_id,
          'error', error,
          'id', id,
          'jobId', job_id,
          'metrics', metrics,
          'modelId', model_id,
          'modelName', model_name,
          'profileHash', profile_hash,
          'rawOutput', raw_output,
          'result', result,
          'rulesHash', rules_hash,
          'score', score,
          'status', status
        )
        ORDER BY created_at ASC, id ASC
      ), '[]'::jsonb) AS items
      FROM job_reviews
    `,
  );
}

async function exportProviderSessions(pool: Queryable): Promise<unknown[]> {
  return readJsonArray(
    pool,
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'createdAt', provider_sessions.created_at,
          'id', provider_sessions.id,
          'label', provider_sessions.label,
          'lastVerifiedAt', provider_sessions.last_verified_at,
          'providerKey', providers.provider_key,
          'sessionData', provider_sessions.session_data,
          'status', provider_sessions.status,
          'updatedAt', provider_sessions.updated_at
        )
        ORDER BY provider_sessions.created_at ASC, provider_sessions.id ASC
      ), '[]'::jsonb) AS items
      FROM provider_sessions
      JOIN providers ON providers.id = provider_sessions.provider_id
    `,
  );
}

async function exportAiEndpoints(pool: Queryable): Promise<unknown> {
  const endpoints = await readJsonArray(
    pool,
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'baseUrl', base_url,
          'config', config,
          'createdAt', created_at,
          'enabled', enabled,
          'id', id,
          'isActive', is_active,
          'name', name,
          'updatedAt', updated_at
        )
        ORDER BY is_active DESC, name ASC, created_at ASC
      ), '[]'::jsonb) AS items
      FROM ai_endpoints
    `,
  );
  const models = await readJsonArray(
    pool,
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'createdAt', ai_models.created_at,
          'discoveredAt', ai_models.discovered_at,
          'endpointId', ai_models.endpoint_id,
          'id', ai_models.id,
          'installed', ai_models.installed,
          'metadata', ai_models.metadata,
          'name', ai_models.name,
          'updatedAt', ai_models.updated_at
        )
        ORDER BY ai_models.created_at ASC, ai_models.id ASC
      ), '[]'::jsonb) AS items
      FROM ai_models
    `,
  );

  return { endpoints, models };
}

async function exportAiSettings(pool: DatabasePool): Promise<unknown> {
  return readAiSettings(pool);
}

export async function createJobLensBackup(
  pool: DatabasePool,
  input: { sections: BackupSection[] },
): Promise<JobLensBackupDocument> {
  const sections: Partial<Record<BackupSection, unknown>> = {};

  for (const section of input.sections) {
    if (section === 'searches') {
      sections.searches = await exportSearches(pool);
    } else if (section === 'jobs') {
      sections.jobs = await exportJobs(pool);
    } else if (section === 'jobSearchPresence') {
      sections.jobSearchPresence = await exportJobSearchPresence(pool);
    } else if (section === 'jobDescriptions') {
      sections.jobDescriptions = await exportJobDescriptions(pool);
    } else if (section === 'jobReviews') {
      sections.jobReviews = await exportJobReviews(pool);
    } else if (section === 'providerSessions') {
      sections.providerSessions = await exportProviderSessions(pool);
    } else if (section === 'aiSettings') {
      sections.aiSettings = await exportAiSettings(pool);
    } else if (section === 'aiEndpoints') {
      sections.aiEndpoints = await exportAiEndpoints(pool);
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    format: BACKUP_FORMAT,
    schemaVersion: await readSchemaVersion(pool),
    sections,
    version: BACKUP_VERSION,
  };
}

async function upsertSetting(
  client: Queryable,
  key: string,
  value: unknown,
  description: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO settings(key, value, description)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          description = EXCLUDED.description
    `,
    [key, JSON.stringify(value), description],
  );
}

async function replaceSelectedSections(
  client: Queryable,
  sections: BackupSection[],
): Promise<Partial<Record<BackupSection, number>>> {
  const deleted: Partial<Record<BackupSection, number>> = {};
  const has = (section: BackupSection) => sections.includes(section);

  if (has('jobReviews')) {
    deleted.jobReviews = (await client.query('DELETE FROM job_reviews')).rowCount ?? 0;
  }
  if (has('jobDescriptions')) {
    deleted.jobDescriptions = (await client.query('DELETE FROM job_descriptions')).rowCount ?? 0;
  }
  if (has('jobSearchPresence')) {
    deleted.jobSearchPresence =
      (await client.query('DELETE FROM job_search_presence')).rowCount ?? 0;
  }
  if (has('jobs')) {
    deleted.jobs = (await client.query('DELETE FROM jobs')).rowCount ?? 0;
  }
  if (has('searches')) {
    deleted.searches = (await client.query('DELETE FROM searches')).rowCount ?? 0;
  }
  if (has('providerSessions')) {
    deleted.providerSessions = (await client.query('DELETE FROM provider_sessions')).rowCount ?? 0;
  }
  if (has('aiEndpoints')) {
    deleted.aiEndpoints = (await client.query('DELETE FROM ai_endpoints')).rowCount ?? 0;
    await upsertSetting(
      client,
      'ai.active_endpoint_id',
      '',
      'Active AI endpoint id used for future activities.',
    );
  }
  if (has('aiSettings')) {
    const result = await client.query(`
      DELETE FROM settings
      WHERE key IN (
        'ai.candidate_profile',
        'ai.enabled',
        'ai.pauses',
        'ai.review_fields',
        'ai.review_output_language',
        'ai.runtime',
        'evaluation.rules'
      )
    `);
    deleted.aiSettings = result.rowCount ?? 0;
  }

  return deleted;
}

async function providerIdByKey(client: Queryable, providerKey: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    'SELECT id::text AS id FROM providers WHERE provider_key = $1 AND enabled = true',
    [providerKey],
  );

  return result.rows[0]?.id ?? null;
}

async function uuidExists(client: Queryable, table: string, id: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${table} WHERE id = $1::uuid) AS exists`,
    [id],
  );

  return result.rows[0]?.exists === true;
}

async function importSearches(
  client: Queryable,
  backup: JobLensBackupDocument,
): Promise<BackupSectionResult> {
  const result = emptyResult();

  for (const item of readArraySection(backup, 'searches')) {
    if (!isRecord(item)) {
      result.skipped += 1;
      continue;
    }

    const id = readUuid(item.id);
    const providerKey = readNonEmptyString(item.providerKey);
    const name = readNonEmptyString(item.name);
    if (!id || !providerKey || !name) {
      result.skipped += 1;
      continue;
    }

    const providerId = await providerIdByKey(client, providerKey);
    if (!providerId) {
      result.skipped += 1;
      continue;
    }

    await client.query(
      `
        INSERT INTO searches(
          id,
          provider_id,
          name,
          query,
          enabled,
          schedule_config,
          last_run_at,
          created_at,
          updated_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9::timestamptz)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            query = EXCLUDED.query,
            enabled = EXCLUDED.enabled,
            schedule_config = EXCLUDED.schedule_config,
            last_run_at = EXCLUDED.last_run_at
      `,
      [
        id,
        providerId,
        name,
        JSON.stringify(readJson(item.query, {})),
        readBoolean(item.enabled, true),
        JSON.stringify(readJson(item.scheduleConfig, {})),
        readNullableTimestamp(item.lastRunAt),
        readTimestamp(item.createdAt),
        readTimestamp(item.updatedAt),
      ],
    );
    result.imported += 1;
  }

  return result;
}

async function findExistingExternalJobId(
  client: Queryable,
  externalJobs: unknown[],
): Promise<string | null> {
  for (const externalJob of externalJobs) {
    if (!isRecord(externalJob)) {
      continue;
    }

    const providerKey = readNonEmptyString(externalJob.providerKey);
    const externalId = readNonEmptyString(externalJob.externalId);
    if (!providerKey || !externalId) {
      continue;
    }

    const result = await client.query<{ job_id: string }>(
      `
        SELECT external_jobs.job_id::text AS job_id
        FROM external_jobs
        JOIN providers ON providers.id = external_jobs.provider_id
        WHERE providers.provider_key = $1
          AND external_jobs.external_id = $2
        LIMIT 1
      `,
      [providerKey, externalId],
    );

    if (result.rows[0]?.job_id) {
      return result.rows[0].job_id;
    }
  }

  return null;
}

async function importExternalJobs(
  client: Queryable,
  targetJobId: string,
  externalJobs: unknown[],
): Promise<number> {
  let imported = 0;

  for (const externalJob of externalJobs) {
    if (!isRecord(externalJob)) {
      continue;
    }

    const providerKey = readNonEmptyString(externalJob.providerKey);
    const externalId = readNonEmptyString(externalJob.externalId);
    if (!providerKey || !externalId) {
      continue;
    }

    const providerId = await providerIdByKey(client, providerKey);
    if (!providerId) {
      continue;
    }

    await client.query(
      `
        INSERT INTO external_jobs(
          id,
          provider_id,
          job_id,
          external_id,
          external_url,
          metadata,
          first_seen_at,
          last_seen_at,
          created_at,
          updated_at
        )
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2::uuid,
          $3::uuid,
          $4,
          $5,
          $6::jsonb,
          $7::timestamptz,
          $8::timestamptz,
          $9::timestamptz,
          $10::timestamptz
        )
        ON CONFLICT (provider_id, external_id) DO UPDATE
        SET job_id = EXCLUDED.job_id,
            external_url = EXCLUDED.external_url,
            metadata = EXCLUDED.metadata,
            first_seen_at = LEAST(external_jobs.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = GREATEST(external_jobs.last_seen_at, EXCLUDED.last_seen_at)
      `,
      [
        readUuid(externalJob.id),
        providerId,
        targetJobId,
        externalId,
        readString(externalJob.externalUrl),
        JSON.stringify(readJson(externalJob.metadata, {})),
        readTimestamp(externalJob.firstSeenAt),
        readTimestamp(externalJob.lastSeenAt),
        readTimestamp(externalJob.createdAt),
        readTimestamp(externalJob.updatedAt),
      ],
    );
    imported += 1;
  }

  return imported;
}

async function importJobs(
  client: Queryable,
  backup: JobLensBackupDocument,
): Promise<{ map: Map<string, string>; result: BackupSectionResult }> {
  const result = emptyResult();
  const map = new Map<string, string>();

  for (const item of readArraySection(backup, 'jobs')) {
    if (!isRecord(item)) {
      result.skipped += 1;
      continue;
    }

    const backupJobId = readUuid(item.id);
    const title = readNonEmptyString(item.title);
    const companyName = readNonEmptyString(item.companyName);
    const externalJobs = Array.isArray(item.externalJobs) ? item.externalJobs : [];
    if (!backupJobId || !title || !companyName) {
      result.skipped += 1;
      continue;
    }

    const targetJobId = (await findExistingExternalJobId(client, externalJobs)) ?? backupJobId;
    await client.query(
      `
        INSERT INTO jobs(
          id,
          title,
          company_name,
          location_text,
          workplace_type,
          employment_type,
          seniority,
          published_at,
          reposted_at,
          local_status,
          availability_status,
          source_url,
          provider_url,
          metadata,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::timestamptz,
          $9::timestamptz,
          $10,
          $11,
          $12,
          $13,
          $14::jsonb,
          $15::timestamptz,
          $16::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET title = EXCLUDED.title,
            company_name = EXCLUDED.company_name,
            location_text = EXCLUDED.location_text,
            workplace_type = EXCLUDED.workplace_type,
            employment_type = EXCLUDED.employment_type,
            seniority = EXCLUDED.seniority,
            published_at = EXCLUDED.published_at,
            reposted_at = EXCLUDED.reposted_at,
            local_status = EXCLUDED.local_status,
            availability_status = EXCLUDED.availability_status,
            source_url = EXCLUDED.source_url,
            provider_url = EXCLUDED.provider_url,
            metadata = EXCLUDED.metadata
      `,
      [
        targetJobId,
        title,
        companyName,
        readString(item.locationText),
        readString(item.workplaceType),
        readString(item.employmentType),
        readString(item.seniority),
        readNullableTimestamp(item.publishedAt),
        readNullableTimestamp(item.repostedAt),
        readEnum(item.localStatus, localStatusValues, 'new'),
        readEnum(item.availabilityStatus, availabilityStatusValues, 'active'),
        readString(item.sourceUrl),
        readString(item.providerUrl),
        JSON.stringify(readJson(item.metadata, {})),
        readTimestamp(item.createdAt),
        readTimestamp(item.updatedAt),
      ],
    );
    await importExternalJobs(client, targetJobId, externalJobs);
    map.set(backupJobId, targetJobId);
    result.imported += 1;
  }

  return { map, result };
}

async function resolveMappedId(
  client: Queryable,
  table: string,
  inputId: unknown,
  map?: Map<string, string>,
): Promise<string | null> {
  const id = readUuid(inputId);
  if (!id) {
    return null;
  }

  const mapped = map?.get(id);
  if (mapped) {
    return mapped;
  }

  return (await uuidExists(client, table, id)) ? id : null;
}

async function importJobSearchPresence(
  client: Queryable,
  backup: JobLensBackupDocument,
  jobIdMap: Map<string, string>,
): Promise<BackupSectionResult> {
  const result = emptyResult();

  for (const item of readArraySection(backup, 'jobSearchPresence')) {
    if (!isRecord(item)) {
      result.skipped += 1;
      continue;
    }

    const jobId = await resolveMappedId(client, 'jobs', item.jobId, jobIdMap);
    const searchId = await resolveMappedId(client, 'searches', item.searchId);
    if (!jobId || !searchId) {
      result.skipped += 1;
      continue;
    }

    await client.query(
      `
        INSERT INTO job_search_presence(
          job_id,
          search_id,
          first_seen_at,
          last_seen_at,
          metadata
        )
        VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, $5::jsonb)
        ON CONFLICT (job_id, search_id) DO UPDATE
        SET first_seen_at = LEAST(job_search_presence.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = GREATEST(job_search_presence.last_seen_at, EXCLUDED.last_seen_at),
            metadata = job_search_presence.metadata || EXCLUDED.metadata
      `,
      [
        jobId,
        searchId,
        readTimestamp(item.firstSeenAt),
        readTimestamp(item.lastSeenAt),
        JSON.stringify(readJson(item.metadata, {})),
      ],
    );
    result.imported += 1;
  }

  return result;
}

async function importJobDescriptions(
  client: Queryable,
  backup: JobLensBackupDocument,
  jobIdMap: Map<string, string>,
): Promise<BackupSectionResult> {
  const result = emptyResult();

  for (const item of readArraySection(backup, 'jobDescriptions')) {
    if (!isRecord(item)) {
      result.skipped += 1;
      continue;
    }

    const jobId = await resolveMappedId(client, 'jobs', item.jobId, jobIdMap);
    const contentHash = readNonEmptyString(item.contentHash);
    const text = readNonEmptyString(item.text);
    if (!jobId || !contentHash || !text) {
      result.skipped += 1;
      continue;
    }

    await client.query(
      `
        INSERT INTO job_descriptions(
          id,
          job_id,
          content_hash,
          html,
          text,
          source,
          fetched_at,
          metadata,
          created_at
        )
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7::timestamptz,
          $8::jsonb,
          $9::timestamptz
        )
        ON CONFLICT (job_id, content_hash) DO UPDATE
        SET html = EXCLUDED.html,
            text = EXCLUDED.text,
            source = EXCLUDED.source,
            fetched_at = EXCLUDED.fetched_at,
            metadata = EXCLUDED.metadata
      `,
      [
        readUuid(item.id),
        jobId,
        contentHash,
        readString(item.html),
        text,
        readNonEmptyString(item.source) ?? 'provider',
        readTimestamp(item.fetchedAt),
        JSON.stringify(readJson(item.metadata, {})),
        readTimestamp(item.createdAt),
      ],
    );
    result.imported += 1;
  }

  return result;
}

async function nullableExistingUuid(
  client: Queryable,
  table: string,
  value: unknown,
): Promise<string | null> {
  const id = readUuid(value);
  return id && (await uuidExists(client, table, id)) ? id : null;
}

async function importJobReviews(
  client: Queryable,
  backup: JobLensBackupDocument,
  jobIdMap: Map<string, string>,
): Promise<BackupSectionResult> {
  const result = emptyResult();

  for (const item of readArraySection(backup, 'jobReviews')) {
    if (!isRecord(item)) {
      result.skipped += 1;
      continue;
    }

    const jobId = await resolveMappedId(client, 'jobs', item.jobId, jobIdMap);
    const modelName = readNonEmptyString(item.modelName);
    const profileHash = readNonEmptyString(item.profileHash);
    const rulesHash = readNonEmptyString(item.rulesHash);
    if (!jobId || !modelName || !profileHash || !rulesHash) {
      result.skipped += 1;
      continue;
    }

    await client.query(
      `
        INSERT INTO job_reviews(
          id,
          job_id,
          endpoint_id,
          model_id,
          model_name,
          profile_hash,
          rules_hash,
          status,
          decision,
          score,
          result,
          raw_output,
          error,
          metrics,
          created_at
        )
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11::jsonb,
          $12,
          $13,
          $14::jsonb,
          $15::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET job_id = EXCLUDED.job_id,
            endpoint_id = EXCLUDED.endpoint_id,
            model_id = EXCLUDED.model_id,
            model_name = EXCLUDED.model_name,
            profile_hash = EXCLUDED.profile_hash,
            rules_hash = EXCLUDED.rules_hash,
            status = EXCLUDED.status,
            decision = EXCLUDED.decision,
            score = EXCLUDED.score,
            result = EXCLUDED.result,
            raw_output = EXCLUDED.raw_output,
            error = EXCLUDED.error,
            metrics = EXCLUDED.metrics
      `,
      [
        readUuid(item.id),
        jobId,
        await nullableExistingUuid(client, 'ai_endpoints', item.endpointId),
        await nullableExistingUuid(client, 'ai_models', item.modelId),
        modelName,
        profileHash,
        rulesHash,
        readEnum(item.status, reviewStatusValues, 'success'),
        readNullableEnum(item.decision, reviewDecisionValues),
        readNumber(item.score),
        JSON.stringify(readJson(item.result, {})),
        readString(item.rawOutput),
        readString(item.error),
        JSON.stringify(readJson(item.metrics, {})),
        readTimestamp(item.createdAt),
      ],
    );
    result.imported += 1;
  }

  return result;
}

async function importProviderSessions(
  client: Queryable,
  backup: JobLensBackupDocument,
): Promise<BackupSectionResult> {
  const result = emptyResult();

  for (const item of readArraySection(backup, 'providerSessions')) {
    if (!isRecord(item)) {
      result.skipped += 1;
      continue;
    }

    const id = readUuid(item.id);
    const providerKey = readNonEmptyString(item.providerKey);
    const label = readNonEmptyString(item.label);
    if (!id || !providerKey || !label) {
      result.skipped += 1;
      continue;
    }

    const providerId = await providerIdByKey(client, providerKey);
    if (!providerId) {
      result.skipped += 1;
      continue;
    }

    await client.query(
      `
        INSERT INTO provider_sessions(
          id,
          provider_id,
          label,
          status,
          session_data,
          last_verified_at,
          created_at,
          updated_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz, $8::timestamptz)
        ON CONFLICT (id) DO UPDATE
        SET label = EXCLUDED.label,
            status = EXCLUDED.status,
            session_data = EXCLUDED.session_data,
            last_verified_at = EXCLUDED.last_verified_at
      `,
      [
        id,
        providerId,
        label,
        readEnum(item.status, sessionStatusValues, 'active'),
        JSON.stringify(readJson(item.sessionData, {})),
        readNullableTimestamp(item.lastVerifiedAt),
        readTimestamp(item.createdAt),
        readTimestamp(item.updatedAt),
      ],
    );
    result.imported += 1;
  }

  return result;
}

async function importAiEndpoints(
  client: Queryable,
  backup: JobLensBackupDocument,
): Promise<BackupSectionResult> {
  const value = backup.sections.aiEndpoints;
  const endpoints = isRecord(value) && Array.isArray(value.endpoints) ? value.endpoints : [];
  const models = isRecord(value) && Array.isArray(value.models) ? value.models : [];
  const result = emptyResult();
  let activeEndpointId: string | null = null;

  await client.query('UPDATE ai_endpoints SET is_active = false WHERE is_active = true');

  for (const item of endpoints) {
    if (!isRecord(item)) {
      result.skipped += 1;
      continue;
    }

    const id = readUuid(item.id);
    const name = readNonEmptyString(item.name);
    const baseUrl = readNonEmptyString(item.baseUrl);
    if (!id || !name || !baseUrl) {
      result.skipped += 1;
      continue;
    }

    await client.query(
      `
        INSERT INTO ai_endpoints(
          id,
          name,
          base_url,
          enabled,
          is_active,
          config,
          created_at,
          updated_at
        )
        VALUES ($1::uuid, $2, $3, $4, false, $5::jsonb, $6::timestamptz, $7::timestamptz)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            base_url = EXCLUDED.base_url,
            enabled = EXCLUDED.enabled,
            config = EXCLUDED.config
      `,
      [
        id,
        name,
        baseUrl,
        readBoolean(item.enabled, true),
        JSON.stringify(readJson(item.config, {})),
        readTimestamp(item.createdAt),
        readTimestamp(item.updatedAt),
      ],
    );
    if (item.isActive === true) {
      activeEndpointId = id;
    }
    result.imported += 1;
  }

  for (const item of models) {
    if (!isRecord(item)) {
      result.skipped += 1;
      continue;
    }

    const id = readUuid(item.id);
    const endpointId = await nullableExistingUuid(client, 'ai_endpoints', item.endpointId);
    const name = readNonEmptyString(item.name);
    if (!id || !endpointId || !name) {
      result.skipped += 1;
      continue;
    }

    await client.query(
      `
        INSERT INTO ai_models(
          id,
          endpoint_id,
          name,
          installed,
          metadata,
          discovered_at,
          created_at,
          updated_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz, $8::timestamptz)
        ON CONFLICT (id) DO UPDATE
        SET endpoint_id = EXCLUDED.endpoint_id,
            name = EXCLUDED.name,
            installed = EXCLUDED.installed,
            metadata = EXCLUDED.metadata,
            discovered_at = EXCLUDED.discovered_at
      `,
      [
        id,
        endpointId,
        name,
        readBoolean(item.installed, false),
        JSON.stringify(readJson(item.metadata, {})),
        readTimestamp(item.discoveredAt),
        readTimestamp(item.createdAt),
        readTimestamp(item.updatedAt),
      ],
    );
    result.imported += 1;
  }

  if (activeEndpointId && (await uuidExists(client, 'ai_endpoints', activeEndpointId))) {
    await client.query('UPDATE ai_endpoints SET is_active = true WHERE id = $1::uuid', [
      activeEndpointId,
    ]);
    await upsertSetting(
      client,
      'ai.active_endpoint_id',
      activeEndpointId,
      'Active AI endpoint id used for future activities.',
    );
  }

  return result;
}

async function importAiSettings(
  client: Queryable,
  backup: JobLensBackupDocument,
): Promise<BackupSectionResult> {
  const item = backup.sections.aiSettings;
  const result = emptyResult();
  if (!isRecord(item)) {
    result.skipped = 1;
    return result;
  }

  if (typeof item.enabled === 'boolean') {
    await upsertSetting(
      client,
      'ai.enabled',
      item.enabled,
      'External AI integration enabled flag.',
    );
    result.imported += 1;
  }
  if (typeof item.candidateProfile === 'string') {
    await upsertSetting(
      client,
      'ai.candidate_profile',
      item.candidateProfile,
      'Candidate profile used for future AI reviews.',
    );
    result.imported += 1;
  }
  if (typeof item.evaluationRules === 'string') {
    await upsertSetting(
      client,
      'evaluation.rules',
      item.evaluationRules,
      'Active evaluation rules used for future AI reviews.',
    );
    result.imported += 1;
  }
  if (readNullableEnum(item.outputLanguage, reviewOutputLanguageValues)) {
    await upsertSetting(
      client,
      'ai.review_output_language',
      item.outputLanguage,
      'Language used for future AI review free-text output.',
    );
    result.imported += 1;
  }
  if (isRecord(item.runtime)) {
    await upsertSetting(
      client,
      'ai.runtime',
      item.runtime,
      'Runtime parameters for future AI review activities.',
    );
    result.imported += 1;
  }
  if (Array.isArray(item.pauses)) {
    await upsertSetting(
      client,
      'ai.pauses',
      item.pauses,
      'AI pause windows used by future AI queue processing.',
    );
    result.imported += 1;
  }
  if (Array.isArray(item.reviewFields)) {
    await upsertSetting(
      client,
      'ai.review_fields',
      item.reviewFields,
      'Configurable evidence fields used for future AI reviews.',
    );
    result.imported += 1;
  }

  const activeEndpointId = readUuid(item.activeEndpointId);
  if (activeEndpointId && (await uuidExists(client, 'ai_endpoints', activeEndpointId))) {
    await client.query('UPDATE ai_endpoints SET is_active = false WHERE is_active = true');
    await client.query('UPDATE ai_endpoints SET is_active = true WHERE id = $1::uuid', [
      activeEndpointId,
    ]);
    await upsertSetting(
      client,
      'ai.active_endpoint_id',
      activeEndpointId,
      'Active AI endpoint id used for future activities.',
    );
  }

  return result;
}

function mergeDeleted(
  result: BackupSectionResult,
  deleted: Partial<Record<BackupSection, number>>,
  section: BackupSection,
): BackupSectionResult {
  return { ...result, deleted: deleted[section] ?? 0 };
}

export async function importJobLensBackup(
  pool: DatabasePool,
  input: {
    backup: unknown;
    mode: BackupImportMode;
    sections: BackupSection[];
  },
): Promise<BackupImportResult> {
  const backup = readBackup(input.backup);
  const sections = input.sections;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const deleted = input.mode === 'replace' ? await replaceSelectedSections(client, sections) : {};
    const results: Partial<Record<BackupSection, BackupSectionResult>> = {};
    let jobIdMap = new Map<string, string>();

    if (sections.includes('providerSessions')) {
      results.providerSessions = mergeDeleted(
        await importProviderSessions(client, backup),
        deleted,
        'providerSessions',
      );
    }
    if (sections.includes('aiEndpoints')) {
      results.aiEndpoints = mergeDeleted(
        await importAiEndpoints(client, backup),
        deleted,
        'aiEndpoints',
      );
    }
    if (sections.includes('aiSettings')) {
      results.aiSettings = mergeDeleted(
        await importAiSettings(client, backup),
        deleted,
        'aiSettings',
      );
    }
    if (sections.includes('searches')) {
      results.searches = mergeDeleted(await importSearches(client, backup), deleted, 'searches');
    }
    if (sections.includes('jobs')) {
      const importedJobs = await importJobs(client, backup);
      jobIdMap = importedJobs.map;
      results.jobs = mergeDeleted(importedJobs.result, deleted, 'jobs');
    }
    if (sections.includes('jobSearchPresence')) {
      results.jobSearchPresence = mergeDeleted(
        await importJobSearchPresence(client, backup, jobIdMap),
        deleted,
        'jobSearchPresence',
      );
    }
    if (sections.includes('jobDescriptions')) {
      results.jobDescriptions = mergeDeleted(
        await importJobDescriptions(client, backup, jobIdMap),
        deleted,
        'jobDescriptions',
      );
    }
    if (sections.includes('jobReviews')) {
      results.jobReviews = mergeDeleted(
        await importJobReviews(client, backup, jobIdMap),
        deleted,
        'jobReviews',
      );
    }

    await client.query('COMMIT');

    return {
      importedAt: new Date().toISOString(),
      mode: input.mode,
      sections: results,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
