import { linkedInProvider } from './linkedin.js';
import { ProviderError, type ProviderPlugin } from './types.js';

// Providers are pluggable (see docs/PROVIDERS.md). LinkedIn is the only one
// implemented end-to-end today; register additional plugins here as they ship.
const providers = new Map<string, ProviderPlugin>();

function register(plugin: ProviderPlugin): void {
  providers.set(plugin.key, plugin);
}

register(linkedInProvider);

export function getProvider(key: string): ProviderPlugin | undefined {
  return providers.get(key);
}

export function requireProvider(key: string): ProviderPlugin {
  const plugin = providers.get(key);
  if (!plugin) {
    throw new ProviderError(`Unknown provider: ${key}`);
  }

  return plugin;
}

export function listProviders(): ProviderPlugin[] {
  return [...providers.values()];
}

export function summarizeProviderSession(providerKey: string, sessionData: unknown): unknown {
  const plugin = providers.get(providerKey);
  return plugin ? plugin.summarizeSession(sessionData) : {};
}
