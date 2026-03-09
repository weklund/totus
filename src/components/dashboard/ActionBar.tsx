"use client";

import Link from "next/link";
import { Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewContext } from "@/lib/view-context";

/**
 * ActionBar — "Share Data" and "Export" buttons, visible only for owners.
 */
export function ActionBar() {
  const { role } = useViewContext();

  if (role !== "owner") return null;

  return (
    <div className="flex items-center gap-2" data-testid="action-bar">
      <Button asChild size="sm" className="gap-1.5">
        <Link href="/dashboard/share/new">
          <Share2 className="size-3.5" />
          Share Data
        </Link>
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5">
        <Download className="size-3.5" />
        Export
      </Button>
    </div>
  );
}
