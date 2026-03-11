import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "@commander-js/extra-typings";
import { createAuthCommand } from "../commands/auth.js";
import { createConfigCommand } from "../commands/config.js";

// Mock config module
vi.mock("../config.js", () => ({
  readConfig: vi.fn(() => ({})),
  writeConfig: vi.fn(),
  checkConfigPermissions: vi.fn(() => true),
  getConfigPath: vi.fn(() => "/home/user/.config/totus/config.json"),
  resolveApiKey: vi.fn(() => ({ key: undefined, source: "none" })),
  resolveServerUrl: vi.fn(() => "http://localhost:3000"),
  validateApiKeyFormat: vi.fn(),
  maskApiKey: vi.fn(),
  extractShortToken: vi.fn(),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  deleteConfigValue: vi.fn(),
}));

vi.mock("../api-client.js", () => ({
  createApiClient: vi.fn(),
  ApiError: class extends Error {
    code: string;
    statusCode: number;
    exitCode: number;
    constructor(msg: string, code: string, statusCode: number, exitCode: number) {
      super(msg);
      this.code = code;
      this.statusCode = statusCode;
      this.exitCode = exitCode;
    }
  },
}));

/**
 * Create a fully configured program matching the real CLI setup.
 */
function createTestProgram(): Command {
  const program = new Command()
    .name("totus")
    .description("Totus Health Data CLI — manage your health data from the terminal")
    .version("0.1.0")
    .option("--api-key <key>", "Override API key for this command")
    .option("-o, --output <format>", "Output format: table, json, csv")
    .option("-v, --verbose", "Show request/response details")
    .option("--server-url <url>", "Override API server URL")
    .option("--no-color", "Disable colored output")
    .exitOverride();

  program.addCommand(createAuthCommand());
  program.addCommand(createConfigCommand());

  return program;
}

describe("CLI program", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name", () => {
    const program = createTestProgram();
    expect(program.name()).toBe("totus");
  });

  it("has correct version", () => {
    const program = createTestProgram();
    expect(program.version()).toBe("0.1.0");
  });

  it("has a description", () => {
    const program = createTestProgram();
    expect(program.description()).toContain("Totus Health Data CLI");
  });

  it("shows help text with --help flag", () => {
    const program = createTestProgram();

    let helpOutput = "";
    program.configureOutput({
      writeOut: (str) => {
        helpOutput = str;
      },
    });

    try {
      program.parse(["--help"], { from: "user" });
    } catch {
      // Commander throws on --help with exitOverride
    }

    expect(helpOutput).toContain("totus");
    expect(helpOutput).toContain("Totus Health Data CLI");
    expect(helpOutput).toContain("auth");
    expect(helpOutput).toContain("config");
  });

  it("shows version with --version flag", () => {
    const program = createTestProgram();

    let versionOutput = "";
    program.configureOutput({
      writeOut: (str) => {
        versionOutput = str;
      },
    });

    try {
      program.parse(["--version"], { from: "user" });
    } catch {
      // Commander throws on --version with exitOverride
    }

    expect(versionOutput).toContain("0.1.0");
  });

  it("has global --api-key option", () => {
    const program = createTestProgram();
    const options = program.options.map((o) => o.long);
    expect(options).toContain("--api-key");
  });

  it("has global --output option", () => {
    const program = createTestProgram();
    const options = program.options.map((o) => o.long || o.short);
    expect(options).toContain("--output");
  });

  it("has global --verbose option", () => {
    const program = createTestProgram();
    const options = program.options.map((o) => o.long || o.short);
    expect(options).toContain("--verbose");
  });

  it("has global --server-url option", () => {
    const program = createTestProgram();
    const options = program.options.map((o) => o.long);
    expect(options).toContain("--server-url");
  });

  it("has auth subcommand", () => {
    const program = createTestProgram();
    const subcommands = program.commands.map((c) => c.name());
    expect(subcommands).toContain("auth");
  });

  it("has config subcommand", () => {
    const program = createTestProgram();
    const subcommands = program.commands.map((c) => c.name());
    expect(subcommands).toContain("config");
  });

  it("auth subcommand has login, logout, status, token", () => {
    const program = createTestProgram();
    const auth = program.commands.find((c) => c.name() === "auth");
    expect(auth).toBeDefined();

    const subcommands = auth!.commands.map((c) => c.name());
    expect(subcommands).toContain("login");
    expect(subcommands).toContain("logout");
    expect(subcommands).toContain("status");
    expect(subcommands).toContain("token");
  });

  it("config subcommand has get, set, list", () => {
    const program = createTestProgram();
    const config = program.commands.find((c) => c.name() === "config");
    expect(config).toBeDefined();

    const subcommands = config!.commands.map((c) => c.name());
    expect(subcommands).toContain("get");
    expect(subcommands).toContain("set");
    expect(subcommands).toContain("list");
  });
});
