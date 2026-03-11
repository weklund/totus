"use client";

import Link from "next/link";
import { useViewContext } from "@/lib/view-context";

/**
 * ViewerHeader — header bar for the viewer page.
 *
 * Shows Totus logo, "Shared by [owner_display_name]", and optional note.
 *
 * See: /docs/web-ui-lld.md Section 7.8
 */
export function ViewerHeader() {
  const { ownerDisplayName, note } = useViewContext();

  return (
    <header
      className="flex min-h-14 items-center justify-between border-b px-6 py-3"
      data-testid="viewer-header"
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-bold">
            Totus
          </Link>
          <span className="text-muted-foreground text-sm">
            Shared by {ownerDisplayName ?? "Unknown"}
          </span>
        </div>
        {note && <p className="text-muted-foreground text-xs italic">{note}</p>}
      </div>
    </header>
  );
}
