# User Testing

Testing surface: tools, URLs, setup steps, isolation notes, known quirks.

**What belongs here:** How to manually test the application, what surfaces are testable, tool-specific notes.

---

## Testing Surface

### API Endpoints (curl)

- Base URL: `http://localhost:3000/api`
- Auth: Include mock session cookie for owner endpoints
- All endpoints return JSON with standard error envelope

### Web Pages (agent-browser)

- Landing: `http://localhost:3000/`
- Sign-in: `http://localhost:3000/sign-in`
- Sign-up: `http://localhost:3000/sign-up`
- Dashboard: `http://localhost:3000/dashboard`
- Share management: `http://localhost:3000/dashboard/share`
- Share wizard: `http://localhost:3000/dashboard/share/new`
- Audit log: `http://localhost:3000/dashboard/audit`
- Settings: `http://localhost:3000/dashboard/settings`
- Viewer: `http://localhost:3000/v/[token]`

## Setup Steps

1. Ensure PostgreSQL is running: `docker compose up -d`
2. Apply schema: `bun run db:push`
3. Seed data: `bun run db:seed`
4. Start dev server: `bun dev`
5. For authenticated testing, use mock auth sign-in at `/sign-in`

## Test Accounts (Seeded)

Will be populated after seed script is created:

- Owner: test@totus.dev / password (with 90 days of health data)

## Known Quirks

- Mock auth does not enforce real password complexity
- Local encryption uses a fixed key (not per-user KMS)
- Oura OAuth redirects to mock callback (no real Oura interaction)
