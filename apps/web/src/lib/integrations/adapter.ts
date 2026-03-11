/**
 * Provider Adapter Interface
 *
 * All health data provider adapters implement this interface.
 * The interface is the normalization contract: adapters handle unit conversion,
 * field mapping, and pagination. Calling code never parses raw provider responses.
 *
 * See: /docs/integrations-pipeline-lld.md §5
 */

/**
 * OAuth token set returned from token exchange or refresh.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

/**
 * Decrypted auth credentials extracted from provider_connections.auth_enc.
 */
export interface DecryptedAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

/**
 * A single daily aggregate data point (one per user/metric/date).
 */
export interface DailyDataPoint {
  /** User ID this data belongs to */
  userId: string;
  /** Must be a valid metric_type ID from the taxonomy */
  metricType: string;
  /** ISO 8601 date: 'YYYY-MM-DD' */
  date: string;
  /** Numeric value in canonical Totus units (adapter applies conversion) */
  value: number;
  /** Provider ID: 'oura', 'garmin', etc. */
  source: string;
  /** Provider's own record ID for deduplication */
  sourceId?: string;
}

/**
 * A single intraday series reading (e.g., CGM glucose, heart rate).
 */
export interface SeriesReading {
  userId: string;
  metricType: string;
  /** UTC timestamp of the reading */
  recordedAt: Date;
  /** Value in canonical Totus units */
  value: number;
  source: string;
  sourceId?: string;
}

/**
 * A bounded-duration event (e.g., sleep stage, workout, meal).
 */
export interface PeriodEvent {
  userId: string;
  /** Event type: 'sleep_stage', 'workout', 'meal' */
  eventType: string;
  /** Subtype: 'rem', 'deep', 'light', 'awake', 'run', etc. */
  subtype?: string;
  startedAt: Date;
  endedAt: Date;
  /** Unencrypted metadata; will be encrypted before storage */
  metadata?: Record<string, unknown>;
  source: string;
  sourceId?: string;
}

/**
 * Result of a paginated daily data fetch.
 */
export interface DailyDataResult {
  points: DailyDataPoint[];
  /** null = no more pages */
  nextCursor: string | null;
}

/**
 * Result of a paginated series data fetch.
 */
export interface SeriesDataResult {
  readings: SeriesReading[];
  /** null = no more pages */
  nextCursor: string | null;
}

/**
 * Result of a paginated periods fetch.
 */
export interface PeriodsResult {
  periods: PeriodEvent[];
  /** null = no more pages */
  nextCursor: string | null;
}

/**
 * Unified provider adapter interface.
 *
 * All adapters must:
 * 1. Convert values to Totus canonical units before returning
 * 2. Return timestamps as UTC Date objects
 * 3. Return sourceId when the provider supplies a stable record ID
 * 4. Never return partial pages — throw on mid-page failures for Inngest retry
 */
export interface ProviderAdapter {
  /** Must match ProviderConfig.id */
  readonly provider: string;

  // ─── Auth lifecycle ─────────────────────────────────────

  /**
   * Build the OAuth authorization URL for the provider.
   * @param userId - The Totus user ID initiating the connection
   * @param state - Signed JWT state parameter for CSRF protection
   */
  getAuthorizationUrl(userId: string, state: string): string;

  /**
   * Exchange an authorization code for access and refresh tokens.
   * @param code - Authorization code from provider callback
   * @param codeVerifier - PKCE code verifier (for oauth2_with_pkce providers)
   */
  exchangeCodeForTokens(code: string, codeVerifier?: string): Promise<TokenSet>;

  /**
   * Refresh expired OAuth tokens.
   * Caller handles decryption of stored auth before calling.
   * @param auth - Decrypted auth credentials
   */
  refreshTokens(auth: DecryptedAuth): Promise<TokenSet>;

  /**
   * Revoke all tokens for a connection.
   * @param auth - Decrypted auth credentials
   */
  revokeTokens(auth: DecryptedAuth): Promise<void>;

  // ─── Data fetching ──────────────────────────────────────

  /**
   * Fetch daily aggregate data points.
   * @param auth - Decrypted auth credentials
   * @param metrics - Metric type IDs to fetch
   * @param cursor - Pagination cursor (null = start from historicalWindowDays)
   */
  fetchDailyData(
    auth: DecryptedAuth,
    metrics: string[],
    cursor: string | null,
  ): Promise<DailyDataResult>;

  /**
   * Fetch intraday series readings.
   * @param auth - Decrypted auth credentials
   * @param metrics - Series metric type IDs to fetch
   * @param cursor - Pagination cursor (null = start from historicalWindowDays)
   */
  fetchSeriesData(
    auth: DecryptedAuth,
    metrics: string[],
    cursor: string | null,
  ): Promise<SeriesDataResult>;

  /**
   * Fetch bounded-duration period events.
   * @param auth - Decrypted auth credentials
   * @param eventTypes - Period event type IDs to fetch
   * @param cursor - Pagination cursor (null = start from historicalWindowDays)
   */
  fetchPeriods(
    auth: DecryptedAuth,
    eventTypes: string[],
    cursor: string | null,
  ): Promise<PeriodsResult>;
}
