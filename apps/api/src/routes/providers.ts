import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { badRequest, notFound, serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import {
  LINKEDIN_PROVIDER_KEY,
  normalizeLinkedInGeoTypeaheadPayload,
} from '../providers/linkedin.js';
import { getProvider, listProviders } from '../providers/registry.js';
import { ProviderError, describeProvider, type ProviderPlugin } from '../providers/types.js';
import {
  createProviderSession,
  getProviderSessionData,
  listProviderSessions,
  markProviderSessionVerified,
} from '../repositories/providerSessionsRepository.js';

interface ProviderParams {
  providerKey: string;
}

interface SessionParams {
  providerKey: string;
  sessionId: string;
}

interface HarBody {
  har?: unknown | undefined;
  harText?: string | undefined;
  label?: string | undefined;
}

interface CredentialsBody {
  credentials: Record<string, string>;
  label?: string | undefined;
}

interface GeoTypeaheadQuery {
  query: string;
}

const credentialFieldSchema = {
  type: 'object',
  required: ['name', 'label', 'secret', 'required'],
  properties: {
    help: { type: 'string' },
    label: { type: 'string' },
    name: { type: 'string' },
    placeholder: { type: 'string' },
    required: { type: 'boolean' },
    secret: { type: 'boolean' },
  },
} as const;

const providerDescriptorSchema = {
  type: 'object',
  required: ['key', 'name', 'credentialFields', 'supportsHarImport', 'supportsVerify'],
  properties: {
    credentialFields: { type: 'array', items: credentialFieldSchema },
    key: { type: 'string' },
    name: { type: 'string' },
    supportsHarImport: { type: 'boolean' },
    supportsVerify: { type: 'boolean' },
  },
} as const;

const providerSessionSchema = {
  type: 'object',
  required: [
    'createdAt',
    'id',
    'label',
    'lastVerifiedAt',
    'providerKey',
    'providerName',
    'status',
    'summary',
    'updatedAt',
  ],
  properties: {
    createdAt: { type: 'string', format: 'date-time' },
    id: { type: 'string', format: 'uuid' },
    label: { type: 'string' },
    lastVerifiedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    providerKey: { type: 'string' },
    providerName: { type: 'string' },
    status: { type: 'string', enum: ['active', 'expired', 'invalid', 'disabled'] },
    summary: { type: 'object', additionalProperties: true },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const harRequestDebugSchema = {
  type: 'object',
  required: [
    'count',
    'decorationId',
    'hasCookie',
    'hasCsrfToken',
    'hasQuery',
    'host',
    'method',
    'path',
    'q',
    'queryParamNames',
    'recognizedFilters',
    'start',
  ],
  properties: {
    count: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    decorationId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    hasCookie: { type: 'boolean' },
    hasCsrfToken: { type: 'boolean' },
    hasQuery: { type: 'boolean' },
    host: { type: 'string' },
    method: { type: 'string' },
    path: { type: 'string' },
    q: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    queryParamNames: { type: 'array', items: { type: 'string' } },
    recognizedFilters: { type: 'array', items: { type: 'string' } },
    start: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const harDebugSchema = {
  type: 'object',
  required: ['jobCardRequestCount', 'requests', 'selectedRequest'],
  properties: {
    jobCardRequestCount: { type: 'number' },
    requests: { type: 'array', items: harRequestDebugSchema },
    selectedRequest: { anyOf: [harRequestDebugSchema, { type: 'null' }] },
  },
} as const;

const verificationSchema = {
  type: 'object',
  required: ['alive', 'status', 'message', 'session'],
  properties: {
    alive: { type: 'boolean' },
    message: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    session: { anyOf: [providerSessionSchema, { type: 'null' }] },
    status: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
} as const;

const geoHitSchema = {
  type: 'object',
  required: ['displayName', 'geoId', 'type'],
  properties: {
    displayName: { type: 'string' },
    geoId: { type: 'string' },
    type: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const harBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    har: {},
    harText: { type: 'string' },
    label: { type: 'string', minLength: 1, maxLength: 120 },
  },
} as const;

const credentialsBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['credentials'],
  properties: {
    credentials: { type: 'object', additionalProperties: { type: 'string' } },
    label: { type: 'string', minLength: 1, maxLength: 120 },
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

function requireKnownProvider(providerKey: string): ProviderPlugin {
  const plugin = getProvider(providerKey);
  if (!plugin) {
    throw notFound(`Unknown provider: ${providerKey}`);
  }

  return plugin;
}

function readHarBody(body: HarBody): unknown {
  if (body.harText?.trim()) {
    return body.harText;
  }

  if (body.har !== undefined) {
    return body.har;
  }

  throw badRequest('HAR content is required');
}

function normalizeLabel(label: string | undefined, providerName: string): string {
  return label?.trim() || `${providerName} ${new Date().toISOString()}`;
}

function translateProviderError(error: unknown): never {
  if (error instanceof ProviderError) {
    throw badRequest(error.message);
  }

  throw error;
}

async function fetchLinkedInGeoTypeahead(query: string): Promise<unknown> {
  const url = new URL('https://www.linkedin.com/jobs-guest/api/typeaheadHits');
  url.searchParams.set('origin', 'jserp');
  url.searchParams.set('typeaheadType', 'GEO');
  url.searchParams.set('geoTypes', 'POPULATED_PLACE,ADMIN_DIVISION_1,COUNTRY_REGION');
  url.searchParams.set('query', query);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw badRequest(`LinkedIn geo typeahead returned HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function registerProviderRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.get(
    '/api/v1/providers',
    {
      schema: {
        response: {
          200: successResponseSchema({ type: 'array', items: providerDescriptorSchema }),
        },
      },
    },
    async () => ok(listProviders().map(describeProvider)),
  );

  app.get<{ Params: ProviderParams }>(
    '/api/v1/providers/:providerKey/sessions',
    {
      schema: {
        response: {
          200: successResponseSchema({ type: 'array', items: providerSessionSchema }),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const plugin = requireKnownProvider(request.params.providerKey);
      return ok(await listProviderSessions(pool, { providerKey: plugin.key }));
    },
  );

  app.post<{ Body: CredentialsBody; Params: ProviderParams }>(
    '/api/v1/providers/:providerKey/credentials',
    {
      schema: {
        body: credentialsBodySchema,
        response: {
          201: successResponseSchema(providerSessionSchema),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const plugin = requireKnownProvider(request.params.providerKey);

      try {
        const sessionData = plugin.buildSessionFromCredentials(request.body.credentials);
        const session = await createProviderSession(pool, {
          label: normalizeLabel(request.body.label, plugin.name),
          providerKey: plugin.key,
          sessionData,
        });

        return reply.code(201).send(ok(session));
      } catch (error) {
        translateProviderError(error);
      }
    },
  );

  app.post<{ Body: HarBody; Params: ProviderParams }>(
    '/api/v1/providers/:providerKey/har-debug',
    {
      bodyLimit: 30 * 1024 * 1024,
      schema: {
        body: harBodySchema,
        response: {
          200: successResponseSchema(harDebugSchema),
        },
      },
    },
    async (request) => {
      const plugin = requireKnownProvider(request.params.providerKey);
      if (!plugin.debugHar) {
        throw badRequest(`${plugin.name} does not support HAR debug`);
      }

      try {
        return ok(plugin.debugHar(readHarBody(request.body)));
      } catch (error) {
        translateProviderError(error);
      }
    },
  );

  app.post<{ Body: HarBody; Params: ProviderParams }>(
    '/api/v1/providers/:providerKey/sessions/har',
    {
      bodyLimit: 30 * 1024 * 1024,
      schema: {
        body: harBodySchema,
        response: {
          201: successResponseSchema(providerSessionSchema),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const plugin = requireKnownProvider(request.params.providerKey);
      if (!plugin.buildSessionFromHar) {
        throw badRequest(`${plugin.name} does not support HAR import`);
      }

      try {
        const sessionData = plugin.buildSessionFromHar(readHarBody(request.body));
        const session = await createProviderSession(pool, {
          label: normalizeLabel(request.body.label, plugin.name),
          providerKey: plugin.key,
          sessionData,
        });

        return reply.code(201).send(ok(session));
      } catch (error) {
        translateProviderError(error);
      }
    },
  );

  app.post<{ Params: SessionParams }>(
    '/api/v1/providers/:providerKey/sessions/:sessionId/verify',
    {
      schema: {
        response: {
          200: successResponseSchema(verificationSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const plugin = requireKnownProvider(request.params.providerKey);
      if (!plugin.verifySession) {
        throw badRequest(`${plugin.name} does not support verification`);
      }

      const record = await getProviderSessionData(pool, {
        providerKey: plugin.key,
        sessionId: request.params.sessionId,
      });
      if (!record) {
        throw notFound('Session not found');
      }

      const verification = await plugin.verifySession(record.sessionData);
      const session = await markProviderSessionVerified(pool, {
        alive: verification.alive,
        providerKey: plugin.key,
        sessionId: request.params.sessionId,
      });

      return ok({ ...verification, session });
    },
  );

  app.get<{ Params: ProviderParams; Querystring: GeoTypeaheadQuery }>(
    '/api/v1/providers/:providerKey/geo-typeahead',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['query'],
          additionalProperties: false,
          properties: {
            query: { type: 'string', minLength: 2, maxLength: 100 },
          },
        },
        response: {
          200: successResponseSchema({ type: 'array', items: geoHitSchema }),
        },
      },
    },
    async (request) => {
      if (request.params.providerKey !== LINKEDIN_PROVIDER_KEY) {
        throw notFound('Geo typeahead is only available for LinkedIn');
      }

      const payload = await fetchLinkedInGeoTypeahead(request.query.query.trim());
      return ok(normalizeLinkedInGeoTypeaheadPayload(payload));
    },
  );
}
