import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "@commander-js/extra-typings";
import { createAuthCommand } from "../commands/auth.js";

// Mock the config module
vi.mock("../config.js", () => ({
  readConfig: vi.fn(() => ({})),
  writeConfig: vi.fn(),
  validateApiKeyFormat: vi.fn((key: string) =>
    /^tot_(live|test)_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/.test(key),
  ),
  maskApiKey: vi.fn((key: string) => {
    const match = key.match(/^(tot_(live|test))_([A-Za-z0-9]{8})_/);
    return match ? `${match[1]}_...${match[3]}` : "***invalid key format***";
  }),
  resolveApiKey: vi.fn(() => ({ key: undefined, source: "none" })),
  resolveServerUrl: vi.fn(() => "http://localhost:3000"),
  getConfigPath: vi.fn(() => "/home/user/.config/totus/config.json"),
  checkConfigPermissions: vi.fn(() => true),
  extractShortToken: vi.fn(),
}));

// Mock the api-client module
vi.mock("../api-client.js", () => ({
  createApiClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue({
      data: { display_name: "Test User", email: "test@example.com" },
    }),
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

describe("auth commands", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth command structure", () => {
    it("creates auth command with subcommands", () => {
      const auth = createAuthCommand();
      expect(auth.name()).toBe("auth");

      const subcommands = auth.commands.map((c) => c.name());
      expect(subcommands).toContain("login");
      expect(subcommands).toContain("logout");
      expect(subcommands).toContain("status");
      expect(subcommands).toContain("token");
    });
  });

  describe("auth logout", () => {
    it("clears API key from config", async () => {
      const { readConfig, writeConfig } = await import("../config.js");
      vi.mocked(readConfig).mockReturnValue({
        api_key: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
      });

      const program = new Command().exitOverride();
      program.addCommand(createAuthCommand());

      try {
        program.parse(["auth", "logout"], { from: "user" });
      } catch {
        // May throw due to exitOverride
      }

      expect(writeConfig).toHaveBeenCalledWith({});
    });

    it("handles already logged out state", async () => {
      const { readConfig } = await import("../config.js");
      vi.mocked(readConfig).mockReturnValue({});

      const program = new Command().exitOverride();
      program.addCommand(createAuthCommand());

      try {
        program.parse(["auth", "logout"], { from: "user" });
      } catch {
        // process.exit is mocked
      }

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("Already logged out"),
      );
    });
  });

  describe("auth token", () => {
    it("shows masked key when authenticated", async () => {
      const { resolveApiKey } = await import("../config.js");
      vi.mocked(resolveApiKey).mockReturnValue({
        key: "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678",
        source: "config file",
      });

      const program = new Command()
        .option("--api-key <key>")
        .exitOverride();
      program.addCommand(createAuthCommand());

      try {
        program.parse(["auth", "token"], { from: "user" });
      } catch {
        // process.exit may be called
      }

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("tot_live_...BRTRKFsL"),
      );
    });

    it("shows error when not authenticated", async () => {
      const { resolveApiKey } = await import("../config.js");
      vi.mocked(resolveApiKey).mockReturnValue({
        key: undefined,
        source: "none",
      });

      const program = new Command()
        .option("--api-key <key>")
        .exitOverride();
      program.addCommand(createAuthCommand());

      try {
        program.parse(["auth", "token"], { from: "user" });
      } catch {
        // process.exit is mocked
      }

      expect(exitSpy).toHaveBeenCalledWith(2); // EXIT_AUTH
    });
  });
});
