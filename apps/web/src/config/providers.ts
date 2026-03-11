/**
 * Provider Registry
 *
 * Static configuration for all supported health data providers.
 * Each provider ships its config alongside its adapter implementation.
 *
 * See: /docs/integrations-pipeline-lld.md §2
 */

/**
 * Authentication types supported by providers.
 */
export type AuthType = "oauth2" | "pkce" | "api_key" | "file_import";

/**
 * Provider identifier type.
 */
export type ProviderId =
  | "oura"
  | "dexcom"
  | "garmin"
  | "whoop"
  | "withings"
  | "cronometer"
  | "nutrisense";

/**
 * Static configuration for a health data provider.
 */
export interface ProviderConfig {
  /** Unique provider identifier */
  id: ProviderId;
  /** Human-readable display name */
  displayName: string;
  /** Authentication mechanism */
  authType: AuthType;
  /** OAuth / auth details */
  auth: {
    authorizeUrl?: string;
    tokenUrl?: string;
    revokeUrl?: string;
    scopes: string[];
    redirectUri: string;
  };
  /** Rate limiting configuration for the provider's API */
  rateLimit: {
    requestsPerWindow: number;
    windowSeconds: number;
    respectRetryAfter: boolean;
  };
  /** Sync configuration */
  sync: {
    dailyMetrics: string[];
    seriesMetrics: string[];
    periodTypes: string[];
    historicalWindowDays: number;
    defaultSyncIntervalHours: number;
    correctionWindowDays: number;
  };
  /** Provider API version string */
  apiVersion: string;
  /** URL to the provider's API changelog */
  changelogUrl: string;
}

// ─── Provider Configurations ────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const oura: ProviderConfig = {
  id: "oura",
  displayName: "Oura Ring",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://cloud.ouraring.com/oauth/authorize",
    tokenUrl: "https://api.ouraring.com/oauth/token",
    revokeUrl: "https://api.ouraring.com/oauth/revoke",
    scopes: [
      "daily",
      "heartrate",
      "workout",
      "tag",
      "session",
      "sleep",
      "spo2",
    ],
    redirectUri: `${APP_URL}/api/connections/oura/callback`,
  },
  rateLimit: {
    requestsPerWindow: 5000,
    windowSeconds: 300,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "sleep_score",
      "sleep_duration",
      "sleep_efficiency",
      "sleep_latency",
      "deep_sleep",
      "rem_sleep",
      "light_sleep",
      "awake_time",
      "hrv",
      "rhr",
      "respiratory_rate",
      "spo2",
      "readiness_score",
      "activity_score",
      "steps",
      "active_calories",
      "total_calories",
      "body_temperature_deviation",
    ],
    seriesMetrics: ["heart_rate", "spo2_interval"],
    periodTypes: ["sleep_stage", "workout"],
    historicalWindowDays: 3650,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 3,
  },
  apiVersion: "v2",
  changelogUrl: "https://cloud.ouraring.com/docs/changelog",
};

const dexcom: ProviderConfig = {
  id: "dexcom",
  displayName: "Dexcom CGM",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://api.dexcom.com/v3/oauth2/login",
    tokenUrl: "https://api.dexcom.com/v3/oauth2/token",
    revokeUrl: undefined,
    scopes: ["offline_access"],
    redirectUri: `${APP_URL}/api/connections/dexcom/callback`,
  },
  rateLimit: {
    requestsPerWindow: 1000,
    windowSeconds: 300,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [],
    seriesMetrics: ["glucose"],
    periodTypes: [],
    historicalWindowDays: 90,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 0,
  },
  apiVersion: "v3",
  changelogUrl: "https://developer.dexcom.com/changelog",
};

const garmin: ProviderConfig = {
  id: "garmin",
  displayName: "Garmin Connect",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://connect.garmin.com/oauthConfirm",
    tokenUrl: "https://connectapi.garmin.com/oauth-service/oauth/token",
    revokeUrl: undefined,
    scopes: [],
    redirectUri: `${APP_URL}/api/connections/garmin/callback`,
  },
  rateLimit: {
    requestsPerWindow: 200,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "sleep_duration",
      "sleep_efficiency",
      "deep_sleep",
      "rem_sleep",
      "light_sleep",
      "awake_time",
      "hrv",
      "rhr",
      "spo2",
      "steps",
      "active_calories",
      "total_calories",
      "weight",
      "bmi",
      "body_fat_pct",
      "muscle_mass_kg",
      "bone_mass_kg",
    ],
    seriesMetrics: ["heart_rate", "spo2_interval"],
    periodTypes: ["sleep_stage", "workout"],
    historicalWindowDays: 365,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 1,
  },
  apiVersion: "v1",
  changelogUrl: "https://developer.garmin.com/health-api/changelog/",
};

