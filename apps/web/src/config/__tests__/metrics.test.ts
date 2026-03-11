import { describe, it, expect } from "vitest";
import {
  METRIC_TYPES,
  getMetricType,
  getAllMetricTypes,
  getMetricsByCategory,
  getMetricsByDataType,
  getMetricsByProvider,
  isValidMetricType,
  type MetricCategory,
  type DataType,
} from "@/config/metrics";

/**
 * All metric type IDs from the integrations pipeline LLD §4.2
 */
const EXPECTED_METRIC_IDS = [
  // Sleep
  "sleep_score",
  "sleep_duration",
  "sleep_efficiency",
  "sleep_latency",
  "deep_sleep",
  "rem_sleep",
  "light_sleep",
  "awake_time",
  "sleep_stage",
  // Cardiovascular
  "hrv",
  "rhr",
  "respiratory_rate",
  "spo2",
  "spo2_interval",
  "heart_rate",
  // Activity
  "activity_score",
  "steps",
  "active_calories",
  "total_calories",
  "workout",
  // Metabolic
  "glucose",
  // Body
  "body_temperature_deviation",
  "weight",
  "bmi",
  "body_fat_pct",
  "muscle_mass_kg",
  "bone_mass_kg",
  "hydration_kg",
  "visceral_fat_index",
  // Recovery
  "readiness_score",
  // Nutrition
  "calories_consumed",
  "protein_g",
  "carbs_g",
  "fat_g",
  "fiber_g",
  "sugar_g",
  "saturated_fat_g",
  "sodium_mg",
  "potassium_mg",
  "calcium_mg",
  "iron_mg",
  "magnesium_mg",
  "zinc_mg",
  "vitamin_a_mcg",
  "vitamin_c_mg",
  "vitamin_d_mcg",
  "vitamin_b12_mcg",
  "folate_mcg",
  "meal",
] as const;

const EXPECTED_CATEGORIES: MetricCategory[] = [
  "sleep",
  "cardiovascular",
  "activity",
  "metabolic",
  "body",
  "recovery",
  "nutrition",
];

const EXPECTED_DATA_TYPES: DataType[] = ["daily", "series", "period"];

