import { describe, expect, it, vi } from "vitest";
import { ApiError, createErrorResponse } from "../errors";

// ─── ApiError class ─────────────────────────────────────────────────────────

describe("ApiError", () => {
  it("has correct name", () => {
    const error = new ApiError("VALIDATION_ERROR", "Invalid input", 400);
    expect(error.name).toBe("ApiError");
  });

  it("has correct code", () => {
    const error = new ApiError("VALIDATION_ERROR", "Invalid input", 400);
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("has correct message", () => {
    const error = new ApiError("VALIDATION_ERROR", "Invalid input", 400);
    expect(error.message).toBe("Invalid input");
  });

  it("has correct statusCode", () => {
    const error = new ApiError("NOT_FOUND", "Not found", 404);
    expect(error.statusCode).toBe(404);
  });

  it("stores details when provided", () => {
    const details = [{ field: "email", message: "Required" }];
    const error = new ApiError(
      "VALIDATION_ERROR",
      "Invalid input",
      400,
      details,
    );
    expect(error.details).toEqual(details);
  });

  it("defaults details to undefined", () => {
    const error = new ApiError("VALIDATION_ERROR", "Invalid input", 400);
    expect(error.details).toBeUndefined();
  });

  it("is an instance of Error", () => {
    const error = new ApiError("INTERNAL_ERROR", "Unexpected", 500);
    expect(error).toBeInstanceOf(Error);
  });

  it("is an instance of ApiError", () => {
    const error = new ApiError("INTERNAL_ERROR", "Unexpected", 500);
    expect(error).toBeInstanceOf(ApiError);
  });

  it("works with all standard HTTP error codes", () => {
    const codes: [string, number][] = [
      ["VALIDATION_ERROR", 400],
      ["UNAUTHORIZED", 401],
      ["FORBIDDEN", 403],
      ["NOT_FOUND", 404],
      ["CONFLICT", 409],
      ["RATE_LIMITED", 429],
      ["INTERNAL_ERROR", 500],
      ["SERVICE_UNAVAILABLE", 503],
    ];

    for (const [code, statusCode] of codes) {
      const error = new ApiError(code, `Error: ${code}`, statusCode);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(statusCode);
    }
  });
});

// ─── createErrorResponse ────────────────────────────────────────────────────

describe("createErrorResponse", () => {
  it("returns correct status code for ApiError", async () => {
    const error = new ApiError("VALIDATION_ERROR", "Invalid input", 400);
    const response = createErrorResponse(error);

    expect(response.status).toBe(400);
  });

  it("returns standard error envelope for ApiError", async () => {
    const error = new ApiError("VALIDATION_ERROR", "Invalid input", 400);
    const response = createErrorResponse(error);
    const body = await response.json();

    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
      },
    });
  });

  it("includes details when present in ApiError", async () => {
    const details = [
      { field: "email", message: "Required" },
      { field: "name", message: "Must be at least 1 character" },
    ];
    const error = new ApiError(
      "VALIDATION_ERROR",
      "Invalid input",
      400,
      details,
    );
    const response = createErrorResponse(error);
    const body = await response.json();

    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details,
      },
    });
  });

  it("omits details when empty array in ApiError", async () => {
    const error = new ApiError("VALIDATION_ERROR", "Invalid input", 400, []);
    const response = createErrorResponse(error);
    const body = await response.json();

    expect(body.error.details).toBeUndefined();
  });

  it("returns 500 for unknown errors", async () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = createErrorResponse(new Error("Something broke"));
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });

    consoleSpy.mockRestore();
  });

  it("returns 500 for string errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = createErrorResponse("string error");
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");

    consoleSpy.mockRestore();
  });

  it("returns 500 for null/undefined errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = createErrorResponse(null);
    expect(response.status).toBe(500);

    const response2 = createErrorResponse(undefined);
    expect(response2.status).toBe(500);

    consoleSpy.mockRestore();
  });

  it("preserves correct status for various ApiError codes", async () => {
    const cases: [string, number][] = [
      ["NOT_FOUND", 404],
      ["UNAUTHORIZED", 401],
      ["FORBIDDEN", 403],
      ["RATE_LIMITED", 429],
      ["SERVICE_UNAVAILABLE", 503],
    ];

    for (const [code, statusCode] of cases) {
      const error = new ApiError(code, "test", statusCode);
      const response = createErrorResponse(error);
      expect(response.status).toBe(statusCode);

      const body = await response.json();
      expect(body.error.code).toBe(code);
    }
  });

  it("response has application/json content type", () => {
    const error = new ApiError("NOT_FOUND", "Not found", 404);
    const response = createErrorResponse(error);

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
