import { describe, expect, it } from 'vitest';

import {
  buildLinkedInCookieHeader,
  buildLinkedInSessionFromCredentials,
  buildLinkedInSessionFromHar,
  summarizeLinkedInSession,
} from '../src/providers/linkedin.js';
import { getProvider, listProviders } from '../src/providers/registry.js';

describe('LinkedIn minimal session', () => {
  it('builds a minimal envelope from manual credentials and strips JSESSIONID quotes', () => {
    const envelope = buildLinkedInSessionFromCredentials({
      jsessionid: '"ajax:123456"',
      li_at: 'AQEDtoken',
      userAgent: 'CustomUA/1.0',
    });

    expect(envelope.providerKey).toBe('linkedin');
    expect(envelope.source).toBe('manual');
    expect(envelope.secrets).toEqual({ jsessionid: 'ajax:123456', li_at: 'AQEDtoken' });
    expect(envelope.fingerprint).toEqual({ userAgent: 'CustomUA/1.0' });
  });

  it('requires both li_at and JSESSIONID', () => {
    expect(() => buildLinkedInSessionFromCredentials({ jsessionid: 'ajax:1' })).toThrow(/li_at/);
    expect(() => buildLinkedInSessionFromCredentials({ li_at: 'x' })).toThrow(/JSESSIONID/);
  });

  it('reconstructs the cookie header with quoted JSESSIONID', () => {
    expect(buildLinkedInCookieHeader('AQEDtoken', 'ajax:123')).toBe(
      'li_at=AQEDtoken; JSESSIONID="ajax:123"',
    );
  });

  it('summarises an envelope without leaking secrets', () => {
    const envelope = buildLinkedInSessionFromCredentials({
      jsessionid: 'ajax:123',
      li_at: 'AQEDtoken',
    });
    const summary = summarizeLinkedInSession(envelope) as Record<string, unknown>;

    expect(summary.hasLiAt).toBe(true);
    expect(summary.hasJsessionid).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('AQEDtoken');
  });

  it('summarises a legacy full-cookie session via fallback', () => {
    const legacy = {
      cookie: 'bcookie=x; li_at=AQEDlegacy; JSESSIONID="ajax:999"; lidc=b',
      csrfToken: 'ajax:999',
      importedAt: '2026-06-26T00:00:00.000Z',
    };
    const summary = summarizeLinkedInSession(legacy) as Record<string, unknown>;

    expect(summary.hasLiAt).toBe(true);
    expect(summary.hasJsessionid).toBe(true);
  });

  it('extracts the minimal envelope from a HAR job cards request', () => {
    const har = {
      log: {
        entries: [
          {
            request: {
              method: 'GET',
              url: 'https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards?count=7&decorationId=deco-1&q=jobSearch&query=(x)&start=0',
              headers: [
                {
                  name: 'cookie',
                  value: 'bcookie=x; li_at=AQEDfromhar; JSESSIONID="ajax:777"; lidc=z',
                },
                { name: 'csrf-token', value: 'ajax:777' },
                { name: 'user-agent', value: 'HarUA/2.0' },
                { name: 'x-li-lang', value: 'it_IT' },
              ],
            },
          },
        ],
      },
    };
    const envelope = buildLinkedInSessionFromHar(har);

    expect(envelope.source).toBe('har');
    expect(envelope.secrets).toEqual({ jsessionid: 'ajax:777', li_at: 'AQEDfromhar' });
    expect(envelope.fingerprint.userAgent).toBe('HarUA/2.0');
    expect(envelope.fingerprint.decorationId).toBe('deco-1');
  });

  it('rejects a HAR without a li_at cookie', () => {
    const har = {
      log: {
        entries: [
          {
            request: {
              method: 'GET',
              url: 'https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards?q=jobSearch',
              headers: [{ name: 'cookie', value: 'bcookie=x; JSESSIONID="ajax:1"' }],
            },
          },
        ],
      },
    };

    expect(() => buildLinkedInSessionFromHar(har)).toThrow(/li_at/);
  });
});

describe('provider registry', () => {
  it('exposes the LinkedIn plugin with its credential descriptor', () => {
    const plugin = getProvider('linkedin');
    expect(plugin?.name).toBe('LinkedIn');
    expect(plugin?.credentialFields.map((field) => field.name)).toContain('li_at');
    expect(plugin?.credentialFields.map((field) => field.name)).toContain('jsessionid');
  });

  it('registers additional providers (indeed) to prove modularity', () => {
    expect(listProviders().map((plugin) => plugin.key)).toEqual(
      expect.arrayContaining(['linkedin', 'indeed']),
    );
  });
});
