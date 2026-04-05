// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateNavigation } from "../DateNavigation";

describe("DateNavigation", () => {
  const defaultProps = {
    date: "2026-03-28",
    onDateChange: vi.fn(),
    viewMode: "night" as const,
    onViewModeChange: vi.fn(),
  };

  it("renders date label, arrows, and view toggle", () => {
    render(<DateNavigation {...defaultProps} />);
    expect(screen.getByTestId("date-navigation")).toBeInTheDocument();
    expect(screen.getByTestId("date-nav-prev")).toBeInTheDocument();
    expect(screen.getByTestId("date-nav-next")).toBeInTheDocument();
    expect(screen.getByTestId("date-nav-picker")).toBeInTheDocument();
    expect(screen.getByTestId("view-mode-toggle")).toBeInTheDocument();
  });

  it("shows formatted date in the picker button", () => {
    render(<DateNavigation {...defaultProps} />);
    expect(screen.getByTestId("date-nav-picker")).toHaveTextContent("Mar 28");
  });

  it("calls onDateChange with previous day when prev arrow clicked", () => {
    const onDateChange = vi.fn();
    render(<DateNavigation {...defaultProps} onDateChange={onDateChange} />);
    fireEvent.click(screen.getByTestId("date-nav-prev"));
    expect(onDateChange).toHaveBeenCalledWith("2026-03-27");
  });

  it("calls onDateChange with next day when next arrow clicked", () => {
    const onDateChange = vi.fn();
    render(
      <DateNavigation
        {...defaultProps}
        date="2026-03-26"
        onDateChange={onDateChange}
      />,
    );
    fireEvent.click(screen.getByTestId("date-nav-next"));
    expect(onDateChange).toHaveBeenCalledWith("2026-03-27");
  });

  it("disables forward arrow at today", () => {
    const today = new Date().toISOString().split("T")[0];
    render(<DateNavigation {...defaultProps} date={today} />);
    expect(screen.getByTestId("date-nav-next")).toBeDisabled();
  });

  it("disables back arrow at minDate", () => {
    render(
      <DateNavigation
        {...defaultProps}
        date="2026-01-01"
        minDate="2026-01-01"
      />,
    );
    expect(screen.getByTestId("date-nav-prev")).toBeDisabled();
  });

  it("renders view mode buttons for night, recovery, trend", () => {
    render(<DateNavigation {...defaultProps} />);
    expect(screen.getByTestId("view-mode-night")).toBeInTheDocument();
    expect(screen.getByTestId("view-mode-recovery")).toBeInTheDocument();
    expect(screen.getByTestId("view-mode-trend")).toBeInTheDocument();
  });

  it("highlights active view mode", () => {
    render(<DateNavigation {...defaultProps} viewMode="night" />);
    const nightBtn = screen.getByTestId("view-mode-night");
    expect(nightBtn).toHaveAttribute("aria-selected", "true");
  });

  it("calls onViewModeChange when a different view is selected", () => {
    const onViewModeChange = vi.fn();
    render(
      <DateNavigation {...defaultProps} onViewModeChange={onViewModeChange} />,
    );
    fireEvent.click(screen.getByTestId("view-mode-recovery"));
    expect(onViewModeChange).toHaveBeenCalledWith("recovery");
  });

  it("shows 'Today' for today's date", () => {
    const today = new Date().toISOString().split("T")[0];
    render(<DateNavigation {...defaultProps} date={today} />);
    expect(screen.getByTestId("date-nav-picker")).toHaveTextContent("Today");
  });
});
