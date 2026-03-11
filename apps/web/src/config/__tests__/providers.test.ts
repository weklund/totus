import { describe, it, expect } from "vitest";
import {
  getProvider,
  getAllProviders,
  isValidProvider,
  PROVIDER_IDS,
  type ProviderId,
} from "@/config/providers";

const EXPECTED_PROVIDER_IDS: ProviderId[] = [
  "oura",
  "dexcom",
  "garmin",
  "whoop",
  "withings",
  "cronometer",
  "nutrisense",
];

describe("Provider Registry", () => {
  describe("completeness", () => {
    it("should have all 7 providers", () => {
      const providers = getAllProviders();
      expect(providers).toHaveLength(7);
    });

    it("should contain all expected provider IDs", () => {
      const ids = getAllProviders().map((p) => p.id);
      for (const expected of EXPECTED_PROVIDER_IDS) {
        expect(ids).toContain(expected);
      }
    });

    it("PROVIDER_IDS should match all providers", () => {
      expect(PROVIDER_IDS).toHaveLength(7);
      for (const expected of EXPECTED_PROVIDER_IDS) {
        expect(PROVIDER_IDS).toContain(expected);
      }
    });
  });

  describe("provider config structure", () => {
    it("every provider should have required fields", () => {
      const providers = getAllProviders();

      for (const provider of providers) {
        expect(provider.id).toBeTruthy();
        expect(provider.displayName).toBeTruthy();
        expect(provider.authType).toBeTruthy();
        expect(provider.auth).toBeDefined();
        expect(provider.auth.scopes).toBeDefined();
        expect(provider.auth.redirectUri).toBeTruthy();
        expect(provider.rateLimit).toBeDefined();
        expect(provider.rateLimit.requestsPerWindow).toBeGreaterThan(0);
        expect(provider.sync).toBeDefined();
        expect(provider.apiVersion).toBeTruthy();
        expect(provider.changelogUrl).toBeTruthy();
      }
    });

    it("every provider should have valid authType", () => {
      const validTypes = ["oauth2", "pkce", "api_key", "file_import"];
      const providers = getAllProviders();

      for (const provider of providers) {
        expect(validTypes).toContain(provider.authType);
      }
    });

    it("every provider should have sync config arrays", () => {
      const providers = getAllProviders();

      for (const provider of providers) {
        expect(Array.isArray(provider.sync.dailyMetrics)).toBe(true);
        expect(Array.isArray(provider.sync.seriesMetrics)).toBe(true);
        expect(Array.isArray(provider.sync.periodTypes)).toBe(true);
        expect(provider.sync.historicalWindowDays).toBeGreaterThan(0);
        expect(provider.sync.defaultSyncIntervalHours).toBeGreaterThan(0);
      }
    });
  });

  describe("getProvider", () => {
    it("should return config for each valid provider", () => {
      for (const id of EXPECTED_PROVIDER_IDS) {
        const provider = getProvider(id);
        expect(provider).toBeDefined();
        expect(provider!.id).toBe(id);
      }
    });

    it("should return undefined for unknown provider", () => {
      expect(getProvider("unknown")).toBeUndefined();
      expect(getProvider("")).toBeUndefined();
    });
  });

  describe("isValidProvider", () => {
    it("should return true for valid providers", () => {
      for (const id of EXPECTED_PROVIDER_IDS) {
        expect(isValidProvider(id)).toBe(true);
      }
    });

    it("should return false for invalid providers", () => {
      expect(isValidProvider("unknown")).toBe(false);
      expect(isValidProvider("")).toBe(false);
      expect(isValidProvider("OURA")).toBe(false);
    });
  });

  describe("specific provider configs", () => {
    it("oura should be OAuth2 with daily, series, and period metrics", () => {
      const oura = getProvider("oura")!;
      expect(oura.displayName).toBe("Oura Ring");
      expect(oura.authType).toBe("oauth2");
      expect(oura.sync.dailyMetrics.length).toBeGreaterThan(10);
      expect(oura.sync.seriesMetrics).toContain("heart_rate");
      expect(oura.sync.periodTypes).toContain("sleep_stage");
      expect(oura.sync.periodTypes).toContain("workout");
    });

    it("dexcom should have series-only glucose data", () => {
      const dexcom = getProvider("dexcom")!;
      expect(dexcom.displayName).toBe("Dexcom CGM");
      expect(dexcom.sync.dailyMetrics).toHaveLength(0);
      expect(dexcom.sync.seriesMetrics).toContain("glucose");
      expect(dexcom.sync.historicalWindowDays).toBe(90);
    });

    it("whoop should use OAuth2 PKCE", () => {
      const whoop = getProvider("whoop")!;
      expect(whoop.authType).toBe("pkce");
      expect(whoop.displayName).toBe("WHOOP");
    });

    it("withings should have body composition metrics only", () => {
      const withings = getProvider("withings")!;
      expect(withings.sync.dailyMetrics).toContain("weight");
      expect(withings.sync.seriesMetrics).toHaveLength(0);
      expect(withings.sync.periodTypes).toHaveLength(0);
    });

    it("cronometer should have nutrition metrics and meal periods", () => {
      const cronometer = getProvider("cronometer")!;
      expect(cronometer.sync.dailyMetrics).toContain("calories_consumed");
      expect(cronometer.sync.periodTypes).toContain("meal");
    });

    it("nutrisense should have series glucose data", () => {
      const nutrisense = getProvider("nutrisense")!;
      expect(nutrisense.sync.seriesMetrics).toContain("glucose");
      expect(nutrisense.sync.dailyMetrics).toHaveLength(0);
    });
  });
});
