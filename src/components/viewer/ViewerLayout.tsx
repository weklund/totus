"use client";

import { ViewerHeader } from "./ViewerHeader";
import { ViewerBanner } from "./ViewerBanner";
import { ViewerContent } from "./ViewerContent";

/**
 * ViewerLayout — DashboardShell-like layout but WITHOUT sidebar.
 *
 * Contains ViewerHeader, ViewerBanner, and the chart content area.
 * Used for the /v/[token] viewer page.
 *
 * See: /docs/web-ui-lld.md Section 7.8
 */
export function ViewerLayout() {
  return (
    <div className="flex min-h-screen flex-col" data-testid="viewer-layout">
      <ViewerHeader />
      <main className="flex-1 space-y-6 overflow-y-auto p-6">
        <ViewerBanner />
        <ViewerContent />
      </main>
    </div>
  );
}
