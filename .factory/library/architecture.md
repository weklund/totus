# Architecture

Architectural decisions, patterns discovered, and implementation notes.

**What belongs here:** Design patterns, module boundaries, data flow patterns, gotchas, and decisions made during implementation.

---

## Key Patterns

### Mock Auth Layer

Auth is implemented as a switchable adapter. When `NEXT_PUBLIC_USE_MOCK_AUTH=true`:

- `src/lib/auth/mock-auth.ts` provides `auth()`, `useAuth()`, and middleware functions
- Uses jose JWTs signed with `MOCK_AUTH_SECRET`
- Session stored in `__session` cookie (same name as Clerk)
- Mock sign-in/sign-up create real database user records

### Envelope Encryption

Health data values are encrypted using envelope encryption:

- `EncryptionProvider` interface in `src/lib/encryption/`
- `LocalEncryptionProvider` for dev (uses `ENCRYPTION_KEY` env var)
- Wire format: `[0x01][4-byte DEK length][encrypted DEK][12-byte nonce][ciphertext][16-byte auth tag]`

### Unified Middleware

`middleware.ts` checks:

1. Owner session (`__session` cookie) -> mock auth or Clerk
2. Viewer session (`totus_viewer` cookie) -> jose JWT verification
   Produces `RequestContext` stored in request headers for downstream use.

### API Error Envelope

All errors follow: `{ error: { code: string, message: string, details?: array } }`
Standard codes: VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, etc.

## Drizzle ORM Notes

- `bytea` is NOT natively available in drizzle-orm 0.45.1 — use `customType` from `drizzle-orm/pg-core` (see `src/db/schema/custom-types.ts`)
- `inet` IS a native type in drizzle-orm 0.45.1
- TEXT arrays: use `text('col').array()` — the Drizzle type maps to `TEXT[]` in PostgreSQL
- Use `pg` driver (returns Buffer for BYTEA)
- PostgreSQL partial indexes cannot use STABLE functions like `now()` — only IMMUTABLE functions allowed in index predicates. The `idx_share_grants_active_token` uses `WHERE revoked_at IS NULL` (without `grant_expires > now()`)
- CHECK constraints: `array_length(col, 1)` returns NULL for empty arrays, not 0. Use `IS NOT NULL AND > 0` to reject empty arrays
- drizzle-kit doesn't manage CHECK constraint updates automatically — manual ALTER TABLE needed when changing CHECK constraint definitions
- drizzle-kit commands need `dotenv-cli` to load `.env.local` (Next.js auto-loads it but drizzle-kit doesn't). Scripts use `dotenv -e .env.local -- drizzle-kit <command>`

## Database Schema Notes

- pgcrypto extension is enabled via Docker init script (`docker/init/01-extensions.sql`) and also via `.factory/init.sh`
- All 5 tables: `users`, `oura_connections`, `health_data`, `share_grants`, `audit_events`
- Schema files in `src/db/schema/` — one file per table plus `custom-types.ts` and `index.ts`
- FK cascades: deleting a user cascades to `oura_connections`, `health_data`, and `share_grants`
- `audit_events.owner_id` is NOT a foreign key — audit events persist after user deletion

## Audit Event Pattern

Audit events are inserted using a **fire-and-forget** pattern in all API routes:

```ts
db.insert(auditEvents)
  .values({
    ownerId: userId,
    actorType: "owner",
    actorId: userId,
    eventType: "share.created",
    resourceType: "share_grant",
    resourceId: grant.id,
    ipAddress: request.headers.get("x-forwarded-for") || "unknown",
  })
  .catch((err) => console.error("Failed to create audit event:", err));
```

**Important exception:** `DELETE /api/user/account` must **await** the audit event insertion _before_ deleting the user, since the cascade would make it impossible to emit the event after deletion.

## Rate Limiter Configuration

Pre-configured rate limiter instances in `src/lib/api/rate-limit.ts`:

| Limiter     | Import name             | Limit   | Window | Use for                                      |
| ----------- | ----------------------- | ------- | ------ | -------------------------------------------- |
| General     | `generalRateLimiter`    | 100 req | 1 min  | Standard API endpoints                       |
| Validation  | `validationRateLimiter` | 10 req  | 1 min  | Token validation (POST /api/viewer/validate) |
| Health Data | `healthDataRateLimiter` | 30 req  | 1 min  | Data query endpoints                         |

Usage pattern:

```ts
import {
  generalRateLimiter,
  createRateLimitResponse,
  addRateLimitHeaders,
} from "@/lib/api/rate-limit";

const rateLimitResult = generalRateLimiter.check(ctx.userId || ip);
if (!rateLimitResult.allowed) {
  return createRateLimitResponse(rateLimitResult);
}
// ... handler logic ...
return addRateLimitHeaders(response, rateLimitResult);
```

Note: In-memory rate limiting resets on server restart. Redis adapter needed for production.

## Testing Patterns

### Vitest .env.local Loading

Vitest does not automatically load `.env.local` files. To make env vars like `DATABASE_URL` available in tests, `vitest.config.ts` uses `loadEnv` from the `vite` package:

```ts
import { loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return { /* ... */ test: { env } };
});
```

The empty string prefix (`""`) loads ALL env vars, not just `VITE_`-prefixed ones.

### Dynamic Import for Database Modules

`src/db/index.ts` validates `DATABASE_URL` at module load time and throws if missing. Tests that import database modules must use dynamic `await import('@/db')` inside `beforeAll` to ensure env vars are loaded first:

```ts
beforeAll(async () => {
  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;
});
```
