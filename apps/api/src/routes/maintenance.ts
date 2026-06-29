import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import { createExportActivity } from '../repositories/activitiesRepository.js';
import { activitySchema } from './activities.js';

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
}
