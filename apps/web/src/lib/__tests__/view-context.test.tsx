// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewContextProvider, useViewContext } from "@/lib/view-context";
import type { ViewContextValue } from "@/types/view-context";

function TestConsumer() {
  const ctx = useViewContext();
  return (
    <div>
      <span data-testid="role">{ctx.role}</span>
      <span data-testid="userId">{ctx.userId ?? "none"}</span>
      <span data-testid="grantId">{ctx.grantId ?? "none"}</span>
      <span data-testid="metrics">
        {ctx.permissions.metrics === "all"
          ? "all"
          : ctx.permissions.metrics.join(",")}
      </span>
      <span data-testid="dataStart">{ctx.permissions.dataStart ?? "null"}</span>
      <span data-testid="dataEnd">{ctx.permissions.dataEnd ?? "null"}</span>
      <span data-testid="ownerDisplayName">
        {ctx.ownerDisplayName ?? "none"}
      </span>
    </div>
  );
}

describe("ViewContextProvider", () => {
  it("provides owner context to children", () => {
    const ownerValue: ViewContextValue = {
      role: "owner",
      userId: "user_123",
      permissions: {
        metrics: "all",
        dataStart: null,
        dataEnd: null,
      },
    };

    render(
      <ViewContextProvider value={ownerValue}>
        <TestConsumer />
      </ViewContextProvider>,
    );

    expect(screen.getByTestId("role").textContent).toBe("owner");
    expect(screen.getByTestId("userId").textContent).toBe("user_123");
    expect(screen.getByTestId("grantId").textContent).toBe("none");
    expect(screen.getByTestId("metrics").textContent).toBe("all");
    expect(screen.getByTestId("dataStart").textContent).toBe("null");
    expect(screen.getByTestId("dataEnd").textContent).toBe("null");
  });

  it("provides viewer context with scoped permissions", () => {
    const viewerValue: ViewContextValue = {
      role: "viewer",
      grantId: "grant_abc",
      permissions: {
        metrics: ["sleep_score", "hrv"],
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      },
      ownerDisplayName: "Test User",
      note: "Check my sleep data",
    };

    render(
      <ViewContextProvider value={viewerValue}>
        <TestConsumer />
      </ViewContextProvider>,
    );

    expect(screen.getByTestId("role").textContent).toBe("viewer");
    expect(screen.getByTestId("grantId").textContent).toBe("grant_abc");
    expect(screen.getByTestId("metrics").textContent).toBe("sleep_score,hrv");
    expect(screen.getByTestId("dataStart").textContent).toBe("2026-01-01");
    expect(screen.getByTestId("dataEnd").textContent).toBe("2026-03-01");
    expect(screen.getByTestId("ownerDisplayName").textContent).toBe(
      "Test User",
    );
  });

  it("throws error when useViewContext is used outside provider", () => {
    // Suppress console.error during this test since React logs the error
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<TestConsumer />)).toThrow(
      "useViewContext must be used within a ViewContextProvider",
    );

    consoleSpy.mockRestore();
  });
});
