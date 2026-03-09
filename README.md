# Totus

A personal health data vault for quantified-self users. Totus aggregates data from wearable devices (starting with Oura Ring), stores it with envelope encryption, and presents it through an interactive dashboard with time-series charts, share links, and audit logging.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Turbopack)
- **Language:** TypeScript 5.8 (strict mode)
- **UI:** React 19, Tailwind CSS v4, shadcn/ui (Radix primitives), Recharts
- **Database:** PostgreSQL 15, Drizzle ORM
- **Auth:** Mock Clerk layer (JWT-based via `jose`), viewer token system
- **Encryption:** AES-256-GCM envelope encryption (local dev fallback, AWS KMS-ready)
- **Package Manager:** Bun
- **Testing:** Vitest, Testing Library
- **Code Quality:** ESLint 9 (flat config), Prettier, Husky + lint-staged

## Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Bun](https://bun.sh/) v1.2+
- [Docker](https://www.docker.com/) (for PostgreSQL)

## Getting Started

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd totus
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Start PostgreSQL**

   ```bash
   docker compose up -d
   ```

4. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and generate an encryption key:

   ```bash
   openssl rand -hex 32
   ```

   Paste the output as the `ENCRYPTION_KEY` value. The remaining defaults work for local development.

5. **Push the database schema**

   ```bash
   bun run db:push
   ```

6. **Seed the database** (90 days of synthetic health data)

   ```bash
   bun run db:seed
   ```

7. **Start the development server**

   ```bash
   bun run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

| Command               | Description                                  |
| --------------------- | -------------------------------------------- |
| `bun run dev`         | Start dev server with Turbopack on port 3000 |
| `bun run build`       | Production build                             |
| `bun run start`       | Start production server                      |
| `bun run lint`        | Run ESLint                                   |
| `bun run typecheck`   | Run TypeScript type checking                 |
| `bun run test`        | Run Vitest test suite                        |
| `bun run test:watch`  | Run Vitest in watch mode                     |
| `bun run format`      | Format code with Prettier                    |
| `bun run db:generate` | Generate Drizzle migrations                  |
| `bun run db:push`     | Push schema changes to the database          |
| `bun run db:seed`     | Seed database with synthetic data            |
| `bun run db:studio`   | Open Drizzle Studio database browser         |

## Project Structure

```
src/
  app/                  # Next.js App Router pages and API routes
    (auth)/             # Authentication pages (sign-in, sign-up)
    api/                # REST API route handlers
      audit/            #   Audit log endpoint
      auth/             #   Auth endpoints (sign-in, sign-up, sign-out, session)
      connections/      #   Oura connection management
      health/           #   Health check
      health-data/      #   Health data query and types
      shares/           #   Share link CRUD and revocation
      user/             #   Profile, export, account deletion
      viewer/           #   Viewer token validation and data access
    dashboard/          # Dashboard pages (overview, audit, settings, share)
    v/                  # Public viewer pages
  components/           # React components
    audit/              #   Audit log table
    dashboard/          #   Dashboard charts and widgets
    landing/            #   Landing page
    layout/             #   App shell, sidebar, header
    settings/           #   Settings forms
    share/              #   Share management UI
    ui/                 #   shadcn/ui primitives
    viewer/             #   Read-only viewer components
  config/               # Metric type registry and app config
  db/                   # Drizzle schema, connection pool, seed script
    schema/             #   Table definitions and relations
  hooks/                # React Query hooks for API data fetching
  lib/                  # Shared utilities
    api/                #   Service layer (health, share, audit, user, connections)
    auth/               #   Mock Clerk auth, middleware, permissions
    encryption/         #   Envelope encryption provider
  types/                # TypeScript type definitions
  middleware.ts         # Route protection and auth middleware
```

## Key Features

- **Interactive Dashboard** -- Time-series line charts for heart rate, HRV, sleep score, readiness, steps, and SpO2. Date range filtering with responsive layout and dark mode support.
- **Oura Ring Integration** -- OAuth2 connection flow with data sync for all supported health metrics (mock API in development).
- **Encrypted Health Data** -- AES-256-GCM envelope encryption at rest. Per-user data encryption keys with a provider interface ready for AWS KMS.
- **Share Links** -- Generate time-limited, read-only share URLs with configurable expiration and metric scoping. Viewers access data without creating an account.
- **Audit Logging** -- Immutable append-only audit log tracking all data access, share creation, and account actions. Database trigger prevents mutation.
- **Viewer Pages** -- Public read-only dashboard for share link recipients with token-based authentication.
- **User Settings** -- Profile management, data export (JSON), and account deletion with confirmation.

## Architecture Overview

- **Next.js App Router** -- Server components and route handlers. API routes follow RESTful conventions with a standard error envelope.
- **Mock Clerk Auth** -- Toggled via `NEXT_PUBLIC_USE_MOCK_AUTH=true`. Provides `auth()`, `useAuth()`, and middleware matching Clerk's API surface. Swappable for real Clerk in production.
- **Envelope Encryption** -- Health data is encrypted with per-user data encryption keys (DEKs) wrapped by a key encryption key (KEK). Local dev uses a static key; production uses AWS KMS.
- **Cursor Pagination** -- All list endpoints use cursor-based pagination for consistent performance with growing datasets.
- **Viewer Token System** -- Share tokens are SHA-256 hashed for storage. Validation issues a short-lived JWT cookie via `jose`. Dual-secret support enables seamless key rotation.
- **React Query** -- Client-side data fetching with TanStack React Query. Custom hooks abstract API calls and cache management.

## Environment Variables

Copy `.env.example` to `.env.local` for local development. All variables are documented in the example file.

| Variable                     | Description                                      |
| ---------------------------- | ------------------------------------------------ |
| `DATABASE_URL`               | PostgreSQL connection string                     |
| `NEXT_PUBLIC_USE_MOCK_AUTH`  | Enable mock Clerk auth (`true` for dev)          |
| `MOCK_AUTH_SECRET`           | HMAC secret for mock auth JWTs                   |
| `VIEWER_JWT_SECRET`          | HMAC secret for viewer session JWTs              |
| `VIEWER_JWT_SECRET_PREVIOUS` | Previous viewer JWT secret (for rotation)        |
| `ENCRYPTION_KEY`             | 32-byte hex AES-256-GCM key                      |
| `NEXT_PUBLIC_APP_URL`        | Public-facing application URL                    |
| `OURA_CLIENT_ID`             | Oura OAuth2 client ID (placeholder for mock)     |
| `OURA_CLIENT_SECRET`         | Oura OAuth2 client secret (placeholder for mock) |
| `SENTRY_DSN`                 | Sentry DSN for error tracking (optional)         |

## Testing

Run the full test suite:

```bash
bun run test
```

Type checking:

```bash
bun run typecheck
```

Linting:

```bash
bun run lint
```

## License

Private. All rights reserved.
