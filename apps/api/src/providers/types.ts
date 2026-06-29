/**
 * Provider-agnostic contracts.
 *
 * A provider plugin knows how to turn user-supplied credentials (typed manually
 * or extracted from a HAR) into the minimal session envelope persisted in
 * `provider_sessions.session_data`, how to summarise it without leaking
 * secrets, and optionally how to verify it against the live provider.
 *
 * Adding a new provider (e.g. Indeed) means implementing this interface and
 * registering it in `registry.ts` — no route or repository changes required.
 */

/** A single credential the user must supply for a provider. */
export interface CredentialField {
  /** Machine name, e.g. `li_at`. */
  name: string;
  /** Human label shown in the UI. */
  label: string;
  /** Secret fields are masked in the UI and never returned by the API. */
  secret: boolean;
  required: boolean;
  /** Short hint on where to find the value. */
  help?: string;
  placeholder?: string;
}

/**
 * What we persist for a session. Only `secrets` is sensitive; `fingerprint`
 * holds non-secret request hints used to look like a real browser.
 */
export interface ProviderSessionEnvelope {
  providerKey: string;
  version: number;
  source: 'manual' | 'har';
  importedAt: string;
  secrets: Record<string, string>;
  fingerprint: Record<string, string>;
  /** Optional non-secret debug payload (e.g. HAR request stats). */
  debug?: unknown;
}

export interface ProviderSessionVerification {
  alive: boolean;
  status: number | null;
  message: string | null;
}

export interface ProviderDescriptor {
  key: string;
  name: string;
  credentialFields: CredentialField[];
  supportsHarImport: boolean;
  supportsVerify: boolean;
}

export interface ProviderPlugin {
  key: string;
  name: string;
  credentialFields: CredentialField[];
  /** Build the persisted envelope from manually entered credentials. */
  buildSessionFromCredentials(input: Record<string, unknown>): ProviderSessionEnvelope;
  /** Convenience: extract the same minimal envelope from a full HAR. */
  buildSessionFromHar?(har: unknown): ProviderSessionEnvelope;
  /** Inspect a HAR without persisting or exposing secrets. */
  debugHar?(har: unknown): unknown;
  /** Render a secret-free summary of a persisted session. */
  summarizeSession(sessionData: unknown): unknown;
  /** Check the session against the live provider. */
  verifySession?(sessionData: unknown): Promise<ProviderSessionVerification>;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function describeProvider(plugin: ProviderPlugin): ProviderDescriptor {
  return {
    credentialFields: plugin.credentialFields,
    key: plugin.key,
    name: plugin.name,
    supportsHarImport: typeof plugin.buildSessionFromHar === 'function',
    supportsVerify: typeof plugin.verifySession === 'function',
  };
}
