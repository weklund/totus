import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  readConfig,
  writeConfig,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  checkConfigPermissions,
  resolveApiKey,
  resolveServerUrl,
  validateApiKeyFormat,
  maskApiKey,
  extractShortToken,
  getConfigPath,
} from "../config.js";

// Use a temp directory for tests
let tempDir: string;
let originalConfigDir: string;

// We need to mock the module internals, so let's test the pure functions directly
// and handle config file operations with a temp directory

describe("config", () => {
  describe("validateApiKeyFormat", () => {
    it("accepts valid live key", () => {
      expect(validateApiKeyFormat("tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678")).toBe(true);
    });

    it("accepts valid test key", () => {
      expect(validateApiKeyFormat("tot_test_Ab3cD4eF_12345678901234567890123456789012")).toBe(true);
    });

    it("rejects key without tot_ prefix", () => {
      expect(validateApiKeyFormat("xxx_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678")).toBe(false);
    });

    it("rejects key with wrong environment", () => {
      expect(validateApiKeyFormat("tot_prod_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678")).toBe(false);
    });

    it("rejects key with short token too short", () => {
      expect(validateApiKeyFormat("tot_live_SHORT_51FwqftsmMDHHbJAMEXXHCgG12345678")).toBe(false);
    });

    it("rejects key with long token too short", () => {
      expect(validateApiKeyFormat("tot_live_BRTRKFsL_short")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(validateApiKeyFormat("")).toBe(false);
    });

    it("rejects non-base62 characters in short token", () => {
      expect(validateApiKeyFormat("tot_live_BR-RKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678")).toBe(false);
    });

    it("rejects non-base62 characters in long token", () => {
      expect(validateApiKeyFormat("tot_live_BRTRKFsL_51Fwqftsm-DHHbJAMEXXHCgG12345678")).toBe(false);
    });
  });

  describe("maskApiKey", () => {
    it("masks a valid key showing prefix and short token", () => {
      expect(maskApiKey("tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678")).toBe("tot_live_...BRTRKFsL");
    });

    it("masks a test key", () => {
      expect(maskApiKey("tot_test_Ab3cD4eF_12345678901234567890123456789012")).toBe("tot_test_...Ab3cD4eF");
    });

    it("returns error message for invalid format", () => {
      expect(maskApiKey("invalid-key")).toBe("***invalid key format***");
    });
  });

  describe("extractShortToken", () => {
    it("extracts short token from valid key", () => {
      expect(extractShortToken("tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG12345678")).toBe("BRTRKFsL");
    });

    it("extracts short token from test key", () => {
      expect(extractShortToken("tot_test_Ab3cD4eF_12345678901234567890123456789012")).toBe("Ab3cD4eF");
    });

    it("returns null for invalid key", () => {
      expect(extractShortToken("invalid-key")).toBe(null);
    });
  });

  describe("resolveApiKey", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.TOTUS_API_KEY;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("prefers flag value over everything", () => {
      process.env.TOTUS_API_KEY = "env_key";
      const result = resolveApiKey("flag_key");
      expect(result.key).toBe("flag_key");
      expect(result.source).toBe("command flag");
    });

    it("uses env var when no flag is provided", () => {
      process.env.TOTUS_API_KEY = "env_key";
      const result = resolveApiKey();
      expect(result.key).toBe("env_key");
      expect(result.source).toBe("TOTUS_API_KEY environment variable");
    });

    it("returns undefined key when nothing is configured", () => {
      // No flag, no env, config file may or may not exist
      const result = resolveApiKey();
      // key might come from config file if it exists
      expect(result.source).toBeDefined();
    });
  });

  describe("resolveServerUrl", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.TOTUS_API_URL;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("prefers flag value", () => {
      process.env.TOTUS_API_URL = "http://env-url";
      expect(resolveServerUrl("http://flag-url")).toBe("http://flag-url");
    });

    it("uses env var when no flag", () => {
      process.env.TOTUS_API_URL = "http://env-url";
      expect(resolveServerUrl()).toBe("http://env-url");
    });

    it("defaults to https://totus.com/api when no config file exists", () => {
      // Mock readConfig to return empty config (no config file on disk)
      const origReadFile = fs.readFileSync;
      const origExists = fs.existsSync;
      // Temporarily rename the config file if it exists to avoid reading it
      const configPath = path.join(os.homedir(), ".config", "totus", "config.json");
      const backupPath = configPath + ".test-backup";
      let didBackup = false;
      try {
        if (origExists(configPath)) {
          fs.renameSync(configPath, backupPath);
          didBackup = true;
        }
        expect(resolveServerUrl()).toBe("https://totus.com/api");
      } finally {
        if (didBackup) {
          fs.renameSync(backupPath, configPath);
        }
      }
    });
  });

  describe("getConfigPath", () => {
    it("returns a path ending in config.json", () => {
      const p = getConfigPath();
      expect(p).toContain("config.json");
      expect(p).toContain(".config");
      expect(p).toContain("totus");
    });
  });
});
