// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock next/navigation (needed for Link)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import GlobalError from "../error";

describe("GlobalError page", () => {
  it("renders 'Something went wrong' heading", () => {
    const error = new Error("Test error");
    const reset = vi.fn();

    render(<GlobalError error={error} reset={reset} />);

    expect(screen.getByText("Something went wrong")).toBeDefined();
  });

  it("renders description text", () => {
    const error = new Error("Test error");
    const reset = vi.fn();

    render(<GlobalError error={error} reset={reset} />);

    expect(
      screen.getByText("An unexpected error occurred. Please try again."),
    ).toBeDefined();
  });

  it("renders retry button that calls reset", () => {
    const error = new Error("Test error");
    const reset = vi.fn();

    render(<GlobalError error={error} reset={reset} />);

    const retryButton = screen.getByRole("button", { name: "Try Again" });
    expect(retryButton).toBeDefined();

    fireEvent.click(retryButton);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("renders a link back to home", () => {
    const error = new Error("Test error");
    const reset = vi.fn();

    render(<GlobalError error={error} reset={reset} />);

    const homeLink = screen.getByRole("link", { name: "Go Home" });
    expect(homeLink).toBeDefined();
    expect(homeLink.getAttribute("href")).toBe("/");
  });
});
