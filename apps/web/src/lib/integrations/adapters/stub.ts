/**
 * Stub Provider Adapter
 *
 * Generic stub adapter for providers that are not yet fully implemented.
 * All methods throw a 'Provider not yet implemented' error.
 *
 * Used for: dexcom, garmin, whoop, withings, cronometer, nutrisense
 *
 * See: /docs/integrations-pipeline-lld.md §6
 */

import type {
  ProviderAdapter,
  TokenSet,
  DecryptedAuth,
  DailyDataResult,
  SeriesDataResult,
  PeriodsResult,
} from "../adapter";

/**
 * Error thrown by stub adapters to indicate the provider is not yet implemented.
 */
export class ProviderNotImplementedError extends Error {
  constructor(provider: string, method: string) {
    super(`Provider '${provider}' is not yet implemented. Method: ${method}`);
    this.name = "ProviderNotImplementedError";
  }
}

/**
 * Creates a stub adapter for a provider that is not yet implemented.
 * All methods throw ProviderNotImplementedError.
 */
export function createStubAdapter(providerId: string): ProviderAdapter {
  return {
    provider: providerId,

    getAuthorizationUrl(_userId: string, _state: string): string {
      throw new ProviderNotImplementedError(providerId, "getAuthorizationUrl");
    },

    async exchangeCodeForTokens(
      _code: string,
      _codeVerifier?: string,
    ): Promise<TokenSet> {
      throw new ProviderNotImplementedError(
        providerId,
        "exchangeCodeForTokens",
      );
    },

    async refreshTokens(_auth: DecryptedAuth): Promise<TokenSet> {
      throw new ProviderNotImplementedError(providerId, "refreshTokens");
    },

    async revokeTokens(_auth: DecryptedAuth): Promise<void> {
      throw new ProviderNotImplementedError(providerId, "revokeTokens");
    },

    async fetchDailyData(
      _auth: DecryptedAuth,
      _metrics: string[],
      _cursor: string | null,
    ): Promise<DailyDataResult> {
      throw new ProviderNotImplementedError(providerId, "fetchDailyData");
    },

    async fetchSeriesData(
      _auth: DecryptedAuth,
      _metrics: string[],
      _cursor: string | null,
    ): Promise<SeriesDataResult> {
      throw new ProviderNotImplementedError(providerId, "fetchSeriesData");
    },

    async fetchPeriods(
      _auth: DecryptedAuth,
      _eventTypes: string[],
      _cursor: string | null,
    ): Promise<PeriodsResult> {
      throw new ProviderNotImplementedError(providerId, "fetchPeriods");
    },
  };
}
