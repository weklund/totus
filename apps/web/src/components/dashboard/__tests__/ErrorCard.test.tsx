// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorCard } from "../ErrorCard";

describe("ErrorCard", () => {
  it("renders error message", () => {
    render(<ErrorCard message="Network timeout occurred" />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Network timeout occurred")).toBeInTheDocument();
    expect(screen.getByTestId("error-card")).toBeInTheDocument();
  });

  it("renders custom title", () => {
    render(<ErrorCard title="Data Load Failed" message="API error" />);

    expect(screen.getByText("Data Load Failed")).toBeInTheDocument();
    expect(screen.getByText("API error")).toBeInTheDocument();
  });

  it("shows retry button when onRetry is provided", () => {
    const onRetry = vi.fn();
    render(<ErrorCard message="Error" onRetry={onRetry} />);

    const retryButton = screen.getByTestId("retry-button");
    expect(retryButton).toBeInTheDocument();

    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides retry button when onRetry is not provided", () => {
    render(<ErrorCard message="Error" />);

    expect(screen.queryByTestId("retry-button")).not.toBeInTheDocument();
  });
});
