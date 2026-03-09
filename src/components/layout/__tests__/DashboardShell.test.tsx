// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardShell } from "../DashboardShell";
import { ViewContextProvider } from "@/lib/view-context";
import type { ViewContextValue } from "@/types/view-context";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: "light" }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

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
  ownerDisplayName: "Dr. Smith",
};

describe("DashboardShell", () => {
  it("renders sidebar navigation links for owner", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <DashboardShell displayName="Test User">
          <div>Page Content</div>
        </DashboardShell>
      </ViewContextProvider>,
    );

    // Check that the sidebar renders nav items (desktop sidebar)
    const dashboardLinks = screen.getAllByText("Dashboard");
    expect(dashboardLinks.length).toBeGreaterThan(0);

    const sharesLinks = screen.getAllByText("Shared Links");
    expect(sharesLinks.length).toBeGreaterThan(0);

    const auditLinks = screen.getAllByText("Activity Log");
    expect(auditLinks.length).toBeGreaterThan(0);

    const settingsLinks = screen.getAllByText("Settings");
    expect(settingsLinks.length).toBeGreaterThan(0);
  });

  it("renders children content", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <DashboardShell displayName="Test User">
          <div>Page Content</div>
        </DashboardShell>
      </ViewContextProvider>,
    );

    expect(screen.getByText("Page Content")).toBeDefined();
  });

  it("hides sidebar for viewer role", () => {
    render(
      <ViewContextProvider value={viewerContext}>
        <DashboardShell>
          <div>Viewer Content</div>
        </DashboardShell>
      </ViewContextProvider>,
    );

    // Viewer should see 'Shared by Dr. Smith' in header
    const sharedByEl = screen.getByText(/Shared by/);
    expect(sharedByEl).toBeDefined();
    expect(sharedByEl.textContent).toContain("Dr. Smith");

    // The sidebar nav items should not be visible
    expect(screen.queryByText("Activity Log")).toBeNull();

    // Viewer content should render
    expect(screen.getByText("Viewer Content")).toBeDefined();
  });

  it("shows owner display name in header for owner", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <DashboardShell displayName="Test User">
          <div>Content</div>
        </DashboardShell>
      </ViewContextProvider>,
    );

    expect(screen.getByText("Test User")).toBeDefined();
  });

  it("shows page title in header for owner", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <DashboardShell displayName="Test User">
          <div>Content</div>
        </DashboardShell>
      </ViewContextProvider>,
    );

    // The header should show the page title based on pathname (/dashboard)
    // "Dashboard" appears in both sidebar link and header title
    const heading = screen.getByRole("heading", { name: "Dashboard" });
    expect(heading).toBeDefined();
  });

  it("has a mobile navigation trigger for owner", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <DashboardShell displayName="Test User">
          <div>Content</div>
        </DashboardShell>
      </ViewContextProvider>,
    );

    // Mobile nav button should exist (hidden on large screens via CSS)
    const menuButton = screen.getByLabelText("Open navigation menu");
    expect(menuButton).toBeDefined();
  });

  it("does not show mobile navigation trigger for viewer", () => {
    render(
      <ViewContextProvider value={viewerContext}>
        <DashboardShell>
          <div>Content</div>
        </DashboardShell>
      </ViewContextProvider>,
    );

    expect(screen.queryByLabelText("Open navigation menu")).toBeNull();
  });
});
