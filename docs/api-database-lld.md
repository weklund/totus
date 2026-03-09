# Totus MVP Low-Level Design: API Layer and Database

### Version 1.0 — March 2026

### Author: Architecture Team

### Status: Approved — All open questions resolved (March 2026)

---

## 1. Overview

**Purpose.** This document specifies the complete low-level design for the Totus MVP API layer and database. It defines every API endpoint with full request/response schemas, every database table with exact column types and constraints, every index, every SQL query pattern, and every error code. It is the implementation blueprint — an engineer (or AI coding agent) should be able to build the backend by following this document line by line.

**Audience.** The founder (Wes Eklund), implementation agents, and any future backend engineers.

**Prerequisite Reading.**

- Totus MVP PRD (v1.0) — `/docs/mvp-prd.md`
- Totus Architecture Design (v1.0) — `/docs/architecture-design.md`
- Oura API v2 documentation — https://cloud.ouraring.com/v2/docs

**Scope.** API routes and database only. This document does NOT cover frontend components, UI layouts, deployment pipelines, or Vercel configuration. It DOES cover the Next.js API route handlers, middleware auth logic, Drizzle ORM schemas, PostgreSQL DDL, and all data access patterns.

---

## 2. Problem Statement

The Architecture Design established the system's high-level shape: Clerk for auth, PostgreSQL on Aurora Serverless v2, envelope encryption via KMS, a unified permission model, and an immutable audit log. What it did NOT specify is the precise contract surface — the exact HTTP methods, URL paths, request bodies, response shapes, status codes, database column sizes, index strategies, and query patterns that an implementation agent needs to build working code.

This LLD closes that gap. It translates architectural decisions into concrete, implementable specifications. Every ambiguity in the architecture document is resolved here with an explicit decision.

---

## 3. Glossary

| Term                    | Definition                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Owner**               | An authenticated Totus user (via Clerk) who owns health data.                                                                                          |
| **Viewer**              | An unauthenticated visitor accessing data through a share link. No Totus account.                                                                      |
| **Share Grant**         | A permission record that defines what metrics, date range, and expiration a viewer can access.                                                         |
| **Share Token**         | A 32-byte cryptographically random value (base64url-encoded, 43 chars) that acts as the viewer's credential.                                           |
| **DEK**                 | Data Encryption Key — a symmetric key generated via KMS `GenerateDataKey`, used to encrypt health data values locally.                                 |
| **CMK**                 | Customer Master Key — the KMS key that wraps/unwraps DEKs. One per user.                                                                               |
| **Envelope Encryption** | Pattern where data is encrypted with a DEK, and the DEK is encrypted with a CMK. Only the encrypted DEK is stored alongside ciphertext.                |
| **RequestContext**      | The unified context object produced by middleware, containing actor identity, role, permissions, and request metadata.                                 |
| **Metric Type**         | A string identifier for a health measurement category (e.g., `sleep_score`, `hrv`, `weight`).                                                          |
| **Resolution**          | The temporal granularity of returned data: `daily` (default), `weekly`, or `monthly`. Weekly and monthly are server-side averages.                     |
| **Cursor Pagination**   | Pagination strategy using an opaque cursor (encoded `created_at` + `id`) rather than page numbers. Provides stable pagination under concurrent writes. |

---

## 4. Tenets

These tenets guide every API and data design decision in this document. When tenets conflict, earlier tenets take priority.

1. **Security is not optional; it is structural.** Every data path enforces permissions. Every data access is audited. Encryption is mandatory. There is no "admin bypass" or "debug mode" that skips these checks.

2. **The API is the security boundary, not the frontend.** Frontend checks are UX conveniences. The API validates, authorizes, and audits independently of what the frontend sends.

3. **Explicit over clever.** Every endpoint has a single, clear purpose. No overloaded endpoints that behave differently based on obscure query parameter combinations. No implicit side effects.

4. **Fail closed.** If permission state is ambiguous, deny access. If a grant cannot be validated, reject the request. If encryption fails, do not store plaintext.

5. **Audit everything, block nothing.** Audit log writes are fire-and-forget. A failure to write an audit record must never block a data response. But the system must alert on audit write failures so they can be investigated.

6. **Minimize round trips.** The API should return enough data for the frontend to render without follow-up requests. Batch where possible. Avoid chatty protocols.

7. **Schema is documentation.** Zod schemas, Drizzle table definitions, and OpenAPI types are the source of truth. Runtime validation uses the same schemas the documentation describes.

---

## 5. Requirements

### 5.1 Functional Requirements

| ID       | Requirement                                                                                             | Source                         |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------ |
| FR-API-1 | Expose RESTful endpoints for health data queries with metric type, date range, and resolution filters   | PRD: Dashboard                 |
| FR-API-2 | Expose endpoints for Oura OAuth initiation and callback, with encrypted token storage                   | PRD: One-click Oura connection |
| FR-API-3 | Expose endpoints for share grant CRUD: create, list, revoke, delete                                     | PRD: Secure Sharing            |
| FR-API-4 | Expose a public endpoint for share token validation and viewer data access                              | PRD: No-account viewer         |
| FR-API-5 | Expose a paginated, filterable audit log query endpoint                                                 | PRD: Transparency              |
| FR-API-6 | Expose user profile read/update and account deletion endpoints                                          | PRD: Data Control              |
| FR-API-7 | Expose a data export endpoint that packages all user data                                               | PRD: Data Control              |
| FR-API-8 | Every data-reading endpoint emits an audit event recording who accessed what                            | Arch: Section 6                |
| FR-DB-1  | Store health data with per-user envelope encryption, one row per user/metric/date/source                | Arch: Section 7                |
| FR-DB-2  | Store share grants with hashed tokens, allowed metrics array, date boundaries, and expiration           | Arch: Section 4                |
| FR-DB-3  | Store audit events in an append-only table with no UPDATE or DELETE capability for the application role | Arch: Section 6                |
| FR-DB-4  | Store Oura OAuth tokens encrypted with the user's DEK                                                   | Arch: Section 7                |
| FR-DB-5  | Support upsert semantics for health data (re-syncing the same date should update, not duplicate)        | Arch: UNIQUE constraint        |

### 5.2 Non-Functional Requirements

| ID    | Requirement                          | Target                                                                                                 |
| ----- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| NFR-1 | Health data query latency (p95)      | < 500ms for up to 5 years of daily data (~1,825 rows per metric)                                       |
| NFR-2 | Share token validation latency (p95) | < 200ms                                                                                                |
| NFR-3 | API availability                     | 99.9% (aligned with Aurora Serverless SLA)                                                             |
| NFR-4 | Concurrent users at MVP              | 500 registered, ~50 concurrent                                                                         |
| NFR-5 | Audit log query latency (p95)        | < 1s for paginated results (50 per page)                                                               |
| NFR-6 | Rate limiting                        | Per-IP and per-user, configurable per endpoint                                                         |
| NFR-7 | API response format                  | JSON, consistent error envelope, OpenAPI-compliant                                                     |
| NFR-8 | Database encryption at rest          | AWS-managed encryption (Aurora default) + application-level envelope encryption for health data values |

### 5.3 Out of Scope

- Real-time data streaming (WebSockets, SSE)
- GraphQL API
- Mobile-specific API endpoints
- Multi-region database replication
- API versioning beyond `/api/` prefix (v2 paths deferred)
- Webhook delivery to external systems
- Apple Health / Google Fit / Garmin integrations (v1.1+)

### 5.4 Success Criteria

- All API endpoints pass automated integration tests with >95% branch coverage on auth/permission paths.
- Database migrations run cleanly from empty schema to current.
- Health data query for 5 years of daily data for 3 metrics returns in under 500ms.
- Share token brute-force is computationally infeasible (256-bit token space + rate limiting).
- Audit log is provably immutable (database role cannot UPDATE or DELETE).

---

## 6. Architecture Overview

This section places the API and database within the broader system context established by the Architecture Design.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                    │
│                                                                     │
│  Owner Browser ──────┐                  Viewer Browser ─────┐       │
│  (Clerk session)     │                  (Share token)        │       │
└──────────────────────┼──────────────────────────────────────┼───────┘
                       │ HTTPS                                │ HTTPS
                       ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     VERCEL EDGE + SERVERLESS                         │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Next.js Middleware                          │  │
