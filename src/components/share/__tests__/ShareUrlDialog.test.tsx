// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShareUrlDialog } from "../ShareUrlDialog";

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe("ShareUrlDialog", () => {
  const shareUrl = "http://localhost:3000/v/abc123token";

  it("renders the share URL", () => {
    render(
      <ShareUrlDialog open={true} shareUrl={shareUrl} onClose={vi.fn()} />,
    );

    expect(screen.getByText(shareUrl)).toBeInTheDocument();
  });

  it("shows warning about link being shown only once", () => {
    render(
      <ShareUrlDialog open={true} shareUrl={shareUrl} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/save this link now/i)).toBeInTheDocument();
  });

  it("has a copy button", () => {
    render(
      <ShareUrlDialog open={true} shareUrl={shareUrl} onClose={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ShareUrlDialog open={true} shareUrl={shareUrl} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
