import { setTimeout as delay } from 'node:timers/promises';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { DatabasePool } from '../db/pool.js';
import { serviceUnavailable } from '../http/errors.js';
import { listActivities } from '../repositories/activitiesRepository.js';

const STREAM_INTERVAL_MS = 1_000;
const STREAM_LIMIT = 25;

function requireDatabase(db: DatabasePool | undefined): DatabasePool {
  if (!db) {
    throw serviceUnavailable('Database is not configured');
  }

  return db;
}

function writeSseEvent(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function writeActivitySnapshot(reply: FastifyReply, pool: DatabasePool): Promise<void> {
  try {
    const result = await listActivities(pool, {
      limit: STREAM_LIMIT,
      offset: 0,
    });

    writeSseEvent(reply, 'activities', {
      data: result.items,
      meta: {
        limit: STREAM_LIMIT,
        offset: 0,
        total: result.total,
      },
    });
  } catch {
    writeSseEvent(reply, 'error', {
      message: 'Cannot read activities',
    });
  }
}

export async function registerEventRoutes(
  app: FastifyInstance,
  db: DatabasePool | undefined,
): Promise<void> {
  app.get('/api/v1/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const pool = requireDatabase(db);
    let closed = false;

    request.raw.on('close', () => {
      closed = true;
    });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');
    writeSseEvent(reply, 'ready', { status: 'ok' });

    while (!closed && !reply.raw.destroyed) {
      await writeActivitySnapshot(reply, pool);
      await delay(STREAM_INTERVAL_MS);
    }

    if (!reply.raw.destroyed) {
      reply.raw.end();
    }
  });
}
