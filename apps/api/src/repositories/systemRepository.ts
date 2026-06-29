import type { DatabasePool } from '../db/pool.js';

export interface SchemaMigrationRecord {
  appliedAt: string;
  checksum: string;
  id: number;
  name: string;
}

export interface ProviderRecord {
  enabled: boolean;
  id: string;
  key: string;
  name: string;
}

export interface SettingRecord {
  description: string | null;
  key: string;
  updatedAt: string;
  value: unknown;
}

export async function readSchemaMigrations(pool: DatabasePool): Promise<SchemaMigrationRecord[]> {
  const result = await pool.query<{
    applied_at: Date;
    checksum: string;
    id: number;
    name: string;
  }>(`
    SELECT id, name, checksum, applied_at
    FROM schema_migrations
    ORDER BY id ASC
  `);

  return result.rows.map((row) => ({
    appliedAt: row.applied_at.toISOString(),
    checksum: row.checksum,
    id: row.id,
    name: row.name,
  }));
}

export async function readSchemaVersion(pool: DatabasePool): Promise<number> {
  const result = await pool.query<{ version: number }>(`
    SELECT COALESCE(MAX(id), 0)::integer AS version
    FROM schema_migrations
  `);

  return result.rows[0]?.version ?? 0;
}

export async function readProviders(pool: DatabasePool): Promise<ProviderRecord[]> {
  const result = await pool.query<{
    enabled: boolean;
    id: string;
    name: string;
    provider_key: string;
  }>(`
    SELECT id, provider_key, name, enabled
    FROM providers
    ORDER BY provider_key ASC
  `);

  return result.rows.map((row) => ({
    enabled: row.enabled,
    id: row.id,
    key: row.provider_key,
    name: row.name,
  }));
}

export async function readBaseSettings(pool: DatabasePool): Promise<SettingRecord[]> {
  const result = await pool.query<{
    description: string | null;
    key: string;
    updated_at: Date;
    value: unknown;
  }>(`
    SELECT key, value, description, updated_at
    FROM settings
    WHERE key IN (
      'app.name',
      'app.schema_target',
      'ai.enabled',
      'ai.active_endpoint_id',
      'evaluation.rules.template_version'
    )
    ORDER BY key ASC
  `);

  return result.rows.map((row) => ({
    description: row.description,
    key: row.key,
    updatedAt: row.updated_at.toISOString(),
    value: row.value,
  }));
}
