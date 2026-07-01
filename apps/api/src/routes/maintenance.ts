import type { FastifyInstance } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { badRequest, serviceUnavailable } from '../http/errors.js';
import { ok, successResponseSchema } from '../http/responses.js';
import { createExportActivity } from '../repositories/activitiesRepository.js';
import {
  BackupImportError,
  backupSectionValues,
  createJobLensBackup,
  importJobLensBackup,
  normalizeBackupSections,
  type BackupImportMode,
} from '../repositories/backupRepository.js';
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

interface BackupExportBody {
  sections?: string[] | undefined;
}

interface BackupImportBody {
  backup?: unknown | undefined;
  mode?: BackupImportMode | undefined;
  sections?: string[] | undefined;
}

const RESET_CONFIRMATION = 'RESET';
const CLEAR_CONFIRMATION = 'CLEAR';

const backupSectionSchema = { type: 'string', enum: backupSectionValues } as const;

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

const jobLensBackupSchema = {
  type: 'object',
  required: ['exportedAt', 'format', 'schemaVersion', 'sections', 'version'],
  properties: {
    exportedAt: { type: 'string', format: 'date-time' },
    format: { type: 'string', enum: ['joblens.backup'] },
    schemaVersion: { type: 'number' },
    sections: { type: 'object', additionalProperties: true },
    version: { type: 'number', enum: [1] },
  },
} as const;

const backupSectionResultSchema = {
  type: 'object',
  required: ['deleted', 'imported', 'skipped'],
  properties: {
    deleted: { type: 'number' },
    imported: { type: 'number' },
    skipped: { type: 'number' },
  },
} as const;

const backupImportSchema = {
  type: 'object',
  required: ['importedAt', 'mode', 'sections'],
  properties: {
    importedAt: { type: 'string', format: 'date-time' },
    mode: { type: 'string', enum: ['merge', 'replace'] },
    sections: {
      type: 'object',
      additionalProperties: backupSectionResultSchema,
    },
  },
} as const;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

function translateBackupError(error: unknown): never {
  if (error instanceof BackupImportError) {
    throw badRequest(error.message);
  }

  throw error;
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

  app.post<{ Body: BackupExportBody }>(
    '/api/v1/debug/backup/export',
    {
      bodyLimit: 30 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['sections'],
          additionalProperties: false,
          properties: {
            sections: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: backupSectionSchema,
            },
          },
        },
        response: {
          200: successResponseSchema(jobLensBackupSchema),
        },
      },
    },
    async (request) => {
      try {
        const pool = requireDatabase(db);
        const sections = normalizeBackupSections(request.body.sections);
        return ok(await createJobLensBackup(pool, { sections }));
      } catch (error) {
        translateBackupError(error);
      }
    },
  );

  app.post<{ Body: BackupImportBody }>(
    '/api/v1/debug/backup/import',
    {
      bodyLimit: 30 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['backup', 'sections'],
          additionalProperties: false,
          properties: {
            backup: {},
            mode: { type: 'string', enum: ['merge', 'replace'] },
            sections: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: backupSectionSchema,
            },
          },
        },
        response: {
          200: successResponseSchema(backupImportSchema),
        },
      },
    },
    async (request) => {
      try {
        const pool = requireDatabase(db);
        const sections = normalizeBackupSections(request.body.sections);
        return ok(
          await importJobLensBackup(pool, {
            backup: request.body.backup,
            mode: request.body.mode === 'replace' ? 'replace' : 'merge',
            sections,
          }),
        );
      } catch (error) {
        translateBackupError(error);
      }
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
