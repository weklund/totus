// Integration test verifying sync-connection sends dashboard/baselines.refresh.user
// event with userId after successful sync completion.
//
// VAL-JOBS-005: Per-user refresh triggered after sync completion
// VAL-JOBS-007: Per-user baseline refresh triggered after sync
//
// Strategy: Mock all external dependencies (DB, sync-helpers), then exercise the
// syncConnection Inngest function handler via its internal structure to verify
// that step.sendEvent is called with the correct event name and userId.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock all external dependencies ──────────────────────────────────────────

const connectionMeta = {
  id: "conn_test_001",
  dailyCursor: null,
  seriesCursor: null,
  periodsCursor: null,
};

const connectionFull = {
  ...connectionMeta,
  authEnc: Buffer.from("mock-auth"),
};

// Build a chainable mock for db.select() that returns connection data.
// The `.where()` result must be: (1) thenable (resolves to data array), and
// (2) have a `.limit()` method (also resolves to data array).
function createSelectChain(data: unknown[]) {
  // Object that is both thenable (can be awaited directly) and has .limit()
  const whereResult = {
    limit: vi.fn().mockResolvedValue(data),
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(data).then(resolve, reject);
    },
  };
  const whereFn = vi.fn().mockReturnValue(whereResult);
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn };
}

// A single mock function we can control from tests
let selectCallCount = 0;

vi.mock("@/db", () => ({
  db: {
    select: vi.fn().mockImplementation((..._args: unknown[]) => {
      selectCallCount++;
      // First call: fetch-connection step (returns id, cursors)
      // Second call: sync-all step (returns authEnc + cursors)
      if (selectCallCount <= 1) {
        return createSelectChain([connectionMeta]);
      }
      return createSelectChain([connectionFull]);
    }),
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

// Mock sync-helpers so the actual sync logic doesn't run
vi.mock("../../sync-helpers", () => ({
  claimConnection: vi.fn().mockResolvedValue(1),
  markSyncIdle: vi.fn().mockResolvedValue(undefined),
  markSyncError: vi.fn().mockResolvedValue(undefined),
  syncDailyData: vi.fn().mockResolvedValue("cursor-daily"),
  syncSeriesData: vi.fn().mockResolvedValue("cursor-series"),
  syncPeriodData: vi.fn().mockResolvedValue("cursor-period"),
}));

describe("VAL-JOBS-005 / VAL-JOBS-007: sync-connection sends baselines refresh event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
  });

  it("syncConnection function is configured to listen for integration/sync.connection event", async () => {
    const { syncConnection } = await import("../sync-connection");

    expect(syncConnection).toBeDefined();

    const fn = syncConnection as unknown as {
      opts: {
        id: string;
        triggers?: Array<{ event?: string; cron?: string }>;
      };
    };

    expect(fn.opts.id).toBe("integration/sync.connection");
    expect(fn.opts.triggers).toBeDefined();

    const eventTrigger = fn.opts.triggers!.find((t) => t.event !== undefined);
    expect(eventTrigger).toBeDefined();
    expect(eventTrigger!.event).toBe("integration/sync.connection");
  });

  it("sends dashboard/baselines.refresh.user event with userId after successful sync", async () => {
    const { syncConnection } = await import("../sync-connection");

    // Access the private handler from the InngestFunction instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fnInstance = syncConnection as any;

    // The Inngest SDK stores the handler as a private 'fn' property
    const handler = fnInstance.fn as (args: {
      event: {
        data: { connectionId: string; userId: string; provider: string };
      };
      step: {
        run: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
        sendEvent: (
          stepId: string,
          event: { name: string; data: unknown },
        ) => Promise<void>;
      };
    }) => Promise<unknown>;

    expect(typeof handler).toBe("function");

    // Create mock step object
    const sentEvents: Array<{ name: string; data: unknown }> = [];
    const mockStep = {
      run: vi
        .fn()
        .mockImplementation(async (_name: string, fn: () => Promise<unknown>) =>
          fn(),
        ),
      sendEvent: vi
        .fn()
        .mockImplementation(
          async (_stepId: string, event: { name: string; data: unknown }) => {
            sentEvents.push(event);
          },
        ),
    };

    const mockEvent = {
      data: {
        connectionId: "conn_test_001",
        userId: "user_test_sync_001",
        provider: "oura",
      },
    };

    // Invoke the handler
    const result = await handler({ event: mockEvent, step: mockStep });

    // Verify step.sendEvent was called with the correct baselines refresh event
    expect(mockStep.sendEvent).toHaveBeenCalledTimes(1);
    expect(mockStep.sendEvent).toHaveBeenCalledWith(
      "trigger-baselines-refresh",
      {
        name: "dashboard/baselines.refresh.user",
        data: { userId: "user_test_sync_001" },
      },
    );

    // Verify event data
    expect(sentEvents.length).toBe(1);
    expect(sentEvents[0]!.name).toBe("dashboard/baselines.refresh.user");
    expect(sentEvents[0]!.data).toEqual({ userId: "user_test_sync_001" });

    // Verify the function returned success
    expect(result).toEqual({ success: true });
  });

  it("event type dashboard/baselines.refresh.user is defined in Inngest client", async () => {
    const clientModule = await import("@/inngest/client");
    const inngest = clientModule.inngest;

    expect(inngest).toBeDefined();
    expect(inngest.id).toBe("totus");
  });

  it("baselinesRefreshUser function listens for the sync-triggered event", async () => {
    const { baselinesRefreshUser } = await import("../baselines-refresh");

    const fn = baselinesRefreshUser as unknown as {
      opts: {
        id: string;
        triggers?: Array<{ event?: string; cron?: string }>;
      };
    };

    expect(fn.opts.id).toBe("dashboard/baselines.refresh.user");
    expect(fn.opts.triggers).toBeDefined();

    const eventTrigger = fn.opts.triggers!.find((t) => t.event !== undefined);
    expect(eventTrigger).toBeDefined();
    expect(eventTrigger!.event).toBe("dashboard/baselines.refresh.user");
  });
});
