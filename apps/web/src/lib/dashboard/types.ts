/**
 * Shared TypeScript types for the Dashboard module.
 *
 * These interfaces are the canonical type definitions used by all dashboard
 * computation services, API endpoints, and frontend components.
 *
 * See: /docs/dashboard-backend-lld.md §14.1
 */

/**
 * Dashboard view types corresponding to the 5 wireframes (W1–W5).
 */
export type ViewType = "night" | "recovery" | "trend" | "weekly" | "anomaly";

/**
 * Encrypted payload shape stored in `metric_baselines.value_encrypted`.
 * Contains 30-day rolling statistics for a single metric.
 */
export interface BaselinePayload {
  /** Arithmetic mean of prior 30 days */
  avg_30d: number;
  /** Population standard deviation of prior 30 days (divisor N, not N−1) */
  stddev_30d: number;
  /** Normal range top: avg + 1 stddev */
  upper: number;
  /** Normal range bottom: avg - 1 stddev */
  lower: number;
  /** Number of data points in the 30-day window */
  sample_count: number;
}

/**
 * Summary metric with delta from baseline, polarity-aware direction,
 * and z-score-based status classification.
 */
export interface SummaryMetric {
  /** Current metric value */
  value: number;
  /** 30-day average from baseline */
  avg_30d: number;
  /** 30-day population standard deviation from baseline */
  stddev_30d: number;
  /** value - avg_30d */
  delta: number;
  /** ((value - avg_30d) / avg_30d) × 100 */
  delta_pct: number;
  /** Polarity-aware direction: "better" | "worse" | "neutral" */
  direction: "better" | "worse" | "neutral";
  /** Z-score-based status classification */
  status: "critical" | "warning" | "normal" | "good";
}

/**
 * Annotation representing a user-created or provider-sourced event marker.
 */
export interface Annotation {
  /** Row ID, or null for provider-sourced events */
  id: number | null;
  /** "user" for manual annotations, or provider name (e.g., "oura") */
  source: "user" | string;
  /** Event category */
  event_type: string;
  /** Decrypted label text */
  label: string;
  /** Decrypted note text, or null */
  note: string | null;
  /** ISO timestamp of when the event occurred */
  occurred_at: string;
  /** ISO timestamp of when the event ended, or null for instant events */
  ended_at: string | null;
}

/**
 * Generated insight displayed as a card in the dashboard UI.
 */
export interface Insight {
  /** Matches the insight rule ID (e.g., "elevated_rhr") */
  type: string;
  /** Short descriptive title */
  title: string;
  /** Narrative body text with interpolated metric values */
  body: string;
  /** Metric types related to this insight */
  related_metrics: string[];
  /** Severity level */
  severity: "info" | "warning";
  /** Whether the user can dismiss this insight */
  dismissible: boolean;
}

/**
 * Trend analysis result comparing start and end of a date range.
 */
export interface TrendResult {
  /** Overall trend direction */
  direction: "rising" | "falling" | "stable";
  /** 7-day average of the first week */
  start_value: number;
  /** 7-day average of the last week */
  end_value: number;
  /** ((end - start) / start) × 100 */
  change_pct: number;
  /** end - start */
  change_abs: number;
}

/**
 * Pearson correlation result between two metrics.
 */
export interface CorrelationResult {
  /** The two metrics being correlated */
  pair: [string, string];
  /** Pearson correlation coefficient (-1.0 to 1.0) */
  coefficient: number;
  /** Strength classification based on |r| */
  strength: "strong" | "moderate" | "weak";
  /** Direction of correlation */
  direction: "positive" | "inverse";
  /** Number of overlapping data points used */
  sample_count: number;
  /** False if fewer than 7 overlapping data points */
  sufficient_data: boolean;
}
