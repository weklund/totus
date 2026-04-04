import { test as setup, expect } from "@playwright/test";

/**
 * Global auth setup — signs in via mock auth and saves storageState.
 *
 * All subsequent tests reuse this session so they start authenticated
 * on the dashboard without repeating the sign-in flow.
 */

const TEST_EMAIL = "e2e-test@totus.dev";
const TEST_PASSWORD = "test-password-123";

setup("authenticate", async ({ page }) => {
  // Go to sign-in page
  await page.goto("/sign-in");

  // Fill mock auth form
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for redirect to dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  // Save auth state for reuse
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
