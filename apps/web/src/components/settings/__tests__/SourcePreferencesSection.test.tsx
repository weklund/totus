// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SourcePreferencesSection } from "../SourcePreferencesSection";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock api client
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock useSourcePreferences
const mockUseSourcePreferences = vi.fn();
vi.mock("@/hooks/useSourcePreferences", () => ({
  useSourcePreferences: () => mockUseSourcePreferences(),
}));

// Mock useSetSourcePreference
const mockSetMutate = vi.fn();
vi.mock("@/hooks/useSetSourcePreference", () => ({
  useSetSourcePreference: () => ({
    mutate: mockSetMutate,
    isPending: false,
  }),
}));

// Mock useClearSourcePreference
const mockClearMutate = vi.fn();
vi.mock("@/hooks/useClearSourcePreference", () => ({
  useClearSourcePreference: () => ({
    mutate: mockClearMutate,
    isPending: false,
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("SourcePreferencesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeletons while fetching", () => {
    mockUseSourcePreferences.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<SourcePreferencesSection />);
    expect(
      screen.getByTestId("source-preferences-loading"),
    ).toBeInTheDocument();
  });

  it("shows error card when fetch fails", () => {
    mockUseSourcePreferences.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
      refetch: vi.fn(),
    });

    renderWithProviders(<SourcePreferencesSection />);
    expect(screen.getByText("Failed to load preferences")).toBeInTheDocument();
  });

  it("renders multi-source metrics with dropdowns", () => {
    mockUseSourcePreferences.mockReturnValue({
      data: { data: { preferences: [] } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<SourcePreferencesSection />);
    expect(
      screen.getByTestId("source-preferences-section"),
    ).toBeInTheDocument();
    expect(screen.getByText("Metric Source Preferences")).toBeInTheDocument();

    // Should show metrics that have multiple providers (e.g., HRV: oura, garmin, whoop)
    expect(screen.getByTestId("source-preference-hrv")).toBeInTheDocument();
    expect(
      screen.getByTestId("source-preference-sleep_score"),
    ).toBeInTheDocument();
  });

  it("shows current preference in dropdown", () => {
    mockUseSourcePreferences.mockReturnValue({
      data: {
        data: {
          preferences: [
            {
              metric_type: "hrv",
              provider: "oura",
              updated_at: "2026-03-10T00:00:00Z",
            },
          ],
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<SourcePreferencesSection />);

    // The HRV row should exist
    expect(screen.getByTestId("source-preference-hrv")).toBeInTheDocument();
  });

  it("renders description text", () => {
    mockUseSourcePreferences.mockReturnValue({
      data: { data: { preferences: [] } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<SourcePreferencesSection />);
    expect(
      screen.getByText(/Choose which provider is authoritative/),
    ).toBeInTheDocument();
  });
});
