// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeleteAccountDialog } from "../DeleteAccountDialog";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock useDeleteAccount
const mockMutate = vi.fn();
vi.mock("@/hooks/useDeleteAccount", () => ({
  useDeleteAccount: () => ({
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

describe("DeleteAccountDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders delete account button", () => {
    renderWithProviders(<DeleteAccountDialog />);

    expect(screen.getByTestId("delete-account-button")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete account/i }),
    ).toBeInTheDocument();
  });

  it("opens dialog when button clicked", async () => {
    renderWithProviders(<DeleteAccountDialog />);

    fireEvent.click(screen.getByTestId("delete-account-button"));

    await waitFor(() => {
      expect(
        screen.getByText(/permanent and irreversible/i),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("delete-confirmation-input"),
      ).toBeInTheDocument();
    });
  });

  it("disables confirm button until exact match typed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeleteAccountDialog />);

    fireEvent.click(screen.getByTestId("delete-account-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("delete-confirmation-input"),
      ).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId("confirm-delete-button");
    expect(confirmButton).toBeDisabled();

    // Type partial match
    const input = screen.getByTestId("delete-confirmation-input");
    await user.type(input, "DELETE MY");
    expect(confirmButton).toBeDisabled();

    // Type wrong match
    await user.clear(input);
    await user.type(input, "delete my account"); // lowercase
    expect(confirmButton).toBeDisabled();

    // Type exact match
    await user.clear(input);
    await user.type(input, "DELETE MY ACCOUNT");
    expect(confirmButton).toBeEnabled();
  });

  it("calls deleteAccount mutation with confirmation string on confirm", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeleteAccountDialog />);

    fireEvent.click(screen.getByTestId("delete-account-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("delete-confirmation-input"),
      ).toBeInTheDocument();
    });

    const input = screen.getByTestId("delete-confirmation-input");
    await user.type(input, "DELETE MY ACCOUNT");

    const confirmButton = screen.getByTestId("confirm-delete-button");
    fireEvent.click(confirmButton);

    expect(mockMutate).toHaveBeenCalledWith(
      "DELETE MY ACCOUNT",
      expect.any(Object),
    );
  });

  it("clears input when dialog closes and reopens", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeleteAccountDialog />);

    // Open dialog and type something
    fireEvent.click(screen.getByTestId("delete-account-button"));
    await waitFor(() => {
      expect(
        screen.getByTestId("delete-confirmation-input"),
      ).toBeInTheDocument();
    });

    const input = screen.getByTestId("delete-confirmation-input");
    await user.type(input, "DELETE MY");

    // Close dialog by clicking cancel
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Reopen dialog
    fireEvent.click(screen.getByTestId("delete-account-button"));
    await waitFor(() => {
      expect(
        screen.getByTestId("delete-confirmation-input"),
      ).toBeInTheDocument();
    });

    // Input should be cleared
    expect(screen.getByTestId("delete-confirmation-input")).toHaveValue("");
  });
});
