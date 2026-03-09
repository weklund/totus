"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareFilters } from "@/components/share/ShareFilters";
import { ShareList } from "@/components/share/ShareList";

/**
 * Share Management page — lists and manages share grants.
 *
 * Allows filtering by status (All, Active, Expired, Revoked),
 * revoking active shares, and deleting expired/revoked shares.
 */
export default function ShareManagementPage() {
  const [status, setStatus] = useState("all");

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Shared Links</h2>
          <p className="text-muted-foreground text-sm">
            Manage your shared health data links.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/share/new">
            <Plus className="size-4" />
            Create New Share
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <ShareFilters status={status} onStatusChange={setStatus} />

      {/* Share list */}
      <ShareList status={status} />
    </div>
  );
}
