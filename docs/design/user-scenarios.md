# Dashboard User Scenarios

Design test cases for the correlated biomarker visualization. Each scenario
describes a real-world situation where a user needs to see **relationships
between metrics**, not just isolated numbers.

These scenarios drive wireframe design and feature prioritization.

---

## S1 — Late Meal Disrupts Sleep

**User:** Quantified-self Oura user who had dinner at 9:30 PM

**What happened (ground truth):**
A carb-heavy meal at 9:30 PM caused a glucose spike (Dexcom/Nutrisense).
Resting heart rate stayed elevated through the first sleep cycles. Sleep onset
latency was 35 min instead of the usual 12. Deep sleep in the first half of the
night was nearly absent. Sleep score dropped to 64.

**Metrics involved:**

| Metric               | Type   | Source          | Signal                          |
|----------------------|--------|-----------------|---------------------------------|
| `glucose`            | series | Dexcom          | Spike at 9:45 PM, slow descent  |
| `heart_rate`         | series | Oura            | Elevated through midnight        |
| `rhr`                | daily  | Oura            | 72 bpm vs 30-day avg of 61      |
| `sleep_latency`      | daily  | Oura            | 35 min vs avg 12                 |
| `sleep_stage`        | period | Oura            | Minimal deep in first 3 hrs      |
| `deep_sleep`         | daily  | Oura            | 0.8 hr vs avg 1.6                |
| `sleep_score`        | daily  | Oura            | 64 vs avg 83                     |

**Causal chain:**
```
[9:30 PM meal] → glucose spike → elevated HR → long sleep onset → reduced deep sleep → low sleep score
```

**What the user wants to see:**
- The glucose curve and heart rate curve side by side on the same time axis,
  showing the spike and the sustained HR elevation
- A marker for "meal" event on the timeline
- The sleep hypnogram directly below, showing the delayed onset and missing deep
  blocks
- Ideally, an insight card: "Your resting HR was 11 bpm above your 30-day
  average. Your sleep latency was 3x longer than usual."

**Design tests:**
- Can the user visually connect the glucose spike to the HR elevation?
- Does the sleep hypnogram's time axis align with the HR series above it?
- Is the meal annotation visible across all panels?

---

## S2 — Alcohol Suppresses HRV and REM

**User:** Social drinker who had 3 glasses of wine at a dinner party

**What happened:**
Alcohol suppresses parasympathetic nervous system activity. HRV drops
significantly (28 ms vs 45 ms average). RHR stays elevated all night (68 vs
60). REM sleep is nearly absent in the first half of the night — it shifts to
the second half but total REM is still 40% below normal. Readiness score next
morning is 48.

**Metrics involved:**

| Metric               | Type   | Source | Signal                              |
|----------------------|--------|--------|-------------------------------------|
| `hrv`                | daily  | Oura   | 28 ms vs 30-day avg 45             |
| `rhr`                | daily  | Oura   | 68 bpm vs avg 60                   |
| `heart_rate`         | series | Oura   | Elevated baseline through 3 AM      |
| `rem_sleep`          | daily  | Oura   | 0.6 hr vs avg 1.8                   |
| `sleep_stage`        | period | Oura   | REM absent first half, compressed   |
| `deep_sleep`         | daily  | Oura   | Slightly elevated (rebound effect)  |
| `sleep_score`        | daily  | Oura   | 58                                  |
| `readiness_score`    | daily  | Oura   | 48 next morning                     |

**Causal chain:**
```
[alcohol] → HRV suppressed → RHR elevated → REM delayed/reduced → low readiness next day
```

**What the user wants to see:**
- HRV and RHR on the same night view, showing the divergence from baseline
- Sleep stage hypnogram showing the characteristic "REM desert" in the first
  half, with REM backloaded
- Next-morning readiness score contextualized against the night's data
- Multi-day view showing the 1-2 day recovery arc

**Design tests:**
- Can the user see the HRV/RHR deviation without needing to remember their
  baseline? (Need reference lines or shaded "normal range" bands)
- Does the hypnogram clearly show the temporal shift of REM?
- Can the user zoom from "this night" to "this week" to see the recovery?

---

## S3 — Hard Workout Recovery Arc

**User:** Recreational runner who did an unusually intense 10K

