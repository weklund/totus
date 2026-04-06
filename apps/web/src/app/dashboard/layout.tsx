import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { ensureUser } from "@/lib/auth/ensure-user";
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

  // Ensure user exists in our DB (auto-provisions on first Clerk login)
  const dbUser = await ensureUser(userId);
  const displayName = dbUser.displayName ?? "User";

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
