import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, paginateResults } from "../pagination";

// ─── encodeCursor / decodeCursor ────────────────────────────────────────────

describe("encodeCursor", () => {
  it("encodes a cursor from timestamp and string id", () => {
    const cursor = encodeCursor("2026-03-08T14:23:01.000Z", "abc123");
    expect(typeof cursor).toBe("string");
    expect(cursor.length).toBeGreaterThan(0);
  });

  it("encodes a cursor from timestamp and numeric id", () => {
    const cursor = encodeCursor("2026-03-08T14:23:01.000Z", 1234);
    expect(typeof cursor).toBe("string");
  });

  it("produces base64url characters only (no +, /, or =)", () => {
    const cursor = encodeCursor("2026-03-08T14:23:01.000Z", "test-id-123");
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("produces different cursors for different inputs", () => {
    const cursor1 = encodeCursor("2026-03-08T14:23:01.000Z", "id1");
    const cursor2 = encodeCursor("2026-03-08T14:23:01.000Z", "id2");
    const cursor3 = encodeCursor("2026-03-09T00:00:00.000Z", "id1");

    expect(cursor1).not.toBe(cursor2);
    expect(cursor1).not.toBe(cursor3);
  });
});

describe("decodeCursor", () => {
  it("decodes a valid cursor back to original values", () => {
    const encoded = encodeCursor("2026-03-08T14:23:01.000Z", "abc123");
    const decoded = decodeCursor(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt).toBe("2026-03-08T14:23:01.000Z");
    expect(decoded!.id).toBe("abc123");
  });

  it("decodes a cursor with numeric id (coerced to string)", () => {
    const encoded = encodeCursor("2026-03-08T14:23:01.000Z", 1234);
    const decoded = decodeCursor(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe("1234");
  });

  it("returns null for invalid base64", () => {
    const decoded = decodeCursor("not-valid-base64!!!");
    expect(decoded).toBeNull();
  });

  it("returns null for valid base64 but invalid JSON", () => {
    // Base64url encode a non-JSON string
    const encoded = Buffer.from("not json").toString("base64");
    const decoded = decodeCursor(encoded);
    expect(decoded).toBeNull();
  });

  it("returns null for valid JSON but missing required fields", () => {
    const encoded = Buffer.from(JSON.stringify({ x: 1 })).toString("base64");
    const decoded = decodeCursor(encoded);
    expect(decoded).toBeNull();
  });

  it("returns null for JSON with wrong field types", () => {
    const encoded = Buffer.from(
      JSON.stringify({ c: 12345, i: "abc" }),
    ).toString("base64");
    const decoded = decodeCursor(encoded);
    expect(decoded).toBeNull();
  });

  it("returns null for empty string", () => {
    const decoded = decodeCursor("");
    expect(decoded).toBeNull();
  });

  it("round-trips correctly for various timestamps and ids", () => {
    const cases: [string, string | number][] = [
      ["2026-01-01T00:00:00.000Z", "uuid-abc-123"],
      ["2025-12-31T23:59:59.999Z", "12345"],
      ["2020-06-15T08:30:00.000Z", 99999],
      ["2026-03-08T14:23:01.000Z", "a"],
    ];

    for (const [createdAt, id] of cases) {
      const encoded = encodeCursor(createdAt, id);
      const decoded = decodeCursor(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.createdAt).toBe(createdAt);
      expect(decoded!.id).toBe(String(id));
    }
  });
});

// ─── paginateResults ────────────────────────────────────────────────────────

interface TestItem {
  id: string;
  name: string;
  created_at: string;
}

const makeItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `item-${i + 1}`,
    name: `Item ${i + 1}`,
    created_at: new Date(2026, 2, 8, 14, 0, i).toISOString(),
  }));

describe("paginateResults", () => {
  it("returns has_more=false when items <= limit", () => {
    const items = makeItems(5);
    const result = paginateResults(
      items,
      10,
      (item) => item.created_at,
      (item) => item.id,
    );

    expect(result.data).toHaveLength(5);
    expect(result.pagination.has_more).toBe(false);
    expect(result.pagination.next_cursor).toBeNull();
  });

  it("returns has_more=true when items > limit", () => {
    // Simulate fetching limit+1 items
    const items = makeItems(11); // limit=10, fetched 11
    const result = paginateResults(
      items,
      10,
      (item) => item.created_at,
      (item) => item.id,
    );

    expect(result.data).toHaveLength(10);
    expect(result.pagination.has_more).toBe(true);
    expect(result.pagination.next_cursor).not.toBeNull();
  });

  it("trims data to limit when has_more", () => {
    const items = makeItems(6); // limit=5
    const result = paginateResults(
      items,
      5,
      (item) => item.created_at,
      (item) => item.id,
    );

    expect(result.data).toHaveLength(5);
    expect(result.data[4].id).toBe("item-5");
  });

  it("next_cursor decodes to last item in page", () => {
    const items = makeItems(6);
    const result = paginateResults(
      items,
      5,
      (item) => item.created_at,
      (item) => item.id,
    );

    const decoded = decodeCursor(result.pagination.next_cursor!);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe("item-5");
    expect(decoded!.createdAt).toBe(items[4].created_at);
  });

  it("handles empty array", () => {
    const result = paginateResults(
      [],
      10,
      (item: TestItem) => item.created_at,
      (item: TestItem) => item.id,
    );

    expect(result.data).toHaveLength(0);
    expect(result.pagination.has_more).toBe(false);
    expect(result.pagination.next_cursor).toBeNull();
  });

  it("handles exactly limit items (no extra)", () => {
    const items = makeItems(10);
    const result = paginateResults(
      items,
      10,
      (item) => item.created_at,
      (item) => item.id,
    );

    expect(result.data).toHaveLength(10);
    expect(result.pagination.has_more).toBe(false);
    expect(result.pagination.next_cursor).toBeNull();
  });

  it("handles limit=1 with more items", () => {
    const items = makeItems(2);
    const result = paginateResults(
      items,
      1,
      (item) => item.created_at,
      (item) => item.id,
    );

    expect(result.data).toHaveLength(1);
    expect(result.pagination.has_more).toBe(true);
    expect(result.pagination.next_cursor).not.toBeNull();
  });

  it("works with numeric IDs", () => {
    const items = [
      { id: 1, created_at: "2026-03-08T14:00:00.000Z" },
      { id: 2, created_at: "2026-03-08T14:00:01.000Z" },
      { id: 3, created_at: "2026-03-08T14:00:02.000Z" },
    ];

    const result = paginateResults(
      items,
      2,
      (item) => item.created_at,
      (item) => item.id,
    );

    expect(result.data).toHaveLength(2);
    expect(result.pagination.has_more).toBe(true);

    const decoded = decodeCursor(result.pagination.next_cursor!);
    expect(decoded!.id).toBe("2");
  });
});
