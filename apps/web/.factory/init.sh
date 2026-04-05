#!/bin/bash
set -e

cd /Users/weae1504/Projects/totus/apps/web

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  cd /Users/weae1504/Projects/totus && npm install
  cd /Users/weae1504/Projects/totus/apps/web
fi

# Ensure PostgreSQL is running
if ! docker exec totus-db pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
  echo "Starting PostgreSQL..."
  docker start totus-db
  sleep 3
fi

# Verify .env.local exists
if [ ! -f ".env.local" ]; then
  echo "ERROR: .env.local not found. Copy from .env.example and configure."
  exit 1
fi

echo "Environment ready."
