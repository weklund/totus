import { describe, it, expect } from "vitest";
import { EXIT_SUCCESS, EXIT_ERROR, EXIT_AUTH, EXIT_PERMISSION } from "../exit-codes.js";

describe("exit codes", () => {
  it("EXIT_SUCCESS is 0", () => {
    expect(EXIT_SUCCESS).toBe(0);
  });

  it("EXIT_ERROR is 1", () => {
    expect(EXIT_ERROR).toBe(1);
  });

  it("EXIT_AUTH is 2", () => {
    expect(EXIT_AUTH).toBe(2);
  });

  it("EXIT_PERMISSION is 3", () => {
    expect(EXIT_PERMISSION).toBe(3);
  });

  it("all exit codes are unique", () => {
    const codes = [EXIT_SUCCESS, EXIT_ERROR, EXIT_AUTH, EXIT_PERMISSION];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});
