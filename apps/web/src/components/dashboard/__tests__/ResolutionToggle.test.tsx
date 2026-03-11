// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResolutionToggle } from "../ResolutionToggle";

describe("ResolutionToggle", () => {
  it("renders three resolution options", () => {
    render(<ResolutionToggle value="daily" onChange={() => {}} />);

    expect(screen.getByText("Daily")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("Monthly")).toBeInTheDocument();
  });

  it("calls onChange when a different resolution is selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ResolutionToggle value="daily" onChange={onChange} />);

    await user.click(screen.getByText("Weekly"));
    expect(onChange).toHaveBeenCalledWith("weekly");
  });

  it("highlights the currently active resolution", () => {
    const { rerender } = render(
      <ResolutionToggle value="weekly" onChange={() => {}} />,
    );

    const weeklyTab = screen.getByText("Weekly").closest("[role='tab']");
    expect(weeklyTab).toHaveAttribute("data-state", "active");

    rerender(<ResolutionToggle value="monthly" onChange={() => {}} />);
    const monthlyTab = screen.getByText("Monthly").closest("[role='tab']");
    expect(monthlyTab).toHaveAttribute("data-state", "active");
  });
});
