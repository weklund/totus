-- Dashboard tables: metric_baselines, user_annotations, dismissed_insights
-- See: /docs/dashboard-backend-lld.md §3.1, §3.3, §3.4

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

--> statement-breakpoint

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

--> statement-breakpoint

CREATE TABLE dismissed_insights (
  user_id       VARCHAR(64)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insight_type  VARCHAR(64)     NOT NULL,
  reference_date DATE           NOT NULL,
  dismissed_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_dismissed_insights
    PRIMARY KEY (user_id, insight_type, reference_date)
);
