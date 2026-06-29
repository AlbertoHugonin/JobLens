import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '../config.js';
import { ok, successResponseSchema } from '../http/responses.js';

const healthResponseSchema = {
  type: 'object',
  required: ['service', 'status', 'version', 'uptimeSeconds', 'timestamp'],
  properties: {
    service: { type: 'string' },
    status: { type: 'string', enum: ['ok'] },
    version: { type: 'string' },
    uptimeSeconds: { type: 'number' },
    timestamp: { type: 'string', format: 'date-time' },
  },
} as const;

export async function registerHealthRoutes(app: FastifyInstance, config: ApiConfig): Promise<void> {
  const readHealth = () => ({
    service: 'api',
    status: 'ok',
    version: config.version,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });

  app.get(
    '/api/v1/health',
    {
      schema: {
        response: {
          200: successResponseSchema(healthResponseSchema),
        },
      },
    },
    async () => ok(readHealth()),
  );

  app.get('/health', async () => readHealth());
}
