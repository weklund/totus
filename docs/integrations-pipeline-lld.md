# Totus Integrations Pipeline Low-Level Design

### Version 1.1 — March 2026

### Author: Architecture Team

### Status: Draft — Supersedes Oura-specific sections of api-database-lld.md and architecture-design.md

---

## 1. Overview & Scope

**Purpose.** This document specifies the complete low-level design for the Totus integrations data pipeline. It covers the provider registry, unified database schema, data normalization contracts, adapter interfaces, Inngest job architecture, API changes, and migration path. It is the implementation blueprint for adding any new health data provider.

**Supersedes.**

- `api-database-lld.md` §7.2.2–7.2.3 (Oura-specific authorize/callback endpoints)
- `api-database-lld.md` §8.3.3 (`oura_connections` table)
- `api-database-lld.md` §8.3.4 (`health_data` table — replaced by `health_data_daily`)
- `api-database-lld.md` §19.5 (Oura API Field Mapping — expanded here)
- `architecture-design.md` §oura_connections references

**Integration categories in scope:**

| Category                 | Providers           | Status                                 |
| ------------------------ | ------------------- | -------------------------------------- |
| Wearables                | Oura, Garmin, Whoop | Design complete                        |
| CGMs                     | Dexcom              | Design complete                        |
| Smart scales / body comp | Withings            | Design complete                        |
| Nutrition tracking       | Cronometer          | Design complete (partnership required) |
| File imports             | CSV, GPX            | Future                                 |
| Blood panels             | LabCorp, Quest      | Deferred                               |

**Out of scope.** Apple HealthKit and Google Health (require mobile SDKs, not server-side OAuth). Blood panels (data model supports them; provider adapters deferred). This architecture does not preclude either.

---

## 2. Provider Registry

Every integration is defined by a `ProviderConfig` object. This is static config — not a database table. Each provider ships its config alongside its adapter implementation.

```typescript
interface ProviderConfig {
  id: string; // 'oura', 'dexcom', 'garmin', 'whoop'
  displayName: string;
  authType: "oauth2" | "oauth2_pkce" | "api_key" | "file_import";
  auth: {
    authorizeUrl?: string; // null for file_import
    tokenUrl?: string;
    revokeUrl?: string;
    scopes: string[];
    redirectUri: string; // e.g. 'https://app.totus.health/api/connections/oura/callback'
  };
  rateLimit: {
    requestsPerWindow: number;
    windowSeconds: number;
    respectRetryAfter: boolean;
  };
  sync: {
    dailyMetrics: string[]; // metric_type IDs this provider supplies as daily aggregates
    seriesMetrics: string[]; // metric_type IDs supplied as intraday point series
    periodTypes: string[]; // event_type IDs supplied as duration periods
    historicalWindowDays: number; // how far back provider allows (Dexcom: 90, Oura: unlimited)
    defaultSyncIntervalHours: number;
    correctionWindowDays: number; // days of recent data to re-fetch on each sync for retroactive corrections
    // Providers like Oura reprocess sleep scores; Cronometer allows diary edits.
    // On each sync: fetch from cursor forward, AND re-upsert last N days.
    // Safe due to upsert semantics on the data tables.
  };
  apiVersion: string;
  changelogUrl: string;
}
```

### 2.1 Concrete Provider Configurations

Each provider ships a `ProviderConfig` alongside its adapter implementation. Full API details, field mappings, retry handling, and partnership status live in per-provider files under `docs/integrations/`.

| Provider             | Category    | Auth          | Developer Access                        | Data Types             | Detail                                                        |
| -------------------- | ----------- | ------------- | --------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| Oura Ring            | Wearable    | OAuth2        | Self-serve                              | daily, series, periods | [docs/integrations/oura.md](integrations/oura.md)             |
| Dexcom CGM           | CGM         | OAuth2        | Self-serve (production review ~1–4 wks) | series only            | [docs/integrations/dexcom.md](integrations/dexcom.md)         |
| Garmin Connect       | Wearable    | OAuth2        | Partner application (~1–3 wks)          | daily, series, periods | [docs/integrations/garmin.md](integrations/garmin.md)         |
| Whoop                | Wearable    | OAuth2 + PKCE | Self-serve                              | daily, series, periods | [docs/integrations/whoop.md](integrations/whoop.md)           |
| Withings Health Mate | Smart Scale | OAuth2        | Self-serve                              | daily                  | [docs/integrations/withings.md](integrations/withings.md)     |
| Cronometer           | Nutrition   | OAuth2        | **Blocked — partnership required**      | daily, periods         | [docs/integrations/cronometer.md](integrations/cronometer.md) |

**Key `sync` field notes** (apply across all providers):

- `correctionWindowDays` — days of recent data to re-fetch on each sync. Oura reprocesses sleep scores (3 days); Cronometer allows diary edits (1 day); Withings measurements are immutable (0 days). The adapter re-upserts this window on every sync; safe due to upsert semantics.
- `historicalWindowDays` — hard lookback limit enforced by the provider. Dexcom: 90 days (API limit). Garmin: 365 days. Others: 3,650 days (~10 years) or unlimited.
- `seriesMetrics: []` — providers with no intraday series data (Withings, Cronometer). The `fetchSeriesData` adapter method is a no-op for these providers.

---

## 3. Database Schema

### 3.1 `provider_connections` (replaces `oura_connections`)

One row per (user, provider) pair. Stores encrypted OAuth tokens plus sync state. The `auth_enc` column is a BYTEA holding the encrypted token payload; the exact encryption format is deferred to the threat modeling session.

```sql
CREATE TABLE provider_connections (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            VARCHAR(32)     NOT NULL,
        -- One of: 'oura', 'dexcom', 'garmin', 'whoop'
        -- Not an enum; validated at application layer to allow new providers without migrations.
    auth_type           VARCHAR(16)     NOT NULL,
        -- One of: 'oauth2', 'oauth2_pkce', 'api_key', 'file_import'
    auth_enc            BYTEA           NOT NULL,
        -- Encrypted JSONB blob. Wire format TBD — see threat modeling session.
        -- Plaintext structure: { access_token, refresh_token, expires_at, scopes }
        -- api_key auth type: { api_key, scopes }
    token_expires_at    TIMESTAMPTZ,
        -- NULL for api_key and file_import auth types.
        -- Used by token refresh job to proactively refresh before expiry.
    status              VARCHAR(16)     NOT NULL DEFAULT 'active',
        -- One of: 'active', 'expired', 'error', 'paused'
        -- 'expired': refresh failed; user must re-authenticate.
        -- 'error': non-auth error (e.g. provider API down); sync will retry.
        -- 'paused': user manually disabled syncing for this connection.
    last_sync_at        TIMESTAMPTZ,
        -- Timestamp of last successful sync across any data type. NULL if never synced.
    daily_cursor        VARCHAR(256),
        -- Provider-specific pagination cursor for daily aggregates sync.
        -- NULL = sync from beginning.
    series_cursor       VARCHAR(256),
        -- Separate cursor for intraday series sync.
    periods_cursor      VARCHAR(256),
        -- Separate cursor for periods sync.
    sync_status         VARCHAR(16)     NOT NULL DEFAULT 'idle',
        -- One of: 'idle', 'queued', 'syncing', 'error'
        -- Set to 'queued' when Inngest event dispatched; 'syncing' when job starts.
    sync_error          TEXT,
        -- Error message from last failed sync. NULL if last sync succeeded.
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_provider_connections_user_provider UNIQUE (user_id, provider),
        -- One connection per (user, provider) pair.
    CONSTRAINT chk_valid_status_sync_combo CHECK (
        NOT (status IN ('expired', 'paused') AND sync_status = 'syncing')
    )
        -- A connection that is expired or paused must not be actively syncing.
);

CREATE INDEX idx_provider_connections_user_id
    ON provider_connections(user_id);

CREATE INDEX idx_provider_connections_active_sync
    ON provider_connections(status, sync_status)
    WHERE status = 'active';
    -- Used by the sync sweep job to find connections eligible for sync.

CREATE INDEX idx_provider_connections_token_expiry
    ON provider_connections(token_expires_at)
    WHERE status = 'active' AND token_expires_at IS NOT NULL;
    -- Used by the token refresh job.

COMMENT ON TABLE provider_connections IS 'OAuth connections to health data providers. Replaces oura_connections. One row per (user, provider).';
COMMENT ON COLUMN provider_connections.auth_enc IS 'Encrypted JSONB: {access_token, refresh_token, expires_at, scopes}. Encryption format TBD (threat modeling session).';
COMMENT ON COLUMN provider_connections.daily_cursor IS 'Provider pagination cursor for incremental daily aggregates sync. NULL means start from historicalWindowDays ago.';
```

