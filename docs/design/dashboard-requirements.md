# Dashboard Backend Requirements

Requirements derived from wireframes W1–W5, user scenarios S1–S8, and gap
analysis against the existing API & Database LLD.

Reference: [Wireframes](./wireframes.md) | [User Scenarios](./user-scenarios.md)

---

## Existing Backend Coverage

The current API/DB LLD already covers:

- Raw health data retrieval (`GET /api/health-data`) with metric filtering,
  date ranges, and resolution (daily/weekly/monthly)
- Intraday series data (`health_data_series` table, partitioned by time)
- Period/event data (`health_data_periods` table — sleep stages, workouts)
- Share grants with metric + date scoping
- Viewer permission enforcement
- Audit logging

**What's missing** is everything the dashboard needs _on top of_ raw data:
baselines, statistics, correlations, anomaly detection, insights, and
view-specific aggregations. These are the requirements below.

---

## Functional Requirements

### FR-1: Personal Baseline Statistics

**Wireframes:** W1, W2, W3, W5 (baseline bands on every sparkline)
**Scenarios:** S2, S3, S5, S7

Every metric strip in the wireframes shows a "normal range" band (personal
30-day average +/- 1 standard deviation). Users cannot interpret raw values
without this context.

**Requirements:**

- FR-1.1: The system shall compute a rolling 30-day personal average for each
  metric the user has data for.
- FR-1.2: The system shall compute the rolling 30-day standard deviation for
  each metric.
- FR-1.3: Baseline statistics shall be returned alongside raw data in the API
  response so the client can render bands without a second round-trip.
- FR-1.4: Baselines shall be computed relative to the _start_ of the requested
  date range (i.e., the 30 days preceding the view window), not the current
  date, so historical views show historically-accurate baselines.
- FR-1.5: The system shall compute delta-from-baseline for each data point
  (e.g., "+11 bpm vs avg") for use in summary strips and delta badges.

**User story:** _As a user viewing my night data, I want to see my personal
normal range for heart rate so I can tell at a glance whether 72 bpm is
unusual for me._

---

### FR-2: Summary Metrics with Deltas

**Wireframes:** W1 (summary strip), W2 (daily scores)
**Scenarios:** S1, S2, S3

The summary strip at the bottom of W1 shows key metrics with their
delta-from-average. The daily scores table in W2 shows color-coded values.

**Requirements:**

- FR-2.1: The API shall return a `summary` object for a given date containing
  the metric value, 30-day average, delta (value minus average), and delta
  direction (better/worse, accounting for metric polarity — lower RHR is better,
  higher HRV is better).
- FR-2.2: Each summary metric shall include a `status` field indicating its
  quartile relative to the user's 30-day distribution: `critical` (bottom 10%),
  `warning` (10-25th percentile), `normal` (25-75th), `good` (top 25%).
- FR-2.3: For multi-day views (W2), the API shall return summary data for each
  day in the range in a single request.

**User story:** _As a user, I want to see that my sleep score of 64 is 19
points below my average, colored red, so I immediately know it was a bad
night._

---

### FR-3: Correlation Analysis

**Wireframes:** W3 (correlation card)
**Scenarios:** S4

The 30-day trend view shows Pearson correlation coefficients between metric
pairs (e.g., "RHR <-> Sleep Score: -0.72").

**Requirements:**

- FR-3.1: The system shall compute pairwise Pearson correlation coefficients
  between any two metrics over a user-specified date range.
- FR-3.2: The API shall accept a list of metric pairs and return the correlation
  coefficient and a human-readable strength label (strong/moderate/weak,
  positive/negative/inverse) for each pair.
- FR-3.3: Correlation shall only be computed when both metrics have >= 7
  overlapping data points in the range. Otherwise, return `insufficient_data`.
- FR-3.4: The system shall support correlation for viewer sessions, scoped to
  the granted metrics and date range.

**User story:** _As a patient preparing for a cardiology appointment, I want to
see that my rising RHR has a -0.72 correlation with my declining sleep score
so I can show my doctor the relationship._

---

### FR-4: Trend Detection

**Wireframes:** W3 (trend arrows, start/end values)
**Scenarios:** S4, S7

The trend view shows directional trends (e.g., "58 -> 66 bpm, +14%").

**Requirements:**

- FR-4.1: The system shall compute linear trend direction and magnitude for
  each metric over the requested date range (slope of linear regression, or
  simple start-vs-end comparison with percentage change).
