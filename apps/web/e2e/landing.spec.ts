import { test, expect } from "@playwright/test";
import { LandingPage } from "./pages/landing.page";

test.describe("Landing page", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // unauthenticated

  test("renders hero with headline and CTAs", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(landing.headline).toContainText("Health Data Vault");
    await expect(landing.getStartedButton).toBeVisible();
    await expect(landing.signInButton).toBeVisible();
  });

  test("renders feature cards", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(page.getByText("Interactive Dashboard")).toBeVisible();
    await expect(page.getByText("Secure Sharing")).toBeVisible();
    await expect(page.getByText("Complete Audit Trail")).toBeVisible();
    await expect(page.getByText("You're in Control")).toBeVisible();
  });

  test("Get Started navigates to sign-up", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await landing.getStartedButton.click();
    await expect(page).toHaveURL(/\/sign-up/);
  });
});
