// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InsightCard } from "../InsightCard";
import type { Insight } from "@/lib/dashboard/types";

// Mock api client (used by useDismissInsight)
const mockPost = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
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

const MOCK_INSIGHT: Insight = {
  type: "elevated_rhr",
  title: "Elevated Resting Heart Rate",
  body: "Your resting HR was 11 bpm above your 30-day average. Sleep onset took 35 min.",
  related_metrics: ["rhr", "sleep_latency", "deep_sleep"],
  severity: "warning",
  dismissible: true,
};

const INFO_INSIGHT: Insight = {
  type: "low_sleep_score",
  title: "Low Sleep Score",
  body: "Your sleep score was 19 points below average.",
  related_metrics: ["sleep_score"],
  severity: "info",
  dismissible: true,
};

const MOCK_DATE = "2026-03-28";

beforeEach(() => {
  mockPost.mockReset();
  mockPost.mockResolvedValue({
    data: { insight_type: "elevated_rhr", date: MOCK_DATE, dismissed: true },
  });
});

describe("InsightCard", () => {
  it("renders narrative title and body text", () => {
    renderWithProviders(
      <InsightCard insight={MOCK_INSIGHT} date={MOCK_DATE} />,
    );
    expect(screen.getByTestId("insight-card")).toBeInTheDocument();
    expect(screen.getByText("Elevated Resting Heart Rate")).toBeInTheDocument();
    expect(
      screen.getByText(/Your resting HR was 11 bpm above/),
    ).toBeInTheDocument();
  });

  it("shows severity badge with correct variant", () => {
    renderWithProviders(
      <InsightCard insight={MOCK_INSIGHT} date={MOCK_DATE} />,
    );
    const badge = screen.getByTestId("insight-severity");
    expect(badge).toHaveTextContent("warning");
  });

  it("shows info severity badge for info-level insight", () => {
    renderWithProviders(
      <InsightCard insight={INFO_INSIGHT} date={MOCK_DATE} />,
    );
    const badge = screen.getByTestId("insight-severity");
    expect(badge).toHaveTextContent("info");
  });

  it("shows related metrics tags", () => {
    renderWithProviders(
      <InsightCard insight={MOCK_INSIGHT} date={MOCK_DATE} />,
    );
    const tags = screen.getAllByTestId("insight-metric-tag");
    expect(tags).toHaveLength(3);
    expect(tags[0]).toHaveTextContent("rhr");
    expect(tags[1]).toHaveTextContent("sleep latency");
    expect(tags[2]).toHaveTextContent("deep sleep");
  });

  it("shows dismiss button when insight is dismissible", () => {
    renderWithProviders(
      <InsightCard insight={MOCK_INSIGHT} date={MOCK_DATE} />,
    );
    expect(screen.getByTestId("insight-dismiss")).toBeInTheDocument();
  });

  it("fires useDismissInsight mutation with type and date on dismiss click", async () => {
    renderWithProviders(
      <InsightCard insight={MOCK_INSIGHT} date={MOCK_DATE} />,
    );
    fireEvent.click(screen.getByTestId("insight-dismiss"));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        `/insights/elevated_rhr/${MOCK_DATE}/dismiss`,
        {},
      );
    });
  });

  it("calls onDismiss callback instead of mutation when provided", () => {
    const onDismiss = vi.fn();
    renderWithProviders(
      <InsightCard
        insight={MOCK_INSIGHT}
        date={MOCK_DATE}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId("insight-dismiss"));
    expect(onDismiss).toHaveBeenCalledWith("elevated_rhr");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("does not show dismiss button when not dismissible", () => {
    const nonDismissible = { ...MOCK_INSIGHT, dismissible: false };
    renderWithProviders(
      <InsightCard insight={nonDismissible} date={MOCK_DATE} />,
    );
    expect(screen.queryByTestId("insight-dismiss")).not.toBeInTheDocument();
  });

  it("has accessible aria-label on the card", () => {
    renderWithProviders(
      <InsightCard insight={MOCK_INSIGHT} date={MOCK_DATE} />,
    );
    const card = screen.getByTestId("insight-card");
    expect(card).toHaveAttribute(
      "aria-label",
      "Insight: Elevated Resting Heart Rate",
    );
  });

  it("dismiss button is keyboard-focusable", () => {
    renderWithProviders(
      <InsightCard insight={MOCK_INSIGHT} date={MOCK_DATE} />,
    );
    const btn = screen.getByTestId("insight-dismiss");
    expect(btn).toHaveAttribute(
      "aria-label",
      "Dismiss insight: Elevated Resting Heart Rate",
    );
    // Button element is natively focusable
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });
});
