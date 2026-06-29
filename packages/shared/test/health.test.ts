import { describe, expect, it } from 'vitest';

import { API_VERSION, type HealthResponseDto } from '../src/index.js';

describe('shared health contracts', () => {
  it('exports the API version used by service contracts', () => {
    expect(API_VERSION).toBe('v1');
  });

  it('allows a minimal service health DTO', () => {
    const dto: HealthResponseDto = {
      service: 'api',
      status: 'ok',
      version: '0.0.0',
      uptimeSeconds: 1,
      timestamp: new Date('2026-06-25T00:00:00.000Z').toISOString(),
    };

    expect(dto.status).toBe('ok');
  });
});
