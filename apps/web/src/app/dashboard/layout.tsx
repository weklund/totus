import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { ViewContextProvider } from "@/lib/view-context";
import { DashboardShell } from "@/components/layout/DashboardShell";
import type { ViewContextValue } from "@/types/view-context";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Fetch user profile server-side for the display name
  let displayName = "User";
  try {
    const profileRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/user/profile`,
      {
        headers: {
          Cookie: `__session=${await getSessionCookie()}`,
        },
        cache: "no-store",
      },
    );
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      displayName = profileData.data?.display_name ?? "User";
    }
  } catch {
    // Fallback to "User" on error
  }

  const viewContext: ViewContextValue = {
    role: "owner",
    userId,
    permissions: {
      metrics: "all",
      dataStart: null,
      dataEnd: null,
    },
  };

  return (
    <ViewContextProvider value={viewContext}>
      <DashboardShell displayName={displayName}>{children}</DashboardShell>
    </ViewContextProvider>
  );
}

/**
 * Helper to get the session cookie value from the incoming request.
 * Uses Next.js cookies() API.
 */
async function getSessionCookie(): Promise<string> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  return cookieStore.get("__session")?.value ?? "";
}
