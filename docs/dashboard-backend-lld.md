# Totus Dashboard Backend LLD

### Version 1.0 — April 2026

### Author: Architecture Team

### Status: Draft — Awaiting Founder Review

---

## 1. Overview

**Purpose.** This document specifies the backend changes required to support the
dashboard wireframes (W1–W5). It covers new database tables, API endpoints,
background jobs, computation strategies, and the encryption approach for all
derived health data. An engineer or AI coding agent should be able to build the
dashboard backend by following this document line by line.

**Audience.** The founder (Wes Eklund), implementation agents, and any future
backend engineers.

**Prerequisite Reading.**

- Totus API & Database LLD (v1.0) — `/docs/api-database-lld.md`
- Totus Architecture Design (v1.0) — `/docs/architecture-design.md`
- Totus Integrations Pipeline LLD — `/docs/integrations-pipeline-lld.md`
- Dashboard Requirements — `/docs/design/dashboard-requirements.md`
- Dashboard Wireframes — `/docs/design/wireframes.md`
- Dashboard User Scenarios — `/docs/design/user-scenarios.md`

**Scope.** New backend capabilities for dashboard views only. This document does
NOT cover frontend component implementation, PDF export rendering, or landing
page changes. It DOES cover new database tables, new API endpoints, new
background jobs, new computation services, and all encryption decisions.

**Relationship to Existing LLD.** This document extends `/docs/api-database-lld.md`.
All conventions from that document (error envelope, rate limits, pagination, Zod
validation, audit emission, encryption patterns) carry forward unchanged. New
endpoints follow the same patterns. Where this document modifies an existing
table (e.g., adding columns to `share_grants`), the change is backwards
compatible.

### System Architecture Overview

How the new dashboard backend components fit into the existing Totus architecture:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                         │
│                                                                              │
│   Owner Dashboard                              Viewer (Share Link)           │
│   ┌──────────────────────┐                     ┌──────────────────────┐     │
│   │  Night │ Recovery │   │                     │  Same views, scoped  │     │
│   │  Trend │ Weekly   │   │                     │  to granted metrics  │     │
│   │  Anomaly           │   │                     │  + date range        │     │
│   └──────────┬─────────┘                     └──────────┬─────────┘     │
└──────────────┼───────────────────────────────────────────┼───────────────┘
               │ HTTPS                                     │ HTTPS
               ▼                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         NEW: View Endpoints                                  │
│                                                                              │
│   /api/views/night  ─┐                                                       │
│   /api/views/recovery│                                                       │
│   /api/views/trend   ├── All compose from shared building blocks (§5)        │
│   /api/views/weekly  │   All enforce viewer permissions                      │
│   /api/views/anomaly ┘   All return everything in one request                │
│                                                                              │
│   /api/annotations (CRUD)    /api/anomalies (history + label)                │
│   /api/insights (dismiss)                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                    NEW: Computation Services (§5)                             │
│                                                                              │
│   ┌────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────────┐       │
│   │ Baselines  │ │ Correlations │ │   Trends   │ │ Rolling Averages │       │
│   └────────────┘ └──────────────┘ └────────────┘ └──────────────────┘       │
│   ┌────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────────┐       │
│   │ Anomalies  │ │   Weekly     │ │ Summaries  │ │    Insights      │       │
│   │            │ │  Patterns    │ │            │ │  (Rule Engine)   │       │
│   └────────────┘ └──────────────┘ └────────────┘ └──────────────────┘       │
├──────────────────────────────────────────────────────────────────────────────┤
│                    EXISTING: Data & Auth Layer                                │
│                                                                              │
│   RequestContext ─── enforcePermissions() ─── EncryptionService              │
│   AuditService  ─── HealthDataService    ─── SourceResolution               │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────────────┐
          │                │                        │
          ▼                ▼                        ▼
┌──────────────┐  ┌──────────────┐       ┌──────────────────┐
│  PostgreSQL  │  │   AWS KMS    │       │     Inngest      │
│              │  │              │       │                  │
│  EXISTING:   │  │  Per-user    │       │  NEW:            │
│  health_data │  │  envelope    │       │  baselines.      │
│  share_grants│  │  encryption  │       │    refresh       │
│  audit_events│  │              │       │  anomalies.      │
│              │  │              │       │    detect         │
│  NEW:        │  │              │       │                  │
│  metric_     │  │              │       │  EXISTING:       │
│    baselines │  │              │       │  sync.sweep      │
│  anomaly_    │  │              │       │  sync.connection │
│    events    │  │              │       │  token.refresh   │
│  user_       │  │              │       │                  │
│    annotations│  │              │       │                  │
│  dismissed_  │  │              │       │                  │
│    insights  │  │              │       │                  │
└──────────────┘  └──────────────┘       └──────────────���───┘
```

---

## 2. Design Decisions

Decisions made during design review that shape this LLD:

| # | Decision | Rationale |
|---|----------|-----------|
| D-1 | **Hybrid materialization** — Pre-compute baselines in background job; compute correlations, trends, insights, anomalies on-demand within view endpoint handlers | Baselines are needed on every view and are expensive to compute (30 days × N metrics). Other computations are view-specific and must be fresh. |
| D-2 | **All derived health data is encrypted** — Baselines, anomaly deviations, annotation notes, anomaly labels are stored with the same envelope encryption as raw health data | Founder directive: if it's health data, it's encrypted. Always. Statistical derivatives (averages, z-scores) still reveal health information. |
| D-3 | **Viewer can navigate freely within granted scope** — `view_type` on share grants is the default landing view, not a lock. Viewers can switch views within their granted metrics and date range. | Doctors need to drill from a 30-day trend into a specific night. The security boundary is metrics + date range, not view type. |
| D-4 | **Anomaly detection: on-demand for views, cron for historical index** — The anomaly view endpoint always computes fresh anomaly data. The daily cron persists `anomaly_events` rows for historical pattern matching. | Users expect real-time anomaly status when they look. The cron builds the historical index needed for cosine similarity matching. |
| D-5 | **PDF export is a downstream consumer, not a backend concern** — View endpoints return structured data that can be consumed by the interactive frontend, a PDF renderer, or any future format. The LLD defines the data contracts; PDF rendering is a separate design exercise. | Prevents scope creep. The backend's job is to produce the data; the rendering format is a frontend concern. |
| D-6 | **Insight rules defined in code, phased by priority** — P0: simple threshold-based insights (delta from baseline). P1: cross-metric conditional insights (sleep disruption, recovery arc). | Ship basic insights quickly. Complex rule engine deferred to P1. |
| D-7 | **LLM-generated narratives for complex insights (P1)** — P1 cross-metric insights use Claude Haiku to generate natural-language narratives from structured rule output. Synchronous call with loading spinner on first view; cached (encrypted) for subsequent views. Simple P0 insights remain template-based. | Templates struggle with multi-metric narratives ("your HRV dropped while RHR rose after a late meal preceded a glucose spike"). An LLM produces contextual, conversational text. See Addendum A. |

### Encryption Decision Map (D-2)

Every field in the new tables was evaluated against the encryption directive.
Fields that enable querying/filtering remain unencrypted; everything containing
health-derived values or user-entered content is encrypted.

```
                          Is it health data, health-derived,
                           or user-entered health context?
                                      │
                           ┌──── YES ─┴─ NO ────┐
                           │                     │
                     ┌─────▼─────┐         ┌─────▼─────┐
                     │ ENCRYPTED │         │ PLAINTEXT │
                     │  (BYTEA)  │         │           │
                     └───────────┘         └───────────┘

  ENCRYPTED (BYTEA)                        PLAINTEXT
  ─────────────────                        ─────────
  metric_baselines.value_encrypted         metric_baselines.reference_date
    → avg, stddev, upper, lower              → needed for cache lookup

  anomaly_events.deviations_encrypted      anomaly_events.anomaly_score
    → z-scores, averages, raw values         → integer count, needed for
                                               WHERE score >= 3 filtering
  anomaly_events.user_label_encrypted      anomaly_events.pattern_match_date
    → user-entered text ("flu onset")        → date reference for lookups

  user_annotations.label_encrypted         anomaly_events.pattern_match_similarity
    → "Late dinner", "10K run"               → float 0-1, statistical comparison

  user_annotations.note_encrypted          user_annotations.event_type
    → "3 glasses of wine"                    → categorical enum for filtering

  share_grants.view_params_encrypted       user_annotations.occurred_at / ended_at
    → may reference specific metrics         → timestamps for time-range queries

                                           share_grants.view_type
                                             → categorical enum for routing

                                           dismissed_insights.*
                                             → only stores fact of dismissal,
                                               not health content
```

---

## 3. New Database Tables

### Entity Relationship Overview

How new tables relate to existing tables (new tables marked with `*`):

```
┌─────────────────────┐
│       users          │
│  (existing)          │
├─────────────────────┤
│ id (PK)             │
│ display_name        │
│ kms_key_arn         │──────── used by EncryptionService
└──────────┬──────────┘         to encrypt/decrypt all
           │                    BYTEA columns below
           │
     ┌─────┼──────────┬──────────────┬────────────────┐
     │     │          │              │                │
     ▼     │          ▼              ▼                ▼
┌─────────────┐  ┌──────────────┐ ┌───────────────┐ ┌────────────────┐
│ *metric_    │  │ health_data_ │ │ *anomaly_     │ │ *user_         │
│  baselines  │  │  daily       │ │  events       │ │  annotations   │
├─────────────┤  │ (existing)   │ ├───────────────┤ ├────────────────┤
│ user_id FK  │  ├──────────────┤ │ user_id FK    │ │ user_id FK     │
│ metric_type │  │ user_id FK   │ │ date          │ │ event_type     │
│ ref_date    │  │ metric_type  │ │ anomaly_score │ │ label_encrypted│
│ value_enc   │  │ date         │ │ deviations_enc│ │ note_encrypted │
│ computed_at │  │ value_enc    │ │ match_date    │ │ occurred_at    │
└─────────────┘  │ source       │ │ match_sim     │ │ ended_at       │
     ▲           └──────────────┘ │ label_enc     │ └────────────────┘
     │                ▲           └───────────────┘
     │                │
     │     ┌──────────┘  30-day window query
     │     │             feeds baseline computation
     │     │
┌────┴─────┴──────────────────┐
│  baselines.refresh job      │
│  (Inngest cron, every 6h)   │
│                              │
│  Reads health_data_daily     │
│  → decrypts → computes →    │
│  → encrypts → writes        │
│    metric_baselines          │
└──────────────────────────────┘

┌─────────────────────┐       ┌──────────────────┐
│    share_grants     │       │ *dismissed_      │
│    (existing +      │       │  insights        │
│     2 new columns)  │       ├──────────────────┤
├─────────────────────┤       │ user_id FK (PK)  │
│ ...existing cols... │       │ insight_type (PK)│
│ + view_type    NEW  │       │ ref_date    (PK) │
│ + view_params  NEW  │       │ dismissed_at     │
│   _encrypted        │       └──────────────────┘
└─────────────────────┘
```

### 3.1 `metric_baselines` — Materialized Baseline Cache

Stores pre-computed 30-day rolling baselines per metric, encrypted.

```sql
CREATE TABLE metric_baselines (
  id            BIGSERIAL       PRIMARY KEY,
  user_id       VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_type   VARCHAR(64)     NOT NULL,
  reference_date DATE           NOT NULL,
  value_encrypted BYTEA         NOT NULL,
  computed_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_baselines_user_metric_date
    UNIQUE (user_id, metric_type, reference_date)
);

CREATE INDEX idx_baselines_user_date
  ON metric_baselines (user_id, reference_date);
