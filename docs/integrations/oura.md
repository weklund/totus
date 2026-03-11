# Oura Ring Integration

### Status: Planned — self-serve developer access, no partnership required

### API: Oura API v2

### Auth: OAuth 2.0

### Developer portal: https://cloud.ouraring.com/personal-access-tokens (personal tokens) / https://cloud.ouraring.com/docs (OAuth apps)

---

## Access & Partnership

Oura's API is publicly accessible. OAuth app registration is available through the Oura developer portal with no approval gating for standard scopes. No partnership agreement required.

---

## Provider Config

```typescript
const ouraConfig: ProviderConfig = {
  id: "oura",
  displayName: "Oura Ring",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://cloud.ouraring.com/oauth/authorize",
    tokenUrl: "https://api.ouraring.com/oauth/token",
    revokeUrl: "https://api.ouraring.com/oauth/revoke",
    scopes: [
      "daily",
      "heartrate",
      "workout",
      "tag",
      "session",
      "sleep",
      "spo2",
    ],
    redirectUri: "https://app.totus.health/api/connections/oura/callback",
  },
  rateLimit: {
    requestsPerWindow: 5000,
    windowSeconds: 3600,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "sleep_score",
      "sleep_duration",
      "sleep_efficiency",
      "sleep_latency",
      "deep_sleep",
      "rem_sleep",
      "light_sleep",
      "awake_time",
      "hrv",
      "rhr",
      "respiratory_rate",
      "body_temperature_deviation",
      "readiness_score",
      "activity_score",
      "steps",
      "active_calories",
      "total_calories",
      "spo2",
    ],
    seriesMetrics: ["heart_rate", "spo2_interval"],
    periodTypes: ["sleep_stage", "workout"],
    historicalWindowDays: 3650,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 3, // Oura reprocesses sleep scores retroactively; re-fetch last 3 days
  },
  apiVersion: "v2",
  changelogUrl: "https://cloud.ouraring.com/v2/docs#section/Changelog",
};
```

---

## API Details

**Base URL:** `https://api.ouraring.com`

**Pagination:** All collection endpoints support cursor-based pagination via `next_token`. Pass `next_token` as the `next_token` query parameter on subsequent requests. A `null` / absent `next_token` in the response means no more pages.

**Rate limits:** 5,000 requests per hour per access token. The `Retry-After` header is returned on 429 responses.

**Token lifetime:** Access tokens expire after 24 hours. Refresh tokens do not expire but are single-use — each refresh issues a new refresh token.

**Endpoints used:**

