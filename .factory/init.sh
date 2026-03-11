#!/bin/bash
set -e

# Install dependencies from root (Bun workspaces)
cd "$(git rev-parse --show-toplevel)"
bun install

# Ensure PostgreSQL is running
docker compose up -d
sleep 2

# Push schema (from apps/web after monorepo conversion, or root before)
if [ -d "apps/web" ]; then
  cd apps/web
  bun run db:push 2>/dev/null || echo "db:push skipped (may need schema changes first)"
  cd ../..
else
  bun run db:push 2>/dev/null || echo "db:push skipped"
fi

echo "Init complete"
