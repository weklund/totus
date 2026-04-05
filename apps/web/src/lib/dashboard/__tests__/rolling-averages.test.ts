import { describe, it, expect, beforeEach } from "vitest";

/**
 * Unit tests for the rolling averages computation service.
 *
 * Tests cover:
 * - 7-day window: correct moving average with full window
 * - 30-day window: correct moving average with full window
 * - Gaps in data: verify no zero-fill (average over available points only)
 * - Single data point: returns that value
 * - Early dates with partial windows: use available data
 * - Empty input: returns empty array
 * - Output length matches input length
 *
 * VAL-COMP-008, VAL-COMP-009
 */

describe("computeRollingAverages", () => {
  let computeRollingAverages: typeof import("@/lib/dashboard/rolling-averages").computeRollingAverages;

  beforeEach(async () => {
    const mod = await import("@/lib/dashboard/rolling-averages");
    computeRollingAverages = mod.computeRollingAverages;
  });

  // --- Helper: generate consecutive daily data ---

  function makeData(
    startDate: string,
    values: number[],
  ): { date: string; value: number }[] {
    const start = new Date(startDate + "T00:00:00Z");
    return values.map((value, i) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + i);
      return {
        date: date.toISOString().split("T")[0]!,
        value,
      };
    });
  }

  // --- Empty input ---

  describe("empty input", () => {
    it("returns empty array for empty input", () => {
      const result = computeRollingAverages([], 7);
      expect(result).toEqual([]);
    });

    it("returns empty array for empty input with 30-day window", () => {
      const result = computeRollingAverages([], 30);
      expect(result).toEqual([]);
    });
  });

  // --- Single data point ---

  describe("single data point", () => {
    it("returns the single value for 7-day window", () => {
      const data = [{ date: "2026-03-28", value: 65 }];
      const result = computeRollingAverages(data, 7);

      expect(result).toHaveLength(1);
      expect(result[0]!.date).toBe("2026-03-28");
      expect(result[0]!.value).toBe(65);
    });

    it("returns the single value for 30-day window", () => {
      const data = [{ date: "2026-03-28", value: 42 }];
      const result = computeRollingAverages(data, 30);

      expect(result).toHaveLength(1);
      expect(result[0]!.date).toBe("2026-03-28");
      expect(result[0]!.value).toBe(42);
    });
  });

  // --- VAL-COMP-009: Early dates with partial windows ---

  describe("early dates with partial windows", () => {
    it("day 1 average equals day 1 value", () => {
      const data = makeData("2026-03-01", [10, 20, 30, 40, 50, 60, 70]);
      const result = computeRollingAverages(data, 7);

      expect(result[0]!.value).toBe(10); // Only day 1 available
    });

    it("day 2 average equals mean of days 1-2", () => {
      const data = makeData("2026-03-01", [10, 20, 30, 40, 50, 60, 70]);
      const result = computeRollingAverages(data, 7);

      expect(result[1]!.value).toBeCloseTo((10 + 20) / 2, 10);
    });

    it("day 3 average equals mean of days 1-3", () => {
      const data = makeData("2026-03-01", [10, 20, 30, 40, 50, 60, 70]);
      const result = computeRollingAverages(data, 7);

      expect(result[2]!.value).toBeCloseTo((10 + 20 + 30) / 3, 10);
    });

    it("first 3 output values match manually computed means of available points", () => {
      const data = makeData(
        "2026-03-01",
        [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      );
      const result = computeRollingAverages(data, 7);

      // Day 1: only [10] → 10
      expect(result[0]!.value).toBeCloseTo(10, 10);
      // Day 2: [10, 20] → 15
      expect(result[1]!.value).toBeCloseTo(15, 10);
      // Day 3: [10, 20, 30] → 20
      expect(result[2]!.value).toBeCloseTo(20, 10);
    });

    it("partial windows for 30-day window (fewer than 30 points)", () => {
      const data = makeData("2026-03-01", [10, 20, 30]);
      const result = computeRollingAverages(data, 30);

      // Day 1: only [10] → 10
      expect(result[0]!.value).toBe(10);
      // Day 2: [10, 20] → 15
      expect(result[1]!.value).toBeCloseTo(15, 10);
      // Day 3: [10, 20, 30] → 20
      expect(result[2]!.value).toBeCloseTo(20, 10);
    });
  });

  // --- VAL-COMP-008: 7-day window with complete data ---

  describe("7-day window", () => {
    it("computes correct 7-day rolling average with complete consecutive data", () => {
      // 10 consecutive days
      const data = makeData(
        "2026-03-01",
        [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      );
      const result = computeRollingAverages(data, 7);

      expect(result).toHaveLength(10);

      // Day 7 (index 6): mean of [10, 20, 30, 40, 50, 60, 70] = 280/7 = 40
      expect(result[6]!.value).toBeCloseTo(40, 10);

      // Day 8 (index 7): mean of [20, 30, 40, 50, 60, 70, 80] = 350/7 = 50
      expect(result[7]!.value).toBeCloseTo(50, 10);

      // Day 9 (index 8): mean of [30, 40, 50, 60, 70, 80, 90] = 420/7 = 60
      expect(result[8]!.value).toBeCloseTo(60, 10);

      // Day 10 (index 9): mean of [40, 50, 60, 70, 80, 90, 100] = 490/7 = 70
      expect(result[9]!.value).toBeCloseTo(70, 10);
    });

    it("output length matches input length", () => {
      const data = makeData("2026-03-01", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = computeRollingAverages(data, 7);
      expect(result).toHaveLength(data.length);
    });

    it("preserves dates in output", () => {
      const data = makeData("2026-03-01", [10, 20, 30]);
      const result = computeRollingAverages(data, 7);

      expect(result[0]!.date).toBe("2026-03-01");
      expect(result[1]!.date).toBe("2026-03-02");
      expect(result[2]!.date).toBe("2026-03-03");
    });

    it("constant values produce constant rolling average", () => {
      const data = makeData("2026-03-01", Array(10).fill(42));
      const result = computeRollingAverages(data, 7);

      for (const point of result) {
        expect(point.value).toBe(42);
      }
    });
  });

  // --- 30-day window ---

  describe("30-day window", () => {
    it("computes correct 30-day rolling average with complete data", () => {
      // 35 consecutive days, values = 1 through 35
      const values = Array.from({ length: 35 }, (_, i) => i + 1);
      const data = makeData("2026-02-01", values);
      const result = computeRollingAverages(data, 30);

      expect(result).toHaveLength(35);

      // Day 30 (index 29): mean of [1..30] = 465/30 = 15.5
      expect(result[29]!.value).toBeCloseTo(15.5, 10);

      // Day 31 (index 30): mean of [2..31] = 495/30 = 16.5
      expect(result[30]!.value).toBeCloseTo(16.5, 10);

      // Day 35 (index 34): mean of [6..35] = 615/30 = 20.5
      expect(result[34]!.value).toBeCloseTo(20.5, 10);
    });

    it("early dates use available data for 30-day window", () => {
      const values = Array.from({ length: 5 }, (_, i) => (i + 1) * 10);
      const data = makeData("2026-03-01", values); // [10, 20, 30, 40, 50]
      const result = computeRollingAverages(data, 30);

      // All within 30-day window, so all available points are used
      expect(result[0]!.value).toBe(10); // Day 1: [10]
      expect(result[1]!.value).toBeCloseTo(15, 10); // Day 2: [10, 20]
      expect(result[2]!.value).toBeCloseTo(20, 10); // Day 3: [10, 20, 30]
      expect(result[3]!.value).toBeCloseTo(25, 10); // Day 4: [10, 20, 30, 40]
      expect(result[4]!.value).toBeCloseTo(30, 10); // Day 5: [10, 20, 30, 40, 50]
    });
  });

  // --- VAL-COMP-008: Gaps in data (no zero-fill) ---

  describe("gaps in data (no zero-fill)", () => {
    it("averages only available points when there are gaps", () => {
      // Data with a 3-day gap
      const data = [
        { date: "2026-03-01", value: 10 },
        { date: "2026-03-02", value: 20 },
        // Gap: Mar 3, Mar 4, Mar 5 missing
        { date: "2026-03-06", value: 60 },
        { date: "2026-03-07", value: 70 },
      ];

      const result = computeRollingAverages(data, 7);

      expect(result).toHaveLength(4);

      // Mar 1: only [10] → 10
      expect(result[0]!.value).toBe(10);

      // Mar 2: [10, 20] → 15
      expect(result[1]!.value).toBeCloseTo(15, 10);

      // Mar 6: window is [Feb 28, Mar 6]. Available data in that window:
      //   Mar 1 (10), Mar 2 (20), Mar 6 (60) → (10 + 20 + 60) / 3 = 30
      expect(result[2]!.value).toBeCloseTo(30, 10);

      // Mar 7: window is [Mar 1, Mar 7]. Available data:
      //   Mar 1 (10), Mar 2 (20), Mar 6 (60), Mar 7 (70) → (10 + 20 + 60 + 70) / 4 = 40
      expect(result[3]!.value).toBeCloseTo(40, 10);
    });

    it("does NOT zero-fill missing days", () => {
      // Sparse data: only 2 data points separated by 4 days
      const data = [
        { date: "2026-03-01", value: 100 },
        { date: "2026-03-05", value: 200 },
      ];

      const result = computeRollingAverages(data, 7);

      // Mar 5: window [Feb 27, Mar 5]. Both Mar 1 and Mar 5 in window.
      // Average should be (100 + 200) / 2 = 150, NOT (100 + 0 + 0 + 0 + 200) / 5
      expect(result[1]!.value).toBeCloseTo(150, 10);
    });

    it("handles large gap exceeding window size", () => {
      // Gap larger than the 7-day window
      const data = [
        { date: "2026-03-01", value: 10 },
        { date: "2026-03-15", value: 50 }, // 14 days later — well outside 7-day window
      ];

      const result = computeRollingAverages(data, 7);

      // Mar 1: [10] → 10
      expect(result[0]!.value).toBe(10);

      // Mar 15: window is [Mar 9, Mar 15]. Only Mar 15 (50) is in window.
      // Mar 1 is outside [Mar 9, Mar 15]. So average is just 50.
      expect(result[1]!.value).toBe(50);
    });

    it("with 30-day window, gap of 15 days still includes both points", () => {
      const data = [
        { date: "2026-03-01", value: 10 },
        { date: "2026-03-16", value: 50 }, // 15 days later — within 30-day window
      ];

      const result = computeRollingAverages(data, 30);

      // Mar 16: window is [Feb 15, Mar 16]. Mar 1 (10) is within window.
      // Average = (10 + 50) / 2 = 30
      expect(result[1]!.value).toBeCloseTo(30, 10);
    });

    it("multiple gaps within the window", () => {
      // Only days 1, 3, 5, 7 have data (alternating gaps)
      const data = [
        { date: "2026-03-01", value: 10 },
        { date: "2026-03-03", value: 30 },
        { date: "2026-03-05", value: 50 },
        { date: "2026-03-07", value: 70 },
      ];

      const result = computeRollingAverages(data, 7);

      // Mar 7: window is [Mar 1, Mar 7]. All 4 points are in window.
      // Average = (10 + 30 + 50 + 70) / 4 = 40
      expect(result[3]!.value).toBeCloseTo(40, 10);
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("two data points on consecutive days with 7-day window", () => {
      const data = [
        { date: "2026-03-01", value: 40 },
        { date: "2026-03-02", value: 60 },
      ];

      const result = computeRollingAverages(data, 7);

      expect(result[0]!.value).toBe(40);
      expect(result[1]!.value).toBeCloseTo(50, 10); // (40 + 60) / 2
    });

    it("data spanning exactly 7 days", () => {
      const data = makeData("2026-03-01", [10, 20, 30, 40, 50, 60, 70]);
      const result = computeRollingAverages(data, 7);

      // Last point should average all 7: (10+20+30+40+50+60+70)/7 = 40
      expect(result[6]!.value).toBeCloseTo(40, 10);
    });

    it("handles floating point values", () => {
      const data = [
        { date: "2026-03-01", value: 1.5 },
        { date: "2026-03-02", value: 2.7 },
        { date: "2026-03-03", value: 3.3 },
      ];

      const result = computeRollingAverages(data, 7);

      expect(result[2]!.value).toBeCloseTo((1.5 + 2.7 + 3.3) / 3, 10);
    });

    it("handles negative values", () => {
      const data = [
        { date: "2026-03-01", value: -0.5 },
        { date: "2026-03-02", value: 0.3 },
        { date: "2026-03-03", value: -0.2 },
      ];

      const result = computeRollingAverages(data, 7);

      expect(result[2]!.value).toBeCloseTo((-0.5 + 0.3 + -0.2) / 3, 10);
    });

    it("handles zero values correctly", () => {
      const data = [
        { date: "2026-03-01", value: 0 },
        { date: "2026-03-02", value: 0 },
        { date: "2026-03-03", value: 10 },
      ];

      const result = computeRollingAverages(data, 7);

      expect(result[0]!.value).toBe(0);
      expect(result[1]!.value).toBe(0);
      expect(result[2]!.value).toBeCloseTo((0 + 0 + 10) / 3, 10);
    });

    it("window boundary: point exactly at window start is included", () => {
      // 7-day window on day 7: window = [day 1, day 7], day 1 should be included
      const data = makeData("2026-03-01", [100, 0, 0, 0, 0, 0, 0]);
      const result = computeRollingAverages(data, 7);

      // Day 7 (index 6): window [Mar 1, Mar 7]. Mar 1 (100) IS included.
      // Average = (100 + 0 + 0 + 0 + 0 + 0 + 0) / 7 ≈ 14.29
      expect(result[6]!.value).toBeCloseTo(100 / 7, 10);
    });

    it("window boundary: point just before window start is excluded (8 days back)", () => {
      // 7-day window: for day 8, window is [day 2, day 8]. Day 1 should be excluded.
      const data = makeData("2026-03-01", [999, 10, 10, 10, 10, 10, 10, 10]);
      const result = computeRollingAverages(data, 7);

      // Day 8 (index 7): window [Mar 2, Mar 8]. Mar 1 (999) is EXCLUDED.
      // Average = (10 + 10 + 10 + 10 + 10 + 10 + 10) / 7 = 10
      expect(result[7]!.value).toBeCloseTo(10, 10);
    });
  });

  // --- Real-world-like scenarios ---

  describe("realistic scenarios", () => {
    it("RHR data over 14 days with 7-day rolling average", () => {
      // Simulating resting heart rate data
      const rhrValues = [
        62, 60, 63, 61, 64, 59, 62, 65, 61, 60, 63, 58, 62, 61,
      ];
      const data = makeData("2026-03-15", rhrValues);
      const result = computeRollingAverages(data, 7);

      expect(result).toHaveLength(14);

      // Day 7 (index 6): mean of days 1-7 = (62+60+63+61+64+59+62)/7
      const expectedDay7 = (62 + 60 + 63 + 61 + 64 + 59 + 62) / 7;
      expect(result[6]!.value).toBeCloseTo(expectedDay7, 10);

      // Day 14 (index 13): mean of days 8-14 = (65+61+60+63+58+62+61)/7
      const expectedDay14 = (65 + 61 + 60 + 63 + 58 + 62 + 61) / 7;
      expect(result[13]!.value).toBeCloseTo(expectedDay14, 10);
    });

    it("sparse HRV data (missed some days) with 7-day window", () => {
      // HRV data with gaps (user didn't wear device some days)
      const data = [
        { date: "2026-03-01", value: 45 },
        { date: "2026-03-02", value: 48 },
        // Mar 3 missing
        { date: "2026-03-04", value: 42 },
        // Mar 5, Mar 6 missing
        { date: "2026-03-07", value: 50 },
        { date: "2026-03-08", value: 47 },
      ];

      const result = computeRollingAverages(data, 7);

      expect(result).toHaveLength(5);

      // Mar 7: window [Mar 1, Mar 7]. Available: Mar 1 (45), Mar 2 (48), Mar 4 (42), Mar 7 (50)
      // Average = (45 + 48 + 42 + 50) / 4 = 46.25
      expect(result[3]!.value).toBeCloseTo(46.25, 10);

      // Mar 8: window [Mar 2, Mar 8]. Available: Mar 2 (48), Mar 4 (42), Mar 7 (50), Mar 8 (47)
      // Average = (48 + 42 + 50 + 47) / 4 = 46.75
      expect(result[4]!.value).toBeCloseTo(46.75, 10);
    });
  });
});
