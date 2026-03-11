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

## Flow Validator Guidance: API

### Isolation Rules
- Each subagent uses its own test user credentials for API requests.
- Use mock auth via `x-request-context` header to simulate authentication (same pattern as unit tests).
- Subagents testing API endpoints via curl do NOT modify shared data — they create their own test data.
- Each subagent writes its report to its assigned flow file only.

### Authentication for curl
- Sign in via POST /api/auth/sign-in to get __session cookie
- Or use the x-request-context header with JSON payload for mock auth (dev mode)
- Mock auth format: `{"role":"owner","userId":"<user-id>"}` - set via middleware in dev mode

### Boundaries
- Do NOT start or stop services — they are managed by the parent validator.
- Do NOT install or uninstall packages.
- Do NOT modify source files.
- Database queries for verification are OK via `docker exec totus-db psql -U totus -d totus -c "SQL"`

### Environment
- PostgreSQL running on localhost:5432 (container: totus-db)
- Web dev server running on localhost:3000
- Repo root: /Users/weseklund/Projects/totus
- Mission dir: /Users/weseklund/.factory/missions/9ed53e1e-48b2-4ff6-bace-42b42f3993c7

## Flow Validator Guidance: database

### Isolation Rules
- Read-only database queries only via `docker exec totus-db psql -U totus -d totus -c "SQL"`
- Do NOT modify database state — only verify existing schema, data, and structure.
- Each subagent writes its report to its assigned flow file only.

### Boundaries
- Do NOT start or stop services — they are managed by the parent validator.
- Do NOT install or uninstall packages.
- Do NOT modify source files or database data.

### Environment
- PostgreSQL running on localhost:5432 (container: totus-db)
- Web dev server running on localhost:3000
- Repo root: /Users/weseklund/Projects/totus
- Mission dir: /Users/weseklund/.factory/missions/9ed53e1e-48b2-4ff6-bace-42b42f3993c7

## Flow Validator Guidance: browser

### Isolation Rules
- Each subagent uses its own browser session (unique --session ID).
- Each subagent uses its own test account (assigned by the parent validator).
- Do NOT modify other users' data or navigate to other users' dashboards.
- Each subagent writes its report to its assigned flow file only.

### Authentication for Browser Testing
- Navigate to http://localhost:3000/sign-in
- Enter assigned email and any password (mock auth accepts any password)
- The sign-in will redirect to /dashboard
- For already-signed-in users, navigate directly to the target page

### Boundaries
- Do NOT start or stop services — they are managed by the parent validator.
- Do NOT install or uninstall packages.
- Do NOT modify source files.
- Only interact with the web UI via agent-browser.

### Environment
- PostgreSQL running on localhost:5432 (container: totus-db)
- Web dev server running on localhost:3000
- Repo root: /Users/weseklund/Projects/totus
- Mission dir: /Users/weseklund/.factory/missions/9ed53e1e-48b2-4ff6-bace-42b42f3993c7

### Test Data
- Seed user (user_test_001) has 720 daily data rows, 4080 series rows, 133 period events, 1 Oura connection
- Test accounts created via sign-up: use ut-mpui-conn@test.com, ut-mpui-charts@test.com, ut-mpui-prefs@test.com
- Any password works for sign-in with mock auth
- Provider connections already set up for each test account

### Browser Testing Tips
- Use agent-browser --session "sessionId" for each subagent
- Take screenshots as evidence for visual assertions
- Wait for page loads and async data fetching before asserting
- Close sessions when done: agent-browser --session "sessionId" close

## API Key Testing Accounts (api-keys milestone)

| Account | Email | User ID | Purpose |
|---------|-------|---------|---------|
| CRUD tester | ut-keys-crud@test.com | mock_ut_keys_crud_test_com | API key creation, listing, revocation, auth, CSRF exemption, audit |
| Security tester | ut-keys-sec@test.com | mock_ut_keys_sec_test_com | Scope enforcement, expired keys, scope escalation, key limits |
| Rate limit tester | ut-keys-rate@test.com | mock_ut_keys_rate_test_com | API key rate limiting |
| UI tester | ut-keys-ui@test.com | mock_ut_keys_ui_test_com | Browser UI for API key management |

