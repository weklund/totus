import type { Page, Locator } from "@playwright/test";

export class DashboardPage {
  readonly page: Page;
  readonly content: Locator;
  readonly emptyState: Locator;
  readonly emptyConnectButton: Locator;
  readonly metricSelector: Locator;
  readonly actionBar: Locator;
  readonly connectionBar: Locator;
  readonly settingsLink: Locator;
  readonly shareLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.content = page.getByTestId("dashboard-content");
    this.emptyState = page.getByTestId("empty-dashboard");
    this.emptyConnectButton = page.getByTestId("empty-connect-button");
    this.metricSelector = page.getByTestId("metric-selector");
    this.actionBar = page.getByTestId("action-bar");
    this.connectionBar = page.getByTestId("provider-connection-bar");
    this.settingsLink = page.getByRole("link", { name: /settings/i });
    this.shareLink = page.getByRole("link", { name: /share/i });
  }

  async goto() {
    await this.page.goto("/dashboard");
  }

  metricChip(metric: string) {
    return this.page.getByTestId(`metric-chip-${metric}`);
  }

  connectionPill(provider: string) {
    return this.page.getByTestId(`connection-pill-${provider}`);
  }
}
