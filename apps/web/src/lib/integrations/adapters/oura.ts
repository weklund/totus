/**
 * Oura Ring Provider Adapter
 *
 * Implements the full ProviderAdapter interface with real HTTP calls
 * to the Oura API v2, plus mock/dev data generation fallback.
 *
 * See: /docs/integrations/oura.md
 * See: /docs/integrations-pipeline-lld.md §5, §6
 */

import { getProvider } from "@/config/providers";
import type {
  ProviderAdapter,
  TokenSet,
  DecryptedAuth,
  DailyDataPoint,
  DailyDataResult,
  SeriesReading,
  SeriesDataResult,
  PeriodEvent,
  PeriodsResult,
} from "../adapter";

// ─── Constants ──────────────────────────────────────────────

const OURA_BASE_URL = "https://api.ouraring.com";
const DEFAULT_MOCK_DAYS = 7;

/**
 * Workout sport_type mapping from Oura → Totus subtype.
 */
const SPORT_TYPE_MAP: Record<string, string> = {
  cycling: "cycle",
  running: "run",
  yoga: "yoga",
  swimming: "swim",
  weight_training: "strength",
};

/**
 * Sleep phase character → Totus subtype mapping.
 */
const SLEEP_PHASE_MAP: Record<string, string> = {
  "1": "deep",
  "2": "light",
  "3": "rem",
  "4": "awake",
};

// ─── Oura API response types ───────────────────────────────

interface OuraPaginatedResponse<T> {
  data: T[];
  next_token: string | null;
}

interface OuraDailySleep {
  id: string;
  day: string;
  score: number | null;
  contributors: {
    total_sleep: number | null;
    efficiency: number | null;
    hrv_balance: number | null;
    resting_heart_rate: number | null;
    [key: string]: unknown;
  };
}

interface OuraSleepRecord {
  id: string;
  day: string;
  bedtime_start: string;
  bedtime_end: string;
  latency: number | null;
  deep_sleep_duration: number | null;
  rem_sleep_duration: number | null;
  light_sleep_duration: number | null;
  awake_time: number | null;
  average_breath: number | null;
  temperature_deviation: number | null;
  sleep_phase_5_min: string | null;
  total_sleep_duration: number | null;
  type: string;
}

interface OuraDailyReadiness {
  id: string;
  day: string;
  score: number | null;
}

interface OuraDailyActivity {
  id: string;
  day: string;
  score: number | null;
  steps: number | null;
  active_calories: number | null;
  total_calories: number | null;
}

interface OuraDailySpo2 {
  id: string;
  day: string;
  spo2_percentage: {
    average: number | null;
  };
}

interface OuraHeartRate {
  bpm: number;
  source: string;
  timestamp: string;
}

interface OuraSpo2Reading {
  spo2_percentage: number | null;
  timestamp: string;
}

interface OuraWorkout {
  id: string;
  day: string;
  start_datetime: string;
  end_datetime: string;
  activity: string;
  sport: string;
  calories: number | null;
  distance: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
}

// ─── Mock data definitions ──────────────────────────────────

const DAILY_METRIC_RANGES: Record<
  string,
  { min: number; max: number; decimals: number }
> = {
  sleep_score: { min: 60, max: 95, decimals: 0 },
  sleep_duration: { min: 5.5, max: 9.0, decimals: 2 },
  sleep_efficiency: { min: 70, max: 98, decimals: 0 },
  sleep_latency: { min: 2, max: 30, decimals: 0 },
  deep_sleep: { min: 0.5, max: 2.5, decimals: 2 },
  rem_sleep: { min: 0.5, max: 2.5, decimals: 2 },
  light_sleep: { min: 2.0, max: 5.0, decimals: 2 },
  awake_time: { min: 5, max: 60, decimals: 0 },
  hrv: { min: 20, max: 80, decimals: 1 },
  rhr: { min: 50, max: 70, decimals: 0 },
  respiratory_rate: { min: 12.0, max: 20.0, decimals: 1 },
  spo2: { min: 94.0, max: 100.0, decimals: 1 },
  readiness_score: { min: 55, max: 98, decimals: 0 },
  activity_score: { min: 40, max: 100, decimals: 0 },
  steps: { min: 3000, max: 15000, decimals: 0 },
  active_calories: { min: 150, max: 800, decimals: 0 },
  total_calories: { min: 1800, max: 3500, decimals: 0 },
  body_temperature_deviation: { min: -0.5, max: 0.5, decimals: 2 },
};

