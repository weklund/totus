/**
 * Formatting utilities for human-readable display.
 *
 * See: /docs/web-ui-lld.md Section 7.6 for audit event formatting.
 */

import type { AuditEvent } from "@/hooks/useAuditLog";

/**
 * Format an audit event into a human-readable description string.
 *
 * This duplicates the server-side `describeEvent` logic, but the server
 * also returns `description` pre-computed. This utility is provided
 * for client-side usage if needed.
 */
export function formatAuditEvent(event: AuditEvent): string {
  const detail = event.resource_detail as Record<string, unknown> | null;

  switch (event.event_type) {
    case "data.viewed": {
      const metrics = detail?.metrics as string[] | undefined;
      if (event.actor_type === "viewer") {
        return `Viewer via shared link viewed ${metrics?.join(", ") ?? "data"}`;
      }
      return `You viewed ${metrics?.join(", ") ?? "data"}`;
    }
    case "share.created": {
      const label = detail?.label as string | undefined;
      return label
        ? `You created share "${label}"`
        : "You created a new share link";
    }
    case "share.revoked": {
      const label = detail?.label as string | undefined;
      return label
        ? `You revoked share "${label}"`
        : "You revoked a share link";
    }
    case "share.viewed":
      return "Viewer opened share link";
    case "share.deleted": {
      const label = detail?.label as string | undefined;
      return label
        ? `You deleted share "${label}"`
        : "You deleted a share link";
    }
    case "data.imported": {
      const points = detail?.data_points as number | undefined;
      const source = detail?.source as string | undefined;
      return `Imported ${points ?? 0} data points from ${source ?? "unknown"}`;
    }
    case "data.exported":
      return "You exported all data";
    case "data.synced":
      return "Synced health data from Oura";
    case "account.connected": {
      const provider = detail?.provider as string | undefined;
      return `Connected ${provider ?? "data source"}`;
    }
    case "account.disconnected": {
      const provider = detail?.provider as string | undefined;
      return `Disconnected ${provider ?? "data source"}`;
    }
    case "account.settings": {
      const field = detail?.field as string | undefined;
      if (field === "display_name") {
        return `Updated display name to "${detail?.new_value}"`;
      }
      return "Updated account settings";
    }
    case "account.deleted":
      return "Account deleted";
    default:
      return event.event_type.replace(/\./g, " ");
  }
}
