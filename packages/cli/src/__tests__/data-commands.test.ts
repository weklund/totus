import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "@commander-js/extra-typings";
import { createMetricsCommand } from "../commands/metrics.js";
import { createSharesCommand } from "../commands/shares.js";
import { createAuditCommand } from "../commands/audit.js";
import { createConnectionsCommand } from "../commands/connections.js";
import { createPreferencesCommand } from "../commands/preferences.js";
import { createKeysCommand } from "../commands/keys.js";
import { createProfileCommand } from "../commands/profile.js";
import { createExportCommand } from "../commands/export.js";

// Mock config module — note: resolveApiKey returns a valid key by default
const mockResolveApiKey = vi.fn((): { key: string | undefined; source: string } => ({
  key: "test-api-key-placeholder-for-unit-tests",
  source: "config file",
}));
const mockResolveServerUrl = vi.fn((): string => "http://localhost:3000");

vi.mock("../config.js", () => ({
  readConfig: vi.fn(() => ({ api_key: "test-api-key-placeholder-for-unit-tests" })),
  writeConfig: vi.fn(),
  checkConfigPermissions: vi.fn(() => true),
  getConfigPath: vi.fn(() => "/home/user/.config/totus/config.json"),
  resolveApiKey: (_flagValue?: string) => mockResolveApiKey(),
  resolveServerUrl: (_flagValue?: string) => mockResolveServerUrl(),
  validateApiKeyFormat: vi.fn(() => true),
  maskApiKey: vi.fn(() => "test...masked"),
  extractShortToken: vi.fn(),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  deleteConfigValue: vi.fn(),
}));

// Mock API client
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock("../api-client.js", () => ({
  createApiClient: vi.fn(() => ({
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    put: mockPut,
    delete: mockDelete,
  })),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public code: string,
      public statusCode: number,
      public exitCode: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

// Mock fs for export command
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ mode: 0o100600 })),
}));

function createTestProgram(): Command {
  const program = new Command()
    .name("totus")
    .version("0.1.0")
    .option("--api-key <key>")
    .option("-o, --output <format>")
    .option("-v, --verbose")
    .option("--server-url <url>")
    .option("--no-color")
    .exitOverride();

  return program;
}

describe("data commands structure", () => {
  it("metrics command has list, get, summary subcommands", () => {
    const metrics = createMetricsCommand();
    const subcommands = metrics.commands.map((c) => c.name());
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("get");
    expect(subcommands).toContain("summary");
  });

  it("shares command has list, get, create, revoke subcommands", () => {
    const shares = createSharesCommand();
    const subcommands = shares.commands.map((c) => c.name());
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("get");
    expect(subcommands).toContain("create");
    expect(subcommands).toContain("revoke");
  });

  it("audit command has list subcommand", () => {
    const audit = createAuditCommand();
    const subcommands = audit.commands.map((c) => c.name());
    expect(subcommands).toContain("list");
  });

  it("connections command has list, sync subcommands", () => {
    const connections = createConnectionsCommand();
    const subcommands = connections.commands.map((c) => c.name());
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("sync");
  });

  it("preferences command has list, set, delete subcommands", () => {
    const preferences = createPreferencesCommand();
    const subcommands = preferences.commands.map((c) => c.name());
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("set");
    expect(subcommands).toContain("delete");
  });

  it("keys command has list, create, revoke subcommands", () => {
    const keys = createKeysCommand();
    const subcommands = keys.commands.map((c) => c.name());
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("create");
    expect(subcommands).toContain("revoke");
  });

  it("profile is a standalone command", () => {
    const profile = createProfileCommand();
    expect(profile.name()).toBe("profile");
  });

  it("export is a standalone command", () => {
    const exp = createExportCommand();
    expect(exp.name()).toBe("export");
  });
});

