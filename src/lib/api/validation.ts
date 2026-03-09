/**
 * Zod validation middleware for API request bodies.
 *
 * Provides validateRequest() which parses a body against a Zod schema
 * and returns the typed result or throws an ApiError with VALIDATION_ERROR.
 *
 * See: /docs/api-database-lld.md Section 7.1
 */

import type { z } from "zod";
import { ApiError } from "./errors";

/**
 * Validate a request body against a Zod schema.
 *
 * Returns the typed, parsed result on success.
 * Throws ApiError with code VALIDATION_ERROR (400) on failure.
 *
 * @param schema - The Zod schema to validate against
 * @param body - The raw request body (typically from request.json())
 * @returns The validated and typed result
 * @throws ApiError with code VALIDATION_ERROR if validation fails
 */
export function validateRequest<T extends z.ZodType>(
  schema: T,
  body: unknown,
): z.infer<T> {
  const result = schema.safeParse(body);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));

    throw new ApiError(
      "VALIDATION_ERROR",
      "Invalid request body",
      400,
      details,
    );
  }

  return result.data;
}
