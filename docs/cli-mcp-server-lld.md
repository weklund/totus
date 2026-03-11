# Totus MVP Low-Level Design: CLI and MCP Server

### Version 1.1 — March 2026

### Author: Architecture Team

### Status: Updated — Multi-provider CLI surface and MCP schema corrections (March 2026)

---

## 1. Overview

**Purpose.** This document specifies the complete low-level design for the Totus CLI tool and MCP (Model Context Protocol) Server. It defines command structure, MCP tool/resource definitions, API key authentication, database schema additions, security model, and packaging. It is the implementation blueprint — an engineer (or AI coding agent) should be able to build both the CLI and MCP Server by following this document line by line.

**Audience.** The founder (Wes Eklund), implementation agents, and any future engineers.

**Prerequisite Reading.**

- Totus MVP PRD (v1.0) — `/docs/mvp-prd.md`
- Totus Architecture Design (v1.0) — `/docs/architecture-design.md`
- Totus API & Database LLD (v1.0) — `/docs/api-database-lld.md`
- Totus Integrations Pipeline LLD — `/docs/integrations-pipeline-lld.md` (multi-provider data pipeline, new tables)
- MCP Specification — https://modelcontextprotocol.io/specification/2025-03-26
- MCP TypeScript SDK — https://github.com/modelcontextprotocol/typescript-sdk

**Scope.** This document covers the CLI command surface, MCP Server tool/resource/prompt definitions, API key authentication system, database schema additions, and the npm package that ships both. It does NOT cover changes to the web UI, existing browser-based API routes, or Vercel deployment configuration.

**Why CLI + MCP Server?** Quantified-self users increasingly use AI agents (Claude, ChatGPT, Cursor) to analyze and reason about their data. An MCP Server lets users say "analyze my sleep trends this month" in Claude and get real answers from their Totus vault. A CLI gives power users scripting, automation, and terminal-native access. Both authenticate via the same API key system, reuse the same Totus REST API, and are distributed as a single npm package.

---

## 2. Problem Statement

The existing Totus API (documented in `api-database-lld.md`) uses cookie-based authentication exclusively — designed for browser sessions via Clerk (owners) and signed JWTs (viewers). This means:

1. **No programmatic access.** There is no way for a script, cron job, or AI agent to authenticate with the Totus API.
2. **No MCP integration.** AI assistants (Claude Desktop, Claude Code, Cursor, VS Code Copilot) cannot read a user's health data because there is no MCP Server exposing Totus data.
3. **No terminal workflow.** Power users who live in the terminal cannot query their health data, manage shares, or check audit logs without opening a browser.

This LLD closes all three gaps by introducing:

- **API key authentication** — a new auth path alongside Clerk sessions and viewer tokens.
- **CLI tool** — a terminal interface wrapping the Totus REST API.
- **MCP Server** — an MCP-compliant server exposing Totus data to AI agents.

---

## 3. Glossary

| Term                          | Definition                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **API Key**                   | A prefixed, cryptographically random credential (`tot_live_...`) that authenticates programmatic requests to the Totus API. |
| **Short Token**               | The first 8-character segment of an API key, stored in plaintext for lookup and display purposes.                           |
| **Long Token**                | The 32-character secret segment of an API key. Never stored — only its SHA-256 hash is persisted.                           |
| **MCP**                       | Model Context Protocol — an open standard by Anthropic for connecting AI models to external data sources and tools.         |
| **MCP Tool**                  | A function the AI model can call (with user approval) to perform an action or retrieve data.                                |
| **MCP Resource**              | Read-only data an MCP client can surface to users or models, identified by URIs.                                            |
| **MCP Prompt**                | A reusable conversation template that helps users interact with the model using Totus data.                                 |
| **stdio Transport**           | MCP communication via standard input/output streams. The client spawns the server as a subprocess.                          |
| **Streamable HTTP Transport** | MCP communication via HTTP POST/GET with SSE streaming. For remote server deployments.                                      |

---

## 4. Tenets

These tenets guide every design decision in this document. When tenets conflict, earlier tenets take priority.

1. **Same API, different auth.** The CLI and MCP Server call the same REST endpoints as the web UI. The only difference is the authentication mechanism (API key instead of Clerk session). No separate "CLI API" or "MCP API" exists.

2. **API keys are scoped, expiring, and auditable.** Every API key has explicit permission scopes, an expiration date, and every use is recorded in the audit log with `actor_type: 'api_key'`.

3. **The MCP Server is a thin client.** It translates MCP tool calls into Totus REST API requests. It does not cache data, make independent decisions about what to return, or store health data locally.

4. **One package, two entry points.** The CLI (`totus`) and MCP Server (`totus mcp-server`) ship as a single npm package. Users install once and get both.

5. **Fail safe with health data.** The CLI and MCP Server must refuse to connect over plain HTTP. API keys must never be logged to stdout or stderr. Health data displayed in the terminal includes a warning about scrollback buffer persistence.

6. **Minimal new surface area.** This LLD adds exactly what is needed: API key auth, CLI commands, and MCP tools. It does not change existing endpoints, database tables, or the web UI.

---

## 5. Requirements

### 5.1 Functional Requirements

| ID       | Requirement                                                                                                      | Source               |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------- |
| FR-CLI-1 | CLI authenticates via API key (environment variable, flag, or stored credential)                                 | New                  |
| FR-CLI-2 | CLI commands mirror the REST API surface: health data queries, share management, audit log, connections, profile | Existing API         |
| FR-CLI-3 | CLI supports JSON, table, and CSV output formats                                                                 | New                  |
| FR-CLI-4 | CLI auto-detects TTY and chooses table (interactive) or JSON (piped) output                                      | New                  |
| FR-MCP-1 | MCP Server exposes health data query, metric listing, share management, and audit log as MCP tools               | New                  |
| FR-MCP-2 | MCP Server exposes health data summaries and metric catalog as MCP resources                                     | New                  |
| FR-MCP-3 | MCP Server exposes analysis prompts (sleep analysis, trend comparison, share preparation) as MCP prompts         | New                  |
| FR-MCP-4 | MCP Server authenticates via API key passed as environment variable                                              | New                  |
| FR-MCP-5 | MCP Server uses stdio transport for local deployments (Claude Desktop, Claude Code, Cursor)                      | New                  |
| FR-KEY-1 | Users can create, list, and revoke API keys via the web UI and CLI                                               | New                  |
| FR-KEY-2 | API keys have configurable scopes and expiration                                                                 | New                  |
| FR-KEY-3 | Every API key use is recorded in the audit log                                                                   | Existing audit model |

### 5.2 Non-Functional Requirements

| ID        | Requirement                        | Target                                           |
| --------- | ---------------------------------- | ------------------------------------------------ |
| NFR-CLI-1 | CLI startup time (to first output) | < 300ms                                          |
| NFR-CLI-2 | CLI binary size (installed)        | < 15 MB                                          |
| NFR-MCP-1 | MCP tool response latency          | < 2s (dominated by API call; server adds < 50ms) |
| NFR-MCP-2 | MCP Server memory usage            | < 50 MB                                          |
| NFR-KEY-1 | API key validation latency (p95)   | < 50ms (single DB lookup by indexed short_token) |
| NFR-KEY-2 | Maximum API keys per user          | 10                                               |

### 5.3 Out of Scope

- Remote MCP Server (Streamable HTTP transport) — deferred to post-MVP. The stdio transport covers Claude Desktop, Claude Code, Cursor, and VS Code.
- CLI `watch` mode (real-time data streaming) — deferred. The API has no WebSocket/SSE endpoints.
- CLI auto-update mechanism — users update via `npm update -g @totus/cli` or `bun update -g @totus/cli`.
- OAuth Device Authorization Grant for CLI login — deferred. API keys are sufficient for MVP.
- MCP Server-initiated sampling (asking the model to run completions) — deferred.

### 5.4 Success Criteria

- CLI can authenticate, query health data, and output in all three formats without error.
- MCP Server registers with Claude Desktop/Claude Code and responds to all defined tools.
- API key creation, usage, and revocation are fully audited.
- No health data is persisted locally by either the CLI or MCP Server.

---

## 6. Architecture Overview

### 6.1 System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                      │
│                                                                     │
│  Browser ──────┐   CLI ──────┐   AI Agent ──────┐                  │
│  (Clerk cookie) │  (API key)  │  (MCP + API key)  │                  │
└─────────────────┼─────────────┼───────────────────┼──────────────────┘
                  │ HTTPS       │ HTTPS             │ stdio
                  ▼             ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     VERCEL EDGE + SERVERLESS                         │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Next.js Middleware                          │  │
