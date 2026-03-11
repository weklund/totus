// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionsManager } from "../ConnectionsManager";
import type { Connection } from "@/hooks/useConnections";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock api client
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock useConnections hook
const mockUseConnections = vi.fn();
vi.mock("@/hooks/useConnections", () => ({
  useConnections: () => mockUseConnections(),
}));

// Mock source preference hooks (used by SourcePreferencesSection)
vi.mock("@/hooks/useSourcePreferences", () => ({
  useSourcePreferences: () => ({
    data: { data: { preferences: [] } },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSetSourcePreference", () => ({
  useSetSourcePreference: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/useClearSourcePreference", () => ({
  useClearSourcePreference: () => ({
    mutate: vi.fn(),
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

const MOCK_CONNECTIONS: Connection[] = [
  {
    id: "conn-1",
    provider: "oura",
    status: "active",
    last_sync_at: new Date().toISOString(),
    sync_status: "idle",
    connected_at: "2026-01-15T10:00:00.000Z",
  },
];

describe("ConnectionsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeletons while fetching", () => {
    mockUseConnections.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = renderWithProviders(<ConnectionsManager />);

    // Skeleton elements should exist
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows error card when fetch fails", () => {
    mockUseConnections.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
      refetch: vi.fn(),
    });

    renderWithProviders(<ConnectionsManager />);

    expect(screen.getByText("Failed to load connections")).toBeInTheDocument();
  });

  it("shows all providers — connected ones with ProviderConnectionCard", async () => {
    mockUseConnections.mockReturnValue({
      data: { data: MOCK_CONNECTIONS },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ConnectionsManager />);

    expect(screen.getByTestId("connections-manager")).toBeInTheDocument();
    // Should show the connected Oura card
    expect(
      screen.getByTestId("provider-card-oura-connected"),
    ).toBeInTheDocument();
    expect(screen.getByText("Oura Ring")).toBeInTheDocument();
  });

  it("shows Add Source button for connecting new providers", () => {
    mockUseConnections.mockReturnValue({
      data: { data: MOCK_CONNECTIONS },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ConnectionsManager />);

    expect(screen.getByTestId("add-provider-button")).toBeInTheDocument();
  });

  it("shows empty state with Add button when no connections", () => {
    mockUseConnections.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ConnectionsManager />);

    expect(screen.getByTestId("connections-manager")).toBeInTheDocument();
    expect(screen.getByTestId("add-provider-button")).toBeInTheDocument();
  });
});
