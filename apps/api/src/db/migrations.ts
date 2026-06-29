import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool, PoolClient } from 'pg';

export interface Migration {
  checksum: string;
  id: number;
  name: string;
  sql: string;
}

export interface AppliedMigration {
  appliedAt: string;
  checksum: string;
  id: number;
  name: string;
}

export interface MigrationResult {
  applied: AppliedMigration[];
  latestVersion: number;
}

const MIGRATION_FILE_PATTERN = /^(\d{3,})_(.+)\.sql$/;
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function parseMigrationFile(fileName: string, sql: string): Migration | null {
  const match = MIGRATION_FILE_PATTERN.exec(fileName);
  if (!match) {
    return null;
  }

  const id = Number.parseInt(match[1] ?? '', 10);
  const rawName = match[2] ?? '';

  if (!Number.isInteger(id) || !rawName) {
    return null;
  }

  return {
    checksum: checksum(sql),
    id,
    name: rawName.replaceAll('_', ' '),
    sql,
  };
}

export async function loadMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR): Promise<Migration[]> {
  const fileNames = await readdir(migrationsDir);
  const migrations = await Promise.all(
    fileNames.sort().map(async (fileName) => {
      const sql = await readFile(path.join(migrationsDir, fileName), 'utf8');
      return parseMigrationFile(fileName, sql);
    }),
  );

  return migrations.filter((migration): migration is Migration => migration !== null);
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function readAppliedMigrations(client: PoolClient): Promise<Map<number, AppliedMigration>> {
  const result = await client.query<{
    applied_at: Date;
    checksum: string;
    id: number;
    name: string;
  }>(`
    SELECT id, name, checksum, applied_at
    FROM schema_migrations
    ORDER BY id ASC
  `);

  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        appliedAt: row.applied_at.toISOString(),
        checksum: row.checksum,
        id: row.id,
        name: row.name,
      },
    ]),
  );
}

async function applyMigration(client: PoolClient, migration: Migration): Promise<AppliedMigration> {
  await client.query('BEGIN');

  try {
    await client.query(migration.sql);
    const result = await client.query<{ applied_at: Date }>(
      `
        INSERT INTO schema_migrations(id, name, checksum)
        VALUES ($1, $2, $3)
        RETURNING applied_at
      `,
      [migration.id, migration.name, migration.checksum],
    );
    await client.query('COMMIT');

    const appliedAt = result.rows[0]?.applied_at;
    if (!appliedAt) {
      throw new Error(`Migration ${migration.id} did not return applied_at`);
    }

    return {
      appliedAt: appliedAt.toISOString(),
      checksum: migration.checksum,
      id: migration.id,
      name: migration.name,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runMigrations(pool: Pool): Promise<MigrationResult> {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('joblens_schema_migrations'))");
    await ensureMigrationTable(client);

    const migrations = await loadMigrations();
    const appliedBefore = await readAppliedMigrations(client);
    const applied: AppliedMigration[] = [];

    for (const migration of migrations) {
      const existing = appliedBefore.get(migration.id);

      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(`Migration checksum mismatch for ${migration.id}: ${migration.name}`);
        }
        continue;
      }

      applied.push(await applyMigration(client, migration));
    }

    const appliedAfter = await readAppliedMigrations(client);
    const latestVersion = Math.max(0, ...Array.from(appliedAfter.keys()));

    return {
      applied,
      latestVersion,
    };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('joblens_schema_migrations'))");
    client.release();
  }
}