const whoop: ProviderConfig = {
  id: "whoop",
  displayName: "WHOOP",
  authType: "pkce",
  auth: {
    authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
    tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
    revokeUrl: "https://api.prod.whoop.com/oauth/oauth2/revoke",
    scopes: [
      "read:recovery",
      "read:cycles",
      "read:sleep",
      "read:workout",
      "read:body_measurement",
    ],
    redirectUri: `${APP_URL}/api/connections/whoop/callback`,
  },
  rateLimit: {
    requestsPerWindow: 100,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "sleep_score",
      "sleep_duration",
      "sleep_efficiency",
      "deep_sleep",
      "rem_sleep",
      "light_sleep",
      "awake_time",
      "hrv",
      "rhr",
      "respiratory_rate",
      "readiness_score",
      "active_calories",
    ],
    seriesMetrics: ["heart_rate"],
    periodTypes: ["sleep_stage", "workout"],
    historicalWindowDays: 3650,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 1,
  },
  apiVersion: "v1",
  changelogUrl: "https://developer.whoop.com/changelog",
};

const withings: ProviderConfig = {
  id: "withings",
  displayName: "Withings Health Mate",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://account.withings.com/oauth2_user/authorize2",
    tokenUrl: "https://wbsapi.withings.net/v2/oauth2",
    revokeUrl: undefined,
    scopes: ["user.metrics", "user.activity"],
    redirectUri: `${APP_URL}/api/connections/withings/callback`,
  },
  rateLimit: {
    requestsPerWindow: 120,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "weight",
      "bmi",
      "body_fat_pct",
      "muscle_mass_kg",
      "bone_mass_kg",
      "hydration_kg",
      "visceral_fat_index",
    ],
    seriesMetrics: [],
    periodTypes: [],
    historicalWindowDays: 3650,
    defaultSyncIntervalHours: 12,
    correctionWindowDays: 0,
  },
  apiVersion: "v2",
  changelogUrl: "https://developer.withings.com/api-reference",
};

const cronometer: ProviderConfig = {
  id: "cronometer",
  displayName: "Cronometer",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://cronometer.com/oauth/authorize",
    tokenUrl: "https://cronometer.com/oauth/token",
    revokeUrl: undefined,
    scopes: ["diary:read", "profile:read"],
    redirectUri: `${APP_URL}/api/connections/cronometer/callback`,
  },
  rateLimit: {
    requestsPerWindow: 60,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "calories_consumed",
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
      "sugar_g",
      "saturated_fat_g",
      "sodium_mg",
      "potassium_mg",
      "calcium_mg",
      "iron_mg",
      "magnesium_mg",
      "zinc_mg",
      "vitamin_a_mcg",
      "vitamin_c_mg",
      "vitamin_d_mcg",
      "vitamin_b12_mcg",
      "folate_mcg",
    ],
    seriesMetrics: [],
    periodTypes: ["meal"],
    historicalWindowDays: 3650,
    defaultSyncIntervalHours: 12,
    correctionWindowDays: 1,
  },
  apiVersion: "v1",
  changelogUrl: "https://cronometer.com/developer",
};

const nutrisense: ProviderConfig = {
  id: "nutrisense",
  displayName: "Nutrisense",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://app.nutrisense.io/oauth/authorize",
    tokenUrl: "https://app.nutrisense.io/oauth/token",
    revokeUrl: undefined,
    scopes: ["read:glucose"],
    redirectUri: `${APP_URL}/api/connections/nutrisense/callback`,
  },
  rateLimit: {
    requestsPerWindow: 100,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [],
    seriesMetrics: ["glucose"],
    periodTypes: [],
    historicalWindowDays: 365,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 0,
  },
  apiVersion: "v1",
  changelogUrl: "https://nutrisense.io/developer",
};

// ─── Provider Registry ──────────────────────────────────────

const PROVIDER_REGISTRY: ReadonlyMap<ProviderId, ProviderConfig> = new Map<
  ProviderId,
  ProviderConfig
>([
  ["oura", oura],
  ["dexcom", dexcom],
  ["garmin", garmin],
  ["whoop", whoop],
  ["withings", withings],
  ["cronometer", cronometer],
  ["nutrisense", nutrisense],
]);

/**
 * All valid provider IDs.
 */
export const PROVIDER_IDS: readonly ProviderId[] = Object.freeze(
  Array.from(PROVIDER_REGISTRY.keys()),
);

/**
 * Get a provider configuration by its ID.
 * Returns undefined if the provider is not registered.
 */
export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDER_REGISTRY.get(id as ProviderId);
}

/**
 * Get all registered provider configurations.
 */
export function getAllProviders(): ProviderConfig[] {
  return Array.from(PROVIDER_REGISTRY.values());
}

/**
 * Check if a string is a valid provider ID.
 */
export function isValidProvider(id: string): id is ProviderId {
  return PROVIDER_REGISTRY.has(id as ProviderId);
}