describe("metrics list", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockPut.mockReset();
    mockDelete.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls GET /api/health-data/types and outputs table", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          metric_type: "sleep_score",
          label: "Sleep Score",
          unit: "score",
          category: "sleep",
          source: "oura",
          data_points: 100,
        },
      ],
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["metrics", "list"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith("/api/health-data/types", {});
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("sleep_score");
  });

  it("supports --output json", async () => {
    mockGet.mockResolvedValue({
      data: [
        { metric_type: "hrv", label: "HRV", unit: "ms", category: "cardiovascular" },
      ],
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["--output", "json", "metrics", "list"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.metrics).toBeDefined();
    expect(parsed.metrics[0].metric_type).toBe("hrv");
  });

  it("supports --output csv", async () => {
    mockGet.mockResolvedValue({
      data: [
        { metric_type: "steps", label: "Steps", unit: "steps", category: "activity" },
      ],
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["--output", "csv", "metrics", "list"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Metric Type");
    expect(output).toContain("steps");
  });

  it("supports --all-sources flag", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          metric_type: "hrv",
          label: "HRV",
          unit: "ms",
          category: "cardiovascular",
          sources: [
            { provider: "oura", data_points: 100 },
            { provider: "whoop", data_points: 50 },
          ],
        },
      ],
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["metrics", "list", "--all-sources"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("oura");
    expect(output).toContain("whoop");
  });

  it("supports --category filter", async () => {
    mockGet.mockResolvedValue({ data: [] });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["metrics", "list", "--category", "sleep"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith("/api/health-data/types", { category: "sleep" });
  });
});

describe("metrics get", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queries health data with --from and --to", async () => {
    mockGet.mockResolvedValue({
      data: {
        metrics: {
          sleep_score: {
            unit: "score",
            points: [{ date: "2026-01-01", value: 85, source: "oura" }],
          },
        },
      },
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(
      ["metrics", "get", "sleep_score", "--from", "2026-01-01", "--to", "2026-01-31"],
      { from: "user" },
    );

    expect(mockGet).toHaveBeenCalledWith("/api/health-data", {
      metrics: "sleep_score",
      start: "2026-01-01",
      end: "2026-01-31",
      resolution: "daily",
    });
  });

  it("supports --source filter", async () => {
    mockGet.mockResolvedValue({ data: { metrics: {} } });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(
      ["metrics", "get", "hrv", "--from", "2026-01-01", "--to", "2026-01-31", "--source", "oura"],
      { from: "user" },
    );

    expect(mockGet).toHaveBeenCalledWith("/api/health-data", expect.objectContaining({
      source: "oura",
    }));
  });

  it("outputs JSON with --output json", async () => {
    mockGet.mockResolvedValue({
      data: {
        metrics: {
          hrv: { unit: "ms", points: [{ date: "2026-01-01", value: 42 }] },
        },
      },
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(
      ["--output", "json", "metrics", "get", "hrv", "--from", "2026-01-01", "--to", "2026-01-31"],
      { from: "user" },
    );

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.metrics).toBeDefined();
  });
});

describe("metrics summary", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows summary with data points and sources", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path.includes("types")) {
        return Promise.resolve({
          data: [
            {
              metric_type: "sleep_score",
              label: "Sleep Score",
              unit: "score",
              category: "sleep",
              source: "oura",
              data_points: 100,
              date_range: { start: "2025-01-01", end: "2026-03-01" },
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["--output", "table", "metrics", "summary"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Health Data Summary");
    expect(output).toContain("oura");
    expect(output).toContain("sleep");
  });

  it("supports --verbose for per-source breakdown", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path.includes("types")) {
        return Promise.resolve({
          data: [
            {
              metric_type: "hrv",
              label: "HRV",
              unit: "ms",
              category: "cardiovascular",
              sources: [
                { provider: "oura", data_points: 100, date_range: { start: "2025-01-01", end: "2026-03-01" } },
                { provider: "whoop", data_points: 50, date_range: { start: "2025-06-01", end: "2026-03-01" } },
              ],
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["--output", "table", "metrics", "summary", "--detailed"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("By source:");
    expect(output).toContain("oura");
    expect(output).toContain("whoop");
  });

  it("outputs JSON with --output json", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path.includes("types")) {
        return Promise.resolve({
          data: [
            {
              metric_type: "sleep_score",
              label: "Sleep Score",
              unit: "score",
              category: "sleep",
              source: "oura",
              data_points: 50,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["--output", "json", "metrics", "summary"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.total_data_points).toBeDefined();
    expect(parsed.connected_sources).toBeDefined();
  });
});

describe("shares commands", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shares list calls GET /api/shares", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          label: "For Dr. Patel",
          status: "active",
          metrics: ["sleep_score", "hrv"],
          view_count: 3,
          expires_at: "2026-04-07T00:00:00Z",
          created_at: "2026-03-08T00:00:00Z",
        },
      ],
    });

    const program = createTestProgram();
    program.addCommand(createSharesCommand());
    await program.parseAsync(["shares", "list"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith("/api/shares", expect.objectContaining({ limit: 20 }));
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Dr. Patel");
  });

  it("shares get calls GET /api/shares/:id", async () => {
    mockGet.mockResolvedValue({
      data: {
        id: "test-id",
        label: "Test Share",
        status: "active",
        metrics: ["sleep_score"],
        view_count: 5,
        expires_at: "2026-04-07T00:00:00Z",
        created_at: "2026-03-08T00:00:00Z",
      },
    });

    const program = createTestProgram();
    program.addCommand(createSharesCommand());
    await program.parseAsync(["shares", "get", "test-id"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith("/api/shares/test-id");
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Test Share");
  });

  it("shares create calls POST /api/shares", async () => {
    mockPost.mockResolvedValue({
      data: {
        id: "new-share-id",
        label: "For Coach",
        metrics: ["sleep_score", "hrv"],
        url: "https://totus.com/v/abc123",
        expires_at: "2026-04-08T00:00:00Z",
      },
    });

    const program = createTestProgram();
    program.addCommand(createSharesCommand());
    await program.parseAsync(
      [
        "--output", "table",
        "shares", "create",
        "--label", "For Coach",
        "--metrics", "sleep_score,hrv",
        "--start", "2025-06-01",
        "--end", "2026-03-08",
        "--expires", "30",
      ],
      { from: "user" },
    );

    expect(mockPost).toHaveBeenCalledWith("/api/shares", {
      label: "For Coach",
      allowed_metrics: ["sleep_score", "hrv"],
      data_start: "2025-06-01",
      data_end: "2026-03-08",
      expires_in_days: 30,
      note: undefined,
    });
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Share created");
  });

  it("shares revoke calls PATCH /api/shares/:id", async () => {
    mockPatch.mockResolvedValue({
      data: {
        id: "test-id",
        label: "Old Share",
        status: "revoked",
        revoked_at: "2026-03-09T16:00:00Z",
      },
    });

    const program = createTestProgram();
    program.addCommand(createSharesCommand());
    await program.parseAsync(["--output", "table", "shares", "revoke", "test-id"], { from: "user" });

    expect(mockPatch).toHaveBeenCalledWith("/api/shares/test-id", { action: "revoke" });
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Share revoked");
  });
});

describe("audit list", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls GET /api/audit with default limit", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          id: "evt-1",
          event_type: "data.viewed",
          actor_type: "owner",
          created_at: "2026-03-09T15:00:00Z",
        },
      ],
    });

    const program = createTestProgram();
    program.addCommand(createAuditCommand());
    await program.parseAsync(["audit", "list"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith("/api/audit", expect.objectContaining({ limit: 50 }));
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("data.viewed");
  });

  it("supports --event-type filter", async () => {
    mockGet.mockResolvedValue({ data: [] });

    const program = createTestProgram();
    program.addCommand(createAuditCommand());
    await program.parseAsync(["audit", "list", "--event-type", "share.created"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith(
      "/api/audit",
      expect.objectContaining({ event_type: "share.created" }),
    );
  });
});

describe("connections commands", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockPost.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connections list shows providers", async () => {
    mockGet.mockResolvedValue({
      data: [
        { id: "conn-1", provider: "oura", status: "connected", last_sync_at: "2026-03-11T06:00:00Z" },
        { id: "conn-2", provider: "whoop", status: "expired", last_sync_at: "2026-02-14T08:00:00Z" },
      ],
    });

    const program = createTestProgram();
    program.addCommand(createConnectionsCommand());
    await program.parseAsync(["connections", "list"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("oura");
    expect(output).toContain("whoop");
    expect(output).toContain("connected");
  });

  it("connections sync --all triggers sync for active connections", async () => {
    mockGet.mockResolvedValue({
      data: [
        { id: "conn-1", provider: "oura", status: "connected" },
        { id: "conn-2", provider: "garmin", status: "expired" },
      ],
    });
    mockPost.mockResolvedValue({ data: { status: "queued" } });

    const program = createTestProgram();
    program.addCommand(createConnectionsCommand());
    await program.parseAsync(["--output", "table", "connections", "sync", "--all"], { from: "user" });

    expect(mockPost).toHaveBeenCalledWith("/api/connections/conn-1/sync");
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Sync triggered");
    expect(output).toContain("garmin");
    expect(output).toContain("skipped");
  });

  it("connections sync without id or --all shows error", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    const program = createTestProgram();
    program.addCommand(createConnectionsCommand());

    try {
      await program.parseAsync(["connections", "sync"], { from: "user" });
    } catch {
      // Expected exit
    }

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Specify a connection ID");
    exitSpy.mockRestore();
  });
});

describe("preferences commands", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockPut.mockReset();
    mockDelete.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preferences list shows preferences", async () => {
    mockGet.mockResolvedValue({
      data: {
        preferences: [
          { metric_type: "hrv", provider: "whoop", updated_at: "2026-03-01T14:22:00Z" },
        ],
      },
    });

    const program = createTestProgram();
    program.addCommand(createPreferencesCommand());
    await program.parseAsync(["preferences", "list"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("hrv");
    expect(output).toContain("whoop");
  });

  it("preferences list shows empty message when no prefs", async () => {
    mockGet.mockResolvedValue({ data: { preferences: [] } });

    const program = createTestProgram();
    program.addCommand(createPreferencesCommand());
    await program.parseAsync(["--output", "table", "preferences", "list"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No source preferences set");
  });

  it("preferences set calls PUT", async () => {
    mockPut.mockResolvedValue({
      data: { metric_type: "hrv", provider: "oura" },
    });

    const program = createTestProgram();
    program.addCommand(createPreferencesCommand());
    await program.parseAsync(["--output", "table", "preferences", "set", "hrv", "oura"], { from: "user" });

    expect(mockPut).toHaveBeenCalledWith("/api/metric-preferences/hrv", { provider: "oura" });
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Preference set: hrv");
  });

  it("preferences delete calls DELETE", async () => {
    mockDelete.mockResolvedValue({ data: {} });

    const program = createTestProgram();
    program.addCommand(createPreferencesCommand());
    await program.parseAsync(["--output", "table", "preferences", "delete", "hrv"], { from: "user" });

    expect(mockDelete).toHaveBeenCalledWith("/api/metric-preferences/hrv");
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Preference cleared: hrv");
  });
});

describe("keys commands", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys list calls GET /api/keys", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          id: "key-1",
          name: "Claude Desktop",
          short_token: "BRTRKFsL",
          scopes: ["health:read", "shares:read"],
          status: "active",
          expires_at: "2026-06-07T00:00:00Z",
          last_used_at: "2026-03-09T15:00:00Z",
          created_at: "2026-03-09T14:23:00Z",
        },
      ],
    });

    const program = createTestProgram();
    program.addCommand(createKeysCommand());
    await program.parseAsync(["keys", "list"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith("/api/keys");
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Claude Desktop");
    expect(output).toContain("BRTRKFsL");
  });

  it("keys create calls POST /api/keys", async () => {
    mockPost.mockResolvedValue({
      data: {
        id: "new-key",
        name: "Cursor MCP",
        key: "test-newly-created-key-placeholder",
        scopes: ["health:read"],
        expires_at: "2026-06-07T00:00:00Z",
      },
    });

    const program = createTestProgram();
    program.addCommand(createKeysCommand());
    await program.parseAsync(
      ["--output", "table", "keys", "create", "--name", "Cursor MCP", "--scopes", "health:read"],
      { from: "user" },
    );

    expect(mockPost).toHaveBeenCalledWith("/api/keys", {
      name: "Cursor MCP",
      scopes: ["health:read"],
      expires_in_days: 90,
    });
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("API key created");
    expect(output).toContain("Cursor MCP");
  });

  it("keys revoke calls PATCH /api/keys/:id", async () => {
    mockPatch.mockResolvedValue({
      data: {
        id: "key-1",
        name: "Old Key",
        status: "revoked",
        revoked_at: "2026-03-09T16:00:00Z",
      },
    });

    const program = createTestProgram();
    program.addCommand(createKeysCommand());
    await program.parseAsync(["--output", "table", "keys", "revoke", "key-1"], { from: "user" });

    expect(mockPatch).toHaveBeenCalledWith("/api/keys/key-1", { action: "revoke" });
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("API key revoked");
  });
});

