# Architecture — Dashboard Backend + Frontend

How the dashboard system works. Read this before implementing any feature.

---

## 1. System Overview

Totus is a personal health data platform. Users connect wearable providers (Oura, Cronometer, etc.), and Totus syncs, encrypts, and stores their health metrics. The **dashboard** is the primary way users (and their invited viewers, e.g. doctors) consume this data.

The dashboard adds a **derived-data layer** on top of the existing raw data pipeline. Raw encrypted health data flows in from provider syncs. The dashboard decrypts it on-demand, computes statistics (baselines, correlations, trends, anomalies, insights), and returns composed view responses — never persisting plaintext.

### Where the dashboard sits

```
Provider Syncs → Raw Encrypted Data (existing)
                        ↓
        Dashboard Computation Layer (new)
           ↓                    ↓
   Materialized Cache      On-Demand Compute
   (metric_baselines)      (correlations, trends,
                            anomalies, insights)
           ↓                    ↓
              View Endpoints (new)
              /api/views/{night,recovery,trend,weekly,anomaly}
                        ↓
                  Frontend Views
```

The dashboard does **not** replace or modify the existing data ingestion pipeline, auth system, or encryption infrastructure. It consumes them.

---

## 2. Data Flow

### End-to-end: from raw data to rendered chart

```
1. INGEST (existing)
   Provider API → sync job → encrypt with user DEK → store in health_data_daily/series/periods

2. MATERIALIZE (new, background)
   Inngest cron (every 6h) → read health_data_daily → decrypt → compute 30-day baselines
   → re-encrypt → upsert into metric_baselines cache

3. SERVE (new, on request)
   Browser → GET /api/views/night?date=2026-03-28
   → Auth (Clerk session or grant_token for viewers)
   → Fetch cached baselines (decrypt N blobs) + raw data (decrypt per-row)
   → Pure-function compute: summaries, rolling averages, trends, correlations, anomalies
   → Insight rule engine: evaluate rules, filter dismissed, cap at 3
   → Emit audit event (fire-and-forget)
   → Return single JSON response — all chart data in one request

4. RENDER (frontend)
   React component receives typed response → renders charts, summaries, insight cards
   → Zero client-side computation needed
```

### The decryption bottleneck

All health data is encrypted at rest with per-user envelope encryption (AES-256-GCM, keys managed by AWS KMS in prod). Every value read requires a decrypt call. The **baseline materialization strategy** exists specifically to reduce decrypt operations on the hot path — reading 5 cached baseline blobs instead of 150 raw daily rows (30 days × 5 metrics).

---

## 3. Key Architectural Decisions

| Decision                                        | What it means                                                                                                                                                                                               | Why                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hybrid materialization**                      | Baselines are pre-computed in a background job and cached encrypted. Everything else (correlations, trends, insights, anomalies) is computed on-demand in view endpoints.                                   | Baselines are needed on every view and expensive to compute. Other derivations are view-specific and must be fresh.                         |
| **All derived health data encrypted (D-2)**     | Baseline values, anomaly deviations, annotation labels/notes, LLM insight text — all stored as encrypted BYTEA. Only structural/categorical fields (dates, enums, scores used for filtering) are plaintext. | Founder directive: if it reveals health information, it's encrypted. Statistical derivatives (averages, z-scores) still reveal health info. |
| **Viewer scoping by metrics + date range**      | Viewers (e.g. doctors) can freely navigate between view types within their grant. The security boundary is `allowedMetrics ∩ requestedMetrics` and date clamping — not which view they're on.               | Doctors need to drill from a trend into a specific night. Locking by view type would cripple the UX.                                        |
| **One request, one view**                       | Each view endpoint returns everything needed to render its wireframe. No client-side joins or follow-up fetches.                                                                                            | Performance and simplicity. The frontend is a pure renderer.                                                                                |
| **Insights as an on-demand rule engine**        | Insight rules are pure functions evaluated at request time against already-computed data. Rules are defined in code, prioritized, capped at 3 per view.                                                     | Always fresh, always consistent with displayed data. No stale insight cache to invalidate.                                                  |
| **Template (P0) + LLM (P1) insight generation** | Simple threshold insights use string templates. Complex cross-metric insights use Claude Haiku to generate natural-language narratives, cached encrypted.                                                   | Templates can't express multi-metric relationships well. LLM narratives are contextual and conversational.                                  |

---

## 4. Component Relationships

### 4.1 Database Tables

**New tables** introduced by the dashboard:

