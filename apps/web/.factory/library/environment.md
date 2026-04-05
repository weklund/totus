# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

All configured in `.env.local`:

| Variable                    | Purpose                                               | Required  |
| --------------------------- | ----------------------------------------------------- | --------- |
| `DATABASE_URL`              | PostgreSQL connection string                          | Yes       |
| `ENCRYPTION_KEY`            | 64-char hex for local dev AES-256 envelope encryption | Yes       |
| `NEXT_PUBLIC_USE_MOCK_AUTH` | Set to `"true"` for mock auth (no Clerk)              | Yes (dev) |
| `MOCK_AUTH_SECRET`          | Secret for mock JWT signing                           | Yes (dev) |
| `VIEWER_JWT_SECRET`         | Secret for viewer session JWT signing                 | Yes       |
| `NEXT_PUBLIC_APP_URL`       | App URL for share links                               | Yes       |

## External Dependencies

- **PostgreSQL 15** — Running in Docker container `totus-db`
- **Inngest** — Background job orchestration. Dev server runs locally on port 8288
- **AWS KMS** — Production only. Local dev uses `LocalEncryptionProvider` with `ENCRYPTION_KEY`

## Key Dependency Versions

- `zod` v4.3.6 — Note: v4 API (not v3). Some syntax differences.
- `drizzle-orm` v0.45.1 — Use `pgTable()` with third parameter for constraints/indexes
- `inngest` v3 — Use `inngest.createFunction()` with step functions
- `next` v15.3.6 — App Router with route handlers

## Notes

- Mock auth seeds a test user with ID `user_test_001` in dev mode
- The `bytea` custom type is defined in `src/db/schema/custom-types.ts` — use it for encrypted BYTEA columns
- Encryption wire format: `[version byte][DEK length][encrypted DEK][nonce][ciphertext][auth tag]`
