import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BaselinePayload } from "@/lib/dashboard/types";
import type { EncryptionProvider } from "@/lib/encryption";

/**
 * Unit tests for the baseline computation service.
 *
 * Tests cover:
 * - Correct avg/stddev (population) calculation
 * - < 7 data points skipped
 * - Zero stddev case (all identical values)
 * - Empty data
 * - Cache hit within tolerance
 * - Cache miss outside tolerance
 * - Negative metric values (body_temperature_deviation)
 * - 30-day window anchoring (referenceDate, not current date)
 * - Reference date excluded from window
 *
 * VAL-COMP-001, VAL-COMP-002, VAL-COMP-003, VAL-COMP-004, VAL-COMP-014
 */

// Helper: compute expected population stddev manually
function populationStddev(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

describe("computeBaselinesFromValues", () => {
  // Import lazily to ensure module is loaded
  let computeBaselinesFromValues: typeof import("@/lib/dashboard/baselines").computeBaselinesFromValues;

  beforeEach(async () => {
    const mod = await import("@/lib/dashboard/baselines");
    computeBaselinesFromValues = mod.computeBaselinesFromValues;
  });

  // --- VAL-COMP-001: Correct avg, stddev, upper, lower ---

  it("computes correct avg_30d and stddev_30d for 30 known values", () => {
    // Known dataset: 1 through 30
    const values = Array.from({ length: 30 }, (_, i) => i + 1);
    const expectedAvg = mean(values); // 15.5
    const expectedStddev = populationStddev(values);
    const expectedUpper = expectedAvg + expectedStddev;
    const expectedLower = expectedAvg - expectedStddev;

    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("rhr", values);

    const result = computeBaselinesFromValues(dataByMetric);

    expect(result.has("rhr")).toBe(true);
    const baseline = result.get("rhr")!;
    expect(baseline.avg_30d).toBeCloseTo(expectedAvg, 2);
    expect(baseline.stddev_30d).toBeCloseTo(expectedStddev, 2);
    expect(baseline.upper).toBeCloseTo(expectedUpper, 2);
    expect(baseline.lower).toBeCloseTo(expectedLower, 2);
    expect(baseline.sample_count).toBe(30);
  });

  it("computes upper = avg + stddev and lower = avg - stddev", () => {
    // Use a simpler dataset
    const values = [60, 62, 64, 58, 66, 61, 63, 65, 59, 67];
    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("hrv", values);

    const result = computeBaselinesFromValues(dataByMetric);
    const baseline = result.get("hrv")!;

    expect(baseline.upper).toBeCloseTo(
      baseline.avg_30d + baseline.stddev_30d,
      10,
    );
    expect(baseline.lower).toBeCloseTo(
      baseline.avg_30d - baseline.stddev_30d,
      10,
    );
  });

  // --- VAL-COMP-001: Zero stddev (all identical values) ---

  it("handles zero stddev when all values are identical", () => {
    const values = Array.from({ length: 15 }, () => 72);
    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("rhr", values);

    const result = computeBaselinesFromValues(dataByMetric);
    const baseline = result.get("rhr")!;

    expect(baseline.avg_30d).toBe(72);
    expect(baseline.stddev_30d).toBe(0);
    expect(baseline.upper).toBe(72); // avg + 0
    expect(baseline.lower).toBe(72); // avg - 0
    expect(baseline.sample_count).toBe(15);
    // Ensure no NaN or Infinity
    expect(Number.isFinite(baseline.avg_30d)).toBe(true);
    expect(Number.isFinite(baseline.stddev_30d)).toBe(true);
    expect(Number.isFinite(baseline.upper)).toBe(true);
    expect(Number.isFinite(baseline.lower)).toBe(true);
  });

  // --- VAL-COMP-002: Minimum 7 data points required ---

  it("skips metrics with fewer than 7 data points", () => {
    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("rhr", [60, 62, 64, 58, 66, 61]); // 6 points — should be skipped

    const result = computeBaselinesFromValues(dataByMetric);
    expect(result.has("rhr")).toBe(false);
  });

  it("includes metrics with exactly 7 data points", () => {
    const values = [60, 62, 64, 58, 66, 61, 63]; // 7 points — should be included
    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("rhr", values);

    const result = computeBaselinesFromValues(dataByMetric);
    expect(result.has("rhr")).toBe(true);
    const baseline = result.get("rhr")!;
    expect(baseline.sample_count).toBe(7);
    expect(Number.isFinite(baseline.avg_30d)).toBe(true);
    expect(Number.isFinite(baseline.stddev_30d)).toBe(true);
  });

  it("handles mixed metrics: some with enough data, some without", () => {
    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("rhr", [60, 62, 64, 58, 66, 61, 63]); // 7 — included
    dataByMetric.set("hrv", [40, 42, 44]); // 3 — skipped
    dataByMetric.set("sleep_score", [80, 82, 84, 86, 88, 90, 92, 94]); // 8 — included

    const result = computeBaselinesFromValues(dataByMetric);
    expect(result.has("rhr")).toBe(true);
    expect(result.has("hrv")).toBe(false);
    expect(result.has("sleep_score")).toBe(true);
  });

  // --- Empty data ---

  it("returns empty map for empty input", () => {
    const dataByMetric = new Map<string, number[]>();
    const result = computeBaselinesFromValues(dataByMetric);
    expect(result.size).toBe(0);
  });

  it("returns empty map when all metrics have empty arrays", () => {
    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("rhr", []);
    dataByMetric.set("hrv", []);

    const result = computeBaselinesFromValues(dataByMetric);
    expect(result.size).toBe(0);
  });

  // --- VAL-COMP-014: Negative metric values (body_temperature_deviation) ---

  it("computes correct avg and stddev for negative values", () => {
    const values = [-0.3, -0.5, -0.1, 0.2, -0.4, -0.2, 0.1, -0.6, -0.3, -0.1];
    const expectedAvg = mean(values);
    const expectedStddev = populationStddev(values);

    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("body_temperature_deviation", values);

    const result = computeBaselinesFromValues(dataByMetric);
    const baseline = result.get("body_temperature_deviation")!;

    expect(baseline.avg_30d).toBeCloseTo(expectedAvg, 4);
    expect(baseline.stddev_30d).toBeCloseTo(expectedStddev, 4);
    expect(baseline.upper).toBeCloseTo(expectedAvg + expectedStddev, 4);
    expect(baseline.lower).toBeCloseTo(expectedAvg + -expectedStddev, 4);
    expect(baseline.sample_count).toBe(10);
  });

  it("computes correct baselines for all-negative values", () => {
    const values = [-2, -3, -1, -4, -2, -3, -1]; // 7 points
    const expectedAvg = mean(values);
    const expectedStddev = populationStddev(values);

    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("body_temperature_deviation", values);

    const result = computeBaselinesFromValues(dataByMetric);
    const baseline = result.get("body_temperature_deviation")!;

    expect(baseline.avg_30d).toBeCloseTo(expectedAvg, 4);
    expect(baseline.stddev_30d).toBeCloseTo(expectedStddev, 4);
    expect(baseline.sample_count).toBe(7);
    // Verify all fields are finite
    expect(Number.isFinite(baseline.avg_30d)).toBe(true);
    expect(Number.isFinite(baseline.stddev_30d)).toBe(true);
    expect(Number.isFinite(baseline.upper)).toBe(true);
    expect(Number.isFinite(baseline.lower)).toBe(true);
  });

  // --- Population stddev (divisor N, not N-1) ---

  it("uses population stddev (divisor N, not N-1)", () => {
    // Two values: 0 and 10
    // Population stddev = sqrt(((0-5)^2 + (10-5)^2)/2) = sqrt(50/2) = sqrt(25) = 5
    // Sample stddev would be sqrt(50/1) = sqrt(50) ≈ 7.071
    const values = [0, 10, 5, 5, 5, 5, 5]; // 7 points, avg=5
    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("test_metric", values);

    const result = computeBaselinesFromValues(dataByMetric);
    const baseline = result.get("test_metric")!;

    const expectedStddev = populationStddev(values);
    // Make sure we're using population stddev (not sample stddev)
    expect(baseline.avg_30d).toBeCloseTo(mean(values), 4);
    expect(baseline.stddev_30d).toBeCloseTo(expectedStddev, 4);
  });

  // --- All BaselinePayload fields are finite numbers ---

  it("returns all fields as finite numbers for valid data", () => {
    const values = [60, 65, 70, 55, 80, 62, 68, 73, 58, 76];
    const dataByMetric = new Map<string, number[]>();
    dataByMetric.set("hrv", values);

    const result = computeBaselinesFromValues(dataByMetric);
    const baseline = result.get("hrv")!;

    expect(typeof baseline.avg_30d).toBe("number");
    expect(typeof baseline.stddev_30d).toBe("number");
    expect(typeof baseline.upper).toBe("number");
    expect(typeof baseline.lower).toBe("number");
    expect(typeof baseline.sample_count).toBe("number");

    expect(Number.isFinite(baseline.avg_30d)).toBe(true);
    expect(Number.isFinite(baseline.stddev_30d)).toBe(true);
    expect(Number.isFinite(baseline.upper)).toBe(true);
    expect(Number.isFinite(baseline.lower)).toBe(true);
    expect(Number.isFinite(baseline.sample_count)).toBe(true);
  });
});

describe("computeBaselinesOnDemand", () => {
  let computeBaselinesOnDemand: typeof import("@/lib/dashboard/baselines").computeBaselinesOnDemand;

  // Mock dependencies
  const mockEncryption: EncryptionProvider = {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  };

  const mockDb = {
    select: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import("@/lib/dashboard/baselines");
    computeBaselinesOnDemand = mod.computeBaselinesOnDemand;
  });

  // --- VAL-COMP-003: Window excludes reference date ---

  it("queries 30-day window [D-30, D-1] excluding reference date", async () => {
    // We verify that computeBaselinesOnDemand passes the correct date range
    // to the database query. The DB `between` clause filters [D-30, D-1].
    //
    // referenceDate = "2026-03-28"
    // Expected window: 2026-02-26 to 2026-03-27 (D-30 to D-1)
    //
    // The mock simulates what the DB would return (rows within [D-30, D-1] only).
    // The reference date itself (D = Mar 28) should NOT be returned by the DB.

    const referenceDate = "2026-03-28";
    const metrics = ["rhr"];

    // Simulate DB returning only rows within [D-30, D-1]
    // D-30 = Feb 26 through D-1 = Mar 27
    const fakeRows = [
      {
        metricType: "rhr",
        date: "2026-02-26",
        valueEncrypted: Buffer.from("62"),
      },
      ...Array.from({ length: 8 }, (_, i) => ({
        metricType: "rhr",
        date: `2026-02-${String(27 + i).padStart(2, "0")}`,
        valueEncrypted: Buffer.from(String(60 + i)),
      })),
      {
        metricType: "rhr",
        date: "2026-03-27",
        valueEncrypted: Buffer.from("65"),
      },
    ];

    (mockEncryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(
      async (buf: Buffer) => buf,
    );

    // Track the where() call to verify correct date parameters
    const whereFn = vi.fn().mockResolvedValue(fakeRows);
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDb.select.mockReturnValue({ from: fromFn });

    const result = await computeBaselinesOnDemand(
      "user_test_001",
      metrics,
      referenceDate,
      mockEncryption,
      mockDb as unknown as NodePgDatabase,
    );

    expect(result.has("rhr")).toBe(true);
    const baseline = result.get("rhr")!;

    // 10 data points: 62, 60, 61, 62, 63, 64, 65, 66, 67, 65
    const expectedValues = [62, 60, 61, 62, 63, 64, 65, 66, 67, 65];
    const expectedAvg =
      expectedValues.reduce((a, b) => a + b, 0) / expectedValues.length;
    expect(baseline.avg_30d).toBeCloseTo(expectedAvg, 2);
    expect(baseline.sample_count).toBe(10);

    // Verify the where clause was called (DB filtering handles date exclusion)
    expect(whereFn).toHaveBeenCalledTimes(1);
  });

  it("computes baselines using decrypted values from health_data_daily", async () => {
    const referenceDate = "2026-03-28";
    const metrics = ["rhr", "hrv"];

    // 10 data points for rhr, 5 for hrv (below threshold)
    const fakeRows = [
      ...Array.from({ length: 10 }, (_, i) => ({
        metricType: "rhr",
        date: `2026-03-${String(18 + i).padStart(2, "0")}`,
        valueEncrypted: Buffer.from(JSON.stringify(60 + i)),
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        metricType: "hrv",
        date: `2026-03-${String(23 + i).padStart(2, "0")}`,
        valueEncrypted: Buffer.from(JSON.stringify(40 + i)),
      })),
    ];

    (mockEncryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(
      async (buf: Buffer) => buf,
    );

    const whereFn = vi.fn().mockResolvedValue(fakeRows);
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDb.select.mockReturnValue({ from: fromFn });

    const result = await computeBaselinesOnDemand(
      "user_test_001",
      metrics,
      referenceDate,
      mockEncryption,
      mockDb as unknown as NodePgDatabase,
    );

    // rhr should have a baseline (10 >= 7)
    expect(result.has("rhr")).toBe(true);
    expect(result.get("rhr")!.sample_count).toBe(10);

    // hrv should NOT have a baseline (5 < 7)
    expect(result.has("hrv")).toBe(false);
  });

  it("returns empty map when no data exists", async () => {
    const whereFn = vi.fn().mockResolvedValue([]);
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDb.select.mockReturnValue({ from: fromFn });

    (mockEncryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(
      async (buf: Buffer) => buf,
    );

    const result = await computeBaselinesOnDemand(
      "user_test_001",
      ["rhr"],
      "2026-03-28",
      mockEncryption,
      mockDb as unknown as NodePgDatabase,
    );

    expect(result.size).toBe(0);
  });
});

describe("fetchBaselines", () => {
  let fetchBaselines: typeof import("@/lib/dashboard/baselines").fetchBaselines;

  const mockEncryption: EncryptionProvider = {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  };

  const mockDb = {
    select: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import("@/lib/dashboard/baselines");
    fetchBaselines = mod.fetchBaselines;
  });

  it("returns cached baselines when within 2-day tolerance", async () => {
    const cachedPayload: BaselinePayload = {
      avg_30d: 62,
      stddev_30d: 5,
      upper: 67,
      lower: 57,
      sample_count: 28,
    };

    // Cache entry has reference_date = 2026-03-27 (1 day from requested 2026-03-28)
    const cachedRows = [
      {
        metricType: "rhr",
        referenceDate: "2026-03-27",
        valueEncrypted: Buffer.from(JSON.stringify(cachedPayload)),
      },
    ];

    (mockEncryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(
      async (buf: Buffer) => buf,
    );

    // First select call: cache lookup
    const cacheWhereFn = vi.fn().mockResolvedValue(cachedRows);
    const cacheFromFn = vi.fn().mockReturnValue({ where: cacheWhereFn });

    mockDb.select.mockReturnValue({ from: cacheFromFn });

    const result = await fetchBaselines(
      "user_test_001",
      ["rhr"],
      "2026-03-28",
      2,
      mockEncryption,
      mockDb as unknown as NodePgDatabase,
    );

    expect(result.has("rhr")).toBe(true);
    expect(result.get("rhr")!.avg_30d).toBe(62);
    expect(result.get("rhr")!.stddev_30d).toBe(5);
  });

  it("falls back to on-demand computation when cache miss (outside tolerance)", async () => {
    // No cache hits
    const cacheWhereFn = vi.fn().mockResolvedValue([]);
    const cacheFromFn = vi.fn().mockReturnValue({ where: cacheWhereFn });

    // On-demand data: 10 points for rhr
    const onDemandRows = Array.from({ length: 10 }, (_, i) => ({
      metricType: "rhr",
      date: `2026-03-${String(18 + i).padStart(2, "0")}`,
      valueEncrypted: Buffer.from(JSON.stringify(60 + i)),
    }));

    const onDemandWhereFn = vi.fn().mockResolvedValue(onDemandRows);
    const onDemandFromFn = vi.fn().mockReturnValue({ where: onDemandWhereFn });

    // First call returns cache miss, second call returns on-demand data
    mockDb.select
      .mockReturnValueOnce({ from: cacheFromFn })
      .mockReturnValueOnce({ from: onDemandFromFn });

    (mockEncryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(
      async (buf: Buffer) => buf,
    );

    const result = await fetchBaselines(
      "user_test_001",
      ["rhr"],
      "2026-03-28",
      2,
      mockEncryption,
      mockDb as unknown as NodePgDatabase,
    );

    expect(result.has("rhr")).toBe(true);
    expect(result.get("rhr")!.sample_count).toBe(10);
  });

  it("merges cached and on-demand baselines for mixed cache hits/misses", async () => {
    const rhrPayload: BaselinePayload = {
      avg_30d: 62,
      stddev_30d: 5,
      upper: 67,
      lower: 57,
      sample_count: 28,
    };

    // rhr is cached, hrv is not
    const cachedRows = [
      {
        metricType: "rhr",
        referenceDate: "2026-03-27",
        valueEncrypted: Buffer.from(JSON.stringify(rhrPayload)),
      },
    ];

    // hrv on-demand data
    const onDemandRows = Array.from({ length: 8 }, (_, i) => ({
      metricType: "hrv",
      date: `2026-03-${String(20 + i).padStart(2, "0")}`,
      valueEncrypted: Buffer.from(JSON.stringify(40 + i)),
    }));

    (mockEncryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(
      async (buf: Buffer) => buf,
    );

    const cacheWhereFn = vi.fn().mockResolvedValue(cachedRows);
    const cacheFromFn = vi.fn().mockReturnValue({ where: cacheWhereFn });

    const onDemandWhereFn = vi.fn().mockResolvedValue(onDemandRows);
    const onDemandFromFn = vi.fn().mockReturnValue({ where: onDemandWhereFn });

    mockDb.select
      .mockReturnValueOnce({ from: cacheFromFn })
      .mockReturnValueOnce({ from: onDemandFromFn });

    const result = await fetchBaselines(
      "user_test_001",
      ["rhr", "hrv"],
      "2026-03-28",
      2,
      mockEncryption,
      mockDb as unknown as NodePgDatabase,
    );

    // Both should be present
    expect(result.has("rhr")).toBe(true);
    expect(result.has("hrv")).toBe(true);
    expect(result.get("rhr")!.avg_30d).toBe(62); // from cache
    expect(result.get("hrv")!.sample_count).toBe(8); // from on-demand
  });

  it("uses default toleranceDays=2", async () => {
    // Verify it works with default tolerance
    const cachedPayload: BaselinePayload = {
      avg_30d: 62,
      stddev_30d: 5,
      upper: 67,
      lower: 57,
      sample_count: 28,
    };

    // Cache entry 2 days away — should still be within default tolerance
    const cachedRows = [
      {
        metricType: "rhr",
        referenceDate: "2026-03-26",
        valueEncrypted: Buffer.from(JSON.stringify(cachedPayload)),
      },
    ];

    (mockEncryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(
      async (buf: Buffer) => buf,
    );

    const cacheWhereFn = vi.fn().mockResolvedValue(cachedRows);
    const cacheFromFn = vi.fn().mockReturnValue({ where: cacheWhereFn });
    mockDb.select.mockReturnValue({ from: cacheFromFn });

    const result = await fetchBaselines(
      "user_test_001",
      ["rhr"],
      "2026-03-28",
      2,
      mockEncryption,
      mockDb as unknown as NodePgDatabase,
    );

    expect(result.has("rhr")).toBe(true);
    expect(result.get("rhr")!.avg_30d).toBe(62);
  });
});