### 3.2 `metric_source_preferences`

Stores the user's explicit provider preference per metric type. Queried at read time to resolve which source to return.

```sql
CREATE TABLE metric_source_preferences (
    user_id     VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_type VARCHAR(64) NOT NULL,
        -- Must be a valid metric_type from the taxonomy (app-level validation).
    provider    VARCHAR(32) NOT NULL,
        -- Must be an active connected provider for this user (app-level validation).
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, metric_type)
        -- Natural composite key. No surrogate UUID needed; this table is never
        -- referenced by foreign key from other tables.
);

-- The primary key index on (user_id, metric_type) covers all lookups.
-- No separate index needed.

COMMENT ON TABLE metric_source_preferences IS 'User-set preferred data source per metric type. Used for source resolution at query time.';
```

### 3.3 `health_data_daily` (renamed from `health_data`)

Daily aggregates — one row per (user, metric, date, source). Schema is identical to the existing `health_data` table with the addition of explicit migration notes.

```sql
-- Migration: ALTER TABLE health_data RENAME TO health_data_daily;
-- All existing rows (source='oura') are preserved unchanged.

CREATE TABLE health_data_daily (
    id              BIGSERIAL       PRIMARY KEY,
    user_id         VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_type     VARCHAR(64)     NOT NULL,
        -- e.g., 'sleep_score', 'hrv', 'steps', 'glucose_avg'
        -- Validated at application level against metric taxonomy.
    date            DATE            NOT NULL,
        -- The calendar date this aggregate applies to.
    value_encrypted BYTEA           NOT NULL,
        -- Encrypted health metric value. Wire format TBD — see threat modeling session.
        -- Plaintext JSON: {"v": 85} | {"v": 42.5} | {"v": 7.5, "u": "hr"}
    source          VARCHAR(32)     NOT NULL,
        -- Provider identifier: 'oura', 'dexcom', 'garmin', 'whoop'
        -- Not an enum; open-ended string validated at app layer.
    source_id       VARCHAR(256),
        -- Provider-specific record ID for deduplication on re-sync.
    imported_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_health_data_daily_user_metric_date_source
        UNIQUE (user_id, metric_type, date, source)
);

CREATE INDEX idx_health_data_daily_user_metric_date
    ON health_data_daily(user_id, metric_type, date);

CREATE INDEX idx_health_data_daily_user_metric_summary
    ON health_data_daily(user_id, metric_type);

COMMENT ON TABLE health_data_daily IS 'Encrypted daily aggregate health metrics. One row per (user, metric_type, date, source). Renamed from health_data; existing data unchanged.';
```

### 3.4 `health_data_series` (new — intraday point readings)

High-frequency time-series data: CGM glucose readings (every 5 min), heart rate samples, SpO2 intervals. Partitioned by month for query performance. A Dexcom user accumulates ~288 glucose readings per day; monthly partitions keep each partition to ~8,640 rows per user-metric.

```sql
CREATE TABLE health_data_series (
    id              BIGSERIAL       NOT NULL,
    user_id         VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_type     VARCHAR(64)     NOT NULL,
        -- 'heart_rate', 'glucose', 'spo2_interval', 'hrv_sample'
    recorded_at     TIMESTAMPTZ     NOT NULL,
        -- Exact UTC timestamp of the reading. Stored by the provider's reported time.
    value_encrypted BYTEA           NOT NULL,
        -- Encrypted reading value. Wire format TBD — see threat modeling session.
        -- Plaintext JSON: {"v": 95.2} for glucose mg/dL, {"v": 72} for heart_rate bpm
    source          VARCHAR(32)     NOT NULL,
    source_id       VARCHAR(256),
    imported_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_series_user_metric_time_source
        UNIQUE (user_id, metric_type, recorded_at, source),
    PRIMARY KEY (id, recorded_at)   -- Partition key must be in PK for partitioned tables
) PARTITION BY RANGE (recorded_at);

-- Default partition catches data outside the pre-created range.
-- Prevents hard INSERT failures if the partition creation job falls behind.
-- Monitor rows landing here as an alert condition (see §10).
CREATE TABLE health_data_series_default
    PARTITION OF health_data_series DEFAULT;

-- Pre-create monthly partitions for the expected data range.
-- Partition naming: health_data_series_YYYY_MM
-- Example: health_data_series_2026_01 covers [2026-01-01, 2026-02-01)
-- Migration script creates partitions from 2020-01 through 2027-12.
-- integration/partition.ensure cron job creates new partitions 3 months in advance (see §7.1).

CREATE INDEX idx_series_user_metric_time
    ON health_data_series(user_id, metric_type, recorded_at);
    -- Covers range queries: "give me glucose readings between T1 and T2 for user X"

COMMENT ON TABLE health_data_series IS 'Encrypted intraday time-series health readings (CGM glucose, heart rate, SpO2). Partitioned by month.';
COMMENT ON COLUMN health_data_series.recorded_at IS 'UTC timestamp of reading as reported by provider. Used as partition key.';
COMMENT ON TABLE health_data_series_default IS 'Catch-all partition for data outside the pre-created monthly range. Rows here indicate the partition creation job has fallen behind.';
```

> **IMPORTANT — `id` is not globally unique across partitions.** The composite primary key `(id, recorded_at)` means `id` alone does not uniquely identify a row. The PostgreSQL sequence for `BIGSERIAL` is global, so `id` values will not collide in practice, but the PK constraint is enforced per-partition only. Any application code that queries `WHERE id = $1` without a `recorded_at` predicate will trigger a full-partition-scan (scanning all partitions). Always include a `recorded_at` range predicate alongside an `id` lookup. This table is never referenced by foreign key from other tables, so this constraint is low-risk — but it must be documented for implementors.

