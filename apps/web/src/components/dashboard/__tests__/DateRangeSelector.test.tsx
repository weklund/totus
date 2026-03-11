// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateRangeSelector } from "../DateRangeSelector";

describe("DateRangeSelector", () => {
  it("renders preset buttons when showPresets is true", () => {
    render(
      <DateRangeSelector
        value={{ start: "2026-01-01", end: "2026-03-01" }}
        onChange={() => {}}
        showPresets={true}
      />,
    );

    expect(screen.getByTestId("preset-1W")).toBeInTheDocument();
    expect(screen.getByTestId("preset-1M")).toBeInTheDocument();
    expect(screen.getByTestId("preset-3M")).toBeInTheDocument();
    expect(screen.getByTestId("preset-6M")).toBeInTheDocument();
    expect(screen.getByTestId("preset-1Y")).toBeInTheDocument();
    expect(screen.getByTestId("preset-5Y")).toBeInTheDocument();
    expect(screen.getByTestId("preset-All")).toBeInTheDocument();
  });

  it("hides preset buttons when showPresets is false", () => {
    render(
      <DateRangeSelector
        value={{ start: "2026-01-01", end: "2026-03-01" }}
        onChange={() => {}}
        showPresets={false}
      />,
    );

    expect(screen.queryByTestId("preset-1W")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preset-1M")).not.toBeInTheDocument();
  });

  it("calls onChange when a preset is clicked", () => {
    const onChange = vi.fn();
    render(
      <DateRangeSelector
        value={{ start: "2026-01-01", end: "2026-03-01" }}
        onChange={onChange}
        showPresets={true}
      />,
    );

    fireEvent.click(screen.getByTestId("preset-1M"));
    expect(onChange).toHaveBeenCalledTimes(1);

    const call = onChange.mock.calls[0]![0] as {
      start: string;
      end: string;
    };
    expect(call.start).toBeDefined();
    expect(call.end).toBeDefined();
    // The end date should be today
    expect(call.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("renders custom date picker button", () => {
    render(
      <DateRangeSelector
        value={{ start: "2026-01-01", end: "2026-03-01" }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId("custom-date-picker")).toBeInTheDocument();
    expect(screen.getByTestId("custom-date-picker")).toHaveTextContent(
      "Jan 1, 2026",
    );
  });

  it("uses earliestDataDate for All preset", () => {
    const onChange = vi.fn();
    render(
      <DateRangeSelector
        value={{ start: "2026-01-01", end: "2026-03-01" }}
        onChange={onChange}
        showPresets={true}
        earliestDataDate="2025-06-01"
      />,
    );

    fireEvent.click(screen.getByTestId("preset-All"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        start: "2025-06-01",
      }),
    );
  });
});
