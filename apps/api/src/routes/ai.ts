import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { badRequest, notFound, serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import {
  createAiReviewActivity,
  createModelInstallActivity,
} from '../repositories/activitiesRepository.js';
import {
  activateAiEndpoint,
  createAiEndpoint,
  deleteAiEndpoint,
  deleteAiModel,
  listAiEndpoints,
  listAiModels,
  readAiEndpoint,
  readAiModelById,
  readAiSettings,
  resetEvaluationRules,
  resolveAiEndpointId,
  syncAiModels,
  updateAiEndpoint,
  updateAiSettings,
  upsertAiModel,
} from '../repositories/aiRepository.js';
import {
  deleteJobReviews,
  listBenchmarkJobIds,
  listModelMetrics,
} from '../repositories/maintenanceRepository.js';
import { activitySchema } from './activities.js';

interface EndpointParams {
  id: string;
}

interface AiModelsQuery {
  endpointId?: string | undefined;
}

interface AiEndpointBody {
  baseUrl?: string | undefined;
  config?: unknown | undefined;
  enabled?: boolean | undefined;
  name?: string | undefined;
}

interface AiSettingsBody {
  candidateProfile?: string | undefined;
  enabled?: boolean | undefined;
  evaluationRules?: string | undefined;
  outputLanguage?: string | undefined;
  pauses?:
    | Array<{
        dayOfWeek?: number | undefined;
        daysOfWeek?: number[] | undefined;
        enabled: boolean;
        endTime: string;
        startTime: string;
      }>
    | undefined;
  reviewFields?:
    | Array<{
        description: string;
        enabled: boolean;
        key: string;
        label: string;
        maxItems: number;
      }>
    | undefined;
  runtime?:
    | {
        keepAlive?: string | undefined;
        modelName?: string | undefined;
        numCtx?: number | undefined;
        numPredict?: number | undefined;
        priorityModelName?: string | undefined;
        retryAttempts?: number | undefined;
        retryDelaySeconds?: number | undefined;
        temperature?: number | undefined;
        think?: boolean | undefined;
        timeoutSeconds?: number | undefined;
      }
    | undefined;
}

interface ModelInstallBody {
  endpointId?: string | undefined;
  modelName: string;
}

interface ModelSyncBody {
  endpointId?: string | undefined;
}

interface BenchmarkBody {
  endpointId?: string | undefined;
  modelName: string;
}

interface DeleteReviewsBody {
  all?: boolean | undefined;
  modelName?: string | undefined;
}

const uuidParamSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const runtimeSchema = {
  type: 'object',
  required: [
    'keepAlive',
    'modelName',
    'numCtx',
    'numPredict',
    'priorityModelName',
    'retryAttempts',
    'retryDelaySeconds',
    'temperature',
    'think',
    'timeoutSeconds',
  ],
  properties: {
    keepAlive: { type: 'string' },
    modelName: { type: 'string' },
    numCtx: { type: 'number' },
    numPredict: { type: 'number' },
    priorityModelName: { type: 'string' },
    retryAttempts: { type: 'number' },
    retryDelaySeconds: { type: 'number' },
    temperature: { type: 'number' },
    think: { type: 'boolean' },
    timeoutSeconds: { type: 'number' },
  },
} as const;

const pauseSchema = {
  type: 'object',
  required: ['enabled', 'endTime', 'startTime'],
  additionalProperties: false,
  anyOf: [{ required: ['dayOfWeek'] }, { required: ['daysOfWeek'] }],
  properties: {
    dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
    daysOfWeek: {
      type: 'array',
      items: { type: 'integer', minimum: 0, maximum: 6 },
      minItems: 1,
      uniqueItems: true,
    },
    enabled: { type: 'boolean' },
    endTime: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
    startTime: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  },
} as const;

const reviewOutputLanguageValues = ['en', 'it', 'job_language', 'profile_language'] as const;

const reviewFieldSchema = {
  type: 'object',
  required: ['description', 'enabled', 'key', 'label', 'maxItems'],
  additionalProperties: false,
  properties: {
    description: { type: 'string' },
    enabled: { type: 'boolean' },
    key: { type: 'string', minLength: 1, maxLength: 100 },
    label: { type: 'string' },
    maxItems: { type: 'integer', minimum: 1, maximum: 10 },
  },
} as const;

const aiSettingsSchema = {
  type: 'object',
  required: [
    'activeEndpointId',
    'candidateProfile',
    'enabled',
    'evaluationRules',
    'outputLanguage',
    'pauses',
    'reviewFields',
    'rulesTemplate',
    'rulesTemplateVersion',
    'runtime',
    'updatedAt',
  ],
  properties: {
    activeEndpointId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    candidateProfile: { type: 'string' },
    enabled: { type: 'boolean' },
    evaluationRules: { type: 'string' },
    outputLanguage: { type: 'string', enum: reviewOutputLanguageValues },
    pauses: { type: 'array', items: pauseSchema },
    reviewFields: { type: 'array', items: reviewFieldSchema },
    rulesTemplate: { type: 'string' },
    rulesTemplateVersion: { type: 'number' },
    runtime: runtimeSchema,
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const endpointSchema = {
  type: 'object',
  required: ['baseUrl', 'config', 'createdAt', 'enabled', 'id', 'isActive', 'name', 'updatedAt'],
  properties: {
    baseUrl: { type: 'string' },
    config: {},
    createdAt: { type: 'string', format: 'date-time' },
    enabled: { type: 'boolean' },
    id: { type: 'string', format: 'uuid' },
    isActive: { type: 'boolean' },
    name: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const endpointHealthSchema = {
  type: 'object',
  required: ['checkedAt', 'endpointId', 'latencyMs', 'message', 'reachable', 'status', 'version'],
  properties: {
    checkedAt: { type: 'string', format: 'date-time' },
    endpointId: { type: 'string', format: 'uuid' },
    latencyMs: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    message: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    reachable: { type: 'boolean' },
    status: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    version: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const endpointProbeSchema = {
  type: 'object',
  required: ['checkedAt', 'latencyMs', 'message', 'reachable', 'status', 'version'],
  properties: {
    checkedAt: { type: 'string', format: 'date-time' },
    latencyMs: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    message: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    reachable: { type: 'boolean' },
    status: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    version: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const probeBodySchema = {
  type: 'object',
  required: ['baseUrl'],
  properties: { baseUrl: { type: 'string', minLength: 1 } },
} as const;

interface ProbeBody {
  baseUrl: string;
}

const deletedSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

const modelSchema = {
  type: 'object',
  required: [
    'createdAt',
    'discoveredAt',
    'endpointId',
    'endpointName',
    'id',
    'installed',
    'metadata',
    'name',
    'updatedAt',
  ],
  properties: {
    createdAt: { type: 'string', format: 'date-time' },
    discoveredAt: { type: 'string', format: 'date-time' },
    endpointId: { type: 'string', format: 'uuid' },
    endpointName: { type: 'string' },
    id: { type: 'string', format: 'uuid' },
    installed: { type: 'boolean' },
    metadata: {},
    name: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const modelMetricsSchema = {
  type: 'object',
  required: [
    'avgDurationMs',
    'avgOutputTokens',
    'avgPromptTokens',
    'avgScore',
    'avgTokensPerSecond',
    'endpointId',
    'endpointName',
    'failedCount',
    'lastReviewedAt',
    'modelName',
    'reviewCount',
    'successCount',
  ],
  properties: {
    avgDurationMs: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    avgOutputTokens: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    avgPromptTokens: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    avgScore: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    avgTokensPerSecond: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    endpointId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    endpointName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    failedCount: { type: 'number' },
    lastReviewedAt: { type: 'string', format: 'date-time' },
    modelName: { type: 'string' },
    reviewCount: { type: 'number' },
    successCount: { type: 'number' },
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

function normalizeRequiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }

  return normalized;
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = normalizeRequiredText(value, 'Base URL');
  try {
    return new URL(normalized).toString().replace(/\/+$/, '');
  } catch {
    throw badRequest('Base URL must be a valid URL');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface AiEndpointHealthResult {
  checkedAt: string;
  latencyMs: number | null;
  message: string | null;
  reachable: boolean;
  status: number | null;
  version: string | null;
}

/**
 * Probe an AI endpoint (Ollama) by hitting its lightweight `/api/version` route.
 * Reflects real reachability — used by the UI to show Online/Offline.
 */
async function probeAiEndpoint(baseUrl: string, timeoutMs = 4000): Promise<AiEndpointHealthResult> {
  const target = `${baseUrl.replace(/\/+$/, '')}/api/version`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(target, {
      headers: { accept: 'application/json' },
      method: 'GET',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;

    let version: string | null = null;
    if (response.ok) {
      try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object' && 'version' in body) {
          const candidate = (body as { version?: unknown }).version;
          version = typeof candidate === 'string' ? candidate : null;
        }
      } catch {
        // Older Ollama builds answer with plain text — still reachable.
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      latencyMs,
      message: response.ok ? null : `HTTP ${response.status}`,
      reachable: response.ok,
      status: response.status,
      version,
    };
  } catch (caught: unknown) {
    const aborted = caught instanceof Error && caught.name === 'AbortError';
    return {
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      message: aborted ? `Nessuna risposta entro ${timeoutMs} ms` : 'Server non raggiungibile',
      reachable: false,
      status: null,
      version: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

interface OllamaModelRecord {
  metadata: Record<string, unknown>;
  name: string;
}

function readOllamaModelName(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  return readOptionalText(value.name) ?? readOptionalText(value.model);
}

function buildOllamaModelMetadata(value: unknown, syncedAt: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    source: 'ollama_tags',
    syncedAt,
  };

  if (!isRecord(value)) {
    return metadata;
  }

  const digest = readOptionalText(value.digest);
  const model = readOptionalText(value.model);
  const modifiedAt = readOptionalText(value.modified_at);
  const size = readOptionalNumber(value.size);

  if (digest) {
    metadata.digest = digest;
  }
  if (model) {
    metadata.model = model;
  }
  if (modifiedAt) {
    metadata.modifiedAt = modifiedAt;
  }
  if (size !== null) {
    metadata.size = size;
  }
  if (isRecord(value.details)) {
    metadata.details = value.details;
  }

  return metadata;
}

async function fetchOllamaModels(baseUrl: string, timeoutMs = 8000): Promise<OllamaModelRecord[]> {
  const target = `${baseUrl.replace(/\/+$/, '')}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(target, {
      headers: { accept: 'application/json' },
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw serviceUnavailable(`Aggiornamento modelli non riuscito: HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.models)) {
      throw serviceUnavailable('Risposta modelli AI non valida');
    }

    const syncedAt = new Date().toISOString();
    const models = new Map<string, OllamaModelRecord>();

    for (const item of body.models) {
      const name = readOllamaModelName(item);
      if (!name || models.has(name)) {
        continue;
      }

      models.set(name, {
        metadata: buildOllamaModelMetadata(item, syncedAt),
        name,
      });
    }

    return Array.from(models.values()).sort((left, right) => left.name.localeCompare(right.name));
  } catch (caught: unknown) {
    if (caught instanceof Error && caught.name === 'AppError') {
      throw caught;
    }

    const aborted = caught instanceof Error && caught.name === 'AbortError';
    throw serviceUnavailable(
      aborted
        ? `Nessuna risposta dai modelli AI entro ${timeoutMs} ms`
        : 'Server AI non raggiungibile durante aggiornamento modelli',
    );
  } finally {
    clearTimeout(timer);
  }
}

interface OllamaDeleteResult {
  ok: boolean;
  status: number | null;
  unreachable: boolean;
}

/**
 * Uninstall a model from an Ollama server via `DELETE /api/delete`. Done directly
 * from the API (like the health probe) since it is a quick, synchronous call.
 */
async function deleteOllamaModel(
  baseUrl: string,
  modelName: string,
  timeoutMs = 8000,
): Promise<OllamaDeleteResult> {
  const target = `${baseUrl.replace(/\/+$/, '')}/api/delete`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(target, {
      // Newer Ollama expects `model`; older builds used `name` — send both.
      body: JSON.stringify({ model: modelName, name: modelName }),
      headers: { 'content-type': 'application/json' },
      method: 'DELETE',
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, unreachable: false };
  } catch {
    return { ok: false, status: null, unreachable: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function registerAiRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.get(
    '/api/v1/ai/settings',
    {
      schema: {
        response: {
          200: successResponseSchema(aiSettingsSchema),
        },
      },
    },
    async () => {
      const pool = requireDatabase(db);
      return ok(await readAiSettings(pool));
    },
  );

  app.patch<{ Body: AiSettingsBody }>(
    '/api/v1/ai/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidateProfile: { type: 'string' },
            enabled: { type: 'boolean' },
            evaluationRules: { type: 'string' },
            outputLanguage: { type: 'string', enum: reviewOutputLanguageValues },
            pauses: { type: 'array', items: pauseSchema },
            reviewFields: { type: 'array', items: reviewFieldSchema },
            runtime: {
              type: 'object',
              additionalProperties: false,
              properties: {
                keepAlive: { type: 'string' },
                modelName: { type: 'string' },
                numCtx: { type: 'integer', minimum: 512 },
                numPredict: { type: 'integer', minimum: 128 },
                priorityModelName: { type: 'string' },
                retryAttempts: { type: 'integer', minimum: 0 },
                retryDelaySeconds: { type: 'integer', minimum: 0 },
                temperature: { type: 'number', minimum: 0, maximum: 2 },
                think: { type: 'boolean' },
                timeoutSeconds: { type: 'integer', minimum: 5 },
              },
            },
          },
        },
        response: {
          200: successResponseSchema(aiSettingsSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      return ok(await updateAiSettings(pool, request.body));
    },
  );

  app.post(
    '/api/v1/ai/settings/rules/reset',
    {
      schema: {
        response: {
          200: successResponseSchema(aiSettingsSchema),
        },
      },
    },
    async () => {
      const pool = requireDatabase(db);
      return ok(await resetEvaluationRules(pool));
    },
  );

  app.get(
    '/api/v1/ai/endpoints',
    {
      schema: {
        response: {
          200: successResponseSchema({ type: 'array', items: endpointSchema }),
        },
      },
    },
    async () => {
      const pool = requireDatabase(db);
      return ok(await listAiEndpoints(pool));
    },
  );

  app.post<{ Body: AiEndpointBody }>(
    '/api/v1/ai/endpoints',
    {
      schema: {
        body: {
          type: 'object',
          required: ['baseUrl', 'name'],
          additionalProperties: false,
          properties: {
            baseUrl: { type: 'string' },
            config: {},
            enabled: { type: 'boolean', default: true },
            name: { type: 'string' },
          },
        },
        response: {
          201: successResponseSchema(endpointSchema),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const endpoint = await createAiEndpoint(pool, {
        baseUrl: normalizeBaseUrl(request.body.baseUrl),
        config: request.body.config ?? {},
        enabled: request.body.enabled ?? true,
        name: normalizeRequiredText(request.body.name, 'Endpoint name'),
      });

      return reply.code(201).send(ok(endpoint));
    },
  );

  app.patch<{ Body: AiEndpointBody; Params: EndpointParams }>(
    '/api/v1/ai/endpoints/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            baseUrl: { type: 'string' },
            config: {},
            enabled: { type: 'boolean' },
            name: { type: 'string' },
          },
        },
        params: uuidParamSchema,
        response: {
          200: successResponseSchema(endpointSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const endpoint = await updateAiEndpoint(pool, request.params.id, {
        baseUrl:
          request.body.baseUrl === undefined ? undefined : normalizeBaseUrl(request.body.baseUrl),
        config: request.body.config,
        enabled: request.body.enabled,
        name:
          request.body.name === undefined
            ? undefined
            : normalizeRequiredText(request.body.name, 'Endpoint name'),
      });

      if (!endpoint) {
        throw notFound('AI endpoint not found');
      }

      return ok(endpoint);
    },
  );

  app.post<{ Params: EndpointParams }>(
    '/api/v1/ai/endpoints/:id/activate',
    {
      schema: {
        params: uuidParamSchema,
        response: {
          200: successResponseSchema(endpointSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const endpoint = await activateAiEndpoint(pool, request.params.id);
      if (!endpoint) {
        throw notFound('Enabled AI endpoint not found');
      }

      return ok(endpoint);
    },
  );

  app.get<{ Params: EndpointParams }>(
    '/api/v1/ai/endpoints/:id/health',
    {
      schema: {
        params: uuidParamSchema,
        response: {
          200: successResponseSchema(endpointHealthSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const endpoint = await readAiEndpoint(pool, request.params.id);
      if (!endpoint) {
        throw notFound('AI endpoint not found');
      }

      const health = await probeAiEndpoint(endpoint.baseUrl);
      return ok({ ...health, endpointId: request.params.id });
    },
  );

  app.post<{ Body: ProbeBody }>(
    '/api/v1/ai/endpoints/probe',
    {
      schema: {
        body: probeBodySchema,
        response: {
          200: successResponseSchema(endpointProbeSchema),
        },
      },
    },
    async (request) => {
      // Probe an arbitrary base URL before the endpoint exists, so the UI can
      // refuse to add a server that does not respond.
      const baseUrl = normalizeBaseUrl(request.body.baseUrl);
      const health = await probeAiEndpoint(baseUrl);
      return ok(health);
    },
  );

  app.delete<{ Params: EndpointParams }>(
    '/api/v1/ai/endpoints/:id',
    {
      schema: {
        params: uuidParamSchema,
        response: {
          200: successResponseSchema(deletedSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const deleted = await deleteAiEndpoint(pool, request.params.id);
      if (!deleted) {
        throw notFound('AI endpoint not found');
      }

      return ok({ id: request.params.id });
    },
  );

  app.get<{ Querystring: AiModelsQuery }>(
    '/api/v1/ai/models',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            endpointId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: successResponseSchema({ type: 'array', items: modelSchema }),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      return ok(await listAiModels(pool, { endpointId: request.query.endpointId }));
    },
  );

  app.get(
    '/api/v1/ai/models/metrics',
    {
      schema: {
        response: {
          200: successResponseSchema({ type: 'array', items: modelMetricsSchema }),
        },
      },
    },
    async () => {
      const pool = requireDatabase(db);
      return ok(await listModelMetrics(pool));
    },
  );

  app.post<{ Body: ModelInstallBody }>(
    '/api/v1/ai/models/install',
    {
      schema: {
        body: {
          type: 'object',
          required: ['modelName'],
          additionalProperties: false,
          properties: {
            endpointId: { type: 'string', format: 'uuid' },
            modelName: { type: 'string' },
          },
        },
        response: {
          202: successResponseSchema({
            type: 'object',
            required: ['activity', 'model'],
            properties: {
              activity: activitySchema,
              model: modelSchema,
            },
          }),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const endpointId = await resolveAiEndpointId(pool, request.body?.endpointId);
      if (!endpointId) {
        throw badRequest('Select an enabled AI endpoint before installing a model');
      }

      const modelName = normalizeRequiredText(request.body.modelName, 'Model name');
      const model = await upsertAiModel(pool, {
        endpointId,
        installed: false,
        metadata: { installRequestedAt: new Date().toISOString() },
        name: modelName,
      });
      const activity = await createModelInstallActivity(pool, {
        endpointId: model.endpointId,
        endpointName: model.endpointName,
        modelId: model.id,
        modelName: model.name,
      });

      return reply.code(202).send(ok({ activity, model }));
    },
  );

  app.post<{ Body: ModelSyncBody }>(
    '/api/v1/ai/models/sync',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            endpointId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: successResponseSchema({ type: 'array', items: modelSchema }),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const endpointId = await resolveAiEndpointId(pool, request.body?.endpointId);
      if (!endpointId) {
        throw badRequest('Select an enabled AI endpoint before refreshing models');
      }

      const endpoint = await readAiEndpoint(pool, endpointId);
      if (!endpoint) {
        throw notFound('AI endpoint not found');
      }

      const models = await fetchOllamaModels(endpoint.baseUrl);
      return ok(await syncAiModels(pool, { endpointId, models }));
    },
  );

  app.delete<{ Params: EndpointParams }>(
    '/api/v1/ai/models/:id',
    {
      schema: {
        params: uuidParamSchema,
        response: {
          200: successResponseSchema(deletedSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const model = await readAiModelById(pool, request.params.id);
      if (!model) {
        throw notFound('AI model not found');
      }

      // Only models that are actually on the server need an Ollama-side delete.
      if (model.installed) {
        const endpoint = await readAiEndpoint(pool, model.endpointId);
        if (!endpoint) {
          throw notFound('AI endpoint not found');
        }

        const result = await deleteOllamaModel(endpoint.baseUrl, model.name);
        if (result.unreachable) {
          throw serviceUnavailable(
            'Server non raggiungibile: impossibile rimuovere il modello dal server',
          );
        }
        // A 404 means it is already gone on the server — fall through and drop the record.
      }

      await deleteAiModel(pool, request.params.id);
      return ok({ id: request.params.id });
    },
  );

  app.post<{ Body: BenchmarkBody }>(
    '/api/v1/ai/benchmark',
    {
      schema: {
        body: {
          type: 'object',
          required: ['modelName'],
          additionalProperties: false,
          properties: {
            endpointId: { type: 'string', format: 'uuid' },
            modelName: { type: 'string' },
          },
        },
        response: {
          202: successResponseSchema({
            type: 'object',
            required: ['model', 'queued', 'totalJobs'],
            properties: {
              model: modelSchema,
              queued: { type: 'array', items: activitySchema },
              totalJobs: { type: 'number' },
            },
          }),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const endpointId = await resolveAiEndpointId(pool, request.body.endpointId);
      if (!endpointId) {
        throw badRequest('Select an enabled AI endpoint before running a benchmark');
      }

      const modelName = normalizeRequiredText(request.body.modelName, 'Model name');
      const model = await upsertAiModel(pool, {
        endpointId,
        installed: false,
        metadata: { benchmarkRequestedAt: new Date().toISOString() },
        name: modelName,
      });
      const jobIds = await listBenchmarkJobIds(pool);
      const queued = [];

      for (const jobId of jobIds) {
        queued.push(
          await createAiReviewActivity(pool, {
            endpointId: model.endpointId,
            endpointName: model.endpointName,
            jobId,
            mode: 'benchmark',
            modelId: model.id,
            modelName: model.name,
          }),
        );
      }

      return reply.code(202).send(ok({ model, queued, totalJobs: jobIds.length }));
    },
  );

  app.delete<{ Body: DeleteReviewsBody }>(
    '/api/v1/ai/reviews',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            all: { type: 'boolean' },
            modelName: { type: 'string' },
          },
        },
        response: {
          200: successResponseSchema({
            type: 'object',
            required: ['deleted'],
            properties: {
              deleted: { type: 'number' },
            },
          }),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const modelName = request.body?.modelName?.trim();
      const all = request.body?.all === true;

      if (!all && !modelName) {
        throw badRequest('Review deletion requires all=true or modelName');
      }

      return ok({
        deleted: await deleteJobReviews(pool, { all, modelName }),
      });
    },
  );
}
