# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Environment Variables

See `.env.example` for the full list. Key variables:

- `DATABASE_URL` — PostgreSQL connection string (see .env.example for local dev value)
- `NEXT_PUBLIC_USE_MOCK_AUTH=true` — Enables mock Clerk auth layer
- `MOCK_AUTH_SECRET` — HMAC secret for mock auth JWTs (dev only)
- `VIEWER_JWT_SECRET` — HMAC secret for viewer session JWTs
- `VIEWER_JWT_SECRET_PREVIOUS` — Previous secret for rotation
- `ENCRYPTION_KEY` — Local dev encryption key (32 bytes, hex-encoded)
- `NEXT_PUBLIC_APP_URL` — Application base URL (local: `http://localhost:3000`)

## Platform Notes

- macOS 14.x (Sonoma), Apple Silicon
- Node.js v23.11.0, Bun 1.2.14
- Docker via OrbStack
- 11 CPU cores, ~18GB RAM
