import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import {
  readBaseSettings,
  readProviders,
  readSchemaMigrations,
  readSchemaVersion,
} from '../repositories/systemRepository.js';

const migrationSchema = {
  type: 'object',
  required: ['id', 'name', 'checksum', 'appliedAt'],
  properties: {
    appliedAt: { type: 'string', format: 'date-time' },
    checksum: { type: 'string' },
    id: { type: 'number' },
    name: { type: 'string' },
  },
} as const;

const providerSchema = {
  type: 'object',
  required: ['id', 'key', 'name', 'enabled'],
  properties: {
    enabled: { type: 'boolean' },
    id: { type: 'string', format: 'uuid' },
    key: { type: 'string' },
    name: { type: 'string' },
  },
} as const;

const settingSchema = {
  type: 'object',
  required: ['key', 'value', 'description', 'updatedAt'],
  properties: {
    description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    key: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
    value: {},
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

export async function registerSystemRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.get(
    '/api/v1/schema',
    {
      schema: {
        response: {
          200: successResponseSchema({
            type: 'object',
            required: ['schemaVersion', 'migrations'],
            properties: {
              migrations: { type: 'array', items: migrationSchema },
              schemaVersion: { type: 'number' },
            },
          }),
        },
      },
    },
    async () => {
      const pool = requireDatabase(db);
      const migrations = await readSchemaMigrations(pool);

      return ok({
        migrations,
        schemaVersion: Math.max(0, ...migrations.map((migration) => migration.id)),
      });
    },
  );

  app.get(
    '/api/v1/settings/base',
    {
      schema: {
        response: {
          200: successResponseSchema({
            type: 'object',
            required: ['schemaVersion', 'providers', 'settings'],
            properties: {
              providers: { type: 'array', items: providerSchema },
              schemaVersion: { type: 'number' },
              settings: { type: 'array', items: settingSchema },
            },
          }),
        },
      },
    },
    async () => {
      const pool = requireDatabase(db);
      const [schemaVersion, providers, settings] = await Promise.all([
        readSchemaVersion(pool),
        readProviders(pool),
        readBaseSettings(pool),
      ]);

      return ok({
        providers,
        schemaVersion,
        settings,
      });
    },
  );
}
