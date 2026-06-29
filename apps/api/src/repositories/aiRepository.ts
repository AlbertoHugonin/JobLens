import type { DatabasePool } from '../db/pool.js';

export interface AiEndpointRecord {
  baseUrl: string;
  config: unknown;
  createdAt: string;
  enabled: boolean;
  id: string;
  isActive: boolean;
  name: string;
  updatedAt: string;
}

export interface AiModelRecord {
  createdAt: string;
  discoveredAt: string;
  endpointId: string;
  endpointName: string;
  id: string;
  installed: boolean;
  metadata: unknown;
  name: string;
  updatedAt: string;
}

export interface AiRuntimeSettings {
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
}

export interface AiPauseWindow {
  dayOfWeek: number;
  enabled: boolean;
  endTime: string;
  startTime: string;
}

export interface AiSettingsRecord {
  activeEndpointId: string | null;
  candidateProfile: string;
  enabled: boolean;
  evaluationRules: string;
  pauses: AiPauseWindow[];
  rulesTemplate: string;
  rulesTemplateVersion: number;
  runtime: AiRuntimeSettings;
  updatedAt: string;
}

interface AiEndpointRow {
  base_url: string;
  config: unknown;
  created_at: Date;
  enabled: boolean;
  id: string;
  is_active: boolean;
  name: string;
  updated_at: Date;
}

interface AiModelRow {
  created_at: Date;
  discovered_at: Date;
  endpoint_id: string;
  endpoint_name: string;
  id: string;
  installed: boolean;
  metadata: unknown;
  name: string;
  updated_at: Date;
}

interface SettingRow {
  updated_at: Date;
  value: unknown;
}

const DEFAULT_CANDIDATE_PROFILE = [
  'Ruolo target: software engineer.',
  'Priorita: impatto concreto, qualita tecnica, autonomia e contesto collaborativo.',
  'Vincoli: valutare sede, seniority, stack e chiarezza del ruolo prima di candidarsi.',
].join('\n');

export const DEFAULT_EVALUATION_RULES = [
  'Decisione:',
  '- apply: forte corrispondenza con ruolo, competenze e vincoli.',
  '- maybe: potenziale interessante con gap o informazioni mancanti.',
  '- reject: incompatibilita chiara o blocker sostanziali.',
  '',
  'Score:',
  '- 80-100 per match forte e pochi rischi.',
  '- 50-79 per match parziale o incertezza gestibile.',
  '- 0-49 per fit debole o blocker.',
  '',
  "Compila blocker, matching_points, optional matches, mandatory_gaps e caution_notes con esempi concreti dall'offerta.",
].join('\n');

const DEFAULT_RUNTIME: AiRuntimeSettings = {
  keepAlive: '10m',
  modelName: '',
  numCtx: 8192,
  numPredict: 1024,
  priorityModelName: '',
  retryAttempts: 1,
  retryDelaySeconds: 30,
  temperature: 0.2,
  think: false,
  timeoutSeconds: 120,
};

const DEFAULT_PAUSES: AiPauseWindow[] = [];

