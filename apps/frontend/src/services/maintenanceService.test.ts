import { describe, expect, it } from 'vitest';

import type { AiBenchmarkDto, AiModelMetricsDto } from '../API/ai';
import { normalizeAiBenchmark, normalizeAiModelMetrics } from './maintenanceService';

const activityDto = {
  activityType: 'ai_review',
  attempt: 0,
  cancelRequestedAt: null,
  createdAt: '2026-06-26T10:00:00.000Z',
  error: null,
  finishedAt: null,
  heartbeatAt: null,
  id: 'activity-1',
  leaseExpiresAt: null,
  leaseOwner: null,
  maxAttempts: 1,
  message: 'Queued',
  payload: {},
  phase: 'queued',
  progressCurrent: 0,
  progressTotal: 4,
  queuedAt: '2026-06-26T10:00:00.000Z',
  source: 'api',
  startedAt: null,
  status: 'queued',
  subjectId: 'job-1',
  subjectType: 'job',
  updatedAt: '2026-06-26T10:00:00.000Z',
} as const;

describe('maintenanceService', () => {
  it('normalizes model metrics', () => {
    const dto: AiModelMetricsDto = {
      avgDurationMs: 1500.5,
      avgOutputTokens: 44,
      avgPromptTokens: 22,
      avgScore: 82.5,
      avgTokensPerSecond: 18.75,
      endpointId: 'endpoint-1',
      endpointName: ' M12 endpoint ',
      failedCount: 1,
      lastReviewedAt: '2026-06-26T11:00:00.000Z',
      modelName: ' m12-model ',
      reviewCount: 3,
      successCount: 2,
    };

    expect(normalizeAiModelMetrics(dto)).toMatchObject({
      avgDurationMs: 1500.5,
      endpointName: 'M12 endpoint',
      modelName: 'm12-model',
      reviewCount: 3,
    });
  });

  it('normalizes benchmark results with queued activities', () => {
    const dto: AiBenchmarkDto = {
      model: {
        createdAt: '2026-06-26T10:00:00.000Z',
        discoveredAt: '2026-06-26T10:00:00.000Z',
        endpointId: 'endpoint-1',
        endpointName: 'Endpoint',
        id: 'model-1',
        installed: false,
        metadata: {},
        name: 'm12-benchmark',
        updatedAt: '2026-06-26T10:00:00.000Z',
      },
      queued: [activityDto],
      totalJobs: 1,
    };

    const result = normalizeAiBenchmark(dto);

    expect(result.model.name).toBe('m12-benchmark');
    expect(result.queued[0]?.activityType).toBe('ai_review');
    expect(result.totalJobs).toBe(1);
  });
});
