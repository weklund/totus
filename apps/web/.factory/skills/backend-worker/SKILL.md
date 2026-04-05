---
name: backend-worker
description: Implements database schemas, computation services, API endpoints, and Inngest background jobs for the dashboard backend
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:

- Drizzle database schema definitions and migrations
- Pure computation service functions (baselines, summaries, rolling averages, insights)
- Next.js API route handlers (view endpoints, CRUD endpoints)
- Inngest background job functions
- TypeScript type definitions and configuration files
- Backend unit and integration tests

## Required Skills

None.

## Work Procedure

1. **Read context**: Read `AGENTS.md`, `.factory/library/architecture.md`, and the feature description. Read the LLD sections referenced in the feature (at `/docs/dashboard-backend-lld.md`). Understand the exact spec before writing any code.

2. **Read existing patterns**: Before writing new code, read at least one existing file that follows the same pattern:
   - For DB schemas: read `src/db/schema/health-data-daily.ts` and `src/db/schema/share-grants.ts`
   - For API routes: read `src/app/api/health-data/route.ts` or `src/app/api/shares/route.ts`
   - For Inngest functions: read `src/inngest/functions/sync-connection.ts`
   - For computation services: read `src/lib/api/source-resolution.ts` for service function patterns
   - For tests: read an existing test file in `__tests__/` alongside the file you're implementing

3. **Write tests first (TDD)**:
   - For computation services: write unit tests in `src/lib/dashboard/__tests__/{service}.test.ts`. Tests should cover happy path, edge cases (empty data, zero stddev, insufficient data), and boundary conditions.
   - For API endpoints: write integration tests in `src/app/api/{resource}/__tests__/route.test.ts`. Tests construct `Request` objects with `x-request-context` headers containing mock auth.
   - Run tests and verify they FAIL before implementing.

4. **Implement the feature**:
   - Follow the LLD spec exactly for interfaces, algorithms, and data structures
   - Match existing code patterns (error envelope, audit events, encryption)
   - Export new schemas from `src/db/schema/index.ts`
   - Register new Inngest functions in `src/app/api/inngest/route.ts`
   - Add event types to `src/inngest/client.ts`

5. **Run tests and verify they PASS**:
   - `npm run test -- --reporter=verbose` (or specific test file)
   - Fix any failures before proceeding

6. **Run validators**:
   - `npm run typecheck` — must pass with zero errors
   - `npm run lint` — must pass

7. **Manual verification** (for API endpoints):
   - Start the dev server if needed
   - Use curl to hit the endpoint with realistic test data
   - Verify response shape matches the LLD spec
   - Record the curl command and response in handoff

## Example Handoff

```json
{
  "salientSummary": "Implemented computeSummaryMetrics() with polarity-aware direction and z-score status classification. Wrote 12 unit tests covering happy path, zero-stddev edge case, and all 3 polarity types. All tests pass, typecheck clean.",
  "whatWasImplemented": "src/lib/dashboard/summaries.ts — computeSummaryMetrics() function that takes metric values and baselines, returns SummaryMetric objects with value, avg_30d, delta, delta_pct, direction (polarity-aware), and status (z-score based). Handles zero-stddev by clamping z-score. Handles negative averages by using absolute value for delta_pct.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm run test -- src/lib/dashboard/__tests__/summaries.test.ts --reporter=verbose",
        "exitCode": 0,
        "observation": "12 tests passed: happy path, zero-stddev, negative values, all polarity types, missing baselines"
      },
      {
        "command": "npm run typecheck",
        "exitCode": 0,
        "observation": "No errors"
      },
      { "command": "npm run lint", "exitCode": 0, "observation": "No warnings" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "src/lib/dashboard/__tests__/summaries.test.ts",
        "cases": [
          {
            "name": "computes delta and delta_pct for HRV (higher_is_better)",
            "verifies": "polarity-aware direction"
          },
          {
            "name": "computes delta and delta_pct for RHR (lower_is_better)",
            "verifies": "inverted polarity"
          },
          {
            "name": "handles zero stddev without division error",
            "verifies": "edge case safety"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a database table or computation service that doesn't exist yet
- The LLD spec is ambiguous or contradicts existing code patterns
- Encryption service behavior is unexpected (e.g., different wire format)
- Existing tests break due to schema changes (beyond the known 9 pre-existing failures)
- Cannot match existing patterns (e.g., new Zod v4 syntax needed but unclear)
