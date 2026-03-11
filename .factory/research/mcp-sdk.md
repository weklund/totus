# MCP TypeScript SDK Research

## Package

- `@modelcontextprotocol/sdk@^1.27.0` (v1.x stable, v2 is pre-alpha)
- Requires `zod@^3.25.0` (project has zod 4.3.6 which is compatible)

## Server Setup

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "totus-health", version: "1.0.0" });
```

## Tool Definition

```ts
server.registerTool(
  "get_health_data",
  {
    description: "Query health metrics",
    inputSchema: {
      metrics: z.array(z.string()).min(1).describe("Metric IDs"),
      start_date: z.string().describe("YYYY-MM-DD"),
    },
  },
  async ({ metrics, start_date }) => {
    return { content: [{ type: "text", text: result }] };
  },
);
```

Note: inputSchema is object of Zod schemas, NOT z.object().

## Resource Definition

```ts
server.registerResource(
  "profile",
  "totus://profile",
  { mimeType: "application/json" },
  async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(data) }],
  }),
);
```

## Prompt Definition

```ts
server.registerPrompt(
  "analyze-sleep",
  {
    description: "Analyze sleep trends",
    argsSchema: { period: z.enum(["7d", "30d", "90d"]) },
  },
  ({ period }) => ({
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: `...` },
      },
    ],
  }),
);
```

## Error Handling

Return { content: [...], isError: true } — never throw from tool handlers.

## stdio Transport

```ts
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Server running"); // NEVER use console.log in stdio mode
```

## Claude Desktop Config

```json
{
  "mcpServers": {
    "totus-health": {
      "command": "totus",
      "args": ["mcp-server"],
      "env": { "TOTUS_API_KEY": "..." }
    }
  }
}
```

## Key Gotchas

1. NEVER console.log() in stdio servers - corrupts JSON-RPC
2. .js extension required in imports for v1.x
3. inputSchema is object of Zod schemas, not z.object()
4. Tool handlers should never throw, return isError: true instead
5. Use `as const` for role and type in prompt messages
