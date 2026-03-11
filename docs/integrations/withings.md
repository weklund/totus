# Withings Integration

### Status: Planned — self-serve developer access, no partnership required

### API: Withings Health Mate API v2

### Auth: OAuth 2.0

### Developer portal: https://developer.withings.com

---

## Access & Partnership

Withings provides self-serve OAuth2 developer access with no partnership or approval required. Register an application at developer.withings.com and receive client credentials immediately. This is the most accessible smart scale API available.

---

## Provider Config

```typescript
const withingsConfig: ProviderConfig = {
  id: "withings",
  displayName: "Withings Health Mate",
  authType: "oauth2",
  auth: {
    authorizeUrl: "https://account.withings.com/oauth2_user/authorize2",
    tokenUrl: "https://wbsapi.withings.net/v2/oauth2", // POST with action=requesttoken
    revokeUrl: undefined, // No standard revoke endpoint
    scopes: ["user.metrics"],
    redirectUri: "https://app.totus.health/api/connections/withings/callback",
  },
  rateLimit: {
    requestsPerWindow: 120,
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "weight",
      "bmi",
      "body_fat_pct",
      "muscle_mass_kg",
      "bone_mass_kg",
      "hydration_kg",
      "visceral_fat_index",
    ],
    seriesMetrics: [],
    periodTypes: [],
    historicalWindowDays: 3650,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 0,
  },
  apiVersion: "v2",
  changelogUrl:
    "https://developer.withings.com/api-reference/#section/Changelog",
};
```

---

## API Details

**Base URL:** `https://wbsapi.withings.net`

**Primary endpoint:** `POST /measure?action=getmeas`

The Withings API uses a non-standard pattern: most endpoints are POST requests with an `action` query parameter, not RESTful paths.

**Token flow quirk:** The token endpoint (`/v2/oauth2`) also uses `action=requesttoken` and `action=refreshaccesstoken` parameters rather than standard OAuth grant_type differentiation. Implement accordingly.

**Pagination:** The `getmeas` endpoint supports `startdate` / `enddate` Unix timestamps and returns up to 200 measurements per call. Use `offset` parameter for pagination if a day has more than 200 measurements (rare for body composition). The response includes a `more` flag and `offset` for the next page.

**Rate limits:** 120 requests/minute per token. No daily cap documented.

**Token lifetime:** Access tokens expire after 3 hours. Refresh tokens expire after 1 year of non-use.

**Webhook support:** Withings supports push notifications ("Health Notifications") — Withings can POST new measurement events to a registered endpoint within minutes of a new weigh-in. This is a future optimization to reduce sync latency; the current design uses scheduled polling.

**Measurement type codes (`meastype` parameter):**

| `meastype` | Totus `metric_type`  | Unit                                            | Device required                                      |
| ---------- | -------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `1`        | `weight`             | kg (precision 0.001)                            | Any Withings scale                                   |
| `6`        | `bmi`                | kg/m²                                           | Any scale (computed from weight + height in profile) |
| `8`        | `body_fat_pct`       | % (derived from fat mass weight ÷ total weight) | Body+, Body Cardio                                   |
| `76`       | `muscle_mass_kg`     | kg                                              | Body+, Body Cardio                                   |
| `77`       | `hydration_kg`       | kg                                              | Body+, Body Cardio                                   |
| `88`       | `bone_mass_kg`       | kg                                              | Body+, Body Cardio                                   |
| `170`      | `visceral_fat_index` | index                                           | Body Cardio only                                     |

Fetch all meastype values in one request: `meastype=1,6,8,76,77,88,170`.

---

## Field Mappings

### Daily Data — Weigh-in Atomicity via `grpid`

Each Withings measurement response includes a `grpid` field that groups all measurements from the same physical weigh-in event. A single step-on-the-scale produces multiple rows in `health_data_daily` (one per `meastype`), but they all share the same `grpid`.

**Store `grpid` as `source_id`** on each `health_data_daily` row. This preserves atomicity:

- Deduplication on re-sync uses the unique constraint `(user_id, metric_type, date, source)` — `source_id` provides an extra guard via upsert.
- The application layer can reconstruct a "full body composition scan" by grouping on `(date, source, source_id)`.

**Mapping:**

| Totus `metric_type`  | `meastype` | Conversion                                                                         |
| -------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `weight`             | `1`        | value (already kg to 3dp)                                                          |
| `bmi`                | `6`        | value (already kg/m²)                                                              |
| `body_fat_pct`       | `8`        | fat_mass_weight ÷ weight × 100 — OR if `meastype=8` returns direct %, use directly |
| `muscle_mass_kg`     | `76`       | value (kg)                                                                         |
| `hydration_kg`       | `77`       | value (kg)                                                                         |
| `bone_mass_kg`       | `88`       | value (kg)                                                                         |
| `visceral_fat_index` | `170`      | value (index)                                                                      |

**Note on `body_fat_pct`:** Withings `meastype=8` returns fat mass in **kg** (not percent). Compute body fat percentage as `(meastype_8_value / meastype_1_value) × 100`. Both values will be present in the same `grpid` group when a Body+ scale is used.

**Sample `getmeas` response:**

```json
{
  "measuregrps": [
    {
      "grpid": 12345678,
      "date": 1741600000,
      "measures": [
        { "value": 78500, "type": 1, "unit": -3 },
        { "value": 241, "type": 6, "unit": -1 },
        { "value": 14200, "type": 8, "unit": -3 },
        { "value": 36800, "type": 76, "unit": -3 },
        { "value": 28200, "type": 77, "unit": -3 },
        { "value": 3100, "type": 88, "unit": -3 }
      ]
    }
  ]
}
```

**Value decoding:** `actual_value = value × 10^unit`. Example: `78500 × 10^-3 = 78.5 kg`.

---

## Retry & Error Handling

| Error               | Handling                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `429`               | Respect `Retry-After`. Inngest step delay.                                                                                      |
| `401`               | Refresh token using `action=refreshaccesstoken`. If refresh fails, `status='expired'`.                                          |
| `503` / `5xx`       | Retry 3× with exponential backoff.                                                                                              |
| Empty `measuregrps` | User has not weighed in during the requested window. Normal — skip silently.                                                    |
| `meastype` absent   | That measurement type requires a device the user doesn't have (e.g., `visceral_fat_index` requires Body Cardio). Skip silently. |

---

## Known Limitations & Notes

- **No revoke endpoint.** Token invalidation on Withings requires using their account portal; there is no API call to revoke tokens. When a user disconnects in Totus, delete the `provider_connections` row — tokens will expire naturally.
- **`body_fat_pct` requires two measure types.** Must compute from `meastype=8` (fat mass kg) ÷ `meastype=1` (weight kg). If either is absent in a weigh-in, skip `body_fat_pct` for that event.
- **`visceral_fat_index` is Body Cardio only.** This is the premium scale model. Expect this field to be empty for most users.
- **Webhook future work.** Withings Health Notifications can deliver new measurements within minutes of a weigh-in. Implementing this eliminates the up-to-6-hour sync delay for body composition data. Tracked as a future optimization.
