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
