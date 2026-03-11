# User Testing

Testing surface: tools, URLs, setup steps, isolation notes, known quirks.

---

## Tools Available

- **agent-browser**: Browser automation for web UI testing (installed at ~/.factory/bin/agent-browser)
- **curl**: API endpoint testing
- **CLI**: packages/cli commands run via `bun run packages/cli/src/index.ts [command]`
- **MCP**: JSON-RPC via stdin/stdout to MCP server process

## Web UI Testing Surface

- Landing: http://localhost:3000/
- Sign-in: http://localhost:3000/sign-in
- Dashboard: http://localhost:3000/dashboard (requires auth)
- Shares: http://localhost:3000/dashboard/share
- Audit: http://localhost:3000/dashboard/audit
- Settings: http://localhost:3000/dashboard/settings
- Viewer: http://localhost:3000/v/{token}

## API Testing Surface

- Health check: GET http://localhost:3000/api/health
- All API routes under http://localhost:3000/api/\*
- Auth: sign in via POST /api/auth/sign-in, use \_\_session cookie

## Database Access

- `docker exec totus-db psql -U totus -d totus -c "SQL"`

## Test Accounts

- Sign up new accounts via POST /api/auth/sign-up or web UI
- Seed data user created by `bun run db:seed` from apps/web

## Known Quirks

- Clipboard API unavailable in headless Chromium (copy button shows error toast)
- Skeletons hard to capture visually (local dev loads fast)