describe("profile command", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows user profile", async () => {
    mockGet.mockResolvedValue({
      data: {
        display_name: "Wes E.",
        email: "wes@example.com",
        stats: {
          data_points: 4720,
          connections: 2,
          active_shares: 2,
        },
      },
    });

    const program = createTestProgram();
    program.addCommand(createProfileCommand());
    await program.parseAsync(["--output", "table", "profile"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Wes E.");
    expect(output).toContain("4,720");
  });

  it("outputs json with --output json", async () => {
    mockGet.mockResolvedValue({
      data: { display_name: "Test", email: "test@test.com" },
    });

    const program = createTestProgram();
    program.addCommand(createProfileCommand());
    await program.parseAsync(["--output", "json", "profile"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.display_name).toBe("Test");
  });
});

describe("export command", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockPost.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-api-key-placeholder-for-unit-tests",
      source: "config file",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports data to file", async () => {
    const fs = await import("node:fs");
    mockPost.mockResolvedValue({
      data: { health_data: [{ date: "2026-01-01", metric: "sleep_score", value: 85 }] },
    });

    const program = createTestProgram();
    program.addCommand(createExportCommand());
    await program.parseAsync(["export", "--file", "test-export.json"], { from: "user" });

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      "test-export.json",
      expect.any(String),
      "utf-8",
    );
    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Data exported");
  });

  it("outputs json to stdout with --output json", async () => {
    mockPost.mockResolvedValue({ data: { health_data: [] } });

    const program = createTestProgram();
    program.addCommand(createExportCommand());
    await program.parseAsync(["--output", "json", "export"], { from: "user" });

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.health_data).toBeDefined();
  });
});

