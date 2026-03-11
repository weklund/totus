import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is required. " +
      "Set it in .env.local for local development.",
  );
}

/**
 * PostgreSQL connection pool.
 * Shared across the application for efficient connection management.
 */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/**
 * Drizzle ORM database instance.
 * Use this for all database queries.
 */
export const db = drizzle(pool);

/**
 * Graceful shutdown hook to close the connection pool.
 * Prevents connection leaks during Next.js HMR in development.
 */
if (process.env.NODE_ENV !== "production") {
  let isShuttingDown = false;

  const cleanup = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try {
      await pool.end();
    } catch {
      // Pool may already be ended (e.g., in tests)
    }
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
