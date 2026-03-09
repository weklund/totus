// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/navigation (needed for Link)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/nonexistent",
  useSearchParams: () => new URLSearchParams(),
}));

import NotFound from "../not-found";

describe("NotFound page", () => {
  it("renders 404 heading", () => {
    render(<NotFound />);

    expect(screen.getByText("404")).toBeDefined();
  });

  it("renders 'Page not found' message", () => {
    render(<NotFound />);

    expect(screen.getByText("Page not found")).toBeDefined();
  });

  it("renders a link back to home", () => {
    render(<NotFound />);

    const homeLink = screen.getByRole("link", { name: "Go Home" });
    expect(homeLink).toBeDefined();
    expect(homeLink.getAttribute("href")).toBe("/");
  });
});
