#!/bin/bash
set -e

cd /Users/weseklund/Projects/totus

# Install dependencies (idempotent — bun install is fast if node_modules is current)
if [ -f "package.json" ]; then
  bun install
fi

# Start PostgreSQL if not already running
if ! docker compose exec -T db pg_isready -U totus 2>/dev/null; then
  echo "Starting PostgreSQL via Docker Compose..."
  docker compose up -d
  # Wait for PostgreSQL to be ready
  echo "Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    if docker compose exec -T db pg_isready -U totus 2>/dev/null; then
      echo "PostgreSQL is ready."
      break
    fi
    sleep 1
  done
fi

# Copy .env.example to .env.local if not exists
if [ -f ".env.example" ] && [ ! -f ".env.local" ]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example"
fi

# Apply database schema if drizzle is configured
if [ -f "drizzle.config.ts" ] && [ -f "package.json" ]; then
  echo "Applying database schema..."
  bun run db:push 2>/dev/null || echo "db:push not yet available (expected during scaffold)"
fi

echo "Init complete."