- FR-4.2: The system shall classify trends as `rising`, `falling`, or `stable`
  based on whether the change exceeds a configurable noise threshold (e.g., >5%
  change = trending).
- FR-4.3: Trend data shall be included in the API response for 30D+ views.

**User story:** _As a user, I want to see that my HRV has dropped 33% over 30
days so I can take that data to my doctor._

---

### FR-5: Rolling Averages

**Wireframes:** W3 (7-day rolling average line + raw dots)
**Scenarios:** S4, S6

The 30-day trend view shows both raw daily values and a smoothed 7-day rolling
average.

**Requirements:**

- FR-5.1: The API shall support a `smoothing` parameter on health data queries
  with options: `none` (raw), `7d` (7-day rolling average), `30d` (30-day
  rolling average).
- FR-5.2: When smoothing is requested, the response shall include both the raw
  data points and the smoothed series so the client can render both
  simultaneously (raw as dots, smoothed as line).
- FR-5.3: Rolling averages shall handle gaps in data gracefully (skip missing
  days, average over available points in the window).

**User story:** _As a user looking at 30 days of data, I want a smoothed trend
line so daily noise doesn't obscure the real direction._

---

### FR-6: Anomaly Detection

**Wireframes:** W5 (anomaly card, deviation bars)
**Scenarios:** S7

The anomaly view alerts when multiple metrics simultaneously deviate from
baseline.

**Requirements:**

- FR-6.1: The system shall flag a metric as anomalous when its value falls
  outside the personal 30-day average +/- 2 standard deviations.
- FR-6.2: The system shall compute a daily anomaly score: the count of metrics
  that are simultaneously anomalous.
- FR-6.3: When the anomaly score >= 3 (3+ metrics outside normal range), the
  system shall generate an anomaly alert for that date.
- FR-6.4: For each anomalous metric, the API shall return: the metric name,
  current value, baseline average, deviation magnitude (in absolute units and
  as a multiplier of SD), and deviation direction.
- FR-6.5: Anomaly detection shall run for the current day and the past 7 days
  to provide context.

**User story:** _As a user, I want to be alerted when 5 of my 6 metrics are
off simultaneously so I can recognize an illness pattern early._

---

### FR-7: Historical Pattern Matching

**Wireframes:** W5 (side-by-side comparison, "similar to Jan 12", 94% match)
**Scenarios:** S7

The anomaly view compares today's multi-metric deviation pattern to past
similar events.

**Requirements:**

- FR-7.1: The system shall maintain an index of past anomaly events (dates
  where anomaly score >= 3).
- FR-7.2: When an anomaly is detected, the system shall compute cosine
  similarity between the current deviation vector and each past anomaly's
  deviation vector.
- FR-7.3: The API shall return the top-1 most similar historical anomaly with:
  date, metric values at that time, similarity percentage, and any user-created
  label for that date (e.g., "flu onset").
- FR-7.4: Users shall be able to label past anomaly events with a freeform
  note (e.g., "flu", "travel", "medication change") to make future pattern
  matches more useful.

**User story:** _As a user seeing an anomaly alert, I want to know "this looks
like your flu onset on Jan 12" so I can take early action._

---

### FR-8: Weekly Pattern Aggregation

**Wireframes:** W4 (heatmap, day-of-week sparklines)
**Scenarios:** S6

The weekly pattern view shows metrics averaged by day-of-week over N weeks.

**Requirements:**

- FR-8.1: The API shall support a `group_by=day_of_week` aggregation mode that
  returns the average value for each metric grouped by Monday–Sunday over the
  requested date range.
- FR-8.2: The response shall include per-day-of-week: mean, standard deviation,
  sample count, and quartile rank (1–4) relative to other days.
- FR-8.3: The system shall compute week-to-week variance for each metric
  (standard deviation of the weekly means) and classify it as `high`,
  `moderate`, or `low`.
- FR-8.4: The minimum date range for weekly pattern analysis shall be 4 weeks
  (28 days). Requests shorter than 4 weeks shall return an
  `insufficient_data` error.

**User story:** _As a knowledge worker, I want to see that my readiness is
consistently worst on Mondays (avg 62) so I can confirm my weekend habits are
creating a recovery debt._

---

### FR-9: Insight Generation

**Wireframes:** W1, W2, W4 (insight cards with narrative text)
**Scenarios:** S1, S2, S3, S5, S6

Insight cards show natural-language summaries of detected patterns.

**Requirements:**

