import { describe, it, expect, beforeEach } from "vitest";
import type { SummaryMetric } from "@/lib/dashboard/types";
import type { InsightContext, AnomalyResult } from "@/lib/dashboard/insights";

/**
 * Unit tests for the P0 insight rule engine.
 *
 * Tests cover:
 * - Each rule fires correctly based on metric status thresholds
 * - Priority ordering (5, 10, 20, 30)
 * - Max 3 insights cap
 * - Dismissed insight exclusion with slot backfill
 * - viewType scoping (rules only fire for their declared view types)
 * - Template interpolation produces readable body text
 * - Severity mapping: critical status → "warning" severity, warning status → "info" severity
 *
 * VAL-COMP-010, VAL-COMP-011, VAL-COMP-012
 */

describe("Insight Rule Engine", () => {
  let generateInsights: typeof import("@/lib/dashboard/insights").generateInsights;
  let getP0Rules: typeof import("@/lib/dashboard/insights").getP0Rules;

  beforeEach(async () => {
    const mod = await import("@/lib/dashboard/insights");
    generateInsights = mod.generateInsights;
    getP0Rules = mod.getP0Rules;
  });

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function makeSummary(overrides: Partial<SummaryMetric> = {}): SummaryMetric {
    return {
      value: 70,
      avg_30d: 61,
      stddev_30d: 5,
      delta: 9,
      delta_pct: 14.75,
      direction: "worse",
      status: "critical",
      ...overrides,
    };
  }

  function makeContext(
    overrides: Partial<InsightContext> = {},
  ): InsightContext {
    return {
      viewType: "night",
      date: "2026-03-28",
      summaries: new Map(),
      baselines: new Map(),
      dismissedTypes: new Set(),
      ...overrides,
    };
  }

  function makeAnomalyResult(
    score: number,
    deviations: [string, boolean][],
  ): AnomalyResult {
    return {
      anomaly_score: score,
      is_alert: score >= 3,
      deviations: new Map(
        deviations.map(([metric, isAnomalous]) => [
          metric,
          { is_anomalous: isAnomalous },
        ]),
      ),
    };
  }

  // -----------------------------------------------------------------------
  // VAL-COMP-010: Insight rules fire based on metric status thresholds
  // -----------------------------------------------------------------------

  describe("VAL-COMP-010: individual rules fire correctly", () => {
    // --- elevated_rhr ---

    describe("elevated_rhr", () => {
      it("fires when rhr status is critical", () => {
        const ctx = makeContext({
          summaries: new Map([
            [
              "rhr",
              makeSummary({
                value: 72,
                avg_30d: 61,
                delta: 11,
                status: "critical",
              }),
            ],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(1);
        expect(insights[0].type).toBe("elevated_rhr");
        expect(insights[0].severity).toBe("warning");
      });

      it("fires when rhr status is warning", () => {
        const ctx = makeContext({
          summaries: new Map([
            [
              "rhr",
              makeSummary({
                value: 66,
                avg_30d: 61,
                delta: 5,
                status: "warning",
              }),
            ],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(1);
        expect(insights[0].type).toBe("elevated_rhr");
        expect(insights[0].severity).toBe("info");
      });

      it("does NOT fire when rhr status is normal", () => {
        const ctx = makeContext({
          summaries: new Map([["rhr", makeSummary({ status: "normal" })]]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });

      it("does NOT fire when rhr status is good", () => {
        const ctx = makeContext({
          summaries: new Map([
            [
              "rhr",
              makeSummary({
                value: 55,
                avg_30d: 61,
                delta: -6,
                status: "good",
              }),
            ],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });

      it("does NOT fire when rhr summary is missing", () => {
        const ctx = makeContext({
          summaries: new Map(),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });
    });

    // --- low_sleep_score ---

    describe("low_sleep_score", () => {
      it("fires when sleep_score status is critical", () => {
        const ctx = makeContext({
          summaries: new Map([
            [
              "sleep_score",
              makeSummary({
                value: 55,
                avg_30d: 78,
                delta: -23,
                delta_pct: -29.5,
                direction: "worse",
                status: "critical",
              }),
            ],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(1);
        expect(insights[0].type).toBe("low_sleep_score");
        expect(insights[0].severity).toBe("warning");
      });

      it("fires when sleep_score status is warning", () => {
        const ctx = makeContext({
          summaries: new Map([
            [
              "sleep_score",
              makeSummary({
                value: 68,
                avg_30d: 78,
                delta: -10,
                status: "warning",
              }),
            ],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(1);
        expect(insights[0].type).toBe("low_sleep_score");
        expect(insights[0].severity).toBe("info");
      });

      it("does NOT fire when sleep_score status is normal", () => {
        const ctx = makeContext({
          summaries: new Map([
            ["sleep_score", makeSummary({ status: "normal" })],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });

      it("does NOT fire when sleep_score status is good", () => {
        const ctx = makeContext({
          summaries: new Map([
            ["sleep_score", makeSummary({ status: "good" })],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });
    });

    // --- suppressed_hrv ---

    describe("suppressed_hrv", () => {
      it("fires when hrv status is critical", () => {
        const ctx = makeContext({
          summaries: new Map([
            [
              "hrv",
              makeSummary({
                value: 26,
                avg_30d: 48,
                delta: -22,
                direction: "worse",
                status: "critical",
              }),
            ],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(1);
        expect(insights[0].type).toBe("suppressed_hrv");
        expect(insights[0].severity).toBe("warning");
      });

      it("fires when hrv status is warning", () => {
        const ctx = makeContext({
          summaries: new Map([
            [
              "hrv",
              makeSummary({
                value: 38,
                avg_30d: 48,
                delta: -10,
                status: "warning",
              }),
            ],
          ]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(1);
        expect(insights[0].type).toBe("suppressed_hrv");
        expect(insights[0].severity).toBe("info");
      });

      it("does NOT fire when hrv status is normal", () => {
        const ctx = makeContext({
          summaries: new Map([["hrv", makeSummary({ status: "normal" })]]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });

      it("does NOT fire when hrv status is good", () => {
        const ctx = makeContext({
          summaries: new Map([["hrv", makeSummary({ status: "good" })]]),
        });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });
    });

    // --- multi_metric_deviation ---

    describe("multi_metric_deviation", () => {
      it("fires when anomaly_score >= 3 (is_alert = true)", () => {
        const anomaly = makeAnomalyResult(3, [
          ["rhr", true],
          ["hrv", true],
          ["sleep_score", true],
          ["readiness_score", false],
        ]);

        const ctx = makeContext({ anomaly });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(1);
        expect(insights[0].type).toBe("multi_metric_deviation");
        expect(insights[0].severity).toBe("warning");
        expect(insights[0].title).toBe("3 of 4 metrics outside normal range");
        expect(insights[0].related_metrics).toEqual(
          expect.arrayContaining(["rhr", "hrv", "sleep_score"]),
        );
        expect(insights[0].related_metrics).not.toContain("readiness_score");
      });

      it("fires when anomaly_score >= 5", () => {
        const anomaly = makeAnomalyResult(5, [
          ["rhr", true],
          ["hrv", true],
          ["sleep_score", true],
          ["readiness_score", true],
          ["deep_sleep", true],
          ["rem_sleep", false],
        ]);

        const ctx = makeContext({ anomaly });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(1);
        expect(insights[0].type).toBe("multi_metric_deviation");
        expect(insights[0].title).toBe("5 of 6 metrics outside normal range");
      });

      it("does NOT fire when anomaly_score < 3 (is_alert = false)", () => {
        const anomaly = makeAnomalyResult(2, [
          ["rhr", true],
          ["hrv", true],
          ["sleep_score", false],
        ]);

        const ctx = makeContext({ anomaly });

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });

      it("does NOT fire when anomaly context is missing", () => {
        const ctx = makeContext();

        const insights = generateInsights("night", ctx);

        expect(insights).toHaveLength(0);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Severity mapping
  // -----------------------------------------------------------------------

  describe("severity mapping", () => {
    it("maps critical status → warning severity for elevated_rhr", () => {
      const ctx = makeContext({
        summaries: new Map([["rhr", makeSummary({ status: "critical" })]]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].severity).toBe("warning");
    });

    it("maps warning status → info severity for elevated_rhr", () => {
      const ctx = makeContext({
        summaries: new Map([["rhr", makeSummary({ status: "warning" })]]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].severity).toBe("info");
    });

    it("maps critical status → warning severity for low_sleep_score", () => {
      const ctx = makeContext({
        summaries: new Map([
          ["sleep_score", makeSummary({ status: "critical" })],
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].severity).toBe("warning");
    });

    it("maps warning status → info severity for suppressed_hrv", () => {
      const ctx = makeContext({
        summaries: new Map([["hrv", makeSummary({ status: "warning" })]]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].severity).toBe("info");
    });

    it("multi_metric_deviation always has warning severity", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({ anomaly });

      const insights = generateInsights("night", ctx);

      expect(insights[0].severity).toBe("warning");
    });
  });

  // -----------------------------------------------------------------------
  // Template interpolation produces readable body text
  // -----------------------------------------------------------------------

  describe("template interpolation", () => {
    it("elevated_rhr body includes actual values", () => {
      const ctx = makeContext({
        summaries: new Map([
          [
            "rhr",
            makeSummary({
              value: 72,
              avg_30d: 61,
              delta: 11,
              status: "critical",
            }),
          ],
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].body).toContain("72");
      expect(insights[0].body).toContain("11");
      expect(insights[0].body).toContain("61");
      expect(insights[0].body).toContain("above");
      expect(insights[0].body).toContain("bpm");
    });

    it("elevated_rhr body says 'below' when delta is negative", () => {
      // Edge case: RHR below average but still critical/warning
      // (this would be an unusual case but the template should handle it)
      const ctx = makeContext({
        summaries: new Map([
          [
            "rhr",
            makeSummary({
              value: 50,
              avg_30d: 61,
              delta: -11,
              status: "warning",
            }),
          ],
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].body).toContain("below");
    });

    it("low_sleep_score body includes actual values", () => {
      const ctx = makeContext({
        summaries: new Map([
          [
            "sleep_score",
            makeSummary({
              value: 55,
              avg_30d: 78,
              delta: -23,
              status: "critical",
            }),
          ],
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].body).toContain("55");
      expect(insights[0].body).toContain("23");
      expect(insights[0].body).toContain("78");
      expect(insights[0].body).toContain("below");
    });

    it("suppressed_hrv body includes actual values", () => {
      const ctx = makeContext({
        summaries: new Map([
          [
            "hrv",
            makeSummary({
              value: 26,
              avg_30d: 48,
              delta: -22,
              status: "critical",
            }),
          ],
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].body).toContain("26");
      expect(insights[0].body).toContain("22");
      expect(insights[0].body).toContain("48");
      expect(insights[0].body).toContain("ms");
    });

    it("multi_metric_deviation body contains systemic cause reference", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({ anomaly });

      const insights = generateInsights("night", ctx);

      expect(insights[0].body).toContain("systemic cause");
    });
  });

  // -----------------------------------------------------------------------
  // Insight properties
  // -----------------------------------------------------------------------

  describe("insight properties", () => {
    it("all insights have dismissible: true", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "warning" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
      });

      const insights = generateInsights("night", ctx);

      for (const insight of insights) {
        expect(insight.dismissible).toBe(true);
      }
    });

    it("all insights have related_metrics array", () => {
      const ctx = makeContext({
        summaries: new Map([["rhr", makeSummary({ status: "critical" })]]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights[0].related_metrics).toBeInstanceOf(Array);
      expect(insights[0].related_metrics).toContain("rhr");
    });
  });

  // -----------------------------------------------------------------------
  // VAL-COMP-011: Priority ordering, max 3 cap, and dismissal exclusion
  // -----------------------------------------------------------------------

  describe("VAL-COMP-011: priority ordering, max 3 cap, dismissal exclusion", () => {
    it("returns insights in priority order (5, 10, 20, 30)", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "warning" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
      });

      const insights = generateInsights("night", ctx);

      // All 4 rules fire, but max 3 returned
      expect(insights).toHaveLength(3);
      // Priority order: multi_metric_deviation (5), elevated_rhr (10), low_sleep_score (20)
      expect(insights[0].type).toBe("multi_metric_deviation");
      expect(insights[1].type).toBe("elevated_rhr");
      expect(insights[2].type).toBe("low_sleep_score");
    });

    it("caps at maximum 3 insights when all 4 rules fire", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "critical" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights).toHaveLength(3);
      // suppressed_hrv (priority 30) is excluded
      expect(insights.map((i) => i.type)).not.toContain("suppressed_hrv");
    });

    it("dismissed insight types are skipped and lower-priority rules backfill", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "critical" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
        dismissedTypes: new Set(["elevated_rhr"]),
      });

      const insights = generateInsights("night", ctx);

      // 4 rules fire but elevated_rhr is dismissed → remaining: multi_metric_deviation, low_sleep_score, suppressed_hrv
      expect(insights).toHaveLength(3);
      expect(insights[0].type).toBe("multi_metric_deviation");
      expect(insights[1].type).toBe("low_sleep_score");
      expect(insights[2].type).toBe("suppressed_hrv"); // backfilled into the 3rd slot
      expect(insights.map((i) => i.type)).not.toContain("elevated_rhr");
    });

    it("dismissing the top-priority rule lets all remaining rules fill in", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "critical" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
        dismissedTypes: new Set(["multi_metric_deviation"]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights).toHaveLength(3);
      expect(insights[0].type).toBe("elevated_rhr");
      expect(insights[1].type).toBe("low_sleep_score");
      expect(insights[2].type).toBe("suppressed_hrv");
    });

    it("dismissing multiple types still caps at 3", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "critical" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
        dismissedTypes: new Set(["multi_metric_deviation", "elevated_rhr"]),
      });

      const insights = generateInsights("night", ctx);

      // Only low_sleep_score and suppressed_hrv remain
      expect(insights).toHaveLength(2);
      expect(insights[0].type).toBe("low_sleep_score");
      expect(insights[1].type).toBe("suppressed_hrv");
    });

    it("returns empty array when all rules are dismissed", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "critical" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
        dismissedTypes: new Set([
          "multi_metric_deviation",
          "elevated_rhr",
          "low_sleep_score",
          "suppressed_hrv",
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights).toHaveLength(0);
    });

    it("returns empty array when no rules fire", () => {
      const ctx = makeContext({
        summaries: new Map([
          ["rhr", makeSummary({ status: "normal" })],
          ["sleep_score", makeSummary({ status: "good" })],
          ["hrv", makeSummary({ status: "good" })],
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights).toHaveLength(0);
    });

    it("returns fewer than 3 if fewer than 3 rules fire", () => {
      const ctx = makeContext({
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "normal" })],
          ["hrv", makeSummary({ status: "good" })],
        ]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe("elevated_rhr");
    });
  });

  // -----------------------------------------------------------------------
  // VAL-COMP-012: viewType scoping
  // -----------------------------------------------------------------------

  describe("VAL-COMP-012: viewType scoping", () => {
    it("elevated_rhr fires for night viewType", () => {
      const ctx = makeContext({
        viewType: "night",
        summaries: new Map([["rhr", makeSummary({ status: "critical" })]]),
      });

      const insights = generateInsights("night", ctx);

      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe("elevated_rhr");
    });

    it("elevated_rhr fires for recovery viewType", () => {
      const ctx = makeContext({
        viewType: "recovery",
        summaries: new Map([["rhr", makeSummary({ status: "critical" })]]),
      });

      const insights = generateInsights("recovery", ctx);

      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe("elevated_rhr");
    });

    it("elevated_rhr does NOT fire for trend viewType", () => {
      const ctx = makeContext({
        viewType: "trend",
        summaries: new Map([["rhr", makeSummary({ status: "critical" })]]),
      });

      const insights = generateInsights("trend", ctx);

      expect(insights).toHaveLength(0);
    });

    it("low_sleep_score fires for night and recovery, not trend", () => {
      const summary = makeSummary({
        value: 55,
        avg_30d: 78,
        delta: -23,
        status: "critical",
      });

      // night → fires
      const nightCtx = makeContext({
        viewType: "night",
        summaries: new Map([["sleep_score", summary]]),
      });
      expect(generateInsights("night", nightCtx)).toHaveLength(1);

      // recovery → fires
      const recoveryCtx = makeContext({
        viewType: "recovery",
        summaries: new Map([["sleep_score", summary]]),
      });
      expect(generateInsights("recovery", recoveryCtx)).toHaveLength(1);

      // trend → does not fire
      const trendCtx = makeContext({
        viewType: "trend",
        summaries: new Map([["sleep_score", summary]]),
      });
      expect(generateInsights("trend", trendCtx)).toHaveLength(0);
    });

    it("suppressed_hrv fires for night and recovery, not trend", () => {
      const summary = makeSummary({
        value: 26,
        avg_30d: 48,
        delta: -22,
        status: "critical",
      });

      // night → fires
      const nightCtx = makeContext({
        viewType: "night",
        summaries: new Map([["hrv", summary]]),
      });
      expect(generateInsights("night", nightCtx)).toHaveLength(1);

      // recovery → fires
      const recoveryCtx = makeContext({
        viewType: "recovery",
        summaries: new Map([["hrv", summary]]),
      });
      expect(generateInsights("recovery", recoveryCtx)).toHaveLength(1);

      // trend → does not fire
      const trendCtx = makeContext({
        viewType: "trend",
        summaries: new Map([["hrv", summary]]),
      });
      expect(generateInsights("trend", trendCtx)).toHaveLength(0);
    });

    it("multi_metric_deviation fires for night, recovery, and anomaly", () => {
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      // night → fires
      expect(generateInsights("night", makeContext({ anomaly }))).toHaveLength(
        1,
      );

      // recovery → fires
      expect(
        generateInsights(
          "recovery",
          makeContext({ viewType: "recovery", anomaly }),
        ),
      ).toHaveLength(1);

      // anomaly → fires
      expect(
        generateInsights(
          "anomaly",
          makeContext({ viewType: "anomaly", anomaly }),
        ),
      ).toHaveLength(1);

      // trend → does NOT fire
      expect(
        generateInsights("trend", makeContext({ viewType: "trend", anomaly })),
      ).toHaveLength(0);

      // weekly → does NOT fire
      expect(
        generateInsights(
          "weekly",
          makeContext({ viewType: "weekly", anomaly }),
        ),
      ).toHaveLength(0);
    });

    it("no rules fire for trend viewType even when all conditions are met", () => {
      const anomaly = makeAnomalyResult(5, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
        ["readiness_score", true],
        ["deep_sleep", true],
      ]);

      const ctx = makeContext({
        viewType: "trend",
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "critical" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
      });

      const insights = generateInsights("trend", ctx);

      expect(insights).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Rule definitions
  // -----------------------------------------------------------------------

  describe("rule definitions", () => {
    it("P0 rules have exactly 5 entries", () => {
      const rules = getP0Rules();
      expect(rules).toHaveLength(5);
    });

    it("P0 rules have correct priorities", () => {
      const rules = getP0Rules();
      const priorities = rules.map((r) => ({ id: r.id, priority: r.priority }));

      expect(priorities).toContainEqual({
        id: "multi_metric_deviation",
        priority: 5,
      });
      expect(priorities).toContainEqual({ id: "recovery_arc", priority: 8 });
      expect(priorities).toContainEqual({ id: "elevated_rhr", priority: 10 });
      expect(priorities).toContainEqual({
        id: "low_sleep_score",
        priority: 20,
      });
      expect(priorities).toContainEqual({ id: "suppressed_hrv", priority: 30 });
    });

    it("P0 rules have correct viewTypes", () => {
      const rules = getP0Rules();
      const ruleMap = new Map(rules.map((r) => [r.id, r]));

      expect(ruleMap.get("multi_metric_deviation")!.viewTypes).toEqual(
        expect.arrayContaining(["night", "recovery", "anomaly"]),
      );
      expect(ruleMap.get("recovery_arc")!.viewTypes).toEqual(["recovery"]);
      expect(ruleMap.get("elevated_rhr")!.viewTypes).toEqual(
        expect.arrayContaining(["night", "recovery"]),
      );
      expect(ruleMap.get("low_sleep_score")!.viewTypes).toEqual(
        expect.arrayContaining(["night", "recovery"]),
      );
      expect(ruleMap.get("suppressed_hrv")!.viewTypes).toEqual(
        expect.arrayContaining(["night", "recovery"]),
      );
    });

    it("all P0 rules have unique IDs", () => {
      const rules = getP0Rules();
      const ids = rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // -----------------------------------------------------------------------
  // recovery_arc rule
  // -----------------------------------------------------------------------

  describe("recovery_arc rule", () => {
    it("fires when readiness improves ≥15 points over recovery range", () => {
      const ctx = makeContext({
        viewType: "recovery",
        recoveryFirstDayValues: new Map([["readiness_score", 42]]),
        recoveryLastDayValues: new Map([["readiness_score", 82]]),
        recoveryDays: 5,
      });

      const insights = generateInsights("recovery", ctx);

      expect(insights.length).toBeGreaterThanOrEqual(1);
      const arcInsight = insights.find((i) => i.type === "recovery_arc");
      expect(arcInsight).toBeDefined();
      expect(arcInsight!.title).toBe("Recovery arc detected");
      expect(arcInsight!.body).toContain("42");
      expect(arcInsight!.body).toContain("82");
      expect(arcInsight!.body).toContain("4 days");
      expect(arcInsight!.severity).toBe("info");
      expect(arcInsight!.related_metrics).toContain("readiness_score");
    });

    it("does NOT fire when readiness improvement < 15 points", () => {
      const ctx = makeContext({
        viewType: "recovery",
        recoveryFirstDayValues: new Map([["readiness_score", 70]]),
        recoveryLastDayValues: new Map([["readiness_score", 82]]),
        recoveryDays: 5,
      });

      const insights = generateInsights("recovery", ctx);

      const arcInsight = insights.find((i) => i.type === "recovery_arc");
      expect(arcInsight).toBeUndefined();
    });

    it("does NOT fire on night viewType", () => {
      const ctx = makeContext({
        viewType: "night",
        recoveryFirstDayValues: new Map([["readiness_score", 42]]),
        recoveryLastDayValues: new Map([["readiness_score", 82]]),
        recoveryDays: 5,
      });

      const insights = generateInsights("night", ctx);

      const arcInsight = insights.find((i) => i.type === "recovery_arc");
      expect(arcInsight).toBeUndefined();
    });

    it("does NOT fire when recovery context is missing", () => {
      const ctx = makeContext({
        viewType: "recovery",
        // No recoveryFirstDayValues, recoveryLastDayValues, recoveryDays
      });

      const insights = generateInsights("recovery", ctx);

      const arcInsight = insights.find((i) => i.type === "recovery_arc");
      expect(arcInsight).toBeUndefined();
    });

    it("can be dismissed", () => {
      const ctx = makeContext({
        viewType: "recovery",
        recoveryFirstDayValues: new Map([["readiness_score", 42]]),
        recoveryLastDayValues: new Map([["readiness_score", 82]]),
        recoveryDays: 5,
        dismissedTypes: new Set(["recovery_arc"]),
      });

      const insights = generateInsights("recovery", ctx);

      const arcInsight = insights.find((i) => i.type === "recovery_arc");
      expect(arcInsight).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles empty summaries and no anomaly", () => {
      const ctx = makeContext();

      const insights = generateInsights("night", ctx);

      expect(insights).toHaveLength(0);
    });

    it("handles empty dismissedTypes set", () => {
      const ctx = makeContext({
        summaries: new Map([["rhr", makeSummary({ status: "critical" })]]),
        dismissedTypes: new Set(),
      });

      const insights = generateInsights("night", ctx);

      expect(insights).toHaveLength(1);
    });

    it("handles a context with only anomaly data (no summaries)", () => {
      const anomaly = makeAnomalyResult(4, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
        ["readiness_score", true],
      ]);

      const ctx = makeContext({ anomaly });

      const insights = generateInsights("night", ctx);

      // Only multi_metric_deviation fires (summaries empty → no other rules fire)
      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe("multi_metric_deviation");
    });

    it("viewType scoping and dismissal interact correctly", () => {
      // On recovery view, dismiss elevated_rhr and multi_metric_deviation, provide all summaries
      // recovery_arc won't fire because no recovery context is provided
      const anomaly = makeAnomalyResult(3, [
        ["rhr", true],
        ["hrv", true],
        ["sleep_score", true],
      ]);

      const ctx = makeContext({
        viewType: "recovery",
        anomaly,
        summaries: new Map([
          ["rhr", makeSummary({ status: "critical" })],
          ["sleep_score", makeSummary({ status: "critical" })],
          ["hrv", makeSummary({ status: "critical" })],
        ]),
        dismissedTypes: new Set(["elevated_rhr", "multi_metric_deviation"]),
      });

      const insights = generateInsights("recovery", ctx);

      // multi_metric_deviation dismissed, elevated_rhr dismissed
      // recovery_arc doesn't fire (no recovery context)
      // Remaining: low_sleep_score (20), suppressed_hrv (30)
      expect(insights).toHaveLength(2);
      expect(insights[0].type).toBe("low_sleep_score");
      expect(insights[1].type).toBe("suppressed_hrv");
    });
  });
});
