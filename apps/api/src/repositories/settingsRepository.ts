import type { DatabasePool } from '../db/pool.js';

export interface SettingRecord {
  description: string | null;
  key: string;
  updatedAt: string;
  value: unknown;
}

export interface PaginatedSettings {
  items: SettingRecord[];
  total: number;
}

function mapSetting(row: {
  description: string | null;
  key: string;
  updated_at: Date;
  value: unknown;
}): SettingRecord {
  return {
    description: row.description,
    key: row.key,
    updatedAt: row.updated_at.toISOString(),
    value: row.value,
  };
}

export async function listSettings(
  pool: DatabasePool,
  input: { limit: number; offset: number; prefix?: string | undefined },
): Promise<PaginatedSettings> {
  const prefix = input.prefix?.trim() || null;
  const [itemsResult, countResult] = await Promise.all([
    pool.query<{
      description: string | null;
      key: string;
      updated_at: Date;
      value: unknown;
    }>(
      `
        SELECT key, value, description, updated_at
        FROM settings
        WHERE ($1::text IS NULL OR key LIKE $1 || '%')
        ORDER BY key ASC
        LIMIT $2 OFFSET $3
      `,
      [prefix, input.limit, input.offset],
    ),
    pool.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM settings
        WHERE ($1::text IS NULL OR key LIKE $1 || '%')
      `,
      [prefix],
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapSetting),
    total: Number.parseInt(countResult.rows[0]?.total ?? '0', 10),
  };
}

export async function readSetting(pool: DatabasePool, key: string): Promise<SettingRecord | null> {
  const result = await pool.query<{
    description: string | null;
    key: string;
    updated_at: Date;
    value: unknown;
  }>(
    `
      SELECT key, value, description, updated_at
      FROM settings
      WHERE key = $1
    `,
    [key],
  );

  const row = result.rows[0];
  return row ? mapSetting(row) : null;
}