│  │  1. Clerk session check (browser)                             │  │
│  │  2. Viewer token check (share links)                          │  │
│  │  3. API key check (CLI / MCP)  ← NEW                         │  │
│  │  4. Rate limiting                                             │  │
│  │  5. Produce RequestContext → headers                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                    API Route Handlers                          │  │
│  │  (Same routes serve browser, CLI, and MCP)                    │  │
│  │                                                               │  │
│  │  /api/health-data       Health data queries                   │  │
│  │  /api/shares/*          Share grant CRUD                      │  │
│  │  /api/audit             Audit log query                       │  │
│  │  /api/connections/*     Connection management                 │  │
│  │  /api/user/*            Profile, export, delete               │  │
│  │  /api/keys/*            API key management  ← NEW             │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌────────────────┐   ┌──────────────┐   ┌──────────────────┐
│  PostgreSQL    │   │   AWS KMS    │   │  Provider APIs   │
│  Aurora v2     │   │              │   │  (External)      │
│                │   │  Per-user    │   │                  │
│  10 tables:    │   │  CMKs        │   │  OAuth2 + REST   │
│  health_data_  │   │              │   │  Oura, Apple     │
│    daily       │   │              │   │  Health, etc.    │
│  health_data_  │   │              │   │                  │
│    series      │   │              │   │                  │
│  health_data_  │   │              │   │                  │
│    periods     │   │              │   │                  │
│  provider_     │   │              │   │                  │
│    connections │   │              │   │                  │
│  metric_source │   │              │   │                  │
│    _preferences│   │              │   │                  │
│  api_keys      │   │              │   │                  │
│  + others      │   │              │   │                  │
└────────────────┘   └──────────────┘   └──────────────────┘
```

### 6.2 MCP Server Data Flow

```
┌───────────────────────────────────────────────────────────────┐
│                   AI CLIENT (Claude Desktop)                   │
│                                                               │
│  User: "Show me my sleep trends for the last month"           │
│                                                               │
│  Model decides to call MCP tool: get_health_data              │
│  with: { metrics: ["sleep_score"], period: "last_30_days" }   │
└──────────┬────────────────────────────────────────────────────┘
           │ stdio (JSON-RPC)
           ▼
┌───────────────────────────────────────────────────────────────┐
│                   TOTUS MCP SERVER (local process)             │
│                                                               │
│  1. Receive tool call via stdin                               │
│  2. Validate input against Zod schema                         │
│  3. Build REST API request                                    │
│     GET /api/health-data?metrics=sleep_score&start=...&end=...│
│  4. Attach API key: Authorization: Bearer tot_live_...        │
│  5. Send HTTPS request to Totus API                           │
│  6. Parse response                                            │
│  7. Format result as MCP tool response                        │
│  8. Write response to stdout                                  │
└──────────┬────────────────────────────────────────────────────┘
           │ HTTPS
           ▼
┌───────────────────────────────────────────────────────────────┐
│                   TOTUS API (Vercel)                           │
│                                                               │
│  Middleware validates API key → RequestContext                 │
│  Route handler enforces permissions                           │
│  Audit event emitted (actor_type: 'api_key')                  │
│  Response returned                                            │
└───────────────────────────────────────────────────────────────┘
```

### 6.3 CLI Data Flow

```
┌─────────────────────────────────┐
│  Terminal                        │
│                                 │
│  $ totus metrics get \          │
│      --metrics sleep_score,hrv  │
│      --start 2026-02-01 \       │
│      --end 2026-03-01 \         │
│      --output table             │
└───────────┬─────────────────────┘
            │
┌───────────▼─────────────────────┐
│  CLI Process                     │
│                                 │
│  1. Parse args (Commander.js)   │
│  2. Resolve API key             │
│     (env → config → flag)       │
│  3. Build API request           │
│  4. HTTPS call to Totus API     │
│  5. Format response             │
│  6. Print to stdout             │
└─────────────────────────────────┘
```

---

## 7. API Key Authentication System

This is the foundational layer that both the CLI and MCP Server depend on. It adds a new auth path to the existing middleware chain.

### 7.1 API Key Format

```
tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG
^^^  ^^^  ^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^^
 │    │      │              │
 │    │      │              └── Long token (32 chars, base62, the secret)
 │    │      └── Short token (8 chars, base62, for lookup/display)
 │    └── Environment: live or test
 └── Service prefix: tot (Totus)
```

**Generation algorithm:**

1. Generate 8 random bytes → base62-encode → `short_token` (8 chars).
2. Generate 32 random bytes → base62-encode → `long_token` (32 chars).
3. Compute `long_token_hash = SHA-256(long_token)` → hex string (64 chars).
4. Assemble display key: `tot_live_{short_token}_{long_token}`.
5. Store in database: `short_token` (plaintext), `long_token_hash` (hash only). The full key is returned to the user once and never stored or returned again.

**Why this structure:**

- **`tot_live_` prefix** enables GitHub/GitLab secret scanning to detect accidentally committed keys.
- **Short token** allows display in dashboards ("Key ending in BRTRKFsL") and efficient database lookup (indexed).
- **Long token** is the actual secret with ~190 bits of entropy — computationally infeasible to brute-force.
- **Underscores** instead of hyphens — double-clicking selects the entire key in most terminals and editors.

### 7.2 API Key Scopes

| Scope               | Description                                     | Included In     |
| ------------------- | ----------------------------------------------- | --------------- |
| `health:read`       | Read health metrics, available types, summaries | read-only, full |
| `health:write`      | Trigger data sync, import data                  | full            |
| `shares:read`       | List and view share grants                      | read-only, full |
| `shares:write`      | Create, revoke, delete share grants             | full            |
| `audit:read`        | Query audit log                                 | read-only, full |
| `connections:read`  | List data source connections                    | read-only, full |
| `connections:write` | Connect/disconnect data sources, trigger sync   | full            |
| `profile:read`      | Read user profile and stats                     | read-only, full |
| `keys:read`         | List API keys                                   | full            |
| `keys:write`        | Create and revoke API keys                      | full            |

**Predefined scope bundles:**

- **Read-only** (`health:read`, `shares:read`, `audit:read`, `connections:read`, `profile:read`) — recommended for MCP Server.
- **Full access** (all scopes) — for CLI power users.
- **Custom** — user selects individual scopes at creation time.

### 7.3 Database Schema: `api_keys` Table

```sql
CREATE TABLE api_keys (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(100)    NOT NULL,
        -- User-provided label (e.g., "Claude Desktop", "CI Pipeline")
    short_token     VARCHAR(16)     NOT NULL,
        -- First 8 chars of the key, base62-encoded. Used for lookup and display.
    long_token_hash VARCHAR(64)     NOT NULL,
        -- SHA-256 hash of the long token portion, hex-encoded.
    scopes          TEXT[]          NOT NULL,
        -- PostgreSQL text array of granted scopes.
        -- e.g., ARRAY['health:read','shares:read','audit:read']
    expires_at      TIMESTAMPTZ     NOT NULL,
        -- When the key stops working. Default: 90 days from creation.
    last_used_at    TIMESTAMPTZ,
        -- Updated on each successful authentication.
    revoked_at      TIMESTAMPTZ,
        -- NULL = active. Non-NULL = revoked at this timestamp.
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_api_keys_short_token UNIQUE (short_token),
    CONSTRAINT chk_api_keys_scopes_nonempty CHECK (array_length(scopes, 1) > 0)
);

-- Fast lookup by short_token for authentication.
-- Partial index: only active (non-revoked, non-expired) keys.
CREATE INDEX idx_api_keys_active_short_token
    ON api_keys(short_token)
    WHERE revoked_at IS NULL AND expires_at > now();

-- User's key management list.
CREATE INDEX idx_api_keys_user_created
    ON api_keys(user_id, created_at DESC);

-- Enforce maximum 10 active keys per user at application level (not DB constraint).

COMMENT ON TABLE api_keys IS 'API keys for programmatic access. Long token stored as SHA-256 hash only.';
COMMENT ON COLUMN api_keys.short_token IS 'First 8 chars of the API key, used for efficient lookup and safe display.';
COMMENT ON COLUMN api_keys.long_token_hash IS 'SHA-256 hash of the secret portion. The raw secret is returned once at creation.';
```

**Drizzle ORM schema addition** (file: `src/db/schema.ts`):

```
// Table: apiKeys
//   id: uuid().primaryKey().defaultRandom()
//   userId: varchar(64).notNull().references(users.id, { onDelete: 'cascade' })
//   name: varchar(100).notNull()
//   shortToken: varchar(16).notNull().unique()
//   longTokenHash: varchar(64).notNull()
//   scopes: text().array().notNull()
//   expiresAt: timestamp({ withTimezone: true }).notNull()
//   lastUsedAt: timestamp({ withTimezone: true })
//   revokedAt: timestamp({ withTimezone: true })
//   createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
```

### 7.4 API Key Authentication Flow

The middleware gains a third authentication path:

```
Request arrives at Next.js Middleware
  │
  ├── Has `Authorization: Bearer tot_live_...` header?
  │     │
  │     YES ──► Parse key: extract short_token and long_token
  │             │
  │             ├── Query: SELECT * FROM api_keys
  │             │          WHERE short_token = $1
  │             │          AND revoked_at IS NULL
  │             │          AND expires_at > now()
  │             │
  │             ├── No match → 401 UNAUTHORIZED
  │             │
  │             ├── Match found → Compute SHA-256(long_token)
  │             │   Compare with stored long_token_hash
  │             │   │
  │             │   ├── Mismatch → 401 UNAUTHORIZED
  │             │   │
  │             │   └── Match → Valid key!
  │             │       │
  │             │       ├── Update last_used_at (async, non-blocking)
  │             │       │
  │             │       └── Build RequestContext:
  │             │           {
  │             │             role: 'owner',
  │             │             authMethod: 'api_key',
  │             │             userId: key.user_id,
  │             │             apiKeyId: key.id,
  │             │             scopes: key.scopes
  │             │           }
  │             │
  │     NO ──► Has Clerk session cookie?
  │             │
  │             YES ──► Existing Clerk auth flow
  │             │       RequestContext: { role: 'owner', authMethod: 'session', ... }
  │             │
  │             NO ──► Has viewer token?
  │                     │
  │                     YES ──► Existing viewer flow
  │                     │       RequestContext: { role: 'viewer', authMethod: 'viewer_token', ... }
  │                     │
  │                     NO ──► 401 UNAUTHORIZED
```

**Scope enforcement** is a new check in `enforcePermissions()`:

```
function enforcePermissions(ctx: RequestContext, requiredScope: string):
    IF ctx.authMethod == 'api_key':
        IF requiredScope NOT IN ctx.scopes:
            REJECT 403 "API key does not have the required scope: {requiredScope}"
    // Existing owner/viewer permission logic follows...
```

**CSRF exemption:** API key-authenticated requests skip CSRF validation. CSRF is a browser-specific attack vector; API keys are sent via `Authorization` header, not cookies.

**Rate limits for API key requests:**

| Endpoint Category           | Limit        | Window   | Scope                     |
| --------------------------- | ------------ | -------- | ------------------------- |
| API key (general)           | 300 requests | 1 minute | Per API key (short_token) |
| Health data query (API key) | 60 requests  | 1 minute | Per API key               |
| Data write/sync (API key)   | 10 requests  | 1 minute | Per API key               |

### 7.5 API Key Management Endpoints

#### 7.5.1 POST /api/keys

Create a new API key.

**Auth:** Owner (Clerk session required). API keys cannot create other API keys to prevent privilege escalation from a compromised key — keys are created only via the web UI or CLI (the CLI uses an existing key with `keys:write` scope, but initial key creation requires browser auth).

**Update:** API keys with `keys:write` scope CAN create other keys, but only with equal or lesser scopes (no privilege escalation). The first key must be created via the web UI.

**Request Body:**

```json
{
  "name": "Claude Desktop",
  "scopes": ["health:read", "shares:read", "audit:read"],
  "expires_in_days": 90
}
```

**Request Fields:**

| Field             | Type       | Required | Constraints            | Description           |
| ----------------- | ---------- | -------- | ---------------------- | --------------------- |
| `name`            | `string`   | Yes      | 1-100 chars            | Human-readable label  |
| `scopes`          | `string[]` | Yes      | 1+ valid scope strings | Permission scopes     |
| `expires_in_days` | `integer`  | No       | 1-365, default 90      | Days until expiration |

**Processing:**

1. Validate with Zod.
2. Check user has < 10 active (non-revoked) keys. If at limit, return 400.
3. If auth is via API key, verify requesting key has `keys:write` scope AND all requested scopes are a subset of the requesting key's scopes.
4. Generate short_token (8 bytes → base62).
5. Generate long_token (32 bytes → base62).
6. Hash long_token with SHA-256.
7. Insert into `api_keys`.
8. Emit `key.created` audit event.
9. Return the full key (only time it is shown).

**Response 201:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Claude Desktop",
    "key": "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG",
    "short_token": "BRTRKFsL",
    "scopes": ["health:read", "shares:read", "audit:read"],
    "expires_at": "2026-06-07T14:23:01.000Z",
    "created_at": "2026-03-09T14:23:01.000Z"
  }
}
```

**IMPORTANT:** The `key` field is returned ONLY in this creation response. It is never returned again by any endpoint.

**Error Responses:** 400 (`KEY_LIMIT_REACHED`, `VALIDATION_ERROR`), 401, 403 (`INSUFFICIENT_SCOPES`)

---

#### 7.5.2 GET /api/keys

List the user's API keys.

**Auth:** Owner (Clerk session) or API key with `keys:read` scope.

**Response 200:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Claude Desktop",
      "short_token": "BRTRKFsL",
      "scopes": ["health:read", "shares:read", "audit:read"],
      "status": "active",
      "expires_at": "2026-06-07T14:23:01.000Z",
      "last_used_at": "2026-03-09T15:00:00.000Z",
      "created_at": "2026-03-09T14:23:01.000Z"
    }
  ]
}
```

**Note:** The full key is NEVER included in list responses. `status` is computed: `active` (not revoked, not expired), `expired` (past `expires_at`), `revoked` (has `revoked_at`).

**Error Responses:** 401, 403

---

#### 7.5.3 PATCH /api/keys/{keyId}

Revoke an API key.

**Auth:** Owner (Clerk session) or API key with `keys:write` scope.

**Request Body:**

```json
{
  "action": "revoke"
}
```

**Processing:**

1. Verify key exists and belongs to the requesting user.
2. If already revoked, return 200 with current state (idempotent).
3. Set `revoked_at = NOW()`.
4. Emit `key.revoked` audit event.

**Response 200:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "revoked",
    "revoked_at": "2026-03-09T16:00:00.000Z"
  }
}
```

**Error Responses:** 401, 403, 404

### 7.6 Audit Event Types (Additions)

The following event types are added to the audit taxonomy (defined in `api-database-lld.md` Section 8.3.6):

```
key.created       - API key created
key.revoked       - API key revoked
key.used          - API key used for authentication (logged on first use per day, not every request)
```

The `actor_type` field gains a new value: `'api_key'`. When a request is authenticated via API key:

- `actor_type = 'api_key'`
- `actor_id = key.user_id` (the owning user)
- `resource_detail` includes `{ "api_key_id": "...", "api_key_name": "..." }`

**Note on `key.used` frequency:** Logging every single API key authentication would flood the audit log for heavy MCP usage. Instead, `key.used` is emitted at most once per key per calendar day (UTC). Data access events (`data.viewed`, etc.) are still logged per request regardless of auth method.

### 7.7 Data Access Pattern: API Key Validation

```sql
-- Lookup by short_token (uses partial index idx_api_keys_active_short_token)
SELECT id, user_id, name, short_token, long_token_hash, scopes, expires_at
FROM api_keys
WHERE short_token = $1
  AND revoked_at IS NULL
  AND expires_at > now();
```

**Performance estimate:** ~2ms (unique index lookup on short_token, filtered by active keys).

**Application-side verification:**

1. Extract `short_token` and `long_token` from the `Authorization: Bearer tot_live_{short_token}_{long_token}` header.
2. Query by `short_token`.
3. Compute `SHA-256(long_token)`.
4. Compare with `long_token_hash`. Reject if mismatch.
5. Build RequestContext with `userId`, `scopes`, and `apiKeyId`.

---

## 8. CLI Design

### 8.1 Package and Installation

**Package name:** `@totus/cli`
**Entry points:**

- CLI: `bin/totus` (symlinked to `dist/cli.js`)
- MCP Server: `dist/mcp-server.js` (invoked via `totus mcp-server` or directly by MCP clients)

**Installation:**

```bash
# Global install (recommended)
bun install -g @totus/cli
# or
npm install -g @totus/cli

# Verify
totus --version
```

**package.json structure:**

```json
{
  "name": "@totus/cli",
  "version": "1.0.0",
  "description": "Totus Health Data Vault — CLI and MCP Server",
  "type": "module",
  "bin": {
    "totus": "./dist/cli.js"
  },
  "exports": {
    "./mcp-server": "./dist/mcp-server.js"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### 8.2 Dependencies

| Package                     | Version   | Purpose                                       |
| --------------------------- | --------- | --------------------------------------------- |
| `commander`                 | `^13.0.0` | CLI framework (argument parsing, subcommands) |
| `@modelcontextprotocol/sdk` | `^1.27.0` | MCP Server SDK                                |
| `zod`                       | `^3.25.0` | Input validation (shared with API schemas)    |
| `cli-table3`                | `^0.6.0`  | Table output rendering                        |
| `csv-stringify`             | `^6.0.0`  | CSV output generation                         |
| `chalk`                     | `^5.0.0`  | Terminal coloring                             |
| `ora`                       | `^8.0.0`  | Loading spinners                              |
| `conf`                      | `^13.0.0` | Configuration file management                 |

**No `keytar` or OS keychain dependency at MVP.** API keys are stored in a plaintext config file (`~/.config/totus/config.json`) with restrictive file permissions (mode `0600`). Keychain integration can be added post-MVP.

### 8.3 Configuration

**Configuration file:** `~/.config/totus/config.json`

```json
{
  "api_key": "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG",
  "api_url": "https://totus.com/api",
  "default_output": "table"
}
```

**File permissions:** Created with mode `0600` (owner read/write only). The CLI warns if permissions are looser.

**API key resolution order** (first match wins):

1. `--api-key` flag: `totus metrics list --api-key tot_live_...`
2. `TOTUS_API_KEY` environment variable
3. Config file (`~/.config/totus/config.json`)

**API URL resolution order:**

1. `--api-url` flag
2. `TOTUS_API_URL` environment variable
3. Config file
4. Default: `https://totus.com/api`

### 8.4 Command Structure

```
totus
├── auth
│   ├── login            Store API key in config
│   ├── logout           Remove stored API key
│   ├── status           Show current auth status
│   └── token            Print current API key (masked by default)
│
├── metrics
│   ├── list             List available metric types
│   ├── get              Query health data
│   └── summary          Show summary statistics
│
├── shares
│   ├── list             List share grants
│   ├── get <id>         Get share grant details
│   ├── create           Create a new share grant
│   └── revoke <id>      Revoke a share grant
│
├── audit
│   └── list             Query audit log
│
├── connections
│   ├── list             List data source connections
│   └── sync             Trigger a data sync (one connection or all)
│
├── preferences
│   ├── list             List source preferences per metric
│   ├── set <metric> <source>  Set preferred source for a metric
│   └── delete <metric>  Remove preference, revert to auto-resolution
│
├── keys
│   ├── list             List API keys
│   ├── create           Create a new API key
│   └── revoke <id>      Revoke an API key
│
├── profile              Show user profile and stats
│
├── export               Request full data export
│
├── mcp-server           Start the MCP Server (stdio transport)
│
├── config
│   ├── get <key>        Get a config value
│   └── set <key> <val>  Set a config value
│
└── --version, --help
```

### 8.5 Command Specifications

#### 8.5.1 `totus auth login`

Store an API key for use in subsequent commands.

```
$ totus auth login
? Enter your Totus API key: tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG
✓ Authenticated as Wes E. (key: ...BRTRKFsL)
  API key stored in ~/.config/totus/config.json
```

**Processing:**

1. Prompt for API key (input masked with `*`).
2. Validate key format (must start with `tot_live_` or `tot_test_`).
3. Call `GET /api/user/profile` with the key to verify it works.
4. If valid, store in config file. Display user's `display_name` and masked key.
5. If invalid, display error and do not store.

**Flags:**

- `--stdin`: Read key from stdin (for piping, e.g., `echo $KEY | totus auth login --stdin`).

---

#### 8.5.2 `totus auth status`

Show current authentication status.

```
$ totus auth status
✓ Authenticated
  User: Wes E.
  Key: tot_live_...BRTRKFsL
  Scopes: health:read, shares:read, audit:read
  Expires: 2026-06-07
  Source: config file (~/.config/totus/config.json)
```

---

#### 8.5.3 `totus metrics list`

List available metric types for the authenticated user.

**Maps to:** `GET /api/health-data/types`
**Required scope:** `health:read`

Default output shows the resolved source for each metric (the winner of source resolution) and a `Sources` count so users can see where multiple providers overlap.

```
$ totus metrics list

Metric Type        Label                       Unit    Category         Source   Sources  Data Points  Date Range
────────────────── ─────────────────────────── ─────── ──────────────── ──────── ──────── ──────────── ─────────────────────
sleep_score        Sleep Score                 score   sleep            oura     1        784          2024-01-15 → 2026-03-08
hrv                Heart Rate Variability      ms      cardiovascular   whoop    2        420          2025-06-01 → 2026-03-08
rhr                Resting Heart Rate          bpm     cardiovascular   whoop    2        420          2025-06-01 → 2026-03-08
steps              Steps                       steps   activity         oura     1        784          2024-01-15 → 2026-03-08
```

`Sources > 1` means multiple providers have data for that metric. Use `--all-sources` to expand to one row per provider, or `totus preferences list` to inspect and manage which source is authoritative.

**`--all-sources` expanded output:**

```
$ totus metrics list --all-sources

Metric Type   Label                   Unit  Category   Source   Preferred  Data Points  Date Range
───────────── ─────────────────────── ───── ────────── ──────── ────────── ──────────── ─────────────────────
hrv           Heart Rate Variability  ms    cardio     whoop    yes (set)  420          2025-06-01 → 2026-03-08
hrv           Heart Rate Variability  ms    cardio     oura     no         784          2024-01-15 → 2026-03-08
rhr           Resting Heart Rate      bpm   cardio     whoop    yes (auto) 420          2025-06-01 → 2026-03-08
rhr           Resting Heart Rate      bpm   cardio     oura     no         784          2024-01-15 → 2026-03-08
```

`Preferred: yes (set)` — explicit user preference via `totus preferences set`.
`Preferred: yes (auto)` — auto-resolved (most recent data wins); no explicit preference.

**JSON output** includes `sources` array and `resolved_source` per metric — no annotation hacks:

```json
{
  "metrics": [
    {
      "metric_type": "hrv",
      "label": "Heart Rate Variability",
      "unit": "ms",
      "category": "cardiovascular",
      "resolved_source": "whoop",
      "preference": "explicit",
      "sources": [
        {
          "provider": "whoop",
          "data_points": 420,
          "date_range": { "start": "2025-06-01", "end": "2026-03-08" }
        },
        {
          "provider": "oura",
          "data_points": 784,
          "date_range": { "start": "2024-01-15", "end": "2026-03-08" }
        }
      ]
    }
  ]
}
```

**Flags:**

- `--output <format>`: `table` (default in TTY), `json`, `csv`
- `--category <cat>`: Filter by category (`sleep`, `cardiovascular`, `activity`, `body`, `readiness`, `nutrition`)
- `--all-sources`: Expand to one row per `(metric_type, source)`; shows preference and conflict detail

---

#### 8.5.4 `totus metrics get`

Query health data for specific metrics and date range.

**Maps to:** `GET /api/health-data`
**Required scope:** `health:read`

```
$ totus metrics get --metrics sleep_score,hrv --start 2026-02-01 --end 2026-03-01

Sleep Score (score)
Date         Value  Source
──────────── ────── ──────
2026-02-01   85     oura
2026-02-02   78     oura
2026-02-03   91     oura
...

Heart Rate Variability (ms)
Date         Value  Source
──────────── ────── ──────
2026-02-01   42.5   apple
2026-02-02   38.1   apple
2026-02-03   45.7   apple
...
```

**Required flags:**

- `--metrics <types>`: Comma-separated metric type IDs. Run `totus metrics list` to see available IDs.
- `--start <date>`: Start date (YYYY-MM-DD)
- `--end <date>`: End date (YYYY-MM-DD)

**Optional flags:**

- `--resolution <res>`: `daily` (default), `weekly`, `monthly`
- `--source <provider>`: Filter to a specific provider (e.g., `oura`, `whoop`, `garmin`). Bypasses source resolution and returns only rows from the specified provider. Errors if the provider ID is not found in `GET /api/connections`.
- `--output <format>`: `table`, `json`, `csv`

**JSON output (when piped or `--output json`):**

The CLI transforms the API response into this shape. `source` on each point reflects the resolved provider (or the `--source` filter value if used).

```json
{
  "metrics": {
    "sleep_score": {
      "unit": "score",
      "points": [{ "date": "2026-02-01", "value": 85, "source": "oura" }]
    }
  },
  "query": {
    "start": "2026-02-01",
    "end": "2026-03-01",
    "resolution": "daily",
    "source": null
  }
}
```

---

#### 8.5.5 `totus metrics summary`

Show summary statistics for the user's health data.

**Maps to:** `GET /api/health-data/types` + local computation on the response.
**Required scope:** `health:read`

```
$ totus metrics summary

Health Data Summary
  Total data points:    4,720
  Connected sources:    oura, whoop
  Active shares:        2
  Earliest data:        2024-01-15
  Latest data:          2026-03-08

  Metrics:              18 types across 5 categories
    sleep (8)           cardiovascular (4)    body (1)
    readiness (1)       activity (3)
```

With `--verbose`, expands to show per-source breakdown and any metrics with conflicting sources:

```
$ totus metrics summary --verbose

Health Data Summary
  Total data points:    4,720
  Connected sources:    oura, whoop
  Active shares:        2
  Earliest data:        2024-01-15
  Latest data:          2026-03-08

  Metrics:              18 types across 5 categories
    sleep (8)           cardiovascular (4)    body (1)
    readiness (1)       activity (3)

  By source:
    oura        14 metrics    3,920 points    2024-01-15 → 2026-03-08
    whoop        6 metrics      800 points    2025-06-01 → 2026-03-08

  Source conflicts (2 metrics have data from multiple providers):
    hrv           resolved → whoop (explicit preference)
    rhr           resolved → whoop (auto: most recent)

  Run "totus metrics list --all-sources" to see full source detail.
  Run "totus preferences list" to manage source preferences.
```

**Flags:**

- `--verbose`, `-v`: Show per-source breakdown and conflict summary
- `--output <format>`: `table` (default in TTY), `json`

---

#### 8.5.6 `totus shares list`

List share grants.

**Maps to:** `GET /api/shares`
**Required scope:** `shares:read`

```
$ totus shares list

ID          Label                          Status   Metrics  Views  Expires         Created
─────────── ────────────────────────────── ──────── ──────── ────── ─────────────── ───────────────
550e8400... For Dr. Patel - annual checkup active   4        3      2026-04-07      2026-03-08
a1b2c3d4... Coach weekly review            expired  2        12     2026-03-01      2026-02-01
```

**Flags:**

- `--status <status>`: `active`, `expired`, `revoked`, `all` (default: `all`)
- `--output <format>`: `table`, `json`, `csv`
- `--limit <n>`: Results per page (default: 20, max: 50)

---

#### 8.5.7 `totus shares create`

Create a new share grant.

**Maps to:** `POST /api/shares`
**Required scope:** `shares:write`

```
$ totus shares create \
    --label "For Dr. Patel" \
    --metrics sleep_score,hrv,rhr \
    --start 2025-06-01 \
    --end 2026-03-08 \
    --expires 30 \
    --note "Please review my sleep trends"

✓ Share created
  URL: https://totus.com/v/dGhpcyBpcyBhIHRlc3Q...
  Label: For Dr. Patel
  Metrics: sleep_score, hrv, rhr
  Date range: 2025-06-01 → 2026-03-08
  Expires: 2026-04-08

  ⚠ Save this URL now — it will not be shown again.
```

**Required flags:**

- `--label <label>`: Share label
- `--metrics <types>`: Comma-separated metric types
- `--start <date>`: Data start date
- `--end <date>`: Data end date
- `--expires <days>`: Expiration in days

**Optional flags:**

- `--note <note>`: Note shown to the viewer
- `--output <format>`: `table`, `json`

---

#### 8.5.8 `totus shares revoke <id>`

Revoke a share grant.

**Maps to:** `PATCH /api/shares/{shareId}`
**Required scope:** `shares:write`

```
$ totus shares revoke 550e8400-e29b-41d4-a716-446655440000

✓ Share revoked: "For Dr. Patel - annual checkup"
  Revoked at: 2026-03-09T16:00:00Z
```

---

#### 8.5.9 `totus audit list`

Query the audit log.

**Maps to:** `GET /api/audit`
**Required scope:** `audit:read`

```
$ totus audit list --limit 5

Timestamp            Actor    Event          Detail
──────────────────── ──────── ────────────── ──────────────────────────────────
2026-03-09 15:00:00  viewer   data.viewed    sleep_score, hrv via "Dr. Patel"
2026-03-09 14:23:00  viewer   share.viewed   "Dr. Patel" from 73.162.44.12
2026-03-09 10:15:00  owner    share.created  "For Dr. Patel" (4 metrics)
2026-03-08 08:00:00  system   data.imported  24 points from oura
2026-03-08 07:55:00  api_key  data.viewed    Claude Desktop: sleep_score
```

**Flags:**

- `--event-type <type>`: Filter by event type
- `--grant-id <id>`: Filter by share grant
- `--actor-type <type>`: Filter by actor type (`owner`, `viewer`, `system`, `api_key`)
- `--start <date>`: Start of time range
- `--end <date>`: End of time range
- `--limit <n>`: Results per page (default: 50)
- `--output <format>`: `table`, `json`, `csv`

---

#### 8.5.10 `totus keys list`

List API keys.

**Maps to:** `GET /api/keys`
**Required scope:** `keys:read`

```
$ totus keys list

Name              Short Token  Status   Scopes              Last Used        Expires
───────────────── ──────────── ──────── ──────────────────── ──────────────── ───────────────
Claude Desktop    BRTRKFsL     active   health:read +2       2026-03-09       2026-06-07
CI Pipeline       xY9mK2pL     active   health:read +4       2026-03-08       2026-06-08
Old key           aB3cD4eF     revoked  full                 2026-02-15       2026-05-15
```

---

#### 8.5.11 `totus keys create`

Create a new API key.

**Maps to:** `POST /api/keys`
**Required scope:** `keys:write`

```
$ totus keys create --name "Cursor MCP" --scopes health:read,shares:read

✓ API key created
  Name: Cursor MCP
  Key: tot_live_Nm7kP2qR_a9B3c8D4e7F2g5H1j6K0m3N8p
  Scopes: health:read, shares:read
  Expires: 2026-06-07

  ⚠ Save this key now — it will not be shown again.
```

**Required flags:**

- `--name <name>`: Key label

**Optional flags:**

- `--scopes <scopes>`: Comma-separated scopes (default: all scopes the current key has)
- `--expires <days>`: Expiration in days (default: 90)

---

#### 8.5.12 `totus connections list`

List all data source connections for the authenticated user.

**Maps to:** `GET /api/connections`
**Required scope:** `connections:read`

```
$ totus connections list

Provider   Status     Last Sync              Next Sync              Metrics  Connection ID
─────────── ────────── ────────────────────── ────────────────────── ──────── ────────────────────────────────────────
oura        connected  2026-03-11 06:00 UTC   2026-03-11 12:00 UTC   14       a1b2c3d4-e5f6-...
whoop       connected  2026-03-11 05:45 UTC   2026-03-11 11:45 UTC    6       b2c3d4e5-f6a7-...
garmin      expired    2026-02-14 08:00 UTC   —                       13       c3d4e5f6-a7b8-...
```

`Metrics` shows the count of metric types this connection contributes. Use `--verbose` to expand to the full metric list per connection.

```
$ totus connections list --verbose

oura (connected)
  Connection ID:  a1b2c3d4-e5f6-7890-abcd-ef1234567890
  Last sync:      2026-03-11 06:00 UTC
  Next sync:      2026-03-11 12:00 UTC
  Metrics (14):   sleep_score, sleep_duration, sleep_efficiency, hrv, rhr,
                  respiratory_rate, body_temperature_deviation, readiness_score,
                  activity_score, steps, active_calories, total_calories, spo2,
                  heart_rate (series)

whoop (connected)
  Connection ID:  b2c3d4e5-f6a7-8901-bcde-f12345678901
  Last sync:      2026-03-11 05:45 UTC
  Next sync:      2026-03-11 11:45 UTC
  Metrics (6):    hrv, rhr, respiratory_rate, sleep_duration, sleep_efficiency,
                  readiness_score

garmin (expired)
  Connection ID:  c3d4e5f6-a7b8-9012-cdef-123456789012
  Last sync:      2026-02-14 08:00 UTC
  Next sync:      — (reconnect required)
  ⚠ Token expired. Reconnect at https://app.totus.health/dashboard/settings
```

**Flags:**

- `--verbose`, `-v`: Expand to show metric list per connection
- `--output <format>`: `table` (default in TTY), `json`, `csv`

**JSON output shape:**

```json
{
  "connections": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "provider": "oura",
      "status": "connected",
      "last_synced_at": "2026-03-11T06:00:00Z",
      "next_sync_at": "2026-03-11T12:00:00Z",
      "metric_count": 14,
      "metrics": ["sleep_score", "hrv", "..."]
    }
  ]
}
```

---

#### 8.5.13 `totus connections sync`

Trigger a data sync for one or all connections.

**Maps to:** `POST /api/connections/{connectionId}/sync` (single) or `POST /api/connections/sync-all` (all)
**Required scope:** `connections:write`

**Single connection:**

```
$ totus connections sync a1b2c3d4-e5f6-7890-abcd-ef1234567890

✓ Sync triggered for oura
  Job ID: 9f8e7d6c-...
  Status: queued
  Run "totus connections list" to check progress.
```

**All active connections:**

```
$ totus connections sync --all

✓ Sync triggered for 2 connections
  oura    → queued (job: 9f8e7d6c-...)
  whoop   → queued (job: 8e7d6c5b-...)
  garmin  → skipped (status: expired)

  Run "totus connections list" to check progress.
```

Expired or disconnected connections are skipped with a note; they do not cause a non-zero exit code.

**Usage:**

```
totus connections sync <id>    # sync one connection by ID
totus connections sync --all   # sync all active connections
```

Omitting both `<id>` and `--all` is an error:

```
✗ Error: Specify a connection ID or use --all.
  Run "totus connections list" to find connection IDs.
```

**Flags:**

- `--all`: Sync all connections with `status = connected`. Skips expired/disconnected.
- `--output <format>`: `table` (default in TTY), `json`

---

#### 8.5.14 `totus preferences list`

List all user-set source preferences.

**Maps to:** `GET /api/metric-preferences`
**Required scope:** `health:read`

```
$ totus preferences list

Metric Type   Preferred Source  Set By  Since
───────────── ───────────────── ─────── ─────────────────────
hrv           whoop             user    2026-03-01 14:22 UTC
rhr           whoop             user    2026-03-01 14:22 UTC
```

When no preferences are set:

```
$ totus preferences list

No source preferences set. Totus uses auto-resolution (most recent data wins).
Run "totus preferences set <metric_type> <source>" to pin a metric to a specific provider.
```

**Flags:**

- `--output <format>`: `table` (default in TTY), `json`, `csv`

---

#### 8.5.15 `totus preferences set <metric_type> <source>`

Pin a metric type to a specific data source.

**Maps to:** `PUT /api/metric-preferences/{metricType}`
**Required scope:** `health:write`

```
$ totus preferences set hrv whoop

✓ Preference set: hrv → whoop
  Totus will now use whoop as the source for hrv data.
  Run "totus metrics get --metrics hrv ..." to verify.
```

Validates that `<source>` matches an active connection's `provider` field. Errors helpfully if invalid:

```
$ totus preferences set hrv dexcom

✗ Error: No active connection for provider "dexcom".
  Connected providers: oura, whoop
  Run "totus connections list" to see your connections.
```

**Arguments:**

- `<metric_type>`: A valid metric type ID (e.g., `hrv`, `sleep_score`). Run `totus metrics list` to see available IDs.
- `<source>`: A connected provider ID (e.g., `oura`, `whoop`, `garmin`). Run `totus connections list` to see active providers.

---

#### 8.5.16 `totus preferences delete <metric_type>`

Remove a source preference for a metric, reverting to auto-resolution.

**Maps to:** `DELETE /api/metric-preferences/{metricType}`
**Required scope:** `health:write`

```
$ totus preferences delete hrv

✓ Preference cleared: hrv
  Totus will now use auto-resolution for hrv (most recent data source wins).
```

If no preference exists, exits cleanly (idempotent):

```
$ totus preferences delete hrv

  No preference set for hrv. Nothing to remove.
```

---

#### 8.5.17 `totus mcp-server`

Start the MCP Server in stdio mode. This is the entry point for AI clients.

```
$ totus mcp-server
```

This command blocks and communicates via stdin/stdout using JSON-RPC (MCP protocol). It is not intended for interactive use — it is invoked by MCP clients (Claude Desktop, Claude Code, Cursor).

**Environment variable required:** `TOTUS_API_KEY` (or uses stored config).

---

### 8.6 Global Flags

| Flag                | Short | Description                                                |
| ------------------- | ----- | ---------------------------------------------------------- |
| `--api-key <key>`   |       | Override API key for this command                          |
| `--api-url <url>`   |       | Override API URL                                           |
| `--output <format>` | `-o`  | Output format: `table`, `json`, `csv`                      |
| `--no-color`        |       | Disable colored output                                     |
| `--verbose`         | `-v`  | Show request/response details (URLs, status codes, timing) |
| `--version`         | `-V`  | Print version                                              |
| `--help`            | `-h`  | Print help                                                 |

### 8.7 Error Handling

All CLI errors follow a consistent format:

```
$ totus metrics get --metrics invalid_metric --start 2026-01-01 --end 2026-03-01

✗ Error: Invalid metric type "invalid_metric"
  Valid types: sleep_score, hrv, rhr, steps, ...
  Run "totus metrics list" to see available metrics.
```

**Exit codes:**

- `0`: Success
- `1`: General error (API error, validation error)
- `2`: Authentication error (no key, invalid key, expired key)
- `3`: Permission error (insufficient scopes)

### 8.8 Output Format Logic

```
Is --output flag provided?
  │
  YES → Use specified format
  │
  NO → Is stdout a TTY?
        │
        YES → Use 'table' format
        │
        NO → Use 'json' format (for piping)
```

This matches the `gh` CLI pattern. Users piping output to `jq`, `grep`, or files automatically get JSON.

---

## 9. MCP Server Design

### 9.1 Server Configuration

```typescript
// Conceptual structure — not implementation code
const server = new McpServer({
  name: "totus-health",
  version: "1.0.0",
  description: "Totus Health Data Vault — access your biometric data",
});
```

**Transport:** stdio (via `StdioServerTransport`).

**Authentication:** The MCP Server reads `TOTUS_API_KEY` from the environment at startup. If not set, it reads from `~/.config/totus/config.json`. If neither is available, it returns an error on the first tool call.

### 9.2 MCP Tools

Tools are functions the AI model can call. Each tool maps to one or more Totus API calls.

#### 9.2.1 `get_health_data`

Query health metrics for a date range. Queries the `health_data_daily` table by default. The CLI should also support querying `health_data_series` (for intra-day time-series like heart rate samples) and `health_data_periods` (for variable-duration events like sleep stages or workouts) when the user or model requests that level of detail.

**Input Schema:**

```
{
  metrics: z.array(z.string()).min(1).max(10)
    .describe("Metric type IDs to query (e.g., ['sleep_score', 'hrv']). Call list_available_metrics first to get exact IDs for this user."),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .describe("Start date in YYYY-MM-DD format"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .describe("End date in YYYY-MM-DD format. Must be >= start_date."),
  resolution: z.enum(["daily", "weekly", "monthly"]).optional()
    .describe("Aggregation level. Default: daily"),
  source: z.string().optional()
    .describe("Filter to a specific provider (e.g., 'oura', 'whoop', 'garmin'). Omit to use the user's source resolution preferences. Use list_connections to see available provider IDs.")
}
```

**Maps to:** `GET /api/health-data`
**Required scope:** `health:read`

**Response format:** Returns a text content block with formatted data:

```
Health Data: sleep_score, hrv
Period: 2026-02-01 to 2026-03-01 (daily)

sleep_score (score):
  2026-02-01: 85
  2026-02-02: 78
  2026-02-03: 91
  ...
  Average: 84.7 | Min: 62 | Max: 95

hrv (ms):
  2026-02-01: 42.5
  2026-02-02: 38.1
  ...
  Average: 41.2 | Min: 28.3 | Max: 58.9
```

**Why text, not JSON?** MCP tool responses are consumed by the AI model, which processes natural language better than raw JSON. The text format includes summary statistics to help the model reason about trends without needing to compute them.

---

#### 9.2.2 `list_available_metrics`

List all metric types the user has data for. Call this before `get_health_data` when the exact metric IDs are unknown.

**Input Schema:**

```
{
  category: z.enum(["sleep", "cardiovascular", "activity", "body", "readiness", "nutrition"]).optional()
    .describe("Filter by category. Omit to return all categories.")
}
```

**Maps to:** `GET /api/health-data/types`
**Required scope:** `health:read`

**Response:** Text listing of metrics with labels, units, date ranges, data point counts, and resolved source. When a metric has multiple sources, the response notes the resolved source and the count of available providers.

---

#### 9.2.3 `create_share`

Create a share link for a doctor or coach.

**Input Schema:**

```
{
  label: z.string().min(1).max(255)
    .describe("Label for the share (e.g., 'For Dr. Patel')"),
  metrics: z.array(z.string()).min(1)
    .describe("Metric types to share"),
  start_date: z.string()
    .describe("Start of shareable date range (YYYY-MM-DD)"),
  end_date: z.string()
    .describe("End of shareable date range (YYYY-MM-DD)"),
  expires_in_days: z.number().int().min(1).max(365)
    .describe("Days until the share link expires"),
  note: z.string().max(1000).optional()
    .describe("Optional note shown to the viewer")
}
```

**Maps to:** `POST /api/shares`
**Required scope:** `shares:write`

**Response:** Share URL, label, metrics, date range, and expiration.

---

#### 9.2.4 `list_shares`

List existing share grants.

**Input Schema:**

```
{
  status: z.enum(["active", "expired", "revoked", "all"]).optional()
    .describe("Filter by status. Default: all")
}
```

**Maps to:** `GET /api/shares`
**Required scope:** `shares:read`

**Response:** Formatted list of shares with status, view counts, and expiration.

---

#### 9.2.5 `revoke_share`

Revoke a share link.

**Input Schema:**

```
{
  share_id: z.string().uuid()
    .describe("The ID of the share grant to revoke")
}
```

**Maps to:** `PATCH /api/shares/{shareId}`
**Required scope:** `shares:write`

**Response:** Confirmation with share label and revocation timestamp.

---

#### 9.2.6 `get_audit_log`

Query the audit trail.

**Input Schema:**

```
{
  event_type: z.string().optional()
    .describe("Filter by event type (e.g., 'data.viewed', 'share.created')"),
  days: z.number().int().min(1).max(365).optional()
    .describe("Number of days to look back. Default: 30"),
  limit: z.number().int().min(1).max(100).optional()
    .describe("Maximum events to return. Default: 20")
}
```

**Maps to:** `GET /api/audit`
**Required scope:** `audit:read`

**Response:** Formatted audit entries with timestamps, actors, and details.

---

#### 9.2.7 `get_profile`

Get user profile and health data summary.

**Input Schema:** `{}` (no parameters)

**Maps to:** `GET /api/user/profile`
**Required scope:** `profile:read`

**Response:** User name, connected sources, total data points, active shares, data date range.

---

#### 9.2.8 `trigger_sync`

Trigger a data sync for a connected source.

**Input Schema:**

```
{
  connection_id: z.string().uuid()
    .describe("The provider_connections ID to sync. Use list_connections to find IDs.")
}
```

**Maps to:** `POST /api/connections/{connectionId}/sync`
**Required scope:** `connections:write`

**Response:** Sync status confirmation.

---

#### 9.2.9 `list_connections`

List all connected data sources. Use this to discover provider IDs for `trigger_sync` and `get_health_data`'s `source` parameter.

**Input Schema:** `{}` (no parameters)

**Maps to:** `GET /api/connections`
**Required scope:** `connections:read`

**Response format:**

```
Connected Data Sources

oura (connected)
  ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  Last synced: 2026-03-11T06:00:00Z
  Metrics: 14 types (sleep_score, hrv, rhr, steps, ...)

whoop (connected)
  ID: b2c3d4e5-f6a7-8901-bcde-f12345678901
  Last synced: 2026-03-11T05:45:00Z
  Metrics: 6 types (hrv, rhr, respiratory_rate, ...)

garmin (expired)
  ID: c3d4e5f6-a7b8-9012-cdef-123456789012
  Last synced: 2026-02-14T08:00:00Z
  ⚠ Token expired — user must reconnect via the Totus web app.
```

**Output type:** `ConnectionListItem[]`

```typescript
type ConnectionListItem = {
  id: string; // UUID — use as connection_id in trigger_sync
  provider: string; // e.g., "oura", "whoop", "garmin"
  status: "connected" | "expired" | "disconnected" | "syncing" | "error";
  last_synced_at: string | null; // ISO 8601 UTC
  next_sync_at: string | null; // ISO 8601 UTC; null if expired
  metric_count: number;
  metrics: string[]; // metric_type IDs this connection provides
};
```

---

#### 9.2.10 `list_metric_preferences`

List the user's source preferences — which provider is authoritative for each metric when multiple providers overlap. Call this before suggesting source changes to understand the current configuration.

**Input Schema:** `{}` (no parameters)

**Maps to:** `GET /api/metric-preferences`
**Required scope:** `health:read`

**Response format:**

```
Source Preferences

hrv    → whoop   (explicit user preference, set 2026-03-01)
rhr    → whoop   (explicit user preference, set 2026-03-01)

2 preferences set. All other metrics use auto-resolution (most recent source wins).
```

---

#### 9.2.11 `set_metric_preference`

Pin a metric to a specific data source. Use when the user wants a specific provider's data to be authoritative for a metric where multiple sources overlap. Always call `list_connections` first to confirm the provider ID is valid and connected.

**Input Schema:**

```
{
  metric_type: z.string()
    .describe("The metric type ID to set a preference for (e.g., 'hrv', 'rhr'). Call list_available_metrics to get valid IDs."),
  source: z.string()
    .describe("The provider ID to prefer (e.g., 'oura', 'whoop', 'garmin'). Must match an active connection. Call list_connections to get valid provider IDs."),
}
```

**Maps to:** `PUT /api/metric-preferences/{metricType}`
**Required scope:** `health:write`

**Response:** Confirmation of the new preference with before/after state.

---

#### 9.2.12 `delete_metric_preference`

Remove a source preference for a metric, reverting to auto-resolution (most recent data wins). This is idempotent — calling it when no preference exists returns success.

**Input Schema:**

```
{
  metric_type: z.string()
    .describe("The metric type ID to clear the preference for (e.g., 'hrv'). Call list_metric_preferences to see what preferences exist.")
}
```

**Maps to:** `DELETE /api/metric-preferences/{metricType}`
**Required scope:** `health:write`

**Response:** Confirmation that auto-resolution is now active for the metric.

---

### 9.3 MCP Resources

Resources are read-only data the client can browse. They use URI schemes.

#### 9.3.1 `totus://metrics`

List of all available metric types for the user.

**URI:** `totus://metrics`
**Maps to:** `GET /api/health-data/types`

Returns a structured overview of all metrics, categories, and date ranges. Useful for the model to understand what data is available before making tool calls.

---

#### 9.3.2 `totus://profile`

User profile and data summary.

**URI:** `totus://profile`
**Maps to:** `GET /api/user/profile`

Returns user display name, connected sources, data point counts, and active shares.

---

#### 9.3.3 `totus://shares`

Current share grants overview.

**URI:** `totus://shares`
**Maps to:** `GET /api/shares?status=active`

Returns a summary of active shares — useful context for the model to understand existing sharing state.

---

### 9.4 MCP Prompts

Prompts are reusable conversation templates.

#### 9.4.1 `analyze_sleep`

Analyze sleep trends for a given period.

**Arguments:**

```
{
  period: z.enum(["last_7_days", "last_30_days", "last_90_days"])
    .describe("Analysis period")
}
```

**Prompt template:**

```
Analyze my sleep data for the {period}. Look at sleep_score, sleep_duration,
deep_sleep, rem_sleep, and sleep_latency. Identify trends, patterns, and any
concerning changes. Compare weekday vs weekend sleep. Provide actionable
recommendations for improvement.
```

---

#### 9.4.2 `compare_metrics`

Compare two or more metrics over time to find correlations.

**Arguments:**

```
{
  metrics: z.array(z.string()).min(2)
    .describe("Metric type IDs to compare — minimum 2 required (e.g., ['hrv', 'sleep_score', 'steps']). Call list_available_metrics to get valid IDs."),
  period: z.enum(["last_30_days", "last_90_days", "last_180_days"])
    .describe("Comparison period")
}
```

**Prompt template:**

```
Compare my {metrics} data over the {period}. Look for correlations,
inverse relationships, and notable patterns. For example, does my HRV
improve on days with more steps? Does poor sleep correlate with lower
readiness scores? Present findings with specific data points.
```

---

#### 9.4.3 `prepare_share`

Help the user prepare a share link for a specific healthcare provider.

**Arguments:**

```
{
  provider_type: z.enum(["doctor", "coach", "trainer", "nutritionist"])
    .describe("Type of healthcare provider"),
  concern: z.string()
    .describe("Health concern or reason for sharing (e.g., 'sleep issues', 'fitness progress')")
}
```

**Prompt template:**

```
I need to share my health data with my {provider_type} regarding {concern}.
Help me decide which metrics to include, what date range is relevant, and
write a clear note explaining what to look at. Then create the share link
using the create_share tool.
```

---

#### 9.4.4 `health_summary`

Generate a comprehensive health report.

**Arguments:**

```
{
  period: z.enum(["last_7_days", "last_30_days", "last_90_days"])
    .describe("Report period")
}
```

**Prompt template:**

```
Generate a comprehensive health report for the {period}. Include all
available metrics organized by category (sleep, cardiovascular, activity,
body). For each metric, report the average, trend direction, and any
notable outliers. Highlight the most significant positive and negative
changes. End with 3 actionable takeaways.
```

---

### 9.5 MCP Server Error Handling

The MCP Server handles errors at two levels:

**1. Configuration errors (no API key, invalid URL):**

- Return an `isError: true` response on the first tool call with a clear message.
- Do not crash the server process — the user may fix the config and retry.

**2. API errors (401, 403, 429, 500):**

- Map to descriptive MCP error responses:

| HTTP Status | MCP Response                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------- |
| 401         | "Authentication failed. Your API key may be invalid or expired. Run 'totus auth status' to check." |
| 403         | "Insufficient permissions. Your API key needs the '{scope}' scope for this action."                |
| 429         | "Rate limited. Please wait before making more requests."                                           |
| 500+        | "The Totus API encountered an error. Please try again."                                            |

---

## 10. Client Setup Instructions

### 10.1 Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "totus-health": {
      "command": "totus",
      "args": ["mcp-server"],
      "env": {
        "TOTUS_API_KEY": "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG"
      }
    }
  }
}
```

### 10.2 Claude Code

```bash
claude mcp add totus-health -- totus mcp-server
```

Or with explicit API key:

```bash
claude mcp add totus-health \
  --env TOTUS_API_KEY="tot_live_BRTRKFsL_..." \
  -- totus mcp-server
```

### 10.3 Cursor

Add to `.cursor/mcp.json` in the project root or global config:

```json
{
  "mcpServers": {
    "totus-health": {
      "command": "totus",
      "args": ["mcp-server"],
      "env": {
        "TOTUS_API_KEY": "tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG"
      }
    }
  }
}
```

### 10.4 VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "totus-health": {
      "command": "totus",
      "args": ["mcp-server"],
      "env": {
        "TOTUS_API_KEY": "tot_live_BRTRKFsL_..."
      }
    }
  }
}
```

---

## 11. Security

### 11.1 API Key Security

| Concern                    | Mitigation                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Key in shell history       | Recommend `TOTUS_API_KEY` env var or `totus auth login` (interactive prompt). Document `export HISTCONTROL=ignorespace` pattern. |
| Key in config file         | File created with `0600` permissions. CLI warns on first run if permissions are looser.                                          |
| Key in MCP config          | MCP config files are user-local. Document that keys should not be committed to git.                                              |
| Key in error logs          | CLI and MCP Server never log the full API key. Only the short_token (`...BRTRKFsL`) appears in logs.                             |
| Key committed to git       | `tot_live_` and `tot_test_` prefixes enable GitHub/GitLab secret scanning. `.gitignore` template includes config paths.          |
| Key in terminal scrollback | Acceptable risk — same as any CLI that displays sensitive data. Document awareness.                                              |

### 11.2 Health Data in Terminal Output

- The CLI includes a one-time notice on first use:
  ```
  ℹ Health data will be displayed in your terminal. Terminal scrollback
    buffers may persist this data. Use --output json > file.json to
    redirect output to a file instead.
  ```
- This notice is shown once and stored in config as `"phi_notice_shown": true`.

### 11.3 Transport Security

- The CLI and MCP Server refuse to connect over plain HTTP (non-localhost URLs must be HTTPS).
- Exception: `http://localhost:*` is allowed for development.
- All API requests use HTTPS with system-trusted certificates. No certificate pinning at MVP.

### 11.4 MCP Server Security

- The MCP Server runs as a local process with the user's permissions. It does not listen on any network port (stdio only).
- The API key is the sole credential. It is passed via environment variable, never via MCP protocol messages.
- The MCP Server does not cache health data between tool calls. Each tool call is a fresh API request.
- The MCP Server does not write any data to disk (no temp files, no logs to files).

---

## 12. Failure Modes

### 12.1 No API Key Configured

**Trigger:** User runs CLI command or AI calls MCP tool without a configured API key.

**CLI behavior:**

```
✗ Error: No API key configured
  Run "totus auth login" to authenticate, or set TOTUS_API_KEY environment variable.
```

Exit code: 2.

**MCP behavior:** Returns `isError: true` response with setup instructions.

### 12.2 Expired API Key

**Trigger:** API key has passed its `expires_at` timestamp.

**CLI behavior:**

```
✗ Error: API key has expired (expired 2026-03-01)
  Create a new key at https://totus.com/dashboard/settings or run "totus keys create".
```

Exit code: 2.

**MCP behavior:** Returns error response suggesting key rotation.

### 12.3 Revoked API Key

**CLI/MCP behavior:** Same as expired key, but message says "revoked" instead of "expired."

### 12.4 Insufficient Scopes

**Trigger:** API key does not have the required scope for the requested operation.

**CLI behavior:**

```
✗ Error: Insufficient permissions
  This operation requires the "shares:write" scope.
  Your key (BRTRKFsL) has: health:read, shares:read
  Create a new key with the required scope.
```

Exit code: 3.

### 12.5 Network Failure

**CLI behavior:**

```
✗ Error: Could not connect to Totus API
  URL: https://totus.com/api/health-data
  Error: ECONNREFUSED
  Check your internet connection and try again.
```

Exit code: 1. No retry (user retries manually).

**MCP behavior:** Returns error response. The AI model can decide to retry or inform the user.

### 12.6 Rate Limiting

**CLI behavior:**

```
✗ Error: Rate limited (429)
  Retry after: 45 seconds
  Hint: Reduce request frequency or contact support for higher limits.
```

Exit code: 1.

---

## 13. Dependencies

### 13.1 Runtime Dependencies

| Package                     | Version   | Purpose                | Failure Impact                    |
| --------------------------- | --------- | ---------------------- | --------------------------------- |
| `commander`                 | `^13.0.0` | CLI argument parsing   | CLI does not start                |
| `@modelcontextprotocol/sdk` | `^1.27.0` | MCP Server             | MCP Server does not start         |
| `zod`                       | `^3.25.0` | Input validation       | Validation fails (build-time)     |
| `cli-table3`                | `^0.6.0`  | Table formatting       | Falls back to JSON output         |
| `csv-stringify`             | `^6.0.0`  | CSV formatting         | Falls back to JSON output         |
| `chalk`                     | `^5.0.0`  | Terminal colors        | Graceful degradation (no colors)  |
| `ora`                       | `^8.0.0`  | Spinners               | Graceful degradation (no spinner) |
| `conf`                      | `^13.0.0` | Config file management | Falls back to env var only        |

### 13.2 External Dependencies

| Dependency        | What Uses It                    | Failure Impact                                           |
| ----------------- | ------------------------------- | -------------------------------------------------------- |
| Totus API (HTTPS) | All CLI commands, all MCP tools | Complete failure. Both CLI and MCP Server return errors. |
| npm registry      | Installation only               | Cannot install. Not a runtime dependency.                |

---

## 14. Testing Strategy

### 14.1 Unit Tests (Vitest)

- API key format parsing: validate `tot_live_{8}_{32}` extraction.
- API key generation: verify randomness, format, hash determinism.
- Scope validation: test subset checks, unknown scopes, empty scopes.
- Output formatters: test table, JSON, and CSV rendering for each data type.
- CLI argument parsing: test every command with valid and invalid flags.
- MCP tool input validation: test each tool's Zod schema.
- API key resolution: test precedence (flag > env > config).
- Error message formatting: test all error types and exit codes.

### 14.2 Integration Tests

- API key CRUD: create, list, revoke, verify auth flow.
- API key auth middleware: test valid key, expired key, revoked key, missing key, invalid format.
- Scope enforcement: test each scope against each endpoint.
- Audit logging: verify `actor_type: 'api_key'` events are emitted.
- Rate limiting: verify API key rate limits (separate from session limits).

### 14.3 E2E Tests

- CLI auth flow: `totus auth login` → `totus auth status` → `totus metrics list`.
- MCP Server: spawn server, send JSON-RPC tool call, verify response.
- CLI piping: `totus metrics get --output json | jq '.metrics.sleep_score.points | length'`.

---

## 15. Design Alternatives Considered

### 15.1 OAuth Device Authorization Grant (RFC 8628) for CLI Auth

**Considered:** Browser-based OAuth flow where the CLI displays a URL and code, user authenticates in the browser, and the CLI polls for a token.

**Deferred because:**

- Adds significant complexity (device code endpoint, polling logic, token exchange).
- API keys are simpler, well-understood, and sufficient for MVP.
- The user already authenticates in the browser to create the first API key — the OAuth flow would add an additional auth step, not replace one.
- Can be added post-MVP as an alternative to `totus auth login`.

### 15.2 Separate MCP Server Package

**Considered:** Publishing the MCP Server as a separate npm package (`@totus/mcp-server`).

**Rejected because:**

- The CLI and MCP Server share 80%+ of code (API client, auth resolution, response parsing).
- A single package is simpler to install, version, and maintain.
- The `totus mcp-server` subcommand is a natural extension of the CLI.
- Users who only want the MCP Server still install one package.

### 15.3 Remote MCP Server (Streamable HTTP)

**Considered:** Hosting the MCP Server on Vercel as a Streamable HTTP endpoint so users don't need to install anything.

**Deferred because:**

- OAuth 2.1 flow required by the MCP spec for remote servers adds significant complexity.
- stdio transport covers 100% of current MCP clients (Claude Desktop, Claude Code, Cursor, VS Code).
- A local server has lower latency (no double network hop: client→MCP→API, vs client→API with local MCP).
- Can be added post-MVP when Streamable HTTP adoption matures.

### 15.4 GraphQL API for Programmatic Access

**Considered:** A separate GraphQL endpoint for CLI/MCP use (more flexible querying).

**Rejected because:**

- The REST API already serves the exact query patterns needed.
- GraphQL adds a second API surface to maintain, secure, and document.
- The existing REST endpoints with Zod schemas provide equivalent type safety.
- MCP tools are the "flexible query" layer — the model constructs the right API call.

### 15.5 Session Token Auth (Clerk) for CLI

**Considered:** Having the CLI authenticate via Clerk (browser OAuth → session token).

**Rejected because:**

- Clerk sessions are cookie-based and tied to browser contexts.
- Clerk's session tokens are short-lived (hours) and require refresh — impractical for long-running scripts and MCP servers.
- API keys are the standard pattern for programmatic access (GitHub, Stripe, Vercel all use API keys for CLI auth).
- Clerk remains the browser auth mechanism; API keys are the programmatic mechanism.

---

## 16. Cost Impact

| Component                            | Additional Cost | Notes                                                                                             |
| ------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------- |
| `api_keys` table storage             | ~$0             | < 5,000 rows. Negligible on Aurora.                                                               |
| Additional API requests from CLI/MCP | ~$0-2/month     | KMS calls increase slightly if MCP triggers more health data reads. DEK cache absorbs most of it. |
| npm registry (package hosting)       | $0              | npm public packages are free.                                                                     |
| **Total additional cost**            | **~$0-2/month** |                                                                                                   |

---

## 17. Implementation Roadmap

### Phase 1: API Key System

- [ ] `api_keys` database table + Drizzle schema + migration
- [ ] API key generation utility (`tot_live_` format, SHA-256 hashing)
- [ ] Middleware: API key auth path (parse header, validate, build RequestContext)
- [ ] Scope enforcement in `enforcePermissions()`
- [ ] API endpoints: `POST /api/keys`, `GET /api/keys`, `PATCH /api/keys/{keyId}`
- [ ] Audit event types: `key.created`, `key.revoked`, `key.used`
- [ ] Unit + integration tests for key auth

### Phase 2: CLI Core

- [ ] Package setup (`@totus/cli`, Commander.js, TypeScript)
- [ ] API client module (HTTP client with API key auth, error handling)
- [ ] Config management (`~/.config/totus/config.json`)
- [ ] Output formatters (table, JSON, CSV, auto-detect TTY)
- [ ] Auth commands: `login`, `logout`, `status`, `token`
- [ ] Health data commands: `metrics list` (with `--all-sources` flag), `metrics get` (with `--source` flag), `metrics summary` (with `--verbose` flag)
- [ ] Share commands: `shares list`, `shares get`, `shares create`, `shares revoke`
- [ ] Audit command: `audit list`
- [ ] Connection commands: `connections list` (with `--verbose`), `connections sync <id>` and `connections sync --all`
- [ ] Preferences commands: `preferences list`, `preferences set <metric> <source>`, `preferences delete <metric>`
- [ ] Key management commands: `keys list`, `keys create`, `keys revoke`
- [ ] Profile and export commands
- [ ] Unit tests for all commands

### Phase 3: MCP Server

- [ ] MCP Server setup (`@modelcontextprotocol/sdk`, stdio transport)
- [ ] 12 MCP tools: `get_health_data` (with `source` param), `list_available_metrics`, `create_share`, `list_shares`, `revoke_share`, `get_audit_log`, `get_profile`, `trigger_sync`, `list_connections`, `list_metric_preferences`, `set_metric_preference`, `delete_metric_preference`
- [ ] 3 MCP resources (metrics, profile, shares)
- [ ] 4 MCP prompts (sleep analysis, comparison, share prep, health summary)
- [ ] Error handling and status reporting
- [ ] Client setup documentation (Claude Desktop, Claude Code, Cursor, VS Code)
- [ ] E2E tests (spawn server, send tool calls, verify responses)

### Phase 4: Polish and Publish

- [ ] PHI notice on first CLI use
- [ ] Config file permission checks
- [ ] `--verbose` mode with request/response logging
- [ ] npm package build and publish workflow
- [ ] README with installation, quick start, and configuration

**Total estimated effort: 9 days**

---

## 18. Resolved Questions

| ID   | Question                                                          | Resolution                                                                                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OQ-1 | Should the web UI include an API key management page in Settings? | **Yes — resolved.** The first API key must be created via browser (chicken-and-egg: you need a key to use the CLI, but you can't use the CLI without a key). A simple table + "Create Key" button in `/dashboard/settings` is minimal effort and required. The web UI key management page is added to the Web UI LLD implementation scope. |
| OQ-2 | Should API keys support IP allowlisting?                          | **Deferred to post-MVP — resolved.** The scope system + expiration + rate limiting provides sufficient security for MVP scale (500 users). IP allowlisting adds complexity (CIDR parsing, IPv6 support, UX for non-technical users). Revisit when enterprise or compliance customers request it.                                           |
| OQ-3 | Should the MCP Server support `resource_changed` notifications?   | **Deferred — resolved.** The API has no push mechanism (no WebSocket/SSE). The MCP Server would need to poll, adding complexity and API load. The model can call `get_health_data` on demand. Revisit when the API adds real-time capabilities (post-MVP).                                                                                 |
| OQ-4 | npm package or standalone binary?                                 | **npm package for MVP, binary migration planned — resolved.** See Section 18.1 below for full rationale.                                                                                                                                                                                                                                   |

### 18.1 OQ-4 Decision: npm Package vs Standalone Binary

**Context:** Claude Code moved from npm (`@anthropic-ai/claude-code`) to a standalone binary distribution. The question is whether Totus should follow the same path.

**Why Claude Code moved to binary:**

- No Node.js/npm prerequisite — reaches non-developer users
- Faster startup (~50ms vs ~200-300ms with Node module resolution)
- Single-file distribution — no `node_modules`, no version conflicts
- Bundled runtime — avoids Node version compatibility issues
- No `npm install -g` permission headaches

**Why Totus starts with npm:**

- **Target audience is developers.** MVP users are quantified-self power users who already have Node/Bun installed. They use Oura rings, CGMs, and AI coding tools — they have a package manager.
- **Distribution infrastructure is free.** npm hosting costs $0. A binary distribution requires: GitHub Releases workflow, install script (`curl | sh`), Homebrew tap, per-platform builds (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64), code signing (macOS notarization), and an auto-update mechanism. That is 2-3 extra days of work.
- **MCP clients don't care.** Claude Desktop, Claude Code, and Cursor all invoke `command: "totus"` — they don't know or care whether `totus` is an npm global or a standalone binary.
- **Bun makes the gap smaller.** `bun install -g` is fast, and Bun's module resolution is significantly faster than Node's — startup overhead is closer to ~150ms, not 300ms.

**Binary migration path (post-MVP):**

- `bun build --compile` produces standalone executables from the same TypeScript source with zero code changes.
- The resulting binary bundles the Bun runtime — no external dependencies.
- Output: platform-specific binaries (~50-80 MB) uploaded to GitHub Releases.
- Install via: `curl -fsSL https://totus.com/install.sh | sh` or `brew install totus/tap/totus`.
- The npm package continues to work alongside the binary (users choose their preferred install method).
- **Trigger for migration:** When non-developer users (doctors, coaches) need CLI/MCP access, or when startup time becomes a user complaint.

---

## 19. Appendix

### 19.1 API Key Format Validation Regex

```
/^tot_(live|test)_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/
```

### 19.2 Full Scope List (Machine-Readable)

```json
[
  "health:read",
  "health:write",
  "shares:read",
  "shares:write",
  "audit:read",
  "connections:read",
  "connections:write",
  "profile:read",
  "keys:read",
  "keys:write"
]
```

### 19.3 Audit Event Resource Detail Schemas (Additions)

**`key.created`:**

```json
{
  "api_key_id": "550e8400-...",
  "api_key_name": "Claude Desktop",
  "scopes": ["health:read", "shares:read"],
  "expires_at": "2026-06-07T14:23:01.000Z"
}
```

**`key.revoked`:**

```json
{
  "api_key_id": "550e8400-...",
  "api_key_name": "Claude Desktop"
}
```

**`key.used` (daily summary):**

```json
{
  "api_key_id": "550e8400-...",
  "api_key_name": "Claude Desktop",
  "date": "2026-03-09"
}
```

### 19.4 Example MCP JSON-RPC Exchange

**Client → Server (tool call):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_health_data",
    "arguments": {
      "metrics": ["sleep_score", "hrv"],
      "start_date": "2026-02-01",
      "end_date": "2026-03-01",
      "resolution": "daily"
    }
  }
}
```

**Server → Client (response):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Health Data: sleep_score, hrv\nPeriod: 2026-02-01 to 2026-03-01 (daily)\n\nsleep_score (score):\n  2026-02-01: 85\n  2026-02-02: 78\n  ...\n  Average: 84.7 | Min: 62 | Max: 95\n\nhrv (ms):\n  2026-02-01: 42.5\n  ..."
      }
    ]
  }
}
```

### 19.5 Configuration File Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "api_key": {
      "type": "string",
      "pattern": "^tot_(live|test)_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$"
    },
    "api_url": {
      "type": "string",
      "format": "uri",
      "default": "https://totus.com/api"
    },
    "default_output": {
      "type": "string",
      "enum": ["table", "json", "csv"],
      "default": "table"
    },
    "phi_notice_shown": {
      "type": "boolean",
      "default": false
    }
  }
}
```
