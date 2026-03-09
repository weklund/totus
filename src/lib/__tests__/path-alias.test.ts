import { describe, expect, it } from "vitest";

describe("path alias resolution", () => {
  it("resolves @/lib/cn import", async () => {
    const mod = await import("@/lib/cn");
    expect(mod.cn).toBeDefined();
    expect(typeof mod.cn).toBe("function");
  });
});