```

**Encrypted payload shape** (JSON, encrypted with user's DEK):

```typescript
interface BaselinePayload {
  avg_30d: number;       // arithmetic mean of prior 30 days
  stddev_30d: number;    // population standard deviation of prior 30 days
  upper: number;         // avg + 1 stddev (normal range top)
  lower: number;         // avg - 1 stddev (normal range bottom)
  sample_count: number;  // number of data points in the 30-day window
}
```

**Key properties:**

- One row per `(user_id, metric_type, reference_date)`.
- `reference_date` is the date for which the baseline is valid. The 30-day
  window is `[reference_date - 30, reference_date - 1]`.
- The daily background job computes baselines for `reference_date = today`.
- View endpoints check for a cached baseline first; fall back to on-demand
  computation for historical dates.
- Upsert on conflict: `ON CONFLICT (user_id, metric_type, reference_date)
  DO UPDATE SET value_encrypted = EXCLUDED.value_encrypted, computed_at = NOW()`.

**Drizzle schema** (`/src/db/schema/metric-baselines.ts`):

```typescript
import { pgTable, bigserial, varchar, date, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types";
import { users } from "./users";

export const metricBaselines = pgTable("metric_baselines", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: varchar("user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  metricType: varchar("metric_type", { length: 64 }).notNull(),
  referenceDate: date("reference_date").notNull(),
  valueEncrypted: bytea("value_encrypted").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_baselines_user_metric_date")
    .on(table.userId, table.metricType, table.referenceDate),
  index("idx_baselines_user_date")
    .on(table.userId, table.referenceDate),
]);
```

---

### 3.2 `anomaly_events` — Persisted Anomaly Detection Results

Stores historical anomaly events for pattern matching. All health-derived data
is encrypted.

```sql
CREATE TABLE anomaly_events (
  id            BIGSERIAL       PRIMARY KEY,
  user_id       VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          DATE            NOT NULL,
  anomaly_score INTEGER         NOT NULL,
  deviations_encrypted BYTEA   NOT NULL,
  pattern_match_date     DATE,
  pattern_match_similarity FLOAT,
  user_label_encrypted   BYTEA,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_anomaly_user_date UNIQUE (user_id, date)
);

CREATE INDEX idx_anomaly_user_date
  ON anomaly_events (user_id, date DESC);

CREATE INDEX idx_anomaly_user_score
  ON anomaly_events (user_id, anomaly_score)
  WHERE anomaly_score >= 3;
```

**Encrypted payloads:**

`deviations_encrypted` — JSON encrypted with user's DEK:

```typescript
interface AnomalyDeviationsPayload {
  metrics: {
    [metricType: string]: {
      value: number;        // actual value on this date
      avg: number;          // 30-day baseline average
      stddev: number;       // 30-day baseline stddev
      z_score: number;      // (value - avg) / stddev
      direction: "above" | "below";
      is_anomalous: boolean; // |z_score| > 2
    };
  };
}
```

`user_label_encrypted` — user-entered freeform text (e.g., "flu onset"),
encrypted with user's DEK. Nullable (most events have no label).

**Key properties:**

- `anomaly_score` is stored unencrypted. It is a count (integer), not a health
  measurement, and is needed for query filtering (`WHERE anomaly_score >= 3`).
  Storing it encrypted would require decrypting every row to filter.
- `pattern_match_similarity` is a float between 0 and 1. It is a statistical
  comparison metric, not health data. Stored unencrypted for query ordering.
- `pattern_match_date` is a date reference. Not health data. Stored unencrypted.
- Everything else containing health-derived values or user-entered content is
  encrypted.

**Drizzle schema** (`/src/db/schema/anomaly-events.ts`):

```typescript
import { pgTable, bigserial, varchar, date, integer, real, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types";
import { users } from "./users";

export const anomalyEvents = pgTable("anomaly_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: varchar("user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  anomalyScore: integer("anomaly_score").notNull(),
  deviationsEncrypted: bytea("deviations_encrypted").notNull(),
  patternMatchDate: date("pattern_match_date"),
  patternMatchSimilarity: real("pattern_match_similarity"),
  userLabelEncrypted: bytea("user_label_encrypted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_anomaly_user_date")
    .on(table.userId, table.date),
  index("idx_anomaly_user_date")
    .on(table.userId, table.date),
  index("idx_anomaly_user_score")
    .on(table.userId, table.anomalyScore)
    .where(sql`anomaly_score >= 3`),
]);
```

---

### 3.3 `user_annotations` — Manual Event Markers

User-created annotations (meals, travel, medication, etc.) displayed as markers
on charts.

```sql
CREATE TABLE user_annotations (
  id            BIGSERIAL       PRIMARY KEY,
  user_id       VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type    VARCHAR(32)     NOT NULL,
  label_encrypted BYTEA         NOT NULL,
  note_encrypted  BYTEA,
  occurred_at   TIMESTAMPTZ     NOT NULL,
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_annotation_type
    CHECK (event_type IN ('meal', 'workout', 'travel', 'alcohol', 'medication', 'supplement', 'custom')),
  CONSTRAINT chk_annotation_duration
    CHECK (ended_at IS NULL OR ended_at > occurred_at)
);

CREATE INDEX idx_annotations_user_time
  ON user_annotations (user_id, occurred_at);
```

**Encrypted fields:**

- `label_encrypted` — short label (e.g., "Late dinner", "10K run"). Encrypted
  because labels reveal behavioral health information.
- `note_encrypted` — optional freeform note. Encrypted because users may enter
  sensitive details ("took Xanax", "3 glasses of wine").

**Unencrypted fields:**

- `event_type` — categorical enum. Needed for query filtering. Does not reveal
  specific health information (knowing a user has "meal" annotations is not
  sensitive; the content of the label is).
- `occurred_at`, `ended_at` — timestamps. Needed for time-range queries and
  chart positioning. While timestamps combined with event_type could reveal
  patterns, encrypting them would prevent all time-based queries, making the
  feature unusable.

**Drizzle schema** (`/src/db/schema/user-annotations.ts`):

```typescript
import { pgTable, bigserial, varchar, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bytea } from "./custom-types";
import { users } from "./users";

export const userAnnotations = pgTable("user_annotations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: varchar("user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  labelEncrypted: bytea("label_encrypted").notNull(),
  noteEncrypted: bytea("note_encrypted"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_annotations_user_time")
    .on(table.userId, table.occurredAt),
  check("chk_annotation_type", sql`event_type IN ('meal', 'workout', 'travel', 'alcohol', 'medication', 'supplement', 'custom')`),
]);
```

---

### 3.4 `dismissed_insights` — Insight Dismissal Tracking

Tracks which insight types a user has dismissed for which dates, preventing
re-display.

```sql
CREATE TABLE dismissed_insights (
  user_id       VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insight_type  VARCHAR(64)     NOT NULL,
  reference_date DATE           NOT NULL,
  dismissed_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_dismissed_insights
    PRIMARY KEY (user_id, insight_type, reference_date)
);
```

**No encryption needed.** This table stores only the fact that an insight was
dismissed, not its content. `insight_type` is a code (e.g.,
`sleep_disruption`, `recovery_arc`), not health data. `reference_date` is the
date context the insight was generated for.

**Drizzle schema** (`/src/db/schema/dismissed-insights.ts`):

```typescript
import { pgTable, varchar, date, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./users";

export const dismissedInsights = pgTable("dismissed_insights", {
  userId: varchar("user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  insightType: varchar("insight_type", { length: 64 }).notNull(),
  referenceDate: date("reference_date").notNull(),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.insightType, table.referenceDate] }),
]);
```

---

### 3.5 Schema Extensions to `share_grants`

Two new columns. Backwards compatible — both nullable with defaults.

```sql
ALTER TABLE share_grants
  ADD COLUMN view_type VARCHAR(32) DEFAULT 'custom',
  ADD COLUMN view_params_encrypted BYTEA;
```

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `view_type` | `VARCHAR(32)` | NOT NULL, default `'custom'` | Default landing view: `night`, `recovery`, `trend`, `weekly`, `anomaly`, `custom` |
| `view_params_encrypted` | `BYTEA` | YES | Encrypted JSON with view-specific parameters (e.g., selected correlation pairs, smoothing preference). Encrypted because params may reference specific metrics. |

**`view_type` is unencrypted** because it's a categorical enum needed for
routing. Knowing that a share link was created from the "trend" view does not
reveal health information.

**`view_params_encrypted` payload** (JSON, encrypted with owner's DEK):

```typescript
interface ViewParams {
  // Trend view
  smoothing?: "none" | "7d" | "30d";
  correlations?: [string, string][];  // metric pairs

  // Recovery view
  triggering_event_id?: number;       // annotation or period ID

  // Night view
  time_range?: { start: string; end: string }; // e.g., "20:00" to "06:00"
}
```

**Migration note:** Existing share grants get `view_type = 'custom'` and
`view_params_encrypted = NULL`, preserving current behavior.

---

## 4. Baseline Materialization

### 4.1 Strategy

Baselines (30-day avg + stddev per metric) are the most frequently needed
derived data — every view endpoint uses them. Computing baselines on-demand
requires decrypting 30 rows per metric. With 5–20 metrics per view, that's
150–600 decrypt operations just for baselines.

**Solution: pre-compute and cache as encrypted blobs.**

```
                    Two Paths to Baselines
                    ═══════════════════════

  HOT PATH (every view request)          BACKGROUND PATH (every 6 hours)
  ──────────────────────────────          ──────────────────────────────

  View Endpoint                          Inngest Cron: baselines.refresh
       │                                      │
       ▼                                      ▼
  ┌─────────────────────┐               ┌─────────────────────┐
  │ Check metric_       │               │ For each user:      │
  │ baselines cache     │               │ Query 30 days of    │
  │ (±2 day tolerance)  │               │ health_data_daily   │
  └──────────┬──────────┘               └──────────┬──────────┘
             │                                      │
        ┌────┴────┐                                 ▼
     HIT│         │MISS                    ┌─────────────────────┐
        │         │                        │ Decrypt all rows    │
        ▼         ▼                        │ (30 × N metrics)    │
  ┌──────────┐ ┌──────────────┐            └──────────┬──────────┘
  │ Decrypt  │ │ On-demand:   │                       │
  │ N cached │ │ Decrypt 30×N │                       ▼
  │ blobs    │ │ raw rows,    │            ┌─────────────────────┐
  │          │ │ compute in   │            │ Compute AVG, STDDEV │
  │ 5 ops   │ │ memory       │            │ per metric in       │
  │ vs 150  │ │              │            │ TypeScript           │
  └──────┬───┘ │ 150 ops     │            └──────────┬──────────┘
         │     └──────┬───────┘                       │
         │            │                               ▼
         ▼            ▼                    ┌─────────────────────┐
  ┌──────────────────────────┐             │ Encrypt result →    │
  │ Return baselines to      │             │ Upsert into         │
  │ view endpoint handler    │             │ metric_baselines    │
  └──────────────────────────┘             └─────────────────────┘

  Result: { avg_30d, stddev_30d, upper, lower, sample_count } per metric
```

| Approach | Decrypt ops (5 metrics) | Decrypt ops (20 metrics) |
|----------|------------------------|--------------------------|
| On-demand | 150 | 600 |
| Cached (encrypted) | 5 | 20 |
| **Reduction** | **30x** | **30x** |

The background job decrypts raw data, computes statistics, re-encrypts the
result, and stores it. On read, each view endpoint decrypts N baseline blobs
(one per metric) instead of 30N raw data blobs.

### 4.2 Background Job: `dashboard/baselines.refresh`

**Inngest function definition:**

```typescript
export const baselinesRefresh = inngest.createFunction(
  {
    id: "dashboard/baselines.refresh",
    name: "Dashboard Baselines Refresh",
    concurrency: [
      { limit: 5 },  // max 5 users processed concurrently
    ],
    retries: 3,
  },
  { cron: "30 */6 * * *" },  // Every 6 hours at :30 (offset from sync sweep at :00)
  async ({ step }) => { ... }
);
```

**Schedule:** Every 6 hours, offset 30 minutes from the sync sweep. This
ensures baselines are refreshed shortly after new data arrives from provider
syncs.

**Processing logic:**

```
1. Query all users with health data (users JOIN health_data_daily)
2. For each user (batched, 50 at a time):
   a. Query distinct metric_types for this user
   b. For each metric_type:
      i.  Query health_data_daily WHERE date BETWEEN (today - 30) AND (today - 1)
      ii. Decrypt all value_encrypted blobs
      iii. Compute: avg, stddev, upper (avg + stddev), lower (avg - stddev), sample_count
      iv. If sample_count < 7: skip (insufficient data for meaningful baseline)
      v.  Encrypt the BaselinePayload JSON with user's DEK
      vi. Upsert into metric_baselines (reference_date = today)
```

**Trigger after sync:** In addition to the cron schedule, the baseline refresh
is also triggered by the `integration/sync.connection` function on successful
sync completion, scoped to the synced user only:

```typescript
// At end of sync-connection.ts, after successful upsert:
await step.sendEvent("dashboard/baselines.refresh.user", {
  data: { userId: event.data.userId },
});
```

This ensures baselines are fresh within minutes of a manual sync.

### 4.3 On-Demand Fallback

When a view endpoint needs baselines for a `reference_date` that is not cached
(e.g., viewing historical data from 3 months ago), baselines are computed
on-demand using the same logic as the background job but scoped to the specific
date range and metrics requested.

```typescript
async function computeBaselinesOnDemand(
  userId: string,
  metrics: string[],
  referenceDate: string, // YYYY-MM-DD
): Promise<Map<string, BaselinePayload>>
```

**Baseline anchoring (FR-1.4):** Baselines must be computed relative to the
_start_ of the requested date range, not the current date. This ensures
historical views show historically-accurate baselines.

- For a Night Detail view on March 28: `referenceDate = 2026-03-28`, baseline
  window = Feb 26 – Mar 27.
- For a Recovery view from March 24–28: `referenceDate = 2026-03-24` (start of
  range), baseline window = Feb 22 – Mar 23.
- For a Trend view from Feb 27 – Mar 28: `referenceDate = 2026-02-27` (start of
  range), baseline window = Jan 28 – Feb 26.

Every view endpoint composition flow (§8.1–8.5) must pass the **start date of
the view** as the `referenceDate` when calling `fetchBaselines()`.

**Cache hit logic:** If the cached `reference_date` is within 2 days of the
requested `referenceDate`, use the cached baseline. The 30-day windows differ by
at most 2 out of 30 days (~93% overlap), which is statistically acceptable.
For dates further in the past, the on-demand path fires automatically.

```typescript
// Pseudo-code for baseline resolution in every view endpoint
const referenceDate = viewStartDate;  // FR-1.4: anchor to start of view range
const cached = await fetchCachedBaselines(userId, metrics, referenceDate, toleranceDays: 2);
const missing = metrics.filter(m => !cached.has(m));
if (missing.length > 0) {
  const computed = await computeBaselinesOnDemand(userId, missing, referenceDate);
  // Merge cached + computed
}
```

### 4.4 SQL Pattern for Baseline Computation

The on-demand path uses this query pattern (before encryption layer):

```sql
SELECT
  metric_type,
  AVG(decrypted_value) AS avg_30d,
  STDDEV_POP(decrypted_value) AS stddev_30d,
  COUNT(*) AS sample_count