function mapEndpoint(row: AiEndpointRow): AiEndpointRecord {
  return {
    baseUrl: row.base_url,
    config: row.config,
    createdAt: row.created_at.toISOString(),
    enabled: row.enabled,
    id: row.id,
    isActive: row.is_active,
    name: row.name,
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapModel(row: AiModelRow): AiModelRecord {
  return {
    createdAt: row.created_at.toISOString(),
    discoveredAt: row.discovered_at.toISOString(),
    endpointId: row.endpoint_id,
    endpointName: row.endpoint_name,
    id: row.id,
    installed: row.installed,
    metadata: row.metadata,
    name: row.name,
    updatedAt: row.updated_at.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeRuntime(value: unknown): AiRuntimeSettings {
  const input = isRecord(value) ? value : {};

  return {
    keepAlive: readString(input.keepAlive, DEFAULT_RUNTIME.keepAlive),
    modelName: readString(input.modelName, DEFAULT_RUNTIME.modelName),
    numCtx: Math.max(512, Math.round(readNumber(input.numCtx, DEFAULT_RUNTIME.numCtx))),
    numPredict: Math.max(128, Math.round(readNumber(input.numPredict, DEFAULT_RUNTIME.numPredict))),
    priorityModelName: readString(input.priorityModelName, DEFAULT_RUNTIME.priorityModelName),
    retryAttempts: Math.max(
      0,
      Math.round(readNumber(input.retryAttempts, DEFAULT_RUNTIME.retryAttempts)),
    ),
    retryDelaySeconds: Math.max(
      0,
      Math.round(readNumber(input.retryDelaySeconds, DEFAULT_RUNTIME.retryDelaySeconds)),
    ),
    temperature: Math.max(
      0,
      Math.min(2, readNumber(input.temperature, DEFAULT_RUNTIME.temperature)),
    ),
    think: readBoolean(input.think, DEFAULT_RUNTIME.think),
    timeoutSeconds: Math.max(
      5,
      Math.round(readNumber(input.timeoutSeconds, DEFAULT_RUNTIME.timeoutSeconds)),
    ),
  };
}

function normalizePauses(value: unknown): AiPauseWindow[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PAUSES;
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      dayOfWeek: Math.max(0, Math.min(6, Math.round(readNumber(item.dayOfWeek, 0)))),
      enabled: readBoolean(item.enabled, true),
      endTime: readString(item.endTime, '18:00'),
      startTime: readString(item.startTime, '09:00'),
    }))
    .filter((item) => item.startTime < item.endTime);
}

async function readSetting(pool: DatabasePool, key: string): Promise<SettingRow | null> {
  const result = await pool.query<SettingRow>(
    `
      SELECT value, updated_at
      FROM settings
      WHERE key = $1
    `,
    [key],
  );

  return result.rows[0] ?? null;
}

async function upsertSetting(
  pool: Pick<DatabasePool, 'query'>,
  key: string,
  value: unknown,
  description: string,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO settings(key, value, description)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          description = EXCLUDED.description,
          updated_at = now()
    `,
    [key, JSON.stringify(value), description],
  );
}

export async function readAiSettings(pool: DatabasePool): Promise<AiSettingsRecord> {
  const [
    enabled,
    activeEndpoint,
    candidateProfile,
    evaluationRules,
    runtime,
    pauses,
    templateVersion,
  ] = await Promise.all([
    readSetting(pool, 'ai.enabled'),
    readSetting(pool, 'ai.active_endpoint_id'),
    readSetting(pool, 'ai.candidate_profile'),
    readSetting(pool, 'evaluation.rules'),
    readSetting(pool, 'ai.runtime'),
    readSetting(pool, 'ai.pauses'),
    readSetting(pool, 'evaluation.rules.template_version'),
  ]);
  const updatedAt = [
    enabled,
    activeEndpoint,
    candidateProfile,
    evaluationRules,
    runtime,
    pauses,
    templateVersion,
  ]
    .filter(Boolean)
    .map((setting) => setting?.updated_at.getTime() ?? 0)
    .sort((left, right) => right - left)[0];

  return {
    activeEndpointId:
      typeof activeEndpoint?.value === 'string' && activeEndpoint.value.trim()
        ? activeEndpoint.value
        : null,
    candidateProfile: readString(candidateProfile?.value, DEFAULT_CANDIDATE_PROFILE),
    enabled: readBoolean(enabled?.value, false),
    evaluationRules: readString(evaluationRules?.value, DEFAULT_EVALUATION_RULES),
    pauses: normalizePauses(pauses?.value),
    rulesTemplate: DEFAULT_EVALUATION_RULES,
    rulesTemplateVersion: Math.round(readNumber(templateVersion?.value, 1)),
    runtime: normalizeRuntime(runtime?.value),
    updatedAt: new Date(updatedAt ?? Date.now()).toISOString(),
  };
}

export async function updateAiSettings(
  pool: DatabasePool,
  input: {
    candidateProfile?: string | undefined;
    enabled?: boolean | undefined;
    evaluationRules?: string | undefined;
    pauses?: AiPauseWindow[] | undefined;
    runtime?: unknown | undefined;
  },
): Promise<AiSettingsRecord> {
  const current = await readAiSettings(pool);

  if (input.enabled !== undefined) {
    await upsertSetting(pool, 'ai.enabled', input.enabled, 'External AI integration enabled flag.');
  }
  if (input.candidateProfile !== undefined) {
    await upsertSetting(
      pool,
      'ai.candidate_profile',
      input.candidateProfile,
      'Candidate profile used for future AI reviews.',
    );
  }
  if (input.evaluationRules !== undefined) {
    await upsertSetting(
      pool,
      'evaluation.rules',
      input.evaluationRules,
      'Active evaluation rules used for future AI reviews.',
    );
  }
  if (input.runtime !== undefined) {
    await upsertSetting(
      pool,
      'ai.runtime',
      normalizeRuntime({
        ...current.runtime,
        ...(isRecord(input.runtime) ? input.runtime : {}),
      }),
      'Runtime parameters for future AI review activities.',
    );
  }
  if (input.pauses !== undefined) {
    await upsertSetting(
      pool,
      'ai.pauses',
      normalizePauses(input.pauses),
      'AI pause windows used by future AI queue processing.',
    );
  }

  return readAiSettings(pool);
}

export async function resetEvaluationRules(pool: DatabasePool): Promise<AiSettingsRecord> {
  await upsertSetting(
    pool,
    'evaluation.rules',
    DEFAULT_EVALUATION_RULES,
    'Active evaluation rules used for future AI reviews.',
  );

  return readAiSettings(pool);
}

export async function listAiEndpoints(pool: DatabasePool): Promise<AiEndpointRecord[]> {
  const result = await pool.query<AiEndpointRow>(
    `
      SELECT id, name, base_url, enabled, is_active, config, created_at, updated_at
      FROM ai_endpoints
      ORDER BY is_active DESC, name ASC, created_at DESC
    `,
  );

  return result.rows.map(mapEndpoint);
}

export async function readAiEndpoint(
  pool: DatabasePool,
  id: string,
): Promise<AiEndpointRecord | null> {
  const result = await pool.query<AiEndpointRow>(
    `
      SELECT id, name, base_url, enabled, is_active, config, created_at, updated_at
      FROM ai_endpoints
      WHERE id = $1::uuid
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapEndpoint(row) : null;
}

export async function createAiEndpoint(
  pool: DatabasePool,
  input: { baseUrl: string; config?: unknown | undefined; enabled: boolean; name: string },
): Promise<AiEndpointRecord> {
  const result = await pool.query<AiEndpointRow>(
    `
      INSERT INTO ai_endpoints(name, base_url, enabled, config)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, name, base_url, enabled, is_active, config, created_at, updated_at
    `,
    [input.name, input.baseUrl, input.enabled, JSON.stringify(input.config ?? {})],
  );

  return mapEndpoint(result.rows[0]!);
}

export async function updateAiEndpoint(
  pool: DatabasePool,
  id: string,
  input: {
    baseUrl?: string | undefined;
    config?: unknown | undefined;
    enabled?: boolean | undefined;
    name?: string | undefined;
  },
): Promise<AiEndpointRecord | null> {
  const result = await pool.query<AiEndpointRow>(
    `
      UPDATE ai_endpoints
      SET
        name = COALESCE($2, name),
        base_url = COALESCE($3, base_url),
        enabled = COALESCE($4, enabled),
        config = COALESCE($5::jsonb, config)
      WHERE id = $1::uuid
      RETURNING id, name, base_url, enabled, is_active, config, created_at, updated_at
    `,
    [
      id,
      input.name ?? null,
      input.baseUrl ?? null,
      input.enabled ?? null,
      input.config === undefined ? null : JSON.stringify(input.config),
    ],
  );

  const row = result.rows[0];
  return row ? mapEndpoint(row) : null;
}

export async function activateAiEndpoint(
  pool: DatabasePool,
  id: string,
): Promise<AiEndpointRecord | null> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const exists = await client.query<{ id: string }>(
      `
        SELECT id
        FROM ai_endpoints
        WHERE id = $1::uuid
          AND enabled = true
      `,
      [id],
    );

    if (!exists.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('UPDATE ai_endpoints SET is_active = false WHERE is_active = true');
    const result = await client.query<AiEndpointRow>(
      `
        UPDATE ai_endpoints
        SET is_active = true
        WHERE id = $1::uuid
        RETURNING id, name, base_url, enabled, is_active, config, created_at, updated_at
      `,
      [id],
    );
    await upsertSetting(
      client,
      'ai.active_endpoint_id',
      id,
      'Active AI endpoint id used for future activities.',
    );
    await client.query('COMMIT');

    return mapEndpoint(result.rows[0]!);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAiEndpoint(pool: DatabasePool, id: string): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query<{ is_active: boolean }>(
      'DELETE FROM ai_endpoints WHERE id = $1::uuid RETURNING is_active',
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return false;
    }

    // Deleting the active server leaves the pointer dangling — clear it so no
    // stale endpoint id is used for future activities. Models cascade away.
    if (row.is_active) {
      await upsertSetting(
        client,
        'ai.active_endpoint_id',
        '',
        'Active AI endpoint id used for future activities.',
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listAiModels(
  pool: DatabasePool,
  input: { endpointId?: string | undefined },
): Promise<AiModelRecord[]> {
  const result = await pool.query<AiModelRow>(
    `
      SELECT
        ai_models.id,
        ai_models.endpoint_id,
        ai_endpoints.name AS endpoint_name,
        ai_models.name,
        ai_models.installed,
        ai_models.metadata,
        ai_models.discovered_at,
        ai_models.created_at,
        ai_models.updated_at
      FROM ai_models
      JOIN ai_endpoints ON ai_endpoints.id = ai_models.endpoint_id
      WHERE ($1::uuid IS NULL OR ai_models.endpoint_id = $1::uuid)
      ORDER BY ai_endpoints.name ASC, ai_models.installed DESC, ai_models.name ASC
    `,
    [input.endpointId ?? null],
  );

  return result.rows.map(mapModel);
}

export async function readAiModelByName(
  pool: DatabasePool,
  input: { endpointId: string; name: string },
): Promise<AiModelRecord | null> {
  const result = await pool.query<AiModelRow>(
    `
      SELECT
        ai_models.id,
        ai_models.endpoint_id,
        ai_endpoints.name AS endpoint_name,
        ai_models.name,
        ai_models.installed,
        ai_models.metadata,
        ai_models.discovered_at,
        ai_models.created_at,
        ai_models.updated_at
      FROM ai_models
      JOIN ai_endpoints ON ai_endpoints.id = ai_models.endpoint_id
      WHERE ai_models.endpoint_id = $1::uuid
        AND ai_models.name = $2
    `,
    [input.endpointId, input.name],
  );

  const row = result.rows[0];
  return row ? mapModel(row) : null;
}

export async function readAiModelById(
  pool: DatabasePool,
  id: string,
): Promise<AiModelRecord | null> {
  const result = await pool.query<AiModelRow>(
    `
      SELECT
        ai_models.id,
        ai_models.endpoint_id,
        ai_endpoints.name AS endpoint_name,
        ai_models.name,
        ai_models.installed,
        ai_models.metadata,
        ai_models.discovered_at,
        ai_models.created_at,
        ai_models.updated_at
      FROM ai_models
      JOIN ai_endpoints ON ai_endpoints.id = ai_models.endpoint_id
      WHERE ai_models.id = $1::uuid
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapModel(row) : null;
}

export async function deleteAiModel(pool: DatabasePool, id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM ai_models WHERE id = $1::uuid', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function syncAiModels(
  pool: DatabasePool,
  input: {
    endpointId: string;
    models: Array<{
      metadata?: unknown | undefined;
      name: string;
    }>;
  },
): Promise<AiModelRecord[]> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
        UPDATE ai_models
        SET installed = false,
            updated_at = now()
        WHERE endpoint_id = $1::uuid
      `,
      [input.endpointId],
    );

    for (const model of input.models) {
      await upsertAiModel(client, {
        endpointId: input.endpointId,
        installed: true,
        metadata: model.metadata,
        name: model.name,
      });
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return listAiModels(pool, { endpointId: input.endpointId });
}

export async function upsertAiModel(
  pool: Pick<DatabasePool, 'query'>,
  input: {
    endpointId: string;
    installed?: boolean | undefined;
    metadata?: unknown | undefined;
    name: string;
  },
): Promise<AiModelRecord> {
  const result = await pool.query<AiModelRow>(
    `
      INSERT INTO ai_models(endpoint_id, name, installed, metadata)
      VALUES ($1::uuid, $2, $3, $4::jsonb)
      ON CONFLICT (endpoint_id, name) DO UPDATE
      SET installed = ai_models.installed OR EXCLUDED.installed,
          metadata = ai_models.metadata || EXCLUDED.metadata,
          updated_at = now()
      RETURNING
        ai_models.id,
        ai_models.endpoint_id,
        (SELECT name FROM ai_endpoints WHERE ai_endpoints.id = ai_models.endpoint_id) AS endpoint_name,
        ai_models.name,
        ai_models.installed,
        ai_models.metadata,
        ai_models.discovered_at,
        ai_models.created_at,
        ai_models.updated_at
    `,
    [input.endpointId, input.name, input.installed ?? false, JSON.stringify(input.metadata ?? {})],
  );

  return mapModel(result.rows[0]!);
}

export async function resolveAiEndpointId(
  pool: DatabasePool,
  endpointId: string | undefined,
): Promise<string | null> {
  if (endpointId) {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM ai_endpoints WHERE id = $1::uuid AND enabled = true',
      [endpointId],
    );
    return result.rows[0]?.id ?? null;
  }

  const result = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM ai_endpoints
      WHERE is_active = true
        AND enabled = true
      LIMIT 1
    `,
  );

  return result.rows[0]?.id ?? null;
}
