import { test, expect } from "@playwright/test";
import { SettingsPage } from "./pages/settings.page";

test.describe("Settings (authenticated)", () => {
  test("loads settings page with all sections", async ({ page }) => {
    const settings = new SettingsPage(page);
    await settings.goto();

    await expect(settings.profileForm).toBeVisible({ timeout: 15_000 });
    await expect(settings.connectionsManager).toBeVisible();
    await expect(settings.apiKeysSection).toBeVisible();
    await expect(settings.exportSection).toBeVisible();
    await expect(settings.deleteAccountButton).toBeVisible();
  });

  test("can update display name", async ({ page }) => {
    const settings = new SettingsPage(page);
    await settings.goto();

    await expect(settings.profileForm).toBeVisible({ timeout: 15_000 });

    const nameInput = settings.profileForm.getByRole("textbox");
    await nameInput.clear();
    await nameInput.fill("E2E Updated Name");
    await settings.saveProfileButton.click();

    // Expect success toast
    await expect(page.getByText(/saved|updated/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});