FROM (
  SELECT metric_type, value_encrypted  -- decrypted in application layer
  FROM health_data_daily
  WHERE user_id = $1
    AND metric_type = ANY($2)
    AND date BETWEEN ($3::date - INTERVAL '30 days') AND ($3::date - INTERVAL '1 day')
    AND source = $4  -- resolved source per metric
) raw
GROUP BY metric_type;
```

Since values are encrypted, the actual flow is:

1. Query encrypted rows from `health_data_daily` for the 30-day window
2. Decrypt all `value_encrypted` blobs in application code
3. Group by `metric_type`, compute `avg` and `stddev` in TypeScript
4. Return results

This is why materialization matters — we shift this work to a background job
and avoid it on the hot path.

---

## 5. Computation Services

Shared service functions used by the view endpoint handlers. All operate on
decrypted data in memory — they never touch the database directly or persist
results (except the anomaly cron job).

Which services power which views:

```
                 Night   Recovery   Trend   Weekly   Anomaly
                 (W1)     (W2)      (W3)    (W4)     (W5)
                ─────── ────────── ─────── ──────── ─────────
  Baselines       x         x        x                 x
  Summaries       x         x                          x
  Rolling Avg                        x
  Correlations                       x
  Trends                             x
  Weekly                                      x
    Patterns
  Anomaly                                               x
    Score
  Historical                                            x
    Match
  Insights        x         x                 x        x
  Annotations     x         x
                ─────── ────────── ─────── ──────── ─────────
  Decrypt ops   ~1030      ~60      ~93     ~285     ~140
  Target p95    <500ms    <300ms   <400ms  <500ms   <500ms
```

**Key principle:** All computation happens on already-decrypted data. The
expensive step is decryption, not computation. The services are pure functions
that accept arrays of numbers and return derived results.

### 5.1 Module Structure

```
/src/lib/dashboard/
├── baselines.ts          — fetchBaselines(), computeBaselinesOnDemand()
├── correlations.ts       — computeCorrelations()
├── trends.ts             — computeTrends()
├── rolling-averages.ts   — computeRollingAverages()
├── anomalies.ts          — computeAnomalyScore(), findHistoricalMatch()
├── weekly-patterns.ts    — computeWeeklyPatterns()
├── insights.ts           — generateInsights(), InsightRule[]
├── summaries.ts          — computeSummaryMetrics()
├── annotations.ts        — fetchMergedAnnotations()
└── types.ts              — shared TypeScript interfaces
```

### 5.2 `computeCorrelations()`

**Input:** Two arrays of `{ date, value }` for each metric in a pair.

**Output:** Pearson correlation coefficient, strength label, direction.

```typescript
interface CorrelationResult {
  pair: [string, string];
  coefficient: number;          // -1.0 to 1.0
  strength: "strong" | "moderate" | "weak";
  direction: "positive" | "inverse";
  sample_count: number;
  sufficient_data: boolean;     // false if overlap < 7 points
}

function computeCorrelations(
  metricsData: Map<string, { date: string; value: number }[]>,
  pairs: [string, string][],
): CorrelationResult[]
```

**Algorithm:** Pearson correlation computed in-memory (no SQL `corr()`). This
avoids a second database round-trip and works on already-decrypted data.

```
r = Σ((xi - x̄)(yi - ȳ)) / √(Σ(xi - x̄)² × Σ(yi - ȳ)²)
```

**Strength classification:**

| |r| range | Label |
|-----------|-------|
| 0.7 – 1.0 | strong |
| 0.4 – 0.7 | moderate |
| 0.0 – 0.4 | weak |

**Minimum data:** 7 overlapping dates. Below this, return
`sufficient_data: false`.

### 5.3 `computeTrends()`

**Input:** Array of `{ date, value }` for a metric, sorted by date.

**Output:** Trend direction, start/end values, percentage change.

```typescript
interface TrendResult {
  direction: "rising" | "falling" | "stable";
  start_value: number;    // 7-day average of first week
  end_value: number;      // 7-day average of last week
  change_pct: number;     // ((end - start) / start) × 100
  change_abs: number;     // end - start
}

function computeTrends(
  data: { date: string; value: number }[],
  noiseThreshold: number = 5, // % change below this is "stable"
): TrendResult
```

**Algorithm:** Compare 7-day averages of the first and last weeks of the range.
Using week averages instead of single-day start/end values smooths noise and
prevents misleading results from outlier days.

**Classification:**

- `|change_pct| < noiseThreshold` → `stable`
- `change_pct > 0` → `rising`
- `change_pct < 0` → `falling`

### 5.4 `computeRollingAverages()`

**Input:** Array of `{ date, value }` for a metric, window size.

**Output:** Array of `{ date, value }` with smoothed values.

```typescript
function computeRollingAverages(
  data: { date: string; value: number }[],
  windowDays: 7 | 30,
): { date: string; value: number }[]
```

**Algorithm:** Simple moving average. For each date, average all available
data points in the preceding `windowDays`. Missing days are skipped (average
over available points in the window, not zero-filled).

### 5.5 `computeAnomalyScore()`

**Input:** Map of metric → value for a single date, plus baselines.

**Output:** Anomaly score and per-metric deviations.

```typescript
interface AnomalyResult {
  date: string;
  anomaly_score: number;           // count of anomalous metrics
  threshold: number;               // 3 (configurable)
  is_alert: boolean;               // anomaly_score >= threshold
  deviations: Map<string, {
    value: number;
    avg: number;
    stddev: number;
    z_score: number;
    direction: "above" | "below";
    is_anomalous: boolean;         // |z_score| > 2
  }>;
}

function computeAnomalyScore(
  values: Map<string, number>,
  baselines: Map<string, BaselinePayload>,
  threshold: number = 3,
  zScoreLimit: number = 2,
): AnomalyResult
```

**Algorithm:** For each metric with both a value and a baseline, compute
`z_score = (value - avg) / stddev`. If `|z_score| > zScoreLimit`, the metric
is anomalous. Sum anomalous metrics to get `anomaly_score`.

### 5.6 `findHistoricalMatch()`

**Input:** Current anomaly's deviation vector, list of past anomaly events.

**Output:** Most similar historical event.

```typescript
interface HistoricalMatch {
  date: string;
  label: string | null;            // decrypted user_label
  similarity: number;              // 0.0 to 1.0
  deviations: AnomalyDeviationsPayload;
}

async function findHistoricalMatch(
  currentDeviations: AnomalyDeviationsPayload,
  pastEvents: AnomalyEvent[],       // max 50, already fetched
  encryption: EncryptionProvider,
  userId: string,
): Promise<HistoricalMatch | null>
```

**Algorithm:** Cosine similarity between z-score vectors.

```
similarity = (A · B) / (|A| × |B|)

where A = [z_score_metric1, z_score_metric2, ...] for current event
      B = same for historical event
```

Only metrics present in both vectors are compared. Requires decrypting each
past event's `deviations_encrypted` blob (up to 50 decryptions). This is
acceptable for a P2 feature that runs rarely.

### 5.7 `computeWeeklyPatterns()`

**Input:** Daily metric data for 28+ days.

**Output:** Day-of-week aggregations, quartile ranks, variance scores.

```typescript
interface WeeklyPatternResult {
  heatmap: Map<string, {                // metricType → days
    days: Map<number, {                 // dow (0=Sun ... 6=Sat) → stats
      avg: number;
      stddev: number;
      n: number;
      quartile: 1 | 2 | 3 | 4;
    }>;
    polarity: "higher_is_better" | "lower_is_better";
  }>;
  sparklines: Map<string, number[]>;    // metricType → [Sun..Sat] averages
  variance: Map<string, {
    score: number;
    level: "high" | "moderate" | "low";
  }>;
}

function computeWeeklyPatterns(
  metricsData: Map<string, { date: string; value: number }[]>,
  minWeeks: number = 4,
): WeeklyPatternResult
```

**Algorithm:**

1. Group values by `(metric_type, day_of_week)`.
2. Compute `avg` and `stddev` per group.
3. Rank the 7 day-of-week averages per metric using `NTILE(4)` logic:
   sort averages, assign quartiles 1 (worst) to 4 (best), respecting
   `polarity` (for RHR, lower is better, so lowest avg = quartile 4).
4. Compute week-to-week variance: group by ISO week, compute weekly averages,
   then `stddev` of the weekly averages.
5. Classify: variance score > 15% of mean = `high`, 5–15% = `moderate`,
   < 5% = `low`.

### 5.8 `computeSummaryMetrics()`

**Input:** Metric values for a date, plus baselines.

**Output:** Summary with deltas, direction, and status quartile.

```typescript
interface SummaryMetric {
  value: number;
  avg_30d: number;
  stddev_30d: number;
  delta: number;             // value - avg
  delta_pct: number;         // ((value - avg) / avg) × 100
  direction: "better" | "worse";
  status: "critical" | "warning" | "normal" | "good";
}

function computeSummaryMetrics(
  values: Map<string, number>,
  baselines: Map<string, BaselinePayload>,
): Map<string, SummaryMetric>
```

**Direction logic** (accounts for metric polarity):

| Metric category | Better when | delta > 0 means |
|-----------------|-------------|-----------------|
| `hrv`, `sleep_score`, `readiness_score`, `deep_sleep`, `rem_sleep`, `spo2` | Higher | `better` |
| `rhr`, `sleep_latency`, `respiratory_rate` | Lower | `worse` |
| `weight`, `steps`, `body_temperature_deviation` | Context-dependent | `neutral` (omit direction) |

**Status classification** (percentile relative to 30-day distribution):

| Status | Z-score range | Meaning |
|--------|--------------|---------|
| `critical` | z < -1.28 or z > 1.28 (bottom/top 10%) | Respects polarity |
| `warning` | -1.28 < z < -0.67 or 0.67 < z < 1.28 (10–25th) | |
| `normal` | -0.67 < z < 0.67 (25th–75th) | |
| `good` | best 25% by polarity | |

The z-score thresholds approximate percentile boundaries of a normal
distribution.

---

## 6. Insight Generation Engine

### 6.1 Architecture

Insights are generated **on-demand** as part of view endpoint responses, not
pre-computed. This ensures they are always fresh and consistent with the
displayed data.

```
  Insight Generation Flow
  ═══════════════════════

  Computed View Data                     Dismissed Insights
  (from §5 services)                     (from DB table)
       │                                      │
       ▼                                      ▼
  ┌──────────────────────────────────────────────────────────┐
  │                    RULE ENGINE                            │
  │                                                          │
  │  Rules evaluated in priority order (lower = first):      │
  │                                                          │
  │  P=5   multi_metric_deviation  ──┐                       │
  │  P=10  elevated_rhr             ├── P0 rules (MVP)      │
  │  P=20  low_sleep_score          │   Simple thresholds   │
  │  P=30  suppressed_hrv          ──┘                       │
  │                                                          │
  │  P=40  sleep_disruption        ──┐                       │
  │  P=50  recovery_arc             ├── P1 rules (launch)   │
  │  P=60  weekly_rhythm            │   Cross-metric logic  │
  │  P=70  trend_alert             ──┘                       │
  │                                                          │
  │  For each rule:                                          │
  │    - Is this rule's view type active? (skip if not)      │
  │    - Was this insight dismissed? (skip if yes)            │
  │    - Does the condition fire? (evaluate)                 │
  │    - If yes → add to results                             │
  │                                                          │
  │  Stop after N=3 insights (avoid overwhelming user)       │
  └──────────────────────────┬───────────────────────────────┘
                             │
                             ▼
                  Insight[] in view response

  Each Insight:
  ┌──────────────────────────────────────────┐
  │ type: "elevated_rhr"                     │
  │ title: "Elevated resting heart rate"     │
  │ body: "Your resting HR was 72 bpm,      │
  │        11 bpm above your 30-day avg..."  │
  │ related_metrics: ["rhr"]                 │
  │ severity: "warning"                      │
  │ dismissible: true                        │
  └──────────────────────────────────────────┘
```

The engine is a simple ordered rule list. Each rule is a pure function that
receives the computed view data and returns an insight (or null). Rules are
evaluated in priority order; the first N that fire are included in the
response (default N=3 per view).

```typescript
// /src/lib/dashboard/insights.ts

