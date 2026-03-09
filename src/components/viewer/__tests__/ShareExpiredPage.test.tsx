// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShareExpiredPage } from "../ShareExpiredPage";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

describe("ShareExpiredPage", () => {
  it("renders the Totus logo linking to home", () => {
    render(<ShareExpiredPage />);

    const logo = screen.getByText("Totus");
    expect(logo).toBeDefined();
    expect(logo.closest("a")).toHaveAttribute("href", "/");
  });

  it("shows 'This link is no longer available' heading", () => {
    render(<ShareExpiredPage />);

    expect(screen.getByText("This link is no longer available")).toBeDefined();
  });

  it("shows generic message without info leakage", () => {
    render(<ShareExpiredPage />);

    expect(
      screen.getByText(/It may have expired, been revoked, or never existed/),
    ).toBeDefined();
  });

  it("does not show a sign-in CTA", () => {
    render(<ShareExpiredPage />);

    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.queryByText(/log in/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
  });

  it("does not reveal token validity reason", () => {
    render(<ShareExpiredPage />);

    // Should not say specifically "expired", "revoked" etc. as the reason
    // The message should be the same regardless of why the token is invalid
    const bodyText = document.body.textContent ?? "";
    // The combined message mentions all three as possibilities, not as definitive reason
    expect(bodyText).toContain(
      "may have expired, been revoked, or never existed",
    );
  });
});