describe("Metric Registry", () => {
  describe("completeness", () => {
    it("should contain all metric types from the LLD taxonomy", () => {
      const allMetrics = getAllMetricTypes();
      const metricIds = allMetrics.map((m) => m.id);

      for (const expectedId of EXPECTED_METRIC_IDS) {
        expect(metricIds).toContain(expectedId);
      }
    });

    it("should have approximately 50 metric types", () => {
      const allMetrics = getAllMetricTypes();
      expect(allMetrics.length).toBeGreaterThanOrEqual(48);
      expect(allMetrics.length).toBeLessThanOrEqual(55);
    });
  });

  describe("metric type structure", () => {
    it("every metric should have required fields", () => {
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

        expect(metric.subcategory).toBeDefined();
        expect(typeof metric.subcategory).toBe("string");

        expect(metric.valueType).toBeDefined();
        expect(["integer", "float", "none"]).toContain(metric.valueType);

        expect(metric.dataType).toBeDefined();
        expect(EXPECTED_DATA_TYPES).toContain(metric.dataType);

        expect(metric.chartColor).toBeDefined();
        expect(metric.chartColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    it("every metric should have a providers array with at least one provider", () => {
      const allMetrics = getAllMetricTypes();

      for (const metric of allMetrics) {
        expect(Array.isArray(metric.providers)).toBe(true);
        expect(metric.providers.length).toBeGreaterThan(0);
      }
    });

    it("should NOT have ouraField property", () => {
      const allMetrics = getAllMetricTypes();

      for (const metric of allMetrics) {
        expect(
          "ouraField" in metric,
          `metric ${metric.id} should not have ouraField`,
        ).toBe(false);
      }
    });

    it("period-type metrics should have valueType 'none'", () => {
      const periodMetrics = getMetricsByDataType("period");
      for (const metric of periodMetrics) {
        expect(metric.valueType).toBe("none");
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
      expect(metric!.dataType).toBe("daily");
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
      expect(metric!.providers).toContain("oura");
    });

    it("should return correct data for glucose (series type)", () => {
      const metric = getMetricType("glucose");
      expect(metric).toBeDefined();
      expect(metric!.dataType).toBe("series");
      expect(metric!.category).toBe("metabolic");
      expect(metric!.providers).toContain("dexcom");
    });

    it("should return correct data for sleep_stage (period type)", () => {
      const metric = getMetricType("sleep_stage");
      expect(metric).toBeDefined();
      expect(metric!.dataType).toBe("period");
      expect(metric!.valueType).toBe("none");
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
      expect(isValidMetricType("SLEEP_SCORE")).toBe(false);
    });
  });

  describe("getMetricsByCategory", () => {
    it("should return sleep metrics", () => {
      const sleepMetrics = getMetricsByCategory("sleep");
      const ids = sleepMetrics.map((m) => m.id);

      expect(ids).toContain("sleep_score");
      expect(ids).toContain("sleep_duration");
      expect(ids).toContain("sleep_stage");
    });

    it("should return cardiovascular metrics", () => {
      const cardioMetrics = getMetricsByCategory("cardiovascular");
      const ids = cardioMetrics.map((m) => m.id);

      expect(ids).toContain("hrv");
      expect(ids).toContain("rhr");
      expect(ids).toContain("heart_rate");
      expect(ids).toContain("spo2_interval");
    });

    it("should return activity metrics", () => {
      const activityMetrics = getMetricsByCategory("activity");
      const ids = activityMetrics.map((m) => m.id);

      expect(ids).toContain("activity_score");
      expect(ids).toContain("steps");
      expect(ids).toContain("workout");
    });

    it("should return nutrition metrics", () => {
      const nutritionMetrics = getMetricsByCategory("nutrition");
      const ids = nutritionMetrics.map((m) => m.id);

      expect(ids).toContain("calories_consumed");
      expect(ids).toContain("protein_g");
      expect(ids).toContain("meal");
    });

    it("should return body metrics", () => {
      const bodyMetrics = getMetricsByCategory("body");
      const ids = bodyMetrics.map((m) => m.id);

      expect(ids).toContain("weight");
      expect(ids).toContain("bmi");
      expect(ids).toContain("body_fat_pct");
    });

    it("should return recovery metrics", () => {
      const recoveryMetrics = getMetricsByCategory("recovery");
      const ids = recoveryMetrics.map((m) => m.id);

      expect(ids).toContain("readiness_score");
    });

    it("all metrics should belong to exactly one category", () => {
      const allMetrics = getAllMetricTypes();
      const categorizedIds = new Set<string>();

      for (const category of EXPECTED_CATEGORIES) {
        const metricsInCategory = getMetricsByCategory(category);
        for (const metric of metricsInCategory) {
          expect(categorizedIds.has(metric.id)).toBe(false);
          categorizedIds.add(metric.id);
        }
      }

      expect(categorizedIds.size).toBe(allMetrics.length);
    });
  });

  describe("getMetricsByDataType", () => {
    it("should return daily metrics", () => {
      const dailyMetrics = getMetricsByDataType("daily");
      expect(dailyMetrics.length).toBeGreaterThan(20);
      expect(dailyMetrics.every((m) => m.dataType === "daily")).toBe(true);
    });

    it("should return series metrics", () => {
      const seriesMetrics = getMetricsByDataType("series");
      expect(seriesMetrics.length).toBeGreaterThanOrEqual(3);
      const ids = seriesMetrics.map((m) => m.id);
      expect(ids).toContain("heart_rate");
      expect(ids).toContain("glucose");
      expect(ids).toContain("spo2_interval");
    });

    it("should return period metrics", () => {
      const periodMetrics = getMetricsByDataType("period");
      expect(periodMetrics.length).toBeGreaterThanOrEqual(3);
      const ids = periodMetrics.map((m) => m.id);
      expect(ids).toContain("sleep_stage");
      expect(ids).toContain("workout");
      expect(ids).toContain("meal");
    });
  });

  describe("getMetricsByProvider", () => {
    it("should return oura metrics", () => {
      const ouraMetrics = getMetricsByProvider("oura");
      expect(ouraMetrics.length).toBeGreaterThanOrEqual(18);
      const ids = ouraMetrics.map((m) => m.id);
      expect(ids).toContain("sleep_score");
      expect(ids).toContain("hrv");
      expect(ids).toContain("heart_rate");
    });

    it("should return dexcom metrics (glucose only)", () => {
      const dexcomMetrics = getMetricsByProvider("dexcom");
      expect(dexcomMetrics.length).toBeGreaterThanOrEqual(1);
      const ids = dexcomMetrics.map((m) => m.id);
      expect(ids).toContain("glucose");
    });

    it("should return withings metrics (body composition)", () => {
      const withingsMetrics = getMetricsByProvider("withings");
      expect(withingsMetrics.length).toBeGreaterThanOrEqual(5);
      const ids = withingsMetrics.map((m) => m.id);
      expect(ids).toContain("weight");
      expect(ids).toContain("body_fat_pct");
    });

    it("should return cronometer metrics (nutrition)", () => {
      const cronometerMetrics = getMetricsByProvider("cronometer");
      expect(cronometerMetrics.length).toBeGreaterThanOrEqual(18);
      const ids = cronometerMetrics.map((m) => m.id);
      expect(ids).toContain("calories_consumed");
      expect(ids).toContain("protein_g");
      expect(ids).toContain("meal");
    });
  });

  describe("METRIC_TYPES map", () => {
    it("should be a Map indexed by metric id", () => {
      expect(METRIC_TYPES).toBeDefined();
      expect(METRIC_TYPES instanceof Map).toBe(true);
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
      valueType: "integer" | "float" | "none";
      dataType: DataType;
    }> = [
      {
        id: "sleep_score",
        label: "Sleep Score",
        unit: "score",
        category: "sleep",
        valueType: "integer",
        dataType: "daily",
      },
      {
        id: "sleep_duration",
        label: "Sleep Duration",
        unit: "hr",
        category: "sleep",
        valueType: "float",
        dataType: "daily",
      },
      {
        id: "hrv",
        label: "Heart Rate Variability",
        unit: "ms",
        category: "cardiovascular",
        valueType: "float",
        dataType: "daily",
      },
      {
        id: "rhr",
        label: "Resting Heart Rate",
        unit: "bpm",
        category: "cardiovascular",
        valueType: "integer",
        dataType: "daily",
      },
      {
        id: "steps",
        label: "Steps",
        unit: "steps",
        category: "activity",
        valueType: "integer",
        dataType: "daily",
      },
      {
        id: "active_calories",
        label: "Active Calories",
        unit: "kcal",
        category: "activity",
        valueType: "integer",
        dataType: "daily",
      },
      {
        id: "body_temperature_deviation",
        label: "Body Temp Deviation",
        unit: "°C",
        category: "body",
        valueType: "float",
        dataType: "daily",
      },
      {
        id: "readiness_score",
        label: "Readiness Score",
        unit: "score",
        category: "recovery",
        valueType: "integer",
        dataType: "daily",
      },
      {
        id: "spo2",
        label: "Blood Oxygen (avg)",
        unit: "%",
        category: "cardiovascular",
        valueType: "float",
        dataType: "daily",
      },
      {
        id: "glucose",
        label: "Glucose",
        unit: "mg/dL",
        category: "metabolic",
        valueType: "float",
        dataType: "series",
      },
      {
        id: "sleep_stage",
        label: "Sleep Stage",
        unit: "—",
        category: "sleep",
        valueType: "none",
        dataType: "period",
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
        expect(metric!.dataType).toBe(check.dataType);
      });
    }
  });
});
