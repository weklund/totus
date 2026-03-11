/**
 * Inngest Client
 *
 * Typed event definitions and Inngest client instance for background jobs.
 * All events dispatched through Inngest must be defined here.
 *
 * See: /docs/integrations-pipeline-lld.md §7
 */

import { EventSchemas, Inngest } from "inngest";

/**
 * Event payload for per-connection sync jobs.
 */
interface SyncConnectionData {
  connectionId: string;
  userId: string;
  provider: string;
}

/**
 * Typed event schemas for all Inngest events in the system.
 */
type Events = {
  /** Cron sweep: fan out sync events per active connection */
  "integration/sync.sweep": { data: Record<string, never> };
  /** Per-connection sync: fetch data and upsert into tables */
  "integration/sync.connection": { data: SyncConnectionData };
  /** Historical backfill after initial OAuth connection */
  "integration/sync.initial": { data: SyncConnectionData };
  /** User-triggered manual sync from the dashboard */
  "integration/sync.manual": { data: SyncConnectionData };
  /** Proactive refresh for expiring OAuth tokens */
  "integration/token.refresh": { data: Record<string, never> };
  /** Create future monthly partitions for health_data_series */
  "integration/partition.ensure": { data: Record<string, never> };
};

/**
 * Inngest client instance.
 * Used to create functions and dispatch events.
 */
export const inngest = new Inngest({
  id: "totus",
  schemas: new EventSchemas().fromRecord<Events>(),
});
