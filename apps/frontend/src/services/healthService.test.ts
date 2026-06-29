import { describe, expect, it } from 'vitest';

import { normalizeApiHealth } from './healthService';

describe('normalizeApiHealth', () => {
  it('normalizes API health DTOs for the UI', () => {
    const health = normalizeApiHealth({
      service: ' api ',
      status: 'ok',
      version: ' 0.0.0 ',
      uptimeSeconds: 3,
      timestamp: '2026-06-25T00:00:00.000Z',
    });

    expect(health).toMatchObject({
      name: 'api',
      status: 'ok',
      uptimeSeconds: 3,
      version: '0.0.0',
    });
  });
});