interface InsightRule {
  id: string;                    // e.g., "sleep_disruption"
  viewTypes: ViewType[];         // which views this rule applies to
  priority: number;              // lower = higher priority
  evaluate: (ctx: InsightContext) => Insight | null;
}

interface Insight {
  type: string;                  // matches rule id
  title: string;
  body: string;                  // templated text with interpolated values
  related_metrics: string[];
  severity: "info" | "warning";
  dismissible: boolean;
}

interface InsightContext {
  viewType: ViewType;
  date: string;
  summaries: Map<string, SummaryMetric>;
  baselines: Map<string, BaselinePayload>;
  anomaly?: AnomalyResult;
  trends?: Map<string, TrendResult>;
  weeklyPatterns?: WeeklyPatternResult;
  annotations?: Annotation[];
  dismissedTypes: Set<string>;   // already dismissed by this user for this date
}
```

### 6.2 P0 Insight Rules (Ship with MVP)

Simple threshold-based rules using summary deltas:

```typescript
const P0_RULES: InsightRule[] = [
  {
    id: "elevated_rhr",
    viewTypes: ["night", "recovery"],
    priority: 10,
    evaluate: (ctx) => {
      const rhr = ctx.summaries.get("rhr");
      if (!rhr || rhr.status === "normal" || rhr.status === "good") return null;
      if (ctx.dismissedTypes.has("elevated_rhr")) return null;
      return {
        type: "elevated_rhr",
        title: "Elevated resting heart rate",
        body: `Your resting HR was ${rhr.value} bpm, ${Math.abs(rhr.delta)} bpm ${rhr.delta > 0 ? "above" : "below"} your 30-day average of ${rhr.avg_30d} bpm.`,
        related_metrics: ["rhr"],
        severity: rhr.status === "critical" ? "warning" : "info",
        dismissible: true,
      };
    },
  },
  {
    id: "low_sleep_score",
    viewTypes: ["night", "recovery"],
    priority: 20,
    evaluate: (ctx) => { /* Similar pattern for sleep_score */ },
  },
  {
    id: "suppressed_hrv",
    viewTypes: ["night", "recovery"],
    priority: 30,
    evaluate: (ctx) => { /* Similar pattern for hrv */ },
  },
  {
    id: "multi_metric_deviation",
    viewTypes: ["night", "recovery", "anomaly"],
    priority: 5,
    evaluate: (ctx) => {
      if (!ctx.anomaly || !ctx.anomaly.is_alert) return null;
      const count = ctx.anomaly.anomaly_score;
      const total = ctx.anomaly.deviations.size;
      return {
        type: "multi_metric_deviation",
        title: `${count} of ${total} metrics outside normal range`,
        body: `Multiple metrics are simultaneously deviating from your baseline, which may indicate a systemic cause.`,
        related_metrics: [...ctx.anomaly.deviations.entries()]
          .filter(([, d]) => d.is_anomalous)
          .map(([m]) => m),
        severity: "warning",
        dismissible: true,
      };
    },
  },
];
```

### 6.3 P1 Insight Rules (Post-Launch)

Cross-metric conditional rules. These rules produce structured context that is
passed to Claude Haiku to generate natural-language narratives instead of using
templates. See **Addendum A** for the full LLM integration design.

- **`sleep_disruption`** — Fires when `sleep_latency > 2× baseline` AND
  a correlated event (glucose spike or elevated HR) exists in the preceding
  hours. Requires both summary data and annotation/series data.
- **`recovery_arc`** — Fires when a multi-day view shows a workout/travel
  event followed by HRV/readiness dip and subsequent recovery to baseline.
  Requires daily metric array analysis.
- **`weekly_rhythm`** — Fires when day-of-week variance is `high` and a
  consistent peak/trough pattern exists.
- **`trend_alert`** — Fires when a metric's 30-day trend exceeds 15% change.

### 6.4 Insight Dismissal

```
POST /api/insights/:type/:date/dismiss
```

Inserts into `dismissed_insights`. The view endpoint checks this table and
filters dismissed insights from the response.

---

## 7. View Endpoint Architecture

### 7.1 Design Principles

1. **One request, one view.** Each endpoint returns all data needed to render
   its wireframe. Zero client-side computation required.
2. **Shared composition layer.** All 5 endpoints use the same building blocks
   (§5). No duplicated computation logic.
3. **Permission-transparent.** Owner and viewer requests use the same endpoints.
   Viewers pass `grant_token` and receive scoped responses.
4. **Audit-consistent.** Every view endpoint emits a `data.viewed` audit event
   with view-specific metadata.

### 7.2 Route Structure

```
/api/views/night/route.ts       → GET handler
/api/views/recovery/route.ts    → GET handler
/api/views/trend/route.ts       → GET handler
/api/views/weekly/route.ts      → GET handler
/api/views/anomaly/route.ts     → GET handler
```

Five separate route files sharing the composition layer at `/src/lib/dashboard/`.

### 7.3 Common Request Flow

Every view endpoint follows this sequence:

```
  Browser Request: GET /api/views/trend?start=2026-02-27&end=2026-03-28&metrics=rhr,hrv
                                │
  ┌─────────────────────────────▼──────────────────────────────────────────┐
  │  1. PARSE & VALIDATE                                                   │
  │     Zod schema validates params, rejects malformed requests            │
  └─────────────────────────────┬──────────────────────────────────────────┘
                                │
  ┌─────────────────────────────▼──────────────────────────────────────────┐
  │  2. AUTH & PERMISSIONS                                                 │
  │     getResolvedContext(request) → { role, userId, permissions }         │
  │     enforcePermissions(ctx, scope)                                     │
  │                                                                        │
  │     Owner: full access to own data                                     │
  │     Viewer: metrics ∩ allowedMetrics, dates clamped to grant range     │
  └─────────────────────────────┬──────────────────────────────────────────┘
                                │
  ┌─────────────────────────────▼──────────────────────────────────────────┐
  │  3. FETCH & DECRYPT (most expensive step)                              │
  │                                                                        │
  │     ┌─ Baselines ──────────────────────────────────────────┐           │
  │     │  Check metric_baselines cache (2-day tolerance)      │           │
  │     │  Cache hit → decrypt N blobs (fast)                  │           │
  │     │  Cache miss → decrypt 30×N raw rows (slow)           │           │
  │     └──────────────────────────────────────────────────────┘           │
  │     ┌─ Raw Data ───────────────────────────────────────────┐           │
  │     │  Query health_data_daily / series / periods          │           │
  │     │  Decrypt each value_encrypted blob row-by-row        │           │
  │     └──────────────────────────────────────────────────────┘           │
  │     ┌─ Annotations ────────────────────────────────────────┐           │
  │     │  Query user_annotations + health_data_periods        │           │
  │     │  Decrypt label_encrypted, note_encrypted             │           │
  │     └──────────────────────────────────────────────────────┘           │
  └─────────────────────────────┬──────────────────────────────────────────┘
                                │ (all data now decrypted in memory)
  ┌─────────────────────────────▼──────────────────────────────────────────┐
  │  4. COMPUTE (pure functions, fast — no I/O)                            │
  │                                                                        │
  │     Summaries → Deltas → Rolling Avgs → Trends → Correlations          │
  └─────────────────────────────┬──────────────────────────────────────────┘
                                │
  ┌─────────────────────────────▼──────────────────────────────────────────┐
  │  5. INSIGHTS (rule engine evaluation)                                  │
  │                                                                        │
  │     Check dismissed_insights → Evaluate rules → Return top N           │
  └─────────────────────────────┬──────────────────────────────────────────┘
                                │
  ┌─────────────────────────────▼──────────────────────────────────────────┐
  │  6. AUDIT & RESPOND                                                    │
  │                                                                        │
  │     Emit view.accessed audit event (fire-and-forget)                   │
  │     Return assembled JSON response                                     │
  │     Plaintext discarded — never persisted                              │
  └────────────────────────────────────────────────────────────────────────┘
```

The same flow applies to all 5 view endpoints. The numbered steps below
are the detailed version:
7. Generate insights
   → Evaluate rules against computed data
8. Fetch annotations (user_annotations + health_data_periods)
   → Decrypt label/note blobs
9. Assemble response
10. Emit audit event (fire-and-forget)
11. Return JSON response
```

### 7.4 Viewer Access

All view endpoints accept a `grant_token` query parameter for viewer access:

```
GET /api/views/night?date=2026-03-28&grant_token=abc123...
```

```
  Owner vs. Viewer: Same Endpoint, Different Scope
  ═════════════════════════════════════════════════

  OWNER REQUEST                              VIEWER REQUEST
  ─────────────                              ──────────────

  GET /api/views/trend                       GET /api/views/trend
    ?metrics=rhr,hrv,sleep_score               ?metrics=rhr,hrv,sleep_score,weight
    &start=2026-02-27                          &start=2026-01-01
    &end=2026-03-28                            &end=2026-03-28
                                               &grant_token=abc123...
       │                                            │
       ▼                                            ▼
  ┌──────────────────┐                       ┌──────────────────────┐
  │ RequestContext:   │                       │ Validate grant_token │
  │ role = "owner"   │                       │ Extract permissions: │
  │ userId = "usr_x" │                       │   metrics: [rhr,hrv] │
  │ permissions: full │                       │   dates: Feb-Mar     │
  └────────┬─────────┘                       └──────────┬───────────┘
           │                                            │
           ▼                                            ▼
  ┌──────────────────┐                       ┌────────────────────────────┐
  │ enforcePerms:    │                       │ enforcePerms:              │
  │  metrics → pass  │                       │  [rhr,hrv,sleep,weight]    │
  │  dates → pass    │                       │  ∩ [rhr,hrv] = [rhr,hrv]  │
  │  (no narrowing)  │                       │                            │
  │                  │                       │  dates: max(Jan 1, Feb 27) │
  │                  │                       │       = Feb 27             │
  └────────┬─────────┘                       │  (clamped to grant range)  │
           │                                 └──────────┬─────────────────┘
           │                                            │
           ▼                                            ▼
  ┌──────────────────┐                       ┌──────────────────────┐
  │ Fetch ALL 3      │                       │ Fetch only rhr, hrv  │
  │ metrics, full    │                       │ Feb 27 – Mar 28      │
  │ date range       │                       │ (narrowed scope)     │
  └────────┬─────────┘                       └──────────┬───────────┘
           │                                            │
           ▼                                            ▼
       Same computation, same response shape, different data scope
```

The endpoint:
1. Validates the grant token (same flow as `/api/viewer/validate`)
2. Extracts `allowedMetrics`, `dataStart`, `dataEnd` from the grant
3. Intersects requested metrics with `allowedMetrics`
4. Clamps date range to grant boundaries
5. Fetches data using the **owner's** userId (from the grant's `ownerId`)
6. Emits audit event with `actor_type: "viewer"` and `grant_id`

**Alternatively**, if the viewer already has a `totus_viewer` cookie (set by a
prior `/api/viewer/validate` call), the middleware populates the
`RequestContext` with viewer permissions, and the view endpoint uses those
directly — no `grant_token` param needed.

Both paths produce identical results. The `grant_token` param supports direct
deep-links into specific views.

---

## 8. View Endpoint Specifications

### 8.1 Night Detail View — `GET /api/views/night`

**Wireframe:** W1 | **Scenarios:** S1, S2

Returns all data for a single night: intraday series, sleep hypnogram, daily
summary with deltas, baselines, annotations, and insights.

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `date` | `YYYY-MM-DD` | Yes | — | The night to display |
| `metrics` | `string` | No | all available | Comma-separated metric types |
| `grant_token` | `string` | No | — | Viewer access token |

**Zod Schema:**

```typescript
const nightViewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metrics: z.array(z.string().refine(isValidMetricType)).optional(),
  grant_token: z.string().optional(),
});
```

**Internal Composition:**

```
1. fetchBaselines(userId, metrics, referenceDate=date)   → FR-1.4: anchored to view date
2. fetchDailyValues(userId, metrics, date)          → health_data_daily
3. fetchIntradaySeries(userId, seriesMetrics, nightWindow)  → health_data_series
4. fetchSleepPeriods(userId, date)                   → health_data_periods
5. computeSummaryMetrics(dailyValues, baselines)
6. fetchMergedAnnotations(userId, nightWindow)
7. generateInsights("night", { summaries, baselines, annotations })
8. Assemble response
```

**Night window:** For a given date, the time range is `date - 1 day 20:00` to
`date 08:00` (8 PM previous evening to 8 AM morning). This captures the full
sleep period including pre-sleep hours.

**Response 200:**

```typescript
interface NightDetailResponse {
  date: string;
  time_range: { start: string; end: string };  // ISO timestamps

  insights: Insight[];

  annotations: Annotation[];

  series: {
    [metricType: string]: {
      timestamps: string[];   // ISO timestamps
      values: number[];
    };
  };

  hypnogram: {
    stages: {
      stage: "awake" | "light" | "deep" | "rem";
      start: string;   // ISO timestamp
      end: string;
    }[];
    total_duration_hr: number;
  } | null;

  summary: {
    [metricType: string]: SummaryMetric;
  };

  baselines: {
    [metricType: string]: {
      avg: number;
      stddev: number;
      upper: number;
      lower: number;
    };
  };
}
```

