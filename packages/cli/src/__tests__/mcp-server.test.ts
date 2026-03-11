/**
 * MCP Server Tests
 *
 * Tests for the Totus MCP server: tools, resources, prompts, auth, errors.
 * Uses the SDK's in-memory transport for testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp-server.js";

// ─── Mock API client ────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock("../api-client.js", () => ({
  createApiClient: () => ({
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    put: mockPut,
    delete: mockDelete,
  }),
  ApiError: class ApiError extends Error {
    code: string;
    statusCode: number;
    exitCode: number;
    details?: unknown;
    constructor(
      message: string,
      code: string,
      statusCode: number,
      exitCode: number,
      details?: unknown,
    ) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.statusCode = statusCode;
      this.exitCode = exitCode;
      this.details = details;
    }
  },
}));

// ─── Mock config ────────────────────────────────────────────────────────────

vi.mock("../config.js", () => ({
  resolveApiKey: vi.fn(() => ({
    key: "tot_live_TestKey1_12345678901234567890123456789012",
    source: "test",
  })),
  resolveServerUrl: vi.fn(() => "http://localhost:3000"),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTestServer() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MCP Server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Initialization ─────────────────────────────────────────────────────

  describe("initialization", () => {
    it("connects and returns server capabilities", async () => {
      const { client } = await createTestServer();

      const info = client.getServerVersion();
      expect(info).toBeDefined();
      expect(info?.name).toBe("totus-health");
      expect(info?.version).toBe("1.0.0");
    });

    it("advertises tools capability", async () => {
      const { client } = await createTestServer();
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(12);
    });

    it("advertises resources capability", async () => {
      const { client } = await createTestServer();
      const resources = await client.listResources();
      expect(resources.resources.length).toBe(3);
    });

    it("advertises prompts capability", async () => {
      const { client } = await createTestServer();
      const prompts = await client.listPrompts();
      expect(prompts.prompts.length).toBe(4);
    });
  });

  // ─── Tool Listing ───────────────────────────────────────────────────────

  describe("tool listing", () => {
    it("lists all 12 tools with names and descriptions", async () => {
      const { client } = await createTestServer();
      const { tools } = await client.listTools();

      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "create_share",
        "delete_metric_preference",
        "get_audit_log",
        "get_health_data",
        "get_profile",
        "list_available_metrics",
        "list_connections",
        "list_metric_preferences",
        "list_shares",
        "revoke_share",
        "set_metric_preference",
        "trigger_sync",
      ]);

      // Each tool should have a description
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
      }
    });
  });

  // ─── Tools: get_health_data ─────────────────────────────────────────────

  describe("get_health_data", () => {
    it("returns formatted health data", async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          metrics: {
            sleep_score: {
              unit: "score",
              points: [
                { date: "2026-02-01", value: 85 },
                { date: "2026-02-02", value: 78 },
                { date: "2026-02-03", value: 91 },
              ],
            },
          },
        },
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "get_health_data",
        arguments: {
          metrics: ["sleep_score"],
          start_date: "2026-02-01",
          end_date: "2026-02-03",
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("sleep_score");
      expect(text).toContain("85");
      expect(text).toContain("78");
      expect(text).toContain("91");
      expect(text).toContain("Average: 84.7");
      expect(text).toContain("Min: 78");
      expect(text).toContain("Max: 91");
    });

    it("passes resolution and source params to API", async () => {
      mockGet.mockResolvedValueOnce({
        data: { metrics: {} },
      });

      const { client } = await createTestServer();
      await client.callTool({
        name: "get_health_data",
        arguments: {
          metrics: ["hrv"],
          start_date: "2026-01-01",
          end_date: "2026-01-31",
          resolution: "weekly",
          source: "oura",
        },
      });

      expect(mockGet).toHaveBeenCalledWith("/api/health-data", {
        metrics: "hrv",
        start: "2026-01-01",
        end: "2026-01-31",
        resolution: "weekly",
        source: "oura",
      });
    });
  });

  // ─── Tools: list_available_metrics ──────────────────────────────────────

  describe("list_available_metrics", () => {
    it("returns formatted metrics list", async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          {
            metric_type: "sleep_score",
            label: "Sleep Score",
            unit: "score",
            category: "sleep",
            resolved_source: "oura",
            data_points: 100,
          },
          {
            metric_type: "hrv",
            label: "Heart Rate Variability",
            unit: "ms",
            category: "cardiovascular",
            resolved_source: "whoop",
            data_points: 50,
          },
        ],
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_available_metrics",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("sleep_score");
      expect(text).toContain("Sleep Score");
      expect(text).toContain("hrv");
      expect(text).toContain("oura");
    });

    it("passes category filter", async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const { client } = await createTestServer();
      await client.callTool({
        name: "list_available_metrics",
        arguments: { category: "sleep" },
      });

      expect(mockGet).toHaveBeenCalledWith("/api/health-data/types", {
        category: "sleep",
      });
    });
  });

  // ─── Tools: create_share ────────────────────────────────────────────────

  describe("create_share", () => {
    it("creates share and returns URL", async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          id: "share-123",
          label: "For Dr. Patel",
          url: "https://totus.com/v/abc123",
          expires_at: "2026-04-01",
        },
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "create_share",
        arguments: {
          label: "For Dr. Patel",
          metrics: ["sleep_score", "hrv"],
          start_date: "2026-01-01",
          end_date: "2026-03-01",
          expires_in_days: 30,
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Share Created");
      expect(text).toContain("For Dr. Patel");
      expect(text).toContain("https://totus.com/v/abc123");
    });
  });

  // ─── Tools: list_shares ─────────────────────────────────────────────────

  describe("list_shares", () => {
    it("returns formatted shares list", async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          {
            id: "share-1",
            label: "Dr. Patel checkup",
            status: "active",
            metrics: ["sleep_score", "hrv"],
            view_count: 3,
            expires_at: "2026-04-01",
          },
        ],
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_shares",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Dr. Patel checkup");
      expect(text).toContain("active");
      expect(text).toContain("Views: 3");
    });

    it("passes status filter", async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const { client } = await createTestServer();
      await client.callTool({
        name: "list_shares",
        arguments: { status: "active" },
      });

      expect(mockGet).toHaveBeenCalledWith("/api/shares", { status: "active" });
    });
  });

  // ─── Tools: revoke_share ────────────────────────────────────────────────

  describe("revoke_share", () => {
    it("revokes share and returns confirmation", async () => {
      mockPatch.mockResolvedValueOnce({
        data: {
          id: "share-1",
          label: "Dr. Patel",
          revoked_at: "2026-03-09T16:00:00Z",
        },
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "revoke_share",
        arguments: {
          share_id: "550e8400-e29b-41d4-a716-446655440000",
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Share Revoked");
      expect(text).toContain("Dr. Patel");
    });
  });

  // ─── Tools: get_audit_log ───────────────────────────────────────────────

  describe("get_audit_log", () => {
    it("returns formatted audit events", async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          {
            created_at: "2026-03-09T15:00:00Z",
            actor_type: "viewer",
            event_type: "data.viewed",
            description: "sleep_score via Dr. Patel",
          },
        ],
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "get_audit_log",
        arguments: { limit: 5 },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("data.viewed");
      expect(text).toContain("viewer");
    });
  });

  // ─── Tools: get_profile ─────────────────────────────────────────────────

  describe("get_profile", () => {
    it("returns formatted user profile", async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          display_name: "Wes E.",
          email: "wes@example.com",
          stats: {
            data_points: 4720,
            connections: 2,
            active_shares: 2,
            metric_types: 18,
          },
        },
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "get_profile",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Wes E.");
      expect(text).toContain("4720");
      expect(text).toContain("Connected sources: 2");
    });
  });

  // ─── Tools: trigger_sync ────────────────────────────────────────────────

  describe("trigger_sync", () => {
    it("triggers sync and returns confirmation", async () => {
      mockPost.mockResolvedValueOnce({
        data: { status: "queued", job_id: "job-123" },
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "trigger_sync",
        arguments: {
          connection_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Sync Triggered");
      expect(text).toContain("queued");
    });
  });

  // ─── Tools: list_connections ────────────────────────────────────────────

  describe("list_connections", () => {
    it("returns formatted connections list", async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          {
            id: "conn-1",
            provider: "oura",
            status: "connected",
            last_sync_at: "2026-03-11T06:00:00Z",
          },
          {
            id: "conn-2",
            provider: "garmin",
            status: "expired",
            last_sync_at: "2026-02-14T08:00:00Z",
          },
        ],
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_connections",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("oura (connected)");
      expect(text).toContain("garmin (expired)");
      expect(text).toContain("Token expired");
    });
  });

  // ─── Tools: metric preference tools ─────────────────────────────────────

  describe("list_metric_preferences", () => {
    it("returns formatted preferences", async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          {
            metric_type: "hrv",
            provider: "whoop",
            updated_at: "2026-03-01T14:22:00Z",
          },
        ],
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_metric_preferences",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("hrv → whoop");
      expect(text).toContain("2026-03-01");
    });

    it("shows empty message when no preferences", async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_metric_preferences",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("No source preferences set");
    });
  });

  describe("set_metric_preference", () => {
    it("sets preference and confirms", async () => {
      mockPut.mockResolvedValueOnce({ data: {} });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "set_metric_preference",
        arguments: {
          metric_type: "hrv",
          source: "whoop",
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("hrv → whoop");
      expect(mockPut).toHaveBeenCalledWith("/api/metric-preferences/hrv", {
        provider: "whoop",
      });
    });
  });

  describe("delete_metric_preference", () => {
    it("deletes preference and confirms", async () => {
      mockDelete.mockResolvedValueOnce({ data: {} });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "delete_metric_preference",
        arguments: {
          metric_type: "hrv",
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Preference cleared: hrv");
      expect(text).toContain("auto-resolution");
      expect(mockDelete).toHaveBeenCalledWith("/api/metric-preferences/hrv");
    });
  });

  // ─── Resources ──────────────────────────────────────────────────────────

  describe("resources", () => {
    it("lists 3 resources with correct URIs", async () => {
      const { client } = await createTestServer();
      const { resources } = await client.listResources();

      const uris = resources.map((r) => r.uri).sort();
      expect(uris).toEqual([
        "totus://metrics",
        "totus://profile",
        "totus://shares",
      ]);
    });

    it("reads totus://metrics resource", async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          {
            metric_type: "sleep_score",
            label: "Sleep Score",
            unit: "score",
            category: "sleep",
          },
        ],
      });

      const { client } = await createTestServer();
      const result = await client.readResource({
        uri: "totus://metrics",
      });

      expect(result.contents.length).toBeGreaterThan(0);
      const content = result.contents[0] as { uri: string; text?: string };
      expect(content.text).toContain("Sleep Score");
    });

    it("reads totus://profile resource", async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          display_name: "Wes E.",
          stats: { data_points: 100 },
        },
      });

      const { client } = await createTestServer();
      const result = await client.readResource({
        uri: "totus://profile",
      });

      expect(result.contents.length).toBeGreaterThan(0);
      const content = result.contents[0] as { uri: string; text?: string };
      expect(content.text).toContain("Wes E.");
    });

    it("reads totus://shares resource", async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          { id: "share-1", label: "Dr. Patel", status: "active" },
        ],
      });

      const { client } = await createTestServer();
      const result = await client.readResource({
        uri: "totus://shares",
      });

      expect(result.contents.length).toBeGreaterThan(0);
      const content = result.contents[0] as { uri: string; text?: string };
      expect(content.text).toContain("Dr. Patel");
    });
  });

  // ─── Prompts ──────────────────────────────────────────────────────────

  describe("prompts", () => {
    it("lists 4 prompts", async () => {
      const { client } = await createTestServer();
      const { prompts } = await client.listPrompts();

      const names = prompts.map((p) => p.name).sort();
      expect(names).toEqual([
        "analyze_sleep",
        "compare_metrics",
        "health_summary",
        "prepare_share",
      ]);
    });

    it("gets analyze_sleep prompt", async () => {
      const { client } = await createTestServer();
      const result = await client.getPrompt({
        name: "analyze_sleep",
        arguments: { period: "last_30_days" },
      });

      expect(result.messages.length).toBeGreaterThan(0);
      const text =
        result.messages[0]?.content.type === "text"
          ? result.messages[0].content.text
          : "";
      expect(text).toContain("sleep data");
      expect(text).toContain("last 30 days");
    });

    it("gets compare_metrics prompt", async () => {
      const { client } = await createTestServer();
      const result = await client.getPrompt({
        name: "compare_metrics",
        arguments: {
          metrics: "hrv,sleep_score",
          period: "last_90_days",
        },
      });

      expect(result.messages.length).toBeGreaterThan(0);
      const text =
        result.messages[0]?.content.type === "text"
          ? result.messages[0].content.text
          : "";
      expect(text).toContain("hrv,sleep_score");
      expect(text).toContain("last 90 days");
    });

    it("gets prepare_share prompt", async () => {
      const { client } = await createTestServer();
      const result = await client.getPrompt({
        name: "prepare_share",
        arguments: {
          provider_type: "doctor",
          concern: "sleep issues",
        },
      });

      expect(result.messages.length).toBeGreaterThan(0);
      const text =
        result.messages[0]?.content.type === "text"
          ? result.messages[0].content.text
          : "";
      expect(text).toContain("doctor");
      expect(text).toContain("sleep issues");
    });

    it("gets health_summary prompt", async () => {
      const { client } = await createTestServer();
      const result = await client.getPrompt({
        name: "health_summary",
        arguments: { period: "last_7_days" },
      });

      expect(result.messages.length).toBeGreaterThan(0);
      const text =
        result.messages[0]?.content.type === "text"
          ? result.messages[0].content.text
          : "";
      expect(text).toContain("health report");
      expect(text).toContain("last 7 days");
    });
  });

  // ─── Auth Error Handling ────────────────────────────────────────────────

  describe("auth error handling", () => {
    it("returns setup instructions when no API key configured", async () => {
      const { resolveApiKey } = await import("../config.js");
      vi.mocked(resolveApiKey).mockReturnValueOnce({
        key: undefined,
        source: "none",
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "get_profile",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("No API key configured");
      expect(text).toContain("TOTUS_API_KEY");
      expect(text).toContain("totus auth login");
    });

    it("returns scope error for insufficient permissions", async () => {
      const { ApiError } = await import("../api-client.js");
      mockGet.mockRejectedValueOnce(
        new ApiError(
          "API key does not have the required scope: shares:write",
          "INSUFFICIENT_SCOPES",
          403,
          3,
        ),
      );

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_shares",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Insufficient permissions");
      expect(text).toContain("shares:write");
    });

    it("returns auth error for invalid key", async () => {
      const { ApiError } = await import("../api-client.js");
      mockGet.mockRejectedValueOnce(
        new ApiError("Invalid API key", "UNAUTHORIZED", 401, 2),
      );

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "get_profile",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Authentication failed");
      expect(text).toContain("totus auth status");
    });

    it("returns rate limit error", async () => {
      const { ApiError } = await import("../api-client.js");
      mockGet.mockRejectedValueOnce(
        new ApiError("Rate limited", "RATE_LIMITED", 429, 1),
      );

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_connections",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Rate limited");
    });

    it("returns validation error for bad input from API", async () => {
      const { ApiError } = await import("../api-client.js");
      mockGet.mockRejectedValueOnce(
        new ApiError(
          "Invalid metric type: foo",
          "VALIDATION_ERROR",
          400,
          1,
        ),
      );

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "get_health_data",
        arguments: {
          metrics: ["foo"],
          start_date: "2026-01-01",
          end_date: "2026-01-31",
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Validation error");
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty health data gracefully", async () => {
      mockGet.mockResolvedValueOnce({
        data: { metrics: {} },
      });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "get_health_data",
        arguments: {
          metrics: ["sleep_score"],
          start_date: "2026-01-01",
          end_date: "2026-01-31",
        },
      });

      expect(result.isError).toBeFalsy();
    });

    it("handles empty shares list", async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_shares",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("No shares found");
    });

    it("handles empty connections list", async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "list_connections",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("No connections found");
    });

    it("handles unexpected error types gracefully", async () => {
      mockGet.mockRejectedValueOnce("string error");

      const { client } = await createTestServer();
      const result = await client.callTool({
        name: "get_profile",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Error");
    });
  });
});
