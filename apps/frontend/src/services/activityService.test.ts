import { describe, expect, it } from 'vitest';

import {
  canCancelActivity,
  canRetryActivity,
  getActivityProgressPercent,
} from '../models/activity';
import {
  normalizeActivity,
  normalizeActivityLogs,
  normalizeActivityPreview,
  normalizeLinkedInActivityDebug,
} from './activityService';

describe('normalizeActivityPreview', () => {
  it('normalizes compact activity rows for navigation', () => {
    const preview = normalizeActivityPreview(
      [
        {
          activityType: ' dummy ',
          attempt: 1,
          cancelRequestedAt: null,
          createdAt: '2026-06-25T00:00:00.000Z',
          error: null,
          finishedAt: null,
          heartbeatAt: null,
          id: 'activity-1',
          leaseExpiresAt: null,
          leaseOwner: null,
          maxAttempts: 1,
          message: ' Running ',
          payload: {},
          phase: 'work',
          progressCurrent: 1,
          progressTotal: 2,
          queuedAt: '2026-06-25T00:00:00.000Z',
          source: 'test',
          startedAt: null,
          status: 'running',
          subjectId: null,
          subjectType: null,
          updatedAt: '2026-06-25T00:00:01.000Z',
        },
      ],
      4,
    );

    expect(preview.items[0]).toMatchObject({
      activityType: 'dummy',
      message: 'Running',
      status: 'running',
    });
    expect(preview.total).toBe(4);
  });

  it('normalizes activity details and exposes action rules', () => {
    const activity = normalizeActivity({
      activityType: 'dummy',
      attempt: 0,
      cancelRequestedAt: null,
      createdAt: '2026-06-25T00:00:00.000Z',
      error: null,
      finishedAt: null,
      heartbeatAt: null,
      id: 'activity-2',
      leaseExpiresAt: null,
      leaseOwner: null,
      maxAttempts: 1,
      message: 'Queued',
      payload: { source: 'test' },
      phase: 'queued',
      progressCurrent: 2,
      progressTotal: 5,
      queuedAt: '2026-06-25T00:00:00.000Z',
      source: 'api',
      startedAt: null,
      status: 'queued',
      subjectId: null,
      subjectType: null,
      updatedAt: '2026-06-25T00:00:01.000Z',
    });

    expect(activity.payload).toEqual({ source: 'test' });
    expect(getActivityProgressPercent(activity)).toBe(40);
    expect(canCancelActivity(activity)).toBe(true);
    expect(canRetryActivity(activity)).toBe(false);
  });

  it('normalizes activity logs', () => {
    const logs = normalizeActivityLogs([
      {
        activityId: 'activity-1',
        createdAt: '2026-06-25T00:00:01.000Z',
        data: { step: 1 },
        id: '1',
        level: 'info',
        message: ' Started ',
      },
    ]);

    expect(logs[0]).toMatchObject({
      activityId: 'activity-1',
      data: { step: 1 },
      level: 'info',
      message: 'Started',
    });
  });

  it('normalizes LinkedIn raw payload debug data', () => {
    const debug = normalizeLinkedInActivityDebug({
      activityId: 'activity-3',
      activityType: ' linkedin_collect ',
      failed: 1,
      items: [
        {
          contentType: ' application/json ',
          createdAt: '2026-06-25T00:00:02.000Z',
          elapsedMs: 42,
          error: ' LinkedIn failed ',
          id: 'payload-1',
          payloadKind: 'json',
          requestParams: { start: 0 },
          requestUrl: ' https://www.linkedin.com/voyager/api/test ',
          responseStatus: 500,
          snippet: ' {"message":"LinkedIn failed"} ',
        },
      ],
      latestStatus: 500,
      providerKey: 'linkedin',
      statusCounts: [{ count: 1, status: '500' }],
      total: 1,
    });

    expect(debug).toMatchObject({
      activityId: 'activity-3',
      activityType: 'linkedin_collect',
      failed: 1,
      latestStatus: 500,
      total: 1,
    });
    expect(debug.items[0]).toMatchObject({
      contentType: 'application/json',
      error: 'LinkedIn failed',
      requestUrl: 'https://www.linkedin.com/voyager/api/test',
      snippet: '{"message":"LinkedIn failed"}',
    });
  });
});
