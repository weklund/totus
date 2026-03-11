import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "@commander-js/extra-typings";
import { createConfigCommand } from "../commands/config.js";

// Mock the config module
vi.mock("../config.js", () => ({
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  getConfigPath: vi.fn(() => "/home/user/.config/totus/config.json"),
  readConfig: vi.fn(() => ({})),
}));

describe("config commands", () => {
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

  describe("config command structure", () => {
    it("creates config command with subcommands", () => {
      const config = createConfigCommand();
      expect(config.name()).toBe("config");

      const subcommands = config.commands.map((c) => c.name());
      expect(subcommands).toContain("get");
      expect(subcommands).toContain("set");
      expect(subcommands).toContain("list");
    });
  });

  describe("config get", () => {
    it("gets a config value", async () => {
      const { getConfigValue } = await import("../config.js");
      vi.mocked(getConfigValue).mockReturnValue("http://localhost:3000");

      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "get", "api_url"], { from: "user" });
      } catch {
        // May throw due to exitOverride
      }

      expect(getConfigValue).toHaveBeenCalledWith("api_url");
      expect(stdoutSpy).toHaveBeenCalledWith("http://localhost:3000\n");
    });

    it("shows not set for missing values", async () => {
      const { getConfigValue } = await import("../config.js");
      vi.mocked(getConfigValue).mockReturnValue(undefined);

      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "get", "api_url"], { from: "user" });
      } catch {
        // May throw
      }

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("not set"),
      );
    });

    it("rejects invalid keys", async () => {
      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "get", "invalid_key"], { from: "user" });
      } catch {
        // process.exit is mocked
      }

      expect(exitSpy).toHaveBeenCalledWith(1); // EXIT_ERROR
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown config key "invalid_key"'),
      );
    });
  });

  describe("config set", () => {
    it("sets a config value", async () => {
      const { setConfigValue } = await import("../config.js");

      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "set", "api_url", "http://localhost:3000"], {
          from: "user",
        });
      } catch {
        // May throw
      }

      expect(setConfigValue).toHaveBeenCalledWith("api_url", "http://localhost:3000");
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("Config set: api_url"),
      );
    });

    it("rejects invalid keys", async () => {
      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "set", "invalid_key", "value"], {
          from: "user",
        });
      } catch {
        // process.exit is mocked
      }

      expect(exitSpy).toHaveBeenCalledWith(1); // EXIT_ERROR
    });

    it("validates default_output values", async () => {
      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "set", "default_output", "invalid"], {
          from: "user",
        });
      } catch {
        // process.exit is mocked
      }

      expect(exitSpy).toHaveBeenCalledWith(1); // EXIT_ERROR
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid output format "invalid"'),
      );
    });

    it("accepts valid default_output values", async () => {
      const { setConfigValue } = await import("../config.js");

      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "set", "default_output", "json"], {
          from: "user",
        });
      } catch {
        // May throw
      }

      expect(setConfigValue).toHaveBeenCalledWith("default_output", "json");
    });

    it("converts boolean string values", async () => {
      const { setConfigValue } = await import("../config.js");

      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "set", "phi_notice_shown", "true"], {
          from: "user",
        });
      } catch {
        // May throw
      }

      expect(setConfigValue).toHaveBeenCalledWith("phi_notice_shown", true);
    });

    it("maps server_url alias to api_url", async () => {
      const { setConfigValue } = await import("../config.js");

      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "set", "server_url", "http://localhost:3000"], {
          from: "user",
        });
      } catch {
        // May throw
      }

      // server_url should be stored as api_url
      expect(setConfigValue).toHaveBeenCalledWith("api_url", "http://localhost:3000");
    });
  });

  describe("config list", () => {
    it("lists all config values", async () => {
      const { readConfig } = await import("../config.js");
      vi.mocked(readConfig).mockReturnValue({
        api_url: "http://localhost:3000",
        default_output: "table",
      });

      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "list"], { from: "user" });
      } catch {
        // May throw
      }

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("api_url: http://localhost:3000"),
      );
      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("default_output: table"),
      );
    });

    it("shows empty state when no config values", async () => {
      const { readConfig } = await import("../config.js");
      vi.mocked(readConfig).mockReturnValue({});

      const program = new Command().exitOverride();
      program.addCommand(createConfigCommand());

      try {
        program.parse(["config", "list"], { from: "user" });
      } catch {
        // May throw
      }

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("no values set"),
      );
    });
  });
});
