# Architecture

Architectural decisions, patterns discovered during implementation.

---

## Frontend Patterns (from MVP)

- ViewContextProvider: role-aware rendering (owner vs viewer)
- DashboardShell: sidebar nav with mobile hamburger Sheet
- RootProviders: ThemeProvider + QueryClientProvider + TooltipProvider + Toaster
- TanStack Query with query-keys.ts for cache key management
- api-client.ts typed fetch wrapper

## Backend Patterns (from MVP)

- Route handlers import db directly, no separate service layer
- ApiError class for consistent error responses
- Zod validation on all API inputs
- Cursor-based pagination (stable under concurrent writes)
- Envelope encryption: AES-256-GCM per-row with LocalEncryptionProvider
- Fire-and-forget audit logging (non-blocking)
- Mock Clerk auth with jose JWTs in \_\_session cookie

## Multi-Provider Architecture (new)

- Provider registry: static config objects per provider
- Provider adapter interface: getAuthorizationUrl, exchangeCode, refresh, fetchDaily/Series/Periods
- health_data split into 3 tables: daily (renamed), series (partitioned), periods
- Source resolution: user preference > most recent sync > alphabetical
- Inngest for background sync (sweep, per-connection, initial, manual, token refresh, partition mgmt)

## API Key Auth Architecture

- Next.js middleware runs in Edge Runtime — cannot import node-postgres or node:crypto
- API key auth uses pass-through pattern: middleware parses Bearer header, sets `x-api-key-token` header, route handlers do DB validation via `getResolvedContext()`
- Routes supporting API key auth must import `getResolvedContext` from `resolve-api-key.ts` (not `getRequestContext` from `request-context.ts`)
- `getResolvedContext()` checks for `__api_key_pending__` sentinel and performs DB validation (hash check, revocation, expiry)
- API key format: `tot_live_{8 base62}_{32 base62}` — short_token (first 8) stored plaintext, long token SHA-256 hashed
- Scope enforcement via `requireScope()` in permissions system
- CSRF exempted for API key requests (`authMethod === 'api_key'`)
- Droid Shield may flag BASE62_ALPHABET constants and test tokens as secrets — split commits if needed

## Inngest Integration Patterns

- Client at `src/inngest/client.ts` with typed events via `EventSchemas.fromRecord<Events>()`
- Functions in `src/inngest/functions/` with barrel export from `index.ts`
- Route handler at `/api/inngest/route.ts` using `serve()` from `inngest/next`
- Sync helpers at `src/inngest/sync-helpers.ts`: shared logic for data fetching, encryption, upserting
- **Buffer serialization**: Inngest `step.run()` serializes data to JSON between steps. Buffer fields (like `authEnc`) become `{type: "Buffer", data: number[]}`. Use `ensureBuffer()` to reconstruct.
- **Concurrency guards**: `claimConnection()` uses atomic compare-and-swap to prevent duplicate syncs
- **Error isolation**: `onFailure` handlers update `sync_status='error'` and `sync_error` in DB
- **Token refresh**: Each connection refreshed in its own `step.run()` for fault isolation
- POST /api/connections/[provider]/sync dispatches `integration/sync.manual` event (not inline sync)
- OAuth callback dispatches `integration/sync.initial` event for historical backfill
- Mock Inngest client in tests: `vi.mock("@/inngest/client", ...)` to avoid needing dev server

## CLI Patterns

- **Libraries**: chalk v5 (ESM-only), cli-table3, csv-stringify/sync for output formatting
- **Commander.js v14** with @commander-js/extra-typings for type-safe option parsing
- **CommandLike duck-typing**: `command-helpers.ts` defines a `CommandLike` interface (`parent?`, `opts()`) to work around @commander-js/extra-typings strict generics when sharing action callback logic across commands
- **API key resolution**: `--api-key` flag > `TOTUS_API_KEY` env > config file (`~/.config/totus/config.json`)
- **Output format auto-detection**: table for TTY, JSON for piped output, overridable with `--output`
- **Exit codes**: 0=success, 1=error, 2=auth, 3=permission
- **Note**: `--verbose` global flag conflicts with Commander.js internals; `metrics summary` uses `--detailed` instead of `--verbose` as a workaround
- **No lint config** for CLI package yet — only `typecheck` and `test` scripts exist
