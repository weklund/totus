import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Tests for GET /api/health endpoint.
 *
 * Tests both the happy path (DB connected) and error path (DB disconnected).
 */

describe("GET /api/health", () => {
  describe("when database is connected", () => {
    let GET: typeof import("../route").GET;

    beforeAll(async () => {
      // Import the route handler (this uses the real DB connection)
      const routeModule = await import("../route");
      GET = routeModule.GET;
    });

    it("returns 200 with status ok", async () => {
      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(body.database).toBe("connected");
    });

    it("response is JSON", async () => {
      const response = await GET();
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
    });
  });

  describe("when database is disconnected", () => {
    it("returns 503 with status error", async () => {
      // Mock the @/db module to simulate a failed connection
      vi.doMock("@/db", () => ({
        pool: {
          query: vi.fn().mockRejectedValue(new Error("Connection refused")),
        },
      }));

      // Re-import the route to pick up the mock
      const { GET } = await import("../route");
      const response = await GET();

      expect(response.status).toBe(503);

      const body = await response.json();
      expect(body.status).toBe("error");
      expect(body.database).toBe("disconnected");

      vi.doUnmock("@/db");
    });
  });
});
