/**
 * Viewer Page — /v/[token]
 *
 * RSC that validates the share token server-side by calling
 * POST /api/viewer/validate internally. If valid, the grant data is
 * passed to a client component (ViewerPageClient) that performs
 * client-side validation to set the browser cookie, then renders
 * the viewer dashboard.
 *
 * If invalid/expired/revoked: renders ShareExpiredPage.
 *
 * See: /docs/web-ui-lld.md Section 7.8
 */

import { ShareExpiredPage } from "@/components/viewer/ShareExpiredPage";
import { ViewerPageClient } from "@/components/viewer/ViewerPageClient";

interface ViewerValidateResponse {
  data: {
    valid: boolean;
    owner_display_name: string;
    label: string;
    note: string | null;
    allowed_metrics: string[];
    data_start: string;
    data_end: string;
    expires_at: string;
  };
}

export default async function ViewerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Step 1: Call validate endpoint server-side to check token validity
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const res = await fetch(`${appUrl}/api/viewer/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });

    if (!res.ok) {
      return <ShareExpiredPage />;
    }

    const body = (await res.json()) as ViewerValidateResponse;
    const grant = body.data;

    if (!grant) {
      return <ShareExpiredPage />;
    }

    // Step 2: Pass token and grant to the client component.
    // The client component will call validate again from the browser
    // to set the httpOnly cookie, then render the viewer dashboard.
    return <ViewerPageClient token={token} serverGrant={grant} />;
  } catch {
    // Network error or JSON parse error — show expired page
    return <ShareExpiredPage />;
  }
}
