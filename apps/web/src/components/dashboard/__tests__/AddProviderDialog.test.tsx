// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddProviderDialog } from "../AddProviderDialog";
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

const MOCK_OURA_CONNECTION: Connection = {
  id: "conn-1",
  provider: "oura",
  status: "active",
  last_sync_at: new Date(Date.now() - 3600_000).toISOString(),
  sync_status: "idle",
  connected_at: "2026-01-15T10:00:00.000Z",
};

describe("AddProviderDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Add Source trigger button by default", () => {
    renderWithProviders(<AddProviderDialog connections={[]} />);

    expect(screen.getByTestId("add-provider-button")).toBeInTheDocument();
    expect(screen.getByText("Add Source")).toBeInTheDocument();
  });

  it("renders a custom trigger when provided", () => {
    renderWithProviders(
      <AddProviderDialog
        connections={[]}
        trigger={<button data-testid="custom-trigger">Custom</button>}
      />,
    );

    expect(screen.getByTestId("custom-trigger")).toBeInTheDocument();
  });

  it("shows provider grid when dialog opens", async () => {
    renderWithProviders(
      <AddProviderDialog
        connections={[]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByTestId("add-provider-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("provider-grid")).toBeInTheDocument();
    expect(screen.getByText("Connect a Data Source")).toBeInTheDocument();

    // Should show all 7 providers
    expect(screen.getByTestId("provider-option-oura")).toBeInTheDocument();
    expect(screen.getByTestId("provider-option-dexcom")).toBeInTheDocument();
    expect(screen.getByTestId("provider-option-garmin")).toBeInTheDocument();
    expect(screen.getByTestId("provider-option-whoop")).toBeInTheDocument();
    expect(screen.getByTestId("provider-option-withings")).toBeInTheDocument();
    expect(
      screen.getByTestId("provider-option-cronometer"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("provider-option-nutrisense"),
    ).toBeInTheDocument();
  });

  it("shows Connected badge on connected providers", () => {
    renderWithProviders(
      <AddProviderDialog
        connections={[MOCK_OURA_CONNECTION]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    expect(
      screen.getByTestId("provider-connected-badge-oura"),
    ).toBeInTheDocument();
  });

  it("shows Coming Soon badge on unimplemented providers", () => {
    renderWithProviders(
      <AddProviderDialog
        connections={[]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    // All non-oura providers should show Coming Soon
    expect(
      screen.getByTestId("provider-coming-soon-dexcom"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("provider-coming-soon-garmin"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("provider-coming-soon-whoop"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("provider-coming-soon-withings"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("provider-coming-soon-cronometer"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("provider-coming-soon-nutrisense"),
    ).toBeInTheDocument();
  });

  it("Coming Soon click does NOT start OAuth — shows info toast", async () => {
    const { api } = await import("@/lib/api-client");
    const { toast } = await import("sonner");
    const mockApi = vi.mocked(api);

    renderWithProviders(
      <AddProviderDialog
        connections={[]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("provider-option-dexcom"));

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        "Dexcom CGM integration is coming soon!",
      );
    });

    // Should NOT have called the authorize endpoint
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it("clicking an implemented, unconnected provider starts OAuth", async () => {
    const { api } = await import("@/lib/api-client");
    const mockApi = vi.mocked(api);
    mockApi.get.mockResolvedValue({
      data: { authorize_url: "https://cloud.ouraring.com/oauth/authorize?..." },
    });

    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    renderWithProviders(
      <AddProviderDialog
        connections={[]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("provider-option-oura"));

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith("/connections/oura/authorize");
    });

    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("connected provider button is disabled", () => {
    renderWithProviders(
      <AddProviderDialog
        connections={[MOCK_OURA_CONNECTION]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    const ouraButton = screen.getByTestId("provider-option-oura");
    expect(ouraButton).toBeDisabled();
  });

  it("shows error toast when OAuth start fails", async () => {
    const { api } = await import("@/lib/api-client");
    const { toast } = await import("sonner");
    const mockApi = vi.mocked(api);
    mockApi.get.mockRejectedValue(new Error("Network error"));

    renderWithProviders(
      <AddProviderDialog
        connections={[]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("provider-option-oura"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to start Oura Ring connection. Please try again.",
      );
    });
  });
});
