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

- `bytea` is a native type in recent Drizzle versions
- `inet` is a native type in recent Drizzle versions
- TEXT arrays: use `text('col').array()` with `default(sql\`'{}'::text[]\`)`
- Use `pg` driver (returns Buffer for BYTEA)