// ─── Helpers ────────────────────────────────────────────────

function generateValue(min: number, max: number, decimals: number): number {
  const value = min + Math.random() * (max - min);
  return Number(value.toFixed(decimals));
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

/**
 * Determine which metrics from a requested set belong to a specific endpoint group.
 */
function filterMetrics(requested: string[], allowed: string[]): string[] {
  return requested.filter((m) => allowed.includes(m));
}

/**
 * Build a date range for API requests. Cursor is used as start_date for incremental syncs.
 * When no cursor, defaults to the provider's historicalWindowDays.
 */
function buildDateRange(cursor: string | null): {
  startDate: string;
  endDate: string;
} {
  const today = new Date();
  const endDate = formatDate(today);

  if (cursor) {
    return { startDate: cursor, endDate };
  }

  const config = getProvider("oura");
  const windowDays = config?.sync.historicalWindowDays ?? 30;
  const start = new Date();
  start.setDate(start.getDate() - windowDays);
  return { startDate: formatDate(start), endDate };
}

/**
 * Build a datetime range for series API requests.
 */
function buildDatetimeRange(cursor: string | null): {
  startDatetime: string;
  endDatetime: string;
} {
  const now = new Date();
  const endDatetime = now.toISOString();

  if (cursor) {
    return { startDatetime: new Date(cursor).toISOString(), endDatetime };
  }

  const config = getProvider("oura");
  const windowDays = config?.sync.historicalWindowDays ?? 30;
  const start = new Date();
  start.setDate(start.getDate() - windowDays);
  return { startDatetime: start.toISOString(), endDatetime };
}

// ─── API Error ──────────────────────────────────────────────

class OuraApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly retryAfter?: number,
  ) {
    super(`Oura API error: ${status} ${statusText}`);
    this.name = "OuraApiError";
  }
}

// ─── Adapter ────────────────────────────────────────────────

export class OuraAdapter implements ProviderAdapter {
  readonly provider = "oura";

