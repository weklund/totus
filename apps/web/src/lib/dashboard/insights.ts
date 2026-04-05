/**
 * P0 Insight Rule Engine
 *
 * Evaluates a set of threshold-based rules against computed view data to
 * generate user-facing insights. Rules are evaluated in priority order
 * (lower number = higher priority). Dismissed types are skipped, and
 * lower-priority rules backfill the vacant slots. Maximum N=3 insights
 * returned per view to avoid overwhelming the user.
 *
 * See: /docs/dashboard-backend-lld.md §6.1–§6.2
 *
 * VAL-COMP-010, VAL-COMP-011, VAL-COMP-012
 */

import type {
  ViewType,
  BaselinePayload,
  SummaryMetric,
  Annotation,
  Insight,
  TrendResult,
} from "@/lib/dashboard/types";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Context passed to each insight rule's evaluate function.
 *
 * Populated by the calling view endpoint with all computed data.
 */
export interface InsightContext {
  viewType: ViewType;
  date: string;
  summaries: Map<string, SummaryMetric>;
  baselines: Map<string, BaselinePayload>;
  anomaly?: AnomalyResult;
  trends?: Map<string, TrendResult>;
  annotations?: Annotation[];
  dismissedTypes: Set<string>;
}

/**
 * Anomaly detection result used by the multi_metric_deviation rule.
 */
export interface AnomalyResult {
  anomaly_score: number;
  deviations: Map<string, { is_anomalous: boolean }>;
  is_alert: boolean;
}

/**
 * A single insight rule definition.
 */
export interface InsightRule {
  /** Unique rule identifier (e.g., "elevated_rhr") */
  id: string;
  /** Which view types this rule applies to */
  viewTypes: ViewType[];
  /** Lower number = higher priority; evaluated first */
  priority: number;
  /** Pure evaluation function; returns an Insight or null if the rule doesn't fire */
  evaluate: (ctx: InsightContext) => Insight | null;
}

// ---------------------------------------------------------------------------
// Maximum insights per view
// ---------------------------------------------------------------------------

const MAX_INSIGHTS_PER_VIEW = 3;

// ---------------------------------------------------------------------------
// P0 Insight Rules
// ---------------------------------------------------------------------------

/**
 * P0 rules: simple threshold-based insights using summary metric status.
 * Ordered by priority (lower = first evaluated).
 */
const P0_RULES: InsightRule[] = [
  // Priority 5 — multi_metric_deviation
  {
    id: "multi_metric_deviation",
    viewTypes: ["night", "recovery", "anomaly"],
    priority: 5,
    evaluate: (ctx: InsightContext): Insight | null => {
      if (!ctx.anomaly || !ctx.anomaly.is_alert) return null;

      const count = ctx.anomaly.anomaly_score;
      const total = ctx.anomaly.deviations.size;
      const relatedMetrics = [...ctx.anomaly.deviations.entries()]
        .filter(([, d]) => d.is_anomalous)
        .map(([m]) => m);

      return {
        type: "multi_metric_deviation",
        title: `${count} of ${total} metrics outside normal range`,
        body: `Multiple metrics are simultaneously deviating from your baseline, which may indicate a systemic cause.`,
        related_metrics: relatedMetrics,
        severity: "warning",
        dismissible: true,
      };
    },
  },

  // Priority 10 — elevated_rhr
  {
    id: "elevated_rhr",
    viewTypes: ["night", "recovery"],
    priority: 10,
    evaluate: (ctx: InsightContext): Insight | null => {
      const rhr = ctx.summaries.get("rhr");
      if (!rhr || rhr.status === "normal" || rhr.status === "good") return null;

      return {
        type: "elevated_rhr",
        title: "Elevated resting heart rate",
        body: `Your resting HR was ${rhr.value} bpm, ${Math.abs(rhr.delta ?? 0)} bpm ${(rhr.delta ?? 0) > 0 ? "above" : "below"} your 30-day average of ${rhr.avg_30d} bpm.`,
        related_metrics: ["rhr"],
        severity: rhr.status === "critical" ? "warning" : "info",
        dismissible: true,
      };
    },
  },

  // Priority 20 — low_sleep_score
  {
    id: "low_sleep_score",
    viewTypes: ["night", "recovery"],
    priority: 20,
    evaluate: (ctx: InsightContext): Insight | null => {
      const sleepScore = ctx.summaries.get("sleep_score");
      if (
        !sleepScore ||
        sleepScore.status === "normal" ||
        sleepScore.status === "good"
      )
        return null;

      return {
        type: "low_sleep_score",
        title: "Below-average sleep score",
        body: `Your sleep score was ${sleepScore.value}, ${Math.abs(sleepScore.delta ?? 0)} points ${(sleepScore.delta ?? 0) < 0 ? "below" : "above"} your 30-day average of ${sleepScore.avg_30d}.`,
        related_metrics: ["sleep_score"],
        severity: sleepScore.status === "critical" ? "warning" : "info",
        dismissible: true,
      };
    },
  },

  // Priority 30 — suppressed_hrv
  {
    id: "suppressed_hrv",
    viewTypes: ["night", "recovery"],
    priority: 30,
    evaluate: (ctx: InsightContext): Insight | null => {
      const hrv = ctx.summaries.get("hrv");
      if (!hrv || hrv.status === "normal" || hrv.status === "good") return null;

      return {
        type: "suppressed_hrv",
        title: "Suppressed heart rate variability",
        body: `Your HRV was ${hrv.value} ms, ${Math.abs(hrv.delta ?? 0)} ms ${(hrv.delta ?? 0) < 0 ? "below" : "above"} your 30-day average of ${hrv.avg_30d} ms.`,
        related_metrics: ["hrv"],
        severity: hrv.status === "critical" ? "warning" : "info",
        dismissible: true,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate insights for a given view type and context.
 *
 * Rules are evaluated in priority order (ascending). Rules that don't apply
 * to the current viewType are skipped. Dismissed insight types are skipped,
 * allowing lower-priority rules to backfill the slot. At most MAX_INSIGHTS_PER_VIEW
 * (3) insights are returned.
 *
 * @param viewType - The active view type
 * @param ctx - Full insight context with computed data and dismissed types
 * @returns Array of Insight objects, ordered by rule priority, max length 3
 */
export function generateInsights(
  viewType: ViewType,
  ctx: InsightContext,
): Insight[] {
  const insights: Insight[] = [];

  // Sort rules by priority (ascending — lower number = higher priority)
  const sortedRules = [...P0_RULES].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (insights.length >= MAX_INSIGHTS_PER_VIEW) break;

    // Skip rules that don't apply to this view type
    if (!rule.viewTypes.includes(viewType)) continue;

    // Skip dismissed insight types
    if (ctx.dismissedTypes.has(rule.id)) continue;

    // Evaluate the rule
    const insight = rule.evaluate(ctx);
    if (insight) {
      insights.push(insight);
    }
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

/**
 * Exposed for unit testing. Returns the P0 rules array.
 */
export function getP0Rules(): InsightRule[] {
  return P0_RULES;
}
