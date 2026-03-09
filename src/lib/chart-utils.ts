/**
 * Chart utilities — color palette and formatting helpers for Recharts.
 *
 * See: /docs/web-ui-lld.md Section 8.2
 */

export const METRIC_COLORS: Record<string, { line: string; fill: string }> = {
  sleep_score: { line: "hsl(250, 80%, 60%)", fill: "hsl(250, 80%, 60%, 0.1)" },
  sleep_duration: {
    line: "hsl(260, 70%, 55%)",
    fill: "hsl(260, 70%, 55%, 0.1)",
  },
  sleep_efficiency: {
    line: "hsl(270, 60%, 50%)",
    fill: "hsl(270, 60%, 50%, 0.1)",
  },
  sleep_latency: {
    line: "hsl(280, 50%, 55%)",
    fill: "hsl(280, 50%, 55%, 0.1)",
  },
  deep_sleep: { line: "hsl(240, 70%, 50%)", fill: "hsl(240, 70%, 50%, 0.1)" },
  rem_sleep: { line: "hsl(220, 70%, 55%)", fill: "hsl(220, 70%, 55%, 0.1)" },
  light_sleep: { line: "hsl(200, 60%, 60%)", fill: "hsl(200, 60%, 60%, 0.1)" },
  awake_time: { line: "hsl(30, 80%, 55%)", fill: "hsl(30, 80%, 55%, 0.1)" },
  hrv: { line: "hsl(160, 70%, 45%)", fill: "hsl(160, 70%, 45%, 0.1)" },
  rhr: { line: "hsl(0, 70%, 55%)", fill: "hsl(0, 70%, 55%, 0.1)" },
  respiratory_rate: {
    line: "hsl(180, 60%, 45%)",
    fill: "hsl(180, 60%, 45%, 0.1)",
  },
  spo2: { line: "hsl(200, 80%, 50%)", fill: "hsl(200, 80%, 50%, 0.1)" },
  body_temperature_deviation: {
    line: "hsl(15, 80%, 55%)",
    fill: "hsl(15, 80%, 55%, 0.1)",
  },
  readiness_score: {
    line: "hsl(140, 70%, 45%)",
    fill: "hsl(140, 70%, 45%, 0.1)",
  },
  activity_score: {
    line: "hsl(40, 80%, 50%)",
    fill: "hsl(40, 80%, 50%, 0.1)",
  },
  steps: { line: "hsl(45, 90%, 50%)", fill: "hsl(45, 90%, 50%, 0.1)" },
  active_calories: {
    line: "hsl(25, 85%, 55%)",
    fill: "hsl(25, 85%, 55%, 0.1)",
  },
  total_calories: {
    line: "hsl(35, 75%, 50%)",
    fill: "hsl(35, 75%, 50%, 0.1)",
  },
  glucose: { line: "hsl(340, 70%, 55%)", fill: "hsl(340, 70%, 55%, 0.1)" },
  weight: { line: "hsl(190, 60%, 50%)", fill: "hsl(190, 60%, 50%, 0.1)" },
  body_fat: { line: "hsl(310, 50%, 55%)", fill: "hsl(310, 50%, 55%, 0.1)" },
};

/** Fallback color for unknown metrics */
export const DEFAULT_METRIC_COLOR = {
  line: "hsl(0, 0%, 50%)",
  fill: "hsl(0, 0%, 50%, 0.1)",
};

/**
 * Get the chart color for a given metric type.
 */
export function getMetricColor(metricId: string) {
  return METRIC_COLORS[metricId] ?? DEFAULT_METRIC_COLOR;
}
