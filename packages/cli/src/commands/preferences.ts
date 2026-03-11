/**
 * Preferences commands: list, set, delete
 *
 * See: LLD Sections 8.5.14-8.5.16
 */

import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { getClient } from "../command-helpers.js";
import { outputData, formatJson } from "../formatters.js";

interface MetricPreference {
  metric_type: string;
  provider: string;
  updated_at?: string;
}

export function createPreferencesCommand(): Command {
  const preferences = new Command("preferences").description(
    "Manage metric source preferences",
  );

  preferences
    .command("list")
    .description("List source preferences per metric")
    .action(async (_opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.get<
        MetricPreference[] | { preferences: MetricPreference[] }
      >("/api/metric-preferences");
      const prefs = Array.isArray(response.data)
        ? response.data
        : Array.isArray((response.data as { preferences: MetricPreference[] })?.preferences)
          ? (response.data as { preferences: MetricPreference[] }).preferences
          : [];

      if (prefs.length === 0) {
        if (resolved.outputFormat === "json") {
          process.stdout.write(formatJson({ preferences: [] }) + "\n");
          return;
        }
        process.stdout.write(
          "\nNo source preferences set. Totus uses auto-resolution (most recent data wins).\n" +
            'Run "totus preferences set <metric_type> <source>" to pin a metric to a specific provider.\n\n',
        );
        return;
      }

      const rows = prefs.map((p) => ({
        metric_type: p.metric_type,
        source: p.provider,
        since: p.updated_at
          ? new Date(p.updated_at).toISOString().replace("T", " ").slice(0, 19)
          : "",
      }));

      const output = outputData(resolved.outputFormat, {
        columns: [
          { header: "Metric Type", key: "metric_type" },
          { header: "Preferred Source", key: "source" },
          { header: "Since", key: "since" },
        ],
        rows,
        jsonData: { preferences: prefs },
      });
      process.stdout.write(output + "\n");
    });

  preferences
    .command("set")
    .description("Set preferred source for a metric")
    .argument("<metric_type>", "Metric type ID (e.g. hrv)")
    .argument("<source>", "Provider ID (e.g. oura, whoop)")
    .action(async (metricType, source, _opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.put<MetricPreference>(
        `/api/metric-preferences/${metricType}`,
        { provider: source },
      );

      if (resolved.outputFormat === "json") {
        process.stdout.write(formatJson(response.data) + "\n");
        return;
      }

      process.stdout.write(
        chalk.green(`\n✓ Preference set: ${metricType} → ${source}\n`),
      );
      process.stdout.write(
        `  Totus will now use ${source} as the source for ${metricType} data.\n`,
      );
      process.stdout.write(
        `  Run "totus metrics get --from ... --to ... ${metricType}" to verify.\n\n`,
      );
    });

  preferences
    .command("delete")
    .description("Remove preference, revert to auto-resolution")
    .argument("<metric_type>", "Metric type ID (e.g. hrv)")
    .action(async (metricType, _opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      await client.delete(`/api/metric-preferences/${metricType}`);

      if (resolved.outputFormat === "json") {
        process.stdout.write(
          formatJson({
            metric_type: metricType,
            preference: "cleared",
          }) + "\n",
        );
        return;
      }

      process.stdout.write(
        chalk.green(`\n✓ Preference cleared: ${metricType}\n`),
      );
      process.stdout.write(
        `  Totus will now use auto-resolution for ${metricType} (most recent data source wins).\n\n`,
      );
    });

  return preferences;
}
