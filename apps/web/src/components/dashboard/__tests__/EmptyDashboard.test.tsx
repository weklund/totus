// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EmptyDashboard } from "../EmptyDashboard";

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

describe("EmptyDashboard", () => {
  it("renders empty state with CTA", () => {
    renderWithProviders(<EmptyDashboard />);

    expect(screen.getByTestId("empty-dashboard")).toBeInTheDocument();
    expect(
      screen.getByText("Connect a data source to get started"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Link your health devices/)).toBeInTheDocument();
    expect(screen.getByTestId("empty-connect-button")).toBeInTheDocument();
  });

  it("CTA uses AddProviderDialog (not hardcoded Oura link)", () => {
    renderWithProviders(<EmptyDashboard />);

    // The CTA button should say generic "Connect a Data Source", not "Connect Oura Ring"
    const button = screen.getByTestId("empty-connect-button");
    expect(button.textContent).toContain("Connect a Data Source");
    expect(button.textContent).not.toContain("Oura Ring");
  });

  it("opens AddProviderDialog when CTA clicked", async () => {
    renderWithProviders(<EmptyDashboard />);

    fireEvent.click(screen.getByTestId("empty-connect-button"));

    await waitFor(() => {
      expect(screen.getByTestId("add-provider-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("provider-grid")).toBeInTheDocument();
    });
  });
});
