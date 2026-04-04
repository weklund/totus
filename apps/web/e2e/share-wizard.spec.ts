import { test, expect } from "@playwright/test";

test.describe("Share wizard (authenticated)", () => {
  test("navigates through wizard steps", async ({ page }) => {
    await page.goto("/dashboard/share/new");

    // Step 1: Metrics — step indicator should be visible
    await expect(page.getByTestId("step-indicator")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Step 1 of 4")).toBeVisible();

    // Try clicking Next without selecting metrics — should show validation error
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/select at least one/i)).toBeVisible();
  });
});