**What happened:**
Post-workout heart rate stayed elevated for 2+ hours. That night, HRV was
suppressed and body temperature deviation was +0.4C. Next morning readiness was
low. Over the next 2 days, HRV gradually recovered while activity score was kept
moderate. By day 3, readiness is back above baseline.

**Metrics involved:**

| Metric                      | Type   | Source | Signal                          |
|-----------------------------|--------|--------|---------------------------------|
| `workout`                   | period | Oura   | 10K run, 52 min, HR avg 168     |
| `heart_rate`                | series | Oura   | Elevated 2hr post-workout        |
| `active_calories`           | daily  | Oura   | 620 kcal (2x normal)            |
| `hrv`                       | daily  | Oura   | 26 ms night-of, 34 day 2, 48 day 3 |
| `rhr`                       | daily  | Oura   | 66 bpm night-of, 63, 59          |
| `body_temperature_deviation`| daily  | Oura   | +0.4C night-of                   |
| `readiness_score`           | daily  | Oura   | 42 → 61 → 82 over 3 days        |
| `sleep_score`               | daily  | Oura   | 71 night-of (restless)           |

**Causal chain:**
```
[intense workout] → elevated HR → HRV drops + temp up → poor sleep → low readiness
                                                      → day 2 moderate activity → recovery
                                                      → day 3 baseline restored
```

**What the user wants to see:**
- Multi-day view (3-5 days) showing the workout event marker, then the
  downstream HRV/readiness recovery arc
- Body temperature deviation as a subtle background indicator
- Clear "below baseline" and "above baseline" reference bands for HRV and RHR
- The workout period shown alongside the post-workout HR series

**Design tests:**
- Can the user see the 3-day recovery pattern at a glance?
- Are reference bands (personal baseline) intuitive without explanation?
- Does the workout annotation persist across the multi-day view?

---

## S4 — Doctor Visit Preparation

**User:** Patient preparing for a cardiology follow-up

**What happened:**
Nothing acute — the user wants to compile 30 days of cardiovascular data to
share with their cardiologist. They noticed their RHR has been trending up over
the past month and their HRV has been declining. They want to show the trend
clearly and correlate it with their sleep quality to ask: "Could my worsening
sleep be related to these cardiovascular changes?"

**Metrics involved:**

| Metric               | Type   | Source | Signal                              |
|----------------------|--------|--------|-------------------------------------|
| `rhr`                | daily  | Oura   | Trend: 58 → 66 over 30 days        |
| `hrv`                | daily  | Oura   | Trend: 48 → 32 over 30 days        |
| `sleep_score`        | daily  | Oura   | Trend: 85 → 72 over 30 days        |
| `sleep_efficiency`   | daily  | Oura   | Declining from 92% to 84%          |
| `respiratory_rate`   | daily  | Oura   | Slight uptrend (14.5 → 16.2 rpm)   |
| `spo2`               | daily  | Oura   | Stable at 96-97%                    |

**Causal chain:**
```
[unknown cause] → RHR trending up + HRV trending down → sleep quality declining
                                                       → respiratory rate creeping up
                                                       → SpO2 stable (rules out some causes)
```

**What the user wants to see:**
- 30-day trend lines for RHR, HRV, sleep score on shared time axis
- Trendlines or moving averages to smooth daily noise
- A correlation indicator: "RHR and sleep score have -0.72 correlation over this
  period"
- A clean, shareable view their doctor can read without a Totus account
- Annotations for any events (medication changes, travel) that might explain the
  shift

**Design tests:**
- Is the 30-day trend readable at a glance, or is there too much noise?
  (Moving average vs raw data toggle)
- Can the user select exactly which metrics to include in a share link?
- Does the shared view preserve the correlation context?
- Is the view clean enough for a clinician who has 8 minutes per appointment?

---

## S5 — Travel and Timezone Recovery

**User:** Business traveler who flew SFO → London (8-hour timezone shift)

**What happened:**
Jet lag disrupts circadian rhythm. Body temperature deviation spikes.
Sleep timing shifts erratically for 4-5 days. Sleep efficiency drops. HRV is
suppressed. The user wants to see how long it takes to re-adapt and whether
they're back to baseline before an important presentation on day 5.

**Metrics involved:**

