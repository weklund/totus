/**
 * Metrics commands: list, get, summary
 *
 * See: LLD Sections 8.5.3-8.5.5
 */

import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { getClient } from "../command-helpers.js";
import { outputData, formatJson } from "../formatters.js";

interface MetricType {
  metric_type: string;
  label: string;
  unit: string;
  category: string;
  source?: string;
  sources?: Array<{
    provider: string;
    data_points?: number;
    date_range?: { start: string; end: string };
  }>;
  data_points?: number;
  date_range?: { start: string; end: string };
}

interface HealthDataPoint {
  date: string;
  value: number;
  source?: string;
}

interface HealthDataResponse {
  metrics: Record<
    string,
    {
      unit: string;
      label?: string;
      points: HealthDataPoint[];
    }
  >;
  query?: {
    start: string;
    end: string;
    resolution: string;
    source: string | null;
  };
}

interface ShareGrant {
  id: string;
  status: string;
}

export function createMetricsCommand(): Command {
  const metrics = new Command("metrics").description(
    "Query and list health metrics",
  );

  metrics
    .command("list")
    .description("List available metric types")
    .option("--category <cat>", "Filter by category")
    .option(
      "--all-sources",
      "Show one row per (metric, source) combination",
    )
    .action(async (opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const query: Record<string, string | number | boolean | undefined> = {};
      if (opts.category) query.category = opts.category;

      const response = await client.get<MetricType[]>(
        "/api/health-data/types",
        query,
      );

      const metricTypes = response.data;

      if (opts.allSources) {
        // Expand: one row per (metric_type, source)
        const rows: Record<string, unknown>[] = [];
        for (const m of metricTypes) {
          if (m.sources && m.sources.length > 0) {
            for (const s of m.sources) {
              rows.push({
                metric_type: m.metric_type,
                label: m.label,
                unit: m.unit,
                category: m.category,
                source: s.provider,
                data_points: s.data_points ?? "",
                date_range: s.date_range
                  ? `${s.date_range.start} → ${s.date_range.end}`
                  : "",
              });
            }
          } else {
            rows.push({
              metric_type: m.metric_type,
              label: m.label,
              unit: m.unit,
              category: m.category,
              source: m.source ?? "",
              data_points: m.data_points ?? "",
              date_range: m.date_range
                ? `${m.date_range.start} → ${m.date_range.end}`
                : "",
            });
          }
        }

        const output = outputData(resolved.outputFormat, {
          columns: [
            { header: "Metric Type", key: "metric_type" },
            { header: "Label", key: "label" },
            { header: "Unit", key: "unit" },
            { header: "Category", key: "category" },
            { header: "Source", key: "source" },
            { header: "Data Points", key: "data_points" },
            { header: "Date Range", key: "date_range" },
          ],
          rows,
          jsonData: { metrics: metricTypes },
        });
        process.stdout.write(output + "\n");
      } else {
        // Default: one row per metric_type
        const rows = metricTypes.map((m) => ({
          metric_type: m.metric_type,
          label: m.label,
          unit: m.unit,
          category: m.category,
          source: m.source ?? "",
          sources: m.sources ? String(m.sources.length) : "1",
          data_points: m.data_points ?? "",
          date_range: m.date_range
            ? `${m.date_range.start} → ${m.date_range.end}`
            : "",
        }));

        const output = outputData(resolved.outputFormat, {
          columns: [
            { header: "Metric Type", key: "metric_type" },
            { header: "Label", key: "label" },
            { header: "Unit", key: "unit" },
            { header: "Category", key: "category" },
            { header: "Source", key: "source" },
            { header: "Sources", key: "sources" },
            { header: "Data Points", key: "data_points" },
            { header: "Date Range", key: "date_range" },
          ],
          rows,
          jsonData: { metrics: metricTypes },
        });
        process.stdout.write(output + "\n");
      }
    });

  metrics
    .command("get")
    .description("Query health data for specific metrics")
    .argument("<metric>", "Metric type to query (e.g. sleep_score)")
    .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
    .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
    .option(
      "--resolution <res>",
      "Aggregation: daily, weekly, monthly",
      "daily",
    )
    .option("--source <provider>", "Filter to specific provider")
    .action(async (metric, opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const query: Record<string, string | number | boolean | undefined> = {
        metrics: metric,
        start: opts.from,
        end: opts.to,
        resolution: opts.resolution,
      };
      if (opts.source) query.source = opts.source;

      const response = await client.get<HealthDataResponse>(
        "/api/health-data",
        query,
      );

      const data = response.data;

      if (resolved.outputFormat === "json") {
        process.stdout.write(
          formatJson({
            metrics: data.metrics ?? data,
            query: data.query ?? {
              start: opts.from,
              end: opts.to,
              resolution: opts.resolution,
              source: opts.source ?? null,
            },
          }) + "\n",
        );
        return;
      }

      // Table or CSV output: display each metric as a separate table
      const metricsData = data.metrics ?? { [metric]: data };

      for (const [metricKey, metricData] of Object.entries(metricsData)) {
        const points = (metricData as { unit?: string; points?: HealthDataPoint[] }).points ?? [];
        const unit = (metricData as { unit?: string }).unit ?? "";

        if (resolved.outputFormat === "table") {
          process.stdout.write(
            chalk.bold(`\n${metricKey}`) + (unit ? ` (${unit})` : "") + "\n",
          );
        }

        const rows = points.map((p) => ({
          date: p.date,
          value: String(p.value),
          source: p.source ?? "",
        }));

        const output = outputData(resolved.outputFormat, {
          columns: [
            { header: "Date", key: "date" },
            { header: "Value", key: "value" },
            { header: "Source", key: "source" },
          ],
          rows,
        });
        process.stdout.write(output + "\n");
      }
    });

  metrics
    .command("summary")
    .description("Show summary statistics for health data")
    .option("--detailed", "Show per-source breakdown")
    .action(async (opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      // Fetch metric types to compute summary
      const typesResponse = await client.get<MetricType[]>(
        "/api/health-data/types",
      );
      const metricTypes = typesResponse.data;

      // Also fetch shares count
      let activeShares = 0;
      try {
        const sharesResponse = await client.get<ShareGrant[]>("/api/shares", {
          status: "active",
          limit: 1,
        });
        activeShares = Array.isArray(sharesResponse.data)
          ? sharesResponse.data.length
          : 0;
        // If pagination info is available, use that
        if (sharesResponse.pagination) {
          activeShares = sharesResponse.pagination.has_more
            ? activeShares
            : activeShares;
        }
      } catch {
        // Shares endpoint may not be accessible with current scopes
      }

      // Compute summary from metric types
      const sources = new Set<string>();
      let totalPoints = 0;
      let earliest = "";
      let latest = "";
      const categories = new Map<string, number>();

      for (const m of metricTypes) {
        if (m.source) sources.add(m.source);
        if (m.sources) {
          for (const s of m.sources) {
            sources.add(s.provider);
            if (s.data_points) totalPoints += s.data_points;
            if (s.date_range) {
              if (!earliest || s.date_range.start < earliest)
                earliest = s.date_range.start;
              if (!latest || s.date_range.end > latest)
                latest = s.date_range.end;
            }
          }
        }
        if (m.data_points) totalPoints += m.data_points;
        if (m.date_range) {
          if (!earliest || m.date_range.start < earliest)
            earliest = m.date_range.start;
          if (!latest || m.date_range.end > latest)
            latest = m.date_range.end;
        }
        const cat = m.category || "other";
        categories.set(cat, (categories.get(cat) ?? 0) + 1);
      }

      if (resolved.outputFormat === "json") {
        process.stdout.write(
          formatJson({
            total_data_points: totalPoints,
            connected_sources: Array.from(sources),
            active_shares: activeShares,
            earliest_data: earliest || null,
            latest_data: latest || null,
            metric_count: metricTypes.length,
            categories: Object.fromEntries(categories),
          }) + "\n",
        );
        return;
      }

      // Table/text output
      process.stdout.write(chalk.bold("\nHealth Data Summary\n"));
      process.stdout.write(
        `  Total data points:    ${totalPoints.toLocaleString()}\n`,
      );
      process.stdout.write(
        `  Connected sources:    ${Array.from(sources).join(", ") || "none"}\n`,
      );
      process.stdout.write(`  Active shares:        ${activeShares}\n`);
      process.stdout.write(
        `  Earliest data:        ${earliest || "none"}\n`,
      );
      process.stdout.write(`  Latest data:          ${latest || "none"}\n`);
      process.stdout.write("\n");

      process.stdout.write(
        `  Metrics:              ${metricTypes.length} types across ${categories.size} categories\n`,
      );
      const catLine = Array.from(categories.entries())
        .map(([cat, count]) => `${cat} (${count})`)
        .join("    ");
      process.stdout.write(`    ${catLine}\n`);

      if (opts.detailed) {
        // Per-source breakdown
        const sourceMap = new Map<
          string,
          { metrics: number; points: number; earliest: string; latest: string }
        >();

        for (const m of metricTypes) {
          if (m.sources) {
            for (const s of m.sources) {
              const entry = sourceMap.get(s.provider) ?? {
                metrics: 0,
                points: 0,
                earliest: "",
                latest: "",
              };
              entry.metrics++;
              if (s.data_points) entry.points += s.data_points;
              if (s.date_range) {
                if (!entry.earliest || s.date_range.start < entry.earliest)
                  entry.earliest = s.date_range.start;
                if (!entry.latest || s.date_range.end > entry.latest)
                  entry.latest = s.date_range.end;
              }
              sourceMap.set(s.provider, entry);
            }
          } else if (m.source) {
            const entry = sourceMap.get(m.source) ?? {
              metrics: 0,
              points: 0,
              earliest: "",
              latest: "",
            };
            entry.metrics++;
            if (m.data_points) entry.points += m.data_points;
            if (m.date_range) {
              if (!entry.earliest || m.date_range.start < entry.earliest)
                entry.earliest = m.date_range.start;
              if (!entry.latest || m.date_range.end > entry.latest)
                entry.latest = m.date_range.end;
            }
            sourceMap.set(m.source, entry);
          }
        }

        process.stdout.write("\n  By source:\n");
        for (const [source, info] of sourceMap.entries()) {
          process.stdout.write(
            `    ${source.padEnd(12)} ${String(info.metrics).padStart(2)} metrics    ${info.points.toLocaleString().padStart(8)} points    ${info.earliest} → ${info.latest}\n`,
          );
        }
      }

      process.stdout.write("\n");
    });

  return metrics;
}
