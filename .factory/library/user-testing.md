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

## Flow Validator Guidance: terminal

### Isolation Rules
- Subagents testing terminal commands (bun test, typecheck, lint, etc.) do NOT modify source files.
- Each subagent writes its report to its assigned flow file only.
- Do NOT run `git commit` or modify git state. For Husky hook testing, use `git commit --allow-empty` and restore state afterward.
- All commands should be run from the repo root `/Users/weseklund/Projects/totus` unless specified otherwise.

### Boundaries
- Do NOT start or stop services — they are managed by the parent validator.
- Do NOT install or uninstall packages.
- Do NOT modify any source files or configuration.
- Only verify/read existing state and run verification commands.

### Environment
- PostgreSQL running on localhost:5432 (container: totus-db)
- Web dev server running on localhost:3000
- Repo root: /Users/weseklund/Projects/totus
- Mission dir: /Users/weseklund/.factory/missions/9ed53e1e-48b2-4ff6-bace-42b42f3993c7

## Known Quirks

- Clipboard API unavailable in headless Chromium (copy button shows error toast)
- Skeletons hard to capture visually (local dev loads fast)
