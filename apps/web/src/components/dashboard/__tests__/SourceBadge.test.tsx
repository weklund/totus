// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceBadge, getProviderColor } from "../SourceBadge";

describe("SourceBadge", () => {
  it("renders a dot for known provider", () => {
    render(<SourceBadge provider="oura" />);

    const badge = screen.getByTestId("source-badge-oura");
    expect(badge).toBeInTheDocument();
    expect(badge.style.backgroundColor).toBeTruthy();
  });

  it("shows provider name when showName is true", () => {
    render(<SourceBadge provider="oura" showName />);

    expect(screen.getByText("Oura Ring")).toBeInTheDocument();
  });

  it("renders with title for dot-only variant", () => {
    render(<SourceBadge provider="dexcom" />);

    const badge = screen.getByTestId("source-badge-dexcom");
    expect(badge).toHaveAttribute("title", "Dexcom CGM");
  });

  it("handles unknown provider gracefully", () => {
    render(<SourceBadge provider="unknown_provider" />);

    const badge = screen.getByTestId("source-badge-unknown_provider");
    expect(badge).toBeInTheDocument();
  });
});

describe("getProviderColor", () => {
  it("returns known colors for known providers", () => {
    expect(getProviderColor("oura")).toBe("#7C3AED");
    expect(getProviderColor("dexcom")).toBe("#DB2777");
    expect(getProviderColor("garmin")).toBe("#2563EB");
  });

  it("returns fallback for unknown provider", () => {
    expect(getProviderColor("unknown")).toBe("#6B7280");
  });
});