**Partition strategy.** Monthly partitions from 2020-01. Rationale: Dexcom users can have up to 90 days of data per sync window, but historical imports can span years. Monthly granularity keeps partitions to a manageable size without excessive partition count. A 5-year Dexcom history produces 60 partitions; each partition holds ~8,640 rows per user-metric.

**Open question.** Confirm `btree` index suffices on `recorded_at` for the partition key range scans vs. a BRIN index. BRIN is smaller but only efficient when rows are inserted in timestamp order (true for CGM live sync, not for bulk historical import). Use `btree` until index size is a concern.

### 3.5 `health_data_periods` (new — duration events)

Bounded time intervals: sleep stages, workouts, fasting windows, meals. Supports overlap queries via a GiST index on the time range.

```sql
CREATE TABLE health_data_periods (
    id              BIGSERIAL       PRIMARY KEY,
    user_id         VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type      VARCHAR(64)     NOT NULL,
        -- 'sleep_stage', 'workout', 'meal', 'fast'
    subtype         VARCHAR(64),
        -- sleep_stage: 'rem', 'deep', 'light', 'awake'
        -- workout: 'run', 'cycle', 'strength', 'yoga', 'swim', 'generic'
        -- meal: 'breakfast', 'lunch', 'dinner', 'snack'
        -- fast: NULL (no standard subtypes)
    started_at      TIMESTAMPTZ     NOT NULL,
    ended_at        TIMESTAMPTZ     NOT NULL,
    duration_sec    INTEGER         GENERATED ALWAYS AS
                        (EXTRACT(EPOCH FROM ended_at - started_at)::INTEGER) STORED,
        -- Derived column; never set directly. Always consistent with started_at/ended_at.
    metadata_enc    BYTEA,
        -- Optional encrypted JSONB payload. Wire format TBD — see threat modeling session.
        -- sleep_stage: {} (no metadata; duration is the data)
        -- workout: { calories, distance_m, avg_hr, max_hr, sport_type_raw }
        -- meal: { calories, protein_g, carbs_g, fat_g, fiber_g,
        --         food_items: [{name, amount, unit, calories, protein_g, carbs_g, fat_g}] }
        -- NULL if no metadata available.
    source          VARCHAR(32)     NOT NULL,
    source_id       VARCHAR(256),
        -- Provider-specific record ID for deduplication.
    imported_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT chk_period_end_after_start
        CHECK (ended_at > started_at),
    CONSTRAINT uq_periods_user_type_start_source
        UNIQUE (user_id, event_type, started_at, source)
);

-- Range overlap queries: "what sleep stages overlap with this time window?"
-- Requires btree_gist extension (available on Aurora PostgreSQL and Neon).
CREATE INDEX idx_periods_user_timerange
    ON health_data_periods USING GIST (user_id, tstzrange(started_at, ended_at));

-- Fast lookup by user + event_type + time range without GIST overhead
CREATE INDEX idx_periods_user_type_time
    ON health_data_periods(user_id, event_type, started_at, ended_at);

COMMENT ON TABLE health_data_periods IS 'Encrypted bounded-duration health events: sleep stages, workouts, fasting windows.';
COMMENT ON COLUMN health_data_periods.duration_sec IS 'Generated column: EXTRACT(EPOCH FROM ended_at - started_at). Never set directly.';
COMMENT ON COLUMN health_data_periods.metadata_enc IS 'Optional encrypted JSONB payload with event-specific data (workout calories, distance, etc.).';
```

**GiST index dependency.** The `idx_periods_user_timerange` GIST index requires the `btree_gist` extension (for the `varchar` `user_id` column). Enable with `CREATE EXTENSION IF NOT EXISTS btree_gist;` before creating this index. If the extension is unavailable, **skip the GIST index** — the btree index on `(user_id, event_type, started_at, ended_at)` is sufficient for all current query patterns. Create the GIST index only if overlap queries become a demonstrated bottleneck.

---

## 4. Metric Type Taxonomy

The full taxonomy defines which table each metric lives in (`dataType`), which providers supply it, and canonical units. All adapters normalize to these units.

```typescript
type DataType = "daily" | "series" | "period";

interface MetricType {
  id: string;
  label: string;
  category:
    | "sleep"
    | "cardiovascular"
    | "activity"
    | "metabolic"
    | "body"
    | "recovery"
    | "nutrition";
  subcategory: string;
  unit: string;
  valueType: "integer" | "float" | "none"; // 'none' for period-type entries with no scalar value
  dataType: DataType;
  providers: string[];
}
```

### 4.1 Data Hierarchy

The full hierarchy of categories, subcategories, and data types supported by the platform. This is the canonical reference for the metric taxonomy — all metric_type IDs must map to an entry in this hierarchy.

```
├── sleep
│   ├── summary          (daily)   sleep_score, sleep_duration, sleep_efficiency, sleep_latency
│   └── stages           (daily)   deep_sleep, rem_sleep, light_sleep, awake_time
│                        (period)  sleep_stage [subtypes: rem, deep, light, awake]
│
├── cardiovascular
│   ├── recovery         (daily)   hrv
│   ├── baseline         (daily)   rhr
│   ├── respiratory      (daily)   respiratory_rate, spo2
│   │                    (series)  spo2_interval
│   └── continuous       (series)  heart_rate
│
├── activity
│   ├── summary          (daily)   activity_score
│   ├── movement         (daily)   steps
│   ├── energy           (daily)   active_calories, total_calories
│   └── workout          (period)  workout [subtypes: run, cycle, strength, yoga, swim, generic]
│
├── metabolic
│   └── glucose          (series)  glucose
│
├── body
│   ├── temperature      (daily)   body_temperature_deviation
│   └── composition      (daily)   weight, bmi, body_fat_pct, muscle_mass_kg,
│                                  bone_mass_kg, hydration_kg, visceral_fat_index
│
├── recovery
│   └── summary          (daily)   readiness_score
│
└── nutrition
    ├── macros            (daily)   calories_consumed, protein_g, carbs_g, fat_g,
    │                               fiber_g, sugar_g, saturated_fat_g
    ├── minerals          (daily)   sodium_mg, potassium_mg, calcium_mg, iron_mg,
    │                               magnesium_mg, zinc_mg
    ├── vitamins          (daily)   vitamin_a_mcg, vitamin_c_mg, vitamin_d_mcg,
    │                               vitamin_b12_mcg, folate_mcg
    └── meals             (period)  meal [subtypes: breakfast, lunch, dinner, snack]
```

**Reserved (deferred — no providers yet):**

```
├── blood_panels
│   ├── lipids            (daily)   ldl_mg_dl, hdl_mg_dl, triglycerides_mg_dl, total_cholesterol_mg_dl
│   ├── glucose_markers   (daily)   hba1c_pct, fasting_glucose_mg_dl
│   └── hormones          (daily)   testosterone_ng_dl, cortisol_mcg_dl, tsh_miu_l
```

### 4.2 Complete Metric Registry

