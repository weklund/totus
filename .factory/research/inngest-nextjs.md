# Inngest + Next.js Research

## Package

- `inngest@3.52.6` (v3 stable, v4 is beta - use v3)
- Works with Bun runtime; use `npx --ignore-scripts=false inngest-cli@latest dev` for dev server

## Client Setup

```ts
// src/inngest/client.ts
import { EventSchemas, Inngest } from "inngest";
import { z } from "zod";

export const inngest = new Inngest({
  id: "totus",
  schemas: new EventSchemas().fromSchema({
    "integration/sync.manual": z.object({
      connectionId: z.string(),
      userId: z.string(),
    }),
    "integration/sync.initial": z.object({
      connectionId: z.string(),
      userId: z.string(),
      provider: z.string(),
    }),
    "integration/sync.connection": z.object({ connectionId: z.string() }),
  }),
});
```

## Route Handler (App Router)

```ts
// src/app/api/inngest/route.ts
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
export const { GET, POST, PUT } = serve({ client: inngest, functions: [...] });
```

## Function Patterns

Event-triggered with steps:

```ts
export const syncConnection = inngest.createFunction(
  { id: "sync-connection", retries: 4, concurrency: { limit: 5 } },
  { event: "integration/sync.connection" },
  async ({ event, step }) => {
    const data = await step.run("fetch-data", async () => { ... });
    await step.run("store-data", async () => { ... });
  }
);
```

Cron:

```ts
export const syncSweep = inngest.createFunction(
  { id: "sync-sweep" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    const connections = await step.run("load-connections", ...);
    await step.sendEvent("fan-out", connections.map(c => ({ name: "integration/sync.connection", data: { connectionId: c.id } })));
  }
);
```

## Dev Server

```bash
npx --ignore-scripts=false inngest-cli@latest dev -u http://localhost:3000/api/inngest
# UI at http://localhost:8288
```

## Key Gotchas

1. Code outside step.run() re-executes on every step invocation
2. Return data from step.run(), don't use closure variables
3. Use step.sendEvent() not inngest.send() inside functions
4. Each step.run() needs a unique stable string ID
5. Fan-out: send events, don't loop in one function
