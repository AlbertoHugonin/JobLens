import type { DatabasePool } from '../db/pool.js';

export interface SearchRecord {
  createdAt: string;
  enabled: boolean;
  id: string;
  lastRunAt: string | null;
  name: string;
  providerKey: string;
  providerName: string;
  query: unknown;
  scheduleConfig: unknown;
  updatedAt: string;
}

export interface PaginatedSearches {
  items: SearchRecord[];
  total: number;
}

interface SearchRow {
  created_at: Date;
  enabled: boolean;
  id: string;
  last_run_at: Date | null;
  name: string;
  provider_key: string;
  provider_name: string;
  query: unknown;
  schedule_config: unknown;
  updated_at: Date;
}

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapSearch(row: SearchRow): SearchRecord {
  return {
    createdAt: row.created_at.toISOString(),
    enabled: row.enabled,
    id: row.id,
    lastRunAt: formatDate(row.last_run_at),
    name: row.name,
    providerKey: row.provider_key,
    providerName: row.provider_name,
    query: row.query,
    scheduleConfig: row.schedule_config,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listSearches(
  pool: DatabasePool,
  input: {
    limit: number;
    offset: number;
    providerKey?: string | undefined;
  },
): Promise<PaginatedSearches> {
  const providerKey = input.providerKey?.trim() || null;
  const [itemsResult, countResult] = await Promise.all([
    pool.query<SearchRow>(
      `
        SELECT
          searches.id,
          searches.name,
          searches.query,
          searches.enabled,
          searches.schedule_config,
          searches.last_run_at,
          searches.created_at,
          searches.updated_at,
          providers.provider_key,
          providers.name AS provider_name
        FROM searches
        JOIN providers ON providers.id = searches.provider_id
        WHERE ($1::text IS NULL OR providers.provider_key = $1)
        ORDER BY searches.created_at DESC, searches.id DESC
        LIMIT $2 OFFSET $3
      `,
      [providerKey, input.limit, input.offset],
    ),
    pool.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM searches
        JOIN providers ON providers.id = searches.provider_id
        WHERE ($1::text IS NULL OR providers.provider_key = $1)
      `,
      [providerKey],
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapSearch),
    total: Number.parseInt(countResult.rows[0]?.total ?? '0', 10),
  };
}

export async function readSearch(pool: DatabasePool, id: string): Promise<SearchRecord | null> {
  const result = await pool.query<SearchRow>(
    `
      SELECT
        searches.id,
        searches.name,
        searches.query,
        searches.enabled,
        searches.schedule_config,
        searches.last_run_at,
        searches.created_at,
        searches.updated_at,
        providers.provider_key,
        providers.name AS provider_name
      FROM searches
      JOIN providers ON providers.id = searches.provider_id
      WHERE searches.id = $1
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapSearch(row) : null;
}

export async function createSearch(
  pool: DatabasePool,
  input: {
    enabled: boolean;
    name: string;
    providerKey: string;
    query: unknown;
    scheduleConfig?: unknown | undefined;
  },
): Promise<SearchRecord> {
  const result = await pool.query<SearchRow>(
    `
      WITH selected_provider AS (
        SELECT id
        FROM providers
        WHERE provider_key = $1 AND enabled = true
      )
      INSERT INTO searches(provider_id, name, query, enabled, schedule_config)
      SELECT id, $2, $3::jsonb, $4, $5::jsonb
      FROM selected_provider
      RETURNING
        searches.id,
        searches.name,
        searches.query,
        searches.enabled,
        searches.schedule_config,
        searches.last_run_at,
        searches.created_at,
        searches.updated_at,
        $1::text AS provider_key,
        (SELECT name FROM providers WHERE provider_key = $1) AS provider_name
    `,
    [
      input.providerKey,
      input.name,
      JSON.stringify(input.query),
      input.enabled,
      JSON.stringify(input.scheduleConfig ?? {}),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Provider ${input.providerKey} was not found`);
  }

  return mapSearch(row);
}

export async function updateSearch(
  pool: DatabasePool,
  input: {
    enabled?: boolean | undefined;
    id: string;
    name?: string | undefined;
    query?: unknown | undefined;
    scheduleConfig?: unknown | undefined;
  },
): Promise<SearchRecord | null> {
  const result = await pool.query<SearchRow>(
    `
      UPDATE searches
      SET
        name = COALESCE($2, name),
        query = COALESCE($3::jsonb, query),
        enabled = COALESCE($4, enabled),
        schedule_config = COALESCE($5::jsonb, schedule_config)
      WHERE id = $1
      RETURNING
        searches.id,
        searches.name,
        searches.query,
        searches.enabled,
        searches.schedule_config,
        searches.last_run_at,
        searches.created_at,
        searches.updated_at,
        (SELECT provider_key FROM providers WHERE providers.id = searches.provider_id) AS provider_key,
        (SELECT name FROM providers WHERE providers.id = searches.provider_id) AS provider_name
    `,
    [
      input.id,
      input.name ?? null,
      input.query === undefined ? null : JSON.stringify(input.query),
      input.enabled ?? null,
      input.scheduleConfig === undefined ? null : JSON.stringify(input.scheduleConfig),
    ],
  );

  const row = result.rows[0];
  return row ? mapSearch(row) : null;
}

export async function deleteSearch(pool: DatabasePool, id: string): Promise<boolean> {
  const result = await pool.query(
    `
      DELETE FROM searches
      WHERE id = $1
    `,
    [id],
  );

  return result.rowCount === 1;
}
