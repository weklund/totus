// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuditTable } from "../AuditTable";
import type { AuditEvent } from "@/hooks/useAuditLog";

// Mock hooks
const mockAuditEvents: AuditEvent[] = [
  {
    id: "1",
    event_type: "data.viewed",
    actor_type: "owner",
    actor_id: "user-1",
    grant_id: null,
    resource_type: "health_data",
    resource_detail: { metrics: ["sleep_score", "hrv"] },
    description: "You viewed sleep_score, hrv",
    ip_address: "127.0.0.1",
    user_agent: "Mozilla/5.0",
    created_at: "2026-03-08T12:00:00Z",
  },
  {
    id: "2",
    event_type: "share.created",
    actor_type: "owner",
    actor_id: "user-1",
    grant_id: null,
    resource_type: "share",
    resource_detail: { label: "For Dr. Smith" },
    description: 'You created share "For Dr. Smith"',
    ip_address: null,
    user_agent: null,
    created_at: "2026-03-07T10:00:00Z",
  },
  {
    id: "3",
    event_type: "share.viewed",
    actor_type: "viewer",
    actor_id: null,
    grant_id: "grant-1",
    resource_type: "share",
    resource_detail: null,
    description: "Viewer opened share link",
    ip_address: "192.168.1.1",
    user_agent: "Chrome/100",
    created_at: "2026-03-06T08:00:00Z",
  },
];

const mockUseAuditLog = vi.fn();
vi.mock("@/hooks/useAuditLog", () => ({
  useAuditLog: (...args: unknown[]) => mockUseAuditLog(...args),
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

describe("AuditTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuditLog.mockReturnValue({
      data: {
        pages: [
          {
            data: mockAuditEvents,
            pagination: { next_cursor: null, has_more: false },
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      refetch: vi.fn(),
    });
  });

  it("renders audit events with descriptions", () => {
    renderWithProviders(<AuditTable />);

    expect(screen.getByText("You viewed sleep_score, hrv")).toBeInTheDocument();
    expect(
      screen.getByText('You created share "For Dr. Smith"'),
    ).toBeInTheDocument();
    expect(screen.getByText("Viewer opened share link")).toBeInTheDocument();
  });

  it("renders actor badges", () => {
    renderWithProviders(<AuditTable />);

    expect(screen.getAllByText("YOU")).toHaveLength(2); // two owner events
    expect(screen.getByText("VIEWER")).toBeInTheDocument();
  });

  it("renders relative timestamps", () => {
    renderWithProviders(<AuditTable />);

    // Should have relative time strings (e.g., "2 days ago")
    const timeElements = screen.getAllByTestId(/audit-event-/);
    expect(timeElements.length).toBeGreaterThanOrEqual(3);
  });

  it("shows loading state", () => {
    mockUseAuditLog.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      refetch: vi.fn(),
    });

    renderWithProviders(<AuditTable />);

    expect(screen.getByTestId("audit-loading")).toBeInTheDocument();
  });

  it("shows empty state when no events", () => {
    mockUseAuditLog.mockReturnValue({
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
      refetch: vi.fn(),
    });

    renderWithProviders(<AuditTable />);

    expect(screen.getByTestId("audit-empty")).toBeInTheDocument();
    expect(screen.getByText(/no activity recorded yet/i)).toBeInTheDocument();
  });

  it("shows error state with retry", () => {
    const refetch = vi.fn();
    mockUseAuditLog.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      refetch,
    });

    renderWithProviders(<AuditTable />);

    expect(screen.getByTestId("error-card")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("retry-button"));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows Load More button when more pages available", () => {
    const fetchNextPage = vi.fn();
    mockUseAuditLog.mockReturnValue({
      data: {
        pages: [
          {
            data: mockAuditEvents,
            pagination: { next_cursor: "abc", has_more: true },
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: true,
      fetchNextPage,
      isFetchingNextPage: false,
      refetch: vi.fn(),
    });

    renderWithProviders(<AuditTable />);

    const loadMore = screen.getByTestId("audit-load-more");
    expect(loadMore).toBeInTheDocument();
    fireEvent.click(loadMore);
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("expands event detail row when clicked", () => {
    renderWithProviders(<AuditTable />);

    // Click the first event (which has IP and user agent)
    const firstEvent = screen.getByTestId("audit-event-1");
    fireEvent.click(firstEvent);

    // Detail row should appear
    const detailRow = screen.getByTestId("audit-event-detail-1");
    expect(detailRow).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1")).toBeInTheDocument();
    expect(screen.getByText(/Mozilla\/5.0/)).toBeInTheDocument();
  });

  it("renders filter controls", () => {
    renderWithProviders(<AuditTable />);

    expect(screen.getByTestId("audit-filters")).toBeInTheDocument();
    expect(screen.getByTestId("event-type-filter")).toBeInTheDocument();
    expect(screen.getByTestId("actor-type-filter")).toBeInTheDocument();
  });
});
