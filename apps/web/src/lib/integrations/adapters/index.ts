/**
 * Adapter Factory
 *
 * Returns the appropriate ProviderAdapter for a given provider ID.
 * Oura has a full implementation; all others return stub adapters
 * that throw ProviderNotImplementedError.
 *
 * See: /docs/integrations-pipeline-lld.md §5, §6
 */

import type { ProviderAdapter } from "../adapter";
import { OuraAdapter } from "./oura";
import { createStubAdapter } from "./stub";

/**
 * Cached adapter instances (singletons).
 */
const adapterCache = new Map<string, ProviderAdapter>();

/**
 * Provider IDs that have full adapter implementations.
 */
const IMPLEMENTED_PROVIDERS = new Set(["oura"]);

/**
 * Provider IDs that have stub adapters (not yet implemented).
 */
const STUB_PROVIDERS = new Set([
  "dexcom",
  "garmin",
  "whoop",
  "withings",
  "cronometer",
  "nutrisense",
]);

/**
 * Get the ProviderAdapter for a given provider ID.
 *
 * @param providerId - The provider identifier (e.g., 'oura', 'dexcom')
 * @returns The corresponding ProviderAdapter instance
 * @throws Error if the provider ID is not recognized
 */
export function getAdapter(providerId: string): ProviderAdapter {
  const cached = adapterCache.get(providerId);
  if (cached) return cached;

  let adapter: ProviderAdapter;

  if (IMPLEMENTED_PROVIDERS.has(providerId)) {
    switch (providerId) {
      case "oura":
        adapter = new OuraAdapter();
        break;
      default:
        throw new Error(
          `No adapter implementation for provider: ${providerId}`,
        );
    }
  } else if (STUB_PROVIDERS.has(providerId)) {
    adapter = createStubAdapter(providerId);
  } else {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  adapterCache.set(providerId, adapter);
  return adapter;
}

// Re-export types and implementations for convenience
export { OuraAdapter } from "./oura";
export { createStubAdapter, ProviderNotImplementedError } from "./stub";
export type { ProviderAdapter } from "../adapter";
