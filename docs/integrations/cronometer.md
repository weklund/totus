# Cronometer Integration

### Status: Blocked — partnership required before implementation can begin

### API: Cronometer OAuth2 API (not publicly documented)

### Auth: OAuth 2.0

### Partnership contact: developer@cronometer.com

---

## Access & Partnership

**Cronometer's API is not publicly accessible.** There is no self-serve developer portal. API access is granted selectively through a partnership agreement, primarily to dietitian platforms and clinical applications. To proceed:

1. Email developer@cronometer.com describing the use case.
2. Describe data handling practices (encryption at rest, user-controlled access, no selling of data).
3. Negotiate a partnership agreement — expect a formal contract with data use restrictions.
4. Upon approval, Cronometer issues OAuth client credentials.

**Do not build against this integration without confirmed credentials.** The OAuth URLs and scopes in this document are speculative — verify all values with Cronometer during onboarding.

### Interim path: CSV import

While the partnership is being negotiated, build a `file_import` adapter that reads Cronometer's CSV export format. Cronometer Gold subscribers can export their complete diary history as CSV. This gives users immediate value and validates the data model before the OAuth integration is complete.

The CSV export includes: date, meal type, food name, and full nutritional breakdown per food item. Parse into `health_data_daily` (daily totals) and `health_data_periods` (individual meals with `metadata_enc`).

---

## Provider Config (speculative — verify with Cronometer)

```typescript
const cronometerConfig: ProviderConfig = {
  id: "cronometer",
  displayName: "Cronometer",
  authType: "oauth2",
  auth: {
    // All URLs below are speculative. Confirm during partnership onboarding.
    authorizeUrl: "https://cronometer.com/oauth2/authorize",
    tokenUrl: "https://cronometer.com/oauth2/token",
    revokeUrl: undefined, // Confirm with Cronometer — not publicly documented
    scopes: ["diary:read"],
    redirectUri: "https://app.totus.health/api/connections/cronometer/callback",
  },
  rateLimit: {
    requestsPerWindow: 200, // Estimate — confirm during onboarding
    windowSeconds: 3600,
    respectRetryAfter: true,
  },
  sync: {
    dailyMetrics: [
      // Macros
      "calories_consumed",
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
      "sugar_g",
      "saturated_fat_g",
      // Minerals
      "sodium_mg",
      "potassium_mg",
      "calcium_mg",
      "iron_mg",
      "magnesium_mg",
      "zinc_mg",
      // Vitamins
      "vitamin_a_mcg",
      "vitamin_c_mg",
      "vitamin_d_mcg",
      "vitamin_b12_mcg",
      "folate_mcg",
    ],
    seriesMetrics: [],
    periodTypes: ["meal"],
    historicalWindowDays: 3650,
    defaultSyncIntervalHours: 6,
    correctionWindowDays: 1, // Users can edit past diary entries
  },
  apiVersion: "v1", // Confirm with Cronometer
  changelogUrl: "https://cronometer.com/developer",
};
```

---

## Data Available (based on Cronometer's known data model)

### Daily Aggregates → `health_data_daily`

Cronometer computes daily totals across all diary entries for a given date. These map directly to `health_data_daily` rows.

**Macros:**

| Totus `metric_type` | Cronometer field | Unit           |
| ------------------- | ---------------- | -------------- |
| `calories_consumed` | `energy`         | kcal (integer) |
| `protein_g`         | `protein`        | g              |
| `carbs_g`           | `carbohydrates`  | g              |
| `fat_g`             | `fat`            | g              |
| `fiber_g`           | `fiber`          | g              |
| `sugar_g`           | `sugars`         | g              |
| `saturated_fat_g`   | `saturated_fat`  | g              |

**Minerals:**

| Totus `metric_type` | Cronometer field | Unit |
| ------------------- | ---------------- | ---- |
| `sodium_mg`         | `sodium`         | mg   |
| `potassium_mg`      | `potassium`      | mg   |
| `calcium_mg`        | `calcium`        | mg   |
| `iron_mg`           | `iron`           | mg   |
| `magnesium_mg`      | `magnesium`      | mg   |
| `zinc_mg`           | `zinc`           | mg   |

**Vitamins:**

| Totus `metric_type` | Cronometer field | Unit    |
| ------------------- | ---------------- | ------- |
| `vitamin_a_mcg`     | `vitamin_a`      | mcg RAE |
| `vitamin_c_mg`      | `vitamin_c`      | mg      |
| `vitamin_d_mcg`     | `vitamin_d`      | mcg     |
| `vitamin_b12_mcg`   | `vitamin_b12`    | mcg     |
| `folate_mcg`        | `folate`         | mcg DFE |

### Individual Meals → `health_data_periods`

Each diary entry (breakfast, lunch, dinner, snack) maps to a `PeriodEvent` with `event_type='meal'`.

**`metadata_enc` payload:**

```json
{
  "calories": 450,
  "protein_g": 32.5,
  "carbs_g": 48.0,
  "fat_g": 12.3,
  "fiber_g": 6.1,
  "food_items": [
    {
      "name": "Large Egg",
      "amount": 2,
      "unit": "large",
      "calories": 140,
      "protein_g": 12.0,
      "carbs_g": 1.0,
      "fat_g": 10.0
    }
  ]
}
```

**Note:** Individual food item data (the `food_items` array) is packed into the encrypted `metadata_enc` blob. It is not queryable at the food-item level without decrypting the entire meal. For MVP this is acceptable. A dedicated `nutrition_food_items` table can be added later if per-food-item analytics are needed.

**Meal timing:** Cronometer associates diary entries with a meal slot (breakfast/lunch/dinner/snack) and an optional timestamp. If no explicit timestamp is provided by the user:

- breakfast → 08:00 local time
- lunch → 12:00 local time
- dinner → 18:00 local time
- snack → 15:00 local time

Use a nominal 30-minute duration for meal periods when start/end times are not explicitly recorded.

---

## Retry & Error Handling

These are estimates — confirm actual API behavior during onboarding.

| Error                | Handling                                                                               |
| -------------------- | -------------------------------------------------------------------------------------- |
| `429`                | Respect `Retry-After`. Inngest step delay.                                             |
| `401`                | Refresh token. If refresh fails, `status='expired'`.                                   |
| `5xx`                | Retry 3× with exponential backoff.                                                     |
| Empty diary for date | User did not log food that day. Normal — skip silently; do not insert zero-value rows. |

---

## Known Limitations & Notes

- **Partnership gating is the primary blocker.** No development can begin until credentials are issued.
- **URL/scope speculation.** The OAuth endpoints above are guesses based on standard OAuth2 patterns. All must be verified with Cronometer before implementation.
- **Rate limits unknown.** The `requestsPerWindow: 200` figure is an estimate. Actual limits will be communicated during partner onboarding.
- **Diary editing.** Cronometer users frequently edit past diary entries (correcting portion sizes, adding forgotten items). Set `correctionWindowDays: 1` to re-fetch yesterday's totals on each sync.
- **No intraday data.** Cronometer does not expose blood glucose or continuous biometric data. Its value is purely diary-based nutrition tracking.
- **Free vs. Gold tiers.** Some micronutrient data may only be available to Cronometer Gold subscribers. Confirm scope of data access during partnership negotiation.
