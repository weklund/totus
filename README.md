# Totus

A personal health data platform for quantified-self users. Totus aggregates data from multiple wearable and health providers (Oura fully implemented; Dexcom, Garmin, Whoop, Withings, Cronometer, and Nutrisense stubbed), stores it with envelope encryption, and presents it through an interactive dashboard, a CLI, and an MCP server for AI assistant integration.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Turbopack)
- **Language:** TypeScript 5.8 (strict mode)
- **UI:** React 19, Tailwind CSS v4, shadcn/ui (Radix primitives), Recharts
- **Database:** PostgreSQL 15, Drizzle ORM
- **Auth:** Mock Clerk layer (JWT-based via `jose`), viewer tokens, API keys
- **Background Jobs:** Inngest (provider sync, token refresh, backfill)
- **CLI:** Commander.js 14, `@totus/cli` package
- **MCP Server:** `@modelcontextprotocol/sdk` v1.x (stdio transport)
- **Encryption:** AES-256-GCM envelope encryption (local dev fallback, AWS KMS-ready)
- **Package Manager:** Bun (workspaces)
- **Testing:** Vitest, Testing Library
- **Code Quality:** ESLint 9 (flat config), Prettier, Husky + lint-staged

## Monorepo Structure

```
totus/
  apps/
    web/                # Next.js 15 web application (@totus/web)
  packages/
    cli/                # CLI and MCP server (@totus/cli)
  docker/               # Docker configuration
  docker-compose.yml    # PostgreSQL service
  package.json          # Bun workspace root
```

## Prerequisites

