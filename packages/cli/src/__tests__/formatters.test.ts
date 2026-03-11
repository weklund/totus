import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveOutputFormat,
  formatTable,
  formatJson,
  formatCsv,
  outputData,
} from "../formatters.js";

describe("formatters", () => {
  describe("resolveOutputFormat", () => {
    const originalIsTTY = process.stdout.isTTY;

    afterEach(() => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        writable: true,
      });
    });

    it("returns explicit format when provided", () => {
      expect(resolveOutputFormat("json")).toBe("json");
      expect(resolveOutputFormat("table")).toBe("table");
      expect(resolveOutputFormat("csv")).toBe("csv");
    });

    it("handles case-insensitive format", () => {
      expect(resolveOutputFormat("JSON")).toBe("json");
      expect(resolveOutputFormat("Table")).toBe("table");
      expect(resolveOutputFormat("CSV")).toBe("csv");
    });

    it("returns table when TTY and no explicit format", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
      });
      expect(resolveOutputFormat()).toBe("table");
    });

    it("returns json when not TTY and no explicit format", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: undefined,
        writable: true,
      });
      expect(resolveOutputFormat()).toBe("json");
    });
  });

  describe("formatTable", () => {
    const columns = [
      { header: "Name", key: "name" },
      { header: "Status", key: "status" },
    ];

    it("formats rows as a table", () => {
      const rows = [
        { name: "Alice", status: "active" },
        { name: "Bob", status: "inactive" },
      ];

      const result = formatTable(columns, rows);
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
      expect(result).toContain("active");
      expect(result).toContain("inactive");
    });

    it("returns no data message for empty rows", () => {
      const result = formatTable(columns, []);
      expect(result).toBe("No data found.");
    });

    it("handles undefined values", () => {
      const rows = [{ name: "Alice" }];
      const result = formatTable(columns, rows);
      expect(result).toContain("Alice");
    });
  });

  describe("formatJson", () => {
    it("formats data as pretty JSON", () => {
      const data = { key: "value", nested: { a: 1 } };
      const result = formatJson(data);
      expect(JSON.parse(result)).toEqual(data);
      expect(result).toContain("\n"); // Pretty-printed
    });

    it("handles arrays", () => {
      const data = [{ a: 1 }, { b: 2 }];
      const result = formatJson(data);
      expect(JSON.parse(result)).toEqual(data);
    });

    it("handles null", () => {
      expect(formatJson(null)).toBe("null");
    });
  });

  describe("formatCsv", () => {
    const columns = [
      { header: "Name", key: "name" },
      { header: "Status", key: "status" },
    ];

    it("formats rows as CSV with headers", () => {
      const rows = [
        { name: "Alice", status: "active" },
        { name: "Bob", status: "inactive" },
      ];

      const result = formatCsv(columns, rows);
      const lines = result.trim().split("\n");
      expect(lines[0]).toBe("Name,Status");
      expect(lines[1]).toBe("Alice,active");
      expect(lines[2]).toBe("Bob,inactive");
    });

    it("handles values with commas", () => {
      const rows = [{ name: "Doe, Jane", status: "active" }];
      const result = formatCsv(columns, rows);
      expect(result).toContain('"Doe, Jane"');
    });

    it("formats empty rows with just headers", () => {
      const result = formatCsv(columns, []);
      const lines = result.trim().split("\n");
      expect(lines[0]).toBe("Name,Status");
      expect(lines.length).toBe(1);
    });
  });

  describe("outputData", () => {
    const columns = [
      { header: "Name", key: "name" },
      { header: "Status", key: "status" },
    ];
    const rows = [{ name: "Alice", status: "active" }];

    it("outputs table format", () => {
      const result = outputData("table", { columns, rows });
      expect(result).toContain("Alice");
      expect(result).toContain("active");
    });

    it("outputs json format", () => {
      const result = outputData("json", { columns, rows });
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(rows);
    });

    it("outputs json format with custom jsonData", () => {
      const jsonData = { metrics: rows };
      const result = outputData("json", { columns, rows, jsonData });
      expect(JSON.parse(result)).toEqual(jsonData);
    });

    it("outputs csv format", () => {
      const result = outputData("csv", { columns, rows });
      expect(result).toContain("Name,Status");
      expect(result).toContain("Alice,active");
    });
  });
});
