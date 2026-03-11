// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileForm } from "../ProfileForm";

// Mock hooks
const mockUseUserProfile = vi.fn();
vi.mock("@/hooks/useUserProfile", () => ({
  useUserProfile: () => mockUseUserProfile(),
}));

const mockMutate = vi.fn();
vi.mock("@/hooks/useUpdateProfile", () => ({
  useUpdateProfile: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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

describe("ProfileForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserProfile.mockReturnValue({
      data: {
        data: {
          id: "user-1",
          display_name: "Wes",
          created_at: "2026-01-01T00:00:00Z",
          stats: { total_data_points: 100, active_shares: 2, connections: 1 },
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("renders profile form with current display name", async () => {
    renderWithProviders(<ProfileForm />);

    await waitFor(() => {
      expect(screen.getByTestId("profile-form")).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/display name/i);
    expect(input).toHaveValue("Wes");
  });

  it("shows loading state while profile loads", () => {
    mockUseUserProfile.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ProfileForm />);

    expect(screen.getByTestId("profile-form-loading")).toBeInTheDocument();
  });

  it("validates empty display name", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm />);

    await waitFor(() => {
      expect(screen.getByTestId("profile-form")).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/display name/i);
    await user.clear(input);

    const saveButton = screen.getByTestId("save-profile-button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/display name is required/i)).toBeInTheDocument();
    });
  });

  it("validates display name max length", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm />);

    await waitFor(() => {
      expect(screen.getByTestId("profile-form")).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/display name/i);
    await user.clear(input);
    await user.type(input, "A".repeat(101));

    const saveButton = screen.getByTestId("save-profile-button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/100 characters or less/i)).toBeInTheDocument();
    });
  });

  it("calls updateProfile mutation with valid data", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm />);

    await waitFor(() => {
      expect(screen.getByTestId("profile-form")).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/display name/i);
    await user.clear(input);
    await user.type(input, "New Name");

    const saveButton = screen.getByTestId("save-profile-button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { display_name: "New Name" },
        expect.any(Object),
      );
    });
  });

  it("shows error state when profile fails to load", () => {
    const refetch = vi.fn();
    mockUseUserProfile.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
      refetch,
    });

    renderWithProviders(<ProfileForm />);

    expect(screen.getByTestId("error-card")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("retry-button"));
    expect(refetch).toHaveBeenCalled();
  });
});
