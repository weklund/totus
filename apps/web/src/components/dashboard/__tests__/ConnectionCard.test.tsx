// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionCard } from "../ConnectionCard";
import type { Connection } from "@/hooks/useConnections";

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

const MOCK_CONNECTION: Connection = {
  id: "conn-1",
  provider: "oura",
  status: "active",
  last_sync_at: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
  sync_status: "idle",
  connected_at: "2026-01-15T10:00:00.000Z",
};

describe("ConnectionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("disconnected state (no connection)", () => {
    it("renders connect button when no connection provided", () => {
      renderWithProviders(<ConnectionCard />);

      expect(
        screen.getByTestId("connection-card-disconnected"),
      ).toBeInTheDocument();
      expect(screen.getByText("Oura Ring")).toBeInTheDocument();
      expect(screen.getByText("Not connected")).toBeInTheDocument();
      expect(screen.getByTestId("connect-oura-button")).toBeInTheDocument();
      expect(screen.getByText("Connect Oura Ring")).toBeInTheDocument();
    });

    it("calls OAuth authorize endpoint when connect clicked", async () => {
      const { api } = await import("@/lib/api-client");
      const mockApi = vi.mocked(api);
      mockApi.get.mockResolvedValue({
        data: { authorize_url: "https://example.com/oauth" },
      });

      // Mock window.location
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        writable: true,
        value: { ...originalLocation, href: "" },
      });

      renderWithProviders(<ConnectionCard />);

      fireEvent.click(screen.getByTestId("connect-oura-button"));

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith("/connections/oura/authorize");
      });

      // Restore window.location
      Object.defineProperty(window, "location", {
        writable: true,
        value: originalLocation,
      });
    });

    it("shows error toast when connect fails", async () => {
      const { api } = await import("@/lib/api-client");
      const { toast } = await import("sonner");
      const mockApi = vi.mocked(api);
      mockApi.get.mockRejectedValue(new Error("Network error"));

      renderWithProviders(<ConnectionCard />);

      fireEvent.click(screen.getByTestId("connect-oura-button"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to start Oura connection. Please try again.",
        );
      });
    });
  });

  describe("connected state", () => {
    it("renders connection info when connected", () => {
      renderWithProviders(<ConnectionCard connection={MOCK_CONNECTION} />);

      expect(
        screen.getByTestId("connection-card-connected"),
      ).toBeInTheDocument();
      expect(screen.getByText("Oura Ring")).toBeInTheDocument();
      expect(screen.getByText("Connected")).toBeInTheDocument();
      expect(screen.getByText(/Last synced/)).toBeInTheDocument();
      expect(screen.getByTestId("sync-now-button")).toBeInTheDocument();
      expect(screen.getByTestId("disconnect-button")).toBeInTheDocument();
    });

    it("shows error badge when connection has error status", () => {
      const errorConnection: Connection = {
        ...MOCK_CONNECTION,
        status: "error",
      };
      renderWithProviders(<ConnectionCard connection={errorConnection} />);

      expect(screen.getByText("Error")).toBeInTheDocument();
    });

    it("shows expired badge when connection has expired status", () => {
      const expiredConnection: Connection = {
        ...MOCK_CONNECTION,
        status: "expired",
      };
      renderWithProviders(<ConnectionCard connection={expiredConnection} />);

      expect(screen.getByText("Token Expired")).toBeInTheDocument();
    });

    it("shows 'Never synced' when last_sync_at is null", () => {
      const noSyncConnection: Connection = {
        ...MOCK_CONNECTION,
        last_sync_at: null,
      };
      renderWithProviders(<ConnectionCard connection={noSyncConnection} />);

      expect(screen.getByText(/Never synced/)).toBeInTheDocument();
    });

    it("triggers sync when Sync Now clicked", async () => {
      const { api } = await import("@/lib/api-client");
      const { toast } = await import("sonner");
      const mockApi = vi.mocked(api);
      mockApi.post.mockResolvedValue({
        data: {
          sync_id: "sync-1",
          status: "completed",
          message: "Synced 56 data points",
          rows_synced: 56,
        },
      });

      renderWithProviders(<ConnectionCard connection={MOCK_CONNECTION} />);

      fireEvent.click(screen.getByTestId("sync-now-button"));

      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          `/connections/${MOCK_CONNECTION.id}/sync`,
          {},
        );
      });

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Synced 56 data points");
      });
    });

    it("shows error toast when sync fails", async () => {
      const { api } = await import("@/lib/api-client");
      const { toast } = await import("sonner");
      const mockApi = vi.mocked(api);
      mockApi.post.mockRejectedValue(new Error("Sync failed"));

      renderWithProviders(<ConnectionCard connection={MOCK_CONNECTION} />);

      fireEvent.click(screen.getByTestId("sync-now-button"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Sync failed. Please try again.",
        );
      });
    });

    it("shows disconnect confirmation dialog", async () => {
      renderWithProviders(<ConnectionCard connection={MOCK_CONNECTION} />);

      // Click disconnect button opens the dialog
      fireEvent.click(screen.getByTestId("disconnect-button"));

      await waitFor(() => {
        expect(screen.getByText("Disconnect Oura Ring?")).toBeInTheDocument();
        expect(
          screen.getByText(/This will remove the Oura connection/),
        ).toBeInTheDocument();
      });
    });

    it("calls disconnect when confirmed", async () => {
      const { api } = await import("@/lib/api-client");
      const { toast } = await import("sonner");
      const mockApi = vi.mocked(api);
      mockApi.delete.mockResolvedValue({
        data: {
          id: MOCK_CONNECTION.id,
          provider: "oura",
          disconnected_at: new Date().toISOString(),
        },
      });

      const onDisconnected = vi.fn();
      renderWithProviders(
        <ConnectionCard
          connection={MOCK_CONNECTION}
          onDisconnected={onDisconnected}
        />,
      );

      // Open dialog
      fireEvent.click(screen.getByTestId("disconnect-button"));

      // Confirm disconnect
      await waitFor(() => {
        expect(
          screen.getByTestId("confirm-disconnect-button"),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("confirm-disconnect-button"));

      await waitFor(() => {
        expect(mockApi.delete).toHaveBeenCalledWith(
          `/connections/${MOCK_CONNECTION.id}`,
        );
      });

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Oura Ring disconnected.");
      });
    });
  });
});
