---
name: scaffold-worker
description: Initializes project structure, tooling, and infrastructure configuration
---

# Scaffold Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:

- Project initialization (create-next-app, package.json config)
- Tooling setup (ESLint, Prettier, Vitest, Playwright, Husky)
- Docker Compose and database infrastructure
- Directory structure creation
- Configuration files (tsconfig, tailwind, drizzle, env)

## Work Procedure

1. **Read the feature description carefully.** Understand exactly what tooling, configs, and structure are required.

2. **Check existing state.** Before creating files, check what already exists. Don't overwrite working configurations.

3. **Write tests first for any testable logic.** For scaffold features, this might be:
   - A simple test that imports from each configured path alias
   - A test that verifies env var loading
   - A test that the database connection utility works
     Write the test, verify it fails (red), then implement.

4. **Implement the scaffolding.** Create files, install packages, configure tools. Follow the design documents in `/docs/` for exact specifications.

5. **Verify all tooling commands work:**
   - `bun run typecheck` — must exit 0
   - `bun run lint` — must exit 0
   - `bun run test` — must exit 0
   - `bun dev` — must start without errors (start, verify, stop)
   - If Docker: `docker compose up -d` — containers must start

6. **Verify directory structure** matches what was specified in the feature description.

7. **Record every command and its output** in the handoff.

## Example Handoff

```json
{
  "salientSummary": "Scaffolded Next.js 15 project with Bun, TypeScript strict, Tailwind v4, ESLint v9 flat config, Prettier, Vitest, and Husky. All tooling commands pass: typecheck (0 errors), lint (0 warnings), test (3 passing). Dev server starts on port 3000.",
  "whatWasImplemented": "Created Next.js 15 App Router project with TypeScript strict mode. Configured Tailwind CSS v4, ESLint v9 flat config with Next.js + TypeScript rules, Prettier with Tailwind plugin. Set up Vitest with jsdom environment and path aliases. Configured Husky pre-commit hook running lint + typecheck + test. Created directory structure: src/app/, src/lib/, src/db/, src/types/, src/config/, src/components/. Created .env.example with all documented env vars.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run typecheck",
        "exitCode": 0,
        "observation": "No TypeScript errors"
      },
      {
        "command": "bun run lint",
        "exitCode": 0,
        "observation": "No ESLint errors or warnings"
      },
      {
        "command": "bun run test",
        "exitCode": 0,
        "observation": "3 tests passing"
      },
      {
        "command": "bun dev (started, checked http://localhost:3000, stopped)",
        "exitCode": 0,
        "observation": "Dev server started on port 3000, page rendered"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened http://localhost:3000 in curl",
        "observed": "Got 200 HTML response with Next.js page"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/lib/__tests__/env.test.ts",
        "cases": [
          {
            "name": "loads environment variables",
            "verifies": "env loading works"
          }
        ]
      },
      {
        "file": "src/lib/__tests__/path-alias.test.ts",
        "cases": [
          { "name": "imports via @ alias", "verifies": "path alias resolution" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Package installation fails repeatedly (network or version conflict)
- A required tool version is incompatible with the environment
- Docker daemon is not running or containers fail to start
- Port conflicts that cannot be resolved