- FR-9.1: The system shall generate contextual insight text when specific
  conditions are met:
  - **Sleep disruption** (W1): When sleep latency > 2x baseline OR deep sleep
    < 50% of baseline, AND a correlated event (glucose spike, elevated HR)
    exists in the preceding hours.
  - **Recovery arc** (W2): When a workout/event preceded a multi-day HRV/
    readiness dip and subsequent recovery to baseline.
  - **Weekly rhythm** (W4): When day-of-week variance is `high` and a
    consistent peak/trough pattern exists.
  - **Anomaly** (W5): When anomaly score >= 3 (handled by FR-6).
- FR-9.2: Insights shall be structured objects (not free text) containing:
  `type`, `title`, `body` (templated text with interpolated values),
  `related_metrics[]`, `severity` (info/warning), and `dismissible` (boolean).
- FR-9.3: Dismissed insights shall be tracked per-user so they are not shown
  again for the same date.
- FR-9.4: Insights shall be available to viewers through share grants (scoped
  to granted metrics).

**User story:** _As a user, I want a narrative summary like "Your resting HR
was 11 bpm above your 30-day average" so I don't have to do the mental math
myself._

---

### FR-10: Annotation / Event Layer

**Wireframes:** W1, W2 (meal markers, workout markers with vertical lines)
**Scenarios:** S1, S2, S3, S5

Annotation markers (meals, workouts, travel) span across all chart panels.

**Requirements:**

- FR-10.1: The API shall return event/annotation data alongside health data
  queries, filtered to the same date range.
- FR-10.2: Events from provider integrations (Oura workouts, Cronometer meals)
  shall be surfaced automatically from the `health_data_periods` table.
- FR-10.3: Users shall be able to create manual annotations with: timestamp,
  event type (meal, workout, travel, alcohol, medication, custom), and optional
  freeform note.
- FR-10.4: Manual annotations shall be stored in a new `user_annotations`
  table (not `health_data_periods`, which is provider-sourced).
- FR-10.5: The API shall merge provider events and user annotations into a
  unified timeline response, sorted by timestamp.
- FR-10.6: Annotations shall be included in shared views if the share grant
  includes the annotation's related metric category.

**User story:** _As a user, I want to see a meal marker at 9:30 PM on my
glucose and heart rate charts so I can visually connect the spike to the
meal._

---

### FR-11: View-Specific Data Endpoints

**Wireframes:** W1 (night), W2 (recovery), W3 (trend), W4 (weekly), W5 (anomaly)

Each wireframe view composes data differently. Rather than requiring the client
to make 5+ separate API calls per view, the backend should offer composed
endpoints.

**Requirements:**

- FR-11.1: **Night Detail endpoint** — Returns for a single date: intraday
  series (glucose, HR), sleep hypnogram periods, daily summary metrics with
  deltas, baseline stats, annotations, and applicable insights. One request.
- FR-11.2: **Recovery endpoint** — Returns for a date range (3–7 days): daily
  metric values with baselines, daily summary scores with status colors,
  triggering event (workout/travel), and applicable insights. One request.
- FR-11.3: **Trend endpoint** — Returns for a date range (30D+): daily values
  with rolling averages, trend direction, pairwise correlations for selected
  metrics, and baseline stats. One request.
- FR-11.4: **Weekly Pattern endpoint** — Returns for a date range (28D+):
  day-of-week aggregations, sparkline data, variance scores, and applicable
  insights. One request.
- FR-11.5: **Anomaly endpoint** — Returns for a single date: anomaly score,
  per-metric deviations, 7-day context sparklines, historical pattern match,
  and applicable insights. One request.
- FR-11.6: All view endpoints shall respect viewer permissions (metric scoping,
  date clamping).

**User story:** _As a frontend developer, I want a single API call to load the
Night Detail View so the dashboard renders in under 2 seconds._

---

### FR-12: Share-Aware Computed Data

**Wireframes:** W3 (share panel preserving correlation context)
**Scenarios:** S4, S8

Shared views must include computed data (baselines, correlations, insights),
not just raw values.

**Requirements:**

- FR-12.1: Share grants shall store a `view_type` field indicating which
  dashboard view the owner shared from (night, recovery, trend, weekly), so the
  viewer sees the same composed view.
- FR-12.2: Computed data (baselines, correlations, insights) shall be generated
  at share-view time using the granted metrics and date range — not cached from
  the owner's session.
- FR-12.3: The viewer endpoint shall support all view-specific endpoints
  (FR-11.1–11.5) with the same response shapes, scoped to the grant.

