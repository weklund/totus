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

### Known CLI Issues (discovered during testing)

**Fixed in commit 6ab327e (round 2 verified):**
- ~~`metrics list` crashes with "metricTypes.map is not a function"~~ — Fixed: CLI now unwraps `response.data.types ?? response.data`
- ~~`profile` returns 404 "User not found" with API key auth~~ — Fixed: profile route uses `getResolvedContext()`
- ~~`shares create` sends wrong field names~~ — Fixed: now sends `allowed_metrics`, `data_start`, `data_end`
- ~~`export` sends GET instead of POST~~ — Fixed: now sends POST

**All issues resolved (round 3):**
- ~~`GET /api/health-data/types` still uses `getRequestContext()`~~ — Fixed in commit 8f16c26
- ~~`GET /api/connections` still uses `getRequestContext()`~~ — Fixed in commit 8f16c26
- ~~`GET /api/metric-preferences` still uses `getRequestContext()`~~ — Fixed in commit 8f16c26
- ~~`POST /api/user/export` returns 500~~ — Fixed by re-seeding data with current ENCRYPTION_KEY
- ~~ENCRYPTION_KEY mismatch~~ — Fixed by re-seeding mock_test_totus_dev data
- ~~CLI connections sync uses provider name instead of UUID~~ — Fixed: uses conn.id now
- ~~CLI preferences list doesn't unwrap nested response~~ — Fixed: unwraps response.data.preferences
- Non-TTY output (piped) defaults to JSON format (by design)

## Flow Validator Guidance: MCP

### Testing Surface
- MCP server launched via: `bun run packages/cli/src/index.ts mcp-server`
- Protocol: JSON-RPC 2.0 over stdio (newline-delimited JSON, NOT content-length framing)
- Auth via `TOTUS_API_KEY` env var and `TOTUS_SERVER_URL` env var
- Server URL: `http://localhost:3000/api`

### Protocol Details
- Each message is a JSON object followed by `\n`
- Must send `initialize` request first, then `notifications/initialized` notification
- After initialization, send `tools/call`, `tools/list`, `resources/read`, `resources/list`, `prompts/get`, `prompts/list`

### Message Format Examples
```
# Initialize
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}

# Initialized notification (no id)
{"jsonrpc":"2.0","method":"notifications/initialized"}

# List tools
{"jsonrpc":"2.0","id":2,"method":"tools/list"}

# Call a tool
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_health_data","arguments":{"metrics":["sleep_score"],"start_date":"2026-01-01","end_date":"2026-01-31"}}}

# List resources
{"jsonrpc":"2.0","id":4,"method":"resources/list"}

# Read a resource
{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"totus://metrics"}}

# List prompts
{"jsonrpc":"2.0","id":6,"method":"prompts/list"}

# Get a prompt
{"jsonrpc":"2.0","id":7,"method":"prompts/get","params":{"name":"analyze_sleep","arguments":{"period":"last_7_days"}}}
```

### Test Accounts & API Keys for MCP Testing

| Account | User ID | API Key | Scopes | Data |
|---------|---------|---------|--------|------|
| Seed user (full) | mock_test_totus_dev | tot_live_Oxcn5bC8_tRl6NOd4rNEVB19W8pXppzS9M55B6nPC | All scopes | 720 daily, 4080 series, 133 periods, 1 Oura connection, 4 shares |
| Read-only user | mock_ut_cli_3_test_com | tot_live_FZfWe95f_sLncxoNzrw1CBIStV68vJZOm0YWteLDi | health:read, connections:read, audit:read, keys:read | No health data |

### How to Spawn an MCP Server Process (TypeScript/Bun)
```typescript
import { spawn } from 'child_process';

const proc = spawn('bun', ['run', 'packages/cli/src/index.ts', 'mcp-server'], {
  env: {
    ...process.env,
    TOTUS_API_KEY: '<key>',
    TOTUS_SERVER_URL: 'http://localhost:3000/api',
  },
  cwd: '/Users/weseklund/Projects/totus',
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Read responses from stdout (newline-delimited JSON)
proc.stdout.on('data', (data) => { /* parse JSON lines */ });

// Send messages by writing JSON + newline to stdin
proc.stdin.write(JSON.stringify(message) + '\n');
```

### How to Test MCP via Shell Script
```bash
# Create a temp script that sends messages
cat > /tmp/mcp_test_input.txt << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF

# Run and capture output (use timeout to prevent hanging)
cd /Users/weseklund/Projects/totus
timeout 15 bash -c 'TOTUS_API_KEY="<key>" TOTUS_SERVER_URL="http://localhost:3000/api" bun run packages/cli/src/index.ts mcp-server < /tmp/mcp_test_input.txt' 2>/dev/null
```

**CRITICAL:** MCP server blocks on stdin. Use `timeout` or close stdin to prevent hanging.
**CRITICAL:** Each subagent spawns its OWN MCP server process. Do NOT share processes.

### Isolation Rules
- Each subagent uses its OWN assigned API key and MCP server process.
- Do NOT modify config files, source files, or database data directly.
- Write reports ONLY to the assigned flow file.
- Do NOT start or stop the web server or database — they are managed by the parent.

### Known Quirks

## Known Quirks

- Clipboard API unavailable in headless Chromium (copy button shows error toast)
- Skeletons hard to capture visually (local dev loads fast)
- Next.js App Router requires all sibling dynamic segments to use the same slug name — connections routes use [provider] for both OAuth (provider name) and CRUD (connection UUID)
- Inngest dev server must be running for sync event dispatch to work (otherwise event is sent but not processed)