│  │  Route: /*                                                    │  │
│  │  1. Clerk auth check (owner sessions)                         │  │
│  │  2. Viewer token check (cookie: totus_viewer)                 │  │
│  │  3. Rate limiting (IP-based)                                  │  │
│  │  4. Produce RequestContext → headers                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                    API Route Handlers                          │  │
│  │                                                               │  │
│  │  /api/connections/*     Oura OAuth, sync trigger              │  │
│  │  /api/health-data       Query health metrics                  │  │
│  │  /api/shares/*          Share grant CRUD                      │  │
│  │  /api/audit             Audit log query                       │  │
│  │  /api/user/*            Profile, export, delete               │  │
│  │  /api/viewer/validate   Share token validation                │  │
│  │  /api/viewer/data       Viewer health data access             │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                    Service Layer                               │  │
│  │                                                               │  │
│  │  HealthDataService   ShareService   AuditService              │  │
│  │  EncryptionService   OuraService    UserService               │  │
│  └──────┬──────────────────┬─────────────────────┬──────────────┘  │
│         │                  │                     │                   │
└─────────┼──────────────────┼─────────────────────┼──────────────────┘
          │                  │                     │
          ▼                  ▼                     ▼
┌──────────────┐   ┌──────────────┐      ┌──────────────────┐
│  PostgreSQL  │   │   AWS KMS    │      │    Oura API      │
│  Aurora v2   │   │              │      │    (External)    │
│              │   │  Per-user    │      │                  │
│  5 tables    │   │  CMKs        │      │  OAuth2 + REST   │
│  (see Sec 8) │   │              │      │                  │
└──────────────┘   └──────────────┘      └──────────────────┘
```

### API Route Namespace Convention

All API routes live under `/api/`. The structure follows resource-oriented REST conventions:

```
/api/connections          Owner: Oura connection management
/api/health-data          Owner: Health data queries
/api/shares               Owner: Share grant management
/api/audit                Owner: Audit log queries
/api/user                 Owner: Profile and account management
/api/viewer/validate      Public: Share token validation
/api/viewer/data          Viewer: Scoped health data access
```

Owner endpoints require a valid Clerk session. Viewer endpoints require a valid viewer session cookie (issued after token validation). The `/api/viewer/validate` endpoint is the only truly public API endpoint.

---

## 7. API Design

### 7.1 Common Conventions

**Base URL:** `https://totus.com/api` (production), `http://localhost:3000/api` (development)

**Content Type:** All request and response bodies are `application/json`.

**Authentication Header Flow:**

- Owner routes: Clerk session cookie (`__session`) is automatically included by the browser. The middleware resolves it to a Clerk user ID.
- Viewer routes: `totus_viewer` cookie (httpOnly, secure, SameSite=Lax) containing a signed JWT. Issued by `/api/viewer/validate`.
- No API key or Bearer token scheme for MVP. All auth is cookie-based (browser clients only).

**Standard Error Response Envelope:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description of what went wrong",
    "details": [
      {
        "field": "metrics",
        "message": "Must contain at least one valid metric type"
      }
    ]
  }
}
```

**Error Codes (used across all endpoints):**

| HTTP Status | Error Code            | When Used                                                               |
| ----------- | --------------------- | ----------------------------------------------------------------------- |
| 400         | `VALIDATION_ERROR`    | Request body or query params fail Zod validation                        |
| 400         | `INVALID_DATE_RANGE`  | `start` is after `end`, or dates are malformed                          |
| 400         | `INVALID_METRIC_TYPE` | Requested metric type is not in the known enum                          |
| 401         | `UNAUTHORIZED`        | No valid session (owner or viewer)                                      |
| 403         | `FORBIDDEN`           | Valid session but insufficient permissions for this resource            |
| 403         | `SHARE_EXPIRED`       | Share grant has passed its `grant_expires` timestamp                    |
| 403         | `SHARE_REVOKED`       | Share grant has been revoked by the owner                               |
| 404         | `NOT_FOUND`           | Requested resource does not exist                                       |
| 404         | `SHARE_NOT_FOUND`     | Share token does not match any grant (generic, no info leak)            |
| 409         | `CONFLICT`            | Resource already exists (e.g., duplicate Oura connection)               |
| 429         | `RATE_LIMITED`        | Too many requests from this IP or user                                  |
| 500         | `INTERNAL_ERROR`      | Unhandled server error (details omitted in response, logged internally) |
| 502         | `UPSTREAM_ERROR`      | External service (Oura API, KMS) returned an error                      |
| 503         | `SERVICE_UNAVAILABLE` | Database connection pool exhausted or KMS unavailable                   |

**Rate Limits:**

| Endpoint Category      | Limit        | Window   | Scope              |
| ---------------------- | ------------ | -------- | ------------------ |
| Owner API (general)    | 100 requests | 1 minute | Per Clerk user ID  |
| Health data query      | 30 requests  | 1 minute | Per Clerk user ID  |
| Share token validation | 10 requests  | 1 minute | Per IP address     |
| Viewer data access     | 30 requests  | 1 minute | Per viewer session |
| Oura sync trigger      | 3 requests   | 1 hour   | Per Clerk user ID  |

Rate limit responses include headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix timestamp).

**Pagination Convention (Cursor-Based):**

Paginated endpoints accept `cursor` (opaque string, omit for first page) and `limit` (integer, default 50, max 100). Responses include:

```json
{
  "data": [...],
  "pagination": {
    "next_cursor": "eyJjIjoiMjAyNi0wMy0wOFQxNDoyMzowMS4wMDBaIiwiaSI6MTIzNH0",
    "has_more": true
  }
}
```

The cursor encodes `created_at` ISO timestamp + `id` as a base64url JSON object. This provides stable ordering even with concurrent inserts.

**Timestamp Format:** All timestamps in API responses use ISO 8601 with timezone: `2026-03-08T14:23:01.000Z`. All date-only fields use `YYYY-MM-DD`.

---

### 7.2 Connections API

#### 7.2.1 GET /api/connections

List the user's connected data sources.

**Auth:** Owner (Clerk session required)

**Query Parameters:** None

**Response 200:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "provider": "oura",
      "status": "connected",
      "last_sync_at": "2026-03-08T08:00:00.000Z",
      "connected_at": "2026-02-15T10:30:00.000Z"
    }
  ]
}
```

**Response Fields:**

| Field          | Type             | Description                                                 |
| -------------- | ---------------- | ----------------------------------------------------------- |
| `id`           | `string (UUID)`  | Connection record ID                                        |
| `provider`     | `string`         | Provider identifier. MVP: only `"oura"`                     |
| `status`       | `string`         | One of: `connected`, `expired`, `error`                     |
| `last_sync_at` | `string \| null` | ISO timestamp of last successful sync, null if never synced |
| `connected_at` | `string`         | ISO timestamp when connection was established               |

`status` derivation logic:

- `connected`: `token_expires_at` is in the future
- `expired`: `token_expires_at` is in the past (needs re-auth)
- `error`: last sync attempt failed (stored in a `sync_error` field)

**Error Responses:** 401

---

#### 7.2.2 GET /api/connections/oura/authorize

Initiate Oura OAuth2 flow. Returns the authorization URL for the frontend to redirect to.

**Auth:** Owner (Clerk session required)

**Query Parameters:** None

**Response 200:**

```json
{
  "authorization_url": "https://cloud.ouraring.com/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&state=...&scope=daily+heartrate+workout+tag+session+sleep+spo2"
}
```

The `state` parameter is a signed JWT containing `{ userId, nonce, exp }` (expires in 10 minutes) to prevent CSRF on the callback.

**Error Responses:** 401, 409 (if Oura already connected — user must disconnect first)

---

#### 7.2.3 GET /api/connections/oura/callback

Oura OAuth2 callback. Exchanges the authorization code for tokens, encrypts them, and stores the connection.

**Auth:** None (callback from Oura). The `state` parameter validates the originating user.

**Query Parameters:**

| Param   | Type     | Required | Description                        |
| ------- | -------- | -------- | ---------------------------------- |
| `code`  | `string` | Yes      | Authorization code from Oura       |
| `state` | `string` | Yes      | Signed JWT from the authorize step |

**Processing:**

1. Validate and decode `state` JWT. Extract `userId`.
2. Exchange `code` for `access_token` and `refresh_token` with Oura token endpoint.
3. Encrypt both tokens with the user's DEK (envelope encryption).
4. Upsert into `oura_connections` table.
5. Emit `account.connected` audit event.
6. Trigger initial data sync (async, non-blocking).
7. Redirect to `/dashboard?connected=oura`.

**Response:** 302 redirect to `/dashboard?connected=oura` on success, or `/dashboard?error=oura_connect_failed` on failure.

**Error Handling:**

- Invalid/expired `state`: redirect to `/dashboard?error=oura_state_invalid`
- Oura token exchange failure: redirect to `/dashboard?error=oura_token_failed`
- Encryption failure: redirect to `/dashboard?error=internal_error`

---

#### 7.2.4 DELETE /api/connections/{connectionId}

Disconnect a data source. Deletes the connection record and encrypted tokens. Does NOT delete imported health data.

**Auth:** Owner (Clerk session required)

**Path Parameters:**

| Param          | Type            | Description              |
| -------------- | --------------- | ------------------------ |
| `connectionId` | `string (UUID)` | The connection record ID |

**Response 200:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "provider": "oura",
    "disconnected_at": "2026-03-08T14:00:00.000Z"
  }
}
```

**Side Effects:**

- Emits `account.disconnected` audit event.
- Does NOT delete health data previously synced from this source.

**Error Responses:** 401, 404 (connection not found or not owned by user)

---

#### 7.2.5 POST /api/connections/{connectionId}/sync

Manually trigger a data sync for a connection. Sync runs asynchronously.

**Auth:** Owner (Clerk session required)

**Path Parameters:**

| Param          | Type            | Description              |
| -------------- | --------------- | ------------------------ |
| `connectionId` | `string (UUID)` | The connection record ID |

**Response 202:**

```json
{
  "data": {
    "sync_id": "sync_abc123",
    "status": "queued",
    "message": "Sync has been queued and will begin shortly"
  }
}
```

**Processing:**

- If a sync is already in progress for this connection, return 409 with `SYNC_IN_PROGRESS`.
- Otherwise, queue the sync job (Vercel Cron or BullMQ for MVP) and return immediately.
- The sync process fetches data from the Oura API starting from `sync_cursor`, encrypts values, and upserts into `health_data`.

**Error Responses:** 401, 404, 409 (`SYNC_IN_PROGRESS`), 502 (if Oura connection tokens are expired)

---

### 7.3 Health Data API

#### 7.3.1 GET /api/health-data

Query the owner's health data with filtering and optional aggregation.

**Auth:** Owner (Clerk session required)

**Query Parameters:**

| Param        | Type                  | Required | Default | Description                                                           |
| ------------ | --------------------- | -------- | ------- | --------------------------------------------------------------------- |
| `metrics`    | `string`              | Yes      | —       | Comma-separated metric type identifiers (e.g., `sleep_score,hrv,rhr`) |
| `start`      | `string (YYYY-MM-DD)` | Yes      | —       | Start date (inclusive)                                                |
| `end`        | `string (YYYY-MM-DD)` | Yes      | —       | End date (inclusive)                                                  |
| `resolution` | `string`              | No       | `daily` | One of: `daily`, `weekly`, `monthly`                                  |
| `sources`    | `string`              | No       | all     | Comma-separated source filter (e.g., `oura,apple_health`)             |

**Validation Rules (Zod):**

- `metrics`: At least 1, at most 10. Each must be in the valid metric enum.
- `start`: Valid date, not in the future.
- `end`: Valid date, >= `start`.
- Date range: Maximum span of 1,825 days (5 years).
- `resolution`: Must be one of `daily`, `weekly`, `monthly`.
- `sources`: Each must be one of `oura`, `apple_health`, `google_fit`.

**Response 200:**

```json
{
  "data": {
    "metrics": {
      "sleep_score": {
        "unit": "score",
        "points": [
          { "date": "2026-03-01", "value": 85, "source": "oura" },
          { "date": "2026-03-02", "value": 78, "source": "oura" },
          { "date": "2026-03-03", "value": 91, "source": "oura" }
        ]
      },
      "hrv": {
        "unit": "ms",
        "points": [
          { "date": "2026-03-01", "value": 42.5, "source": "oura" },
          { "date": "2026-03-02", "value": 38.1, "source": "oura" },
          { "date": "2026-03-03", "value": 45.7, "source": "oura" }
        ]
      }
    },
    "query": {
      "start": "2026-03-01",
      "end": "2026-03-08",
      "resolution": "daily",
      "metrics_requested": ["sleep_score", "hrv"],
      "metrics_returned": ["sleep_score", "hrv"]
    }
  }
}
```

**Response Fields (per metric):**

| Field             | Type     | Description                                              |
| ----------------- | -------- | -------------------------------------------------------- |
| `unit`            | `string` | Display unit for the metric (from metric config, not DB) |
| `points`          | `array`  | Array of data points sorted by date ascending            |
| `points[].date`   | `string` | Date of this data point (`YYYY-MM-DD`)                   |
| `points[].value`  | `number` | Decrypted metric value                                   |
| `points[].source` | `string` | Data source identifier                                   |

For `weekly` and `monthly` resolution, `points[].date` is the first day of the week (Monday) or month. `points[].value` is the arithmetic mean of all daily values in that period. Points with no data are omitted (not zero-filled).

**Side Effects:**

- Emits `data.viewed` audit event with `{ metrics, date_range, resolution, data_points_returned }`.

**Error Responses:** 400, 401, 500, 502 (KMS decrypt failure)

---

#### 7.3.2 GET /api/health-data/types

List available metric types for the current user (i.e., types that have at least one data point).

**Auth:** Owner (Clerk session required)

**Query Parameters:** None

**Response 200:**

```json
{
  "data": {
    "types": [
      {
        "metric_type": "sleep_score",
        "label": "Sleep Score",
        "unit": "score",
        "category": "sleep",
        "source": "oura",
        "earliest_date": "2024-01-15",
        "latest_date": "2026-03-08",
        "data_point_count": 784
      },
      {
        "metric_type": "hrv",
        "label": "Heart Rate Variability",
        "unit": "ms",
        "category": "cardiovascular",
        "source": "oura",
        "earliest_date": "2024-01-15",
        "latest_date": "2026-03-08",
        "data_point_count": 784
      },
      {
        "metric_type": "steps",
        "label": "Steps",
        "unit": "steps",
        "category": "activity",
        "source": "oura",
        "earliest_date": "2024-01-15",
        "latest_date": "2026-03-08",
        "data_point_count": 784
      }
    ]
  }
}
```

**Note:** `label`, `unit`, and `category` are derived from application-level metric configuration, not from the database. The database query provides `metric_type`, `source`, `earliest_date`, `latest_date`, and `data_point_count`.

**Error Responses:** 401

---

### 7.4 Shares API

#### 7.4.1 POST /api/shares

Create a new share grant.

**Auth:** Owner (Clerk session required)

**Request Body:**

```json
{
  "label": "For Dr. Patel - annual checkup",
  "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
  "data_start": "2025-06-01",
  "data_end": "2026-03-08",
  "expires_in_days": 30,
  "note": "Please review my sleep trends from the past 9 months"
}
```

**Request Fields:**

| Field             | Type       | Required | Constraints                        | Description                                          |
| ----------------- | ---------- | -------- | ---------------------------------- | ---------------------------------------------------- |
| `label`           | `string`   | Yes      | 1-255 chars                        | Human-readable label for the owner's management view |
| `allowed_metrics` | `string[]` | Yes      | 1-21 items, each valid metric type | Which metrics the viewer can see                     |
| `data_start`      | `string`   | Yes      | Valid date, not in the future      | Start of viewable date range                         |
| `data_end`        | `string`   | Yes      | Valid date, >= `data_start`        | End of viewable date range                           |
| `expires_in_days` | `integer`  | Yes      | 1-365                              | Number of days from now until the link expires       |
| `note`            | `string`   | No       | 0-1000 chars                       | Optional note shown to the viewer                    |

**Processing:**

1. Validate all fields with Zod.
2. Validate that `allowed_metrics` contains only metrics the user actually has data for (prevents creating a share that would show nothing).
3. Generate 32 bytes of cryptographically random data. Base64url-encode to produce the raw token (43 chars).
4. Hash the raw token with SHA-256. Store the hash in the `token` column.
5. Compute `grant_expires` as `NOW() + expires_in_days`.
6. Insert the share grant record.
7. Emit `share.created` audit event.
8. Return the raw token in the response (this is the ONLY time it is returned).

**Response 201:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "token": "dGhpcyBpcyBhIHRlc3QgdG9rZW4gZm9yIGRlbW9uc3RyYXRpb24",
    "share_url": "https://totus.com/v/dGhpcyBpcyBhIHRlc3QgdG9rZW4gZm9yIGRlbW9uc3RyYXRpb24",
    "label": "For Dr. Patel - annual checkup",
    "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
    "data_start": "2025-06-01",
    "data_end": "2026-03-08",
    "grant_expires": "2026-04-07T14:23:01.000Z",
    "note": "Please review my sleep trends from the past 9 months",
    "created_at": "2026-03-08T14:23:01.000Z"
  }
}
```

**IMPORTANT:** The `token` field and `share_url` are returned ONLY in this creation response. They are never returned again by any other endpoint. The owner must copy the URL at creation time.

**Error Responses:** 400, 401

---

#### 7.4.2 GET /api/shares

List the owner's share grants.

**Auth:** Owner (Clerk session required)

**Query Parameters:**

| Param    | Type      | Required | Default | Description                                   |
| -------- | --------- | -------- | ------- | --------------------------------------------- |
| `status` | `string`  | No       | `all`   | Filter: `active`, `expired`, `revoked`, `all` |
| `cursor` | `string`  | No       | —       | Pagination cursor                             |
| `limit`  | `integer` | No       | 20      | Results per page (max 50)                     |

**Response 200:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "label": "For Dr. Patel - annual checkup",
      "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
      "data_start": "2025-06-01",
      "data_end": "2026-03-08",
      "grant_expires": "2026-04-07T14:23:01.000Z",
      "status": "active",
      "revoked_at": null,
      "view_count": 3,
      "last_viewed_at": "2026-03-08T15:00:00.000Z",
      "created_at": "2026-03-08T14:23:01.000Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJjIjoiMjAyNi0wMy0wOFQxNDoyMzowMS4wMDBaIiwiaSI6IjU1MGU4NDAwIn0",
    "has_more": false
  }
}
```

**Note:** The `token` is NEVER included in list responses. The `status` field is computed:

- `active`: `revoked_at IS NULL AND grant_expires > NOW()`
- `expired`: `revoked_at IS NULL AND grant_expires <= NOW()`
- `revoked`: `revoked_at IS NOT NULL`

**Error Responses:** 401

---

#### 7.4.3 GET /api/shares/{shareId}

Get details of a specific share grant.

**Auth:** Owner (Clerk session required)

**Path Parameters:**

| Param     | Type            | Description        |
| --------- | --------------- | ------------------ |
| `shareId` | `string (UUID)` | The share grant ID |

**Response 200:** Same shape as a single item from the list response, with an additional `note` field and `audit_summary`:

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "label": "For Dr. Patel - annual checkup",
    "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
    "data_start": "2025-06-01",
    "data_end": "2026-03-08",
    "grant_expires": "2026-04-07T14:23:01.000Z",
    "status": "active",
    "revoked_at": null,
    "note": "Please review my sleep trends from the past 9 months",
    "view_count": 3,
    "last_viewed_at": "2026-03-08T15:00:00.000Z",
    "created_at": "2026-03-08T14:23:01.000Z",
    "recent_views": [
      {
        "viewed_at": "2026-03-08T15:00:00.000Z",
        "ip_address": "73.162.44.12",
        "user_agent_summary": "Chrome on macOS"
      }
    ]
  }
}
```

The `recent_views` array contains the 10 most recent `share.viewed` and `data.viewed` audit events for this grant.

**Error Responses:** 401, 404

---

#### 7.4.4 PATCH /api/shares/{shareId}

Update a share grant. Only supports revoking.

**Auth:** Owner (Clerk session required)

**Path Parameters:**

| Param     | Type            | Description        |
| --------- | --------------- | ------------------ |
| `shareId` | `string (UUID)` | The share grant ID |

**Request Body:**

```json
{
  "action": "revoke"
}
```

**Request Fields:**

| Field    | Type     | Required | Constraints        | Description             |
| -------- | -------- | -------- | ------------------ | ----------------------- |
| `action` | `string` | Yes      | Must be `"revoke"` | The mutation to perform |

**Why PATCH with an `action` field instead of DELETE?** Revocation is a soft-delete (sets `revoked_at`). The record must persist for audit trail purposes. DELETE implies record removal.

**Processing:**

1. Verify share exists and is owned by the requesting user.
2. Verify share is not already revoked (idempotent: if already revoked, return 200 with current state).
3. Set `revoked_at = NOW()`, `updated_at = NOW()`.
4. Emit `share.revoked` audit event.

**Response 200:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "revoked",
    "revoked_at": "2026-03-08T16:00:00.000Z"
  }
}
```

**Error Responses:** 401, 404

---

#### 7.4.5 DELETE /api/shares/{shareId}

Hard-delete a share grant. Removes the grant record entirely. Only allowed for shares that have been revoked or expired.

**Auth:** Owner (Clerk session required)

**Processing:**

1. Verify share exists and is owned by the requesting user.
2. Verify share is revoked or expired. Active shares must be revoked first.
3. Delete the share grant record.
4. Audit events referencing this grant remain (they reference the grant_id but the grant no longer exists — this is acceptable).
5. Emit `share.deleted` audit event.

**Response 200:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "deleted": true
  }
}
```

**Error Responses:** 401, 403 (`SHARE_STILL_ACTIVE` — must revoke before deleting), 404

---

### 7.5 Viewer API

#### 7.5.1 POST /api/viewer/validate

Validate a share token and issue a viewer session cookie.

**Auth:** None (public endpoint)

**Rate Limit:** 10 requests per minute per IP (strict — this is the brute-force protection surface)

**Request Body:**

```json
{
  "token": "dGhpcyBpcyBhIHRlc3QgdG9rZW4gZm9yIGRlbW9uc3RyYXRpb24"
}
```

**Processing:**

1. Hash the incoming token with SHA-256.
2. Look up the hash in `share_grants.token`.
3. Validate: grant exists, `revoked_at IS NULL`, `grant_expires > NOW()`.
4. If invalid: return 404 with `SHARE_NOT_FOUND` (generic — do NOT reveal whether the token was revoked vs. expired vs. never existed).
5. If valid:
   a. Increment `view_count` and set `last_viewed_at = NOW()`.
   b. Sign a JWT with payload: `{ grantId, ownerId, allowedMetrics, dataStart, dataEnd, exp }`.
   c. `exp` = `min(grant_expires, NOW() + 4 hours)`.
   d. Set the JWT as an httpOnly, Secure, SameSite=Lax cookie named `totus_viewer`.
   e. Emit `share.viewed` audit event with IP address and user agent.

**Response 200:**

```json
{
  "data": {
    "valid": true,
    "owner_display_name": "Wes E.",
    "label": "For Dr. Patel - annual checkup",
    "note": "Please review my sleep trends from the past 9 months",
    "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
    "data_start": "2025-06-01",
    "data_end": "2026-03-08",
    "expires_at": "2026-04-07T14:23:01.000Z"
  }
}
```

**Response 404 (generic for all invalid cases):**

```json
{
  "error": {
    "code": "SHARE_NOT_FOUND",
    "message": "This share link is not available. It may have expired, been revoked, or never existed."
  }
}
```

**Security Note:** The response does NOT distinguish between invalid token, expired grant, and revoked grant. This prevents information leakage. Internal logging captures the specific reason.

**Error Responses:** 404, 429, 500

---

#### 7.5.2 GET /api/viewer/data

Fetch health data as a viewer, scoped to the grant's permissions.

**Auth:** Viewer (requires valid `totus_viewer` cookie)

**Query Parameters:** Same as `GET /api/health-data`:

| Param        | Type     | Required | Default | Description                  |
| ------------ | -------- | -------- | ------- | ---------------------------- |
| `metrics`    | `string` | Yes      | —       | Comma-separated metric types |
| `start`      | `string` | Yes      | —       | Start date                   |
| `end`        | `string` | Yes      | —       | End date                     |
| `resolution` | `string` | No       | `daily` | `daily`, `weekly`, `monthly` |

**Permission Enforcement:**

1. Decode viewer JWT from cookie. Extract `allowedMetrics`, `dataStart`, `dataEnd`, `grantId`, `ownerId`.
2. Intersect requested `metrics` with `allowedMetrics`. If intersection is empty, return 403.
3. Clamp requested `start`/`end` to `dataStart`/`dataEnd`. If resulting range is empty, return 403.
4. Query health data for `ownerId` using the narrowed scope.
5. Decrypt values using the owner's DEK.
6. Emit `data.viewed` audit event for the owner's audit log.

**Response 200:** Same shape as `GET /api/health-data` response, with an additional `scope` field:

```json
{
  "data": {
    "metrics": {
      "sleep_score": {
        "unit": "score",
        "points": [...]
      }
    },
    "query": {
      "start": "2025-06-01",
      "end": "2026-03-08",
      "resolution": "daily",
      "metrics_requested": ["sleep_score", "hrv"],
      "metrics_returned": ["sleep_score", "hrv"]
    },
    "scope": {
      "grant_id": "550e8400-e29b-41d4-a716-446655440000",
      "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
      "data_start": "2025-06-01",
      "data_end": "2026-03-08"
    }
  }
}
```

**Error Responses:** 401, 403, 500

---

### 7.6 Audit API

#### 7.6.1 GET /api/audit

Query the owner's audit log.

**Auth:** Owner (Clerk session required)

**Query Parameters:**

| Param        | Type      | Required | Default     | Description                                                 |
| ------------ | --------- | -------- | ----------- | ----------------------------------------------------------- |
| `event_type` | `string`  | No       | all         | Filter by event type (e.g., `data.viewed`, `share.created`) |
| `grant_id`   | `string`  | No       | all         | Filter by specific share grant                              |
| `actor_type` | `string`  | No       | all         | Filter: `owner`, `viewer`, `system`                         |
| `start`      | `string`  | No       | 30 days ago | Start of time range                                         |
| `end`        | `string`  | No       | now         | End of time range                                           |
| `cursor`     | `string`  | No       | —           | Pagination cursor                                           |
| `limit`      | `integer` | No       | 50          | Results per page (max 100)                                  |

**Response 200:**

```json
{
  "data": [
    {
      "id": "12345",
      "event_type": "data.viewed",
      "actor_type": "viewer",
      "actor_id": null,
      "grant_id": "550e8400-e29b-41d4-a716-446655440000",
      "grant_label": "For Dr. Patel - annual checkup",
      "resource_type": "health_data",
      "resource_detail": {
        "metrics": ["sleep_score", "hrv"],
        "date_range": { "start": "2025-06-01", "end": "2026-03-08" },
        "data_points_returned": 540
      },
      "ip_address": "73.162.44.12",
      "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "created_at": "2026-03-08T15:00:00.000Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJjIjoiMjAyNi0wMy0wOFQxNTowMDowMC4wMDBaIiwiaSI6MTIzNDV9",
    "has_more": true
  }
}
```

**Note:** `grant_label` is a JOIN from `share_grants` for convenience. If the grant has been hard-deleted, this field is `null`.

**Error Responses:** 401

---

### 7.7 User API

#### 7.7.1 GET /api/user/profile

Get the current user's profile.

**Auth:** Owner (Clerk session required)

**Response 200:**

```json
{
  "data": {
    "id": "user_2xABC123",
    "display_name": "Wes E.",
    "email": "wes@example.com",
    "has_2fa": true,
    "created_at": "2026-02-01T10:00:00.000Z",
    "stats": {
      "total_data_points": 4720,
      "connected_sources": ["oura"],
      "active_shares": 2,
      "earliest_data": "2024-01-15",
      "latest_data": "2026-03-08"
    }
  }
}
```

**Note:** `email` and `has_2fa` come from Clerk's user object (via Backend API or session claims), not from the Totus database.

**Error Responses:** 401

---

#### 7.7.2 PATCH /api/user/profile

Update the user's profile.

**Auth:** Owner (Clerk session required)

**Request Body:**

```json
{
  "display_name": "Wesley E."
}
```

**Updatable Fields:**

| Field          | Type     | Constraints          | Description                    |
| -------------- | -------- | -------------------- | ------------------------------ |
| `display_name` | `string` | 1-100 chars, no HTML | The name shown on shared views |

**Response 200:**

```json
{
  "data": {
    "id": "user_2xABC123",
    "display_name": "Wesley E.",
    "updated_at": "2026-03-08T16:00:00.000Z"
  }
}
```

**Side Effects:** Emits `account.settings` audit event.

**Error Responses:** 400, 401

---

#### 7.7.3 POST /api/user/export

Request a full data export. Returns a download URL for a ZIP file containing all health data as JSON.

**Auth:** Owner (Clerk session required)

**Request Body:** None (exports all data)

**Processing:**

1. Query all health data for the user.
2. Decrypt all values.
3. Package as JSON, organized by metric type.
4. Compress as ZIP.
5. Upload to S3 with a pre-signed URL (expires in 1 hour).
6. Emit `data.exported` audit event.

**Response 202:**

```json
{
  "data": {
    "export_id": "exp_abc123",
    "status": "processing",
    "message": "Your export is being prepared. This may take a few minutes for large datasets."
  }
}
```

For MVP simplicity (small datasets), the export can be synchronous and return 200 with the download URL directly:

**Response 200 (if dataset is small enough for synchronous processing, < 5,000 data points):**

```json
{
  "data": {
    "export_id": "exp_abc123",
    "status": "ready",
    "download_url": "https://totus-exports.s3.amazonaws.com/...",
    "expires_at": "2026-03-08T17:00:00.000Z",
    "format": "zip",
    "size_bytes": 245678
  }
}
```

**Error Responses:** 401, 500

---

#### 7.7.4 DELETE /api/user/account

Delete the user's account and all associated data.

**Auth:** Owner (Clerk session required)

**Request Body:**

```json
{
  "confirmation": "DELETE MY ACCOUNT"
}
```

The `confirmation` field must be the exact string `"DELETE MY ACCOUNT"` to prevent accidental deletion.

**Processing:**

1. Validate confirmation string.
2. Revoke all active share grants (set `revoked_at = NOW()`).
3. Delete all `health_data` rows for this user.
4. Delete all `oura_connections` for this user.
5. Schedule KMS key for deletion (30-day waiting period per AWS).
6. Emit `account.deleted` audit event (this is the last audit event for this user).
7. Delete the `users` row.
8. Delete the Clerk user via Clerk Backend API.
9. Audit events are NOT deleted (they remain for compliance/debugging, but are orphaned).

**Response 200:**

```json
{
  "data": {
    "deleted": true,
    "message": "Your account and all associated data have been permanently deleted."
  }
}
```

**Error Responses:** 400 (`INVALID_CONFIRMATION`), 401

---

## 8. Data Storage and Model

### 8.1 Database Engine

**Engine:** PostgreSQL 15+ on AWS Aurora Serverless v2
**Region:** us-east-1 (co-located with Vercel's primary region)
**Min ACU:** 0.5 (scales to zero during inactivity)
**Max ACU:** 4 (sufficient for MVP; ~50 concurrent connections)
**Storage Encryption:** AWS-managed encryption at rest (AES-256, enabled by default)
**Backup:** Automated daily snapshots, 7-day retention

### 8.2 Database Roles

Two PostgreSQL roles are used:

```sql
-- Role for application queries (used by the Next.js app)
CREATE ROLE totus_app LOGIN PASSWORD 'rotated-via-secrets-manager';

-- Role for migrations only (used by CI/CD)
CREATE ROLE totus_migrate LOGIN PASSWORD 'rotated-via-secrets-manager';
```

Permission grants:

```sql
-- App role: full CRUD on most tables, but INSERT+SELECT only on audit_events
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO totus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON oura_connections TO totus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON health_data TO totus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON share_grants TO totus_app;
GRANT SELECT, INSERT ON audit_events TO totus_app;
-- Explicitly NO UPDATE, DELETE on audit_events for totus_app

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO totus_app;

-- Migrate role: full DDL
GRANT ALL ON SCHEMA public TO totus_migrate;
```

### 8.3 PostgreSQL DDL (Complete)

#### 8.3.1 Extension Setup

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for future text search on labels
```

#### 8.3.2 users

```sql
CREATE TABLE users (
    id              VARCHAR(64)     PRIMARY KEY,
        -- Clerk user ID (e.g., "user_2xABC123"). VARCHAR, not UUID,
        -- because Clerk IDs are prefixed strings.
    display_name    VARCHAR(100)    NOT NULL,
    kms_key_arn     VARCHAR(256)    NOT NULL,
        -- ARN of the user's assigned CMK from the shared pool of 10.
        -- Assigned via: pool_keys[hash(user_id) % 10]
        -- Format: arn:aws:kms:us-east-1:123456789012:key/uuid
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- No additional indexes needed; primary key covers lookups by id.
-- User count at MVP is ~500; full table scan for admin queries is fine.

COMMENT ON TABLE users IS 'Registered Totus users. ID is the Clerk user ID.';
COMMENT ON COLUMN users.kms_key_arn IS 'ARN of the per-user AWS KMS Customer Master Key for envelope encryption.';
```

#### 8.3.3 oura_connections

```sql
CREATE TABLE oura_connections (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_enc    BYTEA           NOT NULL,
        -- Oura access token encrypted with user's DEK.
        -- Format: 12-byte nonce || ciphertext || 16-byte auth tag
        -- (AES-256-GCM) prepended with the KMS-encrypted DEK.
    refresh_token_enc   BYTEA           NOT NULL,
        -- Same encryption format as access_token_enc.
    token_expires_at    TIMESTAMPTZ     NOT NULL,
        -- When the Oura access token expires.
    last_sync_at        TIMESTAMPTZ,
        -- Timestamp of last successful sync. NULL if never synced.
    sync_cursor         VARCHAR(256),
        -- Oura API pagination cursor for incremental sync.
        -- Stores the `next_token` from the last Oura API response.
    sync_status         VARCHAR(16)     NOT NULL DEFAULT 'idle',
        -- One of: 'idle', 'syncing', 'error'
    sync_error          TEXT,
        -- Error message from last failed sync, NULL if last sync succeeded.
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_oura_connections_user UNIQUE (user_id)
        -- One Oura connection per user.
);

CREATE INDEX idx_oura_connections_user_id ON oura_connections(user_id);

COMMENT ON TABLE oura_connections IS 'Oura Ring OAuth connections. Tokens are encrypted with the user DEK.';
COMMENT ON COLUMN oura_connections.sync_cursor IS 'Oura API next_token for incremental data fetching.';
```

#### 8.3.4 health_data

```sql
CREATE TABLE health_data (
    id              BIGSERIAL       PRIMARY KEY,
    user_id         VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_type     VARCHAR(64)     NOT NULL,
        -- e.g., 'sleep_score', 'hrv', 'weight', 'glucose'
        -- Validated at application level against known enum.
    date            DATE            NOT NULL,
        -- The calendar date this measurement applies to.
    value_encrypted BYTEA           NOT NULL,
        -- Encrypted health data value.
        -- Wire format (single BYTEA blob):
        --   [4 bytes: encrypted DEK length (uint32 big-endian)]
        --   [N bytes: KMS-encrypted DEK]
        --   [12 bytes: AES-GCM nonce]
        --   [M bytes: AES-256-GCM ciphertext of the JSON value]
        --   [16 bytes: AES-GCM auth tag]
        --
        -- The plaintext value before encryption is a JSON string:
        --   {"v": 85}              (integer metric)
        --   {"v": 42.5}            (float metric)
        --   {"v": 7.5, "u": "hr"}  (value with unit, for sleep_duration etc.)
    source          VARCHAR(32)     NOT NULL,
        -- One of: 'oura', 'apple_health', 'google_fit'
    source_id       VARCHAR(256),
        -- Source-specific identifier for deduplication.
        -- For Oura: the Oura API record ID.
        -- For Apple Health: HealthKit sample UUID.
    imported_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_health_data_user_metric_date_source
        UNIQUE (user_id, metric_type, date, source)
);

-- Primary query index: fetch data for a user, filtered by metric type(s) and date range.
-- This composite index covers the main query pattern.
CREATE INDEX idx_health_data_user_metric_date
    ON health_data(user_id, metric_type, date);

-- Index for the types listing query (distinct metric types per user with stats).
CREATE INDEX idx_health_data_user_metric_summary
    ON health_data(user_id, metric_type);

COMMENT ON TABLE health_data IS 'Encrypted health metric data points. One row per user/metric/date/source.';
COMMENT ON COLUMN health_data.value_encrypted IS 'Envelope-encrypted value. Contains KMS-encrypted DEK + AES-256-GCM encrypted JSON payload.';
COMMENT ON COLUMN health_data.source_id IS 'Provider-specific record ID for deduplication during re-sync.';
```

#### 8.3.5 share_grants

```sql
CREATE TABLE share_grants (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    token           VARCHAR(64)     NOT NULL,
        -- SHA-256 hash of the raw share token, hex-encoded (64 chars).
        -- The raw token is NEVER stored. Only the hash.
    owner_id        VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label           VARCHAR(255)    NOT NULL,
    note            VARCHAR(1000),
        -- Optional note displayed to the viewer.
    allowed_metrics TEXT[]          NOT NULL,
        -- PostgreSQL text array: e.g., ARRAY['sleep_score','hrv','rhr']
    data_start      DATE            NOT NULL,
    data_end        DATE            NOT NULL,
    grant_expires   TIMESTAMPTZ     NOT NULL,
    revoked_at      TIMESTAMPTZ,
        -- NULL = active. Non-NULL = revoked at this timestamp.
    view_count      INTEGER         NOT NULL DEFAULT 0,
    last_viewed_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_share_grants_token UNIQUE (token),
    CONSTRAINT chk_share_grants_date_range CHECK (data_end >= data_start),
    CONSTRAINT chk_share_grants_metrics_nonempty CHECK (array_length(allowed_metrics, 1) > 0)
);

-- Fast lookup by hashed token for viewer validation.
-- Partial index: only look at active (non-revoked, non-expired) grants.
CREATE INDEX idx_share_grants_active_token
    ON share_grants(token)
    WHERE revoked_at IS NULL AND grant_expires > now();

-- Owner's share management list: ordered by creation, newest first.
CREATE INDEX idx_share_grants_owner_created
    ON share_grants(owner_id, created_at DESC);

COMMENT ON TABLE share_grants IS 'Share permission grants. Token is stored as SHA-256 hash; raw token exists only in the URL.';
COMMENT ON COLUMN share_grants.token IS 'SHA-256 hash (hex) of the raw share token. Used for lookup; raw token never stored.';
COMMENT ON COLUMN share_grants.allowed_metrics IS 'Postgres text array of metric type identifiers the viewer is permitted to access.';
```

#### 8.3.6 audit_events

```sql
CREATE TABLE audit_events (
    id              BIGSERIAL       PRIMARY KEY,
    owner_id        VARCHAR(64)     NOT NULL,
        -- Whose data was affected. NOT a foreign key to users(id)
        -- because audit events persist after account deletion.
    actor_type      VARCHAR(16)     NOT NULL,
        -- 'owner' | 'viewer' | 'system'
    actor_id        VARCHAR(64),
        -- Clerk user ID if actor_type='owner', NULL for viewer/system.
    grant_id        UUID,
        -- References share_grants(id) if actor_type='viewer'.
        -- NOT a foreign key — grant may be deleted while audit persists.
    event_type      VARCHAR(64)     NOT NULL,
        -- Taxonomy: 'data.viewed', 'data.imported', 'data.exported',
        -- 'data.deleted', 'share.created', 'share.revoked',
        -- 'share.deleted', 'share.viewed', 'share.expired',
        -- 'account.login', 'account.2fa_enabled', 'account.settings',
        -- 'account.connected', 'account.disconnected', 'account.deleted'
    resource_type   VARCHAR(64),
        -- 'health_data', 'share_grant', 'connection', 'account'
    resource_detail JSONB,
        -- Structured metadata. Contents vary by event_type.
        -- See Section 19 (Appendix) for schemas per event type.
    ip_address      INET,
    user_agent      TEXT,
    session_id      VARCHAR(256),
        -- Clerk session ID or viewer JWT 'jti' claim.
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT chk_audit_actor_type
        CHECK (actor_type IN ('owner', 'viewer', 'system'))
);

-- Owner viewing their audit log: newest first, with optional filters.
CREATE INDEX idx_audit_events_owner_created
    ON audit_events(owner_id, created_at DESC);

-- Per-share audit: events for a specific grant.
CREATE INDEX idx_audit_events_grant_created
    ON audit_events(grant_id, created_at DESC)
    WHERE grant_id IS NOT NULL;

-- Event type filter (used with owner_id).
CREATE INDEX idx_audit_events_owner_type_created
    ON audit_events(owner_id, event_type, created_at DESC);

-- Defense-in-depth: trigger to prevent UPDATE and DELETE even if GRANT is misconfigured.
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events table is immutable: % operations are not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

COMMENT ON TABLE audit_events IS 'Immutable audit log. INSERT and SELECT only. No UPDATE or DELETE permitted.';
COMMENT ON COLUMN audit_events.owner_id IS 'User whose data was accessed. Not an FK — persists after account deletion.';
COMMENT ON COLUMN audit_events.grant_id IS 'Share grant involved, if any. Not an FK — persists after grant deletion.';
```

### 8.4 Drizzle ORM Schema

The Drizzle schema definitions below are the TypeScript source of truth that generates the DDL above via `drizzle-kit push` or `drizzle-kit generate`.

File: `src/db/schema.ts`

```
// NOTE: This is a DESIGN specification, not implementation code.
// The implementation agent should create this file with the following
// table definitions using Drizzle ORM's PostgreSQL dialect.

// Table: users
//   id: varchar(64).primaryKey()
//   displayName: varchar(100).notNull()
//   kmsKeyArn: varchar(256).notNull()
//   createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
//   updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()

// Table: ouraConnections
//   id: uuid().primaryKey().defaultRandom()
//   userId: varchar(64).notNull().references(users.id, { onDelete: 'cascade' })
//   accessTokenEnc: bytea().notNull()     -- custom column type for BYTEA
//   refreshTokenEnc: bytea().notNull()
//   tokenExpiresAt: timestamp({ withTimezone: true }).notNull()
//   lastSyncAt: timestamp({ withTimezone: true })
//   syncCursor: varchar(256)
//   syncStatus: varchar(16).notNull().default('idle')
//   syncError: text()
//   createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
//   Unique constraint on userId

// Table: healthData
//   id: bigserial().primaryKey()
//   userId: varchar(64).notNull().references(users.id, { onDelete: 'cascade' })
//   metricType: varchar(64).notNull()
//   date: date().notNull()
//   valueEncrypted: bytea().notNull()     -- custom column type for BYTEA
//   source: varchar(32).notNull()
//   sourceId: varchar(256)
//   importedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
//   Unique constraint on (userId, metricType, date, source)

// Table: shareGrants
//   id: uuid().primaryKey().defaultRandom()
//   token: varchar(64).notNull().unique()
//   ownerId: varchar(64).notNull().references(users.id, { onDelete: 'cascade' })
//   label: varchar(255).notNull()
//   note: varchar(1000)
//   allowedMetrics: text().array().notNull()   -- TEXT[] in Postgres
//   dataStart: date().notNull()
//   dataEnd: date().notNull()
//   grantExpires: timestamp({ withTimezone: true }).notNull()
//   revokedAt: timestamp({ withTimezone: true })
//   viewCount: integer().notNull().default(0)
//   lastViewedAt: timestamp({ withTimezone: true })
//   createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
//   updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()

// Table: auditEvents
//   id: bigserial().primaryKey()
//   ownerId: varchar(64).notNull()          -- NOT a foreign key
//   actorType: varchar(16).notNull()
//   actorId: varchar(64)
//   grantId: uuid()                          -- NOT a foreign key
//   eventType: varchar(64).notNull()
//   resourceType: varchar(64)
//   resourceDetail: jsonb()
//   ipAddress: inet()                        -- custom column type for INET
//   userAgent: text()
//   sessionId: varchar(256)
//   createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()

```

### 8.5 Migration Strategy

1. **Tool:** Drizzle Kit (`drizzle-kit generate` + `drizzle-kit push`).
2. **Migration files** are committed to the repository under `drizzle/migrations/`.
3. **Initial migration** creates all 5 tables, indexes, triggers, and the `prevent_audit_mutation` function.
4. **Post-migration script** runs the GRANT statements to configure `totus_app` permissions (especially the restricted audit_events grants). This is a separate SQL script, not a Drizzle migration, because Drizzle does not manage roles.
5. **Rollback:** Each migration has an explicit down migration. For the initial migration, down drops all tables in reverse dependency order.
6. **CI/CD:** Migrations run automatically on deploy via a pre-deployment hook. The `totus_migrate` role is used for migrations; the `totus_app` role is used at runtime.

### 8.6 Metric Type Configuration

This is application configuration, not a database table. The metric registry lives in code:

```
// Design specification for metric type registry
// File: src/config/metrics.ts

// Each metric type has:
//   id: string          -- database identifier (e.g., 'sleep_score')
//   label: string       -- human-readable name (e.g., 'Sleep Score')
//   unit: string        -- display unit (e.g., 'score', 'ms', 'bpm', 'steps', 'kcal')
//   category: string    -- grouping (e.g., 'sleep', 'cardiovascular', 'activity', 'body')
//   valueType: string   -- 'integer' or 'float'
//   sources: string[]   -- which sources can provide this metric
//   ouraField: string?  -- mapping to Oura API response field (if applicable)

// MVP Metric Types:
//
// Sleep:
//   sleep_score      | Sleep Score            | score | integer | oura
//   sleep_duration   | Sleep Duration         | hr    | float   | oura
//   sleep_efficiency | Sleep Efficiency       | %     | integer | oura
//   sleep_latency    | Sleep Latency          | min   | integer | oura
//   deep_sleep       | Deep Sleep             | hr    | float   | oura
//   rem_sleep        | REM Sleep              | hr    | float   | oura
//   light_sleep      | Light Sleep            | hr    | float   | oura
//   awake_time       | Awake Time             | min   | integer | oura
//
// Cardiovascular:
//   hrv              | Heart Rate Variability | ms    | float   | oura
//   rhr              | Resting Heart Rate     | bpm   | integer | oura
//   respiratory_rate | Respiratory Rate       | bpm   | float   | oura
//   spo2             | Blood Oxygen           | %     | float   | oura
//
// Body:
//   body_temperature_deviation | Body Temp Deviation | C | float | oura
//
// Readiness:
//   readiness_score  | Readiness Score        | score | integer | oura
//
// Activity:
//   activity_score   | Activity Score         | score | integer | oura
//   steps            | Steps                  | steps | integer | oura
//   active_calories  | Active Calories        | kcal  | integer | oura
//   total_calories   | Total Calories         | kcal  | integer | oura
//
// Future (via Apple Health / Google Fit):
//   glucose          | Glucose                | mg/dL | float   | apple_health, google_fit
//   weight           | Weight                 | kg    | float   | apple_health, google_fit
//   body_fat         | Body Fat               | %     | float   | apple_health, google_fit
```

---

## 9. Data Access Patterns

This section documents the exact SQL query each API endpoint executes, the indexes it uses, and its expected performance characteristics.

### 9.1 GET /api/health-data — Owner Health Data Query

**Query (parameterized):**

```sql
SELECT metric_type, date, value_encrypted, source
FROM health_data
WHERE user_id = $1
  AND metric_type = ANY($2)        -- $2 is TEXT[] of requested metric types
  AND date >= $3                    -- $3 is start date
  AND date <= $4                    -- $4 is end date
ORDER BY metric_type, date ASC;
```

**Index used:** `idx_health_data_user_metric_date` on `(user_id, metric_type, date)`. This is an index range scan: the index narrows to the user, then to each metric type, then to the date range. Extremely efficient.

**Post-query processing:**

1. Group rows by `metric_type`.
2. Batch-decrypt `value_encrypted` for each row (using cached DEK; one KMS call per cache miss).
3. If `resolution` is `weekly` or `monthly`, aggregate values in-memory (arithmetic mean per period). With a maximum of ~1,825 rows per metric for 5 years of daily data, in-memory aggregation is fast (<10ms).
4. Build response JSON.

**Performance estimate:**

- 5 years, 3 metrics = ~5,475 rows.
- Index scan + fetch: ~50ms.
- Decryption (cached DEK): ~100ms for 5,475 rows.
- Aggregation (if weekly/monthly): ~5ms.
- Total: ~155ms (well under 500ms target).

### 9.2 GET /api/health-data/types — Available Metric Types

**Query:**

```sql
SELECT
    metric_type,
    source,
    MIN(date) AS earliest_date,
    MAX(date) AS latest_date,
    COUNT(*) AS data_point_count
FROM health_data
WHERE user_id = $1
GROUP BY metric_type, source;
```

**Index used:** `idx_health_data_user_metric_summary` on `(user_id, metric_type)`. Index-only scan for the grouping, with a table fetch for `date` and `source`.

**Performance estimate:** ~20ms for a user with 20 metric types.

### 9.3 POST /api/viewer/validate — Share Token Validation

**Query:**

```sql
SELECT id, owner_id, label, note, allowed_metrics,
       data_start, data_end, grant_expires, revoked_at,
       view_count
FROM share_grants
WHERE token = $1;
    -- $1 is the SHA-256 hex hash of the raw token
```

**Application-side checks (not in WHERE clause, to provide specific error logging):**

- `revoked_at IS NULL` — else log "revoked" internally, return generic 404
- `grant_expires > NOW()` — else log "expired" internally, return generic 404

**Why not use the partial index `idx_share_grants_active_token`?** The partial index filters on `revoked_at IS NULL AND grant_expires > now()`, which means it would not match revoked/expired grants at all. We need to match them to log the specific reason. The query uses the UNIQUE index on `token` instead, which is a single-row lookup by hash — equally fast.

**Follow-up UPDATE (on successful validation):**

```sql
UPDATE share_grants
SET view_count = view_count + 1,
    last_viewed_at = now(),
    updated_at = now()
WHERE id = $1;
```

**Performance estimate:** ~2ms (unique index lookup + single row update).

### 9.4 GET /api/viewer/data — Viewer Health Data Query

Same query as Section 9.1, but with permission enforcement applied before query execution:

```sql
SELECT metric_type, date, value_encrypted, source
FROM health_data
WHERE user_id = $1              -- $1 = owner_id from viewer JWT
  AND metric_type = ANY($2)     -- $2 = intersection of requested and allowed metrics
  AND date >= $3                -- $3 = max(requested start, grant data_start)
  AND date <= $4                -- $4 = min(requested end, grant data_end)
ORDER BY metric_type, date ASC;
```

Same index, same performance characteristics as 9.1.

### 9.5 GET /api/shares — Owner's Share List

**Query:**

```sql
SELECT id, label, allowed_metrics, data_start, data_end,
       grant_expires, revoked_at, view_count, last_viewed_at, created_at
FROM share_grants
WHERE owner_id = $1
  AND ($2::text IS NULL OR
       CASE
         WHEN $2 = 'active'  THEN revoked_at IS NULL AND grant_expires > now()
         WHEN $2 = 'expired' THEN revoked_at IS NULL AND grant_expires <= now()
         WHEN $2 = 'revoked' THEN revoked_at IS NOT NULL
         ELSE TRUE
       END)
  AND (created_at, id) < ($3, $4)  -- cursor: ($3=created_at, $4=id)
ORDER BY created_at DESC, id DESC
LIMIT $5;
```

**Index used:** `idx_share_grants_owner_created` on `(owner_id, created_at DESC)`.

**Performance estimate:** ~5ms for a user with up to 100 shares.

### 9.6 GET /api/audit — Audit Log Query

**Query (with all optional filters):**

```sql
SELECT ae.id, ae.event_type, ae.actor_type, ae.actor_id,
       ae.grant_id, sg.label AS grant_label,
       ae.resource_type, ae.resource_detail,
       ae.ip_address, ae.user_agent, ae.created_at
FROM audit_events ae
LEFT JOIN share_grants sg ON ae.grant_id = sg.id
WHERE ae.owner_id = $1
  AND ($2::text IS NULL OR ae.event_type = $2)         -- event_type filter
  AND ($3::uuid IS NULL OR ae.grant_id = $3)           -- grant_id filter
  AND ($4::text IS NULL OR ae.actor_type = $4)         -- actor_type filter
  AND ae.created_at >= $5                               -- start timestamp
  AND ae.created_at <= $6                               -- end timestamp
  AND (ae.created_at, ae.id) < ($7, $8)                -- cursor
ORDER BY ae.created_at DESC, ae.id DESC
LIMIT $9;
```

**Index used:** `idx_audit_events_owner_created` for the base case. When filtering by `event_type`, the `idx_audit_events_owner_type_created` index is used. When filtering by `grant_id`, the `idx_audit_events_grant_created` index is used.

**Performance estimate:** ~15ms for 50 results with a single filter active.

### 9.7 Health Data Upsert (Oura Sync)

**Query (upsert via ON CONFLICT):**

```sql
INSERT INTO health_data (user_id, metric_type, date, value_encrypted, source, source_id)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (user_id, metric_type, date, source)
DO UPDATE SET
    value_encrypted = EXCLUDED.value_encrypted,
    source_id = EXCLUDED.source_id,
    imported_at = now();
```

**Index used:** The UNIQUE constraint `uq_health_data_user_metric_date_source` is used for conflict detection.

**Batch optimization:** For Oura sync, batch upserts using a multi-row VALUES clause (up to 100 rows per statement) wrapped in a single transaction.

**Performance estimate:** ~50ms for a batch of 100 rows.

### 9.8 Audit Event Insert (Fire-and-Forget)

**Query:**

```sql
INSERT INTO audit_events
    (owner_id, actor_type, actor_id, grant_id, event_type,
     resource_type, resource_detail, ip_address, user_agent, session_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, $10);
```

No index is needed for inserts. This is fire-and-forget: the application does not await the result. If the insert fails (e.g., connection issue), it is logged to the application error log but does not affect the data response.

**Performance estimate:** ~2ms per insert.

### 9.9 Account Deletion Cascade

**Queries (executed in a transaction):**

```sql
BEGIN;

-- 1. Revoke all active shares
UPDATE share_grants
SET revoked_at = now(), updated_at = now()
WHERE owner_id = $1 AND revoked_at IS NULL;

-- 2. Delete health data
DELETE FROM health_data WHERE user_id = $1;

-- 3. Delete Oura connection
DELETE FROM oura_connections WHERE user_id = $1;

-- 4. Delete share grants (after revoking; audit events reference grant_id but are not FK'd)
DELETE FROM share_grants WHERE owner_id = $1;

-- 5. Insert final audit event
INSERT INTO audit_events (owner_id, actor_type, actor_id, event_type, resource_type, ip_address, user_agent, session_id)
VALUES ($1, 'owner', $1, 'account.deleted', 'account', $2::inet, $3, $4);

-- 6. Delete user record
DELETE FROM users WHERE id = $1;

COMMIT;
```

**Note:** Audit events for this user are NOT deleted. They are orphaned (no FK to users) and remain for compliance/debugging purposes. The `owner_id` value persists in audit_events even though the user row is gone.

**Performance estimate:** ~100ms for a user with 5,000 health data rows and 10 shares.

---

## 10. Dependencies

### 10.1 Internal Dependencies

| Dependency                        | What Uses It                               | Failure Impact                                                                                                                                                     |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL (Aurora Serverless v2) | All API endpoints                          | Complete outage. No degraded mode possible.                                                                                                                        |
| AWS KMS                           | Health data read/write, Oura token storage | Cannot read or write health data. Shares that are already cached in viewer JWTs continue to work for read (data is cached client-side), but new data fetches fail. |
| Clerk                             | Owner authentication, session management   | Owners cannot log in. Active owner sessions continue working until session cookie expires. Viewers are unaffected.                                                 |
| Drizzle ORM                       | All database queries                       | Build-time dependency. No runtime failure mode (compiles to SQL).                                                                                                  |
| Zod                               | Request validation on all endpoints        | Build-time dependency. No runtime failure mode.                                                                                                                    |

### 10.2 External Dependencies

| Dependency  | What Uses It                                   | Failure Impact                                                                 | SLA                               |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| Oura API v2 | OAuth flow, data sync                          | Cannot connect new accounts or sync new data. Existing data remains available. | Undocumented; historically ~99.5% |
| Vercel      | Hosting, Edge Middleware, Serverless Functions | Complete outage for all users.                                                 | 99.99%                            |
| AWS S3      | Data exports                                   | Cannot generate exports. All other features unaffected.                        | 99.99%                            |

### 10.3 Dependency Version Pinning

| Package               | Pinned Version Range | Rationale                                  |
| --------------------- | -------------------- | ------------------------------------------ |
| `next`                | `^15.0.0`            | App Router stability                       |
| `drizzle-orm`         | `^0.36.0`            | PostgreSQL dialect maturity                |
| `drizzle-kit`         | `^0.30.0`            | Migration tooling                          |
| `@clerk/nextjs`       | `^6.0.0`             | Middleware API stability                   |
| `zod`                 | `^3.23.0`            | Mature, stable API                         |
| `jose`                | `^5.0.0`             | JWT signing/verification for viewer tokens |
| `@aws-sdk/client-kms` | `^3.600.0`           | AWS SDK v3, tree-shakeable                 |
| `@aws-sdk/client-s3`  | `^3.600.0`           | S3 operations (data export)                |
| `pg`                  | `^8.12.0`            | PostgreSQL driver                          |

---

## 11. Failure Modes

### 11.1 Database Connection Failure

**Trigger:** Aurora Serverless v2 cold start (up to 30s), connection pool exhaustion, or network partition.

**Detection:** Connection timeout (5s) or pool wait timeout (10s). Drizzle throws a connection error.

**Impact:** All API requests return 503 `SERVICE_UNAVAILABLE`.

**Mitigation:**

- Aurora Serverless v2 minimum ACU set to 0.5 (prevents full cold start to zero).
- Connection pool size: 10 connections (appropriate for serverless with ~50 concurrent users).
- Retry strategy: 1 automatic retry with 500ms delay for transient connection errors before returning 503.
- Vercel function timeout: 30s (allows for Aurora wake-up on first request after idle period).

### 11.2 KMS Unavailability

**Trigger:** AWS KMS service degradation or IAM permission misconfiguration.

**Detection:** KMS API calls timeout (3s) or return error responses.

**Impact:** Cannot decrypt health data. All data-reading endpoints return 502 `UPSTREAM_ERROR`. Share validation still works (no KMS needed). Share management still works (no encrypted data involved).

**Mitigation:**

- DEK cache with 5-minute TTL reduces KMS calls by >95% during normal operation.
- If KMS is temporarily unavailable, cached DEKs continue serving reads for up to 5 minutes.
- Alert on consecutive KMS failures (3+ in 1 minute).

### 11.3 Oura API Failure

**Trigger:** Oura API downtime, rate limiting (429), or token expiry during sync.

**Detection:** HTTP error responses from Oura API during sync.

**Impact:** Sync fails. No new data imported. Existing data remains available.

**Mitigation:**

- Sync retries with exponential backoff: 1s, 4s, 16s, then mark sync as `error`.
- Token refresh: if Oura returns 401, attempt token refresh. If refresh fails, set connection status to `expired`.
- User notification: dashboard shows "Sync failed — last successful sync: [timestamp]".
- Oura rate limits: respect `Retry-After` header. Queue sync for later.

### 11.4 Audit Log Write Failure

**Trigger:** Database connection issue during async audit insert.

**Detection:** Unhandled promise rejection or error in fire-and-forget insert.

**Impact:** Audit event is lost. Data response is unaffected (audit is non-blocking).

**Mitigation:**

- Log the failed audit event to the application error log (Vercel logs / Sentry) with full payload.
- Alert on audit write failure rate >1% in a 5-minute window.
- For MVP, accept the small risk of lost audit events. Post-MVP: use a write-ahead buffer (Redis list or SQS) that retries failed inserts.

### 11.5 Clerk Outage

**Trigger:** Clerk service downtime.

**Detection:** Clerk middleware returns errors or times out.

**Impact:** New owner logins fail. Existing owner sessions continue working (Clerk JWTs are validated locally using cached JWKS). Viewer sessions are completely unaffected (use custom JWT, not Clerk).

**Mitigation:**

- Clerk JWKS are cached locally by the `@clerk/nextjs` SDK. Sessions issued before the outage remain valid for their TTL (typically 7 days).
- No automatic failover. Accept this risk for MVP (Clerk's SLA is 99.99%).

### 11.6 Encryption Key Corruption

**Trigger:** KMS key deleted or disabled, DEK cache poisoned.

**Detection:** Decryption failures (AES-GCM auth tag verification fails).

**Impact:** Cannot read affected user's health data.

**Mitigation:**

- KMS keys have a 30-day deletion waiting period (AWS default). Can be canceled.
- DEK cache entries are keyed by KMS key ARN. If the key changes, old cache entries are naturally invalidated.
- On decryption failure, clear the DEK cache for that user and retry once (in case of stale cached DEK).
- If retry fails, return 500 and alert immediately. This indicates data corruption or key compromise — a critical incident.

### 11.7 Share Token Brute-Force Attempt

**Trigger:** Attacker systematically guesses share tokens.

**Detection:** High rate of 404 responses on `/api/viewer/validate` from a single IP.

**Impact:** None if rate limiting holds. Token space is 256 bits; brute force is computationally infeasible.

**Mitigation:**

- Rate limit: 10 attempts per minute per IP (Section 7.1).
- After 50 failed attempts from a single IP in 1 hour, block the IP for 24 hours (implemented in Edge middleware).
- Token entropy: 256 bits (2^256 possible tokens). At 10 attempts/minute, exhaustive search would take ~10^70 years.
- Alert on IPs that hit the rate limit repeatedly.

---

## 12. Security

### 12.1 Authentication Model

**Owner Authentication:**

- Managed entirely by Clerk.
- Session cookie: `__session` (httpOnly, Secure, SameSite=Lax).
- Session validation: Clerk SDK validates the JWT locally using cached JWKS keys. No network call on each request.
- Session TTL: 7 days (Clerk default, configurable).
- 2FA: TOTP via Clerk's built-in MFA. Enrollment and verification handled by Clerk UI components.

**Viewer Authentication:**

- Custom JWT in cookie: `totus_viewer` (httpOnly, Secure, SameSite=Lax).
- JWT signing: HMAC-SHA256 using `VIEWER_JWT_SECRET` environment variable.
- JWT payload:

```json
{
  "grantId": "550e8400-e29b-41d4-a716-446655440000",
  "ownerId": "user_2xABC123",
  "allowedMetrics": ["sleep_score", "hrv", "rhr", "weight"],
  "dataStart": "2025-06-01",
  "dataEnd": "2026-03-08",
  "iat": 1741443781,
  "exp": 1741458181,
  "jti": "vs_random_session_id"
}
```

- JWT TTL: `min(grant_expires - now(), 4 hours)`.
- The `jti` (JWT ID) is a random session identifier used in audit events.

**Secret Rotation:**

- `VIEWER_JWT_SECRET` supports dual-secret validation: the middleware attempts verification with the primary secret first, then the secondary. This enables zero-downtime rotation.
- Environment variables: `VIEWER_JWT_SECRET` (current) and `VIEWER_JWT_SECRET_PREVIOUS` (old, during rotation window).

### 12.2 Encryption Details

**Envelope Encryption Flow (Write):**

1. Application calls `kms:GenerateDataKey` with the user's CMK ARN. KMS returns both a plaintext DEK and a KMS-encrypted copy of the DEK.
2. Application encrypts the health data value JSON string using AES-256-GCM with the plaintext DEK and a random 12-byte nonce.
3. Application assembles the `value_encrypted` BYTEA blob:
   - 4 bytes: length of the encrypted DEK (uint32 big-endian)
   - N bytes: KMS-encrypted DEK
   - 12 bytes: AES-GCM nonce
   - M bytes: AES-256-GCM ciphertext
   - 16 bytes: AES-GCM authentication tag
4. Application stores the blob in the `value_encrypted` column.
5. Plaintext DEK is cached in memory with key = `{user_id}:{kms_key_arn}`, TTL = 5 minutes.

**Envelope Encryption Flow (Read):**

1. Check DEK cache for `{user_id}:{kms_key_arn}`.
2. If cache miss: extract the encrypted DEK from the first data row's `value_encrypted` blob, call `kms:Decrypt`, cache the result.
3. For each row: extract nonce + ciphertext + auth tag, decrypt with the cached plaintext DEK.
4. Parse the decrypted JSON to extract the value.

**DEK Reuse:** A single DEK is used for all health data rows belonging to the same user, until the cache expires and a new DEK is generated. This means consecutive writes reuse the same DEK (reducing KMS calls) and reads can decrypt all of a user's data with a single KMS call (to unwrap the DEK). The trade-off is that a compromised DEK exposes all of one user's data — but this is equivalent to a compromised KMS key, which envelope encryption cannot prevent anyway.

### 12.3 Input Validation

All API inputs are validated with Zod schemas before any business logic executes.

**Validation Rules Summary:**

| Input                   | Validation                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Metric type strings     | Must be in the metric type enum. Rejects unknown strings.                           |
| Date strings            | Must match `YYYY-MM-DD` format. Must be valid calendar dates (no Feb 30).           |
| Date ranges             | `end >= start`. Max span 1,825 days. Start not in the future.                       |
| Share labels            | 1-255 chars. Stripped of HTML tags (DOMPurify-style sanitization).                  |
| Share notes             | 0-1000 chars. Same sanitization.                                                    |
| Display names           | 1-100 chars. Same sanitization.                                                     |
| Share tokens (incoming) | Must be a valid base64url string, exactly 43 characters.                            |
| UUIDs (path params)     | Must match UUID v4 format regex.                                                    |
| Pagination cursors      | Must be valid base64url. Decoded payload must contain `c` (timestamp) and `i` (id). |
| Pagination limits       | Integer, 1-100.                                                                     |

**SQL Injection Prevention:** Drizzle ORM uses parameterized queries exclusively. Raw SQL is never constructed from user input. The Drizzle query builder produces prepared statements where all values are bound parameters.

**XSS Prevention:** API responses are JSON only (`Content-Type: application/json`). No HTML is returned by API routes. The `X-Content-Type-Options: nosniff` header prevents browser MIME sniffing.

### 12.4 Security Headers

Set by Next.js middleware on all responses:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://clerk.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.clerk.com https://clerk.com;
```

### 12.5 CORS Policy

- Origin: `https://totus.com` only (no wildcard).
- Methods: `GET, POST, PATCH, DELETE, OPTIONS`.
- Credentials: `true` (cookies are required for auth).
- Max-Age: `86400` (24 hours for preflight cache).

For development: `http://localhost:3000` is added to the allowed origins.

---

## 13. Testing and Observability

### 13.1 Test Strategy

**Unit Tests (Vitest):**

- Zod schema validation: test every schema with valid, invalid, and edge-case inputs.
- `enforcePermissions()`: test every combination of owner/viewer, valid/expired/revoked grants, metric intersection, date clamping.
- Cursor encoding/decoding: test round-trip encoding.
- Metric type registry: test that all metric types have required fields.
- Share token generation: test randomness, length, base64url encoding.
- Token hashing: test SHA-256 determinism and format.

**Integration Tests (Vitest + test database):**

- Database CRUD: test every table's insert, select, update, delete (where permitted).
- Audit immutability: confirm that UPDATE and DELETE on `audit_events` raise exceptions.
- Upsert semantics: test `ON CONFLICT` behavior for health data.
- Foreign key cascades: test that deleting a user cascades to health_data, oura_connections, share_grants.
- Index effectiveness: run EXPLAIN ANALYZE on key queries (Section 9) and verify index scans.

**API Tests (Playwright or Supertest against running app):**

- Auth enforcement: test every endpoint with no auth, owner auth, and viewer auth. Verify correct 401/403 responses.
- Permission enforcement: test viewer data access with metrics outside grant, dates outside grant, expired grant, revoked grant.
- Rate limiting: verify 429 responses after exceeding limits.
- Pagination: test cursor-based pagination with varying page sizes.
- Error responses: verify all error codes and envelope format.
- Share lifecycle: create -> validate -> view data -> revoke -> validate (should fail).

**Target Coverage:** >95% branch coverage on auth/permission code paths. >80% on remaining API handlers.

### 13.2 Observability

**Structured Logging:**

- Format: JSON lines.
- Every API request logs: `{ timestamp, requestId, method, path, statusCode, durationMs, userId?, grantId?, error? }`.
- Correlation ID: `X-Request-Id` header (generated by Vercel or middleware if absent). Passed through all internal service calls and database operations.
- Log destination: Vercel's built-in log drain. Can be forwarded to Axiom or Datadog.

**Metrics to Track:**

| Metric                        | Type                              | Alert Threshold        |
| ----------------------------- | --------------------------------- | ---------------------- |
| `api.request.duration`        | Histogram (by endpoint)           | p95 > 2s               |
| `api.request.count`           | Counter (by endpoint, status)     | —                      |
| `api.error.count`             | Counter (by endpoint, error_code) | > 10/min for 5xx       |
| `db.query.duration`           | Histogram (by query name)         | p95 > 1s               |
| `db.connection.pool.active`   | Gauge                             | > 8 (of 10)            |
| `kms.decrypt.duration`        | Histogram                         | p95 > 500ms            |
| `kms.decrypt.cache.hit_rate`  | Gauge                             | < 80%                  |
| `share.validate.failure_rate` | Gauge (per IP)                    | > 10/min (brute force) |
| `audit.write.failure_count`   | Counter                           | > 0                    |
| `oura.sync.duration`          | Histogram                         | p95 > 60s              |
| `oura.sync.failure_count`     | Counter                           | > 3 consecutive        |

**Alarms:**

| Alarm                          | Condition                                                               | Action                                           |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------ |
| High error rate                | 5xx responses > 5% of traffic for 5 minutes                             | Page founder (PagerDuty/email)                   |
| Database connection exhaustion | Pool active connections > 80% for 2 minutes                             | Alert; investigate connection leaks              |
| KMS unavailable                | 3+ consecutive KMS errors                                               | Alert; check IAM and KMS service health          |
| Audit write failures           | Any audit insert failure                                                | Alert; lost audit events must be investigated    |
| Brute force detection          | Single IP hits rate limit on `/api/viewer/validate` > 5 times in 1 hour | Auto-block IP for 24 hours; alert                |
| Oura sync stale                | No successful sync for any user in 24 hours                             | Alert; check Oura API status and token freshness |

### 13.3 Health Check Endpoint

**GET /api/health**

Not authenticated. Returns system health status.

**Response 200:**

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "kms": "ok"
  },
  "timestamp": "2026-03-08T14:23:01.000Z"
}
```

**Response 503 (if any check fails):**

```json
{
  "status": "degraded",
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "kms": "error: timeout after 3000ms"
  },
  "timestamp": "2026-03-08T14:23:01.000Z"
}
```

The health check performs a lightweight query (`SELECT 1`) against the database and a `kms:DescribeKey` call against one known key. Both have 3-second timeouts.

---

## 14. Cost Analysis

### 14.1 Aurora Serverless v2

| Item                                         | Estimate       | Notes                                    |
| -------------------------------------------- | -------------- | ---------------------------------------- |
| Minimum capacity (0.5 ACU)                   | ~$43/month     | 0.5 ACU _ $0.12/ACU-hour _ 730 hours     |
| Average capacity (1 ACU during active hours) | ~$55/month     | Accounts for scale-up during peak usage  |
| Storage (1 GB estimated at MVP)              | ~$0.10/month   | $0.10/GB-month                           |
| I/O requests                                 | ~$2/month      | $0.20 per 1M requests; MVP volume is low |
| **Subtotal**                                 | **~$57/month** |                                          |

### 14.2 AWS KMS

| Item                                    | Estimate       | Notes                                                              |
| --------------------------------------- | -------------- | ------------------------------------------------------------------ |
| CMK keys (pool of 10)                   | $10/month      | $1/key/month × 10 keys. Users assigned via `hash(user_id) % 10`.   |
| API requests (GenerateDataKey, Decrypt) | ~$1.50/month   | $0.03 per 10,000 requests; DEK caching reduces calls significantly |
| **Subtotal**                            | **~$12/month** |                                                                    |

**KMS Design Decision (OQ4 — resolved):** Pool of 10 shared CMKs at $10/month. Each user's data is still encrypted with a unique per-user DEK (generated via `GenerateDataKey`), but the DEK is wrapped by one of 10 CMKs rather than a per-user CMK. This provides strong envelope encryption isolation at 98% cost reduction vs. per-user CMKs. Upgrade path to per-user CMKs exists if a compliance requirement demands it.

### 14.3 AWS S3

| Item                   | Estimate         | Notes             |
| ---------------------- | ---------------- | ----------------- |
| Storage (data exports) | ~$0.10/month     | Minimal at MVP    |
| Requests               | ~$0.05/month     | Low volume at MVP |
| **Subtotal**           | **~$0.15/month** |                   |

### 14.4 Vercel

| Item                          | Estimate       | Notes                                                     |
| ----------------------------- | -------------- | --------------------------------------------------------- |
| Pro plan                      | $20/month      | Required for custom domains, analytics, higher limits     |
| Serverless Function execution | Included       | Pro plan includes 1,000 GB-hours; MVP usage is well under |
| Bandwidth                     | Included       | Pro plan includes 1 TB; MVP usage is negligible           |
| **Subtotal**                  | **~$20/month** |                                                           |

### 14.5 Clerk

| Item             | Estimate     | Notes                   |
| ---------------- | ------------ | ----------------------- |
| First 10,000 MAU | Free         | MVP target is 500 users |
| **Subtotal**     | **$0/month** | Free during MVP         |

### 14.6 Total MVP Monthly Cost

| Category             | Cost           |
| -------------------- | -------------- |
| Aurora Serverless v2 | $57            |
| AWS KMS              | $12            |
| AWS S3               | $0.15          |
| Vercel Pro           | $20            |
| Clerk                | $0             |
| **Total**            | **~$89/month** |

**Cost Sensitivity:** Aurora is now the dominant cost (64%). Total monthly cost is well within a solo founder's budget. Cost scales linearly with user count primarily through Aurora ACU usage and KMS API calls, not key count.

---

## 15. Tooling Stack and Development Environment

This section specifies the exact tools, versions, and configurations used to build, test, deploy, and operate Totus. Every choice is deliberate and justified. Implementation agents should use these tools — not alternatives — unless a compelling reason arises and is documented here.

| Category        | Tool                | Version          | Purpose                                              |
| --------------- | ------------------- | ---------------- | ---------------------------------------------------- |
| IaC             | AWS CDK             | ^2.170.0         | Infrastructure provisioning                          |
| Package Manager | Bun                 | ^1.2.0           | Package management, script runner, local dev runtime |
| DB Migrations   | Drizzle Kit         | ^0.30.0          | Schema migrations                                    |
| CI/CD           | GitHub Actions      | N/A              | Build, test, deploy pipeline                         |
| Deployment      | Vercel              | N/A              | Hosting and edge functions                           |
| Linting         | ESLint              | ^9.0.0           | Code quality                                         |
| Formatting      | Prettier            | ^3.4.0           | Code formatting                                      |
| Pre-commit      | Husky + lint-staged | ^9.0.0 / ^15.0.0 | Git hooks                                            |
| Error Tracking  | Sentry              | ^8.0.0           | Error monitoring                                     |
| Local DB        | Docker Compose      | N/A              | Local PostgreSQL                                     |
| API Docs        | zod-to-openapi      | ^7.0.0           | OpenAPI spec generation                              |
| Logging         | pino                | ^9.0.0           | Structured JSON logging                              |

### 15.1 Infrastructure as Code

**Tool: AWS CDK (TypeScript)**

AWS CDK manages all AWS resources declaratively in TypeScript — the same language as the application. A single CDK stack provisions:

- **Aurora Serverless v2 cluster** — VPC, subnet groups (private subnets only), security groups (ingress restricted to Vercel IP ranges + bastion), parameter groups.
- **KMS key pool** — 10 customer-managed CMKs with key rotation enabled, key policies scoped to the `totus_app` IAM role.
- **S3 bucket** — data exports bucket with lifecycle rules (auto-delete after 7 days), server-side encryption (SSE-S3), and public access blocked.
- **IAM roles** — `totus_app` (runtime: limited to KMS Decrypt, GenerateDataKey, S3 PutObject) and `totus_migrate` (deployment: RDS IAM auth for DDL operations).
- **Secrets Manager** — Oura OAuth credentials (`oura_client_id`, `oura_client_secret`) and the viewer JWT secret. Secrets are referenced by ARN in Vercel environment variables, not duplicated.

**Rationale:** CDK uses TypeScript (same as the app), provides compile-time type safety for infrastructure, and is the AWS-native IaC tool. Terraform is a viable alternative but introduces HCL as a second language and requires provider version management. For a solo founder with an all-AWS backend, CDK is the simpler choice.

**CDK stack location:** `infra/` directory at the project root.

### 15.2 Package Manager and Runtime

**Tool: Bun**

Bun is used as the **package manager**, **script runner**, and **local development runtime**. Production runtime on Vercel remains **Node.js** (Bun runtime on Vercel is public beta; not yet recommended for production).

- **Why Bun over pnpm/npm/yarn:** Significantly faster installs and script execution (native runtime, not Node.js). Built-in TypeScript transpilation. Simpler toolchain — fewer moving parts. Vercel has GA support for Bun as a package manager (auto-detects `bun.lock`).
- **Lock file:** `bun.lock` committed to git. CI installs with `bun install --frozen-lockfile` to ensure reproducible builds.
- **Engine requirements** in `package.json`:
  ```json
  {
    "engines": {
      "node": ">=20.x"
    }
  }
  ```
  Node.js is still required in the environment for Playwright tests (Playwright does not support the Bun runtime — see Section 15.7).
- **Workspace:** Single-package repository (no monorepo workspaces at MVP). If the CDK stack grows, it can be extracted into a `packages/infra` workspace later.
- **Runtime boundaries:**
  - **Bun**: package installs (`bun install`), script execution (`bun run dev`, `bun run lint`, `bun run test`), local dev server (`bun run --bun next dev`)
  - **Node.js**: Vercel serverless functions (production), Playwright E2E tests, Drizzle Kit CLI (internally uses Node.js)
  - **Why not Bun runtime in production?** Vercel's Bun runtime is public beta. AWS SDK v3 has documented streaming/concurrency issues under Bun. The risk is not justified at MVP. Revisit when Vercel promotes Bun runtime to GA.

### 15.3 Database Migrations

**Tool: Drizzle Kit**

Drizzle Kit generates and applies SQL migration files from the Drizzle ORM schema definitions (specified in Section 8.4).

- **Development workflow:**
  1. Modify Drizzle schema files in `src/db/schema/`.
  2. Run `drizzle-kit generate` to produce a SQL migration file in `drizzle/migrations/`.
  3. Review the generated SQL (always review — never blindly apply).
  4. Run `drizzle-kit push` to apply directly to the local development database.

- **Production workflow:**
  1. Migration files in `drizzle/migrations/` are committed to git and reviewed in PR.
  2. On deploy, `drizzle-kit migrate` runs against the production Aurora instance.
  3. The `totus_migrate` database role (Section 8.2) executes migrations — it has DDL privileges (`CREATE`, `ALTER`, `DROP`).
  4. The `totus_app` role (Section 8.2) is used at runtime — it has only DML privileges and explicitly lacks `UPDATE`/`DELETE` on `audit_events`.

- **Rollback strategy:** Drizzle Kit does not auto-generate rollback scripts. For each migration, a manual `down.sql` is written and stored alongside the `up.sql`. At MVP scale, manual rollback is acceptable. Post-MVP, consider adding automated rollback tooling.

### 15.4 CI/CD Pipeline

**Tools: GitHub Actions + Vercel**

**GitHub Actions** orchestrates the build/test pipeline. **Vercel** handles deployment (connected to the GitHub repo via Vercel's GitHub integration).

**On pull request:**

1. `bun install --frozen-lockfile`
2. `bun run lint` — ESLint
3. `bun run type-check` — `tsc --noEmit`
4. `bun run test` — unit tests (Vitest)
5. Vercel automatically creates a **preview deployment** for the PR (no GitHub Actions step needed).

**On merge to `main`:**

1. Full test suite (unit + integration tests).
2. Vercel automatically deploys to **production** (triggered by push to `main`).
3. **Post-deploy step** (GitHub Actions): Run `drizzle-kit migrate` against the production Aurora instance via a secure connection (see below).

**Database migration in CI:**

- The GitHub Actions runner connects to Aurora via **AWS Systems Manager Session Manager** (SSM port forwarding through a bastion instance in the VPC). This avoids exposing the database to the public internet.
- Alternative: Run the migration as a Vercel serverless function invoked during the deploy hook. This is simpler but mixes deployment concerns with application code. SSM bastion is preferred.

**GitHub Actions secrets required:**

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (for SSM + RDS IAM auth)
- `DATABASE_URL` (Aurora connection string, used only for migrations)

### 15.5 Environment Management

**Production and preview environments** are managed via Vercel Environment Variables (encrypted at rest, scoped per environment).

| Variable                            | Environments                     | Description                                          |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                      | Production, Preview              | Aurora PostgreSQL connection string (IAM auth)       |
| `CLERK_SECRET_KEY`                  | Production, Preview              | Clerk backend API key                                |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production, Preview, Development | Clerk frontend key (public, safe to expose)          |
| `OURA_CLIENT_ID`                    | Production                       | Oura OAuth application client ID                     |
| `OURA_CLIENT_SECRET`                | Production                       | Oura OAuth application client secret                 |
| `VIEWER_JWT_SECRET`                 | Production                       | Active HMAC-SHA256 secret for viewer session JWTs    |
| `VIEWER_JWT_SECRET_PREVIOUS`        | Production                       | Previous secret for graceful rotation (Section 12.1) |
| `KMS_KEY_ARNS`                      | Production                       | Comma-separated list of 10 CMK ARNs                  |
| `AWS_ACCESS_KEY_ID`                 | Production                       | IAM credentials for KMS and S3 access                |
| `AWS_SECRET_ACCESS_KEY`             | Production                       | IAM credentials for KMS and S3 access                |
| `AWS_REGION`                        | Production, Preview              | AWS region (e.g., `us-east-1`)                       |
| `SENTRY_DSN`                        | Production, Preview              | Sentry data source name for error tracking           |

**Local development:**

- **`.env.local`** — git-ignored, contains local overrides (local PostgreSQL URL, Clerk dev keys, etc.).
- **`.env.example`** — committed to git with placeholder values and inline comments explaining each variable. New developers copy this to `.env.local` and fill in real values.

### 15.6 Code Quality

**ESLint** with `@typescript-eslint` parser and the following rule sets:

- `eslint:recommended`
- `@typescript-eslint/recommended`
- `next/core-web-vitals` (Next.js-specific rules)
- Custom rules: `no-console: warn` (use `pino` logger instead), `@typescript-eslint/no-explicit-any: error`.

**Prettier** for formatting:

- Configuration in `.prettierrc`:
  ```json
  {
    "semi": true,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 100,
    "tabWidth": 2
  }
  ```

**TypeScript** strict mode:

- `strict: true` in `tsconfig.json` (enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, etc.).
- `noUncheckedIndexedAccess: true` for additional safety on array/object access.

**Pre-commit hooks** via **Husky** + **lint-staged**:

- On `git commit`, lint-staged runs:
  - `eslint --fix` on staged `.ts` and `.tsx` files.
  - `prettier --write` on staged `.ts`, `.tsx`, `.json`, `.md` files.
- This ensures all committed code passes lint and formatting checks without requiring developers to remember to run them manually.

**Zod as the single source of truth:**

- Zod schemas (defined in `src/lib/schemas/`) validate API request bodies, query parameters, and response shapes.
- The same schemas generate TypeScript types (via `z.infer<>`) used in the frontend.
- The same schemas generate the OpenAPI spec (via `zod-to-openapi`; see Section 15.9).
- This eliminates drift between validation logic, TypeScript types, and API documentation.

### 15.7 Local Development

**Development server:**

- `bun run dev` — runs Next.js on `http://localhost:3000` with hot module replacement. Uses `bun run --bun next dev` under the hood for faster startup.

**Local PostgreSQL:**

- **Docker Compose** provides a local PostgreSQL 16 instance matching the Aurora production engine.
- `docker-compose.yml` at the project root:
  ```yaml
  services:
    postgres:
      image: postgres:16
      ports:
        - "5432:5432"
      environment:
        POSTGRES_DB: totus_dev
        POSTGRES_USER: totus_app
        POSTGRES_PASSWORD: localdev
      volumes:
        - pgdata:/var/lib/postgresql/data
  volumes:
    pgdata:
  ```
- `bun run db:push` — applies the current Drizzle schema to the local database (uses `drizzle-kit push`).
- `bun run db:seed` — populates the local database with sample health data for all 21 metric types (Section 19.1), covering 90 days of synthetic data.

**Playwright tests (Node.js):**

- Playwright does not support the Bun runtime (hangs, segfaults on browser launching due to incomplete IPC/child process APIs). E2E tests run via `bunx playwright test`, which delegates execution to Node.js automatically. Node.js must be available in `PATH`.

**KMS simulation:**

- **LocalStack** provides a local KMS-compatible API for development. The CDK stack is NOT used locally — LocalStack runs as an additional Docker Compose service.
- Configuration: set `AWS_ENDPOINT_URL=http://localhost:4566` in `.env.local` to redirect KMS calls to LocalStack.
- Alternative (NOT recommended): a feature flag to disable encryption in development. This is discouraged because it creates a code path that diverges from production and may mask encryption-related bugs.

**Clerk:**

- Use Clerk's **development instance** (free, separate from production). The development instance has relaxed security policies and test user accounts.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local` point to the development instance.

### 15.8 Monitoring and Error Tracking

**Sentry** (via Vercel integration):

- Automatic capture of unhandled exceptions in both serverless functions and client-side React.
- Performance monitoring: transaction tracing for API routes (tracks latency, database query time, KMS call time).
- Source maps uploaded during build for readable stack traces.
- Alert rules: notify on new error types, error rate spike (>5x baseline), and p95 latency degradation.

**Vercel Analytics:**

- Web Vitals tracking (LCP, FID, CLS) for the frontend.
- Serverless function metrics (invocation count, duration, cold starts).
- Included in the Vercel Pro plan at no additional cost.

**Log drain (post-MVP):**

- Vercel supports log drains to **Axiom**, **Datadog**, or **Better Stack**. Not configured at MVP launch, but the structured logging format (see below) is designed to be drain-compatible from day one.

**Structured logging:**

- **pino** as the logging library (fast, JSON-native, minimal overhead).
- All log entries include: `timestamp`, `level`, `message`, `requestId` (from middleware), `userId` (if authenticated), `path`, `method`.
- Log levels: `error` (failures), `warn` (degraded state), `info` (request lifecycle), `debug` (development only, disabled in production).
- Example log entry:
  ```json
  {
    "level": "info",
    "time": 1741500000000,
    "requestId": "req_abc123",
    "userId": "user_xyz",
    "method": "GET",
    "path": "/api/health-data",
    "statusCode": 200,
    "duration": 142,
    "msg": "Request completed"
  }
  ```

### 15.9 API Documentation

**OpenAPI spec generation:**

- **`zod-to-openapi`** generates an OpenAPI 3.1 spec from the Zod schemas used for request/response validation.
- The spec file (`openapi.json`) is auto-generated during the build step (`bun run build`).
- The spec is committed to git so that changes to API contracts are visible in pull request diffs.

**Swagger UI (development only):**

- A development-only route at `/api/docs` serves Swagger UI, rendering the OpenAPI spec interactively.
- This route is disabled in production via an environment check (`process.env.NODE_ENV !== 'production'`).
- Useful for manual API exploration and testing during development.

**Spec validation:**

- CI runs `bun run openapi:validate` to ensure the generated spec is valid OpenAPI 3.1 and matches the implemented routes.

---

## 16. Design Alternatives Considered

### 16.1 REST vs. tRPC

**Considered:** tRPC for type-safe API communication between Next.js frontend and backend.

**Rejected because:**

- The viewer API is consumed by unauthenticated browser sessions where tRPC's type safety provides no benefit (no shared TypeScript context).
- The PRD requires OpenAPI compliance. tRPC does not natively produce OpenAPI specs (the `trpc-openapi` adapter exists but adds complexity).
- REST is simpler to document, test with standard HTTP tools (curl, Postman), and understand for future developers.
- Zod schemas shared between frontend and API routes provide equivalent type safety for the owner-facing API.

### 16.2 GraphQL

**Considered:** GraphQL for flexible data querying (different metrics, date ranges, resolutions).

**Rejected because:**

- Health data queries are predictable (metrics + date range + resolution). There is no N+1 problem or complex relational traversal that GraphQL excels at.
- GraphQL adds significant complexity (schema definition, resolvers, authorization per field).
- Permission enforcement on field-level GraphQL queries is harder to audit than REST endpoint-level enforcement.
- Over-fetching is not a problem with the designed REST API (responses are already tailored to requested metrics).

### 16.3 Row-Level Security (RLS) in PostgreSQL

**Considered:** Using PostgreSQL RLS policies instead of application-level permission enforcement.

**Rejected because:**

- RLS requires setting a session variable (`SET app.current_user_id = 'xxx'`) on each connection. With connection pooling in a serverless environment, this is error-prone (risk of session variable leaking between requests).
- Viewer permissions are dynamic (per-grant metric and date scoping). Expressing `WHERE metric_type = ANY(current_grant_metrics) AND date BETWEEN grant_start AND grant_end` as an RLS policy per viewer session is awkward.
- Application-level enforcement via `enforcePermissions()` is easier to test, debug, and audit.
- RLS is not wrong here, but the application-level approach is simpler and safer for a solo founder.

### 16.4 DynamoDB Instead of PostgreSQL

**Considered:** DynamoDB for health data storage (time-series data, predictable access patterns).

**Rejected because:**

- The audit log requires flexible querying (filter by event type, grant, actor, date range). DynamoDB's query model (partition key + sort key) would require multiple GSIs or scan operations for these filters.
- Share grants require a UNIQUE constraint on the token hash. DynamoDB has no built-in uniqueness constraint (must use conditional puts).
- JOIN between audit_events and share_grants (for grant_label) is not possible in DynamoDB.
- Aurora Serverless v2 handles MVP scale easily and provides relational flexibility as the schema evolves.
- PostgreSQL text arrays (`TEXT[]`) for `allowed_metrics` are a natural fit. DynamoDB would require a Set type with different query semantics.

### 16.5 Storing Raw Share Tokens Instead of Hashes

**Considered:** Storing the raw base64url share token directly in the database.

**Rejected because:**

- If the database is compromised (SQL injection, backup theft, insider threat), all share tokens are immediately usable by the attacker.
- Storing only the SHA-256 hash means a database breach does not expose usable tokens. The attacker would need to brute-force 256-bit tokens to reconstruct a working URL.
- The trade-off is that the raw token can only be shown once (at creation time). This is an acceptable UX constraint and is communicated clearly in the UI.

### 16.6 Separate Database for Audit Events

**Considered:** Using a dedicated append-only store (e.g., S3 + Athena, or a separate PostgreSQL instance) for audit events.

**Rejected for MVP because:**

- At 500 users, audit volume is low (~50,000 events/month estimated). PostgreSQL handles this trivially.
- A separate store adds operational complexity (another database to manage, cross-system queries for grant_label JOINs).
- The immutability guarantee (REVOKE UPDATE/DELETE + trigger) is sufficient for MVP.
- **Post-MVP migration path:** If audit volume grows significantly, partition the table by month and eventually archive old partitions to S3 with Athena for querying.

### 16.7 JWT-Based Share Tokens (Signed, Self-Contained)

**Considered:** Encoding the entire grant scope into a signed JWT as the share token (no database lookup needed).

**Rejected because:**

- JWTs cannot be revoked without a database check. The whole point of revocable share links requires a database lookup to verify `revoked_at IS NULL`.
- JWTs would encode metric names and date ranges in the URL, leaking information.
- JWT URLs are long and ugly. A 43-character base64url token is much cleaner for sharing.
- The database lookup on token validation is fast (unique index, single row, ~2ms).

---

## 17. Risks and Mitigations

| #   | Risk                                                                                              | Severity | Likelihood         | Mitigation                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------- | -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | CMK pool compromise affects all users assigned to that key (~50 users per CMK at 500 users)       | Medium   | Low                | Pool of 10 limits blast radius to ~10% of users per key. Monitor KMS CloudTrail for unauthorized access. Upgrade path to per-user CMKs exists if compliance requires it.                                                 |
| R2  | Aurora Serverless v2 cold start on first request after idle period causes >2s dashboard load      | Medium   | Medium             | Set minimum ACU to 0.5 (never fully cold). Use Vercel Cron to ping `/api/health` every 5 minutes to keep DB warm.                                                                                                        |
| R3  | Oura API deprecates v2 or changes rate limits without notice                                      | Medium   | Low                | Abstract Oura API calls behind `OuraService` interface. Monitor Oura developer changelog. Have a circuit breaker that disables sync if error rate exceeds 50%.                                                           |
| R4  | DEK cache in serverless function memory is per-invocation (no shared state)                       | Low      | High               | Each function invocation must warm its own DEK cache. First request after cold start pays the KMS call (~50ms). Acceptable for MVP. Post-MVP: cache DEKs in Redis with encryption.                                       |
| R5  | Viewer JWT secret compromise enables forging viewer sessions                                      | High     | Low                | Secret stored in Vercel environment variables (encrypted at rest). Rotation supported via dual-secret validation. If compromised: rotate immediately; all existing viewer sessions invalidate; users re-share links.     |
| R6  | Single-region database means single point of failure for data                                     | High     | Low                | Aurora automated backups (daily, 7-day retention). Point-in-time recovery available. Documented recovery procedure created before launch. Post-MVP: consider Aurora Global Database for multi-region.                    |
| R7  | Audit table grows unbounded over time                                                             | Low      | Medium (long-term) | Partition by `created_at` month (post-MVP). For MVP, 500 users \* 100 events/user/month = 50K rows/month. After 1 year: 600K rows. PostgreSQL handles this easily with proper indexes.                                   |
| R8  | Envelope encryption blob format versioning — if we change the format, old data becomes unreadable | Medium   | Low                | Include a 1-byte version prefix in the `value_encrypted` blob (version 0x01 for the initial format). Decryption logic switches on version byte. This is specified in Section 8.3.4 but must be implemented from day one. |

**Revision to Section 8.3.4 (health_data.value_encrypted wire format):**

The `value_encrypted` BYTEA blob format is versioned:

```
[1 byte: format version (0x01)]
[4 bytes: encrypted DEK length (uint32 big-endian)]
[N bytes: KMS-encrypted DEK]
[12 bytes: AES-GCM nonce]
[M bytes: AES-256-GCM ciphertext]
[16 bytes: AES-GCM auth tag]
```

The version byte allows future changes to the encryption format without breaking existing data.

---

## 18. Open Questions

All open questions have been resolved. Decisions recorded below for traceability.

| #   | Question                               | Decision                                                                                                                                                                                                                                                                                 | Rationale                                                                                                                                                               |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ1 | DEK rotation strategy                  | **B) New DEK per encryption batch.** Each `value_encrypted` blob contains its own KMS-encrypted DEK. `GenerateDataKey` is called when the in-memory cache expires (every 5 minutes); the resulting DEK is reused for that batch.                                                         | Balances security and cost. Can change post-MVP without re-encrypting existing data.                                                                                    |
| OQ2 | Viewer behavior on revocation          | **A) Revoked on next data fetch.** `GET /api/viewer/data` re-validates the grant against the DB on every call (grant_id checked for revocation even though JWT contains scope). Cookie TTL is 4 hours but each data fetch is gate-checked.                                               | Immediate-ish revocation without requiring WebSocket push or real-time invalidation.                                                                                    |
| OQ3 | Owner audit logging                    | **C) Log everything, filter in UI.** All data access (owner + viewer + system) is logged. The audit UI defaults to `actor_type=viewer` filter so the owner isn't overwhelmed. The API returns all events when no filter is specified.                                                    | Complete audit coverage. Owner can toggle filter to see their own views if desired.                                                                                     |
| OQ4 | KMS key strategy                       | **B) Shared CMK pool of 10 ($10/month).** Each user is assigned to one of 10 CMKs via deterministic mapping (`hash(user_id) % 10`). Per-user DEKs still provide envelope encryption isolation — each user's data is encrypted with a unique DEK, but the DEK is wrapped by a shared CMK. | Reduces KMS cost from $502/mo to $10/mo (98% reduction) while maintaining per-user DEK isolation. Upgrade path to per-user CMKs exists if security posture requires it. |
| OQ5 | Max active share grants per user       | **B) 50 active shares.** Limit applies to non-revoked, non-expired grants only. Enforced at application level in `POST /api/shares`.                                                                                                                                                     | Generous for legitimate use (multiple doctors/coaches). Prevents automated abuse.                                                                                       |
| OQ6 | Audit retention after account deletion | **A) Forever.** Audit events persist after account deletion. Clerk user ID is meaningless post-deletion. IP addresses are the only quasi-PII. Volume is negligible.                                                                                                                      | Simple. Revisit with anonymization (option C) if targeting EU users under GDPR.                                                                                         |

---

## 19. Appendix

### 19.1 Metric Type Enum Values

The complete list of valid metric type identifiers for the MVP:

```
sleep_score
sleep_duration
sleep_efficiency
sleep_latency
deep_sleep
rem_sleep
light_sleep
awake_time
hrv
rhr
respiratory_rate
body_temperature_deviation
readiness_score
activity_score
steps
active_calories
total_calories
spo2
glucose
weight
body_fat
```

Total: 21 metric types.

### 19.2 Audit Event `resource_detail` Schemas by Event Type

**`data.viewed`:**

```json
{
  "metrics": ["sleep_score", "hrv"],
  "date_range": { "start": "2025-06-01", "end": "2026-03-08" },
  "resolution": "daily",
  "data_points_returned": 540
}
```

**`data.imported`:**

```json
{
  "source": "oura",
  "metrics": ["sleep_score", "hrv", "rhr", "steps"],
  "date_range": { "start": "2026-03-07", "end": "2026-03-08" },
  "rows_upserted": 8
}
```

**`data.exported`:**

```json
{
  "format": "zip",
  "metrics_included": ["sleep_score", "hrv", "rhr", "weight", "glucose"],
  "total_data_points": 4720,
  "size_bytes": 245678
}
```

**`data.deleted`:**

```json
{
  "scope": "account",
  "total_rows_deleted": 4720
}
```

**`share.created`:**

```json
{
  "grant_id": "550e8400-e29b-41d4-a716-446655440000",
  "label": "For Dr. Patel",
  "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
  "data_start": "2025-06-01",
  "data_end": "2026-03-08",
  "grant_expires": "2026-04-07T14:23:01.000Z"
}
```

**`share.revoked`:**

```json
{
  "grant_id": "550e8400-e29b-41d4-a716-446655440000",
  "label": "For Dr. Patel",
  "view_count_at_revocation": 3
}
```

**`share.deleted`:**

```json
{
  "grant_id": "550e8400-e29b-41d4-a716-446655440000",
  "label": "For Dr. Patel"
}
```

**`share.viewed`:**

```json
{
  "grant_id": "550e8400-e29b-41d4-a716-446655440000",
  "label": "For Dr. Patel"
}
```

**`account.login`:**

```json
{
  "method": "password",
  "mfa_used": true
}
```

**`account.2fa_enabled`:**

```json
{
  "method": "totp"
}
```

**`account.settings`:**

```json
{
  "field": "display_name",
  "old_value": "Wes E.",
  "new_value": "Wesley E."
}
```

**`account.connected`:**

```json
{
  "provider": "oura",
  "connection_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**`account.disconnected`:**

```json
{
  "provider": "oura",
  "connection_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**`account.deleted`:**

```json
{
  "data_points_deleted": 4720,
  "shares_revoked": 2,
  "connections_removed": 1
}
```

### 19.3 Example Full Request/Response Flows

#### Flow 1: Owner Queries Health Data

**Request:**

```
GET /api/health-data?metrics=sleep_score,hrv&start=2026-03-01&end=2026-03-07&resolution=daily
Cookie: __session=eyJ... (Clerk session JWT)
```

**Response (200):**

```json
{
  "data": {
    "metrics": {
      "sleep_score": {
        "unit": "score",
        "points": [
          { "date": "2026-03-01", "value": 85, "source": "oura" },
          { "date": "2026-03-02", "value": 78, "source": "oura" },
          { "date": "2026-03-03", "value": 91, "source": "oura" },
          { "date": "2026-03-04", "value": 82, "source": "oura" },
          { "date": "2026-03-05", "value": 88, "source": "oura" },
          { "date": "2026-03-06", "value": 75, "source": "oura" },
          { "date": "2026-03-07", "value": 90, "source": "oura" }
        ]
      },
      "hrv": {
        "unit": "ms",
        "points": [
          { "date": "2026-03-01", "value": 42.5, "source": "oura" },
          { "date": "2026-03-02", "value": 38.1, "source": "oura" },
          { "date": "2026-03-03", "value": 45.7, "source": "oura" },
          { "date": "2026-03-04", "value": 40.2, "source": "oura" },
          { "date": "2026-03-05", "value": 43.8, "source": "oura" },
          { "date": "2026-03-06", "value": 36.9, "source": "oura" },
          { "date": "2026-03-07", "value": 44.1, "source": "oura" }
        ]
      }
    },
    "query": {
      "start": "2026-03-01",
      "end": "2026-03-07",
      "resolution": "daily",
      "metrics_requested": ["sleep_score", "hrv"],
      "metrics_returned": ["sleep_score", "hrv"]
    }
  }
}
```

#### Flow 2: Create a Share Link

**Request:**

```
POST /api/shares
Cookie: __session=eyJ... (Clerk session JWT)
Content-Type: application/json

{
  "label": "For Dr. Patel - annual checkup",
  "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
  "data_start": "2025-06-01",
  "data_end": "2026-03-08",
  "expires_in_days": 30,
  "note": "Please review my sleep trends and cardiovascular data"
}
```

**Response (201):**

```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "token": "Kx7mN2pQ4rS8tU0vW3xY5zA9bC1dE6fG7hI8jK0lM2nO",
    "share_url": "https://totus.com/v/Kx7mN2pQ4rS8tU0vW3xY5zA9bC1dE6fG7hI8jK0lM2nO",
    "label": "For Dr. Patel - annual checkup",
    "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
    "data_start": "2025-06-01",
    "data_end": "2026-03-08",
    "grant_expires": "2026-04-07T14:23:01.000Z",
    "note": "Please review my sleep trends and cardiovascular data",
    "created_at": "2026-03-08T14:23:01.000Z"
  }
}
```

#### Flow 3: Viewer Validates Token and Fetches Data

**Step 1 — Validate:**

```
POST /api/viewer/validate
Content-Type: application/json

{
  "token": "Kx7mN2pQ4rS8tU0vW3xY5zA9bC1dE6fG7hI8jK0lM2nO"
}
```

**Response (200):**

```json
{
  "data": {
    "valid": true,
    "owner_display_name": "Wes E.",
    "label": "For Dr. Patel - annual checkup",
    "note": "Please review my sleep trends and cardiovascular data",
    "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
    "data_start": "2025-06-01",
    "data_end": "2026-03-08",
    "expires_at": "2026-04-07T14:23:01.000Z"
  }
}
```

Response also sets cookie: `totus_viewer=eyJ...; HttpOnly; Secure; SameSite=Lax; Max-Age=14400; Path=/`

**Step 2 — Fetch Data:**

```
GET /api/viewer/data?metrics=sleep_score,hrv&start=2025-06-01&end=2026-03-08&resolution=weekly
Cookie: totus_viewer=eyJ...
```

**Response (200):**

```json
{
  "data": {
    "metrics": {
      "sleep_score": {
        "unit": "score",
        "points": [
          { "date": "2025-06-02", "value": 83.4, "source": "oura" },
          { "date": "2025-06-09", "value": 79.1, "source": "oura" },
          "..."
        ]
      },
      "hrv": {
        "unit": "ms",
        "points": [
          { "date": "2025-06-02", "value": 41.2, "source": "oura" },
          { "date": "2025-06-09", "value": 39.8, "source": "oura" },
          "..."
        ]
      }
    },
    "query": {
      "start": "2025-06-01",
      "end": "2026-03-08",
      "resolution": "weekly",
      "metrics_requested": ["sleep_score", "hrv"],
      "metrics_returned": ["sleep_score", "hrv"]
    },
    "scope": {
      "grant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
      "data_start": "2025-06-01",
      "data_end": "2026-03-08"
    }
  }
}
```

#### Flow 4: Viewer Requests Metrics Outside Grant Scope

**Request:**

```
GET /api/viewer/data?metrics=sleep_score,glucose&start=2025-01-01&end=2026-03-08&resolution=daily
Cookie: totus_viewer=eyJ... (grant allows: sleep_score, hrv, rhr, weight; dates: 2025-06-01 to 2026-03-08)
```

**Response (200) — narrowed, not rejected:**

```json
{
  "data": {
    "metrics": {
      "sleep_score": {
        "unit": "score",
        "points": [
          { "date": "2025-06-01", "value": 82, "source": "oura" },
          "..."
        ]
      }
    },
    "query": {
      "start": "2025-06-01",
      "end": "2026-03-08",
      "resolution": "daily",
      "metrics_requested": ["sleep_score", "glucose"],
      "metrics_returned": ["sleep_score"]
    },
    "scope": {
      "grant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "allowed_metrics": ["sleep_score", "hrv", "rhr", "weight"],
      "data_start": "2025-06-01",
      "data_end": "2026-03-08"
    }
  }
}
```

Note: `glucose` was silently dropped (not in `allowed_metrics`). Date range was clamped from `2025-01-01` to `2025-06-01`. The API narrows rather than rejects, preventing information leakage.

#### Flow 5: Validation Error

**Request:**

```
GET /api/health-data?metrics=invalid_metric&start=2026-03-10&end=2026-03-01
Cookie: __session=eyJ...
```

**Response (400):**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "metrics",
        "message": "Invalid metric type: 'invalid_metric'. Must be one of: sleep_score, sleep_duration, ..."
      },
      {
        "field": "start",
        "message": "Start date cannot be in the future"
      },
      {
        "field": "end",
        "message": "End date must be on or after start date"
      }
    ]
  }
}
```

### 19.4 Cursor Pagination Encoding

The cursor is a base64url-encoded JSON object:

```json
{ "c": "2026-03-08T14:23:01.000Z", "i": "12345" }
```

Where `c` is the `created_at` ISO timestamp and `i` is the record `id` (string representation).

**Encoding:** `btoa(JSON.stringify({c, i}))` with base64url substitutions (`+` -> `-`, `/` -> `_`, remove `=` padding).

**Decoding:** Reverse the substitutions, add padding, `JSON.parse(atob(cursor))`.

**Why both timestamp and ID?** Timestamp alone is not unique (multiple records can have the same `created_at`). The ID breaks ties. This ensures stable, deterministic pagination even with concurrent inserts.

### 19.5 Oura API Field Mapping

Mapping from Oura API v2 response fields to Totus metric types:

| Totus Metric                 | Oura API Endpoint                    | Oura Response Field                                                                                |
| ---------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `sleep_score`                | `/v2/usercollection/daily_sleep`     | `score`                                                                                            |
| `sleep_duration`             | `/v2/usercollection/daily_sleep`     | `contributors.total_sleep` (seconds -> hours)                                                      |
| `sleep_efficiency`           | `/v2/usercollection/daily_sleep`     | `contributors.efficiency`                                                                          |
| `sleep_latency`              | `/v2/usercollection/sleep`           | `latency` (seconds -> minutes)                                                                     |
| `deep_sleep`                 | `/v2/usercollection/sleep`           | `deep_sleep_duration` (seconds -> hours)                                                           |
| `rem_sleep`                  | `/v2/usercollection/sleep`           | `rem_sleep_duration` (seconds -> hours)                                                            |
| `light_sleep`                | `/v2/usercollection/sleep`           | `light_sleep_duration` (seconds -> hours)                                                          |
| `awake_time`                 | `/v2/usercollection/sleep`           | `awake_time` (seconds -> minutes)                                                                  |
| `hrv`                        | `/v2/usercollection/daily_sleep`     | `contributors.hrv_balance` — OR — `/v2/usercollection/sleep` -> `average_hrv`                      |
| `rhr`                        | `/v2/usercollection/daily_sleep`     | `contributors.resting_heart_rate` — OR — `/v2/usercollection/heartrate` (lowest value for the day) |
| `respiratory_rate`           | `/v2/usercollection/sleep`           | `average_breath`                                                                                   |
| `body_temperature_deviation` | `/v2/usercollection/sleep`           | `temperature_deviation`                                                                            |
| `readiness_score`            | `/v2/usercollection/daily_readiness` | `score`                                                                                            |
| `activity_score`             | `/v2/usercollection/daily_activity`  | `score`                                                                                            |
| `steps`                      | `/v2/usercollection/daily_activity`  | `steps`                                                                                            |
| `active_calories`            | `/v2/usercollection/daily_activity`  | `active_calories`                                                                                  |
| `total_calories`             | `/v2/usercollection/daily_activity`  | `total_calories`                                                                                   |
| `spo2`                       | `/v2/usercollection/daily_spo2`      | `spo2_percentage.average`                                                                          |

**Unit Conversions (applied during import):**

- Sleep durations: Oura reports seconds. Totus stores hours (float, 2 decimal places).
- Sleep latency / awake time: Oura reports seconds. Totus stores minutes (integer).

### 19.6 Entity-Relationship Diagram

```
┌──────────────┐       1:1        ┌─────────────────────┐
│    users     │─────────────────>│  oura_connections    │
│              │                  │                     │
│  PK: id      │                  │  PK: id             │
│  (Clerk ID)  │                  │  FK: user_id        │
└──────┬───────┘                  └─────────────────────┘
       │
       │ 1:N
       │
       ├──────────────────────────────────────────┐
       │                                          │
       ▼                                          ▼
┌──────────────────┐                    ┌──────────────────┐
│   health_data    │                    │  share_grants    │
│                  │                    │                  │
│  PK: id          │                    │  PK: id          │
│  FK: user_id     │                    │  FK: owner_id    │
│  UQ: (user_id,   │                    │  UQ: token       │
│   metric_type,   │                    └────────┬─────────┘
│   date, source)  │                             │
└──────────────────┘                             │
                                                 │ referenced by
       ┌─────────────────────────────────────────┘
       │ (no FK — survives grant deletion)
       │
       ▼
┌──────────────────┐
│  audit_events    │
│                  │
│  PK: id          │
│  owner_id        │  (no FK — survives user deletion)
│  grant_id        │  (no FK — survives grant deletion)
│                  │
│  IMMUTABLE:      │
│  INSERT + SELECT │
│  only            │
└──────────────────┘

```

### 19.7 Database Size Estimates (12 Months at 500 Users)

| Table              | Row Size (avg)               | Rows/User/Month             | Rows at 12 Months | Total Size  |
| ------------------ | ---------------------------- | --------------------------- | ----------------- | ----------- |
| `users`            | 200 B                        | —                           | 500               | ~100 KB     |
| `oura_connections` | 500 B                        | —                           | 500               | ~250 KB     |
| `health_data`      | 300 B (incl. encrypted blob) | 600 (20 metrics \* 30 days) | 3,600,000         | ~1.0 GB     |
| `share_grants`     | 400 B                        | 2 (estimated)               | 12,000            | ~5 MB       |
| `audit_events`     | 500 B                        | 100 (estimated)             | 600,000           | ~300 MB     |
| **Total**          |                              |                             | ~4,212,500 rows   | **~1.3 GB** |

Aurora Serverless v2 minimum storage is 10 GB. The database will use ~13% of minimum storage after 12 months. Storage is not a concern at MVP scale.

**Index size estimate:** ~30% of table size = ~400 MB. Total database footprint: ~1.7 GB.

---

_End of document. This LLD, combined with the Architecture Design, provides a complete specification for implementing the Totus MVP API layer and database._
