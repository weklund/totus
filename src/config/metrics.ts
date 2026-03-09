/**
 * Metric Type Registry
 *
 * Defines all supported health metric types for the Totus application.
 * This is application-level configuration (not a database table).
 *
 * Categories: Sleep, Cardio, Activity, Body
 *
 * See: /docs/api-database-lld.md Section 8.6 and Appendix 19.1
 */

/**
 * Valid metric categories.
 */
export type MetricCategory = "Sleep" | "Cardio" | "Activity" | "Body";

/**
 * Valid data source identifiers.
 */
export type MetricSource = "oura" | "apple_health" | "google_fit";

/**
 * A single metric type definition.
 */
export interface MetricType {
  /** Database identifier (e.g., 'sleep_score') */
  id: string;
  /** Human-readable name (e.g., 'Sleep Score') */
  label: string;
  /** Display unit (e.g., 'score', 'ms', 'bpm') */
  unit: string;
  /** Grouping category */
  category: MetricCategory;
  /** Whether the value is an integer or float */
  valueType: "integer" | "float";
  /** Data sources that can provide this metric */
  sources: MetricSource[];
  /** Oura API field mapping (if applicable) */
  ouraField?: string;
  /** Chart display color (hex) */
  chartColor: string;
}

/**
 * All supported metric type definitions.
 *
 * Map keyed by metric id for O(1) lookups.
 */
export const METRIC_TYPES: ReadonlyMap<string, MetricType> = new Map<
  string,
  MetricType
