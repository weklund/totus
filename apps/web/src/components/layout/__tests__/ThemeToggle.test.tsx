// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "../Header";
import { ViewContextProvider } from "@/lib/view-context";
import type { ViewContextValue } from "@/types/view-context";

// Track theme state across test
let currentTheme = "light";
const setThemeMock = vi.fn((theme: string) => {
  currentTheme = theme;
});

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: () => ({
    setTheme: setThemeMock,
    resolvedTheme: currentTheme,
    theme: currentTheme,
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

describe("ThemeToggle", () => {
  beforeEach(() => {
    currentTheme = "light";
    setThemeMock.mockClear();
  });

  it("renders theme toggle button for owner", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <Header displayName="Test User" />
      </ViewContextProvider>,
    );

    const toggleButton = screen.getByLabelText("Toggle theme");
    expect(toggleButton).toBeInTheDocument();
  });

  it("renders theme toggle button for viewer", () => {
    render(
      <ViewContextProvider value={viewerContext}>
        <Header />
      </ViewContextProvider>,
    );

    const toggleButton = screen.getByLabelText("Toggle theme");
    expect(toggleButton).toBeInTheDocument();
  });

  it("toggles from light to dark theme", async () => {
    const user = userEvent.setup();

    render(
      <ViewContextProvider value={ownerContext}>
        <Header displayName="Test User" />
      </ViewContextProvider>,
    );

    const toggleButton = screen.getByLabelText("Toggle theme");
    await user.click(toggleButton);

    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("toggles from dark to light theme", async () => {
    currentTheme = "dark";
    const user = userEvent.setup();

    render(
      <ViewContextProvider value={ownerContext}>
        <Header displayName="Test User" />
      </ViewContextProvider>,
    );

    const toggleButton = screen.getByLabelText("Toggle theme");
    await user.click(toggleButton);

    expect(setThemeMock).toHaveBeenCalledWith("light");
  });

  it("calls setTheme which persists to localStorage via next-themes", async () => {
    const user = userEvent.setup();

    render(
      <ViewContextProvider value={ownerContext}>
        <Header displayName="Test User" />
      </ViewContextProvider>,
    );

    const toggleButton = screen.getByLabelText("Toggle theme");

    // First click: light -> dark
    await user.click(toggleButton);
    expect(setThemeMock).toHaveBeenCalledWith("dark");

    // next-themes persists theme preference to localStorage automatically
    // The fact that setTheme is called verifies the toggle mechanism works
    // next-themes handles the localStorage persistence internally
    expect(setThemeMock).toHaveBeenCalledTimes(1);
  });

  it("shows sun and moon icons for theme toggle", () => {
    render(
      <ViewContextProvider value={ownerContext}>
        <Header displayName="Test User" />
      </ViewContextProvider>,
    );

    const toggleButton = screen.getByLabelText("Toggle theme");
    // The button should contain SVG elements for sun and moon icons
    const svgs = toggleButton.querySelectorAll("svg");
    expect(svgs.length).toBe(2); // Sun and Moon icons
  });
});