| ID                           | Label                  | Category       | Subcategory | Unit  | ValueType | DataType | Providers           |
| ---------------------------- | ---------------------- | -------------- | ----------- | ----- | --------- | -------- | ------------------- |
| `sleep_score`                | Sleep Score            | sleep          | summary     | score | integer   | daily    | oura, whoop         |
| `sleep_duration`             | Sleep Duration         | sleep          | summary     | hr    | float     | daily    | oura, garmin, whoop |
| `sleep_efficiency`           | Sleep Efficiency       | sleep          | summary     | %     | integer   | daily    | oura, garmin, whoop |
| `sleep_latency`              | Sleep Latency          | sleep          | summary     | min   | integer   | daily    | oura                |
| `deep_sleep`                 | Deep Sleep             | sleep          | stages      | hr    | float     | daily    | oura, garmin, whoop |
| `rem_sleep`                  | REM Sleep              | sleep          | stages      | hr    | float     | daily    | oura, garmin, whoop |
| `light_sleep`                | Light Sleep            | sleep          | stages      | hr    | float     | daily    | oura, garmin, whoop |
| `awake_time`                 | Awake Time             | sleep          | stages      | min   | integer   | daily    | oura, garmin, whoop |
| `sleep_stage`                | Sleep Stage            | sleep          | stages      | —     | none      | period   | oura, garmin, whoop |
| `hrv`                        | Heart Rate Variability | cardiovascular | recovery    | ms    | float     | daily    | oura, garmin, whoop |
| `rhr`                        | Resting Heart Rate     | cardiovascular | baseline    | bpm   | integer   | daily    | oura, garmin, whoop |
| `respiratory_rate`           | Respiratory Rate       | cardiovascular | respiratory | rpm   | float     | daily    | oura, whoop         |
| `spo2`                       | Blood Oxygen (avg)     | cardiovascular | respiratory | %     | float     | daily    | oura, garmin        |
| `spo2_interval`              | SpO2 (interval)        | cardiovascular | respiratory | %     | float     | series   | oura, garmin        |
| `heart_rate`                 | Heart Rate             | cardiovascular | continuous  | bpm   | integer   | series   | oura, garmin, whoop |
| `activity_score`             | Activity Score         | activity       | summary     | score | integer   | daily    | oura                |
| `steps`                      | Steps                  | activity       | movement    | steps | integer   | daily    | oura, garmin        |
| `active_calories`            | Active Calories        | activity       | energy      | kcal  | integer   | daily    | oura, garmin, whoop |
| `total_calories`             | Total Calories         | activity       | energy      | kcal  | integer   | daily    | oura, garmin        |
| `workout`                    | Workout                | activity       | workout     | —     | none      | period   | oura, garmin, whoop |
| `glucose`                    | Glucose                | metabolic      | glucose     | mg/dL | float     | series   | dexcom              |
| `body_temperature_deviation` | Body Temp Deviation    | body           | temperature | C     | float     | daily    | oura                |
| `weight`                     | Body Weight            | body           | composition | kg    | float     | daily    | withings, garmin    |
| `bmi`                        | Body Mass Index        | body           | composition | kg/m² | float     | daily    | withings, garmin    |
| `body_fat_pct`               | Body Fat %             | body           | composition | %     | float     | daily    | withings, garmin    |
| `muscle_mass_kg`             | Muscle Mass            | body           | composition | kg    | float     | daily    | withings, garmin    |
| `bone_mass_kg`               | Bone Mass              | body           | composition | kg    | float     | daily    | withings, garmin    |
| `hydration_kg`               | Body Hydration         | body           | composition | kg    | float     | daily    | withings            |
| `visceral_fat_index`         | Visceral Fat Index     | body           | composition | index | float     | daily    | withings            |
| `readiness_score`            | Readiness Score        | recovery       | summary     | score | integer   | daily    | oura, whoop         |
| `calories_consumed`          | Calories Consumed      | nutrition      | macros      | kcal  | integer   | daily    | cronometer          |
| `protein_g`                  | Protein                | nutrition      | macros      | g     | float     | daily    | cronometer          |
| `carbs_g`                    | Carbohydrates          | nutrition      | macros      | g     | float     | daily    | cronometer          |
| `fat_g`                      | Total Fat              | nutrition      | macros      | g     | float     | daily    | cronometer          |
| `fiber_g`                    | Dietary Fiber          | nutrition      | macros      | g     | float     | daily    | cronometer          |
| `sugar_g`                    | Sugar                  | nutrition      | macros      | g     | float     | daily    | cronometer          |
| `saturated_fat_g`            | Saturated Fat          | nutrition      | macros      | g     | float     | daily    | cronometer          |
| `sodium_mg`                  | Sodium                 | nutrition      | minerals    | mg    | float     | daily    | cronometer          |
| `potassium_mg`               | Potassium              | nutrition      | minerals    | mg    | float     | daily    | cronometer          |
| `calcium_mg`                 | Calcium                | nutrition      | minerals    | mg    | float     | daily    | cronometer          |
| `iron_mg`                    | Iron                   | nutrition      | minerals    | mg    | float     | daily    | cronometer          |
| `magnesium_mg`               | Magnesium              | nutrition      | minerals    | mg    | float     | daily    | cronometer          |
| `zinc_mg`                    | Zinc                   | nutrition      | minerals    | mg    | float     | daily    | cronometer          |
| `vitamin_a_mcg`              | Vitamin A              | nutrition      | vitamins    | mcg   | float     | daily    | cronometer          |
| `vitamin_c_mg`               | Vitamin C              | nutrition      | vitamins    | mg    | float     | daily    | cronometer          |
| `vitamin_d_mcg`              | Vitamin D              | nutrition      | vitamins    | mcg   | float     | daily    | cronometer          |
| `vitamin_b12_mcg`            | Vitamin B12            | nutrition      | vitamins    | mcg   | float     | daily    | cronometer          |
| `folate_mcg`                 | Folate                 | nutrition      | vitamins    | mcg   | float     | daily    | cronometer          |
| `meal`                       | Meal                   | nutrition      | meals       | —     | none      | period   | cronometer          |

**Notes:**

- Period-type entries (`sleep_stage`, `workout`, `meal`) have no scalar value (`valueType: 'none'`). Duration is computed from `started_at`/`ended_at` in `health_data_periods`.
- `glucose` is series-only; there is no daily aggregate row. Display queries aggregate from `health_data_series`.
- Body composition metrics from Withings use `source_id = grpid` (the Withings measurement group ID) to preserve weigh-in atomicity. Application layer reconstructs a full scan by grouping on `(date, source, source_id)`.
- Nutrition daily metrics represent totals for the calendar day. Individual meal events are in `health_data_periods` with food item details in `metadata_enc`.
- Blood panel metrics are reserved in the hierarchy but have no `MetricType` entries until providers are implemented.

---

## 5. Provider Adapter Interface

All adapters implement this interface. The interface is the normalization contract: adapters are responsible for unit conversion, field mapping, and pagination. Calling code never parses raw provider responses.

