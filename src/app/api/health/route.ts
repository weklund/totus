/**
 * GET /api/health — Health check endpoint.
 *
 * Returns 200 { status: 'ok', database: 'connected' } when the database is reachable.
 * Returns 503 { status: 'error', database: 'disconnected' } when it is not.
 *
 * This is a public endpoint (no auth required).
 * See: /docs/api-database-lld.md
 */

import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  try {
    // Dynamic import to avoid module-level DATABASE_URL validation
    // in test environments where the DB module may not be available
    const { pool } = await import("@/db");

    // Simple connectivity check: execute a trivial query
    const result = await pool.query("SELECT 1");

    if (result.rowCount !== null && result.rowCount >= 0) {
      return NextResponse.json(
        {
          status: "ok",
          database: "connected",
        },
        { status: 200 },
      );
    }

    // Unexpected: query succeeded but rowCount is unexpected
    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
      },
      { status: 503 },
    );
  } catch (error) {
    console.error("Health check failed:", error);

    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
      },
      { status: 503 },
    );
  }
}
