// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShareList } from "../ShareList";
import type { ShareGrant } from "@/hooks/useShares";

// Mock hooks
const mockShares: ShareGrant[] = [
  {
    id: "share-1",
    label: "For Dr. Smith",
    allowed_metrics: ["sleep_score", "hrv"],
    data_start: "2026-01-01",
    data_end: "2026-03-01",
    grant_expires: "2026-06-01",
    status: "active",
    revoked_at: null,
    view_count: 5,
    last_viewed_at: "2026-03-08T12:00:00Z",
    note: "Sleep and HRV data for review",
    created_at: "2026-03-01T00:00:00Z",
  },
  {
    id: "share-2",
    label: "For Coach Jane",
    allowed_metrics: ["steps", "readiness_score"],
    data_start: "2025-12-01",
    data_end: "2026-02-28",
    grant_expires: "2026-01-01",
    status: "expired",
    revoked_at: null,
    view_count: 12,
    last_viewed_at: "2026-01-15T09:00:00Z",
    note: null,
    created_at: "2025-12-01T00:00:00Z",
  },
  {
    id: "share-3",
    label: "Old share",
    allowed_metrics: ["rhr"],
    data_start: "2025-10-01",
    data_end: "2025-12-31",
    grant_expires: "2026-02-01",
    status: "revoked",
    revoked_at: "2026-01-15T00:00:00Z",
    view_count: 0,
    last_viewed_at: null,
    note: null,
    created_at: "2025-10-01T00:00:00Z",
  },
];

const mockUseShares = vi.fn();
vi.mock("@/hooks/useShares", () => ({
  useShares: (...args: unknown[]) => mockUseShares(...args),
}));

const mockRevokeMutate = vi.fn();
vi.mock("@/hooks/useRevokeShare", () => ({
  useRevokeShare: () => ({
    mutate: mockRevokeMutate,
    isPending: false,
  }),
}));

const mockDeleteMutate = vi.fn();
vi.mock("@/hooks/useDeleteShare", () => ({
  useDeleteShare: () => ({
    mutate: mockDeleteMutate,
    isPending: false,
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("ShareList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseShares.mockReturnValue({
      data: {
        pages: [
          {
            data: mockShares,
            pagination: { next_cursor: null, has_more: false },
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });
  });

  it("renders share cards with labels", () => {
    renderWithProviders(<ShareList status="all" />);

    expect(screen.getByText("For Dr. Smith")).toBeInTheDocument();
    expect(screen.getByText("For Coach Jane")).toBeInTheDocument();
    expect(screen.getByText("Old share")).toBeInTheDocument();
  });

  it("shows status badges on share cards", () => {
    renderWithProviders(<ShareList status="all" />);

    expect(screen.getByText("Active")).toBeInTheDocument();
    // "Expired" may appear in both status badge and date info
    expect(screen.getAllByText("Expired").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("shows view count on share cards", () => {
    renderWithProviders(<ShareList status="all" />);

    expect(screen.getByText(/5 views/i)).toBeInTheDocument();
    expect(screen.getByText(/12 views/i)).toBeInTheDocument();
    expect(screen.getByText(/0 views/i)).toBeInTheDocument();
  });

  it("shows revoke button only for active shares", () => {
    renderWithProviders(<ShareList status="all" />);

    const revokeButtons = screen.getAllByRole("button", { name: /revoke/i });
    // Only the active share should have a revoke button
    expect(revokeButtons).toHaveLength(1);
  });

  it("shows delete button only for revoked/expired shares", () => {
    renderWithProviders(<ShareList status="all" />);

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    // Expired and revoked shares should have delete buttons
    expect(deleteButtons).toHaveLength(2);
  });

  it("shows loading state", () => {
    mockUseShares.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });

    renderWithProviders(<ShareList status="all" />);

    // Should show skeleton cards
    expect(screen.getByTestId("share-list-loading")).toBeInTheDocument();
  });

  it("shows empty state when no shares", () => {
    mockUseShares.mockReturnValue({
      data: {
        pages: [
          { data: [], pagination: { next_cursor: null, has_more: false } },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });

    renderWithProviders(<ShareList status="all" />);

    expect(screen.getByText(/no shared links yet/i)).toBeInTheDocument();
  });

  it("shows load more button when more pages available", () => {
    const fetchNext = vi.fn();
    mockUseShares.mockReturnValue({
      data: {
        pages: [
          {
            data: mockShares,
            pagination: { next_cursor: "abc", has_more: true },
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: true,
      fetchNextPage: fetchNext,
      isFetchingNextPage: false,
    });

    renderWithProviders(<ShareList status="all" />);

    const loadMore = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMore);
    expect(fetchNext).toHaveBeenCalled();
  });

  it("shows metric chips on share cards", () => {
    renderWithProviders(<ShareList status="all" />);

    // The first card should show its metric chips (uses full label from METRIC_TYPES)
    expect(screen.getByText("Sleep Score")).toBeInTheDocument();
    expect(screen.getByText("Heart Rate Variability")).toBeInTheDocument();
  });
});