```typescript
interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

interface DecryptedAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

interface DailyDataPoint {
  userId: string;
  metricType: string; // Must be a valid metric_type ID from the taxonomy
  date: string; // ISO 8601 date: 'YYYY-MM-DD'
  value: number; // In canonical Totus units (adapter applies conversion)
  source: string; // Provider ID: 'oura', 'garmin', etc.
  sourceId?: string; // Provider's own record ID
}

interface SeriesReading {
  userId: string;
  metricType: string;
  recordedAt: Date; // UTC timestamp
  value: number; // Canonical units
  source: string;
  sourceId?: string;
}

interface PeriodEvent {
  userId: string;
  eventType: string; // 'sleep_stage', 'workout'
  subtype?: string; // 'rem', 'deep', 'light', 'awake', 'run', etc.
  startedAt: Date;
  endedAt: Date;
  metadata?: Record<string, unknown>; // Unencrypted; will be encrypted before storage
  source: string;
  sourceId?: string;
}

interface ProviderAdapter {
  readonly provider: string; // Must match ProviderConfig.id

  // Auth lifecycle
  getAuthorizationUrl(userId: string, state: string): string;
  exchangeCodeForTokens(code: string, codeVerifier?: string): Promise<TokenSet>;
  // Note: decryption of encryptedAuth before calling these methods is the caller's
  // responsibility. The exact mechanism depends on the encryption strategy (TBD).
  refreshTokens(encryptedAuth: Buffer): Promise<TokenSet>;
  revokeTokens(encryptedAuth: Buffer): Promise<void>;

  // Data fetching — all methods are paginated via cursor
  fetchDailyData(
    auth: DecryptedAuth,
    metrics: string[],
    cursor: string | null, // null = start from scratch (historicalWindowDays)
  ): Promise<{
    points: DailyDataPoint[];
    nextCursor: string | null; // null = no more pages
  }>;

  fetchSeriesData(
    auth: DecryptedAuth,
    metrics: string[],
    cursor: string | null,
  ): Promise<{
    readings: SeriesReading[];
    nextCursor: string | null;
  }>;

  fetchPeriods(
    auth: DecryptedAuth,
    eventTypes: string[],
    cursor: string | null,
  ): Promise<{
    periods: PeriodEvent[];
    nextCursor: string | null;
  }>;
}
```

**Normalization contract.** Adapters must:

1. Convert all values to Totus canonical units before returning (e.g., Oura seconds → hours for sleep duration).
2. Return `recordedAt` and `startedAt`/`endedAt` as UTC `Date` objects.
3. Return `sourceId` when the provider supplies a stable record ID.
4. Never return partial pages — if a provider call fails mid-page, throw and let Inngest retry.

---

## 6. Provider Adapter Implementations

Concrete field mappings, endpoint details, retry handling, and provider-specific quirks live in the per-provider files. The LLD defines only the normalization contract (§5); each provider file is the authoritative implementation specification for its adapter.

| Provider             | Adapter spec                                                  |
| -------------------- | ------------------------------------------------------------- |
| Oura Ring            | [docs/integrations/oura.md](integrations/oura.md)             |
| Dexcom CGM           | [docs/integrations/dexcom.md](integrations/dexcom.md)         |
| Garmin Connect       | [docs/integrations/garmin.md](integrations/garmin.md)         |
| Whoop                | [docs/integrations/whoop.md](integrations/whoop.md)           |
| Withings Health Mate | [docs/integrations/withings.md](integrations/withings.md)     |
| Cronometer           | [docs/integrations/cronometer.md](integrations/cronometer.md) |

---

## 7. Inngest Job Architecture

### 7.1 Job Definitions

```typescript
// integration/sync.sweep
// Cron: every 6 hours
// Reads all active connections, dispatches per-connection sync jobs in batches
inngest.createFunction(
  {
    id: "integration/sync.sweep",
    name: "Integration Sync Sweep",
  },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    const connections = await step.run("fetch-eligible-connections", () =>
      db
        .select()
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.status, "active"),
            ne(providerConnections.syncStatus, "syncing"),
          ),
        ),
    );

    // Batch into groups of 100 (Inngest sendEvent limit per call)
    const batches = chunk(connections, 100);
    for (const batch of batches) {
      await step.sendEvent(
        "dispatch-sync-batch",
        batch.map((conn) => ({
          name: "integration/sync.connection",
          data: {
            connectionId: conn.id,
            userId: conn.userId,
            provider: conn.provider,
          },
        })),
      );
    }
  },
);

// integration/sync.connection
// Per-connection sync: daily → series → periods in sequence
inngest.createFunction(
  {
    id: "integration/sync.connection",
    name: "Integration Sync Connection",
    concurrency: [
      { limit: 1, key: "event.data.connectionId" }, // C2: at most one sync per connection at a time
      { limit: 3, key: "event.data.provider" }, // max 3 concurrent per provider (rate limit courtesy)
    ],
    rateLimit: { limit: 3, period: "1h", key: "event.data.userId" }, // max 3 syncs/user/hour
    retries: 3,
    onFailure: async ({ event, error }) => {
      // Called after all retries are exhausted. Update the connection's sync state.
      const { connectionId } = event.data;
      await db
        .update(providerConnections)
        .set({
          syncStatus: "error",
          syncError: error.message.slice(0, 1000), // truncate to fit TEXT column
          updatedAt: new Date(),
        })
        .where(eq(providerConnections.id, connectionId));
    },
  },
  { event: "integration/sync.connection" },
  async ({ event, step }) => {
    const { connectionId, userId, provider } = event.data;

    // Atomic compare-and-swap: only proceed if not already syncing.
    // Returns 0 rows updated if another job beat us to it (due to concurrency race).
    const claimed = await step.run("mark-syncing", async () => {
      const result = await db
        .update(providerConnections)
        .set({ syncStatus: "syncing", updatedAt: new Date() })
        .where(
          and(
            eq(providerConnections.id, connectionId),
            ne(providerConnections.syncStatus, "syncing"),
          ),
        );
      return result.rowCount;
    });
    if (claimed === 0) return; // Another sync job is already running; bail out.

    const adapter = getAdapter(provider);
    const connection = await step.run("fetch-connection", () =>
      db.query.providerConnections.findFirst({
        where: eq(providerConnections.id, connectionId),
      }),
    );

    // Sequential: daily, then series, then periods
    // Note: encryption of stored values is handled inside each sync function.
    // The specific encryption strategy is TBD (threat modeling session).
    await step.run("sync-daily", () => syncDailyData(adapter, connection));
    await step.run("sync-series", () => syncSeriesData(adapter, connection));
    await step.run("sync-periods", () => syncPeriods(adapter, connection));

    await step.run("mark-idle", () =>
      db
        .update(providerConnections)
        .set({
          syncStatus: "idle",
          lastSyncAt: new Date(),
          syncError: null,
          updatedAt: new Date(),
        })
        .where(eq(providerConnections.id, connectionId)),
    );
  },
);

// integration/sync.initial
// Historical backfill from historicalWindowDays ago to present
// Resumable: each step advances one page; Inngest persists cursor between retries
inngest.createFunction(
  {
    id: "integration/sync.initial",
    name: "Integration Initial Sync",
    concurrency: { limit: 1, key: "event.data.connectionId" }, // no parallel initial syncs per connection
    retries: 5,
  },
  { event: "integration/sync.initial" },
  async ({ event, step }) => {
    // Delegates to the same sync logic as sync.connection
    // The absence of cursors in provider_connections signals "start from beginning"
    await step.invoke("run-full-sync", {
      function: syncConnectionFunction,
      data: {
        connectionId: event.data.connectionId,
        userId: event.data.userId,
        provider: event.data.provider,
      },
    });
  },
);

// integration/token.refresh
// Cron: every hour — proactively refresh tokens expiring within 24 hours
inngest.createFunction(
  {
    id: "integration/token.refresh",
    name: "Integration Token Refresh",
  },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const expiringSoon = await step.run("fetch-expiring-tokens", () =>
      db
        .select()
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.status, "active"),
            isNotNull(providerConnections.tokenExpiresAt),
            lte(providerConnections.tokenExpiresAt, addHours(new Date(), 24)),
          ),
        ),
    );

    // M5: Process each connection in its own step so failures are isolated.
    // A network error on one user's token refresh does not block others.
    for (const conn of expiringSoon) {
      await step.run(`refresh-${conn.id}`, async () => {
        try {
          const adapter = getAdapter(conn.provider);
          // Decrypt conn.authEnc, refresh, re-encrypt, store.
          // Encryption/decryption mechanism TBD (threat modeling session).
          const newTokens = await adapter.refreshTokens(conn.authEnc);
          const reencryptedAuth = await encryptTokenSet(newTokens, conn.userId);
          await db
            .update(providerConnections)
            .set({
              authEnc: reencryptedAuth,
              tokenExpiresAt: newTokens.expiresAt,
              updatedAt: new Date(),
            })
            .where(eq(providerConnections.id, conn.id));
        } catch (err) {
          if (isAuthError(err)) {
            // Refresh token is expired or revoked; user must re-authenticate.
            await db
              .update(providerConnections)
              .set({ status: "expired", updatedAt: new Date() })
              .where(eq(providerConnections.id, conn.id));
            // Do NOT re-throw for auth errors — this connection is handled (marked expired).
            // Throwing would cause Inngest to retry the entire job, re-processing connections
            // that already succeeded.
            return;
          }
          // For non-auth errors (network timeout, provider API error), log and continue.
          // The token is not yet expired, so we can retry on the next hourly run.
          // Do NOT re-throw — failure on one connection must not block others.
          console.error(`Token refresh failed for connection ${conn.id}`, err);
        }
      });
    }
  },
);

// integration/sync.manual
// User-triggered sync from the dashboard
// Same logic as sync.connection but dispatched with higher priority
inngest.createFunction(
  {
    id: "integration/sync.manual",
    name: "Integration Manual Sync",
    concurrency: [
      { limit: 1, key: "event.data.connectionId" }, // same per-connection guard as sync.connection
      { limit: 3, key: "event.data.provider" },
    ],
    retries: 2, // Fewer retries for manual syncs; user is waiting
  },
  { event: "integration/sync.manual" },
  async ({ event, step }) => {
    // Identical to sync.connection handler body
    // Inngest prioritizes manually-triggered events when queue depth is high
    await step.invoke("run-sync", {
      function: syncConnectionFunction,
      data: event.data,
    });
  },
);

// integration/partition.ensure
// Cron: monthly — creates health_data_series monthly partitions 3 months in advance
// Prevents hard INSERT failures when data arrives for a month with no partition yet.
inngest.createFunction(
  {
    id: "integration/partition.ensure",
    name: "Ensure Series Partitions",
    retries: 3,
  },
  { cron: "0 0 1 * *" }, // 1st of every month
  async ({ step }) => {
    await step.run("create-future-partitions", async () => {
      const now = new Date();
      // Ensure partitions exist for the next 3 months
      for (let i = 0; i <= 3; i++) {
        const target = addMonths(now, i);
        const year = target.getFullYear();
        const month = String(target.getMonth() + 1).padStart(2, "0");
        const nextMonth = addMonths(target, 1);
        const nextYear = nextMonth.getFullYear();
        const nextMonthStr = String(nextMonth.getMonth() + 1).padStart(2, "0");

        const partitionName = `health_data_series_${year}_${month}`;
        const startDate = `${year}-${month}-01`;
        const endDate = `${nextYear}-${nextMonthStr}-01`;

        // CREATE IF NOT EXISTS equivalent via DO block
        await db.execute(sql`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_class WHERE relname = ${partitionName}
            ) THEN
              EXECUTE format(
                'CREATE TABLE %I PARTITION OF health_data_series
                 FOR VALUES FROM (%L) TO (%L)',
                ${partitionName}, ${startDate}, ${endDate}
              );
            END IF;
          END $$;
        `);
      }
    });
  },
);
```