**Performance Budget:**

| Step | Estimated Decrypt Ops | Target |
|------|-----------------------|--------|
| Baselines (5 metrics, cached) | 5 | — |
| Daily values (5 metrics) | 5 | — |
| Intraday series (HR + glucose, ~1000 pts) | ~1000 | — |
| Sleep periods (metadata) | ~10 | — |
| Annotations (labels + notes) | ~10 | — |
| **Total** | **~1030** | **< 500ms p95** |

The intraday series decryption dominates. This is unavoidable for the night
view. Mitigation: limit series resolution (e.g., 5-minute intervals instead
of per-second) if performance is insufficient.

---

### 8.2 Multi-Day Recovery View — `GET /api/views/recovery`

**Wireframe:** W2 | **Scenarios:** S3, S5

Returns daily metric values over a 3–7 day range with baselines, daily scores,
triggering event, and insights.

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `start` | `YYYY-MM-DD` | Yes | — | Start of recovery window |
| `end` | `YYYY-MM-DD` | Yes | — | End of recovery window |
| `metrics` | `string` | No | `readiness_score,hrv,rhr,sleep_score,body_temperature_deviation` | Comma-separated |
| `event_id` | `number` | No | — | Triggering annotation/period ID |
| `grant_token` | `string` | No | — | Viewer access token |

**Validation:**

- Date range: 2–14 days.
- At least 1 metric.

**Response 200:**

```typescript
interface RecoveryResponse {
  date_range: { start: string; end: string };

  triggering_event: Annotation | null;

  insights: Insight[];

  daily: {
    [date: string]: {
      metrics: {
        [metricType: string]: SummaryMetric;
      };
    };
  };

  baselines: {
    [metricType: string]: {
      avg: number; stddev: number; upper: number; lower: number;
    };
  };

  sparklines: {
    [metricType: string]: {
      dates: string[];
      values: number[];
    };
  };

  annotations: Annotation[];
}
```

**Performance Budget:** ~5 metrics × 7 days = 35 daily decrypt ops + 5
baseline decrypts + ~20 annotation decrypts ≈ **60 decrypts. Target < 300ms.**

---

### 8.3 30-Day Trend View — `GET /api/views/trend`

**Wireframe:** W3 | **Scenario:** S4

Returns daily values with rolling averages, trend analysis, correlations, and
baselines over a 30+ day range.

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `start` | `YYYY-MM-DD` | Yes | — | Start date |
| `end` | `YYYY-MM-DD` | Yes | — | End date |
| `metrics` | `string` | Yes | — | Comma-separated (1–10) |
| `smoothing` | `string` | No | `7d` | `none`, `7d`, `30d` |
| `correlations` | `string` | No | — | Metric pairs, e.g., `rhr:sleep_score,hrv:sleep_score` |
| `grant_token` | `string` | No | — | Viewer access token |

**Validation:**

- Date range: 7–365 days.
- Correlations: max 5 pairs.
- Each metric in a correlation pair must be in the `metrics` list.

**Response 200:**

```typescript
interface TrendResponse {
  date_range: { start: string; end: string };
  smoothing: "none" | "7d" | "30d";

  insights: Insight[];

  metrics: {
    [metricType: string]: {
      raw: { dates: string[]; values: number[] };
      smoothed: { dates: string[]; values: number[] } | null;
      trend: TrendResult;
      baseline: { avg: number; stddev: number; upper: number; lower: number };
    };
  };

  correlations: CorrelationResult[];
}
```

**Performance Budget:** 3 metrics × 30 days = 90 daily decrypts + 3 baseline
decrypts + correlations (computed in-memory from already-decrypted data) ≈
**93 decrypts. Target < 400ms.**

---

### 8.4 Weekly Pattern View — `GET /api/views/weekly`

**Wireframe:** W4 | **Scenario:** S6

Returns day-of-week aggregations, sparklines, variance scores, and insights
over a 28+ day range.

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `start` | `YYYY-MM-DD` | Yes | — | Start date |
| `end` | `YYYY-MM-DD` | Yes | — | End date |
| `metrics` | `string` | Yes | — | Comma-separated (1–10) |
| `grant_token` | `string` | No | — | Viewer access token |

**Validation:**

- Date range: minimum 28 days.
- If range < 28 days: return 400 with `INSUFFICIENT_DATA` error.

**Response 200:**

```typescript
interface WeeklyPatternResponse {
  date_range: { start: string; end: string };
  weeks_analyzed: number;

  insights: Insight[];

  heatmap: {
    [metricType: string]: {
      days: {
        [dow: string]: {     // "0" (Sun) through "6" (Sat)
          avg: number;
          stddev: number;
          n: number;
          quartile: 1 | 2 | 3 | 4;
        };
      };
      polarity: "higher_is_better" | "lower_is_better";
    };
  };

  sparklines: {
    [metricType: string]: {
      values: number[];      // 7 values: Sun through Sat
    };
  };

  variance: {
    [metricType: string]: {
      score: number;
      level: "high" | "moderate" | "low";
    };
  };
}
```

**Performance Budget:** 5 metrics × 56 days (8 weeks) = 280 daily decrypts +
5 baseline decrypts ≈ **285 decrypts. Target < 500ms.**

This is the most expensive view in terms of raw data. Mitigation: if the
date range is large (>90 days), consider capping to the most recent 90 days
with a client-side warning.

---

### 8.5 Anomaly Alert View — `GET /api/views/anomaly`

**Wireframe:** W5 | **Scenario:** S7

Returns anomaly score, per-metric deviations, 7-day context sparklines,
historical pattern match, and insights for a single date.

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `date` | `YYYY-MM-DD` | Yes | — | Date to analyze |
| `grant_token` | `string` | No | — | Viewer access token |

**Internal Composition:**

```
1. fetchBaselines(userId, ALL user metrics, referenceDate=date)  → FR-1.4: anchored to view date
2. fetchDailyValues(userId, ALL user metrics, date)
3. computeAnomalyScore(dailyValues, baselines)
4. fetchDailyValues(userId, ALL metrics, date-7..date)     → 7-day context
5. IF anomaly_score >= 3:
   a. Fetch up to 50 past anomaly_events WHERE anomaly_score >= 3
   b. Decrypt deviations_encrypted for each
   c. findHistoricalMatch(currentDeviations, pastEvents)
6. generateInsights("anomaly", { anomaly, summaries, baselines })
7. Assemble response
```

**Response 200:**

```typescript
interface AnomalyResponse {
  date: string;
  anomaly_score: number;
  threshold: number;             // 3

  insights: Insight[];

  deviations: {
    [metricType: string]: {
      value: number;
      avg: number;
      stddev: number;
      z_score: number;
      deviation_magnitude: number;  // |value - avg|
      direction: "above" | "below";
      is_anomalous: boolean;
    };
  };

  context_sparklines: {
    [metricType: string]: {
      dates: string[];           // 7 dates
      values: number[];
      baseline: { avg: number; stddev: number; upper: number; lower: number };
    };
  };

  historical_match: {
    date: string;
    label: string | null;
    similarity: number;
    deviations: {
      [metricType: string]: { value: number };
    };
  } | null;
}
```

**Performance Budget:**

| Step | Decrypt Ops |
|------|-------------|
| Baselines (~10 metrics, cached) | 10 |
| Daily values (10 metrics, 1 day) | 10 |
| 7-day context (10 metrics × 7 days) | 70 |
| Historical match (up to 50 past events) | 50 |
| **Total** | **~140** |

**Target: < 500ms p95.** The historical match step is the variable cost.
Capped at 50 events per §5.6.

---

## 9. Annotation CRUD API

### 9.1 `POST /api/annotations`

Create a manual annotation.

**Auth:** Owner (Clerk session or API key with `health:write` scope)

**Request Body:**

```typescript
const createAnnotationSchema = z.object({
  event_type: z.enum(["meal", "workout", "travel", "alcohol", "medication", "supplement", "custom"]),
  label: z.string().min(1).max(255),
  note: z.string().max(1000).optional(),
  occurred_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
});
```

**Processing:**

1. Validate with Zod.
2. If `ended_at` provided, verify `ended_at > occurred_at`.
3. Encrypt `label` with user's DEK → `label_encrypted`.
4. If `note` provided, encrypt with user's DEK → `note_encrypted`.
5. Insert into `user_annotations`.
6. Emit `annotation.created` audit event.
7. Return the created annotation (with decrypted label/note in response).

**Response 201:**

```json
{
  "data": {
    "id": 42,
    "event_type": "meal",
    "label": "Late dinner",
    "note": "Heavy pasta, red wine",
    "occurred_at": "2026-03-28T21:30:00.000Z",
    "ended_at": null,
    "created_at": "2026-03-28T22:00:00.000Z"
  }
}
```

### 9.2 `GET /api/annotations`

List annotations for a date range.

**Auth:** Owner or Viewer (scoped to grant)

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `start` | `YYYY-MM-DD` | Yes | — | Start date (inclusive) |
| `end` | `YYYY-MM-DD` | Yes | — | End date (inclusive) |
| `event_type` | `string` | No | all | Filter by type |
| `grant_token` | `string` | No | — | Viewer access |

**Processing:**

1. Query `user_annotations` for the date range.
2. For viewers: filter annotations by the event-type-to-metric mapping below.
   Only include annotations whose related metric categories overlap with the
   grant's `allowedMetrics`.
3. Decrypt `label_encrypted` and `note_encrypted` for each row.
4. Also query `health_data_periods` for provider-sourced events (workouts,
   meals from Cronometer, sleep stages) in the same date range.
5. Merge both sources into a unified timeline sorted by `occurred_at`.

**Annotation-to-metric mapping** (for viewer scoping, FR-10.6):

| `event_type` | Related metric categories | Visible to viewer if grant includes any of: |
|--------------|---------------------------|---------------------------------------------|
| `meal` | metabolic, nutrition | `glucose`, `calories_consumed`, any nutrition metric |
| `workout` | activity, cardiovascular | `active_calories`, `steps`, `heart_rate`, `hrv`, `rhr` |
| `travel` | sleep, recovery | `sleep_score`, `readiness_score`, `body_temperature_deviation` |
| `alcohol` | sleep, cardiovascular | `sleep_score`, `hrv`, `rhr`, `deep_sleep`, `rem_sleep` |
| `medication` | all | Any granted metric (medication may affect any metric) |
| `supplement` | all | Any granted metric |
| `custom` | all | Any granted metric |

**Response 200:**

```json
{
  "data": {
    "annotations": [
      {
        "id": 42,
        "source": "user",
        "event_type": "meal",
        "label": "Late dinner",
        "note": "Heavy pasta, red wine",
        "occurred_at": "2026-03-28T21:30:00.000Z",
        "ended_at": null
      },
      {
        "id": null,
        "source": "oura",
        "event_type": "workout",
        "label": "Running",
        "note": null,
        "occurred_at": "2026-03-28T17:00:00.000Z",
        "ended_at": "2026-03-28T17:52:00.000Z"
      }
    ]
  }
}
```

### 9.3 `PATCH /api/annotations/:id`

Update an annotation's label, note, or timestamps.

**Auth:** Owner only.

**Request Body:** Partial update — only fields provided are changed.

```typescript
const updateAnnotationSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  note: z.string().max(1000).nullable().optional(),
  occurred_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().nullable().optional(),
});
```

**Processing:**

1. Verify annotation exists and is owned by the requesting user.
2. Encrypt updated fields.
3. Update row, set `updated_at = NOW()`.
4. Emit `annotation.updated` audit event.

### 9.4 `DELETE /api/annotations/:id`

Delete an annotation.

**Auth:** Owner only.

**Processing:**

1. Verify annotation exists and is owned by the requesting user.
2. Delete the row.
3. Emit `annotation.deleted` audit event.

---

## 10. Anomaly Detection Pipeline

```
  Anomaly Detection: Two Complementary Paths
  ════════════════════════════════════════════

  PATH 1: DAILY CRON (builds historical index)        PATH 2: ON-DEMAND (view endpoint)
  ─────────────────────────────────────────────        ─────────────────────────────────

  Inngest: 0 1 * * * (1 AM UTC)                       GET /api/views/anomaly?date=...
       │                                                    │
       ▼                                                    ▼
  For each user with >= 14 days of data:               Fetch baselines + daily values
       │                                               for requested date
       ▼                                                    │
  Process 8 dates: [today-7 ... today]                      ▼
       │                                               computeAnomalyScore()
       ▼                                               ← always fresh, real-time
  For each date:                                            │
  ┌────────────────────────────────┐                        ▼
  │ Fetch baselines + daily values │                   IF score >= 3:
  │ computeAnomalyScore()          │                     Fetch past anomaly_events
  │                                │                     Decrypt deviations
  │ IF score >= 3:                 │                     findHistoricalMatch()
  │   findHistoricalMatch()        │                        │
  │   Encrypt deviations           │                        ▼
  │   Upsert anomaly_events ──────────────────────┐    Return to user
  │                                │               │    (never persisted
  │ IF score < 3:                  │               │     by view endpoint)
  │   Delete stale row if exists   │               │
  └────────────────────────────────┘               │
                                                   │
                                          ┌────────▼─────────┐
                                          │  anomaly_events   │
                                          │  table            │
                                          │                   │
                                          │  Historical index │
                                          │  for cosine       │
                                          │  similarity       │
                                          │  matching         │
                                          └───────────────────┘
```

