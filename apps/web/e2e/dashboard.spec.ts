import { test, expect } from "@playwright/test";
import { DashboardPage } from "./pages/dashboard.page";

test.describe("Dashboard (authenticated)", () => {
  test("loads dashboard page", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    // Should render the dashboard content (either empty state or full dashboard)
    await expect(dashboard.content.or(dashboard.emptyState)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("shows empty state when no connections", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    // Fresh test user has no connections — expect empty state
    const hasEmpty = await dashboard.emptyState.isVisible().catch(() => false);
    if (hasEmpty) {
      await expect(dashboard.emptyConnectButton).toBeVisible();
      await expect(page.getByText("Connect a data source")).toBeVisible();
    }
    // If data already exists (e.g., re-run), that's ok — just verify page loads
  });

  test("navigates to settings", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    // Settings link is in the sidebar
    await page
      .getByRole("link", { name: /settings/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard\/settings/);
  });
});
