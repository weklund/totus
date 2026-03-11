import { customType } from "drizzle-orm/pg-core";

/**
 * Custom BYTEA column type for PostgreSQL.
 * Maps to Node.js Buffer for reading and accepts Buffer for writing.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer): Buffer {
    return value;
  },
  fromDriver(value: Buffer): Buffer {
    if (Buffer.isBuffer(value)) return value;
    // pg driver may return hex-encoded string in some configurations
    if (typeof value === "string") return Buffer.from(value, "hex");
    return Buffer.from(value as unknown as ArrayBuffer);
  },
});