| Endpoint                                 | Scope required | Data fetched                                                                                                     |
| ---------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /v2/usercollection/daily_sleep`     | `daily`        | sleep_score, sleep_duration, sleep_efficiency, hrv, rhr                                                          |
| `GET /v2/usercollection/sleep`           | `sleep`        | sleep_latency, deep/rem/light/awake durations, respiratory_rate, body_temperature_deviation; sleep stage periods |
| `GET /v2/usercollection/daily_readiness` | `daily`        | readiness_score                                                                                                  |
| `GET /v2/usercollection/daily_activity`  | `daily`        | activity_score, steps, active_calories, total_calories                                                           |
| `GET /v2/usercollection/daily_spo2`      | `spo2`         | spo2 (daily average)                                                                                             |
| `GET /v2/usercollection/heartrate`       | `heartrate`    | heart_rate series                                                                                                |
| `GET /v2/usercollection/spo2`            | `spo2`         | spo2_interval series                                                                                             |
| `GET /v2/usercollection/workout`         | `workout`      | workout periods                                                                                                  |

**Multiple endpoints per sync.** A full sync makes 4–5 sequential API calls (one per endpoint group). A typical incremental sync consumes <10 requests against the 5,000/hour budget.

---

## Field Mappings

### Daily Data

| Totus `metric_type`          | Endpoint          | Oura response field               | Unit conversion                  |
| ---------------------------- | ----------------- | --------------------------------- | -------------------------------- |
| `sleep_score`                | `daily_sleep`     | `score`                           | none                             |
| `sleep_duration`             | `daily_sleep`     | `contributors.total_sleep`        | seconds ÷ 3600 → hours (2dp)     |
| `sleep_efficiency`           | `daily_sleep`     | `contributors.efficiency`         | none (already %)                 |
| `sleep_latency`              | `sleep`           | `latency`                         | seconds ÷ 60 → minutes (integer) |
| `deep_sleep`                 | `sleep`           | `deep_sleep_duration`             | seconds ÷ 3600 → hours (2dp)     |
| `rem_sleep`                  | `sleep`           | `rem_sleep_duration`              | seconds ÷ 3600 → hours (2dp)     |
| `light_sleep`                | `sleep`           | `light_sleep_duration`            | seconds ÷ 3600 → hours (2dp)     |
| `awake_time`                 | `sleep`           | `awake_time`                      | seconds ÷ 60 → minutes (integer) |
| `hrv`                        | `daily_sleep`     | `contributors.hrv_balance`        | none (ms)                        |
| `rhr`                        | `daily_sleep`     | `contributors.resting_heart_rate` | none (bpm)                       |
| `respiratory_rate`           | `sleep`           | `average_breath`                  | none (rpm)                       |
| `body_temperature_deviation` | `sleep`           | `temperature_deviation`           | none (°C)                        |
| `readiness_score`            | `daily_readiness` | `score`                           | none                             |
| `activity_score`             | `daily_activity`  | `score`                           | none                             |
| `steps`                      | `daily_activity`  | `steps`                           | none                             |
| `active_calories`            | `daily_activity`  | `active_calories`                 | none (kcal)                      |
| `total_calories`             | `daily_activity`  | `total_calories`                  | none (kcal)                      |
| `spo2`                       | `daily_spo2`      | `spo2_percentage.average`         | none (%)                         |

### Series Data

| Totus `metric_type` | Endpoint                           | Notes                                                                                                                                 |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `heart_rate`        | `GET /v2/usercollection/heartrate` | Returns `[{timestamp, bpm}]` array. Each item → one `SeriesReading`. Frequency: ~1/min during sleep, ~1/5min during inactive periods. |
| `spo2_interval`     | `GET /v2/usercollection/spo2`      | Returns 5-min interval readings captured during sleep only.                                                                           |

**Series cursor:** `provider_connections.series_cursor` stores the Oura `next_token` for HR/SpO2 series, independent from the daily data cursor.

### Periods Data

| Totus `event_type` | `subtype`      | Endpoint  | Oura field                                     | Notes                          |
| ------------------ | -------------- | --------- | ---------------------------------------------- | ------------------------------ |
| `sleep_stage`      | `rem`          | `sleep`   | `sleep_phase_5_min`                            | Parse contiguous runs of `'r'` |
| `sleep_stage`      | `deep`         | `sleep`   | `sleep_phase_5_min`                            | Parse contiguous runs of `'d'` |
| `sleep_stage`      | `light`        | `sleep`   | `sleep_phase_5_min`                            | Parse contiguous runs of `'l'` |
| `sleep_stage`      | `awake`        | `sleep`   | `sleep_phase_5_min`                            | Parse contiguous runs of `'w'` |
| `workout`          | (mapped below) | `workout` | `sport_type`, `start_datetime`, `end_datetime` |                                |

**Sleep stage parsing.** `sleep_phase_5_min` is a string of characters, each representing a 5-minute window. Convert contiguous runs of the same character into `PeriodEvent` objects: `startedAt = sleep.bedtime_start + (index × 5min)`, `endedAt = startedAt + (run_length × 5min)`.

**Workout sport_type mapping:**

| Oura `sport_type` | Totus `subtype` |
| ----------------- | --------------- |
| `cycling`         | `cycle`         |
| `running`         | `run`           |
| `yoga`            | `yoga`          |
| `swimming`        | `swim`          |
| `weight_training` | `strength`      |
| All others        | `generic`       |

**Workout metadata stored in `metadata_enc`:** `{ calories, distance_m, avg_hr, max_hr, sport_type_raw }`

---

## Retry & Error Handling

| Error                   | Handling                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `429 Too Many Requests` | Respect `Retry-After` header. Inngest step delay.                                                         |
| `401 Unauthorized`      | Attempt token refresh. If refresh also returns 401, mark connection `status='expired'`.                   |
| `5xx`                   | Inngest retries with exponential backoff (1s → 4s → 16s, up to 3 retries).                                |
| Missing data for a date | Normal — not all metrics are available for every day (e.g., no workout data on rest days). Skip silently. |

---

## Known Limitations & Notes

- **Retroactive reprocessing.** Oura reprocesses sleep scores (particularly HRV and readiness) after the fact. The `correctionWindowDays: 3` config re-fetches the last 3 days on each sync to catch corrections.
- **Sleep record vs daily_sleep.** The `/v2/usercollection/sleep` endpoint returns a detailed sleep record (used for stages and latency), while `/v2/usercollection/daily_sleep` returns the summary score. Both are needed for a complete daily sync.
- **Multiple sleep records per day.** Oura can record multiple sleep sessions (e.g., nap + nighttime). The adapter should use the longest session for daily summary metrics and create period events for all sessions.
