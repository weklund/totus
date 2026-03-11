import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "@commander-js/extra-typings";
import { getRootOpts, resolveClientOptions, getClient } from "../command-helpers.js";

// Mock config module
vi.mock("../config.js", () => ({
  resolveApiKey: vi.fn(() => ({
    key: "test-api-key-placeholder-for-unit-tests",
    source: "config file",
  })),
  resolveServerUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock API client
vi.mock("../api-client.js", () => ({
  createApiClient: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("command-helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRootOpts", () => {
    it("walks up to root command to get global options", () => {
      const root = new Command()
        .option("--api-key <key>")
        .option("--server-url <url>")
        .option("-o, --output <format>")
        .option("-v, --verbose");

      const sub = new Command("sub");
      root.addCommand(sub);
      const nested = new Command("nested");
      sub.addCommand(nested);

      root.parse(["--api-key", "test-key", "sub", "nested"], { from: "user" });

      const opts = getRootOpts(nested);
      expect(opts.apiKey).toBe("test-key");
    });

    it("returns root opts even when no flags set", () => {
      const root = new Command()
        .option("--api-key <key>")
        .option("--server-url <url>");

      const sub = new Command("sub");
      root.addCommand(sub);
      sub.action(() => {});

      root.parse(["sub"], { from: "user" });

      const opts = getRootOpts(sub);
      expect(opts.apiKey).toBeUndefined();
    });
  });

  describe("resolveClientOptions", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stderrSpy: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exitSpy: any;

    beforeEach(() => {
      stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("exits with code 2 when no API key", async () => {
      exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);

      const configMod = vi.mocked(await import("../config.js"));
      configMod.resolveApiKey.mockReturnValue({ key: undefined, source: "none" });

      const root = new Command().option("--api-key <key>").option("--server-url <url>").option("-o, --output <format>").option("-v, --verbose");

      root.parse([], { from: "user" });

      try {
        resolveClientOptions(root);
      } catch {
        // Expected
      }

      expect(exitSpy).toHaveBeenCalledWith(2);
      exitSpy.mockRestore();
    });

    it("returns resolved options when API key is present", async () => {
      const configMod = vi.mocked(await import("../config.js"));
      configMod.resolveApiKey.mockReturnValue({
        key: "test-api-key-placeholder-for-unit-tests",
        source: "config file",
      });
      configMod.resolveServerUrl.mockReturnValue("http://localhost:3000");

      const root = new Command().option("--api-key <key>").option("--server-url <url>").option("-o, --output <format>").option("-v, --verbose");

      root.parse([], { from: "user" });

      const opts = resolveClientOptions(root);
      expect(opts.apiKey).toBe("test-api-key-placeholder-for-unit-tests");
      expect(opts.serverUrl).toBe("http://localhost:3000");
    });
  });

  describe("getClient", () => {
    it("returns client and options", async () => {
      const configMod = vi.mocked(await import("../config.js"));
      configMod.resolveApiKey.mockReturnValue({
        key: "test-api-key-placeholder-for-unit-tests",
        source: "config file",
      });
      configMod.resolveServerUrl.mockReturnValue("http://localhost:3000");

      const root = new Command().option("--api-key <key>").option("--server-url <url>").option("-o, --output <format>").option("-v, --verbose");

      root.parse([], { from: "user" });

      const result = getClient(root);
      expect(result.client).toBeDefined();
      expect(result.opts).toBeDefined();
      expect(result.opts.apiKey).toBeDefined();
    });
  });
});