- [Bun](https://bun.sh/) v1.2+
- [Docker](https://www.docker.com/) (for PostgreSQL)
- [Node.js](https://nodejs.org/) v22+ (for npx/Inngest dev server)

## Getting Started

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd totus
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Start PostgreSQL**

   ```bash
   docker compose up -d
   ```

4. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and generate an encryption key:

   ```bash
   openssl rand -hex 32
   ```

   Paste the output as the `ENCRYPTION_KEY` value. The remaining defaults work for local development.

5. **Push the database schema**

   ```bash
   cd apps/web && bun run db:push
   ```

6. **Seed the database** (90 days of synthetic health data)

   ```bash
   cd apps/web && bun run db:seed
   ```

7. **Start the development server**

   ```bash
   cd apps/web && bun run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

8. **(Optional) Start the Inngest dev server** (for background sync jobs)

   ```bash
   npx --ignore-scripts=false inngest-cli@latest dev -u http://localhost:3000/api/inngest
   ```

   Opens on [http://localhost:8288](http://localhost:8288).

## Development

### Root-level commands (run from repo root)

| Command                           | Description                               |
| --------------------------------- | ----------------------------------------- |
| `bun --filter '*' typecheck`      | Typecheck all workspaces                  |
| `bun --filter '*' test`           | Run tests across all workspaces           |
| `bun --filter '*' build`          | Build all workspaces                      |
| `bun --filter '@totus/web' test`  | Run web tests only                        |
| `bun --filter '@totus/cli' test`  | Run CLI tests only                        |
| `bun --filter '@totus/web' lint`  | Lint web app                              |

### Web app commands (run from `apps/web/`)

| Command               | Description                                  |
| --------------------- | -------------------------------------------- |
| `bun run dev`         | Start dev server with Turbopack on port 3000 |
| `bun run build`       | Production build                             |
| `bun run start`       | Start production server                      |
| `bun run lint`        | Run ESLint                                   |
| `bun run typecheck`   | Run TypeScript type checking                 |
| `bun run test`        | Run Vitest test suite                        |
| `bun run test:watch`  | Run Vitest in watch mode                     |
| `bun run format`      | Format code with Prettier                    |
| `bun run db:generate` | Generate Drizzle migrations                  |
| `bun run db:push`     | Push schema changes to the database          |
| `bun run db:seed`     | Seed database with synthetic data            |
| `bun run db:studio`   | Open Drizzle Studio database browser         |

### CLI commands (run from `packages/cli/`)

| Command              | Description              |
| -------------------- | ------------------------ |
| `bun run build`      | Compile TypeScript       |
| `bun run typecheck`  | Run TypeScript type checking |
| `bun run test`       | Run Vitest test suite    |
| `bun run test:watch` | Run Vitest in watch mode |

## CLI

The `@totus/cli` package provides command-line access to Totus. It authenticates via API keys.

### Running

```bash
# From packages/cli (development)
bun run src/index.ts <command>

# Or after building
bun run dist/index.ts <command>
```

### Commands

| Command        | Description                                      |
| -------------- | ------------------------------------------------ |
| `auth`         | Login, logout, status, and token management      |
| `metrics`      | List, get, and summarize health metrics           |
| `shares`       | List, get, create, and revoke share links         |
| `connections`  | List provider connections and trigger sync         |
| `preferences`  | List, set, and delete metric source preferences   |
| `keys`         | List, create, and revoke API keys                 |
| `profile`      | View user profile                                 |
| `export`       | Export health data (JSON)                          |
| `audit`        | View audit log                                    |
| `config`       | Get and set CLI configuration                     |
| `mcp-server`   | Start the MCP server (stdio transport)            |

### Configuration

The CLI resolves API keys in this order:
1. `--api-key` flag
2. `TOTUS_API_KEY` environment variable
3. Config file at `~/.config/totus/config.json`

Output formats: `table` (default for TTY), `json` (default for pipes), `csv`.

## MCP Server

Totus includes an MCP (Model Context Protocol) server for AI assistant integration, exposing health data via stdio transport.

### Starting

```bash
# From packages/cli
bun run src/index.ts mcp-server
```

### Capabilities

- **12 Tools:** `get_health_data`, `list_available_metrics`, `create_share`, `list_shares`, `revoke_share`, `get_audit_log`, `get_profile`, `trigger_sync`, `list_connections`, `list_metric_preference`, `set_metric_preference`, `delete_metric_preference`
- **3 Resources:** `totus://metrics`, `totus://profile`, `totus://shares`
- **4 Prompts:** `analyze_sleep`, `compare_metrics`, `prepare_share`, `health_summary`

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "totus": {
      "command": "bun",
      "args": ["run", "/path/to/totus/packages/cli/src/index.ts", "mcp-server"],
      "env": {
        "TOTUS_API_KEY": "tot_live_your_api_key_here",
        "TOTUS_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## API Keys

API keys provide programmatic access for the CLI and MCP server. Keys use the `tot_live_` prefix.

**Create via Web UI:** Settings → API Keys → Create Key (select scopes and expiration).

**Create via CLI:**
```bash
bun run src/index.ts keys create --name "my-key" --scopes read,write
```

Keys support scope-based access control and are rate-limited (300 req/min general, 60/min reads, 10/min writes).

## Project Structure

```
apps/web/src/
  app/                  # Next.js App Router pages and API routes
    api/                # REST API route handlers
      auth/             #   Auth endpoints
      connections/      #   Provider connection management (generic, multi-provider)
      health/           #   Health check
      health-data/      #   Health data query (daily, series, periods)
      inngest/          #   Inngest webhook handler
      keys/             #   API key CRUD
      metric-preferences/ # Metric source preferences
      shares/           #   Share link CRUD
      user/             #   Profile, export, account deletion
      viewer/           #   Viewer token validation
    dashboard/          # Dashboard pages
    v/                  # Public viewer pages
  components/           # React components
  config/               # Metric type registry and provider config
  db/                   # Drizzle schema, connection pool, seed script
  hooks/                # React Query hooks
  lib/                  # Shared utilities (services, auth, encryption, providers)
  types/                # TypeScript type definitions

packages/cli/src/
  commands/             # CLI command modules
  api-client.ts         # HTTP client with API key auth
  config.ts             # CLI config file management
  formatters.ts         # Output formatters (table, json, csv)
  mcp-server.ts         # MCP server implementation
  index.ts              # CLI entry point
```

## Key Features

- **Multi-Provider Health Data** -- Supports multiple health data providers. Oura is fully implemented; Dexcom, Garmin, Whoop, Withings, Cronometer, and Nutrisense are stubbed with adapter interfaces ready for implementation.
- **Three Data Types** -- Daily summaries, time-series data (e.g., continuous glucose), and period/duration events (e.g., sleep stages, workouts).
- **Interactive Dashboard** -- Time-series charts, intraday charts, period timelines, source badges, and multi-provider connection management. Dark mode support.
- **CLI & MCP Server** -- Full command-line interface and MCP server for AI assistant integration (see sections above).
- **API Key Authentication** -- Scoped API keys with rate limiting for programmatic access alongside session and viewer token auth.
- **Encrypted Health Data** -- AES-256-GCM envelope encryption at rest. Per-user data encryption keys with a provider interface ready for AWS KMS.
- **Background Sync** -- Inngest-powered background jobs for provider data sync, token refresh, initial backfill, and partition management.
- **Share Links** -- Time-limited, read-only share URLs with configurable expiration and metric scoping.
- **Audit Logging** -- Immutable append-only audit log tracking all data access, share creation, API key usage, and account actions.
- **Metric Source Preferences** -- Per-metric source selection when multiple providers supply the same metric type.

## Architecture Overview

- **Multi-Provider System** -- Generic provider adapter interface with a provider registry. Each provider implements `authorize()`, `callback()`, `syncData()`, and `refreshToken()`. Only Oura is fully implemented; others are stub adapters ready for development.
- **Inngest Background Jobs** -- Scheduled and event-driven jobs handle provider data sync (sweep, per-connection sync, initial backfill, token refresh, manual sync trigger, partition management).
- **Three Auth Methods** -- Session cookies (web UI), viewer JWTs (share links), and API keys (CLI/MCP). API keys use `tot_live_` prefix with scope enforcement and rate limiting.
- **Next.js App Router** -- Server components and route handlers. API routes follow RESTful conventions with a standard error envelope.
- **Envelope Encryption** -- Health data is encrypted with per-user DEKs wrapped by a KEK. Local dev uses a static key; production uses AWS KMS.
- **Cursor Pagination** -- All list endpoints use cursor-based pagination for consistent performance with growing datasets.
- **React Query** -- Client-side data fetching with TanStack React Query. Custom hooks abstract API calls and cache management.

## Environment Variables

Copy `.env.example` to `.env.local` for local development. All variables are documented in the example file.

| Variable                     | Description                                      |
| ---------------------------- | ------------------------------------------------ |
| `DATABASE_URL`               | PostgreSQL connection string                     |
| `NEXT_PUBLIC_USE_MOCK_AUTH`  | Enable mock Clerk auth (`true` for dev)          |
| `MOCK_AUTH_SECRET`           | HMAC secret for mock auth JWTs                   |
| `VIEWER_JWT_SECRET`          | HMAC secret for viewer session JWTs              |
| `VIEWER_JWT_SECRET_PREVIOUS` | Previous viewer JWT secret (for rotation)        |
| `ENCRYPTION_KEY`             | 32-byte hex AES-256-GCM key                      |
| `NEXT_PUBLIC_APP_URL`        | Public-facing application URL                    |
| `OURA_CLIENT_ID`             | Oura OAuth2 client ID (placeholder for mock)     |
| `OURA_CLIENT_SECRET`         | Oura OAuth2 client secret (placeholder for mock) |
| `INNGEST_EVENT_KEY`          | Inngest event key (optional, for dev server)     |
| `TOTUS_API_KEY`              | API key for CLI/MCP server authentication        |
| `TOTUS_BASE_URL`             | Base URL for CLI/MCP (default: `http://localhost:3000`) |
| `SENTRY_DSN`                 | Sentry DSN for error tracking (optional)         |

## Testing

Run tests across all workspaces:

```bash
bun --filter '*' test
```

Run tests for a specific workspace:

```bash
bun --filter '@totus/web' test
bun --filter '@totus/cli' test
```

Type checking (all workspaces):

```bash
bun --filter '*' typecheck
```

Linting:

```bash
bun --filter '@totus/web' lint
```

## License

Private. All rights reserved.
