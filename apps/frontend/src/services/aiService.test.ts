import { describe, expect, it } from 'vitest';

import type { ActivityDto } from '../API/activities';
import {
  normalizeAiEndpoint,
  normalizeAiModelInstall,
  normalizeAiSettings,
  validateAiEndpointDraft,
  validateAiModelName,
} from './aiService';

const activityDto: ActivityDto = {
  activityType: 'model_install',
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
  message: 'Queued model install',
  payload: {},
  phase: 'queued',
  progressCurrent: 1,
  progressTotal: 3,
  queuedAt: '2026-06-26T10:00:00.000Z',
  source: 'api',
  startedAt: null,
  status: 'queued',
  subjectId: 'model-1',
  subjectType: 'ai_model',
  updatedAt: '2026-06-26T10:00:01.000Z',
};

describe('aiService', () => {
  it('normalizes AI settings and runtime bounds', () => {
    const settings = normalizeAiSettings({
      activeEndpointId: ' endpoint-1 ',
      candidateProfile: ' Profile ',
      enabled: true,
      evaluationRules: ' Rules ',
      outputLanguage: 'en',
      pauses: [
        {
          dayOfWeek: 9,
          enabled: true,
          endTime: '18:00',
          startTime: '09:00',
        },
      ],
      reviewFields: [
        {
          description: ' Evidence ',
          enabled: true,
          key: 'custom-field',
          label: '',
          maxItems: 99,
        },
      ],
      rulesTemplate: ' Template ',
      rulesTemplateVersion: 1,
      runtime: {
        keepAlive: '',
        modelName: ' llama ',
        numCtx: 100,
        numPredict: 90,
        priorityModelName: ' priority ',
        retryAttempts: -1,
        retryDelaySeconds: -3,
        temperature: 4,
        think: true,
        timeoutSeconds: 1,
      },
      updatedAt: '2026-06-26T10:00:00.000Z',
    });

    expect(settings.activeEndpointId).toBe('endpoint-1');
    expect(settings.outputLanguage).toBe('en');
    expect(settings.reviewFields[0]).toMatchObject({
      key: 'custom_field',
      label: 'Custom Field',
      maxItems: 10,
    });
    expect(settings.runtime.keepAlive).toBe('10m');
    expect(settings.runtime.numCtx).toBe(512);
    expect(settings.runtime.numPredict).toBe(128);
    expect(settings.runtime.temperature).toBe(2);
    expect(settings.runtime.retryAttempts).toBe(0);
    expect(settings.runtime.timeoutSeconds).toBe(5);
    expect(settings.pauses[0]).toMatchObject({
      dayOfWeek: 6,
      startTime: '09:00',
    });
  });

  it('normalizes endpoints and model install activity results', () => {
    const endpoint = normalizeAiEndpoint({
      baseUrl: ' http://localhost:11434 ',
      config: {},
      createdAt: '2026-06-26T10:00:00.000Z',
      enabled: true,
      id: 'endpoint-1',
      isActive: true,
      name: ' Local ',
      updatedAt: '2026-06-26T10:00:01.000Z',
    });
    const install = normalizeAiModelInstall({
      activity: activityDto,
      model: {
        createdAt: '2026-06-26T10:00:00.000Z',
        discoveredAt: '2026-06-26T10:00:00.000Z',
        endpointId: 'endpoint-1',
        endpointName: ' Local ',
        id: 'model-1',
        installed: false,
        metadata: {},
        name: ' llama ',
        updatedAt: '2026-06-26T10:00:01.000Z',
      },
    });

    expect(endpoint).toMatchObject({
      baseUrl: 'http://localhost:11434',
      isActive: true,
      name: 'Local',
    });
    expect(install.activity.activityType).toBe('model_install');
    expect(install.model).toMatchObject({
      endpointName: 'Local',
      installed: false,
      name: 'llama',
    });
  });

  it('validates endpoint and model drafts', () => {
    expect(validateAiEndpointDraft({ baseUrl: '', name: 'Local' })).toBe(
      'La base URL e obbligatoria',
    );
    expect(validateAiEndpointDraft({ baseUrl: 'not-url', name: 'Local' })).toBe(
      'La base URL deve essere valida',
    );
    expect(
      validateAiEndpointDraft({ baseUrl: 'http://localhost:11434', name: 'Local' }),
    ).toBeNull();
    expect(validateAiModelName('')).toBe('Il nome modello e obbligatorio');
    expect(validateAiModelName('llama3.2')).toBeNull();
  });
});
