/**
 * Cursor-based pagination utilities.
 *
 * Implements the cursor pagination pattern described in the API Database LLD.
 * Cursor is a base64url-encoded JSON object: { c: isoTimestamp, i: id }
 *
 * See: /docs/api-database-lld.md Section 7.1
 */

/**
 * Decoded cursor containing the pagination position.
 */
export interface DecodedCursor {
  /** ISO timestamp of the last item's created_at */
  createdAt: string;
  /** ID of the last item */
  id: string;
}

/**
 * Pagination metadata returned in API responses.
 */
export interface PaginationMeta {
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Result of a paginated query.
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

/**
 * Encode a cursor from created_at timestamp and id.
 *
 * @param createdAt - ISO timestamp string (e.g., from created_at column)
 * @param id - The item's ID (string or number, coerced to string)
 * @returns Base64url-encoded cursor string
 */
export function encodeCursor(createdAt: string, id: string | number): string {
  const payload = JSON.stringify({
    c: createdAt,
    i: String(id),
  });

  return base64UrlEncode(payload);
}

/**
 * Decode a cursor string back to its components.
 *
 * @param cursor - Base64url-encoded cursor string
 * @returns The decoded cursor, or null if the cursor is invalid
 */
export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const json = base64UrlDecode(cursor);
    const parsed = JSON.parse(json);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.c !== "string" ||
      typeof parsed.i !== "string"
    ) {
      return null;
    }

    return {
      createdAt: parsed.c,
      id: parsed.i,
    };
  } catch {
    return null;
  }
}

/**
 * Apply pagination to an already-fetched array of results.
 *
 * This is a utility for building paginated responses from query results.
 * The caller should query limit+1 rows to determine has_more.
 *
 * @param items - The query results (should be limit+1 items if there are more)
 * @param limit - The requested page size
 * @param getCreatedAt - Function to extract created_at from an item
 * @param getId - Function to extract id from an item
 * @returns PaginatedResult with data (trimmed to limit) and pagination metadata
 */
export function paginateResults<T>(
  items: T[],
  limit: number,
  getCreatedAt: (item: T) => string,
  getId: (item: T) => string | number,
): PaginatedResult<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const lastItem = data[data.length - 1];
    nextCursor = encodeCursor(getCreatedAt(lastItem), getId(lastItem));
  }

  return {
    data,
    pagination: {
      next_cursor: nextCursor,
      has_more: hasMore,
    },
  };
}

// ─── Base64url helpers ──────────────────────────────────────────────────────

/**
 * Encode a string to base64url (no padding).
 */
function base64UrlEncode(input: string): string {
  const base64 = Buffer.from(input, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a base64url string.
 */
function base64UrlDecode(input: string): string {
  // Restore standard base64 characters
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  const padding = base64.length % 4;
  if (padding === 2) {
    base64 += "==";
  } else if (padding === 3) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf-8");
}
