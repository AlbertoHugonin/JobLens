import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { badRequest, conflict, notFound, serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import { activitySchema } from './activities.js';
import {
  LINKEDIN_PROVIDER_KEY,
  LinkedInProviderError,
  normalizeLinkedInSearchInput,
  parseLinkedInSearchUrl,
} from '../providers/linkedin.js';
import {
  createLinkedInCollectionActivities,
  createLinkedInCollectionActivity,
} from '../repositories/activitiesRepository.js';
import { hasActiveProviderSession } from '../repositories/providerSessionsRepository.js';
import {
  createSearch,
  deleteSearch,
  listSearches,
  readSearch,
  updateSearch,
} from '../repositories/searchesRepository.js';

const NO_ACTIVE_SESSION_MESSAGE =
  'Nessuna sessione LinkedIn attiva: collega una sessione prima di avviare la raccolta.';

async function requireActiveLinkedInSession(pool: DatabasePool): Promise<void> {
  if (!(await hasActiveProviderSession(pool, LINKEDIN_PROVIDER_KEY))) {
    throw conflict(NO_ACTIVE_SESSION_MESSAGE);
  }
}

interface SearchListQuery {
  limit?: number | undefined;
  offset?: number | undefined;
  providerKey?: string | undefined;
}

interface SearchParams {
  id: string;
}

interface CreateSearchBody {
  enabled?: boolean | undefined;
  name: string;
  providerKey: 'linkedin';
  query: unknown;
  scheduleConfig?: unknown | undefined;
}

interface UpdateSearchBody {
  enabled?: boolean | undefined;
  name?: string | undefined;
  query?: unknown | undefined;
  scheduleConfig?: unknown | undefined;
}

interface PreviewUrlBody {
  providerKey: 'linkedin';
  query: unknown;
}

interface ImportUrlBody {
  providerKey: 'linkedin';
  url: string;
}

interface RunSearchesBody {
  all?: boolean | undefined;
  providerKey?: 'linkedin' | undefined;
  searchIds?: string[] | undefined;
}

const paginationMetaSchema = {
  type: 'object',
  required: ['limit', 'offset', 'total'],
  properties: {
    limit: { type: 'number' },
    offset: { type: 'number' },
    total: { type: 'number' },
  },
} as const;

const linkedinSearchQuerySchema = {
  type: 'object',
  required: [
    'currentJobId',
    'distance',
    'exactMatch',
    'experienceLevels',
    'geoId',
    'keywords',
    'location',
    'preservedParams',
    'providerKey',
    'publicUrl',
    'unsupportedParams',
    'workplaceTypes',
  ],
  properties: {
    currentJobId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    distance: { type: 'string', enum: ['0', '5', '10', '25', '50'] },
    exactMatch: { type: 'boolean' },
    experienceLevels: {
      type: 'array',
      items: { type: 'string', enum: ['1', '2', '3', '4', '5', '6'] },
    },
    geoId: { type: 'string' },
    keywords: { type: 'string' },
    location: { type: 'string' },
    preservedParams: { type: 'object', additionalProperties: { type: 'string' } },
    providerKey: { type: 'string', enum: ['linkedin'] },
    publicUrl: { type: 'string', format: 'uri' },
    unsupportedParams: { type: 'object', additionalProperties: { type: 'string' } },
    workplaceTypes: {
      type: 'array',
      items: { type: 'string', enum: ['1', '2', '3'] },
    },
  },
} as const;

const searchSchema = {
  type: 'object',
  required: [
    'createdAt',
    'enabled',
    'id',
    'lastRunAt',
    'name',
    'providerKey',
    'providerName',
    'query',
    'scheduleConfig',
    'updatedAt',
  ],
  properties: {
    createdAt: { type: 'string', format: 'date-time' },
    enabled: { type: 'boolean' },
    id: { type: 'string', format: 'uuid' },
    lastRunAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    name: { type: 'string' },
    providerKey: { type: 'string' },
    providerName: { type: 'string' },
    query: linkedinSearchQuerySchema,
    scheduleConfig: {},
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const previewUrlSchema = {
  type: 'object',
  required: ['providerKey', 'query', 'url'],
  properties: {
    providerKey: { type: 'string', enum: ['linkedin'] },
    query: linkedinSearchQuerySchema,
    url: { type: 'string', format: 'uri' },
  },
} as const;

const skippedSearchRunSchema = {
  type: 'object',
  required: ['reason', 'searchId'],
  properties: {
    reason: { type: 'string', enum: ['not_found_or_disabled'] },
    searchId: { type: 'string', format: 'uuid' },
  },
} as const;

const runSearchesSchema = {
  type: 'object',
  required: ['queued', 'skipped', 'total'],
  properties: {
    queued: { type: 'array', items: activitySchema },
    skipped: { type: 'array', items: skippedSearchRunSchema },
    total: { type: 'number' },
  },
} as const;

const searchParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

function normalizeName(name: string | undefined): string {
  const value = name?.trim();
  if (!value) {
    throw badRequest('Search name is required');
  }

  return value;
}

function normalizeLinkedInQuery(input: unknown): ReturnType<typeof normalizeLinkedInSearchInput> {
  try {
    return normalizeLinkedInSearchInput(input);
  } catch (error) {
    if (error instanceof LinkedInProviderError) {
      throw badRequest(error.message);
    }

    throw error;
  }
}

function importLinkedInUrl(input: string): ReturnType<typeof parseLinkedInSearchUrl> {
  try {
    return parseLinkedInSearchUrl(input);
  } catch (error) {
    if (error instanceof LinkedInProviderError) {
      throw badRequest(error.message);
    }

    throw error;
  }
}

function normalizeRunSearchesBody(input: RunSearchesBody | undefined): {
  all: boolean;
  searchIds: string[];
} {
  const all = input?.all === true;
  const searchIds = Array.from(new Set(input?.searchIds ?? []));

  if (!all && searchIds.length === 0) {
    throw badRequest('Search run requires all=true or at least one search id');
  }

  return { all, searchIds };
}

export async function registerSearchesRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.get<{ Querystring: SearchListQuery }>(
    '/api/v1/searches',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            providerKey: { type: 'string', enum: ['linkedin'] },
          },
        },
        response: {
          200: successResponseSchema({ type: 'array', items: searchSchema }, paginationMetaSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const limit = request.query.limit ?? 25;
      const offset = request.query.offset ?? 0;
      const result = await listSearches(pool, {
        limit,
        offset,
        providerKey: request.query.providerKey,
      });

      return ok(result.items, {
        limit,
        offset,
        total: result.total,
      });
    },
  );

  app.post<{ Body: PreviewUrlBody }>(
    '/api/v1/searches/preview-url',
    {
      schema: {
        body: {
          type: 'object',
          required: ['providerKey', 'query'],
          additionalProperties: false,
          properties: {
            providerKey: { type: 'string', enum: ['linkedin'] },
            query: {},
          },
        },
        response: {
          200: successResponseSchema(previewUrlSchema),
        },
      },
    },
    async (request) => {
      if (request.body.providerKey !== LINKEDIN_PROVIDER_KEY) {
        throw badRequest('Only LinkedIn search preview is supported');
      }

      const query = normalizeLinkedInQuery(request.body.query);
      return ok({
        providerKey: LINKEDIN_PROVIDER_KEY,
        query,
        url: query.publicUrl,
      });
    },
  );

  app.post<{ Body: ImportUrlBody }>(
    '/api/v1/searches/import-url',
    {
      schema: {
        body: {
          type: 'object',
          required: ['providerKey', 'url'],
          additionalProperties: false,
          properties: {
            providerKey: { type: 'string', enum: ['linkedin'] },
            url: { type: 'string', minLength: 1, maxLength: 3000 },
          },
        },
        response: {
          200: successResponseSchema(previewUrlSchema),
        },
      },
    },
    async (request) => {
      if (request.body.providerKey !== LINKEDIN_PROVIDER_KEY) {
        throw badRequest('Only LinkedIn URL import is supported');
      }

      const query = importLinkedInUrl(request.body.url);
      return ok({
        providerKey: LINKEDIN_PROVIDER_KEY,
        query,
        url: query.publicUrl,
      });
    },
  );

  app.post<{ Body: CreateSearchBody }>(
    '/api/v1/searches',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'providerKey', 'query'],
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            providerKey: { type: 'string', enum: ['linkedin'] },
            query: {},
            scheduleConfig: {},
          },
        },
        response: {
          201: successResponseSchema(searchSchema),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const search = await createSearch(pool, {
        enabled: request.body.enabled ?? true,
        name: normalizeName(request.body.name),
        providerKey: request.body.providerKey,
        query: normalizeLinkedInQuery(request.body.query),
        scheduleConfig: request.body.scheduleConfig ?? {},
      });

      return reply.code(201).send(ok(search));
    },
  );

  app.post<{ Body: RunSearchesBody }>(
    '/api/v1/searches/run',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            all: { type: 'boolean' },
            providerKey: { type: 'string', enum: ['linkedin'] },
            searchIds: {
              type: 'array',
              uniqueItems: true,
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
        response: {
          202: successResponseSchema(runSearchesSchema),
        },
      },
    },
    async (request, reply) => {
      if (request.body?.providerKey && request.body.providerKey !== LINKEDIN_PROVIDER_KEY) {
        throw badRequest('Only LinkedIn search runs are supported');
      }

      const { all, searchIds } = normalizeRunSearchesBody(request.body);
      const pool = requireDatabase(db);
      await requireActiveLinkedInSession(pool);
      const result = await createLinkedInCollectionActivities(pool, {
        searchIds: all ? undefined : searchIds,
      });

      return reply.code(202).send(ok(result));
    },
  );

  app.post<{ Params: SearchParams }>(
    '/api/v1/searches/:id/run',
    {
      schema: {
        params: searchParamsSchema,
        response: {
          202: successResponseSchema(activitySchema),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      await requireActiveLinkedInSession(pool);
      const activity = await createLinkedInCollectionActivity(pool, request.params.id);

      if (!activity) {
        throw notFound(`Enabled LinkedIn search ${request.params.id} was not found`);
      }

      return reply.code(202).send(ok(activity));
    },
  );

  app.get<{ Params: SearchParams }>(
    '/api/v1/searches/:id',
    {
      schema: {
        params: searchParamsSchema,
        response: {
          200: successResponseSchema(searchSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const search = await readSearch(pool, request.params.id);

      if (!search) {
        throw notFound(`Search ${request.params.id} was not found`);
      }

      return ok(search);
    },
  );

  app.patch<{ Body: UpdateSearchBody; Params: SearchParams }>(
    '/api/v1/searches/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            query: {},
            scheduleConfig: {},
          },
        },
        params: searchParamsSchema,
        response: {
          200: successResponseSchema(searchSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const search = await updateSearch(pool, {
        enabled: request.body.enabled,
        id: request.params.id,
        name: request.body.name ? normalizeName(request.body.name) : undefined,
        query:
          request.body.query === undefined ? undefined : normalizeLinkedInQuery(request.body.query),
        scheduleConfig: request.body.scheduleConfig,
      });

      if (!search) {
        throw notFound(`Search ${request.params.id} was not found`);
      }

      return ok(search);
    },
  );

  app.delete<{ Params: SearchParams }>(
    '/api/v1/searches/:id',
    {
      schema: {
        params: searchParamsSchema,
        response: {
          200: successResponseSchema({
            type: 'object',
            required: ['deleted', 'id'],
            properties: {
              deleted: { type: 'boolean' },
              id: { type: 'string', format: 'uuid' },
            },
          }),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const deleted = await deleteSearch(pool, request.params.id);

      if (!deleted) {
        throw notFound(`Search ${request.params.id} was not found`);
      }

      return ok({ deleted: true, id: request.params.id });
    },
  );
}
