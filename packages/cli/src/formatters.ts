/**
 * Output formatters for the Totus CLI.
 * Supports table (TTY), json (pipe), and csv output formats.
 * Auto-detects TTY vs pipe.
 *
 * See: LLD Section 8.8
 */

import Table from "cli-table3";
import { stringify } from "csv-stringify/sync";

export type OutputFormat = "table" | "json" | "csv";

/**
 * Resolve the output format based on user preference and TTY detection.
 * Priority: explicit --output flag > TTY auto-detection
 */
export function resolveOutputFormat(explicit?: string): OutputFormat {
  if (explicit) {
    const fmt = explicit.toLowerCase();
    if (fmt === "table" || fmt === "json" || fmt === "csv") {
      return fmt;
    }
    // Invalid format, fall through to auto-detect
  }

  // Auto-detect: TTY → table, pipe → json
  return process.stdout.isTTY ? "table" : "json";
}

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
}

/**
 * Format data as a table for terminal output.
 */
export function formatTable(
  columns: TableColumn[],
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) {
    return "No data found.";
  }

  const table = new Table({
    head: columns.map((c) => c.header),
    style: { head: ["cyan"], border: ["dim"] },
    colWidths: columns.map((c) => c.width).filter(Boolean) as number[],
  });

  for (const row of rows) {
    table.push(columns.map((c) => String(row[c.key] ?? "")));
  }

  return table.toString();
}

/**
 * Format data as JSON.
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Format data as CSV.
 */
export function formatCsv(
  columns: TableColumn[],
  rows: Record<string, unknown>[],
): string {
  const headers = columns.map((c) => c.header);
  const records = rows.map((row) =>
    columns.map((c) => String(row[c.key] ?? "")),
  );

  return stringify([headers, ...records]);
}

/**
 * Output data in the specified format.
 */
export function outputData(
  format: OutputFormat,
  data: {
    columns: TableColumn[];
    rows: Record<string, unknown>[];
    jsonData?: unknown;
  },
): string {
  switch (format) {
    case "table":
      return formatTable(data.columns, data.rows);
    case "json":
      return formatJson(data.jsonData ?? data.rows);
    case "csv":
      return formatCsv(data.columns, data.rows);
  }
}
