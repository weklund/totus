/**
 * Oura Ring Provider Adapter
 *
 * Implements the full ProviderAdapter interface with mock/dev data generation.
 * In production, this would make real API calls to the Oura Ring API.
 * In development, it generates realistic synthetic health data.
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

/**
 * Metric definitions for mock daily data generation.
 */
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

/**
 * Generate a random value in range with given precision.
 */
function generateValue(min: number, max: number, decimals: number): number {
  const value = min + Math.random() * (max - min);
  return Number(value.toFixed(decimals));
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

/**
 * Default number of days to generate for mock sync.
 */
const DEFAULT_MOCK_DAYS = 7;

export class OuraAdapter implements ProviderAdapter {
  readonly provider = "oura";

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
    // Mock token exchange for development
    // In production, this would POST to Oura's token endpoint
    return {
      accessToken: `mock_oura_access_${code}_${Date.now()}`,
      refreshToken: `mock_oura_refresh_${code}_${Date.now()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      scopes: getProvider("oura")?.auth.scopes ?? [],
    };
  }

  async refreshTokens(auth: DecryptedAuth): Promise<TokenSet> {
    // Mock token refresh for development
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

  async revokeTokens(_auth: DecryptedAuth): Promise<void> {
    // Mock revoke — no-op in development
  }

  async fetchDailyData(
    _auth: DecryptedAuth,
    metrics: string[],
    cursor: string | null,
  ): Promise<DailyDataResult> {
    // Parse cursor to determine date range
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

    // Filter to valid Oura daily metrics
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
          userId: "", // Set by caller
          metricType,
          date: formatDate(currentDate),
          value: generateValue(range.min, range.max, range.decimals),
          source: "oura",
          sourceId: `oura_${metricType}_${formatDate(currentDate)}`,
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // No more data after today
    return {
      points,
      nextCursor: null,
    };
  }

  async fetchSeriesData(
    _auth: DecryptedAuth,
    metrics: string[],
    cursor: string | null,
  ): Promise<SeriesDataResult> {
    // Generate intraday readings (every 5 minutes for 1 day)
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
    const intervalMs = 5 * 60 * 1000; // 5 minutes

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
          userId: "", // Set by caller
          metricType,
          recordedAt: new Date(current),
          value,
          source: "oura",
          sourceId: `oura_${metricType}_${current.toISOString()}`,
        });
        current.setTime(current.getTime() + intervalMs);
      }
    }

    return {
      readings,
      nextCursor: null,
    };
  }

  async fetchPeriods(
    _auth: DecryptedAuth,
    eventTypes: string[],
    cursor: string | null,
  ): Promise<PeriodsResult> {
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
          // Generate a realistic sleep session with stages
          const bedtime = new Date(startDate);
          bedtime.setHours(23, 0, 0, 0);

          const stages: Array<{
            subtype: string;
            durationMin: number;
          }> = [
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
              userId: "", // Set by caller
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
          // Generate a workout session
          const workoutStart = new Date(startDate);
          workoutStart.setHours(7, 0, 0, 0);
          const workoutEnd = new Date(workoutStart.getTime() + 45 * 60 * 1000);

          periods.push({
            userId: "", // Set by caller
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

    return {
      periods,
      nextCursor: null,
    };
  }
}
