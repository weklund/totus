// Unit test asserting Inngest function configuration values for the
// baselines refresh cron job.
//
// VAL-JOBS-001: Job configuration — cron, concurrency, retries
//
// The `dashboard/baselines.refresh` function must:
// - Run on cron "30 */6 * * *" (00:30, 06:30, 12:30, 18:30 UTC)
// - Have concurrency limit of 5
// - Retry up to 3 times on failure

import { describe, expect, it, vi } from "vitest";

// Mock external dependencies to avoid DB connection during unit test
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    selectDistinct: vi.fn(),
  },
}));

vi.mock("@/lib/encryption", () => ({
  createEncryptionProvider: vi.fn().mockReturnValue({
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  }),
}));

vi.mock("@/lib/api/source-resolution", () => ({
  resolveSourcesForMetrics: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/dashboard/baselines", () => ({
  computeBaselinesOnDemand: vi.fn().mockResolvedValue(new Map()),
}));

describe("VAL-JOBS-001: baselinesRefresh function configuration", () => {
  it("has cron schedule '30 */6 * * *'", async () => {
    const { baselinesRefresh } = await import("../baselines-refresh");

    // Access the internal opts which contain triggers
    const fn = baselinesRefresh as unknown as {
      opts: {
        triggers?: Array<{ cron?: string; event?: string }>;
      };
    };

    expect(fn.opts.triggers).toBeDefined();
    expect(fn.opts.triggers!.length).toBeGreaterThan(0);

    const cronTrigger = fn.opts.triggers!.find(
      (t: { cron?: string }) => t.cron !== undefined,
    );
    expect(cronTrigger).toBeDefined();
    expect(cronTrigger!.cron).toBe("30 */6 * * *");
  });

  it("has concurrency limit of 5", async () => {
    const { baselinesRefresh } = await import("../baselines-refresh");

    const fn = baselinesRefresh as unknown as {
      opts: {
        concurrency?: Array<{ limit: number }> | number;
      };
    };

    expect(fn.opts.concurrency).toBeDefined();

    // concurrency is specified as an array of objects: [{ limit: 5 }]
    if (Array.isArray(fn.opts.concurrency)) {
      const hasLimit5 = fn.opts.concurrency.some(
        (c: { limit: number }) => c.limit === 5,
      );
      expect(hasLimit5).toBe(true);
    } else {
      // Or it could be a single number
      expect(fn.opts.concurrency).toBe(5);
    }
  });

  it("has retries set to 3", async () => {
    const { baselinesRefresh } = await import("../baselines-refresh");

    const fn = baselinesRefresh as unknown as {
      opts: {
        retries?: number;
      };
    };

    expect(fn.opts.retries).toBe(3);
  });

  it("has function id 'dashboard/baselines.refresh'", async () => {
    const { baselinesRefresh } = await import("../baselines-refresh");

    const fn = baselinesRefresh as unknown as {
      opts: {
        id: string;
      };
    };

    expect(fn.opts.id).toBe("dashboard/baselines.refresh");
  });
});

describe("baselinesRefreshUser function configuration", () => {
  it("is triggered by 'dashboard/baselines.refresh.user' event", async () => {
    const { baselinesRefreshUser } = await import("../baselines-refresh");

    const fn = baselinesRefreshUser as unknown as {
      opts: {
        triggers?: Array<{ cron?: string; event?: string }>;
      };
    };

    expect(fn.opts.triggers).toBeDefined();
    expect(fn.opts.triggers!.length).toBeGreaterThan(0);

    const eventTrigger = fn.opts.triggers!.find(
      (t: { event?: string }) => t.event !== undefined,
    );
    expect(eventTrigger).toBeDefined();
    expect(eventTrigger!.event).toBe("dashboard/baselines.refresh.user");
  });

  it("has retries set to 3", async () => {
    const { baselinesRefreshUser } = await import("../baselines-refresh");

    const fn = baselinesRefreshUser as unknown as {
      opts: {
        retries?: number;
      };
    };

    expect(fn.opts.retries).toBe(3);
  });
});
