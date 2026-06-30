import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { badRequest, serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import { createExportActivity } from '../repositories/activitiesRepository.js';
import {
  clearOperationalData,
  resetApplicationData,
} from '../repositories/maintenanceRepository.js';
import { activitySchema } from './activities.js';

interface ResetApplicationBody {
  confirmation?: string | undefined;
}

interface ClearOperationalBody {
  confirmation?: string | undefined;
}

const RESET_CONFIRMATION = 'RESET';
const CLEAR_CONFIRMATION = 'CLEAR';

const operationalClearSchema = {
  type: 'object',
  required: ['clearedAt', 'deleted'],
  properties: {
    clearedAt: { type: 'string', format: 'date-time' },
    deleted: {
      type: 'object',
      additionalProperties: { type: 'number' },
    },
  },
} as const;

const applicationResetSchema = {
  type: 'object',
  required: ['deleted', 'resetAt', 'seeded'],
  properties: {
    deleted: {
      type: 'object',
      additionalProperties: { type: 'number' },
    },
    resetAt: { type: 'string', format: 'date-time' },
    seeded: {
      type: 'object',
      required: ['providers', 'settings'],
      properties: {
        providers: { type: 'number' },
        settings: { type: 'number' },
      },
    },
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

export async function registerMaintenanceRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.post(
    '/api/v1/exports/jobs-reviews',
    {
      schema: {
        response: {
          202: successResponseSchema(activitySchema),
        },
      },
    },
    async (_request, reply) => {
      const pool = requireDatabase(db);
      const activity = await createExportActivity(pool, {
        kind: 'jobs_reviews_jsonl',
      });

      return reply.code(202).send(ok(activity));
    },
  );

  app.post(
    '/api/v1/debug/bundle',
    {
      schema: {
        response: {
          202: successResponseSchema(activitySchema),
        },
      },
    },
    async (_request, reply) => {
      const pool = requireDatabase(db);
      const activity = await createExportActivity(pool, {
        kind: 'debug_bundle',
      });

      return reply.code(202).send(ok(activity));
    },
  );

  app.post<{ Body: ResetApplicationBody }>(
    '/api/v1/debug/reset-app',
    {
      schema: {
        body: {
          type: 'object',
          required: ['confirmation'],
          additionalProperties: false,
          properties: {
            confirmation: { type: 'string' },
          },
        },
        response: {
          200: successResponseSchema(applicationResetSchema),
        },
      },
    },
    async (request) => {
      if (request.body.confirmation !== RESET_CONFIRMATION) {
        throw badRequest(`Type ${RESET_CONFIRMATION} to confirm application reset`);
      }

      const pool = requireDatabase(db);
      return ok(await resetApplicationData(pool));
    },
  );

  app.post<{ Body: ClearOperationalBody }>(
    '/api/v1/debug/clear-operational-data',
    {
      schema: {
        body: {
          type: 'object',
          required: ['confirmation'],
          additionalProperties: false,
          properties: {
            confirmation: { type: 'string' },
          },
        },
        response: {
          200: successResponseSchema(operationalClearSchema),
        },
      },
    },
    async (request) => {
      if (request.body.confirmation !== CLEAR_CONFIRMATION) {
        throw badRequest(`Type ${CLEAR_CONFIRMATION} to confirm clearing operational data`);
      }

      const pool = requireDatabase(db);
      return ok(await clearOperationalData(pool));
    },
  );
}
