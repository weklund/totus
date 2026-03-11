/**
 * integration/partition.ensure
 *
 * Cron job that runs on the 1st of every month.
 * Creates monthly partitions for health_data_series at least 3 months ahead.
 * Prevents INSERT failures when data arrives for a month without a partition.
 *
 * See: /docs/integrations-pipeline-lld.md §7.1
 */

import { sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";

export const partitionEnsure = inngest.createFunction(
  {
    id: "integration/partition.ensure",
    name: "Ensure Series Partitions",
    retries: 3,
  },
  { cron: "0 0 1 * *" },
  async ({ step }) => {
    const created = await step.run("create-future-partitions", async () => {
      const now = new Date();
      const partitionsCreated: string[] = [];

      // Ensure partitions exist for the next 3 months
      for (let i = 0; i <= 3; i++) {
        const target = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const year = target.getFullYear();
        const month = String(target.getMonth() + 1).padStart(2, "0");

        const nextTarget = new Date(
          target.getFullYear(),
          target.getMonth() + 1,
          1,
        );
        const nextYear = nextTarget.getFullYear();
        const nextMonth = String(nextTarget.getMonth() + 1).padStart(2, "0");

        const partitionName = `health_data_series_${year}_${month}`;
        const startDate = `${year}-${month}-01`;
        const endDate = `${nextYear}-${nextMonth}-01`;

        // CREATE IF NOT EXISTS equivalent via DO block
        await db.execute(
          sql.raw(`
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_class WHERE relname = '${partitionName}'
              ) THEN
                EXECUTE format(
                  'CREATE TABLE %I PARTITION OF health_data_series FOR VALUES FROM (%L) TO (%L)',
                  '${partitionName}', '${startDate}', '${endDate}'
                );
              END IF;
            END $$;
          `),
        );

        partitionsCreated.push(partitionName);
      }

      return partitionsCreated;
    });

    return { partitionsChecked: created };
  },
);
