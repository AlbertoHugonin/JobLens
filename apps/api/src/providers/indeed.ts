import {
  ProviderError,
  type CredentialField,
  type ProviderPlugin,
  type ProviderSessionEnvelope,
} from './types.js';

/**
 * Skeleton plugin proving the provider abstraction is plug-and-play.
 *
 * It implements only the credential/session contract so the dynamic UI and the
 * registry work; actual search/collection is not implemented yet. To make
 * Indeed usable, add a `providers` seed row (provider_key = 'indeed') and a
 * worker-side collector, then flesh out the fields below from a real capture.
 */
export const INDEED_PROVIDER_KEY = 'indeed';
export const INDEED_PROVIDER_NAME = 'Indeed';
const SESSION_ENVELOPE_VERSION = 1;

export const INDEED_CREDENTIAL_FIELDS: CredentialField[] = [
  {
    help: 'Placeholder: cookie di sessione Indeed (da definire da una cattura reale).',
    label: 'Session cookie',
    name: 'cookie',
    placeholder: 'CTK=...; SOCK=...',
    required: true,
    secret: true,
  },
];

function readField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildSessionFromCredentials(input: Record<string, unknown>): ProviderSessionEnvelope {
  const cookie = readField(input, 'cookie');
  if (!cookie) {
    throw new ProviderError('Indeed session cookie is required');
  }

  return {
    fingerprint: {},
    importedAt: new Date().toISOString(),
    providerKey: INDEED_PROVIDER_KEY,
    secrets: { cookie },
    source: 'manual',
    version: SESSION_ENVELOPE_VERSION,
  };
}

function summarizeSession(sessionData: unknown): unknown {
  const data =
    typeof sessionData === 'object' && sessionData !== null
      ? (sessionData as Record<string, unknown>)
      : {};
  const secrets =
    typeof data.secrets === 'object' && data.secrets !== null
      ? (data.secrets as Record<string, unknown>)
      : {};

  return {
    hasCookie: typeof secrets.cookie === 'string' && secrets.cookie.length > 0,
    importedAt: typeof data.importedAt === 'string' ? data.importedAt : null,
    source: typeof data.source === 'string' ? data.source : null,
  };
}

export const indeedProvider: ProviderPlugin = {
  buildSessionFromCredentials,
  credentialFields: INDEED_CREDENTIAL_FIELDS,
  key: INDEED_PROVIDER_KEY,
  name: INDEED_PROVIDER_NAME,
  summarizeSession,
};
