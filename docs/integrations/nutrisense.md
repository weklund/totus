# Nutrisense Integration

### Status: Blocked — no public API; partnership or intermediary required

### API: None (proprietary app platform)

### Auth: Email/password credential-based (no OAuth2)

### Developer portal: None — support.nutrisense.io

---

## What Nutrisense Is

Nutrisense is a CGM subscription service and wellness platform rather than a device manufacturer. It is hardware-agnostic and pairs with multiple underlying sensors:

| Sensor                    | Manufacturer | Reading interval |
| ------------------------- | ------------ | ---------------- |
| Freestyle Libre 1 / 2 / 3 | Abbott       | 15 min           |
| Dexcom G6 / G7            | Dexcom       | 5 min            |
| Stelo                     | Dexcom       | 15 min           |
| Lingo                     | Abbott       | 15 min           |

Nutrisense adds a service layer on top: glucose scores, meal logging, dietitian coaching, and pattern insights. This is distinct from the raw CGM data the underlying device produces.

**Why this matters for Totus:** Nutrisense is a primary acquisition path for non-diabetic wellness users who want CGM data. Many Totus users may have Nutrisense rather than a standalone Dexcom G7 or Stelo. The Nutrisense integration captures both the raw glucose series and the Nutrisense-specific scoring/meal layer.

---

## Access & Partnership

Nutrisense does not offer a public developer API or self-serve OAuth2 credentials. Integration options in order of feasibility:

### Option 1: Terra API (recommended path)

