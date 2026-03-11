import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../errors";
import { validateRequest } from "../validation";

// ─── Test schemas ───────────────────────────────────────────────────────────

const createShareSchema = z.object({
  label: z.string().min(1).max(255),
  allowed_metrics: z.array(z.string()).min(1).max(21),
  data_start: z.string(),
  data_end: z.string(),
  expires_in_days: z.number().int().min(1).max(365),
  note: z.string().max(1000).optional(),
});

const simpleSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive(),
});

// ─── validateRequest ────────────────────────────────────────────────────────

describe("validateRequest", () => {
  it("returns typed result for valid input", () => {
    const body = { name: "Alice", age: 30 };
    const result = validateRequest(simpleSchema, body);

    expect(result.name).toBe("Alice");
    expect(result.age).toBe(30);
  });

  it("strips extra fields (Zod default behavior)", () => {
    const body = { name: "Alice", age: 30, extra: "field" };
    const result = validateRequest(simpleSchema, body);

    expect(result).toEqual({ name: "Alice", age: 30 });
    expect((result as Record<string, unknown>).extra).toBeUndefined();
  });

  it("throws ApiError for missing required fields", () => {
    const body = { name: "Alice" }; // missing age

    try {
      validateRequest(simpleSchema, body);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe("VALIDATION_ERROR");
      expect(apiError.statusCode).toBe(400);
      expect(apiError.message).toBe("Invalid request body");
      expect(apiError.details).toBeDefined();
      expect(apiError.details!.length).toBeGreaterThan(0);
    }
  });

  it("throws ApiError for invalid types", () => {
    const body = { name: "Alice", age: "not a number" };

    try {
      validateRequest(simpleSchema, body);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe("VALIDATION_ERROR");
      expect(apiError.statusCode).toBe(400);
    }
  });

  it("includes field paths in error details", () => {
    const body = { name: "", age: -5 };

    try {
      validateRequest(simpleSchema, body);
      expect.unreachable("Should have thrown");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.details).toBeDefined();
      const details = apiError.details as { field: string; message: string }[];
      const fields = details.map((d) => d.field);
      expect(fields).toContain("name");
    }
  });

  it("validates complex schemas correctly", () => {
    const body = {
      label: "For Dr. Patel",
      allowed_metrics: ["sleep_score", "hrv"],
      data_start: "2025-01-01",
      data_end: "2026-01-01",
      expires_in_days: 30,
      note: "Annual checkup data",
    };

    const result = validateRequest(createShareSchema, body);
    expect(result.label).toBe("For Dr. Patel");
    expect(result.allowed_metrics).toEqual(["sleep_score", "hrv"]);
    expect(result.expires_in_days).toBe(30);
    expect(result.note).toBe("Annual checkup data");
  });

  it("validates complex schema with optional field omitted", () => {
    const body = {
      label: "Test share",
      allowed_metrics: ["sleep_score"],
      data_start: "2025-01-01",
      data_end: "2026-01-01",
      expires_in_days: 7,
    };

    const result = validateRequest(createShareSchema, body);
    expect(result.note).toBeUndefined();
  });

  it("throws for empty array when min(1) required", () => {
    const body = {
      label: "Test share",
      allowed_metrics: [],
      data_start: "2025-01-01",
      data_end: "2026-01-01",
      expires_in_days: 7,
    };

    try {
      validateRequest(createShareSchema, body);
      expect.unreachable("Should have thrown");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.code).toBe("VALIDATION_ERROR");
    }
  });

  it("throws for null body", () => {
    try {
      validateRequest(simpleSchema, null);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe("VALIDATION_ERROR");
    }
  });

  it("throws for undefined body", () => {
    try {
      validateRequest(simpleSchema, undefined);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
    }
  });

  it("returns correct TypeScript type (compile-time check)", () => {
    const result = validateRequest(simpleSchema, { name: "Test", age: 25 });
    // TypeScript should infer this as { name: string; age: number }
    const name: string = result.name;
    const age: number = result.age;
    expect(typeof name).toBe("string");
    expect(typeof age).toBe("number");
  });

  it("details include field and message for each validation error", () => {
    const body = {}; // missing both required fields

    try {
      validateRequest(simpleSchema, body);
      expect.unreachable("Should have thrown");
    } catch (error) {
      const apiError = error as ApiError;
      const details = apiError.details as { field: string; message: string }[];
      for (const detail of details) {
        expect(detail).toHaveProperty("field");
        expect(detail).toHaveProperty("message");
        expect(typeof detail.field).toBe("string");
        expect(typeof detail.message).toBe("string");
      }
    }
  });
});
