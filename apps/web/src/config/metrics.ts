/**
 * Metric Type Registry
 *
 * Defines all supported health metric types for the Totus application.
 * This is application-level configuration (not a database table).
 *
 * Categories: sleep, cardiovascular, activity, metabolic, body, recovery, nutrition
 * Data types: daily (aggregates), series (intraday), period (bounded events)
 *
 * See: /docs/integrations-pipeline-lld.md §4
 */

import type { ProviderId } from "./providers";

/**
 * Valid metric categories matching the LLD taxonomy.
 */
export type MetricCategory =
  | "sleep"
  | "cardiovascular"
  | "activity"
  | "metabolic"
  | "body"
  | "recovery"
  | "nutrition";

/**
 * Data type indicates which table the metric lives in.
 */
export type DataType = "daily" | "series" | "period";

/**
 * Value type — 'none' for period-type entries with no scalar value.
 */
export type ValueType = "integer" | "float" | "none";

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
  /** Subcategory within the category */
  subcategory: string;
  /** Whether the value is an integer, float, or none (for periods) */
  valueType: ValueType;
  /** Which table this metric is stored in */
  dataType: DataType;
  /** Provider IDs that can supply this metric */
  providers: ProviderId[];
  /** Chart display color (hex) */
  chartColor: string;
}

// ─── Legacy types for backward compatibility ────────────────

/** @deprecated Use MetricCategory instead */
export type { MetricCategory as MetricCategoryLegacy };

/** @deprecated Use ProviderId from providers.ts instead */
export type MetricSource = ProviderId;

/**
 * All supported metric type definitions.
 *
 * Map keyed by metric id for O(1) lookups.
 *
 * Full taxonomy: /docs/integrations-pipeline-lld.md §4.2
 */
export const METRIC_TYPES: ReadonlyMap<string, MetricType> = new Map<
  string,
  MetricType
