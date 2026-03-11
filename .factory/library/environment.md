# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Environment Variables (.env.local in apps/web/)

- `DATABASE_URL` — PostgreSQL connection string (see docker-compose.yml for dev credentials)
- `NEXT_PUBLIC_USE_MOCK_AUTH=true`
- `MOCK_AUTH_SECRET=changeme`
- `VIEWER_JWT_SECRET=changeme`
- `VIEWER_JWT_SECRET_PREVIOUS=changeme`
- `ENCRYPTION_KEY=<32-byte hex>` (generate with `openssl rand -hex 32`)
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- `OURA_CLIENT_ID=your-oura-client-id`
- `OURA_CLIENT_SECRET=your-oura-client-secret`

## Known Quirks

- Bun re-adds `packageManager` field to package.json on install. Remove before committing.
- PostgreSQL accessed via docker exec (no host psql). See AGENTS.md for connection details.
- Drizzle-kit push/pull may get confused by partitioned tables. Use migrate only for partition DDL.