### Getting a session cookie (for curl-based subagents)
```bash
COOKIE=$(curl -s -D- -X POST http://localhost:3000/api/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"TestPassword123!"}' 2>/dev/null | grep -i "set-cookie" | sed 's/.*__session=\([^;]*\).*/\1/')
```

### Creating an API key (for testing key-based auth)
```bash
RESULT=$(curl -s -X POST http://localhost:3000/api/keys \
  -H "Cookie: __session=$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"name":"<name>","scopes":["health:read","keys:read","keys:write"],"expires_in_days":30}')
KEY=$(echo $RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['key'])")
```

### API Key format
- Pattern: `tot_live_{8chars}_{32chars}`
- Auth via: `Authorization: Bearer <key>`

## Flow Validator Guidance: CLI

### Testing Surface
- CLI commands run via `bun run packages/cli/src/index.ts [command]` from repo root
- Commands require `--server-url http://localhost:3000/api` or config `server_url` set
- API key auth via `TOTUS_API_KEY` env var, `--api-key` flag, or config file
- Config file at `~/.config/totus/config.json`

### Test Accounts & API Keys for CLI Testing

| Account | User ID | API Key | Scopes |
|---------|---------|---------|--------|
| Full-scope user 1 | mock_test_totus_dev | tot_live_Oxcn5bC8_tRl6NOd4rNEVB19W8pXppzS9M55B6nPC | All scopes |
| Full-scope user 2 (CLI test 1) | mock_ut_cli_1_test_com | tot_live_Nbt1Dqpq_0iqSM7cr1CqJuEINQdnG82BKFUBPxUO4 | All scopes |
| Full-scope user 3 (CLI test 2) | mock_ut_cli_2_test_com | tot_live_zGhn5fxd_TDur1tQnj3dYx8oztBTZfGaD0nKxCnmT | All scopes |
| Read-only user (CLI test 3) | mock_ut_cli_3_test_com | tot_live_FZfWe95f_sLncxoNzrw1CBIStV68vJZOm0YWteLDi | health:read, connections:read, audit:read, keys:read |

### Data Available
- `mock_test_totus_dev` has 720 daily data points, 1 Oura connection, 4 shares, audit events
- `mock_ut_cli_1_test_com`, `mock_ut_cli_2_test_com`, `mock_ut_cli_3_test_com` have no health data (newly created)

### Isolation Rules
- Each subagent uses its OWN assigned API key and user account.
- Do NOT modify another subagent's config, data, or API keys.
- If testing `totus auth login`, back up and restore `~/.config/totus/config.json` afterward.
- All subagents write reports to their assigned flow file only.

### Running Commands
```bash
# With env var
TOTUS_API_KEY=<key> bun run packages/cli/src/index.ts <command> --server-url http://localhost:3000/api

# With flag
bun run packages/cli/src/index.ts <command> --api-key <key> --server-url http://localhost:3000/api

# TTY detection: pipe through cat to simulate non-TTY
TOTUS_API_KEY=<key> bun run packages/cli/src/index.ts <command> --server-url http://localhost:3000/api | cat
```

### Known CLI Issues (discovered during setup)
- `metrics list` crashes with "metricTypes.map is not a function" - API returns `{data: {types: []}}` but CLI expects `{data: []}` (array directly)
- `profile` command returns 404 "User not found" with API key auth because profile route uses `getRequestContext()` instead of `getResolvedContext()` — user ID is `__api_key_pending__`
- `connections list` returns empty for API-key-authenticated requests (same root cause: route uses `getRequestContext()` not `getResolvedContext()`)
- `metrics get` query param mismatch: CLI sends `start`/`end` but API health-data endpoint expects `start`/`end` (this actually works)
- By default, non-TTY output (piped) outputs JSON format

## Known Quirks

- Clipboard API unavailable in headless Chromium (copy button shows error toast)
- Skeletons hard to capture visually (local dev loads fast)
- Next.js App Router requires all sibling dynamic segments to use the same slug name — connections routes use [provider] for both OAuth (provider name) and CRUD (connection UUID)
- Inngest dev server must be running for sync event dispatch to work (otherwise event is sent but not processed)
