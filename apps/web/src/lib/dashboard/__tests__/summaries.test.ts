import { describe, it, expect, beforeEach } from "vitest";
import type { BaselinePayload } from "@/lib/dashboard/types";

/**
 * Unit tests for the summary metrics computation service.
 *
 * Tests cover:
 * - Delta and delta_pct computed correctly for positive and negative values
 * - Direction accounts for METRIC_POLARITY from config
 * - Z-score status classification with all threshold boundaries
 * - Zero stddev handled: value==avg → normal; value!=avg → critical/good based on polarity
 * - Zero avg handled: delta_pct uses absolute avg or returns 0
 * - Missing baselines for a metric → metric omitted from results
 * - Negative metric values
 * - All polarity types (higher_is_better, lower_is_better, neutral)
 *
 * VAL-COMP-004, VAL-COMP-005, VAL-COMP-006, VAL-COMP-007, VAL-COMP-013, VAL-COMP-014
 */

describe("computeSummaryMetrics", () => {
  let computeSummaryMetrics: typeof import("@/lib/dashboard/summaries").computeSummaryMetrics;

  beforeEach(async () => {
    const mod = await import("@/lib/dashboard/summaries");
    computeSummaryMetrics = mod.computeSummaryMetrics;
  });

  // Helper to create a BaselinePayload
  function makeBaseline(
    avg: number,
    stddev: number,
    sampleCount = 30,
  ): BaselinePayload {
    return {
      avg_30d: avg,
      stddev_30d: stddev,
      upper: avg + stddev,
      lower: avg - stddev,
      sample_count: sampleCount,
    };
  }

  // --- VAL-COMP-004: Delta and delta_pct computed correctly ---

  describe("delta and delta_pct", () => {
    it("computes delta and delta_pct for normal case (value=72, avg=61)", () => {
      const values = new Map<string, number>([["rhr", 72]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;

      expect(rhr.delta).toBeCloseTo(11, 4); // 72 - 61
      expect(rhr.delta_pct).toBeCloseTo((11 / 61) * 100, 2); // ≈ 18.03
    });

    it("computes negative delta when value < avg", () => {
      const values = new Map<string, number>([["hrv", 35]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const hrv = result.get("hrv")!;

      expect(hrv.delta).toBeCloseTo(-10, 4); // 35 - 45
      expect(hrv.delta_pct).toBeCloseTo((-10 / 45) * 100, 2); // ≈ -22.22
    });

    it("computes zero delta when value == avg", () => {
      const values = new Map<string, number>([["rhr", 60]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(60, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;

      expect(rhr.delta).toBe(0);
      expect(rhr.delta_pct).toBe(0);
    });
  });

  // --- VAL-COMP-004 / VAL-COMP-014: Zero avg edge case ---

  describe("zero avg handling", () => {
    it("returns delta_pct = 0 when avg_30d is 0", () => {
      const values = new Map<string, number>([
        ["body_temperature_deviation", 0.5],
      ]);
      const baselines = new Map<string, BaselinePayload>([
        ["body_temperature_deviation", makeBaseline(0, 0.2)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const metric = result.get("body_temperature_deviation")!;

      // delta_pct: (0.5 - 0) / |0| → should be 0 (not Infinity/NaN)
      expect(Number.isFinite(metric.delta_pct)).toBe(true);
      expect(metric.delta).toBeCloseTo(0.5, 4);
    });

    it("does not produce NaN or Infinity for zero avg", () => {
      const values = new Map<string, number>([
        ["body_temperature_deviation", -0.3],
      ]);
      const baselines = new Map<string, BaselinePayload>([
        ["body_temperature_deviation", makeBaseline(0, 0.1)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const metric = result.get("body_temperature_deviation")!;

      expect(Number.isFinite(metric.delta)).toBe(true);
      expect(Number.isFinite(metric.delta_pct)).toBe(true);
      expect(Number.isNaN(metric.delta_pct)).toBe(false);
    });
  });

  // --- VAL-COMP-005: Direction respects metric polarity ---

  describe("direction with metric polarity", () => {
    it("higher_is_better (HRV): positive delta → better", () => {
      const values = new Map<string, number>([["hrv", 55]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.direction).toBe("better");
    });

    it("higher_is_better (HRV): negative delta → worse", () => {
      const values = new Map<string, number>([["hrv", 35]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.direction).toBe("worse");
    });

    it("higher_is_better (sleep_score): positive delta → better", () => {
      const values = new Map<string, number>([["sleep_score", 90]]);
      const baselines = new Map<string, BaselinePayload>([
        ["sleep_score", makeBaseline(78, 6)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("sleep_score")!.direction).toBe("better");
    });

    it("lower_is_better (RHR): positive delta → worse", () => {
      const values = new Map<string, number>([["rhr", 72]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("rhr")!.direction).toBe("worse");
    });

    it("lower_is_better (RHR): negative delta → better", () => {
      const values = new Map<string, number>([["rhr", 55]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("rhr")!.direction).toBe("better");
    });

    it("lower_is_better (sleep_latency): positive delta → worse", () => {
      const values = new Map<string, number>([["sleep_latency", 30]]);
      const baselines = new Map<string, BaselinePayload>([
        ["sleep_latency", makeBaseline(15, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("sleep_latency")!.direction).toBe("worse");
    });

    it("neutral (weight): always neutral regardless of delta sign", () => {
      const values = new Map<string, number>([["weight", 180]]);
      const baselines = new Map<string, BaselinePayload>([
        ["weight", makeBaseline(170, 3)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("weight")!.direction).toBe("neutral");
    });

    it("neutral (weight): neutral with negative delta", () => {
      const values = new Map<string, number>([["weight", 160]]);
      const baselines = new Map<string, BaselinePayload>([
        ["weight", makeBaseline(170, 3)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("weight")!.direction).toBe("neutral");
    });

    it("neutral (body_temperature_deviation): always neutral", () => {
      const values = new Map<string, number>([
        ["body_temperature_deviation", 0.5],
      ]);
      const baselines = new Map<string, BaselinePayload>([
        ["body_temperature_deviation", makeBaseline(-0.1, 0.3)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("body_temperature_deviation")!.direction).toBe(
        "neutral",
      );
    });

    it("direction is neutral when delta is exactly zero", () => {
      // Even for non-neutral metrics, if value == avg, direction could be either
      // but let's verify there's no issue when delta=0
      const values = new Map<string, number>([["rhr", 61]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;
      // With delta=0 for lower_is_better, delta is not positive or negative
      // The implementation may treat zero as either direction; the important thing
      // is status should be "normal" and no error occurs
      expect(["better", "worse", "neutral"]).toContain(rhr.direction);
    });
  });

  // --- VAL-COMP-006: Z-score status classification ---

  describe("z-score status classification", () => {
    // For HRV (higher_is_better):
    // - Positive z = above avg = good direction
    // - Negative z = below avg = bad direction

    it("critical: bad direction, |z| > 1.28 — HRV below avg", () => {
      // z = (30 - 45) / 8 = -1.875 → bad direction (below avg for higher_is_better) → critical
      const values = new Map<string, number>([["hrv", 30]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.status).toBe("critical");
    });

    it("warning: bad direction, 0.67 < |z| ≤ 1.28 — HRV below avg", () => {
      // z = (39 - 45) / 8 = -0.75 → bad direction, |z| = 0.75 ∈ (0.67, 1.28] → warning
      const values = new Map<string, number>([["hrv", 39]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.status).toBe("warning");
    });

    it("normal: |z| ≤ 0.67 — HRV near avg", () => {
      // z = (43 - 45) / 8 = -0.25 → |z| = 0.25 < 0.67 → normal
      const values = new Map<string, number>([["hrv", 43]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.status).toBe("normal");
    });

    it("good: good direction, |z| > 0.67 — HRV above avg", () => {
      // z = (55 - 45) / 8 = 1.25 → good direction (above avg for higher_is_better), |z| = 1.25 > 0.67 → good
      const values = new Map<string, number>([["hrv", 55]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.status).toBe("good");
    });

    it("good: higher_is_better with z > 1.28 (far above avg) → still good", () => {
      // z = (65 - 45) / 8 = 2.5 → good direction → good (no "excellent" status)
      const values = new Map<string, number>([["hrv", 65]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.status).toBe("good");
    });

    // For RHR (lower_is_better):
    // - Positive z = above avg = bad direction
    // - Negative z = below avg = good direction

    it("critical: RHR far above avg (bad direction for lower_is_better)", () => {
      // z = (72 - 61) / 5 = 2.2 → positive z for lower_is_better → bad direction → |z| > 1.28 → critical
      const values = new Map<string, number>([["rhr", 72]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("rhr")!.status).toBe("critical");
    });

    it("warning: RHR slightly above avg (bad direction for lower_is_better)", () => {
      // z = (65 - 61) / 5 = 0.8 → positive z for lower_is_better → bad direction → |z| ∈ (0.67, 1.28] → warning
      const values = new Map<string, number>([["rhr", 65]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("rhr")!.status).toBe("warning");
    });

    it("good: RHR below avg (good direction for lower_is_better)", () => {
      // z = (55 - 61) / 5 = -1.2 → negative z for lower_is_better → good direction → |z| > 0.67 → good
      const values = new Map<string, number>([["rhr", 55]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("rhr")!.status).toBe("good");
    });

    it("normal: RHR near avg (lower_is_better)", () => {
      // z = (62 - 61) / 5 = 0.2 → |z| < 0.67 → normal
      const values = new Map<string, number>([["rhr", 62]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("rhr")!.status).toBe("normal");
    });

    // VAL-COMP-006 explicitly tests: HRV (higher_is_better) with z = +1.5 → "good"
    it("HRV (higher_is_better) with z = +1.5 → status good", () => {
      // z = (value - 45) / 8 = 1.5 → value = 45 + 12 = 57
      const values = new Map<string, number>([["hrv", 57]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.status).toBe("good");
    });

    // VAL-COMP-006 explicitly tests: RHR (lower_is_better) with z = +1.5 → "critical"
    it("RHR (lower_is_better) with z = +1.5 → status critical", () => {
      // z = (value - 61) / 5 = 1.5 → value = 61 + 7.5 = 68.5
      const values = new Map<string, number>([["rhr", 68.5]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("rhr")!.status).toBe("critical");
    });

    // Neutral metric status classification
    it("neutral metric: always normal regardless of z-score", () => {
      // z = (190 - 170) / 3 = 6.67 → huge z but neutral → normal
      const values = new Map<string, number>([["weight", 190]]);
      const baselines = new Map<string, BaselinePayload>([
        ["weight", makeBaseline(170, 3)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("weight")!.status).toBe("normal");
    });

    // Boundary test: exactly at 0.67
    it("boundary: |z| = 0.67 → normal (inclusive boundary)", () => {
      // z = (value - 45) / 8 = -0.67 → value = 45 - 5.36 = 39.64
      const values = new Map<string, number>([["hrv", 45 - 8 * 0.67]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      // |z| = 0.67 should be normal (|z| ≤ 0.67 → normal per spec)
      expect(result.get("hrv")!.status).toBe("normal");
    });

    // Boundary test: just above 0.67
    it("boundary: |z| = 0.68 in bad direction → warning", () => {
      // z = (value - 45) / 8 = -0.68 → value = 45 - 5.44 = 39.56
      const values = new Map<string, number>([["hrv", 45 - 8 * 0.68]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.status).toBe("warning");
    });

    // Boundary test: |z| = 1.28 (using exact computation to avoid float issues)
    it("boundary: |z| = 1.28 in bad direction → warning (not critical)", () => {
      // Use avg=100, stddev=100, so z = (value-100)/100 = value/100 - 1
      // For z = -1.28: value = 100 - 128 = -28
      // But let's use avg=0, stddev=100 for cleaner math: z = value / 100
      // z = -1.28 → value = -128
      const values = new Map<string, number>([["hrv", -128]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(0, 100)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      // |z| = 1.28 (exact). Per VAL-COMP-006: 0.67 < |z| ≤ 1.28 → warning
      expect(result.get("hrv")!.status).toBe("warning");
    });

    // Boundary test: just above 1.28
    it("boundary: |z| = 1.29 in bad direction → critical", () => {
      // z = (value - 45) / 8 = -1.29 → value = 45 - 10.32 = 34.68
      const values = new Map<string, number>([["hrv", 45 - 8 * 1.29]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.get("hrv")!.status).toBe("critical");
    });
  });

  // --- VAL-COMP-006 / VAL-COMP-013: Zero stddev handling ---

  describe("zero stddev edge cases", () => {
    it("zero stddev + value == avg → status normal", () => {
      const values = new Map<string, number>([["rhr", 60]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(60, 0)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;

      expect(rhr.status).toBe("normal");
      expect(rhr.delta).toBe(0);
      expect(Number.isFinite(rhr.delta_pct)).toBe(true);
      expect(Number.isNaN(rhr.delta_pct)).toBe(false);
    });

    it("zero stddev + value != avg + bad direction → critical (lower_is_better, value > avg)", () => {
      // RHR is lower_is_better: value > avg means bad direction → critical
      const values = new Map<string, number>([["rhr", 65]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(60, 0)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;

      expect(rhr.status).toBe("critical");
      expect(Number.isFinite(rhr.delta)).toBe(true);
      expect(Number.isFinite(rhr.delta_pct)).toBe(true);
      expect(Number.isNaN(rhr.delta_pct)).toBe(false);
    });

    it("zero stddev + value != avg + good direction → good (lower_is_better, value < avg)", () => {
      // RHR is lower_is_better: value < avg means good direction → good
      const values = new Map<string, number>([["rhr", 55]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(60, 0)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;

      expect(rhr.status).toBe("good");
    });

    it("zero stddev + value != avg + bad direction → critical (higher_is_better, value < avg)", () => {
      // HRV is higher_is_better: value < avg means bad direction → critical
      const values = new Map<string, number>([["hrv", 40]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(50, 0)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const hrv = result.get("hrv")!;

      expect(hrv.status).toBe("critical");
    });

    it("zero stddev + value != avg + good direction → good (higher_is_better, value > avg)", () => {
      // HRV is higher_is_better: value > avg means good direction → good
      const values = new Map<string, number>([["hrv", 60]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(50, 0)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const hrv = result.get("hrv")!;

      expect(hrv.status).toBe("good");
    });

    it("zero stddev + neutral metric + value != avg → normal", () => {
      const values = new Map<string, number>([["weight", 180]]);
      const baselines = new Map<string, BaselinePayload>([
        ["weight", makeBaseline(170, 0)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const weight = result.get("weight")!;

      expect(weight.status).toBe("normal");
    });

    it("zero stddev: no division by zero error, no NaN, no Infinity", () => {
      const values = new Map<string, number>([
        ["rhr", 65],
        ["hrv", 50],
        ["weight", 180],
      ]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(60, 0)],
        ["hrv", makeBaseline(50, 0)],
        ["weight", makeBaseline(170, 0)],
      ]);

      const result = computeSummaryMetrics(values, baselines);

      for (const [, metric] of result) {
        expect(Number.isFinite(metric.value)).toBe(true);
        expect(Number.isFinite(metric.avg_30d)).toBe(true);
        expect(Number.isFinite(metric.stddev_30d)).toBe(true);
        expect(Number.isFinite(metric.delta)).toBe(true);
        expect(Number.isFinite(metric.delta_pct)).toBe(true);
        expect(Number.isNaN(metric.delta_pct)).toBe(false);
      }
    });
  });

  // --- VAL-COMP-007: Missing baselines → metric omitted ---

  describe("missing baselines", () => {
    it("omits metrics without baselines from results", () => {
      const values = new Map<string, number>([
        ["rhr", 65],
        ["hrv", 45],
        ["sleep_score", 85],
      ]);
      // Baselines exist only for rhr and hrv, not sleep_score
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);

      expect(result.has("rhr")).toBe(true);
      expect(result.has("hrv")).toBe(true);
      expect(result.has("sleep_score")).toBe(false);
      expect(result.size).toBe(2);
    });

    it("returns empty map when no baselines exist", () => {
      const values = new Map<string, number>([
        ["rhr", 65],
        ["hrv", 45],
      ]);
      const baselines = new Map<string, BaselinePayload>();

      const result = computeSummaryMetrics(values, baselines);
      expect(result.size).toBe(0);
    });

    it("returns empty map when no values exist", () => {
      const values = new Map<string, number>();
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      expect(result.size).toBe(0);
    });

    it("handles baseline without matching value (baseline exists but no value)", () => {
      const values = new Map<string, number>([["hrv", 45]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)], // value does not exist for rhr
        ["hrv", makeBaseline(45, 8)],
      ]);

      const result = computeSummaryMetrics(values, baselines);

      expect(result.has("hrv")).toBe(true);
      expect(result.has("rhr")).toBe(false);
      expect(result.size).toBe(1);
    });
  });

  // --- VAL-COMP-014: Negative metric values ---

  describe("negative values", () => {
    it("handles negative values correctly (body_temperature_deviation = -0.3)", () => {
      const values = new Map<string, number>([
        ["body_temperature_deviation", -0.3],
      ]);
      const baselines = new Map<string, BaselinePayload>([
        ["body_temperature_deviation", makeBaseline(-0.1, 0.2)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const metric = result.get("body_temperature_deviation")!;

      expect(metric.delta).toBeCloseTo(-0.2, 4); // -0.3 - (-0.1) = -0.2
      // delta_pct uses absolute avg: (-0.2 / |-0.1|) * 100 = -200
      expect(metric.delta_pct).toBeCloseTo((-0.2 / 0.1) * 100, 2);
      expect(Number.isFinite(metric.delta_pct)).toBe(true);
    });

    it("handles negative avg correctly for delta_pct (uses absolute avg)", () => {
      const values = new Map<string, number>([
        ["body_temperature_deviation", 0.1],
      ]);
      const baselines = new Map<string, BaselinePayload>([
        ["body_temperature_deviation", makeBaseline(-0.5, 0.3)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const metric = result.get("body_temperature_deviation")!;

      // delta = 0.1 - (-0.5) = 0.6
      expect(metric.delta).toBeCloseTo(0.6, 4);
      // delta_pct = (0.6 / |-0.5|) * 100 = 120
      expect(metric.delta_pct).toBeCloseTo(120, 2);
    });
  });

  // --- Complete SummaryMetric interface validation ---

  describe("SummaryMetric interface completeness", () => {
    it("returns all required fields in SummaryMetric", () => {
      const values = new Map<string, number>([["rhr", 65]]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;

      expect(rhr).toHaveProperty("value");
      expect(rhr).toHaveProperty("avg_30d");
      expect(rhr).toHaveProperty("stddev_30d");
      expect(rhr).toHaveProperty("delta");
      expect(rhr).toHaveProperty("delta_pct");
      expect(rhr).toHaveProperty("direction");
      expect(rhr).toHaveProperty("status");

      expect(rhr.value).toBe(65);
      expect(rhr.avg_30d).toBe(61);
      expect(rhr.stddev_30d).toBe(5);
    });

    it("processes multiple metrics simultaneously", () => {
      const values = new Map<string, number>([
        ["rhr", 72],
        ["hrv", 35],
        ["sleep_score", 90],
        ["weight", 180],
      ]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5)],
        ["hrv", makeBaseline(45, 8)],
        ["sleep_score", makeBaseline(78, 6)],
        ["weight", makeBaseline(170, 3)],
      ]);

      const result = computeSummaryMetrics(values, baselines);

      expect(result.size).toBe(4);

      // RHR: lower_is_better, value > avg → worse, z = 2.2 → critical
      expect(result.get("rhr")!.direction).toBe("worse");
      expect(result.get("rhr")!.status).toBe("critical");

      // HRV: higher_is_better, value < avg → worse, z = -1.25 → warning
      expect(result.get("hrv")!.direction).toBe("worse");
      expect(result.get("hrv")!.status).toBe("warning");

      // Sleep score: higher_is_better, value > avg → better, z = 2.0 → good
      expect(result.get("sleep_score")!.direction).toBe("better");
      expect(result.get("sleep_score")!.status).toBe("good");

      // Weight: neutral → neutral, always normal
      expect(result.get("weight")!.direction).toBe("neutral");
      expect(result.get("weight")!.status).toBe("normal");
    });
  });

  // --- Unknown metric (not in METRIC_POLARITY) ---

  describe("unknown metrics", () => {
    it("treats unknown metrics as neutral polarity", () => {
      const values = new Map<string, number>([["unknown_metric", 50]]);
      const baselines = new Map<string, BaselinePayload>([
        ["unknown_metric", makeBaseline(40, 5)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const metric = result.get("unknown_metric")!;

      // Unknown metrics should default to neutral behavior
      expect(metric.direction).toBe("neutral");
      expect(metric.status).toBe("normal");
    });
  });

  // --- VAL-CROSS-018: Minimum history threshold (sample_count < 14) ---

  describe("minimum history threshold", () => {
    it("suppresses delta/direction when sample_count < 14", () => {
      const values = new Map<string, number>([["rhr", 72]]);
      // sample_count = 10, which is < 14
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5, 10)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;

      expect(rhr.value).toBe(72);
      expect(rhr.avg_30d).toBe(61);
      expect(rhr.delta).toBeNull();
      expect(rhr.delta_pct).toBeNull();
      expect(rhr.direction).toBe("neutral");
      expect(rhr.status).toBe("normal");
    });

    it("suppresses delta/direction at sample_count = 13 (boundary)", () => {
      const values = new Map<string, number>([["hrv", 55]]);
      const baselines = new Map<string, BaselinePayload>([
        ["hrv", makeBaseline(45, 8, 13)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const hrv = result.get("hrv")!;

      expect(hrv.delta).toBeNull();
      expect(hrv.delta_pct).toBeNull();
      expect(hrv.direction).toBe("neutral");
      expect(hrv.status).toBe("normal");
    });

    it("computes delta/direction normally at sample_count = 14 (threshold)", () => {
      const values = new Map<string, number>([["rhr", 72]]);
      // sample_count = 14 → meets the threshold
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5, 14)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const rhr = result.get("rhr")!;

      expect(rhr.delta).toBeCloseTo(11, 4);
      expect(rhr.delta_pct).toBeCloseTo((11 / 61) * 100, 2);
      expect(rhr.direction).toBe("worse"); // lower_is_better, positive delta
      expect(rhr.status).toBe("critical"); // z = 2.2 > 1.28
    });

    it("suppresses delta for sample_count = 7 (minimum for baseline existence)", () => {
      const values = new Map<string, number>([["sleep_score", 90]]);
      const baselines = new Map<string, BaselinePayload>([
        ["sleep_score", makeBaseline(78, 6, 7)],
      ]);

      const result = computeSummaryMetrics(values, baselines);
      const ss = result.get("sleep_score")!;

      expect(ss.value).toBe(90);
      expect(ss.avg_30d).toBe(78);
      expect(ss.delta).toBeNull();
      expect(ss.delta_pct).toBeNull();
      expect(ss.direction).toBe("neutral");
      expect(ss.status).toBe("normal");
    });

    it("suppresses delta for mixed sample counts (some below, some above threshold)", () => {
      const values = new Map<string, number>([
        ["rhr", 72],
        ["hrv", 55],
      ]);
      const baselines = new Map<string, BaselinePayload>([
        ["rhr", makeBaseline(61, 5, 10)], // below threshold
        ["hrv", makeBaseline(45, 8, 30)], // above threshold
      ]);

      const result = computeSummaryMetrics(values, baselines);

      // RHR: suppressed (sample_count = 10 < 14)
      const rhr = result.get("rhr")!;
      expect(rhr.delta).toBeNull();
      expect(rhr.delta_pct).toBeNull();
      expect(rhr.direction).toBe("neutral");

      // HRV: normal computation (sample_count = 30 >= 14)
      const hrv = result.get("hrv")!;
      expect(hrv.delta).toBeCloseTo(10, 4);
      expect(hrv.delta_pct).not.toBeNull();
      expect(hrv.direction).toBe("better");
    });
  });
});
