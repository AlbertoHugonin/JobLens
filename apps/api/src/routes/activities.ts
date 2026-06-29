import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { conflict, notFound, serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import {
  createDummyActivity,
  listActivities,
  listActivityLogs,
  readActivity,
  readActivitiesSummary,
  readLinkedInActivityDebug,
  requestActivityCancellation,
  requestActivityQueueCancellation,
  retryActivity,
  type ActivityStatus,
} from '../repositories/activitiesRepository.js';

interface ActivityListQuery {
  limit?: number | undefined;
  offset?: number | undefined;
  status?: ActivityStatus | undefined;
  subjectId?: string | undefined;
  subjectType?: string | undefined;
  type?: string | undefined;
}

interface ActivityParams {
  id: string;
}

interface ActivityLogsQuery {
  limit?: number | undefined;
  offset?: number | undefined;
}

interface LinkedInDebugQuery {
  limit?: number | undefined;
}

interface CreateActivityBody {
  payload?: unknown | undefined;
  type: 'dummy';
}

interface ActivitySummaryQuery {
  activeLimit?: number | undefined;
}

interface CancelActivityQueueBody {
  source?: string | undefined;
  type?: string | undefined;
}

export const activityStatusValues = [
  'queued',
  'running',
  'success',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export const paginationMetaSchema = {
  type: 'object',
  required: ['limit', 'offset', 'total'],
  properties: {
    limit: { type: 'number' },
    offset: { type: 'number' },
    total: { type: 'number' },
  },
} as const;

export const activitySchema = {
  type: 'object',
  required: [
    'activityType',
    'attempt',
    'cancelRequestedAt',
    'createdAt',
    'error',
    'finishedAt',
    'heartbeatAt',
    'id',
    'leaseExpiresAt',
    'leaseOwner',
    'maxAttempts',
    'message',
    'payload',
    'phase',
    'progressCurrent',
    'progressTotal',
    'queuedAt',
    'source',
    'startedAt',
    'status',
    'subjectId',
    'subjectType',
    'updatedAt',
  ],
  properties: {
    activityType: { type: 'string' },
    attempt: { type: 'number' },
    cancelRequestedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    createdAt: { type: 'string', format: 'date-time' },
    error: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    finishedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    heartbeatAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    id: { type: 'string', format: 'uuid' },
    leaseExpiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    leaseOwner: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    maxAttempts: { type: 'number' },
    message: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    payload: {},
    phase: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    progressCurrent: { type: 'number' },
    progressTotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    queuedAt: { type: 'string', format: 'date-time' },
    source: { type: 'string' },
    startedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    status: { type: 'string', enum: activityStatusValues },
    subjectId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    subjectType: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const activityLogSchema = {
  type: 'object',
  required: ['activityId', 'createdAt', 'data', 'id', 'level', 'message'],
  properties: {
    activityId: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    data: {},
    id: { type: 'string' },
    level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
    message: { type: 'string' },
  },
} as const;

const activityCountSchema = {
  type: 'object',
  required: ['count', 'key'],
  properties: {
    count: { type: 'number' },
    key: { type: 'string' },
  },
} as const;

const activitySummarySchema = {
  type: 'object',
  required: ['active', 'byStatus', 'byType', 'total'],
  properties: {
    active: { type: 'array', items: activitySchema },
    byStatus: { type: 'array', items: activityCountSchema },
    byType: { type: 'array', items: activityCountSchema },
    total: { type: 'number' },
  },
} as const;

const queueCancellationSchema = {
  type: 'object',
  required: ['cancelled', 'items', 'requested', 'total'],
  properties: {
    cancelled: { type: 'number' },
    items: { type: 'array', items: activitySchema },
    requested: { type: 'number' },
    total: { type: 'number' },
  },
} as const;

const linkedinRawPayloadStatusCountSchema = {
  type: 'object',
  required: ['count', 'status'],
  properties: {
    count: { type: 'number' },
    status: { type: 'string' },
  },
} as const;

const linkedinRawPayloadDebugItemSchema = {
  type: 'object',
  required: [
    'contentType',
    'createdAt',
    'elapsedMs',
    'error',
    'id',
    'payloadKind',
    'requestParams',
    'requestUrl',
    'responseStatus',
    'snippet',
  ],
  properties: {
    contentType: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    createdAt: { type: 'string', format: 'date-time' },
    elapsedMs: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    error: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    id: { type: 'string', format: 'uuid' },
    payloadKind: { type: 'string', enum: ['empty', 'json', 'text'] },
    requestParams: {},
    requestUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    responseStatus: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    snippet: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const linkedinActivityDebugSchema = {
  type: 'object',
  required: [
    'activityId',
    'activityType',
    'failed',
    'items',
    'latestStatus',
    'providerKey',
    'statusCounts',
    'total',
  ],
  properties: {
    activityId: { type: 'string', format: 'uuid' },
    activityType: { type: 'string' },
    failed: { type: 'number' },
    items: { type: 'array', items: linkedinRawPayloadDebugItemSchema },
    latestStatus: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    providerKey: { type: 'string', enum: ['linkedin'] },
    statusCounts: { type: 'array', items: linkedinRawPayloadStatusCountSchema },
    total: { type: 'number' },
  },
} as const;

const activityParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const createActivityBodySchema = {
  type: 'object',
  required: ['type'],
  additionalProperties: false,
  properties: {
    payload: {},
    type: { type: 'string', enum: ['dummy'] },
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

export async function registerActivitiesRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.post<{ Body: CreateActivityBody }>(
    '/api/v1/activities',
    {
      schema: {
        body: createActivityBodySchema,
        response: {
          201: successResponseSchema(activitySchema),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const activity = await createDummyActivity(pool, {
        payload: request.body.payload,
      });

      return reply.code(201).send(ok(activity));
    },
  );

  app.get<{ Querystring: ActivityListQuery }>(
    '/api/v1/activities',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            status: { type: 'string', enum: activityStatusValues },
            subjectId: { type: 'string', format: 'uuid' },
            subjectType: { type: 'string', minLength: 1, maxLength: 100 },
            type: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        response: {
          200: successResponseSchema(
            { type: 'array', items: activitySchema },
            paginationMetaSchema,
          ),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const limit = request.query.limit ?? 25;
      const offset = request.query.offset ?? 0;
      const result = await listActivities(pool, {
        activityType: request.query.type,
        limit,
        offset,
        subjectId: request.query.subjectId,
        subjectType: request.query.subjectType,
        status: request.query.status,
      });

      return ok(result.items, {
        limit,
        offset,
        total: result.total,
      });
    },
  );

  app.get<{ Querystring: ActivitySummaryQuery }>(
    '/api/v1/activities/summary',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            activeLimit: { type: 'integer', minimum: 1, maximum: 25, default: 5 },
          },
        },
        response: {
          200: successResponseSchema(activitySummarySchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      return ok(
        await readActivitiesSummary(pool, {
          activeLimit: request.query.activeLimit ?? 5,
        }),
      );
    },
  );

  app.post<{ Body: CancelActivityQueueBody }>(
    '/api/v1/activities/cancel',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', minLength: 1, maxLength: 100 },
            type: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        response: {
          200: successResponseSchema(queueCancellationSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      return ok(
        await requestActivityQueueCancellation(pool, {
          activityType: request.body?.type,
          source: request.body?.source,
        }),
      );
    },
  );

  app.post<{ Params: ActivityParams }>(
    '/api/v1/activities/:id/cancel',
    {
      schema: {
        params: activityParamsSchema,
        response: {
          200: successResponseSchema(activitySchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const result = await requestActivityCancellation(pool, request.params.id);

      if (!result.activity) {
        throw notFound(`Activity ${request.params.id} was not found`);
      }

      if (result.reason === 'not_cancellable') {
        throw conflict(
          `Activity ${request.params.id} cannot be cancelled from ${result.activity.status}`,
        );
      }

      return ok(result.activity);
    },
  );

  app.post<{ Params: ActivityParams }>(
    '/api/v1/activities/:id/retry',
    {
      schema: {
        params: activityParamsSchema,
        response: {
          200: successResponseSchema(activitySchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const result = await retryActivity(pool, request.params.id);

      if (!result.activity) {
        throw notFound(`Activity ${request.params.id} was not found`);
      }

      if (result.reason === 'not_retryable') {
        throw conflict(
          `Activity ${request.params.id} cannot be retried from ${result.activity.status}`,
        );
      }

      return ok(result.activity);
    },
  );

  app.get<{ Params: ActivityParams; Querystring: ActivityLogsQuery }>(
    '/api/v1/activities/:id/logs',
    {
      schema: {
        params: activityParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
        response: {
          200: successResponseSchema(
            { type: 'array', items: activityLogSchema },
            paginationMetaSchema,
          ),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const activity = await readActivity(pool, request.params.id);

      if (!activity) {
        throw notFound(`Activity ${request.params.id} was not found`);
      }

      const limit = request.query.limit ?? 100;
      const offset = request.query.offset ?? 0;
      const result = await listActivityLogs(pool, {
        activityId: request.params.id,
        limit,
        offset,
      });

      return ok(result.items, {
        limit,
        offset,
        total: result.total,
      });
    },
  );

  app.get<{ Params: ActivityParams; Querystring: LinkedInDebugQuery }>(
    '/api/v1/activities/:id/linkedin-debug',
    {
      schema: {
        params: activityParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
        response: {
          200: successResponseSchema(linkedinActivityDebugSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const debug = await readLinkedInActivityDebug(pool, {
        activityId: request.params.id,
        limit: request.query.limit ?? 20,
      });

      if (!debug) {
        throw notFound(`LinkedIn debug data for activity ${request.params.id} was not found`);
      }

      return ok(debug);
    },
  );

  app.get<{ Params: ActivityParams }>(
    '/api/v1/activities/:id',
    {
      schema: {
        params: activityParamsSchema,
        response: {
          200: successResponseSchema(activitySchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const activity = await readActivity(pool, request.params.id);

      if (!activity) {
        throw notFound(`Activity ${request.params.id} was not found`);
      }

      return ok(activity);
    },
  );
}
