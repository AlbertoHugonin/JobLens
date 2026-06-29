import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { badRequest, notFound, serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import { activitySchema } from './activities.js';
import { createAiReviewActivity, type AiReviewMode } from '../repositories/activitiesRepository.js';
import {
  readAiEndpoint,
  readAiModelByName,
  readAiSettings,
  resolveAiEndpointId,
  upsertAiModel,
} from '../repositories/aiRepository.js';
import {
  exportJob,
  hasSuccessfulAutomaticJobReview,
  listJobs,
  readJobInsights,
  readJob,
  readJobReviews,
  readExistingJobIds,
  updateJobLocalStatus,
  type JobAvailabilityStatus,
  type JobLocalStatus,
  type JobReviewDecision,
  type JobScope,
  type JobSortBy,
  type JobSortDir,
  type JobWorkplaceMode,
} from '../repositories/jobsRepository.js';

interface JobListQuery {
  availabilityStatus?: JobAvailabilityStatus | undefined;
  decision?: string | undefined;
  limit?: number | undefined;
  localStatus?: JobLocalStatus | undefined;
  location?: string | undefined;
  modelName?: string | undefined;
  offset?: number | undefined;
  providerKey?: string | undefined;
  scope?: JobScope | undefined;
  searchId?: string | undefined;
  sortBy?: JobSortBy | undefined;
  sortDir?: JobSortDir | undefined;
  text?: string | undefined;
  workplace?: JobWorkplaceMode | undefined;
}

interface JobInsightsQuery {
  topLimit?: number | undefined;
}

interface JobParams {
  id: string;
}

interface UpdateJobStateBody {
  localStatus: JobLocalStatus;
}

interface JobReviewRequestBody {
  endpointId?: string | undefined;
  force?: boolean | undefined;
  mode?: AiReviewMode | undefined;
  modelName?: string | undefined;
}

interface BatchJobReviewsBody extends JobReviewRequestBody {
  jobIds: string[];
}

const jobLocalStatusValues = ['new', 'viewed', 'saved', 'applied'] as const;
const jobAvailabilityStatusValues = [
  'active',
  'missing_from_searches',
  'available_outside_searches',
  'unavailable',
] as const;
const reviewDecisionValues = ['apply', 'maybe', 'reject'] as const;
const jobReviewModeValues = ['manual', 'automatic', 'benchmark'] as const;
const jobWorkplaceModeValues = ['onsite', 'remote', 'hybrid'] as const;

/** Parse the comma-separated `decision` query param into a validated list. */
function parseDecisions(value: string | undefined): JobReviewDecision[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is JobReviewDecision =>
      (reviewDecisionValues as readonly string[]).includes(item),
    );
  return parsed.length > 0 ? parsed : undefined;
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

const jobExternalSchema = {
  type: 'object',
  required: [
    'externalId',
    'externalUrl',
    'firstSeenAt',
    'id',
    'lastSeenAt',
    'providerKey',
    'providerName',
  ],
  properties: {
    externalId: { type: 'string' },
    externalUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    firstSeenAt: { type: 'string' },
    id: { type: 'string', format: 'uuid' },
    lastSeenAt: { type: 'string' },
    providerKey: { type: 'string' },
    providerName: { type: 'string' },
  },
} as const;

const jobSearchPresenceSchema = {
  type: 'object',
  required: [
    'firstSeenAt',
    'lastActivityId',
    'lastSeenAt',
    'providerKey',
    'searchId',
    'searchName',
  ],
  properties: {
    firstSeenAt: { type: 'string' },
    lastActivityId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    lastSeenAt: { type: 'string' },
    providerKey: { type: 'string' },
    searchId: { type: 'string', format: 'uuid' },
    searchName: { type: 'string' },
  },
} as const;

const jobReviewSchema = {
  type: 'object',
  required: [
    'createdAt',
    'decision',
    'id',
    'isPriority',
    'modelName',
    'priorityReason',
    'reviewMode',
    'score',
    'status',
  ],
  properties: {
    createdAt: { type: 'string' },
    decision: { anyOf: [{ type: 'string', enum: reviewDecisionValues }, { type: 'null' }] },
    id: { type: 'string', format: 'uuid' },
    isPriority: { type: 'boolean' },
    modelName: { type: 'string' },
    priorityReason: { type: 'string' },
    reviewMode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    score: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    status: { type: 'string', enum: ['success', 'failed'] },
  },
} as const;

const jobReviewDetailSchema = {
  ...jobReviewSchema,
  required: [
    ...jobReviewSchema.required,
    'endpointId',
    'endpointName',
    'error',
    'metrics',
    'modelId',
    'profileHash',
    'rawOutput',
    'result',
    'rulesHash',
  ],
  properties: {
    ...jobReviewSchema.properties,
    endpointId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    endpointName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    error: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    metrics: { type: 'object', additionalProperties: true },
    modelId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    profileHash: { type: 'string' },
    rawOutput: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    result: { type: 'object', additionalProperties: true },
    rulesHash: { type: 'string' },
  },
} as const;

const jobDecisionCountSchema = {
  type: 'object',
  required: ['count', 'key'],
  properties: {
    count: { type: 'number' },
    key: { type: 'string', enum: [...reviewDecisionValues, 'none'] },
  },
} as const;

const jobDescriptionSchema = {
  type: 'object',
  required: ['fetchedAt', 'html', 'htmlAvailable', 'id', 'source', 'text'],
  properties: {
    fetchedAt: { type: 'string' },
    html: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    htmlAvailable: { type: 'boolean' },
    id: { type: 'string', format: 'uuid' },
    source: { type: 'string' },
    text: { type: 'string' },
  },
} as const;

const jobSummarySchema = {
  type: 'object',
  required: [
    'availabilityStatus',
    'companyName',
    'createdAt',
    'employmentType',
    'externalJobs',
    'id',
    'latestReview',
    'localStatus',
    'locationText',
    'providerUrl',
    'publishedAt',
    'repostedAt',
    'searches',
    'seniority',
    'sourceUrl',
    'title',
    'updatedAt',
    'workplaceType',
  ],
  properties: {
    availabilityStatus: { type: 'string', enum: jobAvailabilityStatusValues },
    companyName: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    employmentType: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    externalJobs: { type: 'array', items: jobExternalSchema },
    id: { type: 'string', format: 'uuid' },
    latestReview: { anyOf: [jobReviewSchema, { type: 'null' }] },
    localStatus: { type: 'string', enum: jobLocalStatusValues },
    locationText: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    providerUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    publishedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    repostedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    searches: { type: 'array', items: jobSearchPresenceSchema },
    seniority: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    sourceUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    title: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
    workplaceType: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const jobDetailSchema = {
  ...jobSummarySchema,
  required: [...jobSummarySchema.required, 'description'],
  properties: {
    ...jobSummarySchema.properties,
    description: { anyOf: [jobDescriptionSchema, { type: 'null' }] },
  },
} as const;

const jobExportSchema = {
  type: 'object',
  required: ['exportedAt', 'externalJobs', 'job', 'latestDescription', 'latestReview', 'searches'],
  properties: {
    exportedAt: { type: 'string', format: 'date-time' },
    externalJobs: { type: 'array', items: jobExternalSchema },
    job: {
      type: 'object',
      additionalProperties: true,
    },
    latestDescription: { anyOf: [jobDescriptionSchema, { type: 'null' }] },
    latestReview: { anyOf: [jobReviewSchema, { type: 'null' }] },
    searches: { type: 'array', items: jobSearchPresenceSchema },
  },
} as const;

const jobInsightsSchema = {
  type: 'object',
  required: ['averageScore', 'byDecision', 'reviewed', 'topMatches', 'totalActive', 'unreviewed'],
  properties: {
    averageScore: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    byDecision: { type: 'array', items: jobDecisionCountSchema },
    reviewed: { type: 'number' },
    topMatches: { type: 'array', items: jobSummarySchema },
    totalActive: { type: 'number' },
    unreviewed: { type: 'number' },
  },
} as const;

const jobParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const jobReviewRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    endpointId: { type: 'string', format: 'uuid' },
    force: { type: 'boolean' },
    mode: { type: 'string', enum: jobReviewModeValues },
    modelName: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

const batchJobReviewsBodySchema = {
  ...jobReviewRequestBodySchema,
  required: ['jobIds'],
  properties: {
    ...jobReviewRequestBodySchema.properties,
    jobIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
  },
} as const;

const skippedJobReviewSchema = {
  type: 'object',
  required: ['jobId', 'reason'],
  properties: {
    jobId: { type: 'string', format: 'uuid' },
    reason: { type: 'string' },
  },
} as const;

const batchJobReviewsResponseSchema = {
  type: 'object',
  required: ['queued', 'skipped'],
  properties: {
    queued: { type: 'array', items: activitySchema },
    skipped: { type: 'array', items: skippedJobReviewSchema },
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

function normalizeTextFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeProviderKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized !== 'linkedin') {
    throw badRequest('Unsupported provider');
  }

  return normalized;
}

async function resolveJobReviewTarget(
  pool: DatabasePool,
  body: JobReviewRequestBody,
): Promise<{
  endpointId: string;
  endpointName: string;
  modelId: string;
  modelName: string;
}> {
  const settings = await readAiSettings(pool);

  if (!settings.enabled) {
    throw badRequest('AI reviews are disabled');
  }

  const endpointId = await resolveAiEndpointId(pool, body.endpointId);
  if (!endpointId) {
    throw badRequest('Enabled AI endpoint is required');
  }

  const endpoint = await readAiEndpoint(pool, endpointId);
  if (!endpoint?.enabled) {
    throw badRequest('Enabled AI endpoint is required');
  }

  const configuredModel =
    normalizeTextFilter(body.modelName) ??
    normalizeTextFilter(settings.runtime.modelName) ??
    normalizeTextFilter(settings.runtime.priorityModelName);

  if (!configuredModel) {
    throw badRequest('AI model name is required');
  }

  const existingModel = await readAiModelByName(pool, {
    endpointId,
    name: configuredModel,
  });
  const model =
    existingModel ??
    (await upsertAiModel(pool, {
      endpointId,
      metadata: {
        lastReviewQueuedAt: new Date().toISOString(),
      },
      name: configuredModel,
    }));

  return {
    endpointId,
    endpointName: endpoint.name,
    modelId: model.id,
    modelName: model.name,
  };
}

export async function registerJobsRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.get<{ Querystring: JobListQuery }>(
    '/api/v1/jobs',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            availabilityStatus: { type: 'string', enum: jobAvailabilityStatusValues },
            decision: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            localStatus: { type: 'string', enum: jobLocalStatusValues },
            location: { type: 'string' },
            modelName: { type: 'string' },
            offset: { type: 'integer', minimum: 0, default: 0 },
            providerKey: { type: 'string', enum: ['linkedin'] },
            scope: { type: 'string', enum: ['standard', 'all'], default: 'standard' },
            searchId: { type: 'string', format: 'uuid' },
            sortBy: {
              type: 'string',
              enum: ['aiScore', 'publishedAt', 'repostedAt'],
              default: 'publishedAt',
            },
            sortDir: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            text: { type: 'string' },
            workplace: { type: 'string', enum: jobWorkplaceModeValues },
          },
        },
        response: {
          200: successResponseSchema(
            { type: 'array', items: jobSummarySchema },
            paginationMetaSchema,
          ),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const limit = request.query.limit ?? 25;
      const offset = request.query.offset ?? 0;
      const result = await listJobs(pool, {
        availabilityStatus: request.query.availabilityStatus,
        decision: parseDecisions(request.query.decision),
        limit,
        localStatus: request.query.localStatus,
        location: normalizeTextFilter(request.query.location),
        modelName: normalizeTextFilter(request.query.modelName),
        offset,
        providerKey: normalizeProviderKey(request.query.providerKey),
        scope: request.query.scope ?? 'standard',
        searchId: request.query.searchId,
        sortBy: request.query.sortBy ?? 'publishedAt',
        sortDir: request.query.sortDir ?? 'desc',
        text: normalizeTextFilter(request.query.text),
        workplace: request.query.workplace,
      });

      return ok(result.items, {
        limit,
        offset,
        total: result.total,
      });
    },
  );

  app.get<{ Querystring: JobInsightsQuery }>(
    '/api/v1/jobs/insights',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            topLimit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
          },
        },
        response: {
          200: successResponseSchema(jobInsightsSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      return ok(await readJobInsights(pool, { topLimit: request.query.topLimit ?? 5 }));
    },
  );

  app.get<{ Params: JobParams }>(
    '/api/v1/jobs/:id',
    {
      schema: {
        params: jobParamsSchema,
        response: {
          200: successResponseSchema(jobDetailSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const job = await readJob(pool, request.params.id);
      if (!job) {
        throw notFound('Job not found');
      }

      return ok(job);
    },
  );

  app.get<{ Params: JobParams }>(
    '/api/v1/jobs/:id/reviews',
    {
      schema: {
        params: jobParamsSchema,
        response: {
          200: successResponseSchema({ type: 'array', items: jobReviewDetailSchema }),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const job = await readJob(pool, request.params.id);
      if (!job) {
        throw notFound('Job not found');
      }

      return ok(await readJobReviews(pool, request.params.id));
    },
  );

  app.patch<{ Body: UpdateJobStateBody; Params: JobParams }>(
    '/api/v1/jobs/:id/state',
    {
      schema: {
        body: {
          type: 'object',
          required: ['localStatus'],
          additionalProperties: false,
          properties: {
            localStatus: { type: 'string', enum: jobLocalStatusValues },
          },
        },
        params: jobParamsSchema,
        response: {
          200: successResponseSchema(jobDetailSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const job = await updateJobLocalStatus(pool, request.params.id, request.body.localStatus);
      if (!job) {
        throw notFound('Job not found');
      }

      return ok(job);
    },
  );

  app.post<{ Body: JobReviewRequestBody; Params: JobParams }>(
    '/api/v1/jobs/:id/reviews',
    {
      schema: {
        body: jobReviewRequestBodySchema,
        params: jobParamsSchema,
        response: {
          202: successResponseSchema(activitySchema),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const job = await readJob(pool, request.params.id);
      if (!job) {
        throw notFound('Job not found');
      }

      const target = await resolveJobReviewTarget(pool, request.body ?? {});
      const activity = await createAiReviewActivity(pool, {
        ...target,
        jobId: request.params.id,
        mode: request.body?.mode ?? 'manual',
      });

      return reply.code(202).send(ok(activity));
    },
  );

  app.post<{ Body: BatchJobReviewsBody }>(
    '/api/v1/jobs/batch-reviews',
    {
      schema: {
        body: batchJobReviewsBodySchema,
        response: {
          202: successResponseSchema(batchJobReviewsResponseSchema),
        },
      },
    },
    async (request, reply) => {
      const pool = requireDatabase(db);
      const mode = request.body.mode ?? 'automatic';
      const force = request.body.force === true;
      const existingIds = await readExistingJobIds(pool, request.body.jobIds);
      const skipped = request.body.jobIds
        .filter((jobId) => !existingIds.has(jobId))
        .map((jobId) => ({ jobId, reason: 'job_not_found' }));
      const candidateIds = request.body.jobIds.filter((jobId) => existingIds.has(jobId));

      if (candidateIds.length === 0) {
        return reply.code(202).send(ok({ queued: [], skipped }));
      }

      const target = await resolveJobReviewTarget(pool, request.body);
      const queued = [];

      for (const jobId of candidateIds) {
        if (mode === 'automatic' && !force) {
          const alreadyReviewed = await hasSuccessfulAutomaticJobReview(pool, {
            jobId,
            modelName: target.modelName,
          });
          if (alreadyReviewed) {
            skipped.push({ jobId, reason: 'already_reviewed_with_automatic_model' });
            continue;
          }
        }

        queued.push(
          await createAiReviewActivity(pool, {
            ...target,
            jobId,
            mode,
          }),
        );
      }

      return reply.code(202).send(ok({ queued, skipped }));
    },
  );

  app.get<{ Params: JobParams }>(
    '/api/v1/jobs/:id/export',
    {
      schema: {
        params: jobParamsSchema,
        response: {
          200: successResponseSchema(jobExportSchema),
        },
      },
    },
    async (request) => {
      const pool = requireDatabase(db);
      const exported = await exportJob(pool, request.params.id);
      if (!exported) {
        throw notFound('Job not found');
      }

      return ok(exported);
    },
  );
}
