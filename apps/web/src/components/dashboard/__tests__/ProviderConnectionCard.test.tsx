// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProviderConnectionCard } from "../ProviderConnectionCard";
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

const MOCK_CONNECTION: Connection = {
  id: "conn-1",
  provider: "oura",
  status: "active",
  last_sync_at: new Date(Date.now() - 3600_000).toISOString(),
  sync_status: "idle",
  connected_at: "2026-01-15T10:00:00.000Z",
};

describe("ProviderConnectionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generic provider display", () => {
    it("shows provider name dynamically from config (not hardcoded 'Oura Ring')", () => {
      renderWithProviders(
        <ProviderConnectionCard
          providerId="oura"
          connection={MOCK_CONNECTION}
        />,
      );

      expect(screen.getByText("Oura Ring")).toBeInTheDocument();
    });

    it("shows Dexcom display name for dexcom provider", () => {
      const dexcomConn: Connection = {
        ...MOCK_CONNECTION,
        provider: "dexcom",
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="dexcom" connection={dexcomConn} />,
      );

      expect(screen.getByText("Dexcom CGM")).toBeInTheDocument();
    });

    it("shows Garmin display name for garmin provider", () => {
      const garminConn: Connection = {
        ...MOCK_CONNECTION,
        provider: "garmin",
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="garmin" connection={garminConn} />,
      );

      expect(screen.getByText("Garmin Connect")).toBeInTheDocument();
    });
  });

  describe("disconnected state", () => {
    it("renders connect button when no connection provided", () => {
      renderWithProviders(<ProviderConnectionCard providerId="oura" />);

      expect(
        screen.getByTestId("provider-card-oura-disconnected"),
      ).toBeInTheDocument();
      expect(screen.getByText("Oura Ring")).toBeInTheDocument();
      expect(screen.getByText("Not connected")).toBeInTheDocument();
      expect(screen.getByTestId("connect-oura-button")).toBeInTheDocument();
    });

    it("calls generic OAuth authorize endpoint when connect clicked", async () => {
      const { api } = await import("@/lib/api-client");
      const mockApi = vi.mocked(api);
      mockApi.get.mockResolvedValue({
        data: { authorize_url: "https://example.com/oauth" },
      });

      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        writable: true,
        value: { ...originalLocation, href: "" },
      });

      renderWithProviders(<ProviderConnectionCard providerId="oura" />);

      fireEvent.click(screen.getByTestId("connect-oura-button"));

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith("/connections/oura/authorize");
      });

      Object.defineProperty(window, "location", {
        writable: true,
        value: originalLocation,
      });
    });

    it("shows error toast with provider name when connect fails", async () => {
      const { api } = await import("@/lib/api-client");
      const { toast } = await import("sonner");
      const mockApi = vi.mocked(api);
      mockApi.get.mockRejectedValue(new Error("Network error"));

      renderWithProviders(<ProviderConnectionCard providerId="oura" />);

      fireEvent.click(screen.getByTestId("connect-oura-button"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to start Oura Ring connection. Please try again.",
        );
      });
    });
  });

  describe("connected state with status badge", () => {
    it("shows Connected badge for active status", () => {
      renderWithProviders(
        <ProviderConnectionCard
          providerId="oura"
          connection={MOCK_CONNECTION}
        />,
      );

      expect(
        screen.getByTestId("provider-card-oura-connected"),
      ).toBeInTheDocument();
      expect(screen.getByText("Connected")).toBeInTheDocument();
      expect(screen.getByText(/Last synced/)).toBeInTheDocument();
    });

    it("shows Token Expired badge for expired status", () => {
      const expiredConn: Connection = {
        ...MOCK_CONNECTION,
        status: "expired",
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="oura" connection={expiredConn} />,
      );

      expect(screen.getByText("Token Expired")).toBeInTheDocument();
    });

    it("shows Error badge for error status", () => {
      const errorConn: Connection = {
        ...MOCK_CONNECTION,
        status: "error",
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="oura" connection={errorConn} />,
      );

      expect(screen.getByText("Error")).toBeInTheDocument();
    });

    it("shows Paused badge for paused status", () => {
      const pausedConn: Connection = {
        ...MOCK_CONNECTION,
        status: "paused",
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="oura" connection={pausedConn} />,
      );

      expect(screen.getByText("Paused")).toBeInTheDocument();
    });

    it("shows 'Never synced' when last_sync_at is null", () => {
      const noSyncConn: Connection = {
        ...MOCK_CONNECTION,
        last_sync_at: null,
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="oura" connection={noSyncConn} />,
      );

      expect(screen.getByText(/Never synced/)).toBeInTheDocument();
    });
  });

  describe("expired/error state shows Reconnect", () => {
    it("shows Reconnect button when expired", () => {
      const expiredConn: Connection = {
        ...MOCK_CONNECTION,
        status: "expired",
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="oura" connection={expiredConn} />,
      );

      expect(screen.getByTestId("reconnect-oura-button")).toBeInTheDocument();
      expect(screen.getByText("Reconnect")).toBeInTheDocument();
    });

    it("shows Reconnect button when error", () => {
      const errorConn: Connection = {
        ...MOCK_CONNECTION,
        status: "error",
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="oura" connection={errorConn} />,
      );

      expect(screen.getByTestId("reconnect-oura-button")).toBeInTheDocument();
    });

    it("does NOT show Reconnect for active connections", () => {
      renderWithProviders(
        <ProviderConnectionCard
          providerId="oura"
          connection={MOCK_CONNECTION}
        />,
      );

      expect(screen.queryByText("Reconnect")).not.toBeInTheDocument();
      expect(screen.getByTestId("sync-oura-button")).toBeInTheDocument();
    });

    it("Reconnect re-initiates OAuth flow", async () => {
      const { api } = await import("@/lib/api-client");
      const mockApi = vi.mocked(api);
      mockApi.get.mockResolvedValue({
        data: { authorize_url: "https://example.com/oauth/reauth" },
      });

      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        writable: true,
        value: { ...originalLocation, href: "" },
      });

      const expiredConn: Connection = {
        ...MOCK_CONNECTION,
        status: "expired",
      };
      renderWithProviders(
        <ProviderConnectionCard providerId="oura" connection={expiredConn} />,
      );

      fireEvent.click(screen.getByTestId("reconnect-oura-button"));

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith("/connections/oura/authorize");
      });

      Object.defineProperty(window, "location", {
        writable: true,
        value: originalLocation,
      });
    });
  });

  describe("sync and disconnect actions", () => {
    it("triggers sync on Sync Now click", async () => {
      const { api } = await import("@/lib/api-client");
      const { toast } = await import("sonner");
      const mockApi = vi.mocked(api);
      mockApi.post.mockResolvedValue({
        data: {
          sync_id: "sync-1",
          status: "completed",
          message: "Synced 42 data points",
          rows_synced: 42,
        },
      });

      renderWithProviders(
        <ProviderConnectionCard
          providerId="oura"
          connection={MOCK_CONNECTION}
        />,
      );

      fireEvent.click(screen.getByTestId("sync-oura-button"));

      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          `/connections/${MOCK_CONNECTION.id}/sync`,
          {},
        );
      });

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Synced 42 data points");
      });
    });

    it("shows disconnect confirmation with provider name", async () => {
      renderWithProviders(
        <ProviderConnectionCard
          providerId="oura"
          connection={MOCK_CONNECTION}
        />,
      );

      fireEvent.click(screen.getByTestId("disconnect-oura-button"));

      await waitFor(() => {
        expect(screen.getByText("Disconnect Oura Ring?")).toBeInTheDocument();
        expect(
          screen.getByText(/This will remove the Oura Ring connection/),
        ).toBeInTheDocument();
      });
    });

    it("calls disconnect and shows provider-specific success toast", async () => {
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
        <ProviderConnectionCard
          providerId="oura"
          connection={MOCK_CONNECTION}
          onDisconnected={onDisconnected}
        />,
      );

      fireEvent.click(screen.getByTestId("disconnect-oura-button"));

      await waitFor(() => {
        expect(
          screen.getByTestId("confirm-disconnect-oura-button"),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("confirm-disconnect-oura-button"));

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