| Table                | Purpose                                                             | Key relationships                                                                                           |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `metric_baselines`   | Encrypted 30-day rolling baseline cache (avg, stddev, upper, lower) | FK → `users`. Populated by background job from `health_data_daily`.                                         |
| `anomaly_events`     | Persisted anomaly detection results for historical pattern matching | FK → `users`. Score + deviations per date. Encrypted deviations, plaintext score for filtering.             |
| `user_annotations`   | Manual event markers (meals, workouts, travel, etc.)                | FK → `users`. Encrypted labels/notes. Merged with provider events from `health_data_periods` at query time. |
| `dismissed_insights` | Tracks which insight types a user dismissed for which dates         | FK → `users`. Composite PK on (user, type, date). No encryption needed — stores only the fact of dismissal. |
| `insight_cache`      | Encrypted LLM-generated narrative text (P1)                         | FK → `users`. Keyed by (user, type, date). `data_hash` invalidates stale entries.                           |

**Existing tables consumed** (not modified, except `share_grants`):

| Table                 | How the dashboard uses it                                                           |
| --------------------- | ----------------------------------------------------------------------------------- |
| `users`               | User identity, KMS key ARN for encryption                                           |
| `health_data_daily`   | Primary source of daily metric values (encrypted)                                   |
| `health_data_series`  | Intraday time-series data (HR, glucose) for night view                              |
| `health_data_periods` | Sleep stages, workouts — merged into annotation timeline                            |
| `share_grants`        | Extended with `view_type` and `view_params_encrypted` columns for dashboard sharing |
| `audit_events`        | All view accesses and mutations logged here                                         |

### 4.2 Computation Services

All live in `/src/lib/dashboard/`. They are **pure functions** — accept decrypted arrays, return derived results, no I/O.

```
baselines.ts         → fetchBaselines(), computeBaselinesOnDemand()
                       Used by: every view endpoint
                       Depends on: health_data_daily, metric_baselines cache, EncryptionProvider

summaries.ts         → computeSummaryMetrics()
                       Used by: night, recovery, anomaly views
                       Depends on: baselines + daily values

rolling-averages.ts  → computeRollingAverages()
                       Used by: trend view
                       Depends on: daily values array

correlations.ts      → computeCorrelations()
                       Used by: trend view
                       Depends on: two metric arrays (Pearson, in-memory)

trends.ts            → computeTrends()
                       Used by: trend view
                       Depends on: daily values array

weekly-patterns.ts   → computeWeeklyPatterns()
                       Used by: weekly view
                       Depends on: 28+ days of daily values

anomalies.ts         → computeAnomalyScore(), findHistoricalMatch()
                       Used by: anomaly view, anomaly cron
                       Depends on: baselines + daily values + historical anomaly_events

insights.ts          → generateInsights(), InsightRule[]
                       Used by: every view endpoint
                       Depends on: all computed data for the current view

annotations.ts       → fetchMergedAnnotations()
                       Used by: night, recovery views
                       Depends on: user_annotations + health_data_periods
```

### 4.3 View Endpoints

Five composed API endpoints, all following the same request flow:

```
Parse & validate (Zod) → Auth & permissions → Fetch & decrypt → Compute → Insights → Audit → Respond
```

| Endpoint                  | Primary data                                            | Key computations                                            |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `GET /api/views/night`    | Single night: intraday series, hypnogram, daily metrics | Summaries, baselines, annotations, insights                 |
| `GET /api/views/recovery` | 3–7 day range: daily scores                             | Summaries, baselines, sparklines, annotations, insights     |
| `GET /api/views/trend`    | 30+ day range: daily values                             | Rolling averages, trends, correlations, baselines, insights |
| `GET /api/views/weekly`   | 28+ day range: daily values                             | Day-of-week heatmap, sparklines, variance, insights         |
| `GET /api/views/anomaly`  | Single date + 7-day context                             | Anomaly score, deviations, historical match, insights       |

Supporting CRUD endpoints:

| Endpoint                                 | Purpose                |
| ---------------------------------------- | ---------------------- |
| `POST/GET/PATCH/DELETE /api/annotations` | Manual annotation CRUD |
| `GET /api/anomalies`                     | Anomaly event history  |
| `PATCH /api/anomalies/:date/label`       | Label a past anomaly   |
| `POST /api/insights/:type/:date/dismiss` | Dismiss an insight     |

### 4.4 Background Jobs (Inngest)

| Function                           | Trigger                      | What it does                                                                                                |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `dashboard/baselines.refresh`      | Cron every 6h (`:30`)        | For all users: decrypt 30 days of daily data → compute baselines → encrypt → upsert into `metric_baselines` |
| `dashboard/baselines.refresh.user` | Event (after sync completes) | Same as above, scoped to one user. Ensures baselines are fresh within minutes of new data arriving.         |
| `dashboard/anomalies.detect`       | Cron daily at 1 AM UTC       | For all users: compute anomaly scores for past 7 days → persist `anomaly_events` for historical matching    |

These integrate with the existing Inngest function registry at `/src/inngest/functions/index.ts` and are served via `/api/inngest/route.ts`.

