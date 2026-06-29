import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

describe('health routes', () => {
  it('returns API health status', async () => {
    const app = await buildApp(readConfig({ API_RUN_MIGRATIONS: 'false', NODE_ENV: 'test' }));
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        service: 'api',
        status: 'ok',
        version: '0.0.0',
      },
    });
  });

  it('returns readable validation errors', async () => {
    const app = await buildApp(readConfig({ API_RUN_MIGRATIONS: 'false', NODE_ENV: 'test' }));
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/activities?limit=500',
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        statusCode: 400,
      },
    });
  });

  it('returns a standard not found error', async () => {
    const app = await buildApp(readConfig({ API_RUN_MIGRATIONS: 'false', NODE_ENV: 'test' }));
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/missing',
    });

    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'not_found',
        message: 'Route not found',
        statusCode: 404,
      },
    });
  });

  it('keeps the non-versioned health check simple for containers', async () => {
    const app = await buildApp(readConfig({ API_RUN_MIGRATIONS: 'false', NODE_ENV: 'test' }));
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: 'api',
      status: 'ok',
      version: '0.0.0',
    });
  });
});
