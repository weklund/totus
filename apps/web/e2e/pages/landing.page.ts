import type { Page, Locator } from "@playwright/test";

export class LandingPage {
  readonly page: Page;
  readonly headline: Locator;
  readonly getStartedButton: Locator;
  readonly signInButton: Locator;
  readonly featureCards: Locator;
  readonly howItWorksSteps: Locator;
  readonly ctaSection: Locator;

  constructor(page: Page) {
    this.page = page;
    this.headline = page.getByRole("heading", { level: 1 });
    this.getStartedButton = page
      .getByRole("link", { name: "Get Started" })
      .first();
    this.signInButton = page.getByRole("link", { name: "Sign In" }).first();
    this.featureCards = page
      .locator("[class*='card']")
      .filter({ has: page.getByRole("heading", { level: 3 }) });
    this.howItWorksSteps = page.getByText(/^(Connect|Visualize|Share)$/);
    this.ctaSection = page.getByRole("heading", { name: /take control/i });
  }

  async goto() {
    await this.page.goto("/");
  }
}
