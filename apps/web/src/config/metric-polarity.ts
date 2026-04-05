/**
 * Metric Polarity Configuration
 *
 * Maps each metric to its polarity — whether higher or lower values
 * are "better" for the user. Used by summary metrics computation to
 * determine the direction label ("better" / "worse" / "neutral") and
 * by z-score status classification to assign appropriate status levels.
 *
 * See: /docs/dashboard-backend-lld.md §14.2
 */

export type MetricPolarity = "higher_is_better" | "lower_is_better" | "neutral";

export const METRIC_POLARITY: Record<string, MetricPolarity> = {
  // Higher is better
  hrv: "higher_is_better",
  sleep_score: "higher_is_better",
  readiness_score: "higher_is_better",
  sleep_efficiency: "higher_is_better",
  deep_sleep: "higher_is_better",
  rem_sleep: "higher_is_better",
  spo2: "higher_is_better",
  activity_score: "higher_is_better",

  // Lower is better
  rhr: "lower_is_better",
  sleep_latency: "lower_is_better",
  respiratory_rate: "lower_is_better",
  awake_time: "lower_is_better",

  // Context-dependent (neutral)
  weight: "neutral",
  steps: "neutral",
  active_calories: "neutral",
  total_calories: "neutral",
  body_temperature_deviation: "neutral",
  glucose: "neutral",
};
