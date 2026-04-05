import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { EncryptionProvider } from "@/lib/encryption";

/**
 * Unit tests for the annotation merge service.
 *
 * Tests cover:
 * - Merging user_annotations + health_data_periods into unified sorted timeline
 * - Source field distinction (user vs provider name)
 * - Sorted by occurred_at ascending
 * - Empty date range returns empty array
 * - Decryption of label_encrypted and note_encrypted
 * - Viewer metric filtering per annotation-to-metric mapping (LLD §9.2)
 *
 * VAL-ANNOT-003, VAL-ANNOT-005, VAL-CROSS-013, VAL-CROSS-014
 */

describe("fetchMergedAnnotations", () => {
  let fetchMergedAnnotations: typeof import("@/lib/dashboard/annotations").fetchMergedAnnotations;

  const mockEncryption: EncryptionProvider = {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  };

  // Helper to build a mock database that returns specified rows
  function createMockDb(
    userAnnotationRows: Array<{
      id: number;
      eventType: string;
      labelEncrypted: Buffer;
      noteEncrypted: Buffer | null;
      occurredAt: Date;
      endedAt: Date | null;
    }>,
    periodRows: Array<{
      eventType: string;
      source: string;
      startedAt: Date;
      endedAt: Date;
    }>,
  ) {
    // Mock chained select → from → where for two parallel queries
    const userWhereFn = vi.fn().mockResolvedValue(userAnnotationRows);
    const userFromFn = vi.fn().mockReturnValue({ where: userWhereFn });

    const periodWhereFn = vi.fn().mockResolvedValue(periodRows);
    const periodFromFn = vi.fn().mockReturnValue({ where: periodWhereFn });

    const selectFn = vi
      .fn()
      .mockReturnValueOnce({ from: userFromFn })
      .mockReturnValueOnce({ from: periodFromFn });

    return { select: selectFn } as unknown as NodePgDatabase;
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import("@/lib/dashboard/annotations");
    fetchMergedAnnotations = mod.fetchMergedAnnotations;

    // Default decrypt implementation: return the buffer as-is
    (mockEncryption.decrypt as ReturnType<typeof vi.fn>).mockImplementation(
      async (buf: Buffer) => buf,
    );
  });

  // --- Merge + Sort ---

  it("merges user annotations and provider events sorted by occurred_at ascending", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from("Late dinner"),
        noteEncrypted: Buffer.from("Pasta and wine"),
        occurredAt: new Date("2026-03-28T21:30:00.000Z"),
        endedAt: null,
      },
    ];

    const periodRows = [
      {
        eventType: "workout",
        source: "oura",
        startedAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T17:52:00.000Z"),
      },
    ];

    const mockDb = createMockDb(userRows, periodRows);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toHaveLength(2);
    // Workout at 17:00 should come first (earlier)
    expect(result[0]!.event_type).toBe("workout");
    expect(result[0]!.occurred_at).toBe("2026-03-28T17:00:00.000Z");
    // Meal at 21:30 should come second
    expect(result[1]!.event_type).toBe("meal");
    expect(result[1]!.occurred_at).toBe("2026-03-28T21:30:00.000Z");
  });

  it("sorts multiple annotations from both sources by occurred_at ascending", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from("Breakfast"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T08:00:00.000Z"),
        endedAt: null,
      },
      {
        id: 2,
        eventType: "medication",
        labelEncrypted: Buffer.from("Vitamin D"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T09:00:00.000Z"),
        endedAt: null,
      },
    ];

    const periodRows = [
      {
        eventType: "workout",
        source: "oura",
        startedAt: new Date("2026-03-28T06:30:00.000Z"),
        endedAt: new Date("2026-03-28T07:15:00.000Z"),
      },
      {
        eventType: "sleep",
        source: "oura",
        startedAt: new Date("2026-03-27T22:00:00.000Z"),
        endedAt: new Date("2026-03-28T06:00:00.000Z"),
      },
    ];

    const mockDb = createMockDb(userRows, periodRows);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-27T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toHaveLength(4);
    // Verify ascending order
    expect(result[0]!.occurred_at).toBe("2026-03-27T22:00:00.000Z"); // sleep
    expect(result[1]!.occurred_at).toBe("2026-03-28T06:30:00.000Z"); // workout
    expect(result[2]!.occurred_at).toBe("2026-03-28T08:00:00.000Z"); // breakfast
    expect(result[3]!.occurred_at).toBe("2026-03-28T09:00:00.000Z"); // medication
  });

  // --- Source field distinction ---

  it("sets source='user' for user annotations and provider name for period events", async () => {
    const userRows = [
      {
        id: 42,
        eventType: "meal",
        labelEncrypted: Buffer.from("Late dinner"),
        noteEncrypted: Buffer.from("Heavy pasta, red wine"),
        occurredAt: new Date("2026-03-28T21:30:00.000Z"),
        endedAt: null,
      },
    ];

    const periodRows = [
      {
        eventType: "workout",
        source: "oura",
        startedAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T17:52:00.000Z"),
      },
      {
        eventType: "meal",
        source: "cronometer",
        startedAt: new Date("2026-03-28T12:00:00.000Z"),
        endedAt: new Date("2026-03-28T12:30:00.000Z"),
      },
    ];

    const mockDb = createMockDb(userRows, periodRows);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    // User annotation
    const userAnnotation = result.find((a) => a.id === 42);
    expect(userAnnotation).toBeDefined();
    expect(userAnnotation!.source).toBe("user");

    // Provider annotations
    const ouraAnnotation = result.find((a) => a.source === "oura");
    expect(ouraAnnotation).toBeDefined();
    expect(ouraAnnotation!.id).toBeNull();

    const cronometerAnnotation = result.find((a) => a.source === "cronometer");
    expect(cronometerAnnotation).toBeDefined();
    expect(cronometerAnnotation!.id).toBeNull();
  });

  it("provider events have id=null and use event_type as label", async () => {
    const periodRows = [
      {
        eventType: "workout",
        source: "oura",
        startedAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T17:52:00.000Z"),
      },
    ];

    const mockDb = createMockDb([], periodRows);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBeNull();
    expect(result[0]!.source).toBe("oura");
    expect(result[0]!.label).toBe("workout");
    expect(result[0]!.note).toBeNull();
    expect(result[0]!.ended_at).toBe("2026-03-28T17:52:00.000Z");
  });

  // --- Empty range ---

  it("returns empty array when no annotations exist in the date range", async () => {
    const mockDb = createMockDb([], []);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toEqual([]);
  });

  it("returns empty array when only user annotations exist with no data", async () => {
    const mockDb = createMockDb([], []);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toEqual([]);
  });

  // --- Decryption ---

  it("decrypts label_encrypted and note_encrypted for user annotations", async () => {
    const labelPlaintext = "Late dinner 🍝";
    const notePlaintext = "3 glasses of wine 🍷";

    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from(labelPlaintext),
        noteEncrypted: Buffer.from(notePlaintext),
        occurredAt: new Date("2026-03-28T21:30:00.000Z"),
        endedAt: null,
      },
    ];

    const mockDb = createMockDb(userRows, []);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe(labelPlaintext);
    expect(result[0]!.note).toBe(notePlaintext);

    // Verify decrypt was called with correct arguments
    expect(mockEncryption.decrypt).toHaveBeenCalledTimes(2);
    expect(mockEncryption.decrypt).toHaveBeenCalledWith(
      Buffer.from(labelPlaintext),
      "user_001",
    );
    expect(mockEncryption.decrypt).toHaveBeenCalledWith(
      Buffer.from(notePlaintext),
      "user_001",
    );
  });

  it("handles null note_encrypted (note is optional)", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "workout",
        labelEncrypted: Buffer.from("Morning run"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T06:00:00.000Z"),
        endedAt: new Date("2026-03-28T06:45:00.000Z"),
      },
    ];

    const mockDb = createMockDb(userRows, []);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("Morning run");
    expect(result[0]!.note).toBeNull();

    // Only one decrypt call (for label, not for null note)
    expect(mockEncryption.decrypt).toHaveBeenCalledTimes(1);
  });

  it("preserves Unicode through decryption round-trip", async () => {
    const unicodeLabel = "Dîner tardif 🍷";
    const unicodeNote = "Pâtes à la carbonara — très copieux!";

    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from(unicodeLabel),
        noteEncrypted: Buffer.from(unicodeNote),
        occurredAt: new Date("2026-03-28T21:00:00.000Z"),
        endedAt: null,
      },
    ];

    const mockDb = createMockDb(userRows, []);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result[0]!.label).toBe(unicodeLabel);
    expect(result[0]!.note).toBe(unicodeNote);
  });

  // --- Viewer filtering ---

  it("filters annotations by viewer metrics when viewerMetrics is provided", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from("Late dinner"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T21:30:00.000Z"),
        endedAt: null,
      },
      {
        id: 2,
        eventType: "workout",
        labelEncrypted: Buffer.from("10K run"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T18:00:00.000Z"),
      },
    ];

    const mockDb = createMockDb(userRows, []);

    // Viewer granted glucose → should see meal but not workout
    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
      ["glucose"],
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.event_type).toBe("meal");
    expect(result[0]!.label).toBe("Late dinner");
  });

  it("viewer with nutrition metric grant sees meal annotation", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from("Lunch"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T12:00:00.000Z"),
        endedAt: null,
      },
      {
        id: 2,
        eventType: "workout",
        labelEncrypted: Buffer.from("10K run"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T18:00:00.000Z"),
      },
    ];

    const mockDb = createMockDb(userRows, []);

    // Viewer granted protein_g (nutrition metric) → should see meal but not workout
    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
      ["protein_g"],
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.event_type).toBe("meal");
    expect(result[0]!.label).toBe("Lunch");
  });

  it("viewer with activity metrics sees workout but not meal", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from("Lunch"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T12:00:00.000Z"),
        endedAt: null,
      },
      {
        id: 2,
        eventType: "workout",
        labelEncrypted: Buffer.from("10K run"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T18:00:00.000Z"),
      },
    ];

    const mockDb = createMockDb(userRows, []);

    // Viewer granted active_calories + heart_rate → sees workout, not meal
    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
      ["active_calories", "heart_rate"],
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.event_type).toBe("workout");
  });

  it("medication/supplement/custom visible with any granted metric", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "medication",
        labelEncrypted: Buffer.from("Ibuprofen"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T08:00:00.000Z"),
        endedAt: null,
      },
      {
        id: 2,
        eventType: "supplement",
        labelEncrypted: Buffer.from("Vitamin D"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T08:05:00.000Z"),
        endedAt: null,
      },
      {
        id: 3,
        eventType: "custom",
        labelEncrypted: Buffer.from("Felt dizzy"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T10:00:00.000Z"),
        endedAt: null,
      },
    ];

    const mockDb = createMockDb(userRows, []);

    // Any granted metric makes medication/supplement/custom visible
    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
      ["rhr"], // just rhr — should still see medication, supplement, custom
    );

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.event_type)).toEqual([
      "medication",
      "supplement",
      "custom",
    ]);
  });

  it("viewer with sleep_score grant sees travel and alcohol annotations", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "travel",
        labelEncrypted: Buffer.from("Flight to NYC"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T06:00:00.000Z"),
        endedAt: new Date("2026-03-28T10:00:00.000Z"),
      },
      {
        id: 2,
        eventType: "alcohol",
        labelEncrypted: Buffer.from("Wine at dinner"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T20:00:00.000Z"),
        endedAt: null,
      },
    ];

    const mockDb = createMockDb(userRows, []);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
      ["sleep_score"],
    );

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.event_type)).toEqual(["travel", "alcohol"]);
  });

  it("does not filter when viewerMetrics is undefined (owner access)", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from("Lunch"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T12:00:00.000Z"),
        endedAt: null,
      },
      {
        id: 2,
        eventType: "workout",
        labelEncrypted: Buffer.from("Gym"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: null,
      },
    ];

    const mockDb = createMockDb(userRows, []);

    // No viewerMetrics → owner access, all visible
    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toHaveLength(2);
  });

  it("filters provider events through viewer metrics just like user annotations", async () => {
    const periodRows = [
      {
        eventType: "workout",
        source: "oura",
        startedAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T17:52:00.000Z"),
      },
      {
        eventType: "meal",
        source: "cronometer",
        startedAt: new Date("2026-03-28T12:00:00.000Z"),
        endedAt: new Date("2026-03-28T12:30:00.000Z"),
      },
    ];

    const mockDb = createMockDb([], periodRows);

    // Viewer granted glucose → sees cronometer meal but not oura workout
    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
      ["glucose"],
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("cronometer");
    expect(result[0]!.event_type).toBe("meal");
  });

  it("viewer with empty metrics array sees no annotations (except nothing matches)", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from("Dinner"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T19:00:00.000Z"),
        endedAt: null,
      },
      {
        id: 2,
        eventType: "medication",
        labelEncrypted: Buffer.from("Aspirin"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T20:00:00.000Z"),
        endedAt: null,
      },
    ];

    const mockDb = createMockDb(userRows, []);

    // Viewer with empty array → medication/supplement/custom require at least one metric
    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
      [],
    );

    expect(result).toHaveLength(0);
  });

  // --- Annotation interface compliance ---

  it("returns Annotation objects matching the interface", async () => {
    const userRows = [
      {
        id: 42,
        eventType: "meal",
        labelEncrypted: Buffer.from("Late dinner"),
        noteEncrypted: Buffer.from("Heavy pasta, red wine"),
        occurredAt: new Date("2026-03-28T21:30:00.000Z"),
        endedAt: null,
      },
    ];

    const periodRows = [
      {
        eventType: "workout",
        source: "oura",
        startedAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T17:52:00.000Z"),
      },
    ];

    const mockDb = createMockDb(userRows, periodRows);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    // Check user annotation structure
    const userAnnotation = result.find((a) => a.source === "user")!;
    expect(userAnnotation).toEqual({
      id: 42,
      source: "user",
      event_type: "meal",
      label: "Late dinner",
      note: "Heavy pasta, red wine",
      occurred_at: "2026-03-28T21:30:00.000Z",
      ended_at: null,
    });

    // Check provider event structure
    const providerAnnotation = result.find((a) => a.source === "oura")!;
    expect(providerAnnotation).toEqual({
      id: null,
      source: "oura",
      event_type: "workout",
      label: "workout",
      note: null,
      occurred_at: "2026-03-28T17:00:00.000Z",
      ended_at: "2026-03-28T17:52:00.000Z",
    });
  });

  // --- Only user annotations when no periods exist ---

  it("returns only user annotations when no period events exist", async () => {
    const userRows = [
      {
        id: 1,
        eventType: "meal",
        labelEncrypted: Buffer.from("Lunch"),
        noteEncrypted: null,
        occurredAt: new Date("2026-03-28T12:00:00.000Z"),
        endedAt: null,
      },
    ];

    const mockDb = createMockDb(userRows, []);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("user");
  });

  // --- Only provider events when no user annotations exist ---

  it("returns only provider events when no user annotations exist", async () => {
    const periodRows = [
      {
        eventType: "workout",
        source: "oura",
        startedAt: new Date("2026-03-28T17:00:00.000Z"),
        endedAt: new Date("2026-03-28T17:52:00.000Z"),
      },
    ];

    const mockDb = createMockDb([], periodRows);

    const result = await fetchMergedAnnotations(
      "user_001",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      mockEncryption,
      mockDb,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("oura");
    expect(result[0]!.id).toBeNull();
  });
});

