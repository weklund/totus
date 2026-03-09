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

---

## Flow Validator Guidance: CLI/Terminal

**Surface:** Terminal commands executed via the shell (bun, docker, etc.)

**Testing tool:** Direct shell commands via Execute tool. No agent-browser or tuistory needed.

**Isolation rules:**

- Scaffold assertions are read-only checks — they inspect project structure, run commands, and verify output
- No shared mutable state between subagents
- Do NOT modify any source files — only run read-only commands and inspect output
- Do NOT start or stop services — they are already running (PostgreSQL on 5432, dev server on 3000)

**Pre-started services:**

- PostgreSQL: Running on port 5432 via Docker Compose (container: totus-db, user: totus, password: totus, db: totus)
- Next.js dev server: Running on port 3000

**Project root:** `/Users/weseklund/Projects/totus`

**How to verify assertions:**

- Run CLI commands and check exit codes and output
- Use LS/Read/Grep tools to inspect file contents and directory structure
- Use curl to verify the dev server responds
- Use `docker compose exec -T db pg_isready -U totus` to verify DB connectivity

## Flow Validator Guidance: Database/Terminal

**Surface:** Database schema, constraints, triggers, encryption, seed data — all validated via terminal commands.

**Testing tool:** Direct shell commands via Execute tool, plus Read/Grep for source inspection. No agent-browser or tuistory needed.

**Isolation rules:**

- Database assertions are mostly read-only queries — they inspect table schemas, run constraint tests, and verify behavior
- Groups that write data (constraint tests, upsert tests) use their own isolated test data and clean up after themselves
- Do NOT modify any source files — only run read-only commands, SQL queries, and inspect output
- Do NOT start or stop services — PostgreSQL is already running on port 5432
- Do NOT re-run db:push or db:seed — schema and seed data are already applied

**Pre-started services:**

- PostgreSQL: Running on port 5432 via Docker Compose (container: totus-db, user: totus, password: totus, db: totus)
- Schema: Already pushed via `bun run db:push`
- Seed data: Already populated via `bun run db:seed` (1 user, 720 health data rows, 1 share grant, 5 audit events)

**How to query the database:**

```bash
cd /Users/weseklund/Projects/totus && docker compose exec -T db psql -U totus -d totus -c "YOUR SQL HERE"
```

**How to run Vitest tests:**

```bash
cd /Users/weseklund/Projects/totus && bun run test -- --reporter=verbose path/to/test/file
```

**Project root:** `/Users/weseklund/Projects/totus`

**Seed user details:**

- User ID: `user_test_001`
- 8 metric types with 90 data points each = 720 total health data rows
- 1 share grant with token hash stored
- 5 audit events

**Encryption details:**

- Uses AES-256-GCM with local key from ENCRYPTION_KEY env var
- Wire format: [1 byte version 0x01][4 bytes DEK length][N bytes encrypted DEK][12 bytes nonce][M bytes ciphertext][16 bytes auth tag]
- Source: `src/lib/encryption/index.ts`
- Tests: `src/lib/encryption/__tests__/encryption.test.ts`

**Metric registry:**

- Source: `src/config/metrics.ts`
- Tests: `src/config/__tests__/metrics.test.ts`

---

## Validated Findings

### Pre-commit Hook Testing (VAL-SCAF-009) — Round 3

- The pre-commit hook at `.husky/pre-commit` runs `bun run typecheck` (tsc --noEmit) first, then `bunx lint-staged`
- lint-staged config in package.json runs `eslint --fix` and `prettier --write` on _.ts/_.tsx files
- To test: create a file with a type error, stage it, attempt a commit — the hook catches the error and blocks the commit
- Husky v9 is installed with `prepare: "husky"` in package.json scripts
- Fixed in commit 86a5889 which added typecheck to pre-commit hook before lint-staged