### 10.1 Daily Cron Job: `dashboard/anomalies.detect`

```typescript
export const anomaliesDetect = inngest.createFunction(
  {
    id: "dashboard/anomalies.detect",
    name: "Dashboard Anomaly Detection",
    concurrency: [{ limit: 5 }],
    retries: 3,
  },
  { cron: "0 1 * * *" },  // 1:00 AM UTC daily (after baselines refresh)
  async ({ step }) => { ... }
);
```

**Processing (per user):**

Per FR-6.5, the cron processes the current day **and the past 7 days** to
provide context and catch any dates missed due to late-arriving data.

```
1. Query all users with >= 14 days of health data
2. For each user (batched, 50 at a time):
   a. Fetch cached baselines for today
   b. For each date in [today - 7 ... today]:
      i.   Fetch daily values for this date
      ii.  computeAnomalyScore(values, baselines)
      iii. IF anomaly_score >= 3:
           - Fetch past anomaly_events (up to 50, WHERE anomaly_score >= 3)
           - Decrypt each past event's deviations_encrypted
           - findHistoricalMatch(current, pastEvents)
           - Encrypt current deviations → deviations_encrypted
           - Upsert into anomaly_events
      iv.  IF anomaly_score < 3 AND a row exists for this date:
           Delete it (false alarm from stale or corrected data)
```

**Dependency:** Runs after baselines refresh (`0 */6 * * *` at :30) to ensure
fresh baselines are available. Scheduled at 1:00 AM to process data after
overnight syncs complete.

### 10.2 Anomaly History API

```
GET /api/anomalies
```

**Auth:** Owner only.

List past anomaly events for the user, ordered by date descending. Provides a
browsable history of detected anomalies with user-assigned labels.

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `start` | `YYYY-MM-DD` | No | 90 days ago | Start date |
| `end` | `YYYY-MM-DD` | No | today | End date |
| `min_score` | `integer` | No | 3 | Minimum anomaly score to include |
| `cursor` | `string` | No | — | Pagination cursor |
| `limit` | `integer` | No | 20 | Results per page (max 50) |

**Processing:**

1. Query `anomaly_events` for `(userId, date range, anomaly_score >= min_score)`.
2. For each row: decrypt `deviations_encrypted` and `user_label_encrypted`.
3. Return paginated results.

**Response 200:**

```json
{
  "data": [
    {
      "date": "2026-03-28",
      "anomaly_score": 5,
      "label": "flu onset",
      "deviations": {
        "rhr": { "value": 72, "avg": 59, "z_score": 2.6, "direction": "above" },
        "hrv": { "value": 22, "avg": 44, "z_score": -2.2, "direction": "below" }
      },
      "pattern_match_date": "2026-01-12",
      "pattern_match_similarity": 0.94,
      "created_at": "2026-03-29T01:00:00.000Z"
    }
  ],
  "pagination": {
    "next_cursor": "...",
    "has_more": true
  }
}
```

### 10.3 Anomaly Label API

```
PATCH /api/anomalies/:date/label
```

**Auth:** Owner only.

**Request Body:**

```typescript
const labelAnomalySchema = z.object({
  label: z.string().max(255),
});
```

**Processing:**

1. Find `anomaly_events` row for `(userId, date)`.
2. Encrypt `label` → `user_label_encrypted`.
3. Update the row.
4. Emit `anomaly.labeled` audit event.

---

## 11. Insight Dismissal API

```
POST /api/insights/:type/:date/dismiss
```

**Auth:** Owner only.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `type` | `string` | Insight type ID (e.g., `elevated_rhr`) |
| `date` | `YYYY-MM-DD` | The date context of the insight |

**Processing:**

1. Validate `type` is a known insight type.
2. Upsert into `dismissed_insights` (idempotent).
3. Return 200.

**Response 200:**

```json
{
  "data": {
    "insight_type": "elevated_rhr",
    "date": "2026-03-28",
    "dismissed": true
  }
}
```

---

## 12. Share Grant Extensions

### 12.1 Extended Create Flow

The `POST /api/shares` endpoint is extended with optional `view_type` and
`view_params` fields:

```typescript
const createShareSchema = z.object({
  // ... existing fields unchanged ...
  label: z.string().min(1).max(255),
  allowed_metrics: z.array(z.string().refine(isValidMetricType)).min(1).max(56),
  data_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expires_in_days: z.number().int().min(1).max(365),
  note: z.string().max(1000).optional(),

  // New fields
  view_type: z.enum(["night", "recovery", "trend", "weekly", "anomaly", "custom"]).default("custom"),
  view_params: z.object({
    smoothing: z.enum(["none", "7d", "30d"]).optional(),
    correlations: z.array(z.tuple([z.string(), z.string()])).max(5).optional(),
    triggering_event_id: z.number().optional(),
    time_range: z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
  }).optional(),
});
```

**Processing changes:**

1. If `view_params` provided, encrypt as JSON → `view_params_encrypted`.
2. Store `view_type` as plaintext column.
3. All other processing unchanged.

### 12.2 Viewer Routing

```
  Viewer Navigation (D-3: free navigation within scope)
  ═════════════════════════════════════════════════════

  Share Grant:
  ┌────────────────────────────────────────────────────────┐
  │  allowed_metrics: [rhr, hrv, sleep_score]              │
  │  data_start: 2026-02-27    data_end: 2026-03-28        │
  │  view_type: "trend"   ← default landing                │
  └──────────────────────────┬─────────────────────────────┘
                             │
  Doctor opens share link    │
                             ▼
  ┌──────────────────────────────────────────────────────────┐
  │                     Viewer Dashboard                      │
  │                                                          │
  │   Landing view (from view_type):                         │
  │   ┌──────────────────────────────────────────────┐       │
  │   │ 30-Day Trend View (rhr, hrv, sleep_score)    │       │
  │   │ Feb 27 – Mar 28                               │       │
  │   └──────────────────────────────────────────────┘       │
  │              │                                           │
  │              │ Doctor clicks on March 15                  │
  │              │ to drill into that night                   │
  │              ▼                                           │
  │   ┌──────────────────────────────────────────────┐       │
  │   │ Night Detail View (rhr, hrv, sleep_score)    │  OK   │
  │   │ March 15 (within granted date range)          │       │
  │   └──────────────────────────────────────────────┘       │
  │              │                                           │
  │              │ Doctor tries to view weight data           │
  │              ▼                                           │
  │   ┌──────────────────────────────────────────────┐       │
  │   │ weight not in allowed_metrics                │ DENIED│
  │   │ enforcePermissions() filters it out          │       │
  │   └──────────────────────────────────────────────┘       │
  │                                                          │
  │   Security boundary = metrics + date range               │
  │   NOT the view type                                      │
  └──────────────────────────────────────────────────────────┘
```

When a viewer opens `/v/[token]`:

1. Token is validated, viewer session cookie is set (existing flow).
2. The frontend reads the grant's `view_type` to determine the landing view.
3. The viewer can navigate to any other view within the granted
   metrics and date range.
4. View endpoints use `enforcePermissions()` to scope data regardless of
   which view the viewer is on.

The backend does not enforce view-type locking. The `view_type` field is a
routing hint for the frontend only.

### 12.3 PDF Export Data Contract (Future)

PDF export is not in scope for this LLD. When implemented, it will:

1. Call the same view endpoints (`/api/views/*`) to get structured data.
2. Render the data into a PDF layout (frontend/service concern).
3. Optionally use a `format=pdf` query parameter on view endpoints to receive
   a PDF-optimized response (e.g., pre-rendered SVG chart data).

The view endpoint response contracts defined in this LLD are designed to be
format-agnostic. They provide structured data that can be consumed by
interactive charts, PDF renderers, or any other format.

---

## 13. Background Jobs Summary

### 13.1 New Inngest Functions

| Function ID | Schedule | Purpose | Priority |
|-------------|----------|---------|----------|
| `dashboard/baselines.refresh` | Cron `30 */6 * * *` + event-triggered | Compute and cache encrypted baselines | P0 |
| `dashboard/baselines.refresh.user` | Event-triggered (after sync) | Refresh baselines for a single user | P0 |
| `dashboard/anomalies.detect` | Cron `0 1 * * *` | Run anomaly detection, persist results | P2 |

### 13.2 Registration

Add to `/src/app/api/inngest/route.ts`:

```typescript
import { baselinesRefresh, baselinesRefreshUser } from "@/inngest/functions/baselines-refresh";
import { anomaliesDetect } from "@/inngest/functions/anomalies-detect";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Existing
    syncSweep,
    syncConnection,
    syncInitial,
    syncManual,
    tokenRefresh,
    partitionEnsure,
    // New
    baselinesRefresh,
    baselinesRefreshUser,
    anomaliesDetect,
  ],
});
```

### 13.3 Event Definitions

Add to `/src/inngest/client.ts` Events type:

```typescript
"dashboard/baselines.refresh": {};                            // Cron trigger
"dashboard/baselines.refresh.user": { data: { userId: string } };  // Per-user trigger
"dashboard/anomalies.detect": {};                             // Cron trigger
```

---

## 14. Shared Type Definitions

### 14.1 Common Types (`/src/lib/dashboard/types.ts`)

```typescript
export type ViewType = "night" | "recovery" | "trend" | "weekly" | "anomaly";

export interface BaselinePayload {
  avg_30d: number;
  stddev_30d: number;
  upper: number;
  lower: number;
  sample_count: number;
}

export interface SummaryMetric {
  value: number;
  avg_30d: number;
  stddev_30d: number;
  delta: number;
  delta_pct: number;
  direction: "better" | "worse" | "neutral";
  status: "critical" | "warning" | "normal" | "good";
}

export interface Annotation {
  id: number | null;              // null for provider-sourced events
  source: "user" | string;        // "user" or provider name
  event_type: string;
  label: string;
  note: string | null;
  occurred_at: string;            // ISO timestamp
  ended_at: string | null;
}

export interface Insight {
  type: string;
  title: string;
  body: string;
  related_metrics: string[];
  severity: "info" | "warning";
  dismissible: boolean;
}

export interface TrendResult {
  direction: "rising" | "falling" | "stable";
  start_value: number;
  end_value: number;
  change_pct: number;
  change_abs: number;
}

export interface CorrelationResult {
  pair: [string, string];
  coefficient: number;
  strength: "strong" | "moderate" | "weak";
  direction: "positive" | "inverse";
  sample_count: number;
  sufficient_data: boolean;
}
```

### 14.2 Metric Polarity Configuration

```typescript
// /src/config/metric-polarity.ts

export const METRIC_POLARITY: Record<string, "higher_is_better" | "lower_is_better" | "neutral"> = {
  // Higher is better
  hrv: "higher_is_better",
  sleep_score: "higher_is_better",
  readiness_score: "higher_is_better",
  sleep_efficiency: "higher_is_better",
  deep_sleep: "higher_is_better",
  rem_sleep: "higher_is_better",
  spo2: "higher_is_better",
  activity_score: "higher_is_better",

  // Lower is better
  rhr: "lower_is_better",
  sleep_latency: "lower_is_better",
  respiratory_rate: "lower_is_better",
  awake_time: "lower_is_better",

  // Context-dependent
  weight: "neutral",
  steps: "neutral",
  active_calories: "neutral",
  total_calories: "neutral",
  body_temperature_deviation: "neutral",
  glucose: "neutral",
};
```

---

## 15. Migration Strategy

### 15.1 Migration File

A single Drizzle migration file: `0003_dashboard_tables.sql`.

**Contents:**

1. `CREATE TABLE metric_baselines` (§3.1)
2. `CREATE TABLE anomaly_events` (§3.2)
3. `CREATE TABLE user_annotations` (§3.3)
4. `CREATE TABLE dismissed_insights` (§3.4)
5. `ALTER TABLE share_grants ADD COLUMN view_type ...` (§3.5)
6. `ALTER TABLE share_grants ADD COLUMN view_params_encrypted ...` (§3.5)
7. All indexes from §3.1–3.4

**Rollback:** All changes are additive (new tables, new nullable columns).
Rollback = drop the new tables, drop the new columns. No data loss to existing
functionality.

### 15.2 Execution

```bash
# Generate migration from schema changes
pnpm db:generate

# Review generated SQL
cat drizzle/0003_dashboard_tables.sql

# Apply to database
pnpm db:push
```

### 15.3 Backfill

After migration, run a one-time backfill to populate `metric_baselines` for
all existing users:

```typescript
// Triggered manually or via one-time Inngest event
await inngest.send({ name: "dashboard/baselines.refresh" });
```

This runs the same baseline computation job as the daily cron, but for all
users. Expected duration: depends on user count and data volume.

