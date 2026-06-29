import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { notFound, serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import { listSettings, readSetting } from '../repositories/settingsRepository.js';

interface SettingsListQuery {
  limit?: number | undefined;
  offset?: number | undefined;
  prefix?: string | undefined;
}

interface SettingParams {
  key: string;
}

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

const paginationMetaSchema = {
  type: 'object',
  required: ['limit', 'offset', 'total'],
  properties: {
    limit: { type: 'number' },
    offset: { type: 'number' },
    total: { type: 'number' },
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

export async function registerSettingsRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.get<{ Querystring: SettingsListQuery }>(
    '/api/v1/settings',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            prefix: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        response: {
          200: successResponseSchema({ type: 'array', items: settingSchema }, paginationMetaSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const limit = request.query.limit ?? 50;
      const offset = request.query.offset ?? 0;
      const result = await listSettings(pool, {
        limit,
        offset,
        prefix: request.query.prefix,
      });

      return ok(result.items, {
        limit,
        offset,
        total: result.total,
      });
    },
  );

  app.get<{ Params: SettingParams }>(
    '/api/v1/settings/:key',
    {
      schema: {
        params: {
          type: 'object',
          required: ['key'],
          additionalProperties: false,
          properties: {
            key: { type: 'string', pattern: '^[A-Za-z0-9_.:-]+$', minLength: 1, maxLength: 200 },
          },
        },
        response: {
          200: successResponseSchema(settingSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const setting = await readSetting(pool, request.params.key);

      if (!setting) {
        throw notFound(`Setting ${request.params.key} was not found`);
      }

      return ok(setting);
    },
  );
}