**User story:** _As a patient sharing 30 days of data with my cardiologist, I
want the shared view to include the correlation between my RHR and sleep score,
not just raw numbers._

---

## Technical Requirements

### TR-1: Baseline Computation Performance

**Related:** FR-1

- TR-1.1: Baseline computation (30-day avg + SD) for up to 20 metrics shall
  complete in < 200ms at p95.
- TR-1.2: Baselines shall be computed via SQL window functions
  (`AVG() OVER`, `STDDEV() OVER`) over the `health_data_daily` table, not via
  application-level iteration.
- TR-1.3: An index on `(user_id, metric_type, date)` already exists (from the
  UNIQUE constraint in the LLD). Verify this is sufficient for baseline window
  queries; add a covering index if needed.
- TR-1.4: Consider materializing baselines into a `metric_baselines` cache
  table (user_id, metric_type, date, avg_30d, stddev_30d) refreshed daily via
  background job, to avoid recomputing on every request.

---

### TR-2: Correlation Computation

**Related:** FR-3

- TR-2.1: Pearson correlation shall be computed via SQL (`corr()` aggregate
  function in PostgreSQL) over a self-join of `health_data_daily` on the two
  metrics, filtered by user and date range.
- TR-2.2: For up to 3 metric pairs, correlation computation shall complete in
  < 300ms at p95.
- TR-2.3: Decrypted values are required for computation. Batch-decrypt the
  relevant rows, compute in-memory, and discard plaintext. Do not store
  decrypted values.

---

### TR-3: Anomaly Detection Pipeline

**Related:** FR-6, FR-7

- TR-3.1: Anomaly detection shall run as a daily background job (Inngest cron)
  that processes each user's latest day of data.
- TR-3.2: Results shall be persisted in a new `anomaly_events` table:
  ```
  anomaly_events
  ├── id BIGSERIAL PK
  ├── user_id FK
  ├── date DATE
  ├── anomaly_score INTEGER (count of anomalous metrics)
  ├── deviations JSONB (per-metric: value, avg, stddev, z_score)
  ├── pattern_match_date DATE (most similar historical event)
  ├── pattern_match_similarity FLOAT
  ├── user_label VARCHAR(255) (user-assigned, nullable)
  ├── created_at TIMESTAMPTZ
  └── UNIQUE(user_id, date)
  ```
- TR-3.3: Historical pattern matching (cosine similarity) shall be computed
  against at most the 50 most recent past anomaly events to bound computation
  time.
- TR-3.4: Anomaly detection shall only trigger for metrics with >= 14 days of
  baseline data (to avoid false positives for new users).

---

### TR-4: User Annotations Table

**Related:** FR-10

- TR-4.1: Add a `user_annotations` table:
  ```
  user_annotations
  ├── id BIGSERIAL PK
  ├── user_id FK
  ├── event_type VARCHAR(32) (meal, workout, travel, alcohol, medication, custom)
  ├── label VARCHAR(255)
  ├── note TEXT (nullable)
  ├── occurred_at TIMESTAMPTZ
  ├── ended_at TIMESTAMPTZ (nullable, for duration events)
  ├── created_at TIMESTAMPTZ
  ├── updated_at TIMESTAMPTZ
  └── INDEX(user_id, occurred_at)
  ```
- TR-4.2: Annotations shall NOT be encrypted (they contain no biometric data,
  only user-entered labels). This avoids the KMS cost for annotation CRUD.
- TR-4.3: CRUD endpoints: `POST /api/annotations`, `GET /api/annotations`,
  `PATCH /api/annotations/:id`, `DELETE /api/annotations/:id`.

---

### TR-5: Insight Generation Engine

**Related:** FR-9

- TR-5.1: Insights shall be generated on-demand (not pre-computed) as part of
  the view-specific endpoint response. This avoids stale insights.
- TR-5.2: Insight generation shall be implemented as a rule engine — an ordered
  list of condition/template pairs evaluated against the computed data already
  available in the endpoint handler.
- TR-5.3: Rules shall be defined in code (not a database), versioned with the
  application, and unit-testable.
- TR-5.4: Each rule shall have a priority. If multiple rules fire, return the
  top-priority insight (to avoid overwhelming the user).
- TR-5.5: Insight dismissals shall be stored in a `dismissed_insights` table:
  ```
  dismissed_insights
  ├── user_id FK
  ├── insight_type VARCHAR(64)
  ├── date DATE
  ├── dismissed_at TIMESTAMPTZ
  └── PK(user_id, insight_type, date)
  ```

