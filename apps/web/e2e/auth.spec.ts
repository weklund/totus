import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // start unauthenticated

  test("sign up and redirect to dashboard", async ({ page }) => {
    await page.goto("/sign-up");

    await page.getByLabel("Display Name").fill("E2E Signup User");
    await page.getByLabel("Email").fill(`e2e-signup-${Date.now()}@totus.dev`);
    await page.getByLabel("Password").fill("test-password-123");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("sign in and redirect to dashboard", async ({ page }) => {
    await page.goto("/sign-in");

    await page.getByLabel("Email").fill("e2e-test@totus.dev");
    await page.getByLabel("Password").fill("test-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("unauthenticated user is redirected from dashboard to sign-in", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
  });
});