### 7.2 Failure Handling

| Failure Type                               | Detection                     | Action                                                         |
| ------------------------------------------ | ----------------------------- | -------------------------------------------------------------- |
| Provider API error (5xx)                   | HTTP 5xx response             | Inngest retries with exponential backoff (1s → 4s → 16s)       |
| Rate limited (429)                         | HTTP 429 with `Retry-After`   | Adapter throws with retry hint; Inngest respects delay         |
| Auth expired (401)                         | HTTP 401, refresh also fails  | Set `status='expired'`; stop retrying; alert user              |
| Auth expired (401), refresh succeeds       | HTTP 401, refresh ok          | Store new tokens; retry current sync step                      |
| Max retries exceeded                       | Inngest exhausts retry budget | Set `sync_status='error'`, `sync_error=message`; surface in UI |
| Token refresh fails at `token.refresh` job | Refresh 401/400               | Set `status='expired'`; record will be skipped by sweep job    |

**Dead letter pattern.** Inngest's built-in failure handling captures the final error. The `sync.connection` job catches exhausted retries in an `onFailure` handler to update `sync_status` and `sync_error` in the database.

---

## 8. API Changes

### 8.1 Connection Endpoints (updated)

Old Oura-specific endpoints replaced by generic provider endpoints:

| Old                                   | New                                         | Notes                                                |
| ------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `GET /api/connections/oura/authorize` | `GET /api/connections/{provider}/authorize` | Same logic, provider resolved from path              |
| `GET /api/connections/oura/callback`  | `GET /api/connections/{provider}/callback`  | State JWT includes provider                          |
| `GET /api/connections`                | `GET /api/connections`                      | Reads `provider_connections`, not `oura_connections` |
| `DELETE /api/connections/{id}`        | unchanged                                   |                                                      |
| `POST /api/connections/{id}/sync`     | unchanged                                   | Dispatches `integration/sync.manual` Inngest event   |

#### GET /api/connections/{provider}/authorize

**Auth:** Owner (Clerk session required)

**Path Parameters:** `provider` — one of `oura`, `dexcom`, `garmin`, `whoop`

**Response 200:**

```json
{
  "authorization_url": "https://cloud.ouraring.com/oauth/authorize?client_id=...&state=..."
}
```

**Errors:** 400 (unknown provider), 401, 409 (provider already connected)

#### GET /api/connections/{provider}/callback

**Auth:** None (callback from provider). State JWT validates the originating user.

**Processing:**

1. Validate and decode `state` JWT. Extract `userId` and `provider`.
2. Exchange `code` for tokens via `adapter.exchangeCodeForTokens(code, codeVerifier?)`.
3. Encrypt token set with user's DEK.
4. Upsert into `provider_connections` (provider, auth_type, auth_enc, token_expires_at).
5. Emit `account.connected` audit event.
6. Dispatch `integration/sync.initial` Inngest event.
7. Redirect to `/dashboard?connected={provider}`.

**Error redirects:** `/dashboard?error={provider}_state_invalid`, `/dashboard?error={provider}_token_failed`, `/dashboard?error=internal_error`

### 8.2 Health Data Endpoints (updated)

#### GET /api/health-data (updated)

Unchanged request/response shape. Internal change: queries `health_data_daily` (renamed table). Source resolution logic applied (see §8.4).

#### GET /api/health-data/series (new)

