// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProviderConnectionBar } from "../ProviderConnectionBar";
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

const CONNECTIONS: Connection[] = [
  {
    id: "conn-1",
    provider: "oura",
    status: "active",
    last_sync_at: new Date().toISOString(),
    sync_status: "idle",
    connected_at: "2026-01-15T10:00:00.000Z",
  },
  {
    id: "conn-2",
    provider: "dexcom",
    status: "expired",
    last_sync_at: new Date().toISOString(),
    sync_status: "idle",
    connected_at: "2026-02-01T10:00:00.000Z",
  },
];

describe("ProviderConnectionBar", () => {
  it("renders nothing when no connections", () => {
    const { container } = renderWithProviders(
      <ProviderConnectionBar connections={[]} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders connection pills for each provider", () => {
    renderWithProviders(<ProviderConnectionBar connections={CONNECTIONS} />);

    expect(screen.getByTestId("provider-connection-bar")).toBeInTheDocument();
    expect(screen.getByTestId("connection-pill-oura")).toBeInTheDocument();
    expect(screen.getByTestId("connection-pill-dexcom")).toBeInTheDocument();
  });

  it("shows provider display names in pills", () => {
    renderWithProviders(<ProviderConnectionBar connections={CONNECTIONS} />);

    expect(screen.getByText("Oura Ring")).toBeInTheDocument();
    expect(screen.getByText("Dexcom CGM")).toBeInTheDocument();
  });

  it("shows Add Source button to open AddProviderDialog", () => {
    renderWithProviders(<ProviderConnectionBar connections={CONNECTIONS} />);

    expect(screen.getByTestId("add-provider-button")).toBeInTheDocument();
  });

  it("shows green dot for active connections", () => {
    renderWithProviders(<ProviderConnectionBar connections={CONNECTIONS} />);

    const ouraPill = screen.getByTestId("connection-pill-oura");
    // Active connection should have a green dot (bg-green-500)
    const greenDot = ouraPill.querySelector(".bg-green-500");
    expect(greenDot).not.toBeNull();
  });

  it("shows yellow dot for expired connections", () => {
    renderWithProviders(<ProviderConnectionBar connections={CONNECTIONS} />);

    const dexcomPill = screen.getByTestId("connection-pill-dexcom");
    const yellowDot = dexcomPill.querySelector(".bg-yellow-500");
    expect(yellowDot).not.toBeNull();
  });
});
