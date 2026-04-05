# User Testing

Testing surface discovery, required tools, and resource cost classification.

---

## Validation Surface

### API Surface (curl)

- **Night View**: `GET http://localhost:3100/api/views/night?date=...`
- **Recovery View**: `GET http://localhost:3100/api/views/recovery?start=...&end=...`
- **Trend View**: `GET http://localhost:3100/api/views/trend?start=...&end=...&metrics=...`
- **Annotations CRUD**: `POST/GET/PATCH/DELETE http://localhost:3100/api/annotations`
- **Insight Dismissal**: `POST http://localhost:3100/api/insights/:type/:date/dismiss`
- **Auth**: Use mock `__session` cookie JWTs (middleware strips client-supplied `x-request-context`)

### Browser Surface (agent-browser)

- **Dashboard URL**: `http://localhost:3100/dashboard`
- **Night View**: Dashboard page with night detail display
- **Recovery View**: Dashboard page with recovery arc display
- **Trend View**: Dashboard page with trend chart display
- **Auth**: Mock auth may still open on `/sign-in` in fresh validator sessions; set `__session` cookie for `user_test_001` when needed
- **Observed routing constraint (2026-04-05)**: `/dashboard/night`, `/dashboard/recovery`, and `/dashboard/trend` returned not-found on local surface during `frontend-shared` validation; only `/dashboard` was reachable.

### Background Jobs (Inngest)

- **Inngest Dev Server**: `http://localhost:8288`
- **Baseline Refresh**: Triggered via cron or event

## Validation Concurrency

**Machine specs:** 128 GB RAM, 18 CPU cores, ~34 GB free memory

### agent-browser surface

- Each agent-browser instance: ~300 MB RAM
- Dev server: ~200 MB RAM (already running)
- Max concurrent validators: **5** (5 × 300 MB = 1.5 GB, well within budget)

### curl surface

- Minimal resource usage
- Max concurrent validators: **5**

## Testing Prerequisites

- PostgreSQL running (`docker start totus-db`)
- Next.js dev server on port 3100
- Test data seeded (use `npm run db:seed` or create test fixtures)
- Mock auth enabled (`NEXT_PUBLIC_USE_MOCK_AUTH=true`)

## Pre-Existing Issues (Do Not Fix)

- 9/980 unit tests fail due to missing DB partitions/triggers/extensions (btree_gist, audit immutability trigger). These are pre-existing schema issues unrelated to the dashboard mission.

### vitest surface

- Foundation validation assertions (`VAL-DB-*`, `VAL-COMP-*`) are validated through targeted Vitest suites.
- Tests touching shared local PostgreSQL state can interfere when run concurrently across separate processes.
- Max concurrent validators: **2** (only when assertions are split across non-overlapping test files); otherwise run serially.

## Flow Validator Guidance: vitest

- Use targeted Vitest commands only (avoid full-suite mission-irrelevant runs).
- Prefer `npm --prefix "/Users/weae1504/Projects/totus/apps/web" run test -- ...` to invoke Vitest reliably in this workspace.
- Stay within local test resources: existing postgres (`totus-db`) and local repo working tree.
- Do not modify application code, migrations, or production logic during validation.
- If a test fails, capture exact failing assertion/test names and stderr in the flow report.
- Treat only assertion-scoped outcomes as mission results; unrelated known baseline failures should be recorded as friction, not as assertion failures.

## Flow Validator Guidance: curl

- Use only local app surface `http://localhost:3100` and local PostgreSQL for evidence gathering.
- For Inngest/job assertions (for example `VAL-CROSS-006`), run Inngest with app sync enabled: `npx inngest-cli dev -u http://localhost:3100/api/inngest --port 8288` (using `--no-discovery` can leave `/dev` with zero registered functions and block job-execution evidence).
- Owner auth should use a generated `__session` cookie for `user_test_001`, e.g.:
  - `TOKEN=$(cd "/Users/weae1504/Projects/totus/apps/web" && npx dotenv -e .env.local -- tsx -e "import { createSessionToken } from './src/lib/auth/mock-auth'; (async()=>{const t=await createSessionToken('user_test_001'); process.stdout.write(t);})();")`
  - Then call curl with `--cookie "__session=$TOKEN"`.
- Direct `grant_token` query usage on `/api/views/night|recovery|trend` currently returns `401` on real surface due owner-only middleware gating; when diagnosing viewer scope behavior, use `/api/viewer/validate` to mint `totus_viewer` cookie first.
- For expired-share assertions requiring immediate expiry (`VAL-CROSS-012`), create a dedicated local test share then backdate that share's `grant_expires` in local DB to make the expiry path reproducible in-session.
- Keep assertion data isolated by using unique annotation labels/notes and assertion-specific date windows to avoid cross-flow collisions.
- Do not modify application source or seed scripts; validation should only exercise existing HTTP endpoints.
- Capture full request + status code + response body snippets for each assertion verdict in the flow report.

## Flow Validator Guidance: agent-browser

- Use only the dashboard surface at `http://localhost:3100/dashboard` unless an assertion explicitly requires a different local route.
- Start the session with mission-specific session IDs only; never use a shared/default browser session.
- If redirected to `/sign-in`, generate a local mock-auth token for `user_test_001` and set it as `__session` cookie before running assertions.
- Keep tests isolated to one assigned assertion group/date window and avoid mutating global settings unrelated to the assigned assertions.
- When an assertion requires state mutation (for example dismissing an insight), capture before/after evidence in the same run and do not assume prior state from other flows.
- If agent-browser request capture is empty, collect equivalent request/response evidence with `curl` and reference the artifact files in the flow report.
- For trend chart navigation assertions, prefer clicking a specific active data point; broad chart clicks can be intercepted by annotation overlays and may not trigger navigation.
- Save screenshots and any interaction logs under the assigned evidence directory and reference exact file names in the flow report.
- Do not modify application code or seed scripts; only validate behavior through real browser interactions.