Intraday series data for a metric within a time range.

**Auth:** Owner or Viewer (with share grant covering the metric)

**Query Parameters:**

| Param         | Type                | Required | Description                  |
| ------------- | ------------------- | -------- | ---------------------------- |
| `metric_type` | `string`            | Yes      | Must be a series-type metric |
| `from`        | `ISO 8601 datetime` | Yes      | Start of range (UTC)         |
| `to`          | `ISO 8601 datetime` | Yes      | End of range (UTC)           |
| `source`      | `string`            | No       | Filter to specific provider  |

**Response 200:**

```json
{
  "data": {
    "metric_type": "glucose",
    "source": "dexcom",
    "readings": [
      { "recorded_at": "2026-03-10T08:00:00Z", "value": 95.2 },
      { "recorded_at": "2026-03-10T08:05:00Z", "value": 97.1 }
    ]
  }
}
```

#### GET /api/health-data/periods (new)

Duration events within a time range.

**Auth:** Owner or Viewer (with share grant covering the event type)

**Query Parameters:**

| Param        | Type                | Required | Description                     |
| ------------ | ------------------- | -------- | ------------------------------- |
| `event_type` | `string`            | Yes      | `sleep_stage`, `workout`        |
| `subtype`    | `string`            | No       | Filter by subtype (e.g., `rem`) |
| `from`       | `ISO 8601 datetime` | Yes      | Events overlapping this window  |
| `to`         | `ISO 8601 datetime` | Yes      | Events overlapping this window  |
| `source`     | `string`            | No       | Filter to specific provider     |

**Response 200:**

```json
{
  "data": {
    "event_type": "sleep_stage",
    "periods": [
      {
        "subtype": "rem",
        "started_at": "2026-03-10T02:15:00Z",
        "ended_at": "2026-03-10T02:47:00Z",
        "duration_sec": 1920,
        "source": "oura"
      }
    ]
  }
}
```

### 8.3 Metric Preference Endpoints (new)

#### GET /api/metric-preferences

Returns all of the authenticated user's source preferences.

**Auth:** Owner

**Response 200:**

```json
{
  "data": [
    { "metric_type": "hrv", "provider": "oura" },
    { "metric_type": "rhr", "provider": "garmin" }
  ]
}
```

#### PUT /api/metric-preferences/{metricType}

Set the preferred provider for a metric.

**Auth:** Owner

**Request Body:**

```json
{ "provider": "garmin" }
```

**Response 200:** `{ "data": { "metric_type": "hrv", "provider": "garmin" } }`

**Errors:** 400 (unknown metric_type or provider), 409 (provider not connected)

#### DELETE /api/metric-preferences/{metricType}

Remove preference; revert to auto-resolution.

**Auth:** Owner

**Response 200:** `{ "data": { "metric_type": "hrv", "provider": null } }`

### 8.4 Source Resolution Logic

Applied in `GET /api/health-data` and the equivalent viewer endpoint for any metric with multiple sources:

```
1. Does user have a row in metric_source_preferences for (user_id, metric_type)?
   → Yes: filter health_data_daily WHERE source = preferred_provider
   → No: auto-resolve

2. Auto-resolve:
   - SELECT source
     FROM health_data_daily
     WHERE user_id = $1 AND metric_type = $2
       AND date >= CURRENT_DATE - INTERVAL '7 days'
     GROUP BY source
     ORDER BY MAX(imported_at) DESC
     LIMIT 1
   - Use most recently synced source.
   - Tie-break: alphabetical by provider name (deterministic).

3. ?sources=all query param:
   - Skip resolution; return all sources for the metric.
   - Response groups data by source.
   - Used for the "compare sources" toggle in the UI.
```

**Share grant authorization for period event_types.** The `share_grants.allowed_metrics` column (defined in `api-database-lld.md` §8.3.5) uses a `TEXT[]` validated against metric_type IDs. Period event_types (`sleep_stage`, `workout`, `meal`) must also be included in `allowed_metrics` for the periods endpoints to return data to a viewer. Implementation note: when creating a share grant, the UI should offer both scalar metrics and period event_types as selectable items. The validation on `PUT /api/share-grants` must accept any ID from the full metric registry in §4.2 (both `dataType: 'daily'` and `dataType: 'period'` entries). The column name `allowed_metrics` is a misnomer for period types; document this in `api-database-lld.md` or rename the column to `allowed_data_types` in a future migration.

---

## 9. Migration from Current Schema

All migrations are non-destructive. No data is deleted. Each step is independently reversible.

### Step 1 — Rename `health_data` to `health_data_daily`

```sql
-- Run inside a transaction. Zero row changes.
ALTER TABLE health_data RENAME TO health_data_daily;
ALTER INDEX idx_health_data_user_metric_date RENAME TO idx_health_data_daily_user_metric_date;
ALTER INDEX idx_health_data_user_metric_summary RENAME TO idx_health_data_daily_user_metric_summary;

-- Drop the old enum-like source constraint (was: application-level validation only)
-- Existing 'oura' values remain valid; no constraint to drop.

COMMENT ON TABLE health_data_daily IS 'Encrypted daily aggregate health metrics. One row per (user, metric_type, date, source). Renamed from health_data; existing data unchanged.';
```

### Step 2 — Create new tables

```sql
-- Run create statements from §3.1 through §3.5.
-- Create extensions first:
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

### Step 3 — Migrate `oura_connections` to `provider_connections`

```sql
-- Insert all existing Oura connections into provider_connections.
-- Maps old columns to new schema. No row deletion.
INSERT INTO provider_connections (
    id, user_id, provider, auth_type,
    auth_enc,               -- Reconstruct envelope: wrap old access_token_enc + refresh_token_enc
    token_expires_at, status, last_sync_at,
    daily_cursor, sync_status, sync_error,
    created_at, updated_at
)
SELECT
    id, user_id,
    'oura'          AS provider,
    'oauth2'        AS auth_type,
    -- auth_enc: old schema had separate access_token_enc / refresh_token_enc columns.
    -- Migration script: decrypt both, re-encrypt as single JSONB blob.
    -- This requires running the migration as a Node.js script (not pure SQL) for KMS access.
    NULL            AS auth_enc,       -- placeholder; migration script fills this
    token_expires_at,
    CASE
        WHEN token_expires_at < NOW() THEN 'expired'
        WHEN sync_error IS NOT NULL    THEN 'error'
        ELSE                                'active'
    END             AS status,
    last_sync_at,
    sync_cursor     AS daily_cursor,   -- existing cursor maps to daily_cursor
    sync_status,
    sync_error,
    created_at,
    now()           AS updated_at
FROM oura_connections;

