# Garmin Integration

### Status: Planned — partner application required

### API: Garmin Connect API (pull-based OAuth2) — see API selection note below

### Auth: OAuth 2.0

### Developer portal: https://developer.garmin.com/gc-developer-program/overview/

---

## Access & Partnership

Garmin's developer program requires an application and approval. There is no self-serve sandbox. Steps:

1. Apply at developer.garmin.com/gc-developer-program
2. Describe use case (personal health data platform, user-initiated OAuth)
3. Approval typically takes 1–3 weeks
4. Garmin issues OAuth client credentials after approval

---

## Critical: API Selection — Connect API vs. Health API

Garmin offers two distinct developer APIs. **The choice must be confirmed during the partner application.**

|                             | Garmin Connect API                                          | Garmin Health API                                                |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| **Pattern**                 | Pull (OAuth2, client requests data)                         | Push (Garmin POSTs data to a webhook)                            |
| **Fits `ProviderAdapter`?** | Yes — maps directly to `fetchDailyData` / `fetchSeriesData` | No — requires a separate webhook ingestion path                  |
| **Scopes**                  | `HEALTH_SUMMARY`, `SLEEP`, `BODY_COMPOSITION`, `ACTIVITY`   | Push subscription per data type                                  |
| **Historical data**         | Available via date-range query                              | Not available for historical; only new data pushed going forward |
| **Developer access**        | Partner application                                         | Partner application                                              |

**This config targets the Connect API.** If Garmin grants access only to the Health API, the adapter pattern in `integrations-pipeline-lld.md §5` does not apply — a webhook receiver would be needed instead. Resolve during partner application (open question §11.4 in the LLD).

---

## Provider Config

```typescript
const garminConfig: ProviderConfig = {
  id: "garmin",
  displayName: "Garmin Connect",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://connect.garmin.com/oauthConfirm",
    tokenUrl: "https://connectapi.garmin.com/oauth-service/oauth/token",
    revokeUrl:
      "https://connectapi.garmin.com/oauth-service/oauth/deregistration",
    scopes: ["HEALTH_SUMMARY", "SLEEP", "BODY_COMPOSITION"],
    redirectUri: "https://app.totus.health/api/connections/garmin/callback",
  },
  rateLimit: {
    requestsPerWindow: 300,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "steps",
      "active_calories",
      "total_calories",
      "rhr",
      "hrv",
      "spo2",
      "sleep_duration",
      "sleep_score",
      "weight",
      "bmi",
      "body_fat_pct",
      "muscle_mass_kg",
      "bone_mass_kg",
    ],
    seriesMetrics: ["heart_rate", "spo2_interval"],
    periodTypes: ["sleep_stage", "workout"],
    historicalWindowDays: 365,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 1,
  },
  apiVersion: "v1",
  changelogUrl: "https://developer.garmin.com/gc-developer-program/changelog/",
};
```

---

## API Details

**Base URL:** `https://apis.garmin.com`

**Endpoints used (Connect API):**

| Endpoint                            | Scope              | Data fetched                                                        |
| ----------------------------------- | ------------------ | ------------------------------------------------------------------- |
| `GET /wellness-api/rest/dailies`    | `HEALTH_SUMMARY`   | steps, active_calories, total_calories, rhr                         |
| `GET /wellness-api/rest/epochs`     | `HEALTH_SUMMARY`   | heart_rate series (15-sec intervals during activity, 1/min at rest) |
| `GET /wellness-api/rest/sleeps`     | `SLEEP`            | sleep_duration, sleep_score, sleep stage periods                    |
| `GET /wellness-api/rest/hrv`        | `HEALTH_SUMMARY`   | hrv (daily overnight HRV)                                           |
| `GET /wellness-api/rest/pulseOx`    | `HEALTH_SUMMARY`   | spo2, spo2_interval                                                 |
| `GET /wellness-api/rest/bodyComps`  | `BODY_COMPOSITION` | weight, bmi, body_fat_pct, muscle_mass_kg, bone_mass_kg             |
| `GET /wellness-api/rest/activities` | `HEALTH_SUMMARY`   | workout periods                                                     |

**Pagination:** Date-range parameters (`startTimeInSeconds`, `endTimeInSeconds` as Unix timestamps). Max range per request varies by endpoint (typically 1–7 days). Adapter must chunk requests into appropriate windows.

