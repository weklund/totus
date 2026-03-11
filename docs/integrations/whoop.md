# Whoop Integration

### Status: Planned — self-serve developer access

### API: Whoop API v1

### Auth: OAuth 2.0 + PKCE

### Developer portal: https://developer.whoop.com

---

## Access & Partnership

Whoop provides self-serve OAuth2 developer access with no approval gating. Register an app at developer.whoop.com and receive client credentials immediately. PKCE is required — there is no non-PKCE flow for Whoop.

---

## Provider Config

```typescript
const whoopConfig: ProviderConfig = {
  id: "whoop",
  displayName: "Whoop",
  authType: "oauth2_pkce",
  auth: {
    authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
    tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
    revokeUrl: "https://api.prod.whoop.com/oauth/oauth2/revoke",
    scopes: [
      "offline",
      "read:recovery",
      "read:sleep",
      "read:workout",
      "read:body_measurement",
    ],
    redirectUri: "https://app.totus.health/api/connections/whoop/callback",
  },
  rateLimit: {
    requestsPerWindow: 100,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "hrv",
      "rhr",
      "respiratory_rate",
      "sleep_duration",
      "sleep_efficiency",
      "readiness_score",
      "active_calories",
    ],
    seriesMetrics: ["heart_rate"],
    periodTypes: ["sleep_stage", "workout"],
    historicalWindowDays: 730,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 1,
  },
  apiVersion: "v1",
  changelogUrl: "https://developer.whoop.com/api/changelog",
};
```

---

## OAuth 2.0 + PKCE Flow

Whoop requires PKCE (Proof Key for Code Exchange). The authorization server validates the `code_challenge` on the authorize request against the `code_verifier` on the token exchange.

**Implementation:**

1. Generate a cryptographically random `code_verifier` (43–128 chars, URL-safe base64 without padding).
2. Compute `code_challenge = BASE64URL(SHA256(code_verifier))`.
3. Pass `code_challenge` and `code_challenge_method=S256` on the authorize redirect.
4. Pass `code_verifier` on the token exchange (`POST /oauth/oauth2/token`).
5. Store nothing — `code_verifier` is single-use and discarded after token exchange.

The `ProviderAdapter.exchangeCodeForTokens(code, codeVerifier?)` signature accommodates PKCE via the optional `codeVerifier` parameter.

---

## API Details

**Base URL:** `https://api.prod.whoop.com/developer`

**Pagination:** All list endpoints support cursor pagination via `nextToken` in the response. Pass `nextToken` as the `nextToken` query parameter.

**Rate limits:** 100 requests/minute per access token.

**Token lifetime:** Access tokens expire after 1 hour. Refresh tokens expire after 30 days of inactivity. The `offline` scope is required to receive a refresh token.

**Endpoints used:**

| Endpoint                        | Scope                   | Data fetched                                          |
| ------------------------------- | ----------------------- | ----------------------------------------------------- |
| `GET /v1/recovery`              | `read:recovery`         | hrv, rhr, readiness_score (called "recovery score")   |
| `GET /v1/sleep`                 | `read:sleep`            | sleep_duration, sleep_efficiency, sleep stage periods |
| `GET /v1/workout`               | `read:workout`          | workout periods, active_calories                      |
| `GET /v1/cycle`                 | `read:recovery`         | respiratory_rate (from daily cycle data)              |
| `GET /v1/user/measurement/body` | `read:body_measurement` | height, weight (if user has entered)                  |

---

## Field Mappings

### Daily Data

| Totus `metric_type` | Endpoint   | Whoop field                                   | Notes                          |
| ------------------- | ---------- | --------------------------------------------- | ------------------------------ |
| `hrv`               | `recovery` | `score.hrv_rmssd_milli`                       | ms                             |
| `rhr`               | `recovery` | `score.resting_heart_rate`                    | bpm                            |
| `readiness_score`   | `recovery` | `score.recovery_score`                        | 0–100                          |
| `sleep_duration`    | `sleep`    | `score.stage_summary.total_in_bed_time_milli` | ms ÷ 3,600,000 → hours (2dp)   |
| `sleep_efficiency`  | `sleep`    | `score.sleep_efficiency_percentage`           | none (%)                       |
| `active_calories`   | `workout`  | `score.kilojoule`                             | kJ × 0.239006 → kcal (integer) |
| `respiratory_rate`  | `cycle`    | `score.respiratory_rate`                      | rpm                            |

### Series Data

| Totus `metric_type` | Endpoint                             | Notes                                                                      |
| ------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `heart_rate`        | `GET /v1/cycle/{cycleId}/heart_rate` | Returns `{time, data}` array. Each item is a 6-second interval HR reading. |

### Periods Data

| `event_type`  | `subtype`      | Endpoint  | Whoop field                                                                     |
| ------------- | -------------- | --------- | ------------------------------------------------------------------------------- |
| `sleep_stage` | `rem`          | `sleep`   | `score.stage_summary.total_rem_sleep_time_milli` / `stage_summary` stages array |
| `sleep_stage` | `deep`         | `sleep`   | slow-wave sleep entries in stages array                                         |
| `sleep_stage` | `light`        | `sleep`   | light sleep entries                                                             |
| `sleep_stage` | `awake`        | `sleep`   | awake entries                                                                   |
| `workout`     | (mapped below) | `workout` | `sport_id`                                                                      |

**Whoop sport_id mapping** (partial — full list at developer.whoop.com):

| Whoop `sport_id` | Totus `subtype` |
| ---------------- | --------------- |
| `0`              | `run`           |
| `1`              | `cycle`         |
| `44`             | `swim`          |
| `45`, `63`       | `strength`      |
| `55`             | `yoga`          |
| All others       | `generic`       |

---

## Retry & Error Handling

| Error                             | Handling                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `429`                             | Respect `Retry-After`. Inngest step delay.                                                            |
| `401`                             | Refresh token. If refresh fails (refresh token expired after 30 days inactivity), `status='expired'`. |
| `5xx`                             | Retry 3× with exponential backoff.                                                                    |
| Missing `score` on sleep/recovery | Whoop returns `null` score for days when the device wasn't worn. Skip silently.                       |

---

## Known Limitations & Notes

- **PKCE mandatory.** Standard OAuth2 without PKCE will be rejected by Whoop's authorization server.
- **Heart rate series requires cycle ID.** HR data is fetched per-cycle (Whoop's concept of a 24-hour period), not as a flat time range. The sync must first fetch cycles, then fetch HR per cycle.
- **Whoop does not supply `activity_score`** (Oura-specific concept) or `steps`. Garmin or Oura should be the preferred source for those metrics when a user has multiple connections.
- **Body measurement** (`read:body_measurement`) returns user-entered data (height, weight), not scale-measured data. Weight from this scope is low quality vs. Withings. Only use if no better body comp source is available.
