// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewContextProvider } from "@/lib/view-context";
import type { ViewContextValue } from "@/types/view-context";
import { ActionBar } from "../ActionBar";

const ownerContext: ViewContextValue = {
  role: "owner",
  userId: "user_123",
  permissions: { metrics: "all", dataStart: null, dataEnd: null },
};

const viewerContext: ViewContextValue = {
  role: "viewer",
  grantId: "grant_abc",
  permissions: {
    metrics: ["sleep_score", "hrv"],
    dataStart: "2026-01-01",
    dataEnd: "2026-03-01",
  },
};

describe("ActionBar", () => {
  it("renders Share Data and Export buttons for owner", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <ActionBar />
      </ViewContextProvider>,
    );

    expect(screen.getByText("Share Data")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
    expect(screen.getByTestId("action-bar")).toBeInTheDocument();
  });

  it("renders nothing for viewer", () => {
    const { container } = render(
      <ViewContextProvider value={viewerContext}>
        <ActionBar />
      </ViewContextProvider>,
    );

    expect(container.innerHTML).toBe("");
  });

  it("Share Data links to /dashboard/share/new", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <ActionBar />
      </ViewContextProvider>,
    );

    const link = screen.getByText("Share Data").closest("a");
    expect(link).toHaveAttribute("href", "/dashboard/share/new");
  });
});
