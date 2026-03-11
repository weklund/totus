// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/sign-in",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import SignInPage from "../sign-in/[[...sign-in]]/page";

describe("SignInPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sign-in form with email and password fields", () => {
    render(<SignInPage />);

    expect(screen.getByLabelText("Email address")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
  });

  it("renders heading and description", () => {
    render(<SignInPage />);

    // Card title is rendered with data-slot="card-title"
    const allSignIn = screen.getAllByText("Sign in");
    expect(allSignIn.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(
        "Enter your credentials to access your health data vault",
      ),
    ).toBeDefined();
  });

  it("renders link to sign-up page", () => {
    render(<SignInPage />);

    const signUpLink = screen.getByRole("link", { name: "Sign up" });
    expect(signUpLink).toBeDefined();
    expect(signUpLink.getAttribute("href")).toBe("/sign-up");
  });

  it("submits form and redirects to /dashboard on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { userId: "user_1" } }),
    });

    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
        }),
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("displays error message on sign-in failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { message: "Invalid credentials" },
      }),
    });

    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrongpassword" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeDefined();
    });
  });

  it("shows loading state while submitting", async () => {
    let resolvePromise: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockFetch.mockReturnValueOnce(fetchPromise);

    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Signing in...")).toBeDefined();
    });

    // Resolve the promise to clean up
    resolvePromise!({
      ok: true,
      json: async () => ({ data: {} }),
    });
  });

  it("handles network error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("An unexpected error occurred")).toBeDefined();
    });
  });

  it("has required attributes on email and password inputs", () => {
    render(<SignInPage />);

    const emailInput = screen.getByLabelText(
      "Email address",
    ) as HTMLInputElement;
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;

    expect(emailInput.required).toBe(true);
    expect(emailInput.type).toBe("email");
    expect(passwordInput.required).toBe(true);
    expect(passwordInput.type).toBe("password");
  });
});
