/**
 * Standard API error handling utilities.
 *
 * Provides:
 * - ApiError class with code, message, statusCode, and optional details
 * - createErrorResponse() that formats the standard error envelope
 *
 * All API errors follow the format: { error: { code, message, details? } }
 * See: /docs/api-database-lld.md Section 7.1
 */

import { NextResponse } from "next/server";
import { PermissionError } from "@/lib/auth/permissions";

/**
 * Standard API error class.
 *
 * Use this to throw typed errors from route handlers and services.
 * createErrorResponse() knows how to format these into the standard envelope.
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown[];

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: unknown[],
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Standard error response envelope shape.
 */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

/**
 * Create a standard JSON error response from an error.
 *
 * - ApiError: uses its code, message, statusCode, and details
 * - Other errors: returns 500 INTERNAL_ERROR with a generic message
 *
 * @param error - The error to format
 * @returns A NextResponse with the standard error envelope
 */
export function createErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    const body: ErrorResponseBody = {
      error: {
        code: error.code,
        message: error.message,
      },
    };

    if (error.details && error.details.length > 0) {
      body.error.details = error.details;
    }

    return NextResponse.json(body, { status: error.statusCode });
  }

  // Handle PermissionError (from enforceScope, enforcePermissions)
  if (error instanceof PermissionError) {
    const body: ErrorResponseBody = {
      error: {
        code: error.code,
        message: error.message,
      },
    };

    return NextResponse.json(body, { status: error.statusCode });
  }

  // Unknown errors: log and return generic 500
  console.error("Unhandled error:", error);

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    } satisfies ErrorResponseBody,
    { status: 500 },
  );
}
