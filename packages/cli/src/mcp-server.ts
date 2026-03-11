/**
 * Totus MCP Server
 *
 * Exposes Totus health data to AI agents via Model Context Protocol (MCP).
 * Uses stdio transport — spawned by MCP clients (Claude Desktop, Cursor, etc.).
 *
 * CRITICAL: Never use console.log() — it corrupts the stdio JSON-RPC channel.
 * Use process.stderr.write() for diagnostics.
 *
 * See: LLD Section 9 (MCP Server Design)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveApiKey, resolveServerUrl } from "./config.js";
import { createApiClient, ApiError } from "./api-client.js";

// ─── Auth Helper ────────────────────────────────────────────────────────────

interface AuthResult {
  apiKey: string;
  serverUrl: string;
}

function resolveAuth(): AuthResult | null {
  // MCP server: env var takes priority, then config file
  const { key } = resolveApiKey(undefined);
  if (!key) return null;
  const serverUrl = resolveServerUrl(undefined);
  return { apiKey: key, serverUrl };
}

const NO_KEY_MESSAGE =
  "No API key configured. To use the Totus MCP server:\n\n" +
  "1. Create an API key at https://totus.com/dashboard/settings\n" +
  '2. Set the TOTUS_API_KEY environment variable in your MCP client config:\n\n' +
  '   "env": { "TOTUS_API_KEY": "tot_live_..." }\n\n' +
  'Or run "totus auth login" to store the key in your config file.';

function makeErrorResponse(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function getAuthenticatedClient() {
  const auth = resolveAuth();
  if (!auth) {
    return { client: null, error: NO_KEY_MESSAGE };
  }
  const client = createApiClient({
    apiKey: auth.apiKey,
    serverUrl: auth.serverUrl,
  });
  return { client, error: null };
}

async function handleApiError(err: unknown): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}> {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return makeErrorResponse(
          "Authentication failed. Your API key may be invalid or expired.\n" +
            'Run "totus auth status" to check, or create a new key at https://totus.com/dashboard/settings',
        );
      case "INSUFFICIENT_SCOPES":
      case "FORBIDDEN": {
        const scopeMatch = err.message.match(/scope[:\s]+["']?([a-z:_]+)/i);
        const scopeHint = scopeMatch
          ? ` Your API key needs the "${scopeMatch[1]}" scope for this action.`
          : "";
        return makeErrorResponse(
          `Insufficient permissions.${scopeHint}\n` +
            "Create a new API key with the required scopes at https://totus.com/dashboard/settings",
        );
      }
      case "RATE_LIMITED":
        return makeErrorResponse(
          "Rate limited. Please wait before making more requests.",
        );
      case "VALIDATION_ERROR":
        return makeErrorResponse(`Validation error: ${err.message}`);
      case "NOT_FOUND":
        return makeErrorResponse(`Not found: ${err.message}`);
      case "SYNC_IN_PROGRESS":
        return makeErrorResponse(
          "A sync is already in progress for this connection. Please wait for it to complete.",
        );
      default:
        return makeErrorResponse(
          `The Totus API encountered an error: ${err.message}`,
        );
    }
  }
  const msg = err instanceof Error ? err.message : "Unknown error occurred";
  return makeErrorResponse(`Error: ${msg}`);
}

// ─── Server Setup ───────────────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "totus-health",
    version: "1.0.0",
  });

  // ─── Tools ──────────────────────────────────────────────────────────────

  // 1. get_health_data
  server.tool(
    "get_health_data",
    "Query health metrics for a date range. Call list_available_metrics first to get valid metric IDs.",
    {
      metrics: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe(
          "Metric type IDs to query (e.g., ['sleep_score', 'hrv']). Call list_available_metrics first.",
        ),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .describe("Start date in YYYY-MM-DD format"),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .describe("End date in YYYY-MM-DD format"),
      resolution: z
        .enum(["daily", "weekly", "monthly"])
        .optional()
        .describe("Aggregation level. Default: daily"),
      source: z
        .string()
        .optional()
        .describe(
          "Filter to a specific provider (e.g., 'oura'). Omit to use user preferences.",
        ),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const query: Record<string, string | number | boolean | undefined> = {
          metrics: params.metrics.join(","),
          start: params.start_date,
          end: params.end_date,
        };
        if (params.resolution) query.resolution = params.resolution;
        if (params.source) query.source = params.source;

        const response = await client.get<Record<string, unknown>>(
          "/api/health-data",
          query,
        );
        const data = response.data;

        // Format text response for LLM consumption
        const resolution = params.resolution ?? "daily";
        let text = `Health Data: ${params.metrics.join(", ")}\n`;
        text += `Period: ${params.start_date} to ${params.end_date} (${resolution})\n\n`;

        if (data && typeof data === "object") {
          const metrics = (data as Record<string, unknown>).metrics ?? data;
          if (typeof metrics === "object" && metrics !== null) {
            for (const [metricKey, metricData] of Object.entries(
              metrics as Record<string, unknown>,
            )) {
              const md = metricData as Record<string, unknown>;
              const unit = (md.unit as string) ?? "";
              const points = (md.points ?? md.data ?? []) as Array<
                Record<string, unknown>
              >;

              text += `${metricKey}${unit ? ` (${unit})` : ""}:\n`;

              if (Array.isArray(points) && points.length > 0) {
                for (const point of points) {
                  const date = point.date ?? point.recorded_at ?? "";
                  const value = point.value ?? "";
                  text += `  ${date}: ${value}\n`;
                }

                // Summary stats
                const values = points
                  .map((p) => Number(p.value))
                  .filter((v) => !isNaN(v));
                if (values.length > 0) {
                  const avg = values.reduce((a, b) => a + b, 0) / values.length;
                  const min = Math.min(...values);
                  const max = Math.max(...values);
                  text += `  Average: ${avg.toFixed(1)} | Min: ${min} | Max: ${max}\n`;
                }
              } else {
                text += "  No data points found.\n";
              }
              text += "\n";
            }
          } else {
            text += JSON.stringify(data, null, 2);
          }
        } else {
          text += "No data returned.";
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 2. list_available_metrics
  server.tool(
    "list_available_metrics",
    "List all metric types the user has data for. Call this before get_health_data to discover valid metric IDs.",
    {
      category: z
        .enum([
          "sleep",
          "cardiovascular",
          "activity",
          "body",
          "readiness",
          "nutrition",
        ])
        .optional()
        .describe("Filter by category. Omit to return all categories."),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const query: Record<string, string | number | boolean | undefined> = {};
        if (params.category) query.category = params.category;

        const response = await client.get<
          Array<Record<string, unknown>> | Record<string, unknown>
        >("/api/health-data/types", query);
        const data = response.data;

        const metricsList = Array.isArray(data) ? data : (data as Record<string, unknown>).types ?? [];
        const metrics = metricsList as Array<Record<string, unknown>>;

        let text = "Available Metrics\n\n";
        if (metrics.length === 0) {
          text += "No metrics found.";
        } else {
          for (const m of metrics) {
            const type = m.metric_type ?? m.type ?? "";
            const label = m.label ?? "";
            const unit = m.unit ?? "";
            const category = m.category ?? "";
            const source = m.resolved_source ?? m.source ?? "";
            const dataPoints = m.data_points ?? "";
            text += `${type}: ${label}`;
            if (unit) text += ` (${unit})`;
            if (category) text += ` [${category}]`;
            if (source) text += ` — source: ${source}`;
            if (dataPoints) text += `, ${dataPoints} data points`;
            text += "\n";
          }
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 3. create_share
  server.tool(
    "create_share",
    "Create a share link for a doctor or coach to view health data.",
    {
      label: z
        .string()
        .min(1)
        .max(255)
        .describe("Label for the share (e.g., 'For Dr. Patel')"),
      metrics: z
        .array(z.string())
        .min(1)
        .describe("Metric types to share"),
      start_date: z
        .string()
        .describe("Start of shareable date range (YYYY-MM-DD)"),
      end_date: z
        .string()
        .describe("End of shareable date range (YYYY-MM-DD)"),
      expires_in_days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .describe("Days until the share link expires"),
      note: z
        .string()
        .max(1000)
        .optional()
        .describe("Optional note shown to the viewer"),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const response = await client.post<Record<string, unknown>>(
          "/api/shares",
          {
            label: params.label,
            allowed_metrics: params.metrics,
            data_start: params.start_date,
            data_end: params.end_date,
            expires_in_days: params.expires_in_days,
            note: params.note,
          },
        );
        const share = response.data;

        let text = "Share Created Successfully\n\n";
        text += `Label: ${share.label ?? params.label}\n`;
        if (share.url) text += `URL: ${share.url}\n`;
        if (share.token) text += `URL: ${share.url ?? `Share token: ${share.token}`}\n`;
        text += `Metrics: ${params.metrics.join(", ")}\n`;
        text += `Date range: ${params.start_date} → ${params.end_date}\n`;
        if (share.expires_at) text += `Expires: ${share.expires_at}\n`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 4. list_shares
  server.tool(
    "list_shares",
    "List existing share grants.",
    {
      status: z
        .enum(["active", "expired", "revoked", "all"])
        .optional()
        .describe("Filter by status. Default: all"),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const query: Record<string, string | number | boolean | undefined> = {};
        if (params.status) query.status = params.status;

        const response = await client.get<
          Array<Record<string, unknown>> | Record<string, unknown>
        >("/api/shares", query);
        const data = response.data;
        const shares = Array.isArray(data) ? data : [];

        let text = "Share Grants\n\n";
        if (shares.length === 0) {
          text += "No shares found.";
        } else {
          for (const s of shares) {
            text += `${s.id}: ${s.label ?? "Untitled"}\n`;
            text += `  Status: ${s.status ?? "unknown"}\n`;
            if (s.metrics)
              text += `  Metrics: ${Array.isArray(s.metrics) ? s.metrics.join(", ") : s.metrics}\n`;
            if (s.view_count !== undefined)
              text += `  Views: ${s.view_count}\n`;
            if (s.expires_at) text += `  Expires: ${s.expires_at}\n`;
            text += "\n";
          }
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 5. revoke_share
  server.tool(
    "revoke_share",
    "Revoke a share link so it can no longer be accessed.",
    {
      share_id: z
        .string()
        .uuid()
        .describe("The ID of the share grant to revoke"),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const response = await client.patch<Record<string, unknown>>(
          `/api/shares/${params.share_id}`,
          { action: "revoke" },
        );
        const data = response.data;

        let text = "Share Revoked\n\n";
        if (data.label) text += `Label: ${data.label}\n`;
        text += `Share ID: ${params.share_id}\n`;
        if (data.revoked_at) text += `Revoked at: ${data.revoked_at}\n`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 6. get_audit_log
  server.tool(
    "get_audit_log",
    "Query the audit trail of data access events.",
    {
      event_type: z
        .string()
        .optional()
        .describe(
          "Filter by event type (e.g., 'data.viewed', 'share.created')",
        ),
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Number of days to look back. Default: 30"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum events to return. Default: 20"),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const query: Record<string, string | number | boolean | undefined> = {};
        if (params.event_type) query.event_type = params.event_type;
        if (params.limit) query.limit = params.limit;
        if (params.days) {
          const start = new Date();
          start.setDate(start.getDate() - params.days);
          query.start = start.toISOString().slice(0, 10);
        }

        const response = await client.get<
          Array<Record<string, unknown>> | Record<string, unknown>
        >("/api/audit", query);
        const data = response.data;
        const events = Array.isArray(data) ? data : [];

        let text = "Audit Log\n\n";
        if (events.length === 0) {
          text += "No audit events found.";
        } else {
          for (const e of events) {
            const ts = e.created_at ?? e.timestamp ?? "";
            const actor = e.actor_type ?? "unknown";
            const event = e.event_type ?? "";
            const detail = e.description ?? e.detail ?? "";
            text += `[${ts}] ${actor}: ${event}`;
            if (detail) text += ` — ${detail}`;
            text += "\n";
          }
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 7. get_profile
  server.tool(
    "get_profile",
    "Get user profile and health data summary.",
    {},
    async () => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const response = await client.get<Record<string, unknown>>(
          "/api/user/profile",
        );
        const data = response.data;

        let text = "User Profile\n\n";
        text += `Name: ${data.display_name ?? data.email ?? "—"}\n`;
        if (data.email) text += `Email: ${data.email}\n`;

        const stats = data.stats as Record<string, unknown> | undefined;
        if (stats) {
          text += "\nHealth Data Summary:\n";
          if (stats.data_points !== undefined)
            text += `  Total data points: ${stats.data_points}\n`;
          if (stats.connections !== undefined)
            text += `  Connected sources: ${stats.connections}\n`;
          if (stats.active_shares !== undefined)
            text += `  Active shares: ${stats.active_shares}\n`;
          if (stats.metric_types !== undefined)
            text += `  Metric types: ${stats.metric_types}\n`;
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 8. trigger_sync
  server.tool(
    "trigger_sync",
    "Trigger a data sync for a connected source. Use list_connections to find connection IDs.",
    {
      connection_id: z
        .string()
        .uuid()
        .describe(
          "The provider connection ID to sync. Use list_connections to find IDs.",
        ),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const response = await client.post<Record<string, unknown>>(
          `/api/connections/${params.connection_id}/sync`,
        );
        const data = response.data;

        let text = "Sync Triggered\n\n";
        text += `Connection ID: ${params.connection_id}\n`;
        if (data.status) text += `Status: ${data.status}\n`;
        if (data.job_id) text += `Job ID: ${data.job_id}\n`;
        text +=
          '\nRun list_connections to check sync progress.';

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 9. list_connections
  server.tool(
    "list_connections",
    "List all connected data sources. Use this to discover provider IDs and connection IDs.",
    {},
    async () => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const response = await client.get<
          Array<Record<string, unknown>> | Record<string, unknown>
        >("/api/connections");
        const data = response.data;
        const connections = Array.isArray(data) ? data : [];

        let text = "Connected Data Sources\n\n";
        if (connections.length === 0) {
          text += "No connections found. Connect a provider at https://totus.com/dashboard/settings";
        } else {
          for (const c of connections) {
            const provider = c.provider ?? "unknown";
            const status = c.status ?? "unknown";
            text += `${provider} (${status})\n`;
            text += `  ID: ${c.id}\n`;
            if (c.last_sync_at ?? c.last_synced_at)
              text += `  Last synced: ${c.last_sync_at ?? c.last_synced_at}\n`;
            if (status === "expired") {
              text +=
                "  ⚠ Token expired — user must reconnect via the Totus web app.\n";
            }
            text += "\n";
          }
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 10. list_metric_preferences
  server.tool(
    "list_metric_preferences",
    "List the user's source preferences for metrics with multiple providers.",
    {},
    async () => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        const response = await client.get<
          Array<Record<string, unknown>> | Record<string, unknown>
        >("/api/metric-preferences");
        const data = response.data;
        const prefs = Array.isArray(data)
          ? data
          : Array.isArray((data as Record<string, unknown>).preferences)
            ? ((data as Record<string, unknown>).preferences as Array<Record<string, unknown>>)
            : [];

        let text = "Source Preferences\n\n";
        if (prefs.length === 0) {
          text +=
            "No source preferences set. Totus uses auto-resolution (most recent data wins).";
        } else {
          for (const p of prefs) {
            const metric = p.metric_type ?? "";
            const provider = p.provider ?? "";
            const updatedAt = p.updated_at ?? "";
            text += `${metric} → ${provider}`;
            if (updatedAt) text += ` (set ${String(updatedAt).slice(0, 10)})`;
            text += "\n";
          }
          text += `\n${prefs.length} preference(s) set. All other metrics use auto-resolution.`;
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 11. set_metric_preference
  server.tool(
    "set_metric_preference",
    "Pin a metric to a specific data source. Call list_connections to verify the provider is active.",
    {
      metric_type: z
        .string()
        .describe(
          "The metric type ID (e.g., 'hrv'). Call list_available_metrics to get valid IDs.",
        ),
      source: z
        .string()
        .describe(
          "The provider ID to prefer (e.g., 'oura', 'whoop'). Must match an active connection.",
        ),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        await client.put(
          `/api/metric-preferences/${params.metric_type}`,
          { provider: params.source },
        );

        const text =
          `Preference set: ${params.metric_type} → ${params.source}\n\n` +
          `Totus will now use ${params.source} as the source for ${params.metric_type} data.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // 12. delete_metric_preference
  server.tool(
    "delete_metric_preference",
    "Remove a source preference, reverting to auto-resolution (most recent data wins).",
    {
      metric_type: z
        .string()
        .describe(
          "The metric type ID to clear the preference for. Call list_metric_preferences to see current preferences.",
        ),
    },
    async (params) => {
      const { client, error } = getAuthenticatedClient();
      if (!client) return makeErrorResponse(error!);

      try {
        await client.delete(
          `/api/metric-preferences/${params.metric_type}`,
        );

        const text =
          `Preference cleared: ${params.metric_type}\n\n` +
          `Totus will now use auto-resolution for ${params.metric_type} (most recent data source wins).`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  // ─── Resources ────────────────────────────────────────────────────────────

  // 1. totus://metrics
  server.resource(
    "metrics",
    "totus://metrics",
    { description: "List of all available metric types", mimeType: "text/plain" },
    async () => {
      const { client, error } = getAuthenticatedClient();
      if (!client) {
        return {
          contents: [
            {
              uri: "totus://metrics",
              text: error!,
            },
          ],
        };
      }

      try {
        const response = await client.get<
          Array<Record<string, unknown>> | Record<string, unknown>
        >("/api/health-data/types");
        const data = response.data;
        const metricsList = Array.isArray(data) ? data : (data as Record<string, unknown>).types ?? [];
        const metrics = metricsList as Array<Record<string, unknown>>;

        let text = "Available Health Metrics\n\n";
        for (const m of metrics) {
          const type = m.metric_type ?? m.type ?? "";
          const label = m.label ?? "";
          const unit = m.unit ?? "";
          const category = m.category ?? "";
          text += `${type}: ${label}`;
          if (unit) text += ` (${unit})`;
          if (category) text += ` [${category}]`;
          text += "\n";
        }

        return {
          contents: [{ uri: "totus://metrics", text }],
        };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to load metrics";
        return {
          contents: [{ uri: "totus://metrics", text: `Error: ${msg}` }],
        };
      }
    },
  );

  // 2. totus://profile
  server.resource(
    "profile",
    "totus://profile",
    { description: "User profile and data summary", mimeType: "text/plain" },
    async () => {
      const { client, error } = getAuthenticatedClient();
      if (!client) {
        return {
          contents: [{ uri: "totus://profile", text: error! }],
        };
      }

      try {
        const response = await client.get<Record<string, unknown>>(
          "/api/user/profile",
        );
        const data = response.data;

        let text = "User Profile\n\n";
        text += `Name: ${data.display_name ?? data.email ?? "—"}\n`;
        if (data.email) text += `Email: ${data.email}\n`;

        const stats = data.stats as Record<string, unknown> | undefined;
        if (stats) {
          text += "\nHealth Data:\n";
          if (stats.data_points !== undefined)
            text += `  Data points: ${stats.data_points}\n`;
          if (stats.connections !== undefined)
            text += `  Connections: ${stats.connections}\n`;
          if (stats.active_shares !== undefined)
            text += `  Active shares: ${stats.active_shares}\n`;
          if (stats.metric_types !== undefined)
            text += `  Metric types: ${stats.metric_types}\n`;
        }

        return {
          contents: [{ uri: "totus://profile", text }],
        };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to load profile";
        return {
          contents: [{ uri: "totus://profile", text: `Error: ${msg}` }],
        };
      }
    },
  );

  // 3. totus://shares
  server.resource(
    "shares",
    "totus://shares",
    { description: "Active share grants overview", mimeType: "text/plain" },
    async () => {
      const { client, error } = getAuthenticatedClient();
      if (!client) {
        return {
          contents: [{ uri: "totus://shares", text: error! }],
        };
      }

      try {
        const response = await client.get<
          Array<Record<string, unknown>> | Record<string, unknown>
        >("/api/shares", { status: "active" });
        const data = response.data;
        const shares = Array.isArray(data) ? data : [];

        let text = "Active Shares\n\n";
        if (shares.length === 0) {
          text += "No active shares.";
        } else {
          for (const s of shares) {
            text += `${s.id}: ${s.label ?? "Untitled"}\n`;
            if (s.metrics)
              text += `  Metrics: ${Array.isArray(s.metrics) ? s.metrics.join(", ") : s.metrics}\n`;
            if (s.view_count !== undefined)
              text += `  Views: ${s.view_count}\n`;
            if (s.expires_at) text += `  Expires: ${s.expires_at}\n`;
            text += "\n";
          }
        }

        return {
          contents: [{ uri: "totus://shares", text }],
        };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to load shares";
        return {
          contents: [{ uri: "totus://shares", text: `Error: ${msg}` }],
        };
      }
    },
  );

  // ─── Prompts ──────────────────────────────────────────────────────────────

  // 1. analyze_sleep
  server.prompt(
    "analyze_sleep",
    "Analyze sleep trends for a given period",
    { period: z.enum(["last_7_days", "last_30_days", "last_90_days"]).describe("Analysis period") },
    ({ period }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Analyze my sleep data for the ${period.replace(/_/g, " ")}. ` +
              "Look at sleep_score, sleep_duration, deep_sleep, rem_sleep, and sleep_latency. " +
              "Identify trends, patterns, and any concerning changes. " +
              "Compare weekday vs weekend sleep. " +
              "Provide actionable recommendations for improvement.",
          },
        },
      ],
    }),
  );

  // 2. compare_metrics
  server.prompt(
    "compare_metrics",
    "Compare two or more metrics over time to find correlations",
    {
      metrics: z
        .string()
        .describe(
          "Comma-separated metric type IDs to compare (min 2, e.g., 'hrv,sleep_score,steps')",
        ),
      period: z
        .enum(["last_30_days", "last_90_days", "last_180_days"])
        .describe("Comparison period"),
    },
    ({ metrics, period }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Compare my ${metrics} data over the ${period.replace(/_/g, " ")}. ` +
              "Look for correlations, inverse relationships, and notable patterns. " +
              "For example, does my HRV improve on days with more steps? " +
              "Does poor sleep correlate with lower readiness scores? " +
              "Present findings with specific data points.",
          },
        },
      ],
    }),
  );

  // 3. prepare_share
  server.prompt(
    "prepare_share",
    "Help prepare a share link for a healthcare provider",
    {
      provider_type: z
        .enum(["doctor", "coach", "trainer", "nutritionist"])
        .describe("Type of healthcare provider"),
      concern: z
        .string()
        .describe(
          "Health concern or reason for sharing (e.g., 'sleep issues', 'fitness progress')",
        ),
    },
    ({ provider_type, concern }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `I need to share my health data with my ${provider_type} regarding ${concern}. ` +
              "Help me decide which metrics to include, what date range is relevant, and " +
              "write a clear note explaining what to look at. Then create the share link " +
              "using the create_share tool.",
          },
        },
      ],
    }),
  );

  // 4. health_summary
  server.prompt(
    "health_summary",
    "Generate a comprehensive health report",
    { period: z.enum(["last_7_days", "last_30_days", "last_90_days"]).describe("Report period") },
    ({ period }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Generate a comprehensive health report for the ${period.replace(/_/g, " ")}. ` +
              "Include all available metrics organized by category (sleep, cardiovascular, activity, body). " +
              "For each metric, report the average, trend direction, and any notable outliers. " +
              "Highlight the most significant positive and negative changes. " +
              "End with 3 actionable takeaways.",
          },
        },
      ],
    }),
  );

  return server;
}

// ─── Entry Point ────────────────────────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Indicate the server is running (via stderr — never stdout)
  process.stderr.write("Totus MCP server running on stdio\n");
}