[Terra](https://tryterra.co) is a third-party health data aggregation middleware that has a direct partnership with Nutrisense. Terra exposes Nutrisense data (and 150+ other providers) through a single normalized OAuth2 API.

- Nutrisense users authenticate to Terra using their Nutrisense credentials
- Terra handles the Nutrisense credential management and data pull
- Totus integrates Terra once; Nutrisense is one of many providers available through it

**Trade-off:** Adds Terra as an infrastructure dependency. Terra charges per connection. If Terra's Nutrisense integration breaks (due to Nutrisense app changes), it is Terra's responsibility to fix.

**Terra developer portal:** https://tryterra.co/developers

### Option 2: Direct Nutrisense partnership

Contact Nutrisense directly for API access. No confirmed path exists publicly — this would require a commercial partnership negotiation similar to Cronometer.

**Contact:** No published developer contact. Start with Nutrisense's business/partnerships team.

### Option 3: CSV export (interim path)

Nutrisense supports CSV export via email (available to all subscribers). The export includes glucose readings, meals, and activity data. This is the same interim path used for Cronometer while the API partnership is pending.

**CSV columns (confirmed):** `timestamp`, `glucose_mg_dl`, `meal_name`, `meal_score`, `notes`

**Limitation:** Requires manual user-initiated export. Not suitable for automated sync.

---

## Data Available

### Glucose Series → `health_data_series`

| Totus `metric_type` | Source                | Interval                               | Notes                                                                 |
| ------------------- | --------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `glucose`           | All connected sensors | 15 min (Libre/Stelo/Lingo), 5 min (G7) | Reading interval depends on the underlying sensor the user has paired |

**Note on reading interval:** The effective interval stored in Totus should reflect the underlying sensor, not a Nutrisense-defined constant. If the user's sensor is a G7 (5-min), store `glucose` at 5-min granularity. If Freestyle Libre (15-min), store at 15-min. The adapter should preserve the native timestamp from the Nutrisense data without resampling.

### Glucose Scores → `health_data_daily`

Nutrisense computes four proprietary daily scores:

| Totus `metric_type`          | Nutrisense field     | Range | Notes                                     |
| ---------------------------- | -------------------- | ----- | ----------------------------------------- |
| `glucose_peak_score`         | `peak_score`         | 0–100 | Penalizes large glucose spikes            |
| `glucose_average_score`      | `average_score`      | 0–100 | Based on mean glucose vs. target range    |
| `glucose_variability_score`  | `variability_score`  | 0–100 | Based on standard deviation               |
| `glucose_adaptability_score` | `adaptability_score` | 0–100 | Based on post-meal glucose recovery speed |

These are Nutrisense-proprietary and have no equivalent in the Dexcom API. They are only available if the user connects via Nutrisense (not via direct Dexcom integration).

### Meals → `health_data_periods`

Nutrisense has a built-in meal logging feature with a glucose impact score per meal.

| `event_type` | `subtype`                                  | Notes               |
| ------------ | ------------------------------------------ | ------------------- |
| `meal`       | `breakfast` / `lunch` / `dinner` / `snack` | Standard meal slots |

**`metadata_enc` payload:**

```json
{
  "meal_score": 7,
  "notes": "Salad with grilled chicken",
  "glucose_peak_mg_dl": 142,
  "glucose_return_to_baseline_min": 85
}
```

`meal_score` is Nutrisense's 1–10 rating of glucose response to the meal. `glucose_peak_mg_dl` and `glucose_return_to_baseline_min` are derived from the glucose series relative to meal timestamp.

---

## Provider Config (Terra path — speculative until Terra integration is built)

If Totus integrates Terra as an intermediary, Nutrisense would be configured as a Terra-brokered provider:

```typescript
const nutrisenseConfig: ProviderConfig = {
  id: "nutrisense",
  displayName: "Nutrisense",
  authType: "oauth2", // Terra OAuth2 on behalf of Nutrisense
  auth: {
    // All Terra URLs — Nutrisense users authorize via Terra's hosted auth flow
    authorizeUrl: "https://api.tryterra.co/v2/auth/generateAuthToken", // Terra widget URL
    tokenUrl: "https://api.tryterra.co/v2/auth/token",
    revokeUrl: "https://api.tryterra.co/v2/auth/deauthUser",
    scopes: [], // Terra uses widget-based auth, not scope strings
    redirectUri: "https://app.totus.health/api/connections/nutrisense/callback",
  },
  rateLimit: {
    requestsPerWindow: 100, // Terra rate limits apply, not Nutrisense-native limits
    windowSeconds: 60,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      "glucose_peak_score",
      "glucose_average_score",
      "glucose_variability_score",
      "glucose_adaptability_score",
    ],
    seriesMetrics: ["glucose"],
    periodTypes: ["meal"],
    historicalWindowDays: 90, // Constrained by underlying Dexcom/Libre API limits; confirm with Terra
    defaultSyncIntervalHours: 3,
    correctionWindowDays: 0,
  },
  apiVersion: "v1", // Terra API version
  changelogUrl: "https://docs.tryterra.co/changelog",
};
```

**Important:** All config values above are estimates pending Terra API evaluation. Confirm Terra's Nutrisense data model and available fields during integration scoping.

---

## Relationship to Other CGM Integrations

Nutrisense and Dexcom can produce overlapping `glucose` series data for the same user. Deduplication rules:

| Scenario                                   | Preferred source                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| User has Nutrisense + Dexcom G7 connection | Keep both; `source` column differentiates. Do not deduplicate across providers.      |
| User has only Nutrisense (Libre sensor)    | Nutrisense is the only glucose source                                                |
| User has only Dexcom G7 (direct)           | Dexcom API data; no Nutrisense scores or meals available                             |
| User disconnects Nutrisense                | Retain historical rows; future glucose data falls back to direct Dexcom if connected |

Nutrisense uniquely adds the glucose score metrics and meal periods that are unavailable through a direct Dexcom connection. Users with both connections get duplicate raw glucose series but unique scored data from Nutrisense.

---

## Retry & Error Handling (Terra path)

| Error                  | Handling                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Terra `429`            | Respect `Retry-After`. Inngest step delay.                                                             |
| Terra `401`            | Re-exchange Terra auth token. If Terra user token expired, mark `status='expired'` and prompt re-auth. |
| Terra `5xx`            | Retry 3× with exponential backoff.                                                                     |
| Empty glucose response | User's sensor is not actively syncing (e.g., between sensor sessions). Normal — skip silently.         |
| Missing meal score     | User did not log meals that day. Normal — skip silently.                                               |

---

## Known Limitations & Notes

- **No public API.** Direct integration without Terra or a Nutrisense partnership is not viable without reverse-engineering the app's private endpoints, which would violate Nutrisense's Terms of Service.
- **Terra is a cost-bearing dependency.** Terra charges per active connection. Factor into unit economics before committing to this path. Evaluate Terra's pricing at scale.
- **Reading interval is sensor-dependent.** Do not assume 15-minute intervals. If a Nutrisense user has a Dexcom G7 paired, readings arrive at 5-minute granularity. The adapter must inspect the source sensor type or use the actual timestamp deltas.
- **Glucose scores are proprietary.** `glucose_peak_score` and siblings are Nutrisense's computed metrics. If a user later disconnects Nutrisense, these scores cannot be recomputed from raw glucose series without replicating Nutrisense's scoring algorithm (which is not published).
- **Meal logging is optional.** Many Nutrisense users do not log meals consistently. Absence of meal period events is normal and should not indicate a sync failure.
- **Libre vs. Dexcom data quality.** Abbott Freestyle Libre uses a factory-calibrated interstitial fluid sensor; Dexcom uses a similar approach. Both produce comparable mg/dL values. No normalization adjustment needed between sensor types.
- **Historical window.** Constrained by the underlying sensor API limits. For Libre-based users, Terra's historical window for Nutrisense data is not publicly confirmed — verify during Terra integration scoping.
