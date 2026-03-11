# Bun Workspaces Research

## Root Config

```json
{
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun --filter '*' dev",
    "test": "bun --filter '*' test"
  }
}
```

## Moving Next.js to apps/web/

1. mkdir -p apps/web
2. Move: src/, next.config.ts, next-env.d.ts, postcss.config.mjs, components.json, drizzle/, drizzle.config.ts, vitest.config.ts, eslint.config.mjs
3. Create apps/web/package.json with Next.js deps
4. Create apps/web/tsconfig.json
5. Update root package.json (remove app deps, add workspaces)
6. Delete bun.lock, run bun install from root
7. .env.local goes in apps/web/

## Cross-workspace scripts

```bash
bun --filter '*' build           # all workspaces
bun --filter '@totus/web' dev    # specific workspace
bun --filter './apps/*' test     # by path
```

## Key Gotchas

1. Single bun.lock at root
2. workspace:\* protocol for local references
3. Path aliases need adjustment after move (baseUrl relative to tsconfig)
4. .env.local must be in apps/web/ (Next.js looks relative to cwd)
5. Husky/prepare script stays at root
6. Don't use drizzle-kit push with partitioned tables
7. Commander.js latest is v14.0.3 (not v13)
