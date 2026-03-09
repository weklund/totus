// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/sign-up",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import SignUpPage from "../sign-up/[[...sign-up]]/page";

describe("SignUpPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sign-up form with display name, email, and password fields", () => {
    render(<SignUpPage />);

    expect(screen.getByLabelText("Display name")).toBeDefined();
    expect(screen.getByLabelText("Email address")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeDefined();
  });

  it("renders heading and description", () => {
    render(<SignUpPage />);

    expect(screen.getByText("Create your account")).toBeDefined();
    expect(
      screen.getByText("Start tracking your health data in a secure vault"),
    ).toBeDefined();
  });

  it("renders link to sign-in page", () => {
    render(<SignUpPage />);

    const signInLink = screen.getByRole("link", { name: "Sign in" });
    expect(signInLink).toBeDefined();
    expect(signInLink.getAttribute("href")).toBe("/sign-in");
  });

  it("submits form and redirects to /dashboard on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { userId: "user_1" } }),
    });

    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Test User" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
          displayName: "Test User",
        }),
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("submits form without display name (optional field)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { userId: "user_1" } }),
    });

    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
          displayName: undefined,
        }),
      });
    });
  });

  it("displays error message on sign-up failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { message: "Email already in use" },
      }),
    });

    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByText("Email already in use")).toBeDefined();
    });
  });

  it("shows loading state while submitting", async () => {
    let resolvePromise: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockFetch.mockReturnValueOnce(fetchPromise);

    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByText("Creating account...")).toBeDefined();
    });

    // Resolve the promise to clean up
    resolvePromise!({
      ok: true,
      json: async () => ({ data: {} }),
    });
  });

  it("handles network error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByText("An unexpected error occurred")).toBeDefined();
    });
  });

  it("has required attributes on email and password inputs but not display name", () => {
    render(<SignUpPage />);

    const displayNameInput = screen.getByLabelText(
      "Display name",
    ) as HTMLInputElement;
    const emailInput = screen.getByLabelText(
      "Email address",
    ) as HTMLInputElement;
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;

    expect(displayNameInput.required).toBe(false);
    expect(emailInput.required).toBe(true);
    expect(emailInput.type).toBe("email");
    expect(passwordInput.required).toBe(true);
    expect(passwordInput.type).toBe("password");
  });
});
