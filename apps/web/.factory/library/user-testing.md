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
- **Auth**: Mock auth with `x-request-context` header or mock session cookie

### Browser Surface (agent-browser)

- **Dashboard URL**: `http://localhost:3100/dashboard`
- **Night View**: Dashboard page with night detail display
- **Recovery View**: Dashboard page with recovery arc display
- **Trend View**: Dashboard page with trend chart display
- **Auth**: Mock auth auto-login (NEXT_PUBLIC_USE_MOCK_AUTH=true)

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