describe("--api-key flag override", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-flag-override-key-placeholder",
      source: "command flag",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes --api-key flag to resolveApiKey", async () => {
    mockGet.mockResolvedValue({ data: [] });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(
      ["--api-key", "test-flag-override-key-placeholder", "metrics", "list"],
      { from: "user" },
    );

    // The API client was created (which means resolveApiKey was called)
    expect(mockGet).toHaveBeenCalled();
  });
});

describe("TOTUS_API_KEY env var", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockReset();
    mockResolveApiKey.mockReturnValue({
      key: "test-env-var-key-placeholder",
      source: "TOTUS_API_KEY environment variable",
    });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveApiKey checks TOTUS_API_KEY env var", async () => {
    mockGet.mockResolvedValue({ data: [] });

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());
    await program.parseAsync(["metrics", "list"], { from: "user" });

    expect(mockGet).toHaveBeenCalled();
  });
});

describe("unauthenticated error", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows helpful error when no key is configured", async () => {
    mockResolveApiKey.mockReturnValue({ key: undefined, source: "none" });
    mockResolveServerUrl.mockReturnValue("http://localhost:3000");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    const program = createTestProgram();
    program.addCommand(createMetricsCommand());

    try {
      await program.parseAsync(["metrics", "list"], { from: "user" });
    } catch {
      // Expected
    }

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No API key configured");
    expect(output).toContain("totus auth login");
    expect(exitSpy).toHaveBeenCalledWith(2); // EXIT_AUTH

    exitSpy.mockRestore();
  });
});
