/**
 * /api/inngest — Inngest route handler
 *
 * Serves all Inngest functions to the Inngest Dev Server (or cloud).
 * Responds to introspection requests (GET) and function execution (POST/PUT).
 *
 * See: /docs/integrations-pipeline-lld.md §7
 */

import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  syncSweep,
  syncConnection,
  syncInitial,
  syncManual,
  tokenRefresh,
  partitionEnsure,
  baselinesRefresh,
  baselinesRefreshUser,
} from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncSweep,
    syncConnection,
    syncInitial,
    syncManual,
    tokenRefresh,
    partitionEnsure,
    baselinesRefresh,
    baselinesRefreshUser,
  ],
});
