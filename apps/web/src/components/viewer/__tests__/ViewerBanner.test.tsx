// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewerBanner } from "../ViewerBanner";
import { ViewContextProvider } from "@/lib/view-context";
import type { ViewContextValue } from "@/types/view-context";

const baseViewerContext: ViewContextValue = {
  role: "viewer",
  grantId: "grant_abc",
  permissions: {
    metrics: ["sleep_score", "hrv", "rhr"],
    dataStart: "2026-01-01",
    dataEnd: "2026-03-01",
  },
  ownerDisplayName: "Dr. Smith",
};

describe("ViewerBanner", () => {
  it("renders the informational banner", () => {
    render(
      <ViewContextProvider value={baseViewerContext}>
        <ViewerBanner />
      </ViewContextProvider>,
    );

    expect(screen.getByTestId("viewer-banner")).toBeDefined();
  });

  it("shows metric labels from granted metrics", () => {
    render(
      <ViewContextProvider value={baseViewerContext}>
        <ViewerBanner />
      </ViewContextProvider>,
    );

    const bannerText = screen.getByTestId("viewer-banner").textContent ?? "";
    expect(bannerText).toContain("Sleep Score");
    expect(bannerText).toContain("Heart Rate Variability");
    expect(bannerText).toContain("Resting Heart Rate");
  });

  it("shows formatted date range", () => {
    render(
      <ViewContextProvider value={baseViewerContext}>
        <ViewerBanner />
      </ViewContextProvider>,
    );

    const bannerText = screen.getByTestId("viewer-banner").textContent ?? "";
    expect(bannerText).toContain("Jan 1, 2026");
    expect(bannerText).toContain("Mar 1, 2026");
  });

  it("shows 'You are viewing shared health data' message", () => {
    render(
      <ViewContextProvider value={baseViewerContext}>
        <ViewerBanner />
      </ViewContextProvider>,
    );

    const bannerText = screen.getByTestId("viewer-banner").textContent ?? "";
    expect(bannerText).toContain("You are viewing shared health data");
  });

  it("handles 'all' metrics gracefully", () => {
    const ctx: ViewContextValue = {
      ...baseViewerContext,
      permissions: {
        metrics: "all",
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      },
    };

    render(
      <ViewContextProvider value={ctx}>
        <ViewerBanner />
      </ViewContextProvider>,
    );

    const bannerText = screen.getByTestId("viewer-banner").textContent ?? "";
    expect(bannerText).toContain("all metrics");
  });
});
