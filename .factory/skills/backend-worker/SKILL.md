---
name: backend-worker
description: Implements database schemas, API routes, auth, services, and middleware
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:

- Drizzle ORM schema definitions and migrations
- API route handlers (Next.js App Router)
- Service layer functions (HealthDataService, ShareService, etc.)
- Auth middleware and permission enforcement
- Encryption, token generation, and security utilities
- Zod validation schemas
- Database seeding and utilities

## Work Procedure

1. **Read the feature description and design docs.** The primary reference for backend work is `/docs/api-database-lld.md`. Cross-reference with `/docs/architecture-design.md` for auth and permission patterns. Read the feature's `expectedBehavior` and `verificationSteps` carefully.

2. **Read existing code.** Before implementing, understand what already exists:
   - Check `src/db/schema/` for existing table definitions
   - Check `src/lib/` for existing utilities (auth, encryption, etc.)
   - Check `src/app/api/` for existing route handlers
   - Check `.factory/library/` for architecture notes from previous workers

3. **Write tests FIRST (red).** Before implementing anything:
   - Create test file(s) for the feature
   - Write tests covering: happy path, error cases, edge cases, permission enforcement
   - For API routes: test the route handler function directly (import and call with Request object)
   - For services: test with mocked dependencies
   - For schemas: test Zod validation with valid and invalid inputs
   - Run `bun run test` — tests should FAIL (red phase)

4. **Implement to make tests pass (green).** Write the minimum code to make all tests pass:
   - Follow existing patterns in the codebase
   - Use Drizzle ORM for all database operations
   - Use Zod for all input validation
   - Use the auth module for authentication checks
   - Use the encryption service for health data
   - Emit audit events for data access operations

5. **Run all verification commands:**
   - `bun run test` — all tests pass
   - `bun run typecheck` — zero errors
   - `bun run lint` — zero warnings
   - For database changes: verify schema in the running PostgreSQL

6. **Manual verification.** For API routes:
   - Start `bun dev`
   - Use curl to test the endpoint(s) with real HTTP requests
   - Verify correct response status, body, headers
   - Test auth enforcement (request without session -> 401)
   - Stop the dev server after testing

7. **Update shared knowledge.** If you discover patterns, gotchas, or environment details that future workers should know, add them to `.factory/library/architecture.md` or `.factory/library/environment.md`.

## Example Handoff

```json
{
  "salientSummary": "Implemented POST /api/shares and GET /api/shares with cursor pagination. Wrote 12 test cases covering creation, validation errors, auth enforcement, pagination, and status filtering. All tests pass, typecheck clean, and manual curl verification confirmed correct 201/200/400/401 responses.",
  "whatWasImplemented": "Created ShareService with createGrant(), listGrants(), getGrant() methods. Implemented POST /api/shares route handler with Zod validation (createShareSchema), token generation (32 bytes, crypto.randomBytes), SHA-256 hashing, audit event emission. Implemented GET /api/shares with cursor pagination, status filter (active/expired/revoked), and 50-per-page limit. Added share_grants Zod schemas in src/lib/validators/shares.ts.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run test -- --grep shares",
        "exitCode": 0,
        "observation": "12 tests passing"
      },
      {
        "command": "bun run typecheck",
        "exitCode": 0,
        "observation": "No errors"
      },
      { "command": "bun run lint", "exitCode": 0, "observation": "No warnings" }
    ],
    "interactiveChecks": [
      {
        "action": "curl -X POST http://localhost:3000/api/shares -H 'Content-Type: application/json' -d '{...}' with valid session cookie",
        "observed": "201 with { data: { id, token, ... } }"
      },
      {
        "action": "curl http://localhost:3000/api/shares with valid session cookie",
        "observed": "200 with { data: [...], pagination: { next_cursor, has_more } }"
      },
      {
        "action": "curl -X POST http://localhost:3000/api/shares without session",
        "observed": "401 { error: { code: 'UNAUTHORIZED' } }"
      },
      {
        "action": "curl -X POST http://localhost:3000/api/shares with empty metrics array",
        "observed": "400 { error: { code: 'VALIDATION_ERROR', details: [...] } }"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/app/api/shares/__tests__/route.test.ts",
        "cases": [
          {
            "name": "POST creates share grant and returns token",
            "verifies": "happy path creation"
          },
          {
            "name": "POST returns 400 for empty metrics array",
            "verifies": "input validation"
          },
          {
            "name": "POST returns 401 without session",
            "verifies": "auth enforcement"
          },
          {
            "name": "GET returns paginated shares",
            "verifies": "list with pagination"
          },
          { "name": "GET filters by status", "verifies": "status filter" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on an API endpoint or database table that doesn't exist yet
- Requirements in the feature description conflict with the LLD specification
- Database migration fails and cannot be resolved
- Encryption service or auth module is missing or broken
- External service mock is needed but doesn't exist