---

### TR-6: View-Specific API Endpoints

**Related:** FR-11

- TR-6.1: Implement five composed endpoints:
  ```
  GET /api/views/night?date=2026-03-28
  GET /api/views/recovery?start=2026-03-24&end=2026-03-28&event_id=...
  GET /api/views/trend?start=2026-02-27&end=2026-03-28&metrics=rhr,hrv,sleep_score
  GET /api/views/weekly?start=2026-02-01&end=2026-03-28&metrics=readiness_score,sleep_score,hrv,rhr,deep_sleep
  GET /api/views/anomaly?date=2026-03-28
  ```
- TR-6.2: Each endpoint shall internally compose calls to the existing data
  layer (health-data queries, period queries, baseline computation, etc.) and
  return a single unified response.
- TR-6.3: Response payloads shall be designed for zero client-side computation
  — all baselines, deltas, statuses, correlations, insights, and annotations
  included.
- TR-6.4: View endpoints shall support a `grant_token` query parameter for
  viewer access, applying the same permission scoping as the existing viewer
  endpoints.

---

### TR-7: Weekly Aggregation Query

**Related:** FR-8

- TR-7.1: Day-of-week aggregation shall use PostgreSQL's `EXTRACT(DOW FROM
  date)` to group decrypted daily values by weekday.
- TR-7.2: Quartile ranking shall be computed via `NTILE(4)` window function
  over the 7 day-of-week averages.
- TR-7.3: The week-to-week variance computation requires grouping by
  `(ISO_WEEK, metric)` first, then computing `STDDEV()` of the weekly averages.

---

### TR-8: Encryption Considerations for Computed Data

**Related:** TR-1, TR-2, TR-7

- TR-8.1: All computation (baselines, correlations, anomaly detection, weekly
  patterns) requires decrypted values. Batch-decrypt the required rows using
  the cached DEK, compute in-memory, return results. Never persist decrypted
  health data.
- TR-8.2: Computed results (baselines, correlations, anomaly scores) are
  _derived_ from health data but are not themselves PHI. They may be stored
  unencrypted in cache/materialized tables to improve performance.
- TR-8.3: The `anomaly_events.deviations` JSONB column stores z-scores and
  averages (statistical derivatives), not raw health values. This is acceptable
  to store unencrypted.

---

### TR-9: Share Grant Schema Extension

**Related:** FR-12

- TR-9.1: Add `view_type VARCHAR(32)` column to `share_grants` table with
  values: `night`, `recovery`, `trend`, `weekly`, `anomaly`, `custom`.
- TR-9.2: Add `view_params JSONB` column to store view-specific parameters
  (e.g., for recovery: `{ "event_id": "..." }`; for trend:
  `{ "smoothing": "7d", "correlations": [["rhr","sleep_score"]] }`).
- TR-9.3: The viewer endpoint shall use `view_type` to route to the correct
  composed view endpoint, using `view_params` as additional input.

---

### TR-10: Response Shape Contracts

**Related:** FR-11, all wireframes

Define TypeScript-compatible response shapes (validated with Zod) for each
view endpoint. These become the contract between backend and frontend.

- TR-10.1: **Night Detail Response:**
  ```
  {
    date: string
    insights: Insight[]
    annotations: Annotation[]
    series: {
      [metricType]: { timestamps: number[], values: number[] }
    }
    hypnogram: {
      stages: { stage: string, start: string, end: string }[]
    }
    summary: {
      [metricType]: {
        value: number, avg_30d: number, stddev_30d: number,
        delta: number, delta_pct: number, direction: "better"|"worse",
        status: "critical"|"warning"|"normal"|"good"
      }
    }
    baselines: {
      [metricType]: { avg: number, stddev: number, upper: number, lower: number }
    }
  }
  ```

- TR-10.2: **Recovery Response:**
  ```
  {
    date_range: { start: string, end: string }
    triggering_event: Annotation | null
    insights: Insight[]
    daily: {
      [date]: {
        metrics: {
          [metricType]: {
            value: number, baseline: number, delta: number,
            status: "critical"|"warning"|"normal"|"good"
          }
        }
      }
    }
    baselines: { [metricType]: Baseline }
    sparklines: {
      [metricType]: { dates: string[], values: number[] }
    }
  }
  ```

- TR-10.3: **Trend Response:**
  ```
  {
    date_range: { start: string, end: string }
    resolution: "daily"|"7d_avg"|"monthly"
    insights: Insight[]
    metrics: {
      [metricType]: {
        raw: { dates: string[], values: number[] }
        smoothed: { dates: string[], values: number[] } | null
        trend: { direction: "rising"|"falling"|"stable", start_value: number, end_value: number, change_pct: number }
        baseline: Baseline
      }
    }
    correlations: {
      pair: [string, string]
      coefficient: number
      strength: "strong"|"moderate"|"weak"
      direction: "positive"|"inverse"
    }[]
  }
  ```

- TR-10.4: **Weekly Pattern Response:**
  ```
  {
    date_range: { start: string, end: string }
    weeks_analyzed: number
    insights: Insight[]
    heatmap: {
      [metricType]: {
        days: {
          [dow: 0-6]: { avg: number, stddev: number, n: number, quartile: 1|2|3|4 }
        }
        polarity: "higher_is_better"|"lower_is_better"
      }
    }
    sparklines: {
      [metricType]: { values: [number, number, number, number, number, number, number] }  // Mon–Sun
    }
    variance: {
      [metricType]: { score: number, level: "high"|"moderate"|"low" }
    }
  }
  ```

- TR-10.5: **Anomaly Response:**
  ```
  {
    date: string
    anomaly_score: number
    threshold: number
    insights: Insight[]
    deviations: {
      [metricType]: {
        value: number, avg: number, stddev: number,
        z_score: number, deviation_magnitude: number,
        direction: "above"|"below", is_anomalous: boolean
      }
    }
    context_sparklines: {
      [metricType]: {
        dates: string[], values: number[],
        baseline: Baseline
      }
    }
    historical_match: {
      date: string, label: string | null,
      similarity: number,
      deviations: { [metricType]: { value: number } }
    } | null
  }
  ```

---

## New Database Objects Summary

| Object | Type | Purpose |
|--------|------|---------|
| `anomaly_events` | Table | Persisted anomaly detection results |
| `user_annotations` | Table | Manual event markers (meals, travel, etc.) |
| `dismissed_insights` | Table | Per-user insight dismissal tracking |
| `share_grants.view_type` | Column | Which dashboard view was shared |
| `share_grants.view_params` | Column | View-specific share parameters |
| `metric_baselines` | Table (optional) | Materialized baseline cache |

---

## New API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/views/night` | GET | Composed Night Detail data |
| `/api/views/recovery` | GET | Composed Multi-Day Recovery data |
| `/api/views/trend` | GET | Composed 30-Day Trend data |
| `/api/views/weekly` | GET | Composed Weekly Pattern data |
| `/api/views/anomaly` | GET | Composed Anomaly Alert data |
| `/api/annotations` | CRUD | Manual user annotations |
| `/api/anomalies` | GET | Anomaly history with labels |
| `/api/anomalies/:id/label` | PATCH | Label a past anomaly event |
| `/api/insights/:type/:date/dismiss` | POST | Dismiss an insight |