describe("isAnnotationVisibleToViewer", () => {
  let isAnnotationVisibleToViewer: typeof import("@/lib/dashboard/annotations").isAnnotationVisibleToViewer;

  beforeEach(async () => {
    const mod = await import("@/lib/dashboard/annotations");
    isAnnotationVisibleToViewer = mod.isAnnotationVisibleToViewer;
  });

  // --- meal → glucose + all nutrition metrics ---

  it("meal visible when viewer has glucose grant", () => {
    expect(isAnnotationVisibleToViewer("meal", ["glucose"])).toBe(true);
  });

  it("meal visible when viewer has calories_consumed grant", () => {
    expect(isAnnotationVisibleToViewer("meal", ["calories_consumed"])).toBe(
      true,
    );
  });

  it("meal visible when viewer has any nutrition metric grant", () => {
    // All nutrition-category metrics should make meal annotations visible
    const nutritionMetrics = [
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
      "sugar_g",
      "saturated_fat_g",
      "sodium_mg",
      "potassium_mg",
      "calcium_mg",
      "iron_mg",
      "magnesium_mg",
      "zinc_mg",
      "vitamin_a_mcg",
      "vitamin_c_mg",
      "vitamin_d_mcg",
      "vitamin_b12_mcg",
      "folate_mcg",
    ];

    for (const metric of nutritionMetrics) {
      expect(isAnnotationVisibleToViewer("meal", [metric])).toBe(true);
    }
  });

  it("meal NOT visible when viewer only has rhr grant", () => {
    expect(isAnnotationVisibleToViewer("meal", ["rhr"])).toBe(false);
  });

  // --- workout → activity/cardiovascular metrics ---

  it("workout visible when viewer has active_calories grant", () => {
    expect(isAnnotationVisibleToViewer("workout", ["active_calories"])).toBe(
      true,
    );
  });

  it("workout visible when viewer has heart_rate grant", () => {
    expect(isAnnotationVisibleToViewer("workout", ["heart_rate"])).toBe(true);
  });

  it("workout NOT visible when viewer only has sleep_score grant", () => {
    expect(isAnnotationVisibleToViewer("workout", ["sleep_score"])).toBe(false);
  });

  // --- travel → sleep/recovery metrics ---

  it("travel visible when viewer has sleep_score grant", () => {
    expect(isAnnotationVisibleToViewer("travel", ["sleep_score"])).toBe(true);
  });

  it("travel visible when viewer has readiness_score grant", () => {
    expect(isAnnotationVisibleToViewer("travel", ["readiness_score"])).toBe(
      true,
    );
  });

  it("travel NOT visible when viewer only has glucose grant", () => {
    expect(isAnnotationVisibleToViewer("travel", ["glucose"])).toBe(false);
  });

  // --- alcohol → sleep/cardiovascular metrics ---

  it("alcohol visible when viewer has hrv grant", () => {
    expect(isAnnotationVisibleToViewer("alcohol", ["hrv"])).toBe(true);
  });

  it("alcohol visible when viewer has deep_sleep grant", () => {
    expect(isAnnotationVisibleToViewer("alcohol", ["deep_sleep"])).toBe(true);
  });

  it("alcohol NOT visible when viewer only has glucose grant", () => {
    expect(isAnnotationVisibleToViewer("alcohol", ["glucose"])).toBe(false);
  });

  // --- medication/supplement/custom → any metric ---

  it("medication visible with any granted metric", () => {
    expect(isAnnotationVisibleToViewer("medication", ["glucose"])).toBe(true);
    expect(isAnnotationVisibleToViewer("medication", ["rhr"])).toBe(true);
  });

  it("supplement visible with any granted metric", () => {
    expect(isAnnotationVisibleToViewer("supplement", ["hrv"])).toBe(true);
  });

  it("custom visible with any granted metric", () => {
    expect(isAnnotationVisibleToViewer("custom", ["sleep_score"])).toBe(true);
  });

  it("medication NOT visible with empty metrics array", () => {
    expect(isAnnotationVisibleToViewer("medication", [])).toBe(false);
  });

  // --- Unknown event type ---

  it("unknown event type not visible to any viewer", () => {
    expect(isAnnotationVisibleToViewer("unknown_type", ["glucose"])).toBe(
      false,
    );
  });
});
