# @totus/web

Next.js 15 web application for the Totus health data platform.

## Dashboard

The dashboard visualizes health metrics from wearable integrations across three views:

| View                  | Route                                            | Description                                                                                            |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Night Detail** (W1) | `/dashboard/night?date=YYYY-MM-DD`               | Intraday series (HR, glucose, SpO2), sleep hypnogram, summary metrics, insights, annotations           |
| **Recovery** (W2)     | `/dashboard/recovery?start=...&end=...`          | Multi-day sparklines, daily score table with traffic-light colors, recovery arc, annotation markers    |
| **Trend** (W3)        | `/dashboard/trend?start=...&end=...&metrics=...` | Rolling averages with resolution toggle (Daily/7d/30d), range presets, trend direction, baseline bands |

### Architecture

```
Frontend (React + TanStack Query)
  NightDetailView / RecoveryDetailView / TrendDetailView
  useNightView / useRecoveryView / useTrendView hooks
        │
API Endpoints (Next.js Route Handlers)
  GET /api/views/night | /api/views/recovery | /api/views/trend
  POST/GET /api/annotations
  POST /api/insights/:type/:date/dismiss
        │
Computation Services (src/lib/dashboard/)
  baselines.ts   → 30-day rolling avg/stddev (cache-first, 2-day tolerance)
  summaries.ts   → Polarity-aware delta + z-score status classification
  rolling-averages.ts → 7d/30d moving averages with gap handling
  insights.ts    → P0 rule engine (max 3 per view, priority-ordered)
  annotations.ts → Merge user + provider event timelines
        │
Database (PostgreSQL + Drizzle ORM, envelope encryption)
  metric_baselines | user_annotations | dismissed_insights
```

### Background Jobs (Inngest)

- `dashboard/baselines.refresh` — Cron every 6h, batch-refreshes baselines for all users
- `dashboard/baselines.refresh.user` — Event-triggered per-user refresh after sync

### Key Design Decisions

- **Encrypted at rest**: All health values and annotation text encrypted with per-user DEKs
- **Z-score status**: Metric status (critical/warning/normal/good) from z-scores against 30-day baseline
- **Polarity-aware direction**: Each metric has configured polarity; "better"/"worse" respects whether higher or lower is desirable
- **Baseline suppression**: When sample_count < 14, deltas suppressed to avoid misleading comparisons
- **Priority-based insights**: Rules evaluated in priority order; dismissed types skipped, lower-priority rules backfill

### Running

```bash
# Dev server
npm run dev

# Seed dashboard test data (S1 late meal + S3 workout recovery scenarios)
npm run db:seed && npm run db:seed-dashboard

# Tests
npm run test                                    # All tests
npx vitest run src/lib/dashboard/__tests__/     # Computation services
npx vitest run src/app/api/views/__tests__/     # API endpoints
npx vitest run src/components/dashboard/__tests__/ # Components
```

### API Endpoints

| Endpoint                            | Method   | Key Params                                                                             |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `/api/views/night`                  | GET      | `date`, `metrics?`, `grant_token?`                                                     |
| `/api/views/recovery`               | GET      | `start`, `end`, `metrics?`, `event_id?`, `grant_token?`                                |
| `/api/views/trend`                  | GET      | `start`, `end`, `metrics`, `smoothing?` (none/7d/30d), `correlations?`, `grant_token?` |
| `/api/annotations`                  | GET/POST | GET: `start?`, `end?`, `grant_token?`; POST: `event_type`, `label`, `occurred_at`      |
| `/api/insights/:type/:date/dismiss` | POST     | Idempotent dismissal                                                                   |

All endpoints support viewer access via `grant_token` with metric and date scoping.