  /**
   * Check whether we should use mock mode instead of real API calls.
   * Mock mode is active when:
   * - NEXT_PUBLIC_USE_MOCK_AUTH=true
   * - OURA_CLIENT_ID starts with "your-" or "test-"
   * - OURA_CLIENT_ID is not set
   */
  private get isMockMode(): boolean {
    if (process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true") return true;
    const clientId = process.env.OURA_CLIENT_ID;
    if (!clientId) return true;
    if (clientId.startsWith("your-") || clientId.startsWith("test-"))
      return true;
    return false;
  }

  // ─── Shared HTTP helper ─────────────────────────────────

  /**
   * Make an authenticated GET request to the Oura API.
   */
  private async ouraGet<T>(
    path: string,
    auth: DecryptedAuth,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(path, OURA_BASE_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const retryAfter = response.headers.get("Retry-After");
      throw new OuraApiError(
        response.status,
        response.statusText,
        retryAfter ? parseInt(retryAfter, 10) : undefined,
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Fetch a paginated Oura collection endpoint, collecting all pages.
   * Returns all data items and the final next_token (null when complete).
   */
  private async fetchAllPages<T>(
    path: string,
    auth: DecryptedAuth,
    baseParams: Record<string, string>,
  ): Promise<{ data: T[]; nextToken: string | null }> {
    const allData: T[] = [];
    let nextToken: string | null = null;
    const params = { ...baseParams };

    while (true) {
      const response = await this.ouraGet<OuraPaginatedResponse<T>>(
        path,
        auth,
        params,
      );

      if (response.data) {
        allData.push(...response.data);
      }

      nextToken = response.next_token ?? null;

      if (!nextToken) break;

      params.next_token = nextToken;
    }

    return { data: allData, nextToken };
  }

  // ─── Auth lifecycle ─────────────────────────────────────

  getAuthorizationUrl(userId: string, state: string): string {
    const config = getProvider("oura");
    if (!config?.auth.authorizeUrl) {
      throw new Error("Oura provider not configured");
    }

    const params = new URLSearchParams({
      client_id: process.env.OURA_CLIENT_ID || "mock_client_id",
      redirect_uri: config.auth.redirectUri,
      response_type: "code",
      state,
      scope: config.auth.scopes.join(" "),
    });

    return `${config.auth.authorizeUrl}?${params.toString()}`;
  }

  async exchangeCodeForTokens(
    code: string,
    _codeVerifier?: string,
  ): Promise<TokenSet> {
    if (this.isMockMode) return this.mockExchangeCodeForTokens(code);

    const config = getProvider("oura");
    if (!config?.auth.tokenUrl) {
      throw new Error("Oura token URL not configured");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.OURA_CLIENT_ID!,
      client_secret: process.env.OURA_CLIENT_SECRET!,
      redirect_uri: config.auth.redirectUri,
    });

    const response = await fetch(config.auth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Oura token exchange failed: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      scopes: data.scope ? data.scope.split(" ") : config.auth.scopes,
    };
  }

  async refreshTokens(auth: DecryptedAuth): Promise<TokenSet> {
    if (this.isMockMode) return this.mockRefreshTokens(auth);

    if (!auth.refreshToken) {
      throw new Error("No refresh token available for Oura connection");
    }

    const config = getProvider("oura");
    if (!config?.auth.tokenUrl) {
      throw new Error("Oura token URL not configured");
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
      client_id: process.env.OURA_CLIENT_ID!,
      client_secret: process.env.OURA_CLIENT_SECRET!,
    });

    const response = await fetch(config.auth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Oura token refresh failed: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      scopes: data.scope ? data.scope.split(" ") : auth.scopes,
    };
  }

  async revokeTokens(auth: DecryptedAuth): Promise<void> {
    if (this.isMockMode) return;

    const config = getProvider("oura");
    if (!config?.auth.revokeUrl) {
      // No revoke URL configured — nothing to do
      return;
    }

    const body = new URLSearchParams({
      token: auth.accessToken,
    });

    const response = await fetch(config.auth.revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    // Best-effort revocation — don't throw on failure
    if (!response.ok) {
      console.warn(
        `Oura token revocation returned ${response.status}: ${response.statusText}`,
      );
    }
  }

  // ─── Data fetching ──────────────────────────────────────

  async fetchDailyData(
    auth: DecryptedAuth,
    metrics: string[],
    cursor: string | null,
  ): Promise<DailyDataResult> {
    if (this.isMockMode) return this.mockFetchDailyData(metrics, cursor);

    const ouraConfig = getProvider("oura");
    const validMetrics = metrics.filter((m) =>
      ouraConfig?.sync.dailyMetrics.includes(m),
    );

    if (validMetrics.length === 0) {
      return { points: [], nextCursor: null };
    }

    const { startDate, endDate } = buildDateRange(cursor);
    const points: DailyDataPoint[] = [];

    // Metrics grouped by endpoint
    const dailySleepMetrics = filterMetrics(validMetrics, [
      "sleep_score",
      "sleep_duration",
      "sleep_efficiency",
      "hrv",
      "rhr",
    ]);

    const sleepMetrics = filterMetrics(validMetrics, [
      "sleep_latency",
      "deep_sleep",
      "rem_sleep",
      "light_sleep",
      "awake_time",
      "respiratory_rate",
      "body_temperature_deviation",
    ]);

    const readinessMetrics = filterMetrics(validMetrics, ["readiness_score"]);

    const activityMetrics = filterMetrics(validMetrics, [
      "activity_score",
      "steps",
      "active_calories",
      "total_calories",
    ]);

    const spo2Metrics = filterMetrics(validMetrics, ["spo2"]);

    const dateParams = { start_date: startDate, end_date: endDate };

    // Fetch all needed endpoints in parallel
    const [
      dailySleepResult,
      sleepResult,
      readinessResult,
      activityResult,
      spo2Result,
    ] = await Promise.all([
      dailySleepMetrics.length > 0
        ? this.fetchAllPages<OuraDailySleep>(
            "/v2/usercollection/daily_sleep",
            auth,
            dateParams,
          )
        : null,
      sleepMetrics.length > 0
        ? this.fetchAllPages<OuraSleepRecord>(
            "/v2/usercollection/sleep",
            auth,
            dateParams,
          )
        : null,
      readinessMetrics.length > 0
        ? this.fetchAllPages<OuraDailyReadiness>(
            "/v2/usercollection/daily_readiness",
            auth,
            dateParams,
          )
        : null,
      activityMetrics.length > 0
        ? this.fetchAllPages<OuraDailyActivity>(
            "/v2/usercollection/daily_activity",
            auth,
            dateParams,
          )
        : null,
      spo2Metrics.length > 0
        ? this.fetchAllPages<OuraDailySpo2>(
            "/v2/usercollection/daily_spo2",
            auth,
            dateParams,
          )
        : null,
    ]);

    // ── Process daily_sleep endpoint ──
    if (dailySleepResult) {
      for (const record of dailySleepResult.data) {
        const day = record.day;

        if (dailySleepMetrics.includes("sleep_score") && record.score != null) {
          points.push({
            userId: "",
            metricType: "sleep_score",
            date: day,
            value: record.score,
            source: "oura",
            sourceId: `oura_sleep_score_${record.id}`,
          });
        }

        if (
          dailySleepMetrics.includes("sleep_duration") &&
          record.contributors.total_sleep != null
        ) {
          points.push({
            userId: "",
            metricType: "sleep_duration",
            date: day,
            value: Number((record.contributors.total_sleep / 3600).toFixed(2)),
            source: "oura",
            sourceId: `oura_sleep_duration_${record.id}`,
          });
        }

        if (
          dailySleepMetrics.includes("sleep_efficiency") &&
          record.contributors.efficiency != null
        ) {
          points.push({
            userId: "",
            metricType: "sleep_efficiency",
            date: day,
            value: record.contributors.efficiency,
            source: "oura",
            sourceId: `oura_sleep_efficiency_${record.id}`,
          });
        }

        if (
          dailySleepMetrics.includes("hrv") &&
          record.contributors.hrv_balance != null
        ) {
          points.push({
            userId: "",
            metricType: "hrv",
            date: day,
            value: record.contributors.hrv_balance,
            source: "oura",
            sourceId: `oura_hrv_${record.id}`,
          });
        }

        if (
          dailySleepMetrics.includes("rhr") &&
          record.contributors.resting_heart_rate != null
        ) {
          points.push({
            userId: "",
            metricType: "rhr",
            date: day,
            value: record.contributors.resting_heart_rate,
            source: "oura",
            sourceId: `oura_rhr_${record.id}`,
          });
        }
      }
    }

    // ── Process sleep endpoint (detailed records) ──
    // Use the longest sleep session per day for daily summary metrics.
    if (sleepResult) {
      const longestByDay = this.getLongestSleepPerDay(sleepResult.data);

      for (const record of longestByDay) {
        const day = record.day;

        if (sleepMetrics.includes("sleep_latency") && record.latency != null) {
          points.push({
            userId: "",
            metricType: "sleep_latency",
            date: day,
            value: Math.round(record.latency / 60),
            source: "oura",
            sourceId: `oura_sleep_latency_${record.id}`,
          });
        }

        if (
          sleepMetrics.includes("deep_sleep") &&
          record.deep_sleep_duration != null
        ) {
          points.push({
            userId: "",
            metricType: "deep_sleep",
            date: day,
            value: Number((record.deep_sleep_duration / 3600).toFixed(2)),
            source: "oura",
            sourceId: `oura_deep_sleep_${record.id}`,
          });
        }

        if (
          sleepMetrics.includes("rem_sleep") &&
          record.rem_sleep_duration != null
        ) {
          points.push({
            userId: "",
            metricType: "rem_sleep",
            date: day,
            value: Number((record.rem_sleep_duration / 3600).toFixed(2)),
            source: "oura",
            sourceId: `oura_rem_sleep_${record.id}`,
          });
        }

        if (
          sleepMetrics.includes("light_sleep") &&
          record.light_sleep_duration != null
        ) {
          points.push({
            userId: "",
            metricType: "light_sleep",
            date: day,
            value: Number((record.light_sleep_duration / 3600).toFixed(2)),
            source: "oura",
            sourceId: `oura_light_sleep_${record.id}`,
          });
        }

        if (sleepMetrics.includes("awake_time") && record.awake_time != null) {
          points.push({
            userId: "",
            metricType: "awake_time",
            date: day,
            value: Math.round(record.awake_time / 60),
            source: "oura",
            sourceId: `oura_awake_time_${record.id}`,
          });
        }

        if (
          sleepMetrics.includes("respiratory_rate") &&
          record.average_breath != null
        ) {
          points.push({
            userId: "",
            metricType: "respiratory_rate",
            date: day,
            value: record.average_breath,
            source: "oura",
            sourceId: `oura_respiratory_rate_${record.id}`,
          });
        }

        if (
          sleepMetrics.includes("body_temperature_deviation") &&
          record.temperature_deviation != null
        ) {
          points.push({
            userId: "",
            metricType: "body_temperature_deviation",
            date: day,
            value: record.temperature_deviation,
            source: "oura",
            sourceId: `oura_body_temp_dev_${record.id}`,
          });
        }
      }
    }

    // ── Process daily_readiness endpoint ──
    if (readinessResult) {
      for (const record of readinessResult.data) {
        if (record.score != null) {
          points.push({
            userId: "",
            metricType: "readiness_score",
            date: record.day,
            value: record.score,
            source: "oura",
            sourceId: `oura_readiness_score_${record.id}`,
          });
        }
      }
    }

    // ── Process daily_activity endpoint ──
    if (activityResult) {
      for (const record of activityResult.data) {
        const day = record.day;

        if (
          activityMetrics.includes("activity_score") &&
          record.score != null
        ) {
          points.push({
            userId: "",
            metricType: "activity_score",
            date: day,
            value: record.score,
            source: "oura",
            sourceId: `oura_activity_score_${record.id}`,
          });
        }

        if (activityMetrics.includes("steps") && record.steps != null) {
          points.push({
            userId: "",
            metricType: "steps",
            date: day,
            value: record.steps,
            source: "oura",
            sourceId: `oura_steps_${record.id}`,
          });
        }

        if (
          activityMetrics.includes("active_calories") &&
          record.active_calories != null
        ) {
          points.push({
            userId: "",
            metricType: "active_calories",
            date: day,
            value: record.active_calories,
            source: "oura",
            sourceId: `oura_active_calories_${record.id}`,
          });
        }

        if (
          activityMetrics.includes("total_calories") &&
          record.total_calories != null
        ) {
          points.push({
            userId: "",
            metricType: "total_calories",
            date: day,
            value: record.total_calories,
            source: "oura",
            sourceId: `oura_total_calories_${record.id}`,
          });
        }
      }
    }

    // ── Process daily_spo2 endpoint ──
    if (spo2Result) {
      for (const record of spo2Result.data) {
        if (record.spo2_percentage?.average != null) {
          points.push({
            userId: "",
            metricType: "spo2",
            date: record.day,
            value: record.spo2_percentage.average,
            source: "oura",
            sourceId: `oura_spo2_${record.id}`,
          });
        }
      }
    }

    return { points, nextCursor: null };
  }

  async fetchSeriesData(
    auth: DecryptedAuth,
    metrics: string[],
    cursor: string | null,
  ): Promise<SeriesDataResult> {
    if (this.isMockMode) return this.mockFetchSeriesData(metrics, cursor);

    const ouraConfig = getProvider("oura");
    const validMetrics = metrics.filter((m) =>
      ouraConfig?.sync.seriesMetrics.includes(m),
    );

    if (validMetrics.length === 0) {
      return { readings: [], nextCursor: null };
    }

    const { startDatetime, endDatetime } = buildDatetimeRange(cursor);
    const readings: SeriesReading[] = [];

    const datetimeParams = {
      start_datetime: startDatetime,
      end_datetime: endDatetime,
    };

    // Fetch endpoints in parallel
    const [heartRateResult, spo2Result] = await Promise.all([
      validMetrics.includes("heart_rate")
        ? this.fetchAllPages<OuraHeartRate>(
            "/v2/usercollection/heartrate",
            auth,
            datetimeParams,
          )
        : null,
      validMetrics.includes("spo2_interval")
        ? this.fetchAllPages<OuraSpo2Reading>(
            "/v2/usercollection/spo2",
            auth,
            datetimeParams,
          )
        : null,
    ]);

    // ── Process heart rate series ──
    if (heartRateResult) {
      for (const reading of heartRateResult.data) {
        readings.push({
          userId: "",
          metricType: "heart_rate",
          recordedAt: new Date(reading.timestamp),
          value: reading.bpm,
          source: "oura",
          sourceId: `oura_hr_${reading.timestamp}`,
        });
      }
    }

    // ── Process SpO2 interval series ──
    if (spo2Result) {
      for (const reading of spo2Result.data) {
        if (reading.spo2_percentage != null) {
          readings.push({
            userId: "",
            metricType: "spo2_interval",
            recordedAt: new Date(reading.timestamp),
            value: reading.spo2_percentage,
            source: "oura",
            sourceId: `oura_spo2_interval_${reading.timestamp}`,
          });
        }
      }
    }

    return { readings, nextCursor: null };
  }

  async fetchPeriods(
    auth: DecryptedAuth,
    eventTypes: string[],
    cursor: string | null,
  ): Promise<PeriodsResult> {
    if (this.isMockMode) return this.mockFetchPeriods(eventTypes, cursor);

    const ouraConfig = getProvider("oura");
    const validTypes = eventTypes.filter((t) =>
      ouraConfig?.sync.periodTypes.includes(t),
    );

    if (validTypes.length === 0) {
      return { periods: [], nextCursor: null };
    }

    const { startDate, endDate } = buildDateRange(cursor);
    const dateParams = { start_date: startDate, end_date: endDate };
    const periods: PeriodEvent[] = [];

    // Fetch endpoints in parallel
    const [sleepResult, workoutResult] = await Promise.all([
      validTypes.includes("sleep_stage")
        ? this.fetchAllPages<OuraSleepRecord>(
            "/v2/usercollection/sleep",
            auth,
            dateParams,
          )
        : null,
      validTypes.includes("workout")
        ? this.fetchAllPages<OuraWorkout>(
            "/v2/usercollection/workout",
            auth,
            dateParams,
          )
        : null,
    ]);

    // ── Parse sleep stages from all sleep sessions ──
    if (sleepResult) {
      for (const record of sleepResult.data) {
        if (!record.sleep_phase_5_min || !record.bedtime_start) continue;

        const bedtimeStart = new Date(record.bedtime_start);
        const phases = record.sleep_phase_5_min;
        const fiveMin = 5 * 60 * 1000;

        let runStart = 0;
        let currentPhase: string | null = phases[0] ?? null;

        for (let i = 1; i <= phases.length; i++) {
          const phase: string | null =
            i < phases.length ? (phases[i] ?? null) : null;

          if (phase !== currentPhase) {
            // Emit the completed run
            if (currentPhase) {
              const subtype = SLEEP_PHASE_MAP[currentPhase];
              if (subtype) {
                const startedAt = new Date(
                  bedtimeStart.getTime() + runStart * fiveMin,
                );
                const endedAt = new Date(bedtimeStart.getTime() + i * fiveMin);

                periods.push({
                  userId: "",
                  eventType: "sleep_stage",
                  subtype,
                  startedAt,
                  endedAt,
                  source: "oura",
                  sourceId: `oura_sleep_stage_${record.id}_${runStart}`,
                });
              }
            }

            runStart = i;
            currentPhase = phase;
          }
        }
      }
    }

    // ── Parse workout periods ──
    if (workoutResult) {
      for (const record of workoutResult.data) {
        const subtype = SPORT_TYPE_MAP[record.sport] ?? "generic";

        const metadata: Record<string, unknown> = {
          sport_type_raw: record.sport,
        };
        if (record.calories != null) metadata.calories = record.calories;
        if (record.distance != null) metadata.distance_m = record.distance;
        if (record.average_heart_rate != null)
          metadata.avg_hr = record.average_heart_rate;
        if (record.max_heart_rate != null)
          metadata.max_hr = record.max_heart_rate;

        periods.push({
          userId: "",
          eventType: "workout",
          subtype,
          startedAt: new Date(record.start_datetime),
          endedAt: new Date(record.end_datetime),
          metadata,
          source: "oura",
          sourceId: `oura_workout_${record.id}`,
        });
      }
    }

    return { periods, nextCursor: null };
  }

  // ─── Helper: longest sleep per day ──────────────────────

  /**
   * Given multiple sleep records (possibly multiple per day, e.g. nap + nighttime),
   * return only the longest session per day for daily summary metrics.
   */
  private getLongestSleepPerDay(records: OuraSleepRecord[]): OuraSleepRecord[] {
    const byDay = new Map<string, OuraSleepRecord>();

    for (const record of records) {
      const existing = byDay.get(record.day);
      if (
        !existing ||
        (record.total_sleep_duration ?? 0) >
          (existing.total_sleep_duration ?? 0)
      ) {
        byDay.set(record.day, record);
      }
    }

    return Array.from(byDay.values());
  }

  // ─── Mock implementations ───────────────────────────────

  private mockExchangeCodeForTokens(code: string): TokenSet {
    return {
      accessToken: `mock_oura_access_${code}_${Date.now()}`,
      refreshToken: `mock_oura_refresh_${code}_${Date.now()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      scopes: getProvider("oura")?.auth.scopes ?? [],
    };
  }

  private mockRefreshTokens(auth: DecryptedAuth): TokenSet {
    if (!auth.refreshToken) {
      throw new Error("No refresh token available for Oura connection");
    }

    return {
      accessToken: `mock_oura_access_refreshed_${Date.now()}`,
      refreshToken: `mock_oura_refresh_refreshed_${Date.now()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      scopes: auth.scopes,
    };
  }

  private mockFetchDailyData(
    metrics: string[],
    cursor: string | null,
  ): DailyDataResult {
    const startDate = cursor
      ? new Date(cursor)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - DEFAULT_MOCK_DAYS);
          d.setHours(0, 0, 0, 0);
          return d;
        })();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const ouraConfig = getProvider("oura");
    const validMetrics = metrics.filter((m) =>
      ouraConfig?.sync.dailyMetrics.includes(m),
    );

    const points: DailyDataPoint[] = [];

    for (const metricType of validMetrics) {
      const range = DAILY_METRIC_RANGES[metricType];
      if (!range) continue;

      const currentDate = new Date(startDate);
      while (currentDate <= today) {
        points.push({
          userId: "",
          metricType,
          date: formatDate(currentDate),
          value: generateValue(range.min, range.max, range.decimals),
          source: "oura",
          sourceId: `oura_${metricType}_${formatDate(currentDate)}`,
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    return { points, nextCursor: null };
  }

  private mockFetchSeriesData(
    metrics: string[],
    cursor: string | null,
  ): SeriesDataResult {
    const startTime = cursor
      ? new Date(cursor)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          d.setHours(0, 0, 0, 0);
          return d;
        })();

    const endTime = new Date();
    endTime.setHours(0, 0, 0, 0);

    const ouraConfig = getProvider("oura");
    const validMetrics = metrics.filter((m) =>
      ouraConfig?.sync.seriesMetrics.includes(m),
    );

    const readings: SeriesReading[] = [];
    const intervalMs = 5 * 60 * 1000;

    for (const metricType of validMetrics) {
      let baseValue: number;
      let variance: number;

      switch (metricType) {
        case "heart_rate":
          baseValue = 72;
          variance = 15;
          break;
        case "spo2_interval":
          baseValue = 97.5;
          variance = 2;
          break;
        default:
          continue;
      }

      const current = new Date(startTime);
      while (current < endTime) {
        const value = Number(
          (baseValue + (Math.random() - 0.5) * 2 * variance).toFixed(1),
        );
        readings.push({
          userId: "",
          metricType,
          recordedAt: new Date(current),
          value,
          source: "oura",
          sourceId: `oura_${metricType}_${current.toISOString()}`,
        });
        current.setTime(current.getTime() + intervalMs);
      }
    }

    return { readings, nextCursor: null };
  }

  private mockFetchPeriods(
    eventTypes: string[],
    cursor: string | null,
  ): PeriodsResult {
    const startDate = cursor
      ? new Date(cursor)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          d.setHours(0, 0, 0, 0);
          return d;
        })();

    const ouraConfig = getProvider("oura");
    const validTypes = eventTypes.filter((t) =>
      ouraConfig?.sync.periodTypes.includes(t),
    );

    const periods: PeriodEvent[] = [];

    for (const eventType of validTypes) {
      switch (eventType) {
        case "sleep_stage": {
          const bedtime = new Date(startDate);
          bedtime.setHours(23, 0, 0, 0);

          const stages: Array<{ subtype: string; durationMin: number }> = [
            { subtype: "light", durationMin: 20 },
            { subtype: "deep", durationMin: 45 },
            { subtype: "light", durationMin: 30 },
            { subtype: "rem", durationMin: 25 },
            { subtype: "light", durationMin: 20 },
            { subtype: "deep", durationMin: 40 },
            { subtype: "rem", durationMin: 30 },
            { subtype: "light", durationMin: 25 },
            { subtype: "awake", durationMin: 10 },
            { subtype: "light", durationMin: 15 },
            { subtype: "rem", durationMin: 20 },
          ];

          let currentTime = new Date(bedtime);
          for (const stage of stages) {
            const endTime = new Date(
              currentTime.getTime() + stage.durationMin * 60 * 1000,
            );
            periods.push({
              userId: "",
              eventType: "sleep_stage",
              subtype: stage.subtype,
              startedAt: new Date(currentTime),
              endedAt: endTime,
              source: "oura",
              sourceId: `oura_sleep_${currentTime.toISOString()}`,
            });
            currentTime = endTime;
          }
          break;
        }
        case "workout": {
          const workoutStart = new Date(startDate);
          workoutStart.setHours(7, 0, 0, 0);
          const workoutEnd = new Date(workoutStart.getTime() + 45 * 60 * 1000);

          periods.push({
            userId: "",
            eventType: "workout",
            subtype: "run",
            startedAt: workoutStart,
            endedAt: workoutEnd,
            metadata: {
              calories: generateValue(300, 600, 0),
              distance_m: generateValue(3000, 8000, 0),
              avg_hr: generateValue(130, 160, 0),
              max_hr: generateValue(165, 190, 0),
            },
            source: "oura",
            sourceId: `oura_workout_${workoutStart.toISOString()}`,
          });
          break;
        }
      }
    }

    return { periods, nextCursor: null };
  }
}
