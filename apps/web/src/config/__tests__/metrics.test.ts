import { describe, it, expect } from "vitest";
import {
  METRIC_TYPES,
  getMetricType,
  getAllMetricTypes,
  getMetricsByCategory,
  isValidMetricType,
  type MetricCategory,
} from "@/config/metrics";

/**
 * All metric types from the LLD Appendix 19.1
 */
const EXPECTED_METRIC_IDS = [
  "sleep_score",
  "sleep_duration",
  "sleep_efficiency",
  "sleep_latency",
  "deep_sleep",
  "rem_sleep",
  "light_sleep",
  "awake_time",
  "hrv",
  "rhr",
  "respiratory_rate",
  "body_temperature_deviation",
  "readiness_score",
  "activity_score",
  "steps",
  "active_calories",
  "total_calories",
  "spo2",
  "glucose",
  "weight",
  "body_fat",
] as const;

const EXPECTED_CATEGORIES: MetricCategory[] = [
  "Sleep",
  "Cardio",
  "Activity",
  "Body",
];

describe("Metric Registry", () => {
  describe("completeness", () => {
    it("should contain all 21 Oura metric types from the LLD", () => {
      const allMetrics = getAllMetricTypes();
      const metricIds = allMetrics.map((m) => m.id);

      for (const expectedId of EXPECTED_METRIC_IDS) {
        expect(metricIds).toContain(expectedId);
      }
    });

    it("should have exactly 21 metric types", () => {
      const allMetrics = getAllMetricTypes();
      expect(allMetrics.length).toBe(21);
    });
  });

  describe("metric type structure", () => {
    it("every metric should have required fields: id, label, unit, category, valueType, chartColor", () => {
      const allMetrics = getAllMetricTypes();

      for (const metric of allMetrics) {
        expect(metric.id).toBeDefined();
        expect(metric.id).toBeTruthy();
        expect(typeof metric.id).toBe("string");

        expect(metric.label).toBeDefined();
        expect(metric.label).toBeTruthy();
        expect(typeof metric.label).toBe("string");

        expect(metric.unit).toBeDefined();
        expect(typeof metric.unit).toBe("string");

        expect(metric.category).toBeDefined();
        expect(EXPECTED_CATEGORIES).toContain(metric.category);

        expect(metric.valueType).toBeDefined();
        expect(["integer", "float"]).toContain(metric.valueType);

        expect(metric.chartColor).toBeDefined();
        expect(metric.chartColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    it("every metric should have a sources array", () => {
      const allMetrics = getAllMetricTypes();

      for (const metric of allMetrics) {
        expect(Array.isArray(metric.sources)).toBe(true);
        expect(metric.sources.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getMetricType", () => {
    it("should return the correct metric for a valid id", () => {
      const metric = getMetricType("sleep_score");
      expect(metric).toBeDefined();
      expect(metric!.id).toBe("sleep_score");
      expect(metric!.label).toBe("Sleep Score");
      expect(metric!.unit).toBe("score");
    });

    it("should return undefined for an invalid id", () => {
      const metric = getMetricType("invalid_metric");
      expect(metric).toBeUndefined();
    });

    it("should return correct data for hrv", () => {
      const metric = getMetricType("hrv");
      expect(metric).toBeDefined();
      expect(metric!.label).toBe("Heart Rate Variability");
      expect(metric!.unit).toBe("ms");
    });

    it("should return correct data for steps", () => {
      const metric = getMetricType("steps");
      expect(metric).toBeDefined();
      expect(metric!.label).toBe("Steps");
      expect(metric!.unit).toBe("steps");
    });
  });

  describe("isValidMetricType", () => {
    it("should return true for valid metric types", () => {
      for (const id of EXPECTED_METRIC_IDS) {
        expect(isValidMetricType(id)).toBe(true);
      }
    });

    it("should return false for invalid metric types", () => {
      expect(isValidMetricType("invalid")).toBe(false);
      expect(isValidMetricType("")).toBe(false);
      expect(isValidMetricType("SLEEP_SCORE")).toBe(false); // case-sensitive
    });
  });

  describe("getMetricsByCategory", () => {
    it("should return Sleep metrics", () => {
      const sleepMetrics = getMetricsByCategory("Sleep");
      const ids = sleepMetrics.map((m) => m.id);

      expect(ids).toContain("sleep_score");
      expect(ids).toContain("sleep_duration");
      expect(ids).toContain("sleep_efficiency");
      expect(ids).toContain("sleep_latency");
      expect(ids).toContain("deep_sleep");
      expect(ids).toContain("rem_sleep");
      expect(ids).toContain("light_sleep");
      expect(ids).toContain("awake_time");
    });

    it("should return Cardio metrics", () => {
      const cardioMetrics = getMetricsByCategory("Cardio");
      const ids = cardioMetrics.map((m) => m.id);

      expect(ids).toContain("hrv");
      expect(ids).toContain("rhr");
      expect(ids).toContain("respiratory_rate");
      expect(ids).toContain("spo2");
    });

    it("should return Activity metrics", () => {
      const activityMetrics = getMetricsByCategory("Activity");
      const ids = activityMetrics.map((m) => m.id);

      expect(ids).toContain("activity_score");
      expect(ids).toContain("readiness_score");
      expect(ids).toContain("steps");
      expect(ids).toContain("active_calories");
      expect(ids).toContain("total_calories");
    });

    it("should return Body metrics", () => {
      const bodyMetrics = getMetricsByCategory("Body");
      const ids = bodyMetrics.map((m) => m.id);

      expect(ids).toContain("body_temperature_deviation");
      expect(ids).toContain("glucose");
      expect(ids).toContain("weight");
      expect(ids).toContain("body_fat");
    });

    it("all metrics should belong to exactly one category", () => {
      const allMetrics = getAllMetricTypes();
      const categorizedIds = new Set<string>();

      for (const category of EXPECTED_CATEGORIES) {
        const metricsInCategory = getMetricsByCategory(category);
        for (const metric of metricsInCategory) {
          expect(categorizedIds.has(metric.id)).toBe(false); // No duplicates across categories
          categorizedIds.add(metric.id);
        }
      }

      // Every metric should be categorized
      expect(categorizedIds.size).toBe(allMetrics.length);
    });
  });

  describe("METRIC_TYPES map", () => {
    it("should be a Map or object indexed by metric id", () => {
      expect(METRIC_TYPES).toBeDefined();
    });

    it("should have unique chart colors (no duplicates)", () => {
      const allMetrics = getAllMetricTypes();
      const colors = allMetrics.map((m) => m.chartColor);
      const uniqueColors = new Set(colors);

      expect(uniqueColors.size).toBe(colors.length);
    });

    it("should have unique labels (no duplicates)", () => {
      const allMetrics = getAllMetricTypes();
      const labels = allMetrics.map((m) => m.label);
      const uniqueLabels = new Set(labels);

      expect(uniqueLabels.size).toBe(labels.length);
    });
  });

  describe("specific metric properties", () => {
    const metricChecks: Array<{
      id: string;
      label: string;
      unit: string;
      category: MetricCategory;
      valueType: "integer" | "float";
    }> = [
      {
        id: "sleep_score",
        label: "Sleep Score",
        unit: "score",
        category: "Sleep",
        valueType: "integer",
      },
      {
        id: "sleep_duration",
        label: "Sleep Duration",
        unit: "hr",
        category: "Sleep",
        valueType: "float",
      },
      {
        id: "hrv",
        label: "Heart Rate Variability",
        unit: "ms",
        category: "Cardio",
        valueType: "float",
      },
      {
        id: "rhr",
        label: "Resting Heart Rate",
        unit: "bpm",
        category: "Cardio",
        valueType: "integer",
      },
      {
        id: "steps",
        label: "Steps",
        unit: "steps",
        category: "Activity",
        valueType: "integer",
      },
      {
        id: "active_calories",
        label: "Active Calories",
        unit: "kcal",
        category: "Activity",
        valueType: "integer",
      },
      {
        id: "body_temperature_deviation",
        label: "Body Temp Deviation",
        unit: "°C",
        category: "Body",
        valueType: "float",
      },
      {
        id: "readiness_score",
        label: "Readiness Score",
        unit: "score",
        category: "Activity",
        valueType: "integer",
      },
      {
        id: "spo2",
        label: "Blood Oxygen",
        unit: "%",
        category: "Cardio",
        valueType: "float",
      },
    ];

    for (const check of metricChecks) {
      it(`${check.id} should have correct properties`, () => {
        const metric = getMetricType(check.id);
        expect(metric).toBeDefined();
        expect(metric!.label).toBe(check.label);
        expect(metric!.unit).toBe(check.unit);
        expect(metric!.category).toBe(check.category);
        expect(metric!.valueType).toBe(check.valueType);
      });
    }
  });
});
