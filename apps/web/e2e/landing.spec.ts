import { test, expect } from "@playwright/test";
import { LandingPage } from "./pages/landing.page";

test.describe("Landing page", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // unauthenticated

  test("renders hero with headline and CTAs", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(landing.headline).toBeVisible();
    await expect(landing.getStartedButton).toBeVisible();
    await expect(landing.signInButton).toBeVisible();
  });

  test("renders product demo steps", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(page.getByText("Unify your data")).toBeVisible();
    await expect(page.getByText("Share on your terms")).toBeVisible();
    await expect(page.getByText("We never touch your data")).toBeVisible();
  });

  test("Get Started navigates to sign-up", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await landing.getStartedButton.click();
    await expect(page).toHaveURL(/\/sign-up/);
  });
});
