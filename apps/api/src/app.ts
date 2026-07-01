import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';

import { readConfig, type ApiConfig } from './config.js';
import type { DatabasePool } from './db/pool.js';
import { notFound } from './http/errors.js';
import { toErrorResponse } from './http/responses.js';
import { registerActivitiesRoutes } from './routes/activities.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerEventRoutes } from './routes/events.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerMaintenanceRoutes } from './routes/maintenance.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerSearchesRoutes } from './routes/searches.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSystemRoutes } from './routes/system.js';

export interface AppDependencies {
  closeDbOnClose?: boolean | undefined;
  db?: DatabasePool | undefined;
}

export async function buildApp(
  config: ApiConfig = readConfig(),
  dependencies: AppDependencies = {},
) {
  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: config.logLevel },
  });

  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
  });

  await registerHealthRoutes(app, config);
  await registerSystemRoutes(app, dependencies.db);
  await registerSettingsRoutes(app, dependencies.db);
  await registerAiRoutes(app, dependencies.db);
  await registerProviderRoutes(app, dependencies.db);
  await registerSearchesRoutes(app, dependencies.db);
  await registerJobsRoutes(app, dependencies.db);
  await registerMaintenanceRoutes(app, dependencies.db, config.debugBackupBodyLimitBytes);
  await registerActivitiesRoutes(app, dependencies.db);
  await registerEventRoutes(app, dependencies.db);

  if (dependencies.db && dependencies.closeDbOnClose) {
    app.addHook('onClose', async () => {
      await dependencies.db?.end();
    });
  }

  app.setNotFoundHandler(async () => {
    throw notFound('Route not found');
  });

  app.setErrorHandler(async (error: FastifyError, _request, reply) => {
    const normalized = toErrorResponse(error);
    return reply.code(normalized.statusCode).send(normalized.body);
  });

  return app;
}