---

## 16. Performance Analysis

### 16.1 Encryption Budget Per View

```
  Decrypt Operations per View (lower is faster)
  ══════════════════════════════════════════════

  Night (W1)     ████████████████████████████████████████████████████  ~1030 ops  <500ms
                 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 intraday series dominates (~1000 HR/glucose pts)

  Weekly (W4)    ██████████████                                       ~285 ops   <500ms
                 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                 56 days × 5 metrics

  Anomaly (W5)   ███████                                              ~140 ops   <500ms
                 ▓▓▓▓▓▓▓
                 7-day context + 50 historical matches

  Trend (W3)     █████                                                ~93 ops    <400ms
                 ▓▓▓▓▓
                 30 days × 3 metrics

  Recovery (W2)  ███                                                  ~60 ops    <300ms
                 ▓▓▓
                 7 days × 5 metrics + annotations

  Legend:  █ = daily/series data    ▓ = baselines + other
```

| View | Daily Decrypts | Series Decrypts | Baseline Decrypts | Other Decrypts | Total | Target |
|------|---------------|-----------------|-------------------|----------------|-------|--------|
| Night (W1) | 5 | ~1000 | 5 | ~20 (annotations) | ~1030 | < 500ms |
| Recovery (W2) | 35 | 0 | 5 | ~20 | ~60 | < 300ms |
| Trend (W3) | 90 | 0 | 3 | 0 | ~93 | < 400ms |
| Weekly (W4) | 280 | 0 | 5 | 0 | ~285 | < 500ms |
| Anomaly (W5) | 80 | 0 | 10 | ~50 (history) | ~140 | < 500ms |

### 16.2 Bottleneck Analysis

**Night view** is the most expensive due to intraday series. Mitigations:
- Downsample series to 5-minute intervals (reduce ~1000 to ~120 decrypts)
- Stream decryption using `Promise.all()` with concurrency limit (e.g., 50)

**Weekly view** has the most daily data decrypts. Mitigations:
- Cap analysis window at 90 days even if more data exists
- For 8-week view: 56 days × 5 metrics = 280 decrypts (acceptable)

### 16.3 Future Optimization: Batch DEK Decryption

The current encryption implementation generates a unique DEK per blob. In
production with AWS KMS, each blob requires a separate `kms:Decrypt` call to
unwrap its DEK. A future optimization would use a **shared DEK per encryption
batch** (e.g., all rows written in a single sync operation share one DEK),
reducing KMS calls from N to 1 per batch on read. This is out of scope for
this LLD but should be considered for production scaling.

---

## 17. Audit Events

### 17.1 New Event Types

| Event Type | Trigger | Resource Type |
|------------|---------|---------------|
| `view.accessed` | Any view endpoint call | `dashboard_view` |
| `annotation.created` | POST /api/annotations | `annotation` |
| `annotation.updated` | PATCH /api/annotations/:id | `annotation` |
| `annotation.deleted` | DELETE /api/annotations/:id | `annotation` |
| `anomaly.labeled` | PATCH /api/anomalies/:date/label | `anomaly_event` |
| `insight.dismissed` | POST /api/insights/:type/:date/dismiss | `insight` |

### 17.2 View Access Audit Detail

```typescript
// resource_detail for view.accessed events:
{
  view_type: "night",
  date: "2026-03-28",                    // or date_range for multi-day views
  metrics_requested: ["rhr", "hrv", "sleep_score"],
  metrics_returned: ["rhr", "hrv", "sleep_score"],
  data_points_returned: 1035,
  insights_generated: 2,
}
```

---

## 18. Priority & Phasing

```
  Implementation Roadmap
  ══════════════════════

  P0: MVP Dashboard                P1: Launch Features           P2: Post-Launch
  ─────────────────                ────────────────────           ──────────────
  ┌──────────────────┐             ┌──────────────────┐          ┌──────────────────┐
  │ metric_baselines │             │ Correlations     │          │ anomaly_events   │
  │ table + cron job │             │ (in-memory       │          │ table + cron job │
  │                  │             │  Pearson)        │          │                  │
  │ user_annotations │             │                  │          │ Historical       │
  │ table + CRUD API │             │ Trend detection  ��          │ pattern matching │
  │                  │             │                  │          │ (cosine sim)     │
  │ dismissed_       │             │ P1 insight rules │          │                  │
  │ insights table   │             │ (cross-metric)   │          │ Weekly pattern   │
  │                  │             │                  │          │ computation      │
  │ Night view       │             │ Share grant      │          │                  │
  │ Recovery view    │             │ extensions       │          │ Anomaly view     │
  │ Trend view       │             │ (view_type,      │          │ endpoint         │
  │                  │             │  view_params)    │          │                  │
  │ Summary metrics  │             │                  │          │ Anomaly label    │
  │ Rolling averages │             │ Weekly Pattern   │          │ + history API    │
  │ P0 insight rules │             │ view endpoint    │          │                  │
  │                  │             │                  │          │                  │
  │ Zod response     │             │                  │          │                  │
  │ contracts        │             │                  │          │                  │
  └──────────────────┘             └──────────────────┘          └──────────────────┘

  Dependencies:
  P0 baselines ──────► P1 correlations use decrypted data from P0 layer
  P0 view endpoints ──► P1 share extensions add viewer routing
  P0 + P1 ───────────► P2 anomaly detection builds on baselines + all metrics
```

### P0 — MVP Dashboard (ship first)

| Requirement | Component | Effort |
|-------------|-----------|--------|
| FR-1, TR-1 | Baselines: table, background job, encrypted cache | Medium |
| FR-2 | Summary metrics with deltas | Small |
| FR-5 | Rolling averages (computed in view handler) | Small |
| FR-10, TR-4 | Annotations: table, CRUD API, encryption | Medium |
| FR-11, TR-6 | Night + Recovery + Trend view endpoints | Large |
| TR-10 | Zod response schemas | Small |
| — | Migration (0003_dashboard_tables.sql) | Small |
| — | P0 insight rules (threshold-based) | Small |

### P1 — Launch Features

| Requirement | Component | Effort |
|-------------|-----------|--------|
| FR-3, TR-2 | Correlations (in-memory Pearson) | Small |
| FR-4 | Trend detection (in-memory) | Small |
| FR-9, TR-5 | Insight engine: P1 cross-metric rules | Medium |
| FR-9 (D-7) | LLM-generated narratives for P1 insights (Addendum A) | Medium |
| FR-12, TR-9 | Share grant extensions (view_type, view_params) | Small |
| — | Weekly Pattern view endpoint | Medium |

### P2 — Post-Launch

| Requirement | Component | Effort |
|-------------|-----------|--------|
| FR-6, FR-7, TR-3 | Anomaly detection: cron job, historical matching | Large |
| FR-8, TR-7 | Weekly pattern computation | Medium |
| — | Anomaly view endpoint | Medium |
| — | Anomaly label API | Small |

---

## 19. Acceptance Criteria

- [ ] `metric_baselines` table created and populated by background job
- [ ] All baseline values encrypted with user's DEK
- [ ] All annotation labels and notes encrypted
- [ ] All anomaly deviation data encrypted
- [ ] Night detail endpoint returns complete data in < 500ms p95
- [ ] Recovery endpoint returns complete data in < 300ms p95
- [ ] Trend endpoint returns complete data in < 400ms p95
- [ ] Weekly endpoint returns complete data in < 500ms p95
- [ ] Anomaly endpoint returns complete data in < 500ms p95
- [ ] Each view endpoint returns all data needed in a single HTTP request
- [ ] Baseline bands (avg ± 1 SD) available on every metric
- [ ] Summary metrics show delta with correct polarity
- [ ] Rolling averages computed correctly with gap handling
- [ ] Correlations verified against manual calculation
- [ ] Annotations CRUD functional with encryption
- [ ] Insight cards display when conditions are met and can be dismissed
- [ ] Viewer access works on all view endpoints with proper scoping
- [ ] All view endpoints emit `view.accessed` audit events
- [ ] Baselines refresh after data sync
- [ ] Anomaly cron detects multi-metric deviations correctly
- [ ] Historical pattern match returns most similar past anomaly
- [ ] Share grants support `view_type` field

---

## 20. Open Items & Future Work

| Item | Status | Notes |
|------|--------|-------|
| PDF export from view endpoints | Deferred | Needs product design for export dialog, view selection, layout |
| Batch DEK optimization | Deferred | Shared DEK per sync batch would reduce KMS calls 10-50x on reads |
| Series downsampling strategy | Deferred | Night view may need 5-min intervals instead of raw for performance |
| Notification system for anomalies | Deferred | Push/email when anomaly_score >= threshold |
| Insight rule testing framework | Deferred | Unit test harness for rule evaluation with fixture data |
| Baseline cache eviction | Deferred | Purge stale baselines for deleted metrics or inactive users |
| LLM insight prompt tuning | P1 | Iterate on system prompt with real user data to improve narrative quality |
| LLM insight A/B testing | Deferred | Compare user engagement with template vs. LLM-generated insights |

---

## Addendum A: LLM-Powered Insight Narratives

### A.1 Overview

P1 cross-metric insights (sleep disruption, recovery arc, weekly rhythm, trend
alert) involve complex multi-metric relationships that are difficult to express
in hardcoded templates. Instead of templates, these insights use **Claude Haiku
4.5** to generate natural-language narratives from the structured context that
the rule engine already produces.

P0 simple threshold insights (elevated RHR, low sleep score, suppressed HRV)
remain template-based — they are single-metric observations where a template
like "Your RHR was {delta} bpm above average" is perfectly adequate.

```
  Which insights use which generation strategy
  ═════════════════════════════════════════════

  P0 INSIGHTS (template-based)                P1 INSIGHTS (LLM-generated)
  ────────────────────────────                ──────────────────────────

  elevated_rhr                                sleep_disruption
  low_sleep_score                             recovery_arc
  suppressed_hrv                              weekly_rhythm
  multi_metric_deviation                      trend_alert

  Rule fires                                  Rule fires
       │                                           │
       ▼                                           ▼
  Template string                             Structured context
  interpolation                               (InsightGenerationInput)
  "{metric} was {value},                           │
   {delta} {direction}                             ▼
   your 30-day avg"                          ┌─────────────────┐
       │                                     │  Claude Haiku    │
       ▼                                     │  4.5             │
  Insight.body                               │  ~300-500ms      │
  (instant)                                  │  ~$0.002/call    │
                                             └────────┬────────┘
                                                      │
                                                      ▼
                                             Insight.body
                                             (natural, contextual)

  Example:                                   Example:
  "Your resting HR was 72 bpm,               "Your resting heart rate stayed
   11 bpm above your 30-day                   elevated all night at 72 bpm —
   average of 61 bpm."                        11 beats above your usual 61.
                                              A glucose spike around 9:45 PM
                                              from the late meal may have
                                              played a role, as your sleep
                                              took nearly 3x longer to start."
```

### A.2 Architecture: Synchronous Call with Encrypted Cache

```
  View Endpoint Request
       │
       ▼
  Rule engine evaluates P1 rules
       │
       ├── No rule fires → skip (no insight)
       │
       └── Rule fires → produces InsightGenerationInput
                │
                ▼
       ┌──────────────────────────────────────────┐
       │  Check insight_cache                      │
       │  Key: (user_id, insight_type,             │
       │        reference_date, data_hash)         │
       └──────────────┬───────────────────────────┘
                      │
                 ┌────┴────┐
              HIT│         │MISS
                 │         │
                 ▼         ▼
          ┌──────────┐  ┌──────��────────────────────┐
          │ Decrypt  │  │ Call Claude Haiku 4.5      │
          │ cached   │  │                            │
          │ title +  │  │ Input: structured context  │
          │ body     │  │ System: health narrator    │
          │          │  │ Output: { title, body }    │
          │ (fast,   │  │                            │
          │  ~5ms)   │  │ (~300-500ms, shown as     │
          │          │  │  loading spinner on        │
          └────┬─────┘  │  insight card)             │
               │        └─────────────┬─────────────┘
               │                      │
               │                      ▼
               │               ┌─────────────────┐
               │               │ Encrypt title +  │
               │               │ body with DEK    │
               │               │                  │
               │               │ Upsert into      │
               │               │ insight_cache    │
               │               └────────┬─────────┘
               │                        │
               ▼                        ▼
          Return Insight in view response
          (body field contains LLM-generated text)
```

**Why synchronous, not async?** The user sees a loading spinner on the insight
card while Haiku generates (~300-500ms). This is acceptable because:

1. Insight cards are visually distinct from chart data — a brief spinner there
   does not block the rest of the view from rendering.
2. The generated text is cached immediately, so subsequent views are instant.
3. An async approach would show a weaker template first, creating a "content
   shift" when the LLM version replaces it — worse UX than a brief spinner.

### A.3 `insight_cache` Table

Stores encrypted LLM-generated insight text, keyed by user + insight type +
date + data hash. The `data_hash` ensures stale insights are never shown when
underlying data changes.

