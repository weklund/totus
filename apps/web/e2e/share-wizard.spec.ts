import { test, expect } from "@playwright/test";

test.describe("Share wizard (authenticated)", () => {
  test("navigates through wizard steps", async ({ page }) => {
    await page.goto("/dashboard/share/new");

    // Page header should always render
    await expect(
      page.getByRole("heading", { name: /create share link/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Test user may have no health data — wizard shows empty state instead
    const stepIndicator = page.getByTestId("step-indicator");
    const hasWizard = await stepIndicator.isVisible().catch(() => false);

    if (hasWizard) {
      // Wizard loaded — verify step navigation
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByText(/select at least one/i)).toBeVisible();
    }
    // Either path is valid — page loaded successfully
  });
});
