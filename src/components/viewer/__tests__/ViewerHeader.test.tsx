// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewerHeader } from "../ViewerHeader";
import { ViewContextProvider } from "@/lib/view-context";
import type { ViewContextValue } from "@/types/view-context";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const baseViewerContext: ViewContextValue = {
  role: "viewer",
  grantId: "grant_abc",
  permissions: {
    metrics: ["sleep_score", "hrv"],
    dataStart: "2026-01-01",
    dataEnd: "2026-03-01",
  },
  ownerDisplayName: "Dr. Smith",
};

describe("ViewerHeader", () => {
  it("renders Totus logo", () => {
    render(
      <ViewContextProvider value={baseViewerContext}>
        <ViewerHeader />
      </ViewContextProvider>,
    );

    const logo = screen.getByText("Totus");
    expect(logo).toBeDefined();
    expect(logo.closest("a")).toHaveAttribute("href", "/");
  });

  it("shows 'Shared by [owner_display_name]'", () => {
    render(
      <ViewContextProvider value={baseViewerContext}>
        <ViewerHeader />
      </ViewContextProvider>,
    );

    expect(screen.getByText(/Shared by Dr\. Smith/)).toBeDefined();
  });

  it("shows 'Shared by Unknown' when no display name", () => {
    const ctx: ViewContextValue = {
      ...baseViewerContext,
      ownerDisplayName: undefined,
    };

    render(
      <ViewContextProvider value={ctx}>
        <ViewerHeader />
      </ViewContextProvider>,
    );

    expect(screen.getByText(/Shared by Unknown/)).toBeDefined();
  });

  it("shows optional note when present", () => {
    const ctx: ViewContextValue = {
      ...baseViewerContext,
      note: "For your review, doctor",
    };

    render(
      <ViewContextProvider value={ctx}>
        <ViewerHeader />
      </ViewContextProvider>,
    );

    expect(screen.getByText("For your review, doctor")).toBeDefined();
  });

  it("does not show note when absent", () => {
    render(
      <ViewContextProvider value={baseViewerContext}>
        <ViewerHeader />
      </ViewContextProvider>,
    );

    // No italic note text should be present
    const header = screen.getByTestId("viewer-header");
    const noteElements = header.querySelectorAll(".italic");
    expect(noteElements.length).toBe(0);
  });

  it("has viewer-header test id", () => {
    render(
      <ViewContextProvider value={baseViewerContext}>
        <ViewerHeader />
      </ViewContextProvider>,
    );

    expect(screen.getByTestId("viewer-header")).toBeDefined();
  });
});
