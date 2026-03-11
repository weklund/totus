import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApiClient, ApiError } from "../api-client.js";
import { EXIT_AUTH, EXIT_ERROR, EXIT_PERMISSION } from "../exit-codes.js";

describe("api-client", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("createApiClient", () => {
    it("creates a client with get, post, patch, put, delete methods", () => {
      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      expect(client.get).toBeDefined();
      expect(client.post).toBeDefined();
      expect(client.patch).toBeDefined();
      expect(client.put).toBeDefined();
      expect(client.delete).toBeDefined();
    });

    it("refuses non-HTTPS for non-localhost URLs", () => {
      expect(() =>
        createApiClient({
          apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
          serverUrl: "http://example.com",
        }),
      ).toThrow(ApiError);
    });

    it("allows HTTP for localhost", () => {
      expect(() =>
        createApiClient({
          apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
          serverUrl: "http://localhost:3000",
        }),
      ).not.toThrow();
    });

    it("allows HTTP for 127.0.0.1", () => {
      expect(() =>
        createApiClient({
          apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
          serverUrl: "http://127.0.0.1:3000",
        }),
      ).not.toThrow();
    });
  });

  describe("GET requests", () => {
    it("sends GET request with Authorization header", async () => {
      const apiKey = "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { test: true } }),
      });

      const client = createApiClient({
        apiKey,
        serverUrl: "http://localhost:3000",
      });

      const result = await client.get("/api/test");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:3000/api/test");
      expect(opts.method).toBe("GET");
      expect(opts.headers.Authorization).toBe(`Bearer ${apiKey}`);
      expect(result.data).toEqual({ test: true });
    });

    it("appends query parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await client.get("/api/test", { status: "active", limit: 10 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("status=active");
      expect(url).toContain("limit=10");
    });

    it("skips undefined query parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await client.get("/api/test", { status: "active", limit: undefined });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("status=active");
      expect(url).not.toContain("limit");
    });
  });

  describe("POST requests", () => {
    it("sends POST request with body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "123" } }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      const result = await client.post("/api/test", { name: "test" });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe(JSON.stringify({ name: "test" }));
      expect(result.data).toEqual({ id: "123" });
    });
  });

  describe("error handling", () => {
    it("maps 401 to ApiError with EXIT_AUTH", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({
          error: { code: "UNAUTHORIZED", message: "Invalid API key" },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        statusCode: 401,
        exitCode: EXIT_AUTH,
      });
    });

    it("maps 403 with INSUFFICIENT_SCOPES to EXIT_PERMISSION", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({
          error: {
            code: "INSUFFICIENT_SCOPES",
            message: 'API key needs "shares:write" scope',
          },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "INSUFFICIENT_SCOPES",
        statusCode: 403,
        exitCode: EXIT_PERMISSION,
      });
    });

    it("maps 403 without INSUFFICIENT_SCOPES to EXIT_PERMISSION", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({
          error: { code: "FORBIDDEN", message: "Access denied" },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        exitCode: EXIT_PERMISSION,
      });
    });

    it("maps 404 to NOT_FOUND with EXIT_ERROR", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({
          error: { code: "NOT_FOUND", message: "Resource not found" },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
        exitCode: EXIT_ERROR,
      });
    });

    it("maps 400 to VALIDATION_ERROR", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({
          error: { code: "VALIDATION_ERROR", message: "Invalid input" },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        exitCode: EXIT_ERROR,
      });
    });

    it("maps 400 KEY_LIMIT_REACHED correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({
          error: { code: "KEY_LIMIT_REACHED", message: "Max 10 active keys" },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "KEY_LIMIT_REACHED",
        statusCode: 400,
      });
    });

    it("maps 429 to RATE_LIMITED", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({
          error: { code: "RATE_LIMITED", message: "Rate limited" },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "RATE_LIMITED",
        statusCode: 429,
        exitCode: EXIT_ERROR,
      });
    });

    it("maps 500 to SERVER_ERROR", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({
          error: { message: "Something went wrong" },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "SERVER_ERROR",
        statusCode: 500,
        exitCode: EXIT_ERROR,
      });
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "NETWORK_ERROR",
        exitCode: EXIT_ERROR,
      });
    });

    it("handles non-JSON error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => {
          throw new Error("not JSON");
        },
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "SERVER_ERROR",
        statusCode: 502,
      });
    });

    it("maps 409 to SYNC_IN_PROGRESS", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({
          error: { code: "SYNC_IN_PROGRESS", message: "Sync already in progress" },
        }),
      });

      const client = createApiClient({
        apiKey: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        serverUrl: "http://localhost:3000",
      });

      await expect(client.get("/api/test")).rejects.toMatchObject({
        code: "SYNC_IN_PROGRESS",
        statusCode: 409,
      });
    });
  });

  describe("ApiError class", () => {
    it("has correct properties", () => {
      const error = new ApiError("test message", "UNAUTHORIZED", 401, EXIT_AUTH);
      expect(error.message).toBe("test message");
      expect(error.code).toBe("UNAUTHORIZED");
      expect(error.statusCode).toBe(401);
      expect(error.exitCode).toBe(EXIT_AUTH);
      expect(error.name).toBe("ApiError");
    });

    it("supports details", () => {
      const error = new ApiError("test", "VALIDATION_ERROR", 400, EXIT_ERROR, {
        field: "name",
      });
      expect(error.details).toEqual({ field: "name" });
    });

    it("is an instance of Error", () => {
      const error = new ApiError("test", "UNAUTHORIZED", 401, EXIT_AUTH);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
    });
  });
});