| Metric                      | Type   | Source | Signal                          |
|-----------------------------|--------|--------|---------------------------------|
| `body_temperature_deviation`| daily  | Oura   | +0.6C day 1, slowly normalizing |
| `sleep_stage`               | period | Oura   | Fragmented, short cycles         |
| `sleep_efficiency`          | daily  | Oura   | 78% → 82% → 86% → 90%          |
| `sleep_latency`             | daily  | Oura   | 45 min → 30 → 20 → 14           |
| `hrv`                       | daily  | Oura   | 30 → 35 → 40 → 44               |
| `readiness_score`           | daily  | Oura   | 38 → 52 → 68 → 79               |
| `steps`                     | daily  | Oura   | Variable (exploring vs meetings) |

**Causal chain:**
```
[timezone shift] → temp deviation up → fragmented sleep → HRV suppressed → low readiness
                                     → gradual circadian re-alignment over 4-5 days
```

**What the user wants to see:**
- A multi-day stacked view showing the convergence back to baseline
- Each metric as a sparkline strip, all sharing the same day axis
- "Baseline" reference bands so they can see how far off they are and when
  they've recovered
- A clear answer to: "Am I back to normal by Thursday?"

**Design tests:**
- Is the multi-day recovery pattern as readable as the single-night view?
- Can the user compare "day 1 post-travel" vs "day 5" without scrolling?
- Do baseline bands clearly communicate "you're back to normal"?

---

## S6 — Weekly Pattern Discovery

**User:** Knowledge worker trying to optimize their week

**What happened:**
Nothing acute. The user suspects their weekend social habits (late nights
Friday/Saturday, alcohol, irregular meals) create a "Monday recovery debt" that
affects their performance. They want a week-over-week view to confirm or refute
this pattern.

**Metrics involved:**

| Metric               | Type   | Source | Signal                              |
|----------------------|--------|--------|-------------------------------------|
| `sleep_score`        | daily  | Oura   | Dips Sun/Mon, peaks Wed/Thu         |
| `hrv`                | daily  | Oura   | Low Mon AM, peaks mid-week          |
| `readiness_score`    | daily  | Oura   | Lowest Mon, highest Wed/Thu         |
| `rhr`                | daily  | Oura   | Elevated Sun/Mon nights             |
| `steps`              | daily  | Oura   | High Sat, low Sun, moderate weekdays|
| `deep_sleep`         | daily  | Oura   | Suppressed Fri/Sat nights           |

**Causal chain:**
```
[Fri/Sat late nights + alcohol] → suppressed deep sleep → low HRV Mon → low readiness Mon/Tue
                                                        → recovery by Wed → peak Thu
                                                        → repeat cycle
```

**What the user wants to see:**
- A "week overlay" or heatmap showing metric values by day-of-week, averaged
  over 4+ weeks
- Day-of-week patterns for each metric aligned vertically
- The weekly cycle as a visual pattern, not individual data points
- Ability to see if the pattern is consistent across weeks or just an impression

**Design tests:**
- Can the user see the weekly rhythm in under 5 seconds?
- Is a heatmap (Mon-Sun x Metric) more effective than 7-day sparklines?
- Can the user compare "last 4 Mondays" vs "last 4 Thursdays"?

---

## S7 — Illness Early Detection

**User:** Regular Oura user who is about to get sick

**What happened:**
The body mounts an immune response before symptoms appear. Body temperature
deviation rises (+0.8C). RHR elevates. HRV drops. Respiratory rate increases.
These changes start 24-48 hours before the user feels ill. If the dashboard
surfaces this pattern, the user can take early action (rest, cancel plans).

**Metrics involved:**

| Metric                      | Type   | Source | Signal                          |
|-----------------------------|--------|--------|---------------------------------|
| `body_temperature_deviation`| daily  | Oura   | +0.8C (normally ±0.2)           |
| `rhr`                       | daily  | Oura   | 72 bpm (normally 59)            |
| `hrv`                       | daily  | Oura   | 22 ms (normally 44)             |
| `respiratory_rate`          | daily  | Oura   | 17.5 rpm (normally 14.8)        |
| `readiness_score`           | daily  | Oura   | 35                               |
| `spo2`                      | daily  | Oura   | 94% (normally 97%)              |
| `sleep_score`               | daily  | Oura   | 52 (restless, frequent waking)   |

