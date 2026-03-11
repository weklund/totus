/**
 * Audit commands: list
 *
 * See: LLD Section 8.5.9
 */

import { Command } from "@commander-js/extra-typings";
import { getClient } from "../command-helpers.js";
import { outputData } from "../formatters.js";

interface AuditEvent {
  id: string;
  event_type: string;
  actor_type: string;
  actor_id?: string;
  resource_type?: string;
  resource_id?: string;
  resource_detail?: Record<string, unknown>;
  created_at: string;
  ip_address?: string;
}

export function createAuditCommand(): Command {
  const audit = new Command("audit").description("View audit log");

  audit
    .command("list")
    .description("Query audit log")
    .option("--event-type <type>", "Filter by event type")
    .option("--grant-id <id>", "Filter by share grant")
    .option(
      "--actor-type <type>",
      "Filter by actor type (owner, viewer, system, api_key)",
    )
    .option("--start <date>", "Start of time range (YYYY-MM-DD)")
    .option("--end <date>", "End of time range (YYYY-MM-DD)")
    .option("--limit <n>", "Results per page", "50")
    .action(async (opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const query: Record<string, string | number | boolean | undefined> = {
        limit: parseInt(opts.limit, 10),
      };
      if (opts.eventType) query.event_type = opts.eventType;
      if (opts.grantId) query.grant_id = opts.grantId;
      if (opts.actorType) query.actor_type = opts.actorType;
      if (opts.start) query.start = opts.start;
      if (opts.end) query.end = opts.end;

      const response = await client.get<AuditEvent[]>("/api/audit", query);
      const events = Array.isArray(response.data) ? response.data : [];

      const rows = events.map((e) => {
        // Build a human-readable detail string
        let detail = "";
        if (e.resource_detail) {
          const rd = e.resource_detail;
          if (rd.api_key_name) detail = String(rd.api_key_name);
          else if (rd.metrics)
            detail = Array.isArray(rd.metrics)
              ? (rd.metrics as string[]).join(", ")
              : String(rd.metrics);
          else if (rd.label) detail = String(rd.label);
        }

        return {
          timestamp: e.created_at
            ? new Date(e.created_at).toISOString().replace("T", " ").slice(0, 19)
            : "",
          actor: e.actor_type ?? "",
          event: e.event_type ?? "",
          detail,
        };
      });

      const output = outputData(resolved.outputFormat, {
        columns: [
          { header: "Timestamp", key: "timestamp" },
          { header: "Actor", key: "actor" },
          { header: "Event", key: "event" },
          { header: "Detail", key: "detail" },
        ],
        rows,
        jsonData: { events },
      });
      process.stdout.write(output + "\n");
    });

  return audit;
}
