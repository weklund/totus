# Dexcom Integration

### Status: Planned — self-serve developer access via Dexcom Developer Portal

### API: Dexcom API v3

### Auth: OAuth 2.0

### Developer portal: https://developer.dexcom.com

---

## Scope: G6 / G7 Only — Stelo Not Covered

**This integration covers Dexcom G6 and G7 prescription CGM devices only.** Dexcom's OTC product, **Stelo**, does not use the standard Dexcom API v3 and is explicitly not supported through this integration.

|                              | Dexcom G6 / G7                    | Stelo                                                                               |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| **Target user**              | Diabetics (prescription)          | Wellness / non-diabetic (OTC)                                                       |
| **API access**               | Standard Dexcom API v3            | No public API — direct partnership only                                             |
| **Dexcom Share**             | Supported                         | Not supported                                                                       |
| **Developer portal**         | developer.dexcom.com (self-serve) | No developer portal                                                                 |
| **Reading frequency**        | Every 5 minutes                   | Every 15 minutes                                                                    |
| **Third-party integrations** | Standard OAuth2                   | Custom partnerships (Oura, Levels, Nutrisense, Apple Health, Google Health Connect) |

**Totus's target user is far more likely to own a Stelo than a G7.** Supporting Stelo requires a separate direct partnership with Dexcom — contact Dexcom's Digital Health Partner program. If approved, Stelo would be a distinct provider (`id: "stelo"`) with 15-minute reading intervals and `seriesMetrics: ["glucose"]` in the same normalized format. See `docs/integrations/nutrisense.md` for an alternative path to wellness CGM data.

---

## Access & Partnership

Dexcom provides self-serve OAuth2 developer access through their developer portal. No partnership agreement is required to start development. Production access (real patient data, not sandbox) requires a Dexcom app review and approval before going live with end users.

- **Sandbox:** Available immediately after registering at developer.dexcom.com. Uses synthetic CGM data.
- **Production:** Submit app for review. Dexcom reviews for data handling practices and user safety. Approval typically takes 1–4 weeks.

---

## Provider Config

```typescript
const dexcomConfig: ProviderConfig = {
  id: "dexcom",
  displayName: "Dexcom CGM",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://api.dexcom.com/v2/oauth2/login",
    tokenUrl: "https://api.dexcom.com/v2/oauth2/token",
    revokeUrl: undefined, // Dexcom does not expose a token revoke endpoint
    scopes: ["offline_access"],
    redirectUri: "https://app.totus.health/api/connections/dexcom/callback",
  },
  rateLimit: {
    requestsPerWindow: 60,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [], // Dexcom provides no daily aggregates
    seriesMetrics: ["glucose"], // 5-minute CGM readings only
    periodTypes: [],
    historicalWindowDays: 90, // Hard API limit — cannot fetch data older than 90 days
    defaultSyncIntervalHours: 3,
    correctionWindowDays: 0, // Dexcom does not retroactively correct historical readings
  },
  apiVersion: "v3",
  changelogUrl: "https://developer.dexcom.com/changelog",
};
```

---

## API Details

**Base URL:** `https://api.dexcom.com`

**Pagination:** The `/v3/users/self/egvs` endpoint accepts `startDate` and `endDate` query parameters (ISO 8601). Max range per request is 90 days. No cursor-based pagination — each request returns all readings in the date range.

**Sync strategy:** Because there is no cursor, the adapter tracks the last `recorded_at` timestamp in `provider_connections.series_cursor`. On each sync, fetch from `(series_cursor - 5min)` to now to avoid gaps from in-flight readings.

**Rate limits:** 60 requests per minute per access token. With a 3-hour sync interval and ~1 API call per sync, this is not a concern in steady state.

**Token lifetime:** Access tokens expire after 30 minutes. Refresh tokens expire after 30 days of inactivity. The proactive refresh job (fires 24h before expiry for other providers) should be adjusted for Dexcom: refresh if token expires within 1 hour.

**Historical window:** Hard limit of 90 days lookback. Initial sync fetches 90 days of glucose history. Older data cannot be retrieved.

**Endpoints used:**

| Endpoint                  | Data fetched                                  |
| ------------------------- | --------------------------------------------- |
| `GET /v3/users/self/egvs` | Estimated glucose values (5-min CGM readings) |

**EGV response shape:**

```json
{
  "egvs": [
    {
      "systemTime": "2026-03-10T08:00:00",
      "displayTime": "2026-03-10T08:00:00",
      "value": 95,
      "status": null,
      "trend": "flat",
      "trendRate": 0.1
    }
  ]
}
```

**Field mapping:**

| Totus `metric_type` | Dexcom field   | Unit  | Notes                                                                            |
| ------------------- | -------------- | ----- | -------------------------------------------------------------------------------- |
| `glucose`           | `egvs[].value` | mg/dL | `systemTime` → `recorded_at`. Use `systemTime` (UTC), not `displayTime` (local). |

**Special values:** Dexcom returns `value: null` for readings during sensor warmup or calibration. Skip null-value rows; do not insert them.

---

## Retry & Error Handling

| Error                   | Handling                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `429 Too Many Requests` | Respect `Retry-After` header. Back off and retry.                                                                                   |
| `401 Unauthorized`      | Attempt token refresh. Dexcom access tokens expire after 30 min — this is expected. If refresh also fails, mark `status='expired'`. |
| `5xx`                   | Inngest retries up to 3× with exponential backoff.                                                                                  |
| `range_too_large`       | Date range exceeds 90-day limit. Split into smaller windows.                                                                        |

---

## Known Limitations & Notes

- **No daily aggregates.** Dexcom provides only raw 5-minute readings. Any daily summary (e.g., average glucose, time-in-range) must be computed from the series data in the application layer.
- **90-day hard limit.** Users cannot retrieve historical data older than 90 days via the API, even if their CGM device has it. There is no workaround.
- **No revoke endpoint.** When a user disconnects, delete the `provider_connections` row. There is no API call to invalidate the tokens on Dexcom's side; they expire naturally.
- **Sensor gaps.** CGM sensors require warmup (~2 hours) and occasional recalibration. Expect gaps in the series data; these are normal and should not trigger sync errors.
- **Scale at 10% penetration.** A Dexcom user generates ~288 series rows/day — the highest frequency of any current provider. See `docs/data-scale-analysis.md` for storage implications.
- **Stelo is not covered.** Dexcom's OTC Stelo biosensor does not expose data through the Dexcom API v3. It requires a direct Dexcom Digital Health Partner agreement. Stelo generates ~96 series rows/day (15-min intervals). See the Stelo note in the header section and `docs/integrations/nutrisense.md` for the wellness CGM landscape.