**Causal chain:**
```
[immune response] → temp up + RHR up + HRV down + resp rate up + SpO2 down
                  → all at once, creating a distinct "illness signature"
                  → readiness plummets → sleep disrupted
```

**What the user wants to see:**
- An anomaly alert: "4 of your 6 tracked metrics are significantly outside your
  normal range today"
- All deviating metrics shown together with their normal range bands, making the
  simultaneous deviation pattern unmistakable
- Historical comparison: "Last time you saw this pattern was Jan 12 (you had the
  flu)"

**Design tests:**
- Can the user see "everything is off" in one glance?
- Do anomaly indicators (color, badges, alert cards) work without being alarmist?
- Is there a clear difference between "one metric is off" (normal) and "five
  metrics are off simultaneously" (pattern)?

---

## S8 — Sharing Sleep Report with Spouse / Accountability Partner

**User:** Couple doing a "sleep challenge" together

**What happened:**
Two users share selected metrics with each other to stay accountable on a 30-day
sleep improvement goal. They want a simple, comparative view — not a clinical
dashboard. Focus is on sleep score, bedtime consistency, and deep sleep trends.

**Metrics involved:**

| Metric               | Type   | Source | Signal                              |
|----------------------|--------|--------|-------------------------------------|
| `sleep_score`        | daily  | Oura   | Both users, 30-day trend            |
| `deep_sleep`         | daily  | Oura   | Both users, 30-day trend            |
| `sleep_stage`        | period | Oura   | Bedtime/wake-time consistency       |
| `sleep_latency`      | daily  | Oura   | Improvement trend                   |

**What the user wants to see:**
- A clean, limited view — only the shared metrics, nothing else
- Maybe a side-by-side or overlaid comparison
- Weekly progress summary

**Design tests:**
- Does the viewer experience feel simple and non-overwhelming?
- Are permissions clearly visible (what am I sharing, what am I not)?
- Is this a different layout than the full owner dashboard, or the same with
  fewer metrics?

---

## Summary: Design Requirements Extracted from Scenarios

### Core visualization patterns needed:

1. **Time-aligned sparkline strips** (S1, S2, S3, S5, S7)
   Every scenario requires vertically stacked metrics on a shared time axis.

2. **Annotation/event layer** (S1, S2, S3, S5)
   Meals, workouts, travel, alcohol — events that explain the "why" behind metric changes.

3. **Baseline reference bands** (S2, S3, S5, S7)
   Personal 30-day average ± 1 SD shaded range on every metric. Users can't interpret raw values without context.

4. **Insight cards** (S1, S4, S7)
   Natural-language summaries of detected patterns: "Your RHR was 11 bpm above baseline."

5. **Multi-day recovery view** (S3, S5)
   3-7 day view showing a recovery arc, with the triggering event as an anchor.

6. **Trend/moving average toggle** (S4, S6)
   Smooth noisy daily data for 30-day views. 7-day rolling average as default for monthly views.

7. **Weekly pattern view** (S6)
   Day-of-week heatmap or overlay — a different temporal lens than the linear timeline.

8. **Anomaly detection** (S7)
   Highlight when multiple metrics deviate simultaneously. Requires computing deviation from personal baseline.

9. **Shareable/viewer mode** (S4, S8)
   Clean, limited view for non-account viewers. Must preserve correlation context.

10. **Correlation indicators** (S4)
    Statistical correlation between selected metric pairs over a date range.

### Time scales needed:

| Scale          | Scenarios      | Primary pattern                    |
|----------------|----------------|------------------------------------|
| Single night   | S1, S2         | Intraday series + sleep hypnogram  |
| 3-5 days       | S3, S5         | Recovery arc after event           |
| 7-day          | S6             | Weekly rhythm                      |
| 30-day         | S4, S7, S8     | Long-term trend + correlation      |

### Data types by scenario:

| Scenario | Daily | Series (intraday) | Period (events) |
|----------|-------|--------------------|-----------------|
| S1       | x     | x (glucose, HR)    | x (meal, sleep) |
| S2       | x     | x (HR)             | x (sleep)       |
| S3       | x     | x (HR)             | x (workout)     |
| S4       | x     |                    |                 |
| S5       | x     |                    | x (sleep)       |
| S6       | x     |                    |                 |
| S7       | x     |                    |                 |
| S8       | x     |                    | x (sleep)       |
