-- Migration: Multi-Provider Schema Changes
-- See: /docs/integrations-pipeline-lld.md §3 and §9
--
-- Steps:
-- 1. Enable btree_gist extension
-- 2. Rename health_data → health_data_daily (+ rename indexes)
-- 3. Create provider_connections table
-- 4. Create health_data_series (partitioned) with monthly partitions
-- 5. Create health_data_periods table
-- 6. Create metric_source_preferences table

-- ─── Step 1: Enable btree_gist extension ────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Step 2: Rename health_data → health_data_daily ─────────
ALTER TABLE IF EXISTS health_data RENAME TO health_data_daily;

-- Rename constraints and indexes to match new table name
ALTER INDEX IF EXISTS uq_health_data_user_metric_date_source
  RENAME TO uq_health_data_daily_user_metric_date_source;
ALTER INDEX IF EXISTS idx_health_data_user_metric_date
  RENAME TO idx_health_data_daily_user_metric_date;
ALTER INDEX IF EXISTS idx_health_data_user_metric_summary
  RENAME TO idx_health_data_daily_user_metric_summary;

COMMENT ON TABLE health_data_daily IS 'Encrypted daily aggregate health metrics. One row per (user, metric_type, date, source). Renamed from health_data; existing data unchanged.';

-- ─── Step 3: Create provider_connections table ──────────────
CREATE TABLE IF NOT EXISTS provider_connections (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            VARCHAR(32)     NOT NULL,
    auth_type           VARCHAR(16)     NOT NULL,
    auth_enc            BYTEA           NOT NULL,
    token_expires_at    TIMESTAMPTZ,
    status              VARCHAR(16)     NOT NULL DEFAULT 'active',
    last_sync_at        TIMESTAMPTZ,
    daily_cursor        VARCHAR(256),
    series_cursor       VARCHAR(256),
    periods_cursor      VARCHAR(256),
    sync_status         VARCHAR(16)     NOT NULL DEFAULT 'idle',
    sync_error          TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_provider_connections_user_provider UNIQUE (user_id, provider),
    CONSTRAINT chk_valid_status_sync_combo CHECK (
        NOT (status IN ('expired', 'paused') AND sync_status = 'syncing')
    )
);

CREATE INDEX IF NOT EXISTS idx_provider_connections_user_id
    ON provider_connections(user_id);

CREATE INDEX IF NOT EXISTS idx_provider_connections_active_sync
    ON provider_connections(status, sync_status)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_provider_connections_token_expiry
    ON provider_connections(token_expires_at)
    WHERE status = 'active' AND token_expires_at IS NOT NULL;

COMMENT ON TABLE provider_connections IS 'OAuth connections to health data providers. Replaces oura_connections. One row per (user, provider).';

-- ─── Step 4: Create health_data_series (partitioned) ────────
CREATE TABLE IF NOT EXISTS health_data_series (
    id              BIGSERIAL       NOT NULL,
    user_id         VARCHAR(64)     NOT NULL,
    metric_type     VARCHAR(64)     NOT NULL,
    recorded_at     TIMESTAMPTZ     NOT NULL,
    value_encrypted BYTEA           NOT NULL,
    source          VARCHAR(32)     NOT NULL,
    source_id       VARCHAR(256),
    imported_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_series_user_metric_time_source
        UNIQUE (user_id, metric_type, recorded_at, source),
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Default partition for data outside pre-created range
CREATE TABLE IF NOT EXISTS health_data_series_default
    PARTITION OF health_data_series DEFAULT;

CREATE INDEX IF NOT EXISTS idx_series_user_metric_time
    ON health_data_series(user_id, metric_type, recorded_at);

COMMENT ON TABLE health_data_series IS 'Encrypted intraday time-series health readings (CGM glucose, heart rate, SpO2). Partitioned by month.';

-- Monthly partitions from 2024-01 through 2027-12
DO $$
DECLARE
    start_year INT := 2024;
    end_year   INT := 2027;
    y          INT;
    m          INT;
    part_name  TEXT;
    start_date TEXT;
    end_date   TEXT;
    next_y     INT;
    next_m     INT;
BEGIN
    FOR y IN start_year..end_year LOOP
        FOR m IN 1..12 LOOP
            part_name := format('health_data_series_%s_%s', y, lpad(m::text, 2, '0'));
            start_date := format('%s-%s-01', y, lpad(m::text, 2, '0'));

            -- Calculate next month
            IF m = 12 THEN
                next_y := y + 1;
                next_m := 1;
            ELSE
                next_y := y;
                next_m := m + 1;
            END IF;
            end_date := format('%s-%s-01', next_y, lpad(next_m::text, 2, '0'));

            -- Only create if partition doesn't exist
            IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
                EXECUTE format(
                    'CREATE TABLE %I PARTITION OF health_data_series FOR VALUES FROM (%L) TO (%L)',
                    part_name, start_date, end_date
                );
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- ─── Step 5: Create health_data_periods table ───────────────
CREATE TABLE IF NOT EXISTS health_data_periods (
    id              BIGSERIAL       PRIMARY KEY,
    user_id         VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type      VARCHAR(64)     NOT NULL,
    subtype         VARCHAR(64),
    started_at      TIMESTAMPTZ     NOT NULL,
    ended_at        TIMESTAMPTZ     NOT NULL,
    duration_sec    INTEGER         GENERATED ALWAYS AS
                        (EXTRACT(EPOCH FROM ended_at - started_at)::INTEGER) STORED,
    metadata_enc    BYTEA,
    source          VARCHAR(32)     NOT NULL,
    source_id       VARCHAR(256),
    imported_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT chk_period_end_after_start
        CHECK (ended_at > started_at),
    CONSTRAINT uq_periods_user_type_start_source
        UNIQUE (user_id, event_type, started_at, source)
);

-- GIST index for overlap queries (requires btree_gist extension)
CREATE INDEX IF NOT EXISTS idx_periods_user_timerange
    ON health_data_periods USING GIST (user_id, tstzrange(started_at, ended_at));

CREATE INDEX IF NOT EXISTS idx_periods_user_type_time
    ON health_data_periods(user_id, event_type, started_at, ended_at);

COMMENT ON TABLE health_data_periods IS 'Encrypted bounded-duration health events: sleep stages, workouts, fasting windows.';

-- ─── Step 6: Create metric_source_preferences table ─────────
CREATE TABLE IF NOT EXISTS metric_source_preferences (
    user_id     VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_type VARCHAR(64) NOT NULL,
    provider    VARCHAR(32) NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, metric_type)
);

COMMENT ON TABLE metric_source_preferences IS 'User-set preferred data source per metric type. Used for source resolution at query time.';
