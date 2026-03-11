import { describe, it, expect, beforeEach } from "vitest";
import {
  getAdapter,
  OuraAdapter,
  ProviderNotImplementedError,
} from "../adapters";
import type { DecryptedAuth } from "../adapter";

const MOCK_AUTH: DecryptedAuth = {
  accessToken: "mock_access_token",
  refreshToken: "mock_refresh_token",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  scopes: ["daily", "heartrate", "sleep"],
};

describe("Adapter Factory", () => {
  describe("getAdapter", () => {
    it("should return OuraAdapter for 'oura'", () => {
      const adapter = getAdapter("oura");
      expect(adapter).toBeDefined();
      expect(adapter.provider).toBe("oura");
      expect(adapter).toBeInstanceOf(OuraAdapter);
    });

    it("should return stub adapters for unimplemented providers", () => {
      const stubProviders = [
        "dexcom",
        "garmin",
        "whoop",
        "withings",
        "cronometer",
        "nutrisense",
      ];

      for (const providerId of stubProviders) {
        const adapter = getAdapter(providerId);
        expect(adapter).toBeDefined();
        expect(adapter.provider).toBe(providerId);
      }
    });

    it("should throw for unknown provider", () => {
      expect(() => getAdapter("unknown")).toThrow("Unknown provider: unknown");
    });

    it("should cache adapter instances (same reference)", () => {
      const adapter1 = getAdapter("oura");
      const adapter2 = getAdapter("oura");
      expect(adapter1).toBe(adapter2);
    });
  });
});

describe("Oura Adapter", () => {
  let adapter: OuraAdapter;

  beforeEach(() => {
    adapter = new OuraAdapter();
  });

  it("should have provider set to 'oura'", () => {
    expect(adapter.provider).toBe("oura");
  });

  describe("getAuthorizationUrl", () => {
    it("should return a valid Oura authorization URL", () => {
      const url = adapter.getAuthorizationUrl("user_123", "state_jwt_token");
      expect(url).toContain("https://cloud.ouraring.com/oauth/authorize");
      expect(url).toContain("state=state_jwt_token");
      expect(url).toContain("response_type=code");
    });
  });

  describe("exchangeCodeForTokens", () => {
    it("should return a mock token set", async () => {
      const tokens = await adapter.exchangeCodeForTokens("auth_code_123");
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
      expect(tokens.expiresAt).toBeInstanceOf(Date);
      expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(tokens.scopes.length).toBeGreaterThan(0);
    });
  });

  describe("refreshTokens", () => {
    it("should return a refreshed token set", async () => {
      const tokens = await adapter.refreshTokens(MOCK_AUTH);
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.accessToken).not.toBe(MOCK_AUTH.accessToken);
      expect(tokens.refreshToken).toBeTruthy();
    });

    it("should throw if no refresh token available", async () => {
      const authNoRefresh: DecryptedAuth = {
        ...MOCK_AUTH,
        refreshToken: undefined,
      };
      await expect(adapter.refreshTokens(authNoRefresh)).rejects.toThrow(
        "No refresh token available",
      );
    });
  });

  describe("revokeTokens", () => {
    it("should complete without error (mock)", async () => {
      await expect(adapter.revokeTokens(MOCK_AUTH)).resolves.toBeUndefined();
    });
  });

  describe("fetchDailyData", () => {
    it("should return daily data points for requested metrics", async () => {
      const result = await adapter.fetchDailyData(
        MOCK_AUTH,
        ["sleep_score", "hrv"],
        null,
      );

      expect(result.points.length).toBeGreaterThan(0);
      expect(result.nextCursor).toBeNull();

      const metricTypes = [...new Set(result.points.map((p) => p.metricType))];
      expect(metricTypes).toContain("sleep_score");
      expect(metricTypes).toContain("hrv");

      for (const point of result.points) {
        expect(point.source).toBe("oura");
        expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof point.value).toBe("number");
      }
    });

    it("should filter out non-Oura daily metrics", async () => {
      const result = await adapter.fetchDailyData(
        MOCK_AUTH,
        ["glucose"], // Dexcom-only metric
        null,
      );

      expect(result.points).toHaveLength(0);
    });

    it("should handle cursor-based pagination", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const cursor = yesterday.toISOString().split("T")[0]!;

      const result = await adapter.fetchDailyData(
        MOCK_AUTH,
        ["sleep_score"],
        cursor,
      );

      expect(result.points.length).toBeGreaterThan(0);
    });
  });

  describe("fetchSeriesData", () => {
    it("should return series readings for heart_rate", async () => {
      const result = await adapter.fetchSeriesData(
        MOCK_AUTH,
        ["heart_rate"],
        null,
      );

      expect(result.readings.length).toBeGreaterThan(0);
      expect(result.nextCursor).toBeNull();

      for (const reading of result.readings) {
        expect(reading.source).toBe("oura");
        expect(reading.metricType).toBe("heart_rate");
        expect(reading.recordedAt).toBeInstanceOf(Date);
        expect(typeof reading.value).toBe("number");
      }
    });

    it("should filter out non-Oura series metrics", async () => {
      const result = await adapter.fetchSeriesData(
        MOCK_AUTH,
        ["glucose"],
        null,
      );
      expect(result.readings).toHaveLength(0);
    });
  });

  describe("fetchPeriods", () => {
    it("should return sleep stage periods", async () => {
      const result = await adapter.fetchPeriods(
        MOCK_AUTH,
        ["sleep_stage"],
        null,
      );

      expect(result.periods.length).toBeGreaterThan(0);
      expect(result.nextCursor).toBeNull();

      for (const period of result.periods) {
        expect(period.source).toBe("oura");
        expect(period.eventType).toBe("sleep_stage");
        expect(period.subtype).toBeTruthy();
        expect(period.startedAt).toBeInstanceOf(Date);
        expect(period.endedAt).toBeInstanceOf(Date);
        expect(period.endedAt.getTime()).toBeGreaterThan(
          period.startedAt.getTime(),
        );
      }
    });

    it("should return workout periods with metadata", async () => {
      const result = await adapter.fetchPeriods(MOCK_AUTH, ["workout"], null);

      expect(result.periods.length).toBeGreaterThan(0);

      const workout = result.periods[0]!;
      expect(workout.eventType).toBe("workout");
      expect(workout.subtype).toBeTruthy();
      expect(workout.metadata).toBeDefined();
      expect(workout.metadata!.calories).toBeDefined();
    });

    it("should filter out non-Oura period types", async () => {
      const result = await adapter.fetchPeriods(MOCK_AUTH, ["meal"], null);
      expect(result.periods).toHaveLength(0);
    });
  });
});