**Rate limits:** 300 requests/minute per token.

**Token lifetime:** Access tokens expire after 1 hour. Refresh tokens do not expire but are revoked on deregistration.

---

## Field Mappings

### Daily Data

| Totus `metric_type` | Endpoint    | Garmin field                       | Notes                                |
| ------------------- | ----------- | ---------------------------------- | ------------------------------------ |
| `steps`             | `dailies`   | `steps`                            | none                                 |
| `active_calories`   | `dailies`   | `activeKilocalories`               | none                                 |
| `total_calories`    | `dailies`   | `totalKilocalories`                | none                                 |
| `rhr`               | `dailies`   | `restingHeartRateInBeatsPerMinute` | none                                 |
| `hrv`               | `hrv`       | `lastNight.avgOvernight`           | ms                                   |
| `spo2`              | `pulseOx`   | `averageSpO2`                      | none (%)                             |
| `sleep_duration`    | `sleeps`    | `durationInSeconds`                | seconds ÷ 3600 → hours (2dp)         |
| `sleep_score`       | `sleeps`    | `sleepScores.overall.value`        | none                                 |
| `weight`            | `bodyComps` | `weight`                           | kg (Garmin reports in grams; ÷ 1000) |
| `bmi`               | `bodyComps` | `bmi`                              | none                                 |
| `body_fat_pct`      | `bodyComps` | `bodyFat`                          | none (%)                             |
| `muscle_mass_kg`    | `bodyComps` | `muscleMass`                       | grams ÷ 1000 → kg                    |
| `bone_mass_kg`      | `bodyComps` | `boneMass`                         | grams ÷ 1000 → kg                    |

### Series Data

| Totus `metric_type` | Endpoint  | Notes                                                                                                                                            |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `heart_rate`        | `epochs`  | Each epoch is a 15-second (during activity) or 1-minute (at rest) interval. Each interval → one `SeriesReading` at the interval start timestamp. |
| `spo2_interval`     | `pulseOx` | 1 reading per pulse ox sample during sleep.                                                                                                      |

### Periods Data

| `event_type`  | `subtype`      | Endpoint     | Garmin field               | Notes                                                    |
| ------------- | -------------- | ------------ | -------------------------- | -------------------------------------------------------- |
| `sleep_stage` | `rem`          | `sleeps`     | `sleepLevelsMap.rem` array | Each entry has `startTimeInSeconds` + `endTimeInSeconds` |
| `sleep_stage` | `deep`         | `sleeps`     | `sleepLevelsMap.deep`      |                                                          |
| `sleep_stage` | `light`        | `sleeps`     | `sleepLevelsMap.light`     |                                                          |
| `sleep_stage` | `awake`        | `sleeps`     | `sleepLevelsMap.awake`     |                                                          |
| `workout`     | (mapped below) | `activities` | `activityType`             |                                                          |

**Activity type mapping:**

| Garmin `activityType` | Totus `subtype` |
| --------------------- | --------------- |
| `CYCLING`             | `cycle`         |
| `RUNNING`             | `run`           |
| `STRENGTH_TRAINING`   | `strength`      |
| `YOGA`                | `yoga`          |
| `SWIMMING`            | `swim`          |
| All others            | `generic`       |

---

## Retry & Error Handling

| Error                        | Handling                                                   |
| ---------------------------- | ---------------------------------------------------------- |
| `429`                        | Respect `Retry-After`. Inngest step delay.                 |
| `401`                        | Refresh token. If refresh fails, `status='expired'`.       |
| `5xx`                        | Retry 3× with exponential backoff.                         |
| Empty response for body comp | Normal — not all users have a Garmin scale. Skip silently. |

---

## Known Limitations & Notes

- **Body composition requires Garmin Index scale.** The `BODY_COMPOSITION` scope only returns data if the user has a Garmin-connected smart scale. If no scale is paired, the endpoint returns empty results — this is expected and should not be treated as an error.
- **Historical window is 1 year** (vs. Oura's 10 years). Initial backfill is capped at 365 days.
- **Sleep score availability.** Not all Garmin devices generate a sleep score. If `sleepScores` is absent, skip `sleep_score` for that day.