### 4.5 Frontend Component Hierarchy

The dashboard UI is organized under `/src/components/dashboard/`. Existing components handle raw data display (charts, metric selectors, date pickers). New components layer dashboard-specific views on top:

```
Dashboard Shell
├── View Switcher (night | recovery | trend | weekly | anomaly)
├── Active View
│   ├── Night Detail View
│   │   ├── Intraday Chart panels (HR, glucose, etc.)
│   │   ├── Sleep Hypnogram
│   │   ├── Summary Strip (metric cards with deltas)
│   │   └── Annotation Markers (overlay on charts)
│   ├── Recovery View
│   │   ├── Daily Score Table (color-coded by status)
│   │   ├── Sparkline Grid
│   │   └── Triggering Event Card
│   ├── Trend View
│   │   ├── Metric Trend Charts (raw dots + smoothed line + baseline band)
│   │   ├── Correlation Cards
│   │   └── Trend Direction Badges
│   ├── Weekly Pattern View
│   │   ├── Day-of-Week Heatmap
│   │   ├── Sparkline Row (Sun–Sat per metric)
│   │   └── Variance Indicators
│   └── Anomaly View
│       ├── Anomaly Score Header
│       ├── Deviation Bar Chart (per-metric z-scores)
│       ├── 7-Day Context Sparklines
│       └── Historical Match Card (side-by-side comparison)
├── Insight Cards (max 3, dismissible, shared across views)
└── Annotation Panel (create/view manual annotations)
```

Existing components reused: `ChartGrid`, `MetricChart`, `IntradayChart`, `PeriodTimeline`, `DateRangeSelector`, `MetricSelector`, `ChartTooltip`.

---

## 5. Invariants

These must be preserved across all implementations. Violating any of these is a bug.

1. **All derived health data is encrypted at rest (D-2).** Baseline values, anomaly deviations, annotation labels/notes, LLM-generated insight text — all stored as encrypted BYTEA using the user's DEK. Plaintext exists only transiently in application memory during request processing.

2. **Baselines are anchored to the start of the view range (FR-1.4).** When rendering a trend from Feb 27–Mar 28, the baseline window is Jan 28–Feb 26 (30 days before Feb 27). Historical views must show historically-accurate baselines, not current-day baselines.

3. **Viewer access is scoped to granted metrics and date range.** `requestedMetrics ∩ allowedMetrics` and `max(requestStart, grantStart)..min(requestEnd, grantEnd)`. View type is a routing hint, not a security boundary. The `enforcePermissions()` function handles this.

4. **Audit events for all mutations and view accesses.** Every view endpoint emits `view.accessed`. Every annotation CRUD, anomaly label, and insight dismissal emits its own audit event type. Fire-and-forget — never blocks the response.

5. **Maximum 3 insights per view, priority-ordered.** Rules are evaluated in priority order (lower number = higher priority). Once 3 insights fire, evaluation stops. Dismissed insights are skipped. This prevents overwhelming the user.

6. **Plaintext is never persisted.** Decrypted health data exists only in memory during request processing. View endpoints decrypt → compute → respond → discard. No logs, no temp files, no cache of plaintext values.

7. **Baseline cache tolerance is ±2 days.** If the cached baseline's `reference_date` is within 2 days of the requested date, it's used (93%+ overlap of the 30-day window). Outside that, on-demand computation fires.

8. **Anomaly threshold is 3+ simultaneous deviations.** A metric is anomalous when `|z_score| > 2` (outside ±2 standard deviations). An anomaly alert fires when 3+ metrics are simultaneously anomalous.

9. **Minimum data requirements.** Baselines need ≥7 days of data per metric. Weekly patterns need ≥28 days. Anomaly detection needs ≥14 days. Below these thresholds, the feature returns `insufficient_data` rather than misleading results.

---

## 6. Priority Phasing

| Phase                | What ships                                                                                                                                                                                                                                   | Depends on                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **P0 — MVP**         | `metric_baselines` table + cron, `user_annotations` + CRUD, `dismissed_insights` table, Night + Recovery + Trend view endpoints, Summary metrics, Rolling averages, P0 insight rules (threshold-based), Zod response contracts, DB migration | Existing data pipeline, encryption infrastructure |
| **P1 — Launch**      | Correlations, Trend detection, P1 insight rules (cross-metric, LLM-generated), Share grant extensions (`view_type`, `view_params`), Weekly Pattern view endpoint, `insight_cache` table                                                      | P0 baselines and view endpoint patterns           |
| **P2 — Post-launch** | `anomaly_events` table + daily cron, Historical pattern matching (cosine similarity), Anomaly view endpoint, Anomaly label + history API                                                                                                     | P0 + P1 computation services                      |