describe("Stub Adapters", () => {
  const STUB_PROVIDERS = [
    "dexcom",
    "garmin",
    "whoop",
    "withings",
    "cronometer",
    "nutrisense",
  ];

  for (const providerId of STUB_PROVIDERS) {
    describe(`${providerId} stub`, () => {
      it("should throw ProviderNotImplementedError on getAuthorizationUrl", () => {
        const adapter = getAdapter(providerId);
        expect(() => adapter.getAuthorizationUrl("user_1", "state")).toThrow(
          ProviderNotImplementedError,
        );
        expect(() => adapter.getAuthorizationUrl("user_1", "state")).toThrow(
          `Provider '${providerId}' is not yet implemented`,
        );
      });

      it("should throw on exchangeCodeForTokens", async () => {
        const adapter = getAdapter(providerId);
        await expect(
          adapter.exchangeCodeForTokens("code"),
        ).rejects.toBeInstanceOf(ProviderNotImplementedError);
      });

      it("should throw on refreshTokens", async () => {
        const adapter = getAdapter(providerId);
        await expect(adapter.refreshTokens(MOCK_AUTH)).rejects.toBeInstanceOf(
          ProviderNotImplementedError,
        );
      });

      it("should throw on revokeTokens", async () => {
        const adapter = getAdapter(providerId);
        await expect(adapter.revokeTokens(MOCK_AUTH)).rejects.toBeInstanceOf(
          ProviderNotImplementedError,
        );
      });

      it("should throw on fetchDailyData", async () => {
        const adapter = getAdapter(providerId);
        await expect(
          adapter.fetchDailyData(MOCK_AUTH, ["sleep_score"], null),
        ).rejects.toBeInstanceOf(ProviderNotImplementedError);
      });

      it("should throw on fetchSeriesData", async () => {
        const adapter = getAdapter(providerId);
        await expect(
          adapter.fetchSeriesData(MOCK_AUTH, ["heart_rate"], null),
        ).rejects.toBeInstanceOf(ProviderNotImplementedError);
      });

      it("should throw on fetchPeriods", async () => {
        const adapter = getAdapter(providerId);
        await expect(
          adapter.fetchPeriods(MOCK_AUTH, ["sleep_stage"], null),
        ).rejects.toBeInstanceOf(ProviderNotImplementedError);
      });
    });
  }
});
