/**
 * Drizzle ORM schema definitions.
 * All table schemas and extensions are exported from here.
 */

// Table exports
export { users } from "./users";
export { providerConnections } from "./provider-connections";
export { healthDataDaily } from "./health-data-daily";
export { healthDataSeries } from "./health-data-series";
export { healthDataPeriods } from "./health-data-periods";
export { metricSourcePreferences } from "./metric-source-preferences";
export { shareGrants } from "./share-grants";
export { auditEvents } from "./audit-events";
export { apiKeys } from "./api-keys";
export { metricBaselines } from "./metric-baselines";
export { userAnnotations } from "./user-annotations";
export { dismissedInsights } from "./dismissed-insights";
export { waitlist } from "./waitlist";

// Legacy aliases for backward compatibility during migration
// These re-export the new names under the old names so existing imports still work.
export { healthDataDaily as healthData } from "./health-data-daily";
export { providerConnections as ouraConnections } from "./provider-connections";

// Custom type exports
export { bytea } from "./custom-types";
