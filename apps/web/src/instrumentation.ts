/**
 * Next.js Instrumentation Hook
 *
 * Runs once on server startup. Used for safety checks and initialization.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export function register() {
  // T-02: Prevent mock auth from running in production.
  // Mock auth accepts ANY password and auto-creates users — catastrophic if deployed.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true"
  ) {
    throw new Error(
      "FATAL: NEXT_PUBLIC_USE_MOCK_AUTH=true is set in a production environment. " +
        "This would allow anyone to authenticate as any user without a password. " +
        "Set NEXT_PUBLIC_USE_MOCK_AUTH=false and configure Clerk credentials for production.",
    );
  }
}