-- After migration verified (row counts match, spot-check decryption):
-- DO NOT drop oura_connections yet. Keep as fallback for 2 deploy cycles.
-- Drop in follow-up migration after confirming all syncs succeed via provider_connections.
```

**Note on auth_enc migration.** The old schema stored access and refresh tokens in separate BYTEA columns (`access_token_enc`, `refresh_token_enc`). The new schema stores a single encrypted JSONB blob. The migration requires a one-time Node.js script that:

1. Reads each `oura_connections` row.
2. Decrypts `access_token_enc` and `refresh_token_enc` using the user's DEK (via KMS).
3. Constructs `{ access_token, refresh_token, expires_at, scopes }` JSON.
4. Re-encrypts the combined blob.
5. Writes to `provider_connections.auth_enc`.

### Step 4 — Update application code

- Replace all references to `oura_connections` with `provider_connections`.
- Replace all references to `health_data` with `health_data_daily` (Drizzle schema rename).
- Deploy new Inngest functions (sync jobs).
- Update `GET /api/connections` to read from `provider_connections`.
- Update `POST /api/connections/{id}/sync` to dispatch Inngest event (replaces direct cron pattern).

### Step 5 — Backfill intraday data

On next scheduled sync cycle, `integration/sync.connection` will fetch series (heart rate, SpO2) and periods (sleep stages, workouts) for all existing Oura connections. No manual backfill script needed; the initial sync logic handles this.

---

## 10. Observability

### Inngest Dashboard

All job runs, retries, and failures are visible in the Inngest dashboard. No additional setup needed for basic observability.

### Custom Metrics

Emit these structured log events from sync jobs. Aggregated in your observability platform (e.g., Datadog, Axiom):

| Metric Name                 | Type      | Dimensions                                                  |
| --------------------------- | --------- | ----------------------------------------------------------- |
| `sync.duration_ms`          | Histogram | `provider`, `data_type` (daily/series/periods)              |
| `sync.failure_count`        | Counter   | `provider`, `failure_reason` (auth/rate_limit/api_error)    |
| `sync.data_points_imported` | Counter   | `provider`, `data_type`, `metric_type`                      |
| `sync.cursor_age_hours`     | Gauge     | `provider`, `data_type` — measures staleness of sync cursor |

### Alerts

| Alert                     | Condition                                                           | Action                                                                                                           |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Sync stale — per provider | No successful sync for any user in 24h for a given provider         | Check provider API status, Inngest queue depth                                                                   |
| High auth failure rate    | >5% of sync jobs failing with 401 across >3 users for same provider | Provider may have changed OAuth contract; check changelog                                                        |
| Rows in default partition | `SELECT COUNT(*) FROM health_data_series_default` > 0               | Default partition caught stray data; run `integration/partition.ensure` manually; move rows to correct partition |

---

## 11. Open Questions

These questions must be resolved before implementation begins on the affected components.

| #   | Question                                                                                                             | Impact                                                                               | Recommendation                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **`btree_gist` extension on Neon/Aurora.** Is it available and enabled by default?                                   | `health_data_periods` GIST index requires it                                         | Verify during DB provisioning. Both Neon and Aurora PostgreSQL support it; may need `CREATE EXTENSION IF NOT EXISTS btree_gist`. GIST index is optional — omit it if extension is unavailable and add later. |
| 2   | **Inngest plan tier.** Expected sync job volume at MVP launch and at scale — see §12 (Scale Analysis) for estimates. | Free tier (50k events/month) is exceeded even at modest user counts                  | Budget for Inngest Starter ($25/month) from day one; plan for Team tier beyond ~2,000 active users.                                                                                                          |
| 3   | **`health_data_series` index type.** BRIN vs. btree for `recorded_at`?                                               | BRIN is 100× smaller but only efficient for sequential inserts                       | Use btree initially. Revisit when any partition exceeds 10M rows.                                                                                                                                            |
| 4   | **Garmin API selection.** Health API (push/webhook) vs. Connect API (pull/OAuth2)?                                   | Health API requires a webhook ingestion path, not the `ProviderAdapter` pull pattern | Confirm during Garmin partner application. See [docs/integrations/garmin.md](integrations/garmin.md) §Critical for the full tradeoff analysis.                                                               |
| 5   | **Cronometer partnership.** Contact developer@cronometer.com to apply for API access.                                | Cronometer integration is blocked until credentials are issued                       | Start partnership outreach immediately. Build Cronometer CSV import adapter in parallel as a bridge. See [docs/integrations/cronometer.md](integrations/cronometer.md) §Interim path.                        |
| 6   | **`share_grants.allowed_metrics` column rename.** The column name is a misnomer for period event_types.              | Minor — affects only documentation clarity and future API consumers                  | Rename to `allowed_data_types` in a future migration when convenient. Low urgency.                                                                                                                           |

---

## 12. Scale Analysis

Full analysis: `docs/data-scale-analysis.md`. This section captures the key thresholds and critical architectural risks relevant to implementation decisions.

### 12.1 Storage at a Glance

`health_data_series` accounts for ~96% of total storage at every user tier because intraday readings (Garmin HR: ~1,700/day, Oura HR+SpO2: ~684/day, Dexcom: ~288/day) dwarf daily aggregate rows (~25/day).

| Tier          | Storage after 1 year | Storage after 3 years |
| ------------- | -------------------- | --------------------- |
| 100 users     | ~21 GB               | ~62 GB                |
| 1,000 users   | ~206 GB              | ~619 GB               |
| 10,000 users  | ~2.1 TB              | ~6.2 TB               |
| 100,000 users | ~20.6 TB             | ~61.9 TB              |

Storage cost on Neon is manageable at every tier through 10,000 users (~$47/month at 1 year). Aurora is ~4.5× higher but still not the binding constraint.

### 12.2 Encryption Strategy — Deferred

The encryption wire format for `value_encrypted`, `metadata_enc`, and `auth_enc` is **not specified in this document**. This decision is deferred to a dedicated threat modeling session.

The scale analysis (`docs/data-scale-analysis.md` §10.1) documents the performance and cost tradeoffs between the two main approaches (per-row DEKs vs. per-user DEKs) as inputs to that session. The key constraint: the dashboard query latency target (NFR-1: <500ms) places a hard ceiling on how many KMS calls can be made per request, which directly determines which encryption model is viable.

The schema columns (`value_encrypted BYTEA`, `metadata_enc BYTEA`, `auth_enc BYTEA`) are intentionally format-agnostic — the wire format is determined by the application layer, not the schema.

### 12.3 Partition Inflection Points

| User count                | Action                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| ~500 active users         | Validate AUTOVACUUM is keeping up on `health_data_series` — monthly partitions are critical at this point |
| ~2,000 active users       | Query planning benefits from partition pruning become measurable; confirm index hit rates                 |
| ~3,000–5,000 active users | Monthly series partitions exceed 500M rows; **switch to weekly partitions**                               |
| ~10,000+ active users     | Evaluate TimescaleDB or S3/Parquet columnar store for series data >90 days old                            |

### 12.4 GiST Index on `health_data_periods`

Drop the GiST index unless overlap queries ("what sleep stage was I in at exactly 3:00 AM?") are confirmed as a UI feature. Dashboard queries using a date range use the btree index efficiently. At 5,000 users, the GiST index exceeds 20 GB and imposes measurable AUTOVACUUM overhead. **Decision should be made before launch.**

### 12.5 Inngest Plan Requirements

| Tier          | Monthly events | Required plan                |
| ------------- | -------------- | ---------------------------- |
| 100 users     | ~79K           | Starter (~$25/mo)            |
| 1,000 users   | ~788K          | Pro (~$150/mo)               |
| 10,000 users  | ~7.9M          | Pro (high end) or Enterprise |
| 100,000 users | ~79M           | Enterprise                   |

**Budget Inngest Starter from day one.** The free tier (50K events/month) is exceeded at ~100 active users with 1.5 connections each.
