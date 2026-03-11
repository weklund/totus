// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiKeysSection } from "../ApiKeysSection";
import type { ApiKey } from "@/hooks/useApiKeys";

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
    patch: vi.fn(),
  },
}));

// Mock useApiKeys hook
const mockUseApiKeys = vi.fn();
vi.mock("@/hooks/useApiKeys", () => ({
  useApiKeys: () => mockUseApiKeys(),
}));

// Mock useCreateApiKey hook
const { mockCreateMutateAsync } = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
}));
vi.mock("@/hooks/useCreateApiKey", () => ({
  useCreateApiKey: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
}));

// Mock useRevokeApiKey hook
const { mockRevokeMutateAsync } = vi.hoisted(() => ({
  mockRevokeMutateAsync: vi.fn(),
}));
vi.mock("@/hooks/useRevokeApiKey", () => ({
  useRevokeApiKey: () => ({
    mutateAsync: mockRevokeMutateAsync,
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

const MOCK_KEYS: ApiKey[] = [
  {
    id: "key-1",
    name: "CLI access",
    short_token: "tot_live",
    scopes: ["health:read", "shares:write"],
    status: "active",
    expires_at: null,
    last_used_at: "2026-03-09T10:00:00Z",
    revoked_at: null,
    created_at: "2026-02-01T00:00:00Z",
  },
  {
    id: "key-2",
    name: "Old key",
    short_token: "tot_live",
    scopes: ["health:read"],
    status: "revoked",
    expires_at: null,
    last_used_at: null,
    revoked_at: "2026-03-05T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
  },
];

describe("ApiKeysSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeletons while fetching", () => {
    mockUseApiKeys.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ApiKeysSection />);
    expect(screen.getByTestId("api-keys-loading")).toBeInTheDocument();
  });

  it("shows error card when fetch fails", () => {
    mockUseApiKeys.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Unauthorized"),
      refetch: vi.fn(),
    });

    renderWithProviders(<ApiKeysSection />);
    expect(screen.getByText("Failed to load API keys")).toBeInTheDocument();
  });

  it("shows empty state when no keys exist", () => {
    mockUseApiKeys.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ApiKeysSection />);
    expect(screen.getByText(/No API keys yet/)).toBeInTheDocument();
    expect(screen.getByTestId("create-api-key-button")).toBeInTheDocument();
  });

  it("lists active and revoked keys", () => {
    mockUseApiKeys.mockReturnValue({
      data: { data: MOCK_KEYS },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ApiKeysSection />);
    expect(screen.getByTestId("api-keys-section")).toBeInTheDocument();
    expect(screen.getByText("CLI access")).toBeInTheDocument();
    expect(screen.getByText("Old key")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("shows masked token, not full key", () => {
    mockUseApiKeys.mockReturnValue({
      data: { data: MOCK_KEYS },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ApiKeysSection />);
    // Should show short_token with mask, not full key
    const codeElements = screen.getAllByText(/tot_live••••••••/);
    expect(codeElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows revoke button only for active keys", () => {
    mockUseApiKeys.mockReturnValue({
      data: { data: MOCK_KEYS },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ApiKeysSection />);
    // Active key has revoke button
    expect(screen.getByTestId("revoke-key-key-1")).toBeInTheDocument();
    // Revoked key does not
    expect(screen.queryByTestId("revoke-key-key-2")).not.toBeInTheDocument();
  });

  it("opens create dialog when Create Key button is clicked", () => {
    mockUseApiKeys.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ApiKeysSection />);
    fireEvent.click(screen.getByTestId("create-api-key-button"));

    expect(screen.getByTestId("create-api-key-dialog")).toBeInTheDocument();
    expect(screen.getByText("Create API Key")).toBeInTheDocument();
  });

  it("shows created key banner after successful creation", async () => {
    mockUseApiKeys.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mockCreateMutateAsync.mockResolvedValue({
      data: {
        id: "key-new",
        name: "New key",
        key: "tot_live_abcd1234_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        short_token: "tot_live",
        scopes: ["health:read"],
        expires_at: null,
        created_at: "2026-03-10T00:00:00Z",
      },
    });

    renderWithProviders(<ApiKeysSection />);

    // Open create dialog
    fireEvent.click(screen.getByTestId("create-api-key-button"));

    // Fill in name
    const nameInput = screen.getByTestId("api-key-name-input");
    fireEvent.change(nameInput, { target: { value: "New key" } });

    // Select a scope
    fireEvent.click(screen.getByTestId("scope-health:read"));

    // Submit
    fireEvent.click(screen.getByTestId("create-key-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("created-key-banner")).toBeInTheDocument();
    });

    expect(screen.getByTestId("created-key-value")).toHaveTextContent(
      "tot_live_abcd1234_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    );
  });

  it("shows scopes in key row", () => {
    mockUseApiKeys.mockReturnValue({
      data: { data: MOCK_KEYS },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ApiKeysSection />);
    expect(screen.getByText("health:read, shares:write")).toBeInTheDocument();
  });
});
