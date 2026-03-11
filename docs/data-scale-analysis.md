# Totus Platform — Data Scale Analysis

### Version 1.0 — March 2026

### Status: Internal Reference

---

## 0. Methodology & Assumptions

### Row Size Basis

**Envelope encryption overhead (per row, `value_encrypted` BYTEA):**

The wire format defined in `integrations-pipeline-lld.md §3.3` and `api-database-lld.md §8.3.4`:

```
[4 bytes]  encrypted DEK length header
[N bytes]  KMS-encrypted DEK  →  RSA-2048 wrapping = 256 bytes (constant)
[12 bytes] AES-GCM nonce
[M bytes]  AES-256-GCM ciphertext of JSON value
[16 bytes] AES-GCM auth tag
──────────────────────────────────────────────────────
Fixed overhead:  4 + 256 + 12 + 16 = 288 bytes
```

The plaintext JSON payload before encryption:

- Integer metrics: `{"v":85}` = 8 bytes → ciphertext ≈ 8 bytes (GCM doesn't expand)
- Float metrics: `{"v":42.5}` = 10 bytes → ciphertext ≈ 10 bytes
- Float + unit: `{"v":7.5,"u":"hr"}` = 18 bytes → ciphertext ≈ 18 bytes

For daily metrics, a conservative average plaintext payload is **~12 bytes**, so:

```
value_encrypted per daily row ≈ 288 + 12 = ~300 bytes
```

For series readings (single numeric value), payload is ~8–10 bytes:

```
value_encrypted per series row ≈ 288 + 10 = ~298 bytes
```

For period metadata (workout: `{"calories":450,"distance_m":8200,"avg_hr":162,"max_hr":181,"sport_type_raw":"running"}`):

- Workout JSON payload ≈ 80 bytes → ciphertext ≈ 80 bytes
- `metadata_enc` ≈ 288 + 80 = ~368 bytes (NULL for sleep stages)

### PostgreSQL Row Overhead

Each heap tuple carries 23 bytes of fixed overhead (tuple header) plus null bitmap. For simplicity, round to **~25 bytes** of fixed per-row overhead before column data.

### KMS Key Pool

The schema assigns users to one of 10 shared CMKs via `hash(user_id) % 10`. This is critical for the KMS cost analysis: calls group by CMK, not per-user.

### User Activity Model

| Assumption                              | Value                                                |
| --------------------------------------- | ---------------------------------------------------- |
| Active users syncing / total registered | 70%                                                  |
| Average connections per active user     | 1.5 (most have 1, power users have 2–4)              |
| Syncs per connection per day            | 4 (every 6 hours per design)                         |
| Dexcom penetration                      | ~10% of users (CGM is a niche subset)                |
| "Fully connected" power user            | ~5% of users (Oura + Garmin + Withings + Cronometer) |
| Typical user                            | Oura only, or Oura + Garmin                          |

---

## 1. `health_data_daily` Storage Analysis

### 1.1 Row Size

| Column            | Type                                 | Bytes                  |
| ----------------- | ------------------------------------ | ---------------------- |
| `id`              | BIGSERIAL (8-byte int)               | 8                      |
| `user_id`         | VARCHAR(64) — Clerk ID ~20 chars avg | 22 (2 overhead + 20)   |
| `metric_type`     | VARCHAR(64) — avg 12 chars           | 14                     |
| `date`            | DATE                                 | 4                      |
| `value_encrypted` | BYTEA — ~300 bytes                   | 302 (2 overhead + 300) |
| `source`          | VARCHAR(32) — avg 6 chars            | 8                      |
| `source_id`       | VARCHAR(256) — avg 32 chars          | 34                     |
| `imported_at`     | TIMESTAMPTZ                          | 8                      |
| Row overhead      | header + alignment                   | 25                     |
| **Total**         |                                      | **~425 bytes**         |

**UNIQUE index overhead** (`user_id, metric_type, date, source`): ~100 bytes/row.
**Query index overhead** (`user_id, metric_type, date`): ~60 bytes/row.
**Summary index overhead** (`user_id, metric_type`): ~45 bytes/row.

**Effective bytes per row (data + indexes): ~630 bytes. Round to 650 bytes.**

### 1.2 Rows Per User Per Year

#### Provider daily metric counts (from `integrations-pipeline-lld.md §2.1`):

| Provider               | Distinct daily metrics supplied                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Oura                   | 18 (`sleep_score` through `spo2` — 18 mapped fields)                                                             |
| Garmin                 | 8 (`steps`, `active_calories`, `total_calories`, `rhr`, `hrv`, `spo2`, `sleep_duration`, `sleep_score`)          |
| Whoop                  | 7 (`hrv`, `rhr`, `respiratory_rate`, `sleep_duration`, `sleep_efficiency`, `readiness_score`, `active_calories`) |
| Withings (body comp)   | 7 (estimated: `weight`, `body_fat`, `bmi`, `lean_mass`, `water_pct`, `bone_mass`, `muscle_mass`)                 |
| Cronometer (nutrition) | 25 (estimated: macros + micronutrients as daily aggregates)                                                      |

#### Unique metric-days per user per day accounting for overlap:

The design stores **one row per (user, metric_type, date, source)** — not deduplicated by metric. Each provider-metric combination is a distinct row even when another provider supplies the same metric. However, the analysis task asks for _unique metric-days_ in terms of user value.

For the storage calculation, we need **total rows inserted**, which is the sum across all connected providers:

| User type                                             | Rows/day         | Rows/year (365d) |
| ----------------------------------------------------- | ---------------- | ---------------- |
| Oura only                                             | 18               | 6,570            |
| Oura + Garmin                                         | 18 + 8 = 26      | 9,490            |
| Oura + Garmin + Whoop                                 | 26 + 7 = 33      | 12,045           |
| Oura + Garmin + Whoop + Withings + Cronometer (power) | 33 + 7 + 25 = 65 | 23,725           |

The design-specified "~45 unique metric-days" figure represents overlapping metrics deduplicated from the ~59 raw metrics across all providers. For storage purposes we use **raw rows per provider-metric** because the UNIQUE constraint is on `(user_id, metric_type, date, source)` — overlapping metrics from two providers each generate their own row.

#### Weighted average across realistic user mix:

Assume the user population distributes as:

- 50% Oura only → 18 rows/day
- 30% Oura + Garmin → 26 rows/day
- 15% Oura + Garmin + Whoop → 33 rows/day
- 5% power user (all 5 providers) → 65 rows/day

Weighted average: `(0.50×18) + (0.30×26) + (0.15×33) + (0.05×65) = 9.0 + 7.8 + 4.95 + 3.25 = 25 rows/day/user`

**Baseline: ~25 rows/user/day → ~9,125 rows/user/year.**

### 1.3 Table Size at Each Tier

| Users   | Active users (70%) | Rows/year | Total rows (1yr) | Total rows (3yr) | Storage 1yr | Storage 3yr |
| ------- | ------------------ | --------- | ---------------- | ---------------- | ----------- | ----------- |
| 100     | 70                 | 9,125     | 638,750          | 1,916,250        | 415 MB      | 1.25 GB     |
| 1,000   | 700                | 9,125     | 6,387,500        | 19,162,500       | 4.1 GB      | 12.5 GB     |
| 10,000  | 7,000              | 9,125     | 63,875,000       | 191,625,000      | 41.5 GB     | 124.6 GB    |
| 100,000 | 70,000             | 9,125     | 638,750,000      | 1,916,250,000    | 415 GB      | 1.25 TB     |

_Storage = rows × 650 bytes, converted to GB (1 GB = 10^9 bytes)_

---

## 2. `health_data_series` Storage Analysis

### 2.1 Row Size

| Column             | Type                                                 | Bytes          |
| ------------------ | ---------------------------------------------------- | -------------- |
| `id`               | BIGSERIAL                                            | 8              |
| `user_id`          | VARCHAR(64)                                          | 22             |
| `metric_type`      | VARCHAR(64) — avg 11 chars (`heart_rate`, `glucose`) | 13             |
| `recorded_at`      | TIMESTAMPTZ                                          | 8              |
| `value_encrypted`  | BYTEA — ~298 bytes                                   | 300            |
| `source`           | VARCHAR(32) — avg 6 chars                            | 8              |
| `source_id`        | VARCHAR(256) — avg 32 chars                          | 34             |
| `imported_at`      | TIMESTAMPTZ                                          | 8              |
| Row overhead       | header + alignment                                   | 25             |
| **Heap row total** |                                                      | **~426 bytes** |

Index overhead on `(user_id, metric_type, recorded_at)`: ~80 bytes/row (larger because `recorded_at` is 8 bytes vs `date` at 4 bytes).
UNIQUE index overhead: ~90 bytes/row.

**Effective bytes per row (data + indexes): ~596 bytes. Round to 600 bytes.**

_Note: The partition structure creates per-partition indexes, not a global index. The effective index overhead per row is similar because each partition's index covers only that month's rows._

### 2.2 Rows Per User Per Day by Provider

#### Dexcom (glucose CGM):

- 1 reading every 5 minutes = **288 readings/day**
- Dexcom historical window: 90 days hard limit
- A Dexcom user can never have more than 90 days × 288 = **25,920 rows** in the table at any moment (if provider enforces the 90-day window on sync)
- However, Totus stores what it ingests — rows are not deleted on rolling window advancement
- **Rows per year (Dexcom only): 288 × 365 = 105,120 rows/user/year**

#### Oura heart rate series:

- `heart_rate` series from Oura: recorded during sleep (7 hr) and during the day
- Oura HR: 1 sample per minute during sleep (420 readings/night) + ~1 sample per 5 min during inactive daytime (~144 readings for 12 inactive hours) + elevated frequency during tracked activity
- Realistic estimate for Oura heart rate series: **~600 readings/day** (420 sleep + ~180 daytime)
- SpO2 interval: 1 reading per 5 minutes during sleep (~84 readings/night from 7 hours × 12/hr)
- **Oura series rows/day: ~600 (HR) + ~84 (SpO2) = ~684 rows/user/day**
- **Rows per year (Oura series): 684 × 365 = 249,660 rows/user/year**

#### Garmin heart rate series:

- Garmin records HR at ~15-second intervals during workouts (240 readings/hour)
- At rest/walking: ~1 per minute (60 readings/hour)
- Assume 1 hour of vigorous workout + 15 hours of waking moderate activity + 8 hours sleep:
  - Workout: 1 hr × 240 = 240 readings
  - Moderate waking: 15 hr × 60 = 900 readings
  - Sleep: ~60 readings/hr × 8 = 480 readings
  - **Total Garmin HR: ~1,620 readings/day**
- SpO2 interval (Garmin): similar to Oura, ~84/night during sleep
- **Garmin series rows/day: ~1,620 (HR) + ~84 (SpO2) = ~1,704 rows/user/day**
- **Rows per year (Garmin series): 1,704 × 365 = 622,000 rows/user/year**

#### Whoop heart rate series:

- Whoop records HR continuously; similar to Garmin for active users
- Estimate: ~1,200–1,500 HR readings/day
- **Rows per year (Whoop series): ~1,300 × 365 = 474,500 rows/user/year**

### 2.3 Scenario Comparison: Rows and Storage Per User Per Year

| User scenario                | Readings/day        | Rows/year | Storage/user/year |
| ---------------------------- | ------------------- | --------- | ----------------- |
| Oura only (HR + SpO2)        | 684                 | 249,660   | 149 MB            |
| Garmin only (HR + SpO2)      | 1,704               | 622,000   | 373 MB            |
| Oura + Garmin                | 684 + 1,704 = 2,388 | 871,620   | 523 MB            |
| Dexcom only                  | 288                 | 105,120   | 63 MB             |
| Dexcom + Oura                | 288 + 684 = 972     | 354,780   | 213 MB            |
| Dexcom + Garmin (worst case) | 288 + 1,704 = 1,992 | 727,080   | 436 MB            |

### 2.4 Fleet-wide Table Size Estimates

For the population model: 10% Dexcom, 50% Oura-only, 30% Oura+Garmin, 10% Garmin-only (of active users):

Weighted average series rows/day/active user:

```
(0.50 × 684) + (0.30 × 2,388) + (0.10 × 1,704) + (0.10 × (288+684))
= 342 + 716 + 170 + 97 = 1,325 rows/day
```

Adding the 10% Dexcom overlap (some Dexcom users also have Oura/Garmin, accounted in the 0.10 Dexcom-only bucket above).

**Weighted average: ~1,300 series rows/day/active user → ~474,500 rows/user/year.**

| Users   | Active users (70%) | Series rows (1yr) | Series rows (3yr) | Storage 1yr | Storage 3yr |
| ------- | ------------------ | ----------------- | ----------------- | ----------- | ----------- |
| 100     | 70                 | 33,215,000        | 99,645,000        | 19.9 GB     | 59.8 GB     |
| 1,000   | 700                | 332,150,000       | 996,450,000       | 199 GB      | 598 GB      |
| 10,000  | 7,000              | 3,321,500,000     | 9,964,500,000     | 1.99 TB     | 5.98 TB     |
| 100,000 | 70,000             | 33,215,000,000    | 99,645,000,000    | 19.9 TB     | 59.8 TB     |

**The series table dominates storage by an order of magnitude above the daily table at every tier.** Even a modest active user base with just Oura heart rate data generates 10–50× more series rows than daily rows.

---

## 3. `health_data_periods` Storage Analysis

### 3.1 Row Size

| Column         | Type                                                   | Bytes  |
| -------------- | ------------------------------------------------------ | ------ |
| `id`           | BIGSERIAL                                              | 8      |
| `user_id`      | VARCHAR(64)                                            | 22     |
| `event_type`   | VARCHAR(64) — avg 11 chars                             | 13     |
| `subtype`      | VARCHAR(64) — avg 5 chars                              | 7      |
| `started_at`   | TIMESTAMPTZ                                            | 8      |
| `ended_at`     | TIMESTAMPTZ                                            | 8      |
| `duration_sec` | INTEGER (generated, stored)                            | 4      |
| `metadata_enc` | BYTEA — NULL for sleep stages, ~368 bytes for workouts | varies |
| `source`       | VARCHAR(32)                                            | 8      |
| `source_id`    | VARCHAR(256) — avg 32 chars                            | 34     |
| `imported_at`  | TIMESTAMPTZ                                            | 8      |
| Row overhead   | header + null bitmap                                   | 25     |

For sleep stage rows (metadata_enc = NULL): **~145 bytes heap**
For workout rows (metadata_enc ≈ 368 bytes): **~513 bytes heap**

Blended (sleep stages heavily outnumber workouts, ~5:1 ratio): ~145 × 0.83 + 513 × 0.17 = ~207 bytes heap

GiST index on `(user_id, tstzrange(started_at, ended_at))`: GiST entries are larger than btree — estimate **~150 bytes/row**.
btree index on `(user_id, event_type, started_at, ended_at)`: ~75 bytes/row.
UNIQUE index: ~75 bytes/row.

**Effective bytes per row (data + indexes): ~507 bytes. Round to 500 bytes.**

### 3.2 Events Per User Per Day

Sleep stage events per night:

- Oura sleep_phase_5_min string produces contiguous run segments. A typical night: 4–6 REM cycles, 3–5 deep, interspersed light and awake segments.
- Realistic segment count: **~18–25 sleep stage periods/night** (a 7-hour sleep at 5-minute resolution with runs averaging 20–30 min gives ~14–21 segments; transitions between stages create more segments)
- Use **20 sleep stage rows/user/night**

Workout events per day:

- Not every user workouts daily; assume 60% of days have a workout for active users
- 1–2 workouts/day when active → average 0.7 workout rows/user/day across all days

**Total periods rows/user/day: 20 (sleep) + 0.7 (workouts) = ~21 rows/day**
**Rows/user/year: 21 × 365 = 7,665 rows**

### 3.3 Table Size at Each Tier

| Users   | Active users (70%) | Rows (1yr)  | Rows (3yr)    | Storage 1yr | Storage 3yr |
| ------- | ------------------ | ----------- | ------------- | ----------- | ----------- |
| 100     | 70                 | 536,550     | 1,609,650     | 268 MB      | 805 MB      |
| 1,000   | 700                | 5,365,500   | 16,096,500    | 2.7 GB      | 8.0 GB      |
| 10,000  | 7,000              | 53,655,000  | 160,965,000   | 26.8 GB     | 80.5 GB     |
| 100,000 | 70,000             | 536,550,000 | 1,609,650,000 | 268 GB      | 805 GB      |

---

## 4. Small Tables: `provider_connections` and `metric_source_preferences`

### 4.1 `provider_connections`

Row size estimate:

- `id` (UUID, 16b) + `user_id` (22b) + `provider` (8b) + `auth_type` (10b) + `auth_enc` (BYTEA, ~300b) + `token_expires_at` (8b) + `status` (8b) + `last_sync_at` (8b) + 3 cursors (~100b total) + `sync_status` (8b) + `sync_error` (NULL typically, 0b) + timestamps (16b) + overhead (25b)
- **~515 bytes/row**

Maximum rows = total registered users × avg connections (assume 1.5):

| Users   | Rows    | Storage |
| ------- | ------- | ------- |
| 100     | 150     | 78 KB   |
| 1,000   | 1,500   | 773 KB  |
| 10,000  | 15,000  | 7.7 MB  |
| 100,000 | 150,000 | 77 MB   |

Entirely negligible at all tiers.

### 4.2 `metric_source_preferences`

Row size: ~120 bytes/row. Rows = active users with multi-provider overlap × number of metrics they've explicitly configured (average ~3 preferences/user):

| Users   | Rows    | Storage |
| ------- | ------- | ------- |
| 100     | 210     | 25 KB   |
| 1,000   | 2,100   | 252 KB  |
| 10,000  | 21,000  | 2.5 MB  |
| 100,000 | 210,000 | 25 MB   |

Negligible.

---

## 5. Total Database Storage Summary

### 5.1 Aggregate Storage by Tier

All figures include heap + index overhead. TOAST overhead for large BYTEA values adds ~10% on Aurora (inline for values under 2KB, TOAST-compressed otherwise — since most `value_encrypted` values are ~300 bytes, they stay inline and are not TOAST-compressed).

**After 1 Year:**

| Tier          | `health_data_daily` | `health_data_series` | `health_data_periods` | Other tables | **Total**    |
| ------------- | ------------------- | -------------------- | --------------------- | ------------ | ------------ |
| 100 users     | 0.4 GB              | 19.9 GB              | 0.3 GB                | ~0.1 GB      | **~20.7 GB** |
| 1,000 users   | 4.1 GB              | 199 GB               | 2.7 GB                | ~0.2 GB      | **~206 GB**  |
| 10,000 users  | 41.5 GB             | 1,990 GB             | 26.8 GB               | ~0.5 GB      | **~2.06 TB** |
| 100,000 users | 415 GB              | 19,900 GB            | 268 GB                | ~1 GB        | **~20.6 TB** |

**After 3 Years:**

| Tier          | `health_data_daily` | `health_data_series` | `health_data_periods` | Other tables | **Total**    |
| ------------- | ------------------- | -------------------- | --------------------- | ------------ | ------------ |
| 100 users     | 1.25 GB             | 59.8 GB              | 0.8 GB                | ~0.1 GB      | **~61.9 GB** |
| 1,000 users   | 12.5 GB             | 598 GB               | 8.0 GB                | ~0.3 GB      | **~619 GB**  |
| 10,000 users  | 124.6 GB            | 5,980 GB             | 80.5 GB               | ~0.8 GB      | **~6.19 TB** |
| 100,000 users | 1,250 GB            | 59,800 GB            | 805 GB                | ~2 GB        | **~61.9 TB** |

**Series table share of total storage: consistently ~96–97% at all tiers.**

---

## 6. Storage Cost Estimates

### 6.1 Aurora Serverless v2 (~$0.10/GB-month)

Aurora charges for allocated storage, which grows in 10 GB increments and never shrinks automatically. Effective cost is for peak storage.

**After 1 Year (monthly storage cost):**

| Tier          | Total storage | Monthly cost (Aurora) |
| ------------- | ------------- | --------------------- |
| 100 users     | 21 GB         | **$2.10/mo**          |
| 1,000 users   | 206 GB        | **$20.60/mo**         |
| 10,000 users  | 2,060 GB      | **$206/mo**           |
| 100,000 users | 20,600 GB     | **$2,060/mo**         |

**After 3 Years (monthly storage cost):**

| Tier          | Total storage | Monthly cost (Aurora) |
| ------------- | ------------- | --------------------- |
| 100 users     | 62 GB         | **$6.20/mo**          |
| 1,000 users   | 619 GB        | **$61.90/mo**         |
| 10,000 users  | 6,190 GB      | **$619/mo**           |
| 100,000 users | 61,900 GB     | **$6,190/mo**         |

_Note: Aurora also charges per ACU-hour for compute. At MVP the design specifies min 0.5 ACU / max 4 ACU. Compute cost is separate and dominated by query load, not storage._

### 6.2 Neon (~$0.023/GB-month)

Neon's storage cost is substantially lower, but Neon uses a branching/copy-on-write architecture that means storage accounting differs — every branch shares base pages. For production single-branch usage, the per-GB rate is ~$0.023.

**After 1 Year (monthly storage cost):**

| Tier          | Total storage | Monthly cost (Neon) |
| ------------- | ------------- | ------------------- |
| 100 users     | 21 GB         | **$0.48/mo**        |
| 1,000 users   | 206 GB        | **$4.74/mo**        |
| 10,000 users  | 2,060 GB      | **$47.40/mo**       |
| 100,000 users | 20,600 GB     | **$474/mo**         |

**After 3 Years (monthly storage cost):**

| Tier          | Total storage | Monthly cost (Neon) |
| ------------- | ------------- | ------------------- |
| 100 users     | 62 GB         | **$1.43/mo**        |
| 1,000 users   | 619 GB        | **$14.24/mo**       |
| 10,000 users  | 6,190 GB      | **$142.40/mo**      |
| 100,000 users | 61,900 GB     | **$1,424/mo**       |

**Storage cost alone is not the binding constraint at any tier through 10,000 users.** At 100,000 users, Aurora storage cost (~$2,060–6,190/month) becomes meaningful but is still well below typical SaaS infrastructure budgets at that scale.

---

## 7. KMS API Call Volume and Cost

### 7.1 Call Pattern Analysis

The current design uses **per-row envelope encryption**: each row's `value_encrypted` contains a KMS-encrypted DEK. On read, the application must call KMS `Decrypt` to unwrap the DEK before decrypting the row's ciphertext. This is the critical performance and cost driver.

**Reads (dashboard queries):**

- A typical dashboard query: 90 days × 10 metrics = 900 rows from `health_data_daily`
- Each row requires one KMS Decrypt call (to unwrap that row's encrypted DEK)
- 900 rows → **900 KMS Decrypt calls per dashboard load**

_However,_ the application can cache the decrypted DEK in memory for the duration of a request. If all rows for a user share the same CMK (they do — the schema assigns one CMK per user from a pool of 10), and if the application caches the DEK after the first decrypt call, subsequent rows using the **same DEK** don't need an additional KMS call.

**The critical question is: does each row use a unique DEK or a shared DEK?**

The design specifies `GenerateDataKey` is called once per row at write time (each row's `value_encrypted` contains its own encrypted DEK). This means each row has a **unique DEK** encrypted by the user's CMK. Reading 900 rows = 900 KMS Decrypt calls. The DEK caching optimization doesn't apply across rows because each row's encrypted DEK is different.

This is the **per-row envelope encryption** anti-pattern at scale.

**Writes (syncs):**

Each row write requires one `GenerateDataKey` call (to get a fresh DEK for that row). A sync of 25 daily metrics = 25 KMS GenerateDataKey calls per sync.

Per sync per active connection:

- Daily data: ~25 rows → 25 GenerateDataKey calls
- Series data: varies by provider; Dexcom sync might deliver 50–200 new readings → 50–200 calls
- Periods: ~20–40 new period rows/sync → 20–40 calls
- Total per sync: **~100–265 KMS calls** (conservative avg: ~150)

**Incremental syncs** only generate KMS calls for _new_ rows since the last sync. After initial backfill, only a few days of new data arrives per sync.

For incremental syncs (steady state, 4 syncs/day/connection):

- Daily: ~25 new rows/sync × 25 KMS calls = 625 KMS writes/day/user
- Series: ~1,300 readings/day ÷ 4 syncs = 325 new rows/sync × 325 KMS calls = 1,300 KMS writes/day/user
- **Total KMS write calls/day/active user: ~1,925**

**Reads (dashboard, assumed 1 load/day/active user for simplicity):**

- 900 rows fetched × 900 KMS Decrypt calls per dashboard load
- **~900 KMS read calls/day/active user**

**Total KMS calls/day/active user (read + write): ~2,825**

### 7.2 KMS Volume by Tier

KMS pricing: **$0.03 per 10,000 requests** (after the free tier of 20,000 requests/month).

| Tier          | Active users | KMS calls/day | KMS calls/month | Monthly KMS cost |
| ------------- | ------------ | ------------- | --------------- | ---------------- |
| 100 users     | 70           | 197,750       | 5,932,500       | **$17.80**       |
| 1,000 users   | 700          | 1,977,500     | 59,325,000      | **$177.98**      |
| 10,000 users  | 7,000        | 19,775,000    | 593,250,000     | **$1,779.75**    |
| 100,000 users | 70,000       | 197,750,000   | 5,932,500,000   | **$17,797.50**   |

_Assumes $0.03/10,000 = $0.000003/call_

**KMS cost becomes material at 10,000 users (~$1,780/month) and dominant at 100,000 users (~$17,800/month).** This is the most significant cost scaling concern in the current architecture and is directly caused by the per-row DEK approach.

---

## 8. Inngest Job Volume and Plan Requirements

### 8.1 Event Volume Calculation

**Sync sweep job** (`integration/sync.sweep`): runs every 6 hours = 4 times/day. Each sweep dispatches one `integration/sync.connection` event per active connection.

Active connections (1.5 avg per active user, 70% active):

| Tier          | Active users | Active connections | Syncs/day | Events/month (syncs) |
| ------------- | ------------ | ------------------ | --------- | -------------------- |
| 100 users     | 70           | 105                | 420       | 12,600               |
| 1,000 users   | 700          | 1,050              | 4,200     | 126,000              |
| 10,000 users  | 7,000        | 10,500             | 42,000    | 1,260,000            |
| 100,000 users | 70,000       | 105,000            | 420,000   | 12,600,000           |

**Additional events per sync run (steps within `sync.connection`):**

The `sync.connection` job uses `step.run()` for: `mark-syncing`, `fetch-connection`, `sync-daily`, `sync-series`, `sync-periods`, `mark-idle` = **6 step events per sync job**.

Total Inngest events/month including internal steps:

| Tier          | Sync events/month | Steps × 6  | Token refresh events/month | **Total events/month** |
| ------------- | ----------------- | ---------- | -------------------------- | ---------------------- |
| 100 users     | 12,600            | 75,600     | ~3,150                     | **~78,750**            |
| 1,000 users   | 126,000           | 756,000    | ~31,500                    | **~787,500**           |
| 10,000 users  | 1,260,000         | 7,560,000  | ~315,000                   | **~7,875,000**         |
| 100,000 users | 12,600,000        | 75,600,000 | ~3,150,000                 | **~78,750,000**        |

### 8.2 Inngest Plan Tier Mapping

Inngest pricing tiers (approximate as of early 2026):

| Plan       | Events/month | Steps/month | Price/month |
| ---------- | ------------ | ----------- | ----------- |
| Free       | 5,000        | 50,000      | $0          |
| Starter    | 100,000      | 1,000,000   | ~$25        |
| Pro        | 5,000,000    | 50,000,000  | ~$150       |
| Enterprise | Custom       | Custom      | Custom      |

| Tier          | Events/month | Required Inngest plan                               |
| ------------- | ------------ | --------------------------------------------------- |
| 100 users     | ~79K         | **Starter** (events) but Step count may push to Pro |
| 1,000 users   | ~788K        | **Pro**                                             |
| 10,000 users  | ~7.9M        | **Pro** (at high end) or Enterprise                 |
| 100,000 users | ~78.75M      | **Enterprise**                                      |

_Note: Inngest billing is primarily by step count, not just event count. The step counts above (6 per sync) may exceed plan step limits before event count limits are hit. Verify against current Inngest pricing page at implementation time._

---

## 9. Specific Scale Concerns and Inflection Points

### 9.1 At What User Count Does `health_data_series` Become the Dominant Storage Concern?

**It is already dominant at all tiers.** From day 1 of a user connecting Oura, the heart rate series generates ~684 rows/day vs. ~18 daily aggregate rows — a 38:1 ratio. At every user tier, the series table accounts for ~96% of total storage.

**Inflection: ~500 active users** — at this point the series table exceeds 100 GB, which is meaningful for Aurora's I/O billing (Aurora charges $0.20/million I/O requests). Query patterns that scan large amounts of data without tight index bounds will start generating noticeable I/O costs.

### 9.2 At What User Count Does Monthly Partitioning of `health_data_series` Start to Matter for Query Performance?

The current design pre-creates monthly partitions with a btree index on `(user_id, metric_type, recorded_at)` per partition.

**Without partitioning**, a single btree index on a table with 10B rows (100,000 users × 1 year) would be:

- Index depth: ~4 B-tree levels (log_512(10B) ≈ 4.1)
- Leaf pages scanned for a 24-hour glucose query: ~290 rows / ~100 rows-per-page = ~3 leaf pages
- With 4 levels, even a massive unpartitioned table performs well for highly selective queries (single user + narrow time range)

**Partitioning benefits materialize at:**

1. **Vacuum performance**: Without partitioning, AUTOVACUUM must process the entire table on each run. With ~100M rows, AUTOVACUUM on `health_data_series` takes hours. Monthly partitions allow AUTOVACUUM to process each partition independently (most are "cold" — no new writes to past months).

2. **Partition pruning**: PostgreSQL eliminates partitions outside the query's `recorded_at` range. A query for "last 24 hours of glucose" touches only the current month's partition, reducing the index scan to <1,000 rows.

3. **Partition detach for archival**: Old partitions (>2 years) can be detached and moved to cold storage without touching the live table.

**Partition pruning starts delivering measurable query speedup at ~2,000 active users**, where the table has ~1B rows across 12 partitions. Without partitioning, even a fully indexed range scan on a 1B-row table incurs higher buffer cache pressure. At this scale, queries that span multiple months benefit from PostgreSQL's ability to scan only the relevant partition's index rather than seeking through a monolithic index.

**The more critical threshold is ~500 active users** for AUTOVACUUM correctness: at this point, without partitioning, bloat accumulates faster than AUTOVACUUM can reclaim it on a high-write series table.

### 9.3 Realistic p95 Query Time for the Main Dashboard Query

**Query pattern:** `SELECT metric_type, date, value_encrypted, source FROM health_data_daily WHERE user_id = $1 AND metric_type = ANY($2) AND date >= $3 AND date <= $4`

For 90-day window × 10 metrics:

- Rows returned: 90 × 10 = 900 rows
- Index used: `idx_health_data_daily_user_metric_date` (composite btree on user_id, metric_type, date)
- PostgreSQL will do 10 index range scans (one per metric_type), each returning 90 rows from a tightly clustered btree

**Index scan characteristics:**

The btree leaf pages for a single user's data are clustered by `(user_id, metric_type, date)`. For a user with 18 metrics × 3 years = 19,710 rows, all this user's data fits in ~19,710 × 425 bytes / 8192 bytes/page = ~102 heap pages. With the index, the planner will use an index scan (or bitmap heap scan if selectivity is lower).

For 10 metrics × 90 days = 900 rows:

- Index pages accessed: ~4–5 B-tree levels × 10 seeks = ~50 page reads
- Heap pages accessed: 900 rows × 425 bytes / 8192 bytes/page = ~47 pages (but many are sequential reads after the index scan)
- If pages are in buffer cache: **<5 ms**
- If pages require disk I/O (cold cache): 47 × 0.1ms (Aurora SSD latency) ≈ **5ms disk + 5ms index = ~10ms**

**After decryption** (900 KMS calls × ~2ms each with connection reuse): **1.8 seconds** (this is the latency ceiling — KMS calls are the bottleneck, not the SQL query)

**Per-user query p95 latency breakdown:**

| Tier          | SQL query | KMS decrypt (900 calls) | Total p95  | Notes                                       |
| ------------- | --------- | ----------------------- | ---------- | ------------------------------------------- |
| 100 users     | 5–10 ms   | ~1,800 ms               | **~1.8 s** | KMS latency dominates regardless of DB size |
| 1,000 users   | 5–15 ms   | ~1,800 ms               | **~1.8 s** | Buffer cache hit rate still high            |
| 10,000 users  | 10–30 ms  | ~1,800 ms               | **~1.9 s** | Cache pressure begins; more disk I/O        |
| 100,000 users | 20–100 ms | ~1,800 ms               | **~1.9 s** | Disk I/O increases but still KMS-dominated  |

The NFR-1 target is **<500ms for up to 5 years of daily data (~1,825 rows per metric)**. This target is **currently unachievable** with per-row envelope encryption because KMS decrypt alone takes ~1.8 seconds for 900 rows, and the target implies at most ~500ms total. The SQL query itself will comfortably hit the 500ms target; the application-layer decryption loop is the blocker.

**At every tier, KMS latency is the p95 ceiling, not PostgreSQL index performance.**

---

## 10. Schema Decisions That Become Problematic at Scale

### 10.1 Per-Row Envelope Encryption (Critical)

**The problem.** The current design calls `GenerateDataKey` once per row at write time and stores the KMS-encrypted DEK alongside each row's ciphertext. Reading N rows requires N KMS Decrypt calls.

At 900 rows per dashboard query:

- KMS call latency: ~2ms per call with SDK connection pooling
- Serial decryption: ~1.8 seconds
- Parallel decryption (batched): KMS has no batch decrypt API; max concurrency is ~10 parallel calls
- Parallel at 10x concurrency: 900 / 10 calls × 2ms = **~180ms** just for KMS

The design's NFR-1 (<500ms) cannot be met without either:

1. **Switching to per-user DEKs**: one DEK per user, stored encrypted in the `users` table. A single KMS Decrypt call unwraps the user's DEK; all row decryptions use local AES-GCM. KMS calls drop from N-per-query to 1-per-session (with DEK caching). Cost and latency both collapse.
2. **Per-day DEKs**: one DEK per (user, date). Reduces KMS calls from 900 to 90 for a 90-day query.

**Inflection: immediately.** Per-row DEKs are too expensive for any query returning more than ~10 rows if the latency target is <500ms. This needs architectural revision before the series table is populated (where individual queries return thousands of rows).

**Recommendation**: Switch to per-user DEKs cached in the session layer. The user's CMK wraps one DEK; that DEK encrypts all rows for that user. KMS is called once per authenticated session (or once per Lambda cold start with a short TTL cache). This reduces KMS cost by 900× for dashboard queries.

### 10.2 GiST Index on `health_data_periods` (Moderate)

**The problem.** The GiST index on `USING GIST (user_id, tstzrange(started_at, ended_at))` requires the `btree_gist` extension (noted as a dependency in §3.5) and creates significantly larger index entries than btree. GiST indexes on range types use ~200–400 bytes per entry versus ~75 bytes for btree.

The design already acknowledges this open question and includes a fallback btree index `idx_periods_user_type_time`. Dashboard queries for sleep stages in a date range can use the btree index efficiently without the GiST index (date-bounded queries don't need overlap semantics unless the query is "find events that were ongoing at time T").

**Assessment:** At <10,000 users, the GiST index is affordable (~800 bytes/row × 500M rows at 10K users / 3 years = ~400 GB just for the GiST index). At 100,000 users it becomes a meaningful storage cost (~4 TB for the index alone). The GiST index should be dropped unless overlap queries (e.g., "what sleep stage was I in at 3:00 AM?") are actually used in the UI. All timeline-view queries that specify a date range can use the btree index.

**Inflection: ~5,000 users** — at this point the GiST index exceeds 20 GB and AUTOVACUUM overhead on GiST pages becomes noticeable (GiST page splits are more expensive than btree splits).

### 10.3 Partition Strategy for `health_data_series` (Important)

**The problem.** The design pre-creates monthly partitions from 2020-01 through 2027-12 (96 partitions) and uses a cron job to create new partitions 2 months in advance. Each partition has its own btree index on `(user_id, metric_type, recorded_at)`.

PostgreSQL's partition pruning is very effective when the query includes a `recorded_at` range. However:

1. **UNIQUE constraint across partitions**: The `UNIQUE (user_id, metric_type, recorded_at, source)` constraint cannot be enforced as a single global constraint on a partitioned table in PostgreSQL. Each partition enforces its own local uniqueness. A reading with the exact same `(user_id, metric_type, recorded_at, source)` but in different partitions would not be caught. In practice this is fine because `recorded_at` is the partition key and two identical timestamps will land in the same partition.

2. **Index per partition**: At 100,000 users with 3 years of data, there are 36 monthly partitions, each with a btree index. The index sizes are distributed across partitions, which is correct. However, `pg_stat_user_indexes` returns 36 index rows for this one logical index — monitoring and maintenance tooling must be partition-aware.

3. **Missing partition on bulk import**: The design notes a cron job creates partitions 2 months in advance. A historical import for a user connecting Oura for the first time might write data back to 2020. If the 2020-01 partition doesn't exist (because the pre-creation range was shorter), the INSERT fails. The design says "Migration script creates partitions from 2020-01 through 2027-12" which addresses this, but any out-of-range timestamp will cause a "no partition found" error.

4. **At 100,000 users**: the `health_data_series_2026_03` partition (current month) alone would contain ~70,000 active users × 1,300 readings/day × 30 days = **2.73 billion rows**. This is too large for a single partition. Monthly partitions need to become **weekly or daily** at 10,000+ active users for the series table.

**Inflection: ~3,000–5,000 active users** — monthly partitions exceed 500M rows and AUTOVACUUM cycle time (days). Switch to weekly partitions. At 10,000+ active users, consider daily partitions or a different storage technology (TimescaleDB, Parquet in S3 for >90-day history).

### 10.4 The KMS Key Pool (10 CMKs for All Users) (Moderate)

**The problem.** The design assigns users to one of 10 KMS CMKs via `hash(user_id) % 10`. At 100,000 users, each CMK covers ~10,000 users. All those users' KMS calls go through the same CMK.

AWS KMS rate limits per CMK: **5,500 requests/second** (default, before requesting an increase). At 100,000 users with ~2,825 KMS calls/day/active user:

```
Total KMS calls/second at 100K users:
  197,750,000 calls/day ÷ 86,400 sec/day = 2,289 calls/second total
  Per CMK: 2,289 / 10 = ~229 calls/second
```

With 10 CMKs and 100,000 users, each CMK handles ~229 req/sec — well under the 5,500/sec limit. **The key pool size is adequate through 100,000 users** for the steady-state usage model. Peak load (all users loading dashboards simultaneously) would spike much higher but is unrealistic.

However, if the per-row DEK model is retained and queries become more aggressive (returning thousands of rows), the calls/second can multiply quickly. **The key pool concern is secondary to the per-row DEK concern.**

### 10.5 BIGSERIAL Primary Key on `health_data_series` (Minor but Worth Noting)

The `health_data_series` table uses `BIGSERIAL` for `id`, which creates a single global sequence. At 100,000 users with 1,300 readings/day each, the sequence advances at ~91M increments/day. `BIGSERIAL` (int8) supports 9.2 × 10^18 values — this will not overflow for centuries.

The issue is **sequence contention** at high insert rates: all inserts compete for the sequence lock. At 100,000 active users doing 4 syncs/day, average insert rate is ~1,300 × 70,000 / 86,400 ≈ **1,053 inserts/second**. PostgreSQL sequences can handle ~10,000–100,000 nextval calls per second, so this is not a bottleneck through 100,000 users.

At 1,000,000 users, consider switching to ULIDs or client-side UUIDs to eliminate sequence contention.

### 10.6 The `source_id` Column (Minor)

The `source_id` VARCHAR(256) is described as "Provider-specific record ID for deduplication." At 256 bytes reserved but typically ~32 bytes used, this wastes ~224 bytes of declared allocation (though PostgreSQL VARCHAR is variable-length, so only actual bytes are stored plus 2 bytes overhead). Not a meaningful concern.

---

## 11. Summary: Critical Numbers and Recommended Inflection Points

| Threshold                                   | User count                        | Action required                                                                                                      |
| ------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Series table exceeds daily table storage    | **Day 1**                         | Already true; plan capacity accordingly                                                                              |
| NFR-1 (500ms query) is unachievable         | **Day 1**                         | Switch from per-row DEKs to per-user DEKs before launch                                                              |
| AUTOVACUUM struggles on series table        | **~500 active users**             | Monthly partitioning (already designed) must be validated                                                            |
| KMS cost becomes material (>$200/mo)        | **~1,000–2,000 users**            | Strongest argument for per-user DEK caching                                                                          |
| Monthly series partitions exceed 500M rows  | **~3,000–5,000 active users**     | Switch to weekly or daily series partitions                                                                          |
| GiST index storage exceeds 20 GB            | **~5,000 users**                  | Evaluate whether GiST is actually used; drop if not                                                                  |
| Aurora compute must scale beyond 4 ACU      | **~2,000–5,000 concurrent users** | Increase max ACU; evaluate read replicas for dashboard queries                                                       |
| KMS cost dominant (>$1,000/mo)              | **~5,000–7,000 users**            | Per-user DEK architecture is mandatory to remain economical                                                          |
| Inngest Pro plan required                   | **~700–1,000 users**              | Budget for Pro tier                                                                                                  |
| Inngest Enterprise required                 | **~10,000+ users**                |                                                                                                                      |
| Consider TimescaleDB or columnar for series | **~10,000 active users**          | Series table at 2TB+ with billions of rows; standard PostgreSQL partitioning is insufficient for aggregate analytics |
| 100K user Aurora storage cost               | **100,000 users/1yr**             | $2,060/mo storage; plus $17,800/mo KMS = $19,860/mo before compute                                                   |

### The Most Important Architectural Risk

**Per-row envelope encryption is incompatible with the <500ms query latency target.** This is a day-one design issue that will manifest on first user load. The fix (per-user DEK with session caching) is straightforward and has minimal security tradeoff (the incremental security benefit of per-row DEKs over per-user DEKs is marginal given the data is also encrypted at rest by Aurora, and access control is enforced at the application layer). Switching before the first production data write avoids any migration complexity.

The series table storage growth requires proactive partition management. The monthly partition strategy in the design is correct for the launch scale but needs a documented upgrade path to weekly/daily partitions. That plan should be in place before 1,000 active users accumulate.

---

_All figures are estimates derived from the schema specifications in `integrations-pipeline-lld.md` and `api-database-lld.md`. Provider data frequency figures are based on documented API behavior for Oura v2, Dexcom v3, and Garmin Connect. Actual storage will vary based on user behavior, connection mix, and provider sync completeness._