>([
  // ─── Sleep > Summary (daily) ──────────────────────────────
  [
    "sleep_score",
    {
      id: "sleep_score",
      label: "Sleep Score",
      unit: "score",
      category: "sleep",
      subcategory: "summary",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura", "whoop"],
      chartColor: "#6366F1",
    },
  ],
  [
    "sleep_duration",
    {
      id: "sleep_duration",
      label: "Sleep Duration",
      unit: "hr",
      category: "sleep",
      subcategory: "summary",
      valueType: "float",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#8B5CF6",
    },
  ],
  [
    "sleep_efficiency",
    {
      id: "sleep_efficiency",
      label: "Sleep Efficiency",
      unit: "%",
      category: "sleep",
      subcategory: "summary",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#A78BFA",
    },
  ],
  [
    "sleep_latency",
    {
      id: "sleep_latency",
      label: "Sleep Latency",
      unit: "min",
      category: "sleep",
      subcategory: "summary",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura"],
      chartColor: "#C4B5FD",
    },
  ],

  // ─── Sleep > Stages (daily) ───────────────────────────────
  [
    "deep_sleep",
    {
      id: "deep_sleep",
      label: "Deep Sleep",
      unit: "hr",
      category: "sleep",
      subcategory: "stages",
      valueType: "float",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#4338CA",
    },
  ],
  [
    "rem_sleep",
    {
      id: "rem_sleep",
      label: "REM Sleep",
      unit: "hr",
      category: "sleep",
      subcategory: "stages",
      valueType: "float",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#5B21B6",
    },
  ],
  [
    "light_sleep",
    {
      id: "light_sleep",
      label: "Light Sleep",
      unit: "hr",
      category: "sleep",
      subcategory: "stages",
      valueType: "float",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#7C3AED",
    },
  ],
  [
    "awake_time",
    {
      id: "awake_time",
      label: "Awake Time",
      unit: "min",
      category: "sleep",
      subcategory: "stages",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#DDD6FE",
    },
  ],

  // ─── Sleep > Stages (period) ──────────────────────────────
  [
    "sleep_stage",
    {
      id: "sleep_stage",
      label: "Sleep Stage",
      unit: "—",
      category: "sleep",
      subcategory: "stages",
      valueType: "none",
      dataType: "period",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#4C1D95",
    },
  ],

  // ─── Cardiovascular > Recovery (daily) ────────────────────
  [
    "hrv",
    {
      id: "hrv",
      label: "Heart Rate Variability",
      unit: "ms",
      category: "cardiovascular",
      subcategory: "recovery",
      valueType: "float",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#EF4444",
    },
  ],

  // ─── Cardiovascular > Baseline (daily) ────────────────────
  [
    "rhr",
    {
      id: "rhr",
      label: "Resting Heart Rate",
      unit: "bpm",
      category: "cardiovascular",
      subcategory: "baseline",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#F87171",
    },
  ],

  // ─── Cardiovascular > Respiratory (daily) ─────────────────
  [
    "respiratory_rate",
    {
      id: "respiratory_rate",
      label: "Respiratory Rate",
      unit: "rpm",
      category: "cardiovascular",
      subcategory: "respiratory",
      valueType: "float",
      dataType: "daily",
      providers: ["oura", "whoop"],
      chartColor: "#DC2626",
    },
  ],
  [
    "spo2",
    {
      id: "spo2",
      label: "Blood Oxygen (avg)",
      unit: "%",
      category: "cardiovascular",
      subcategory: "respiratory",
      valueType: "float",
      dataType: "daily",
      providers: ["oura", "garmin"],
      chartColor: "#FB923C",
    },
  ],

  // ─── Cardiovascular > Respiratory (series) ────────────────
  [
    "spo2_interval",
    {
      id: "spo2_interval",
      label: "SpO2 (interval)",
      unit: "%",
      category: "cardiovascular",
      subcategory: "respiratory",
      valueType: "float",
      dataType: "series",
      providers: ["oura", "garmin"],
      chartColor: "#FDBA74",
    },
  ],

  // ─── Cardiovascular > Continuous (series) ─────────────────
  [
    "heart_rate",
    {
      id: "heart_rate",
      label: "Heart Rate",
      unit: "bpm",
      category: "cardiovascular",
      subcategory: "continuous",
      valueType: "integer",
      dataType: "series",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#B91C1C",
    },
  ],

  // ─── Activity > Summary (daily) ───────────────────────────
  [
    "activity_score",
    {
      id: "activity_score",
      label: "Activity Score",
      unit: "score",
      category: "activity",
      subcategory: "summary",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura"],
      chartColor: "#16A34A",
    },
  ],

  // ─── Activity > Movement (daily) ──────────────────────────
  [
    "steps",
    {
      id: "steps",
      label: "Steps",
      unit: "steps",
      category: "activity",
      subcategory: "movement",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura", "garmin"],
      chartColor: "#4ADE80",
    },
  ],

  // ─── Activity > Energy (daily) ────────────────────────────
  [
    "active_calories",
    {
      id: "active_calories",
      label: "Active Calories",
      unit: "kcal",
      category: "activity",
      subcategory: "energy",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#86EFAC",
    },
  ],
  [
    "total_calories",
    {
      id: "total_calories",
      label: "Total Calories",
      unit: "kcal",
      category: "activity",
      subcategory: "energy",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura", "garmin"],
      chartColor: "#15803D",
    },
  ],

  // ─── Activity > Workout (period) ──────────────────────────
  [
    "workout",
    {
      id: "workout",
      label: "Workout",
      unit: "—",
      category: "activity",
      subcategory: "workout",
      valueType: "none",
      dataType: "period",
      providers: ["oura", "garmin", "whoop"],
      chartColor: "#22C55E",
    },
  ],

  // ─── Metabolic > Glucose (series) ─────────────────────────
  [
    "glucose",
    {
      id: "glucose",
      label: "Glucose",
      unit: "mg/dL",
      category: "metabolic",
      subcategory: "glucose",
      valueType: "float",
      dataType: "series",
      providers: ["dexcom", "nutrisense"],
      chartColor: "#D97706",
    },
  ],

  // ─── Body > Temperature (daily) ───────────────────────────
  [
    "body_temperature_deviation",
    {
      id: "body_temperature_deviation",
      label: "Body Temp Deviation",
      unit: "°C",
      category: "body",
      subcategory: "temperature",
      valueType: "float",
      dataType: "daily",
      providers: ["oura"],
      chartColor: "#F59E0B",
    },
  ],

  // ─── Body > Composition (daily) ───────────────────────────
  [
    "weight",
    {
      id: "weight",
      label: "Body Weight",
      unit: "kg",
      category: "body",
      subcategory: "composition",
      valueType: "float",
      dataType: "daily",
      providers: ["withings", "garmin"],
      chartColor: "#FBBF24",
    },
  ],
  [
    "bmi",
    {
      id: "bmi",
      label: "Body Mass Index",
      unit: "kg/m²",
      category: "body",
      subcategory: "composition",
      valueType: "float",
      dataType: "daily",
      providers: ["withings", "garmin"],
      chartColor: "#FCD34D",
    },
  ],
  [
    "body_fat_pct",
    {
      id: "body_fat_pct",
      label: "Body Fat %",
      unit: "%",
      category: "body",
      subcategory: "composition",
      valueType: "float",
      dataType: "daily",
      providers: ["withings", "garmin"],
      chartColor: "#FDE68A",
    },
  ],
  [
    "muscle_mass_kg",
    {
      id: "muscle_mass_kg",
      label: "Muscle Mass",
      unit: "kg",
      category: "body",
      subcategory: "composition",
      valueType: "float",
      dataType: "daily",
      providers: ["withings", "garmin"],
      chartColor: "#FEF3C7",
    },
  ],
  [
    "bone_mass_kg",
    {
      id: "bone_mass_kg",
      label: "Bone Mass",
      unit: "kg",
      category: "body",
      subcategory: "composition",
      valueType: "float",
      dataType: "daily",
      providers: ["withings", "garmin"],
      chartColor: "#FFFBEB",
    },
  ],
  [
    "hydration_kg",
    {
      id: "hydration_kg",
      label: "Body Hydration",
      unit: "kg",
      category: "body",
      subcategory: "composition",
      valueType: "float",
      dataType: "daily",
      providers: ["withings"],
      chartColor: "#38BDF8",
    },
  ],
  [
    "visceral_fat_index",
    {
      id: "visceral_fat_index",
      label: "Visceral Fat Index",
      unit: "index",
      category: "body",
      subcategory: "composition",
      valueType: "float",
      dataType: "daily",
      providers: ["withings"],
      chartColor: "#0EA5E9",
    },
  ],

  // ─── Recovery > Summary (daily) ───────────────────────────
  [
    "readiness_score",
    {
      id: "readiness_score",
      label: "Readiness Score",
      unit: "score",
      category: "recovery",
      subcategory: "summary",
      valueType: "integer",
      dataType: "daily",
      providers: ["oura", "whoop"],
      chartColor: "#22D3EE",
    },
  ],

  // ─── Nutrition > Macros (daily) ───────────────────────────
  [
    "calories_consumed",
    {
      id: "calories_consumed",
      label: "Calories Consumed",
      unit: "kcal",
      category: "nutrition",
      subcategory: "macros",
      valueType: "integer",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#10B981",
    },
  ],
  [
    "protein_g",
    {
      id: "protein_g",
      label: "Protein",
      unit: "g",
      category: "nutrition",
      subcategory: "macros",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#34D399",
    },
  ],
  [
    "carbs_g",
    {
      id: "carbs_g",
      label: "Carbohydrates",
      unit: "g",
      category: "nutrition",
      subcategory: "macros",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#6EE7B7",
    },
  ],
  [
    "fat_g",
    {
      id: "fat_g",
      label: "Total Fat",
      unit: "g",
      category: "nutrition",
      subcategory: "macros",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#A7F3D0",
    },
  ],
  [
    "fiber_g",
    {
      id: "fiber_g",
      label: "Dietary Fiber",
      unit: "g",
      category: "nutrition",
      subcategory: "macros",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#D1FAE5",
    },
  ],
  [
    "sugar_g",
    {
      id: "sugar_g",
      label: "Sugar",
      unit: "g",
      category: "nutrition",
      subcategory: "macros",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#ECFDF5",
    },
  ],
  [
    "saturated_fat_g",
    {
      id: "saturated_fat_g",
      label: "Saturated Fat",
      unit: "g",
      category: "nutrition",
      subcategory: "macros",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#059669",
    },
  ],

  // ─── Nutrition > Minerals (daily) ─────────────────────────
  [
    "sodium_mg",
    {
      id: "sodium_mg",
      label: "Sodium",
      unit: "mg",
      category: "nutrition",
      subcategory: "minerals",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#0D9488",
    },
  ],
  [
    "potassium_mg",
    {
      id: "potassium_mg",
      label: "Potassium",
      unit: "mg",
      category: "nutrition",
      subcategory: "minerals",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#14B8A6",
    },
  ],
  [
    "calcium_mg",
    {
      id: "calcium_mg",
      label: "Calcium",
      unit: "mg",
      category: "nutrition",
      subcategory: "minerals",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#2DD4BF",
    },
  ],
  [
    "iron_mg",
    {
      id: "iron_mg",
      label: "Iron",
      unit: "mg",
      category: "nutrition",
      subcategory: "minerals",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#5EEAD4",
    },
  ],
  [
    "magnesium_mg",
    {
      id: "magnesium_mg",
      label: "Magnesium",
      unit: "mg",
      category: "nutrition",
      subcategory: "minerals",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#99F6E4",
    },
  ],
  [
    "zinc_mg",
    {
      id: "zinc_mg",
      label: "Zinc",
      unit: "mg",
      category: "nutrition",
      subcategory: "minerals",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#CCFBF1",
    },
  ],

  // ─── Nutrition > Vitamins (daily) ─────────────────────────
  [
    "vitamin_a_mcg",
    {
      id: "vitamin_a_mcg",
      label: "Vitamin A",
      unit: "mcg",
      category: "nutrition",
      subcategory: "vitamins",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#F472B6",
    },
  ],
  [
    "vitamin_c_mg",
    {
      id: "vitamin_c_mg",
      label: "Vitamin C",
      unit: "mg",
      category: "nutrition",
      subcategory: "vitamins",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#F9A8D4",
    },
  ],
  [
    "vitamin_d_mcg",
    {
      id: "vitamin_d_mcg",
      label: "Vitamin D",
      unit: "mcg",
      category: "nutrition",
      subcategory: "vitamins",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#FBCFE8",
    },
  ],
  [
    "vitamin_b12_mcg",
    {
      id: "vitamin_b12_mcg",
      label: "Vitamin B12",
      unit: "mcg",
      category: "nutrition",
      subcategory: "vitamins",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#FCE7F3",
    },
  ],
  [
    "folate_mcg",
    {
      id: "folate_mcg",
      label: "Folate",
      unit: "mcg",
      category: "nutrition",
      subcategory: "vitamins",
      valueType: "float",
      dataType: "daily",
      providers: ["cronometer"],
      chartColor: "#FDF2F8",
    },
  ],

  // ─── Nutrition > Meals (period) ───────────────────────────
  [
    "meal",
    {
      id: "meal",
      label: "Meal",
      unit: "—",
      category: "nutrition",
      subcategory: "meals",
      valueType: "none",
      dataType: "period",
      providers: ["cronometer"],
      chartColor: "#047857",
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
 * Get all metric types by data type.
 */
export function getMetricsByDataType(dataType: DataType): MetricType[] {
  return getAllMetricTypes().filter((m) => m.dataType === dataType);
}

/**
 * Get all metric types available from a specific provider.
 */
export function getMetricsByProvider(providerId: string): MetricType[] {
  return getAllMetricTypes().filter((m) =>
    m.providers.includes(providerId as ProviderId),
  );
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