```sql
CREATE TABLE insight_cache (
  user_id         VARCHAR(64)   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insight_type    VARCHAR(64)   NOT NULL,
  reference_date  DATE          NOT NULL,
  data_hash       VARCHAR(64)   NOT NULL,
  title_encrypted BYTEA         NOT NULL,
  body_encrypted  BYTEA         NOT NULL,
  model_id        VARCHAR(64)   NOT NULL,
  generated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_insight_cache
    PRIMARY KEY (user_id, insight_type, reference_date)
);

CREATE INDEX idx_insight_cache_user_date
  ON insight_cache (user_id, reference_date);
```

**Column details:**

| Column | Encrypted | Rationale |
|--------|-----------|-----------|
| `title_encrypted` | Yes (BYTEA) | Contains health-derived text ("Elevated heart rate after late meal") |
| `body_encrypted` | Yes (BYTEA) | Contains specific health values and narrative |
| `data_hash` | No (VARCHAR) | SHA-256 of the `InsightGenerationInput` — no health content, just a fingerprint |
| `model_id` | No (VARCHAR) | Tracks which model version generated the text (for cache invalidation on model upgrades) |

**Cache invalidation:**

- **Data changes:** When underlying health data changes (e.g., late-arriving
  sync corrects a value), the `data_hash` of the `InsightGenerationInput` will
  differ. The cache lookup misses, triggering a fresh LLM call.
- **Model upgrades:** When upgrading to a new Haiku version, bump the
  `model_id` check. Old cached entries with a different `model_id` are treated
  as misses, allowing gradual regeneration.
- **TTL:** No time-based expiration. Insights for historical dates never
  change unless the underlying data changes. The `data_hash` handles staleness.
- **Eviction:** Rows older than 90 days can be pruned by a periodic cleanup
  job. They'll be regenerated on-demand if the user revisits that date.

**Drizzle schema** (`/src/db/schema/insight-cache.ts`):

```typescript
import { pgTable, varchar, date, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types";
import { users } from "./users";

export const insightCache = pgTable("insight_cache", {
  userId: varchar("user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  insightType: varchar("insight_type", { length: 64 }).notNull(),
  referenceDate: date("reference_date").notNull(),
  dataHash: varchar("data_hash", { length: 64 }).notNull(),
  titleEncrypted: bytea("title_encrypted").notNull(),
  bodyEncrypted: bytea("body_encrypted").notNull(),
  modelId: varchar("model_id", { length: 64 }).notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.insightType, table.referenceDate] }),
  index("idx_insight_cache_user_date")
    .on(table.userId, table.referenceDate),
]);
```

### A.4 `InsightGenerationInput` — Structured Context for the LLM

The rule engine produces this object when a P1 rule fires. It contains
everything the LLM needs to write the narrative — **no raw data querying or
computation happens inside the LLM call**.

```typescript
interface InsightGenerationInput {
  // Identity
  insight_type: string;          // "sleep_disruption", "recovery_arc", etc.
  view_type: ViewType;
  date: string;                  // YYYY-MM-DD

  // Pre-computed facts from the rule engine
  primary_metrics: {
    metric: string;              // "rhr"
    value: number;               // 72
    avg_30d: number;             // 61
    delta: number;               // +11
    delta_pct: number;           // +18%
    unit: string;                // "bpm"
    status: string;              // "critical"
    direction: string;           // "worse"
  }[];

  // Contextual events (if relevant to this insight)
  annotations?: {
    type: string;                // "meal"
    label: string;               // "Late dinner"
    time: string;                // "9:30 PM"
  }[];

  // Correlation context (if available)
  correlations?: {
    pair: [string, string];
    coefficient: number;
    strength: string;
  }[];

  // Recovery context (for recovery_arc insights)
  recovery?: {
    triggering_event: string;    // "10K run"
    days_to_recovery: number;    // 3
    metrics_recovered: string[]; // ["hrv", "readiness_score"]
  };

  // Weekly pattern context (for weekly_rhythm insights)
  weekly_pattern?: {
    best_day: string;            // "Wednesday"
    worst_day: string;           // "Monday"
    variance_level: string;      // "high"
    pattern_metrics: string[];   // ["readiness_score", "sleep_score"]
  };
}
```

**Data hash computation:**

```typescript
function computeInsightDataHash(input: InsightGenerationInput): string {
  // Deterministic JSON serialization (sorted keys) → SHA-256
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
```

### A.5 Prompt Design

The system prompt constrains the LLM to produce factual, conversational
health narratives without medical advice.

```typescript
const INSIGHT_SYSTEM_PROMPT = `You are a health data narrator for Totus, a personal health dashboard.
Your job is to turn structured metric data into a clear, conversational 2-3 sentence insight.

Rules:
- State FACTS only. Reference specific numbers and the user's personal baseline.
- Never diagnose conditions, suggest treatments, or give medical advice.
- If an annotation (meal, workout, travel) temporally precedes a metric change, note the
  relationship using language like "preceded by" or "followed by" — never assert causation.
- Write as if explaining to a friend who understands their own body but isn't a doctor.
- Keep the TITLE under 60 characters.
- Keep the BODY under 500 characters.
- Do not use emoji.
- Do not use bullet points or lists — write in prose.
- Use the metric's unit (bpm, ms, hr, min, %, etc.) when referencing values.

Respond with JSON only:
{ "title": "...", "body": "..." }`;
```

**User prompt (per insight):**

```typescript
function buildInsightPrompt(input: InsightGenerationInput): string {
  return `Generate an insight for this health data:\n\n${JSON.stringify(input, null, 2)}`;
}
```

**Model configuration:**

```typescript
const INSIGHT_MODEL_CONFIG = {
  model: "claude-haiku-4-5-20251001",
  max_tokens: 200,
  temperature: 0.3,   // Low temperature for consistent, factual output
};
```

`temperature: 0.3` balances slight wording variation (so insights don't feel
robotic) with consistency (so the same data produces similar narratives).

### A.6 Integration with View Endpoints

The insight generation step in the view endpoint flow (§7.3 step 5) is
modified for P1 rules:

```typescript
// In the view endpoint handler, after computing derived data:

async function generateInsights(
  viewType: ViewType,
  ctx: InsightContext,
  userId: string,
  referenceDate: string,
): Promise<Insight[]> {
  const insights: Insight[] = [];

  for (const rule of INSIGHT_RULES) {
    if (!rule.viewTypes.includes(viewType)) continue;
    if (ctx.dismissedTypes.has(rule.id)) continue;
    if (insights.length >= MAX_INSIGHTS_PER_VIEW) break;

    const result = rule.evaluate(ctx);
    if (!result) continue;

    if (rule.generation === "template") {
      // P0: use template-based text directly
      insights.push(result);
    } else if (rule.generation === "llm") {
      // P1: generate or retrieve cached LLM narrative
      const input = rule.buildGenerationInput(ctx);
      const narrative = await getOrGenerateNarrative(userId, rule.id, referenceDate, input);
      insights.push({
        ...result,
        title: narrative.title,
        body: narrative.body,
      });
    }
  }

  return insights;
}
```

The `getOrGenerateNarrative` function handles the cache-first logic:

```typescript
async function getOrGenerateNarrative(
  userId: string,
  insightType: string,
  referenceDate: string,
  input: InsightGenerationInput,
): Promise<{ title: string; body: string }> {
  const dataHash = computeInsightDataHash(input);

  // 1. Check cache
  const cached = await db.select()
    .from(insightCache)
    .where(and(
      eq(insightCache.userId, userId),
      eq(insightCache.insightType, insightType),
      eq(insightCache.referenceDate, referenceDate),
      eq(insightCache.dataHash, dataHash),
      eq(insightCache.modelId, INSIGHT_MODEL_CONFIG.model),
    ))
    .limit(1);

  if (cached.length > 0) {
    // Cache hit — decrypt and return
    const title = await encryption.decrypt(cached[0].titleEncrypted, userId);
    const body = await encryption.decrypt(cached[0].bodyEncrypted, userId);
    return { title: title.toString(), body: body.toString() };
  }

  // 2. Cache miss — call Haiku
  const response = await anthropic.messages.create({
    ...INSIGHT_MODEL_CONFIG,
    system: INSIGHT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildInsightPrompt(input) }],
  });

  const generated = JSON.parse(response.content[0].text) as { title: string; body: string };

  // 3. Encrypt and cache
  const titleEnc = await encryption.encrypt(Buffer.from(generated.title), userId);
  const bodyEnc = await encryption.encrypt(Buffer.from(generated.body), userId);

  await db.insert(insightCache)
    .values({
      userId,
      insightType,
      referenceDate,
      dataHash,
      titleEncrypted: titleEnc,
      bodyEncrypted: bodyEnc,
      modelId: INSIGHT_MODEL_CONFIG.model,
    })
    .onConflictDoUpdate({
      target: [insightCache.userId, insightCache.insightType, insightCache.referenceDate],
      set: {
        dataHash,
        titleEncrypted: titleEnc,
        bodyEncrypted: bodyEnc,
        modelId: INSIGHT_MODEL_CONFIG.model,
        generatedAt: new Date(),
      },
    });

  return generated;
}
```

### A.7 Error Handling and Fallback

If the Haiku call fails (timeout, rate limit, API error), the insight falls
back to a simple template-based version. The user still sees the insight — just
with less polished wording.

```typescript
try {
  const narrative = await getOrGenerateNarrative(userId, rule.id, referenceDate, input);
  insights.push({ ...result, title: narrative.title, body: narrative.body });
} catch (error) {
  console.error(`LLM insight generation failed for ${rule.id}:`, error);
  // Fall back to the template-based result from rule.evaluate()
  insights.push(result);
}
```

**Timeout:** The Haiku call has a 3-second timeout. If it exceeds this, the
template fallback fires. The cache is not populated, so the next request will
retry the LLM call.

### A.8 Cost Analysis

| Scale | Users | Insights/day | Cache hit rate | LLM calls/day | Monthly cost |
|-------|-------|-------------|----------------|---------------|--------------|
| MVP | 500 | ~2,500 | ~80% (after warm-up) | ~500 | ~$1-3 |
| Launch | 5,000 | ~25,000 | ~85% | ~3,750 | ~$10-25 |
| Growth | 50,000 | ~250,000 | ~90% | ~25,000 | ~$75-150 |

**Assumptions:**
- ~5 insight-eligible views per user per day (across all view types)
- P1 rules fire on ~10% of views (most days are "normal")
- Cache hit rate improves over time as users revisit recent dates
- Cost per Haiku call: ~$0.002 (200 input tokens + 150 output tokens)

### A.9 Security Considerations

1. **No raw health data in the prompt.** The `InsightGenerationInput` contains
   aggregated metrics (averages, deltas, z-scores) and annotation labels — not
   raw time-series data or encrypted blobs. The LLM never sees the user's full
   health history.

2. **Generated text is encrypted at rest.** The `title_encrypted` and
   `body_encrypted` columns use the same envelope encryption as all health
   data (D-2).

3. **No PII in the prompt.** The input contains metric values and event labels,
   not user names, email addresses, or account identifiers.

4. **Anthropic API data policy.** Per Anthropic's API terms, data sent via the
   API is not used for model training. No opt-out required.

5. **Viewer access.** LLM-generated insights are included in viewer responses
   (same as template insights) — scoped to the granted metrics. If a viewer's
   grant doesn't include a metric referenced in the insight, the insight is
   filtered out.

### A.10 `InsightRule` Interface Extension

The `InsightRule` interface from §6.1 is extended with two new fields for P1
rules:

```typescript
interface InsightRule {
  id: string;
  viewTypes: ViewType[];
  priority: number;
  generation: "template" | "llm";              // NEW: which strategy to use
  evaluate: (ctx: InsightContext) => Insight | null;
  buildGenerationInput?: (ctx: InsightContext)  // NEW: only for generation="llm"
    => InsightGenerationInput;
}
```

P0 rules set `generation: "template"` and do not implement
`buildGenerationInput`. P1 rules set `generation: "llm"` and implement both
`evaluate` (for the template fallback) and `buildGenerationInput` (for the
LLM path).

### A.11 Migration

The `insight_cache` table is added in the same migration as the other dashboard
tables (`0003_dashboard_tables.sql`) or in a follow-up migration if P1 ships
after P0.

The Anthropic SDK dependency (`@anthropic-ai/sdk`) is added to the web app's
`package.json`. The API key (`ANTHROPIC_API_KEY`) is added to environment
variables via Vercel project settings.

### A.12 Acceptance Criteria

- [ ] P1 insight rules produce `InsightGenerationInput` with all relevant context
- [ ] Haiku generates coherent 2-3 sentence narratives from structured input
- [ ] Generated text is encrypted before storage in `insight_cache`
- [ ] Cache hit returns decrypted text in < 10ms
- [ ] Cache miss calls Haiku and returns in < 1.5s (with loading spinner)
- [ ] `data_hash` changes when underlying metric values change
- [ ] Fallback to template text when Haiku call fails
- [ ] Generated text contains no medical advice or diagnostic language
- [ ] Viewer access to LLM insights respects metric scoping
- [ ] Monthly cost at 500 users is under $5
