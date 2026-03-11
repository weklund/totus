"use client";

import Link from "next/link";

/**
 * ShareExpiredPage — displayed when a share link is invalid, expired, or revoked.
 *
 * Shows a clean centered card with no information leakage about why
 * the token is invalid. No sign-in CTA.
 *
 * See: /docs/web-ui-lld.md Section 7.8
 */
export function ShareExpiredPage() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        {/* Totus logo */}
        <Link href="/" className="inline-block text-2xl font-bold">
          Totus
        </Link>

        <div className="bg-card rounded-lg border p-8 shadow-sm">
          <h1 className="text-foreground text-xl font-semibold">
            This link is no longer available
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
            It may have expired, been revoked, or never existed. If you believe
            this is an error, contact the person who shared it.
          </p>
        </div>
      </div>
    </div>
  );
}
