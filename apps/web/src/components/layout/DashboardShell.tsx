"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Share2,
  ScrollText,
  Settings,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useViewContext } from "@/lib/view-context";
import { Header } from "./Header";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Shared Links", href: "/dashboard/share", icon: Share2 },
  { label: "Activity Log", href: "/dashboard/audit", icon: ScrollText },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
] as const;

interface DashboardShellProps {
  displayName?: string;
  children: React.ReactNode;
}

export function DashboardShell({ displayName, children }: DashboardShellProps) {
  const { role } = useViewContext();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const showSidebar = role === "owner";

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      {showSidebar && (
        <aside className="bg-sidebar text-sidebar-foreground hidden w-64 flex-col border-r lg:flex">
          <div className="flex h-14 items-center border-b px-6">
            <Link href="/dashboard" className="text-lg font-bold">
              Totus
            </Link>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard" ||
                    pathname === "/dashboard/night" ||
                    pathname === "/dashboard/recovery" ||
                    pathname === "/dashboard/trend"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col">
        {/* Mobile sidebar trigger + header */}
        <div className="flex items-center">
          {showSidebar && (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-2 lg:hidden"
                  aria-label="Open navigation menu"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="flex h-14 items-center border-b px-6">
                  <Link
                    href="/dashboard"
                    className="text-lg font-bold"
                    onClick={() => setMobileOpen(false)}
                  >
                    Totus
                  </Link>
                </div>
                <nav className="space-y-1 px-3 py-4">
                  {NAV_ITEMS.map((item) => {
                    const isActive =
                      item.href === "/dashboard"
                        ? pathname === "/dashboard" ||
                          pathname === "/dashboard/night" ||
                          pathname === "/dashboard/recovery" ||
                          pathname === "/dashboard/trend"
                        : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <item.icon className="size-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </SheetContent>
            </Sheet>
          )}
          <div className="flex-1">
            <Header displayName={displayName} />
          </div>
        </div>

        {/* Page content */}
        <main className="max-w-screen flex-1 overflow-x-hidden overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