>([
  // ─── Sleep ────────────────────────────────────────────────
  [
    "sleep_score",
    {
      id: "sleep_score",
      label: "Sleep Score",
      unit: "score",
      category: "Sleep",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "score",
      chartColor: "#6366F1", // Indigo
    },
  ],
  [
    "sleep_duration",
    {
      id: "sleep_duration",
      label: "Sleep Duration",
      unit: "hr",
      category: "Sleep",
      valueType: "float",
      sources: ["oura"],
      ouraField: "contributors.total_sleep",
      chartColor: "#8B5CF6", // Violet
    },
  ],
  [
    "sleep_efficiency",
    {
      id: "sleep_efficiency",
      label: "Sleep Efficiency",
      unit: "%",
      category: "Sleep",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "contributors.efficiency",
      chartColor: "#A78BFA", // Light violet
    },
  ],
  [
    "sleep_latency",
    {
      id: "sleep_latency",
      label: "Sleep Latency",
      unit: "min",
      category: "Sleep",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "latency",
      chartColor: "#C4B5FD", // Pale violet
    },
  ],
  [
    "deep_sleep",
    {
      id: "deep_sleep",
      label: "Deep Sleep",
      unit: "hr",
      category: "Sleep",
      valueType: "float",
      sources: ["oura"],
      ouraField: "deep_sleep_duration",
      chartColor: "#4338CA", // Dark indigo
    },
  ],
  [
    "rem_sleep",
    {
      id: "rem_sleep",
      label: "REM Sleep",
      unit: "hr",
      category: "Sleep",
      valueType: "float",
      sources: ["oura"],
      ouraField: "rem_sleep_duration",
      chartColor: "#5B21B6", // Dark violet
    },
  ],
  [
    "light_sleep",
    {
      id: "light_sleep",
      label: "Light Sleep",
      unit: "hr",
      category: "Sleep",
      valueType: "float",
      sources: ["oura"],
      ouraField: "light_sleep_duration",
      chartColor: "#7C3AED", // Medium violet
    },
  ],
  [
    "awake_time",
    {
      id: "awake_time",
      label: "Awake Time",
      unit: "min",
      category: "Sleep",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "awake_time",
      chartColor: "#DDD6FE", // Lightest violet
    },
  ],

  // ─── Cardio ───────────────────────────────────────────────
  [
    "hrv",
    {
      id: "hrv",
      label: "Heart Rate Variability",
      unit: "ms",
      category: "Cardio",
      valueType: "float",
      sources: ["oura"],
      ouraField: "average_hrv",
      chartColor: "#EF4444", // Red
    },
  ],
  [
    "rhr",
    {
      id: "rhr",
      label: "Resting Heart Rate",
      unit: "bpm",
      category: "Cardio",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "lowest_resting_heart_rate",
      chartColor: "#F87171", // Light red
    },
  ],
  [
    "respiratory_rate",
    {
      id: "respiratory_rate",
      label: "Respiratory Rate",
      unit: "bpm",
      category: "Cardio",
      valueType: "float",
      sources: ["oura"],
      ouraField: "average_breath",
      chartColor: "#DC2626", // Dark red
    },
  ],
  [
    "spo2",
    {
      id: "spo2",
      label: "Blood Oxygen",
      unit: "%",
      category: "Cardio",
      valueType: "float",
      sources: ["oura"],
      ouraField: "spo2_percentage.average",
      chartColor: "#FB923C", // Orange
    },
  ],

  // ─── Activity ─────────────────────────────────────────────
  [
    "readiness_score",
    {
      id: "readiness_score",
      label: "Readiness Score",
      unit: "score",
      category: "Activity",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "score",
      chartColor: "#22C55E", // Green
    },
  ],
  [
    "activity_score",
    {
      id: "activity_score",
      label: "Activity Score",
      unit: "score",
      category: "Activity",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "score",
      chartColor: "#16A34A", // Dark green
    },
  ],
  [
    "steps",
    {
      id: "steps",
      label: "Steps",
      unit: "steps",
      category: "Activity",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "steps",
      chartColor: "#4ADE80", // Light green
    },
  ],
  [
    "active_calories",
    {
      id: "active_calories",
      label: "Active Calories",
      unit: "kcal",
      category: "Activity",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "active_calories",
      chartColor: "#86EFAC", // Pale green
    },
  ],
  [
    "total_calories",
    {
      id: "total_calories",
      label: "Total Calories",
      unit: "kcal",
      category: "Activity",
      valueType: "integer",
      sources: ["oura"],
      ouraField: "total_calories",
      chartColor: "#15803D", // Darkest green
    },
  ],

  // ─── Body ─────────────────────────────────────────────────
  [
    "body_temperature_deviation",
    {
      id: "body_temperature_deviation",
      label: "Body Temp Deviation",
      unit: "°C",
      category: "Body",
      valueType: "float",
      sources: ["oura"],
      ouraField: "temperature_deviation",
      chartColor: "#F59E0B", // Amber
    },
  ],
  [
    "glucose",
    {
      id: "glucose",
      label: "Glucose",
      unit: "mg/dL",
      category: "Body",
      valueType: "float",
      sources: ["apple_health", "google_fit"],
      chartColor: "#D97706", // Dark amber
    },
  ],
  [
    "weight",
    {
      id: "weight",
      label: "Weight",
      unit: "kg",
      category: "Body",
      valueType: "float",
      sources: ["apple_health", "google_fit"],
      chartColor: "#FBBF24", // Light amber
    },
  ],
  [
    "body_fat",
    {
      id: "body_fat",
      label: "Body Fat",
      unit: "%",
      category: "Body",
      valueType: "float",
      sources: ["apple_health", "google_fit"],
      chartColor: "#FCD34D", // Pale amber
    },
  ],
]);

/**
 * Get a metric type by its ID.
 * Returns undefined if the metric type is not found.
 */
export function getMetricType(id: string): MetricType | undefined {
  return METRIC_TYPES.get(id);
}

/**
 * Get all metric types as an array.
 */
export function getAllMetricTypes(): MetricType[] {
  return Array.from(METRIC_TYPES.values());
}

/**
 * Get all metric types in a specific category.
 */
export function getMetricsByCategory(category: MetricCategory): MetricType[] {
  return getAllMetricTypes().filter((m) => m.category === category);
}

/**
 * Check if a string is a valid metric type ID.
 */
export function isValidMetricType(id: string): boolean {
  return METRIC_TYPES.has(id);
}

/**
 * All valid metric type IDs as an array of strings.
 * Useful for Zod enum validation.
 */
export const METRIC_TYPE_IDS: readonly string[] = Object.freeze(
  Array.from(METRIC_TYPES.keys()),
);
