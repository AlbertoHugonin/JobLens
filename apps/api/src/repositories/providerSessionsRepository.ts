import type { DatabasePool } from '../db/pool.js';
import { summarizeProviderSession } from '../providers/registry.js';

export interface ProviderSessionRecord {
  createdAt: string;
  id: string;
  label: string;
  lastVerifiedAt: string | null;
  providerKey: string;
  providerName: string;
  status: 'active' | 'disabled' | 'expired' | 'invalid';
  summary: unknown;
  updatedAt: string;
}

interface ProviderSessionRow {
  created_at: Date;
  id: string;
  label: string;
  last_verified_at: Date | null;
  provider_key: string;
  provider_name: string;
  session_data: unknown;
  status: 'active' | 'disabled' | 'expired' | 'invalid';
  updated_at: Date;
}

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapProviderSession(row: ProviderSessionRow): ProviderSessionRecord {
  return {
    createdAt: row.created_at.toISOString(),
    id: row.id,
    label: row.label,
    lastVerifiedAt: formatDate(row.last_verified_at),
    providerKey: row.provider_key,
    providerName: row.provider_name,
    status: row.status,
    summary: summarizeProviderSession(row.provider_key, row.session_data),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listProviderSessions(
  pool: DatabasePool,
  input: { providerKey?: string | undefined } = {},
): Promise<ProviderSessionRecord[]> {
  const providerKey = input.providerKey?.trim() || null;
  const result = await pool.query<ProviderSessionRow>(
    `
      SELECT
        provider_sessions.id,
        provider_sessions.label,
        provider_sessions.status,
        provider_sessions.session_data,
        provider_sessions.last_verified_at,
        provider_sessions.created_at,
        provider_sessions.updated_at,
        providers.provider_key,
        providers.name AS provider_name
      FROM provider_sessions
      JOIN providers ON providers.id = provider_sessions.provider_id
      WHERE ($1::text IS NULL OR providers.provider_key = $1)
      ORDER BY provider_sessions.created_at DESC, provider_sessions.id DESC
    `,
    [providerKey],
  );

  return result.rows.map(mapProviderSession);
}

export async function createProviderSession(
  pool: DatabasePool,
  input: {
    label: string;
    providerKey: string;
    sessionData: unknown;
  },
): Promise<ProviderSessionRecord> {
  const result = await pool.query<ProviderSessionRow>(
    `
      WITH selected_provider AS (
        SELECT id
        FROM providers
        WHERE provider_key = $1 AND enabled = true
      )
      INSERT INTO provider_sessions(provider_id, label, status, session_data, last_verified_at)
      SELECT id, $2, 'active', $3::jsonb, now()
      FROM selected_provider
      RETURNING
        provider_sessions.id,
        provider_sessions.label,
        provider_sessions.status,
        provider_sessions.session_data,
        provider_sessions.last_verified_at,
        provider_sessions.created_at,
        provider_sessions.updated_at,
        $1::text AS provider_key,
        (SELECT name FROM providers WHERE provider_key = $1) AS provider_name
    `,
    [input.providerKey, input.label, JSON.stringify(input.sessionData)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Provider ${input.providerKey} was not found`);
  }

  return mapProviderSession(row);
}

export interface ProviderSessionDataRecord {
  providerKey: string;
  sessionData: unknown;
}

export async function getProviderSessionData(
  pool: DatabasePool,
  input: { providerKey: string; sessionId: string },
): Promise<ProviderSessionDataRecord | null> {
  const result = await pool.query<{ provider_key: string; session_data: unknown }>(
    `
      SELECT provider_sessions.session_data, providers.provider_key
      FROM provider_sessions
      JOIN providers ON providers.id = provider_sessions.provider_id
      WHERE provider_sessions.id = $1 AND providers.provider_key = $2
    `,
    [input.sessionId, input.providerKey],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return { providerKey: row.provider_key, sessionData: row.session_data };
}

export async function markProviderSessionVerified(
  pool: DatabasePool,
  input: { alive: boolean; providerKey: string; sessionId: string },
): Promise<ProviderSessionRecord | null> {
  const status = input.alive ? 'active' : 'expired';
  const result = await pool.query<ProviderSessionRow>(
    `
      UPDATE provider_sessions
      SET
        status = $3,
        last_verified_at = now()
      FROM providers
      WHERE provider_sessions.id = $1
        AND providers.id = provider_sessions.provider_id
        AND providers.provider_key = $2
      RETURNING
        provider_sessions.id,
        provider_sessions.label,
        provider_sessions.status,
        provider_sessions.session_data,
        provider_sessions.last_verified_at,
        provider_sessions.created_at,
        provider_sessions.updated_at,
        providers.provider_key,
        providers.name AS provider_name
    `,
    [input.sessionId, input.providerKey, status],
  );

  const row = result.rows[0];
  return row ? mapProviderSession(row) : null;
}
