// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareWizard } from "../ShareWizard";
import type { HealthDataType } from "@/hooks/useHealthDataTypes";

// Mock data for available metrics
const MOCK_METRICS: HealthDataType[] = [
  {
    metric_type: "sleep_score",
    label: "Sleep Score",
    unit: "score",
    category: "Sleep",
    source: "oura",
    date_range: { start: "2025-12-01", end: "2026-03-01" },
    count: 90,
  },
  {
    metric_type: "hrv",
    label: "Heart Rate Variability",
    unit: "ms",
    category: "Cardio",
    source: "oura",
    date_range: { start: "2025-12-01", end: "2026-03-01" },
    count: 90,
  },
  {
    metric_type: "steps",
    label: "Steps",
    unit: "steps",
    category: "Activity",
    source: "oura",
    date_range: { start: "2025-12-01", end: "2026-03-01" },
    count: 90,
  },
];

// Use vi.hoisted so the mock variable is available when vi.mock is hoisted
const { mockMutateAsync } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
}));

// Mock useCreateShare - this gets hoisted to the top
vi.mock("@/hooks/useCreateShare", () => ({
  useCreateShare: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

describe("ShareWizard", () => {
  const mockOnCreated = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({
      data: {
        id: "share-1",
        token: "abc123token",
        share_url: "http://localhost:3000/v/abc123token",
        label: "Shared health data",
        allowed_metrics: ["sleep_score"],
        data_start: "2025-12-01",
        data_end: "2026-03-01",
        grant_expires: "2026-04-01",
        note: null,
        created_at: "2026-03-09",
      },
    });
  });

  function renderWizard() {
    return render(
      <ShareWizard
        availableMetrics={MOCK_METRICS}
        onCreated={mockOnCreated}
        onCancel={mockOnCancel}
      />,
    );
  }

  it("renders step 1 with metric chips", () => {
    renderWizard();

    expect(screen.getByText("Select Metrics")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.getByText("Sleep Score")).toBeInTheDocument();
    expect(screen.getByText("Heart Rate Variability")).toBeInTheDocument();
    expect(screen.getByText("Steps")).toBeInTheDocument();
  });

  it("validates minimum one metric selected before advancing", async () => {
    renderWizard();

    // Try to advance without selecting metrics
    const nextButton = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextButton);

    expect(screen.getByText(/select at least one metric/i)).toBeInTheDocument();

    // Should still be on step 1
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
  });

  it("navigates from step 1 to step 2 after selecting a metric", async () => {
    renderWizard();

    // Select a metric
    fireEvent.click(screen.getByTestId("metric-chip-sleep_score"));

    // Advance to step 2
    const nextButton = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextButton);

    // "Date Range" appears in both step indicator and step heading
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Date Range" }),
    ).toBeInTheDocument();
  });

  it("navigates back from step 2 to step 1", async () => {
    renderWizard();

    // Select a metric and advance
    fireEvent.click(screen.getByTestId("metric-chip-sleep_score"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Now on step 2, go back
    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
  });

  it("navigates through all 4 steps", async () => {
    renderWizard();

    // Step 1: Select metric
    fireEvent.click(screen.getByTestId("metric-chip-sleep_score"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 2: Date range (presets should be available)
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Date Range" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 3: Expiration
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Expiration & Note" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 4: Review
    expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
  });

  it("shows summary on step 4 review", async () => {
    renderWizard();

    // Complete all steps
    fireEvent.click(screen.getByTestId("metric-chip-sleep_score"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Review step should show summary
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create share link/i }),
    ).toBeInTheDocument();
    // Should show the selected metric in the summary
    expect(screen.getAllByText(/Sleep Score/).length).toBeGreaterThanOrEqual(1);
  });

  it("submits share and calls onCreated", async () => {
    renderWizard();

    // Navigate through wizard
    fireEvent.click(screen.getByTestId("metric-chip-sleep_score"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Submit on review step
    fireEvent.click(screen.getByRole("button", { name: /create share link/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockOnCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "share-1",
          share_url: "http://localhost:3000/v/abc123token",
        }),
      );
    });
  });

  it("calls onCancel when cancel button is clicked", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it("shows step indicator with correct progress", () => {
    renderWizard();

    // All step labels should be visible in the indicator
    expect(screen.getByText("Metrics")).toBeInTheDocument();
    // "Date Range" appears both in step indicator and step heading
    expect(screen.getAllByText("Date Range").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Expiration")).toBeInTheDocument();
    // "Review" appears in step indicator
    expect(screen.getAllByText("Review").length).toBeGreaterThanOrEqual(1);
  });
});
