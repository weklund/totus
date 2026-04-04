import type { Page, Locator } from "@playwright/test";

export class SettingsPage {
  readonly page: Page;
  readonly profileForm: Locator;
  readonly saveProfileButton: Locator;
  readonly connectionsManager: Locator;
  readonly apiKeysSection: Locator;
  readonly createApiKeyButton: Locator;
  readonly exportSection: Locator;
  readonly deleteAccountButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.profileForm = page.getByTestId("profile-form");
    this.saveProfileButton = page.getByTestId("save-profile-button");
    this.connectionsManager = page.getByTestId("connections-manager");
    this.apiKeysSection = page.getByTestId("api-keys-section");
    this.createApiKeyButton = page.getByTestId("create-api-key-button");
    this.exportSection = page.getByTestId("export-section");
    this.deleteAccountButton = page.getByTestId("delete-account-button");
  }

  async goto() {
    await this.page.goto("/dashboard/settings");
  }
}
