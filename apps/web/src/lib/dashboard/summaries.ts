/**
 * Summary Metrics Computation Service
 *
 * Computes summary metrics with polarity-aware direction and z-score-based
 * status classification. Used by Night, Recovery, and Anomaly view endpoints.
 *
 * For each metric with both a value and a baseline:
 * - delta: value - avg_30d
 * - delta_pct: ((value - avg_30d) / |avg_30d|) × 100 (uses absolute avg to handle negatives)
 * - direction: polarity-aware ("better" / "worse" / "neutral")
 * - status: z-score-based classification ("critical" / "warning" / "normal" / "good")
 *
 * See: /docs/dashboard-backend-lld.md §5.8
 */

import type { BaselinePayload, SummaryMetric } from "@/lib/dashboard/types";
import { METRIC_POLARITY, type MetricPolarity } from "@/config/metric-polarity";

/** Minimum number of baseline data points required for meaningful delta/direction. */
const MIN_HISTORY_THRESHOLD = 14;

/**
 * Compute summary metrics with polarity-aware direction and z-score-based
 * status classification.
 *
 * For each metric present in both `values` and `baselines`, produces a
 * SummaryMetric. Metrics without a matching baseline are omitted from results.
 * Metrics without a matching value are also omitted.
 *
 * When baseline sample_count < 14, delta and delta_pct are suppressed (set to
 * null) and direction is set to "neutral" to avoid misleading comparisons with
 * insufficient baseline data (VAL-CROSS-018).
 *
 * @param values - Map of metric type to current value
 * @param baselines - Map of metric type to BaselinePayload (30-day statistics)
 * @returns Map of metric type to SummaryMetric
 */
export function computeSummaryMetrics(
  values: Map<string, number>,
  baselines: Map<string, BaselinePayload>,
): Map<string, SummaryMetric> {
  const results = new Map<string, SummaryMetric>();

  for (const [metricType, value] of values) {
    const baseline = baselines.get(metricType);
    if (!baseline) {
      continue; // Omit metrics without baselines
    }

    const { avg_30d, stddev_30d, sample_count } = baseline;

    // When sample_count < MIN_HISTORY_THRESHOLD, suppress delta/direction
    // to avoid misleading comparisons with insufficient baseline data.
    if (sample_count < MIN_HISTORY_THRESHOLD) {
      results.set(metricType, {
        value,
        avg_30d,
        stddev_30d,
        delta: null,
        delta_pct: null,
        direction: "neutral",
        status: "normal",
      });
      continue;
    }

    const delta = value - avg_30d;

    // delta_pct: use absolute avg to handle negative averages; return 0 for zero avg
    const delta_pct = avg_30d === 0 ? 0 : (delta / Math.abs(avg_30d)) * 100;

    const polarity: MetricPolarity = METRIC_POLARITY[metricType] ?? "neutral";

    const direction = computeDirection(delta, polarity);
    const status = computeStatus(value, avg_30d, stddev_30d, polarity);

    results.set(metricType, {
      value,
      avg_30d,
      stddev_30d,
      delta,
      delta_pct,
      direction,
      status,
    });
  }

  return results;
}

/**
 * Determine the polarity-aware direction label.
 *
 * - higher_is_better: positive delta → "better", negative → "worse"
 * - lower_is_better: positive delta → "worse", negative → "better"
 * - neutral: always "neutral"
 *
 * When delta is exactly 0, we still assign a direction based on polarity.
 * For non-neutral metrics with delta=0, this is a boundary case where
 * either direction is acceptable since there is no actual deviation.
 */
function computeDirection(
  delta: number,
  polarity: MetricPolarity,
): "better" | "worse" | "neutral" {
  if (polarity === "neutral") {
    return "neutral";
  }

  if (polarity === "higher_is_better") {
    return delta >= 0 ? "better" : "worse";
  }

  // lower_is_better
  return delta <= 0 ? "better" : "worse";
}

/**
 * Classify the metric status based on z-score and polarity.
 *
 * Z-score thresholds approximate percentile boundaries:
 * - |z| > 1.28 → top/bottom 10% (~90th or ~10th percentile)
 * - 0.67 < |z| ≤ 1.28 → 10th–25th percentile band
 * - |z| ≤ 0.67 → middle 50% (25th–75th percentile)
 *
 * Status classification respects polarity direction:
 * - "critical": deviation in the BAD direction with |z| > 1.28
 * - "warning": deviation in the BAD direction with 0.67 < |z| ≤ 1.28
 * - "normal": |z| ≤ 0.67 (regardless of direction)
 * - "good": deviation in the GOOD direction with |z| > 0.67
 *
 * Zero stddev handling:
 * - value == avg → "normal" (no deviation)
 * - value != avg → maximum deviation: "critical" (bad) or "good" (good)
 *
 * Neutral polarity always returns "normal".
 */
function computeStatus(
  value: number,
  avg: number,
  stddev: number,
  polarity: MetricPolarity,
): "critical" | "warning" | "normal" | "good" {
  // Neutral metrics always have "normal" status
  if (polarity === "neutral") {
    return "normal";
  }

  // Handle zero stddev: avoid division by zero
  if (stddev === 0) {
    if (value === avg) {
      return "normal";
    }
    // Treat as maximum deviation
    const isBadDirection = isDeviationBad(value, avg, polarity);
    return isBadDirection ? "critical" : "good";
  }

  const z = (value - avg) / stddev;
  const absZ = Math.abs(z);
  const isBadDirection = isDeviationBad(value, avg, polarity);

  // |z| ≤ 0.67 → normal (regardless of direction)
  if (absZ <= 0.67) {
    return "normal";
  }

  // |z| > 0.67 — classify based on direction
  if (isBadDirection) {
    // Bad direction: warning if 0.67 < |z| ≤ 1.28, critical if |z| > 1.28
    // Per VAL-COMP-006: |z| > 1.28 → critical, 0.67 < |z| ≤ 1.28 → warning
    return absZ > 1.28 ? "critical" : "warning";
  }

  // Good direction with |z| > 0.67 → good
  return "good";
}

/**
 * Determine if the deviation is in the "bad" direction for this polarity.
 *
 * - higher_is_better: value < avg is bad (below baseline)
 * - lower_is_better: value > avg is bad (above baseline)
 */
function isDeviationBad(
  value: number,
  avg: number,
  polarity: MetricPolarity,
): boolean {
  if (polarity === "higher_is_better") {
    return value < avg;
  }
  // lower_is_better
  return value > avg;
}