---

## Priority Mapping

| Priority | Requirements | Rationale |
|----------|-------------|-----------|
| P0 — MVP | FR-1, FR-2, FR-5, FR-10, FR-11, TR-1, TR-4, TR-6, TR-10 | Core data + baselines needed for every view |
| P1 — Launch | FR-3, FR-4, FR-9, FR-12, TR-2, TR-5, TR-9 | Correlations, trends, insights, sharing |
| P2 — Post-launch | FR-6, FR-7, FR-8, TR-3, TR-7 | Anomaly detection, pattern matching, weekly patterns |

---

## Acceptance Criteria Checklist

- [ ] Each of the 5 view endpoints returns all data needed to render its
      wireframe in a single HTTP request
- [ ] Baseline bands (avg +/- 1 SD) appear on every metric sparkline
- [ ] Summary metrics show delta-from-average with correct polarity
- [ ] 30-day view shows 7-day rolling average alongside raw data
- [ ] Correlation coefficients are correct (verified against manual calculation)
- [ ] Anomaly alert fires when 3+ metrics exceed 2 SD from baseline
- [ ] Historical pattern match returns the most similar past anomaly
- [ ] Weekly heatmap shows correct day-of-week averages over 4+ weeks
- [ ] Insight cards display when conditions are met and can be dismissed
- [ ] Manual annotations appear as markers across all chart panels
- [ ] Shared views include computed data (baselines, correlations, insights)
- [ ] All view endpoints respond in < 500ms at p95 for 1 year of data
- [ ] Viewer permission scoping is enforced on all view endpoints
