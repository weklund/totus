# Dashboard Wireframes

Wireframe specs for the correlated biomarker dashboard redesign.
Reference: [User Scenarios](./user-scenarios.md)

---

## Design Principles

1. **Shared time axis** — All metrics on a page share the same horizontal time
   axis. Temporal alignment is the single most important pattern for surfacing
   correlations.

2. **Baseline context always visible** — Every metric shows a shaded "normal
   range" band (personal 30-day avg +/- 1 SD). Users can't interpret "72 bpm"
   without knowing their normal is 61.

3. **Overview first, details on demand** — Shneiderman's mantra. Compact
   sparklines for scanning, click/tap to expand into full detail.

4. **Annotations span all panels** — A meal marker, workout marker, or travel
   marker draws a vertical line across every sparkline strip. This is what makes
   cause-and-effect visible.

5. **Progressive disclosure** — Insight cards give the narrative up front. The
   charts provide evidence. Power users explore; casual users read the summary.

---

## W1 — Night Detail View (scenarios S1, S2)

The primary view for "what happened last night?"

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Mar 28, 2026                               [Day] [Night] [Week]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 💡 INSIGHT CARD                                              │   │
│  │                                                               │   │
│  │ Your resting HR was 11 bpm above your 30-day average.        │   │
│  │ Sleep onset took 35 min (usually 12). Deep sleep was half    │   │
│  │ your normal. A glucose spike at 9:45 PM preceded the         │   │
│  │ elevated heart rate.                                          │   │
│  │                                                               │   │
│  │ Related metrics: glucose, heart rate, sleep latency,          │   │
│  │ deep sleep                                          [Dismiss] │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ── 8 PM ──── 10 PM ──── 12 AM ──── 2 AM ──── 4 AM ──── 6 AM ──  │
│                 ▼ meal                                               │
│                 :                                                    │
│  ┌─ Glucose ───:────────────────────────────────────────────────┐  │
│  │  mg/dL      :   ╭──╮                                         │  │
│  │  180 ╌╌╌╌╌╌:╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ threshold   │  │
│  │        ╭───:╯     ╰──────╮                                   │  │
│  │  110 ──╯   :              ╰───────────── ── ──               │  │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ normal band  │  │
│  │   70 ╌╌╌╌╌╌:╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ threshold   │  │
│  └─────────────:────────────────────────────────────────────────┘  │
│                 :                                                    │
│  ┌─ Heart Rate :────────────────────────────────────────────────┐  │
│  │  bpm        :                                                 │  │
│  │  80 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  │  │
│  │       ╭────:──────╮                                           │  │
│  │  72 ──╯    :       ╰───────╮          ╭──╮                   │  │
│  │  ░░░░░░░░░░:░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ normal band  │  │
│  │  61 ──────────────────────────────────────────── baseline    │  │
│  │            :                ╰──────╯╰──╰─╯──╯               │  │
│  └─────────────:────────────────────────────────────────────────┘  │
│                 :                                                    │
│  ┌─ Sleep ─────:────────────────────────────────────────────────┐  │
│  │  stages     :                                                 │  │
│  │             : ◀── 35 min ──▶                                  │  │
│  │  awake      :▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░▓▓░░░░░░░░░░░░░▓▓▓▓▓▓▓▓  │  │
│  │  light      :               ░████░░░░████░░░████░░░           │  │
│  │  deep       :               ░░░░░░░░░░░░░██░░░░██░           │  │
│  │  REM        :               ░░░░░░██░░░░░░░░░░░░░░███        │  │
│  └─────────────:────────────────────────────────────────────────┘  │
│                                                                     │
│  ── Summary ────────────────────────────────────────────────────── │
│  │ Sleep Score │ Deep Sleep  │ Sleep Latency │   HRV    │  RHR   │ │
│  │     64      │   0.8 hr    │    35 min     │  32 ms   │ 72 bpm │ │
│  │   ▼ 19      │   ▼ 0.8     │   ▼ 23 min    │  ▼ 13    │ ▲ 11   │ │
│  │  vs avg     │  vs avg     │   vs avg      │ vs avg   │ vs avg │ │
│  └─────────────────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────────┘
```

### Key elements:

- **Insight card** at the top — narrative summary. Dismissible. Auto-generated
  when multiple metrics deviate from baseline simultaneously.
- **Shared time axis** — 8 PM to 6 AM for night view. All panels aligned.
- **Annotation marker** — `▼ meal` with a vertical dotted line running through
  all panels. Click to see event details.
- **Normal range bands** — `░░░` shaded region on glucose and HR panels. When
  the line exits the band, the problem is visually obvious.
- **Threshold lines** — Clinical reference lines for glucose (70/180 mg/dL).
- **Baseline line** — Personal 30-day average as a dashed horizontal line.
- **Sleep hypnogram** — Horizontal bars by stage. Aligned to the same time axis
  so you can see "HR was still elevated when sleep started."
- **Summary strip** — Key daily metrics with delta-from-average. Color coded:
  red for worse-than-usual, green for better.

---

## W2 — Multi-Day Recovery View (scenarios S3, S5)

For tracking recovery arcs over 3-7 days after a triggering event.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Recovery: Mar 24-28, 2026                   [Day] [Night] [Week]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 💡 After your 10K on Mar 24, it took 3 days for your HRV    │   │
│  │ and readiness to return to baseline.                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ── Mon 24 ────── Tue 25 ────── Wed 26 ────── Thu 27 ────── Fri ─ │
│      ▼ 10K run                                                      │
│      :                                                              │
│  ┌─ Readiness ─:───────────────────────────────────────────────┐   │
│  │  score      :                                                │   │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ baseline 78  │   │
│  │  82 ──╮     :                                    ╭── 82     │   │
│  │       ╰╮    :                              ╭────╯           │   │
│  │  61 ───╰────:──╮                     ╭────╯                 │   │
│  │             :   ╰────────────────────╯                      │   │
│  │  42 ────────:─╯                                              │   │
│  └─────────────:───────────────────────────────────────────────┘   │
│      :                                                              │
│  ┌─ HRV ──────:───────────────────────────────────────────────┐   │
│  │  ms         :                                                │   │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ baseline 44  │   │
│  │  48 ──╮     :                                    ╭── 48     │   │
│  │       ╰╮    :                              ╭────╯           │   │
│  │  34 ───╰────:──╮                     ╭────╯                 │   │
│  │             :   ╰────────────────────╯                      │   │
│  │  26 ────────:─╯                                              │   │
│  └─────────────:───────────────────────────────────────────────┘   │
│      :                                                              │
│  ┌─ Resting HR :───────────────────────────────────────────────┐   │
│  │  bpm        :                                                │   │
│  │  66 ────────:─╮                                              │   │
│  │             :  ╰──╮                                          │   │
│  │  63 ───────────────╰──╮                                      │   │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ baseline 59  │   │
│  │  59 ──╮     :          ╰────────────────────────── 59       │   │
│  └─────────────:───────────────────────────────────────────────┘   │
│      :                                                              │
│  ┌─ Body Temp Deviation ───────────────────────────────────────┐   │
│  │  +0.4 ──────:─╮                                              │   │
│  │  +0.2 ───────╰─╮                                             │   │
│  │   0.0 ░░░░░░░░░╰──────────────────────────────── normal     │   │
│  │  -0.2                                                        │   │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ── Daily Scores ──────────────────────────────────────────────── │
│  │         │ Mon 24 │ Tue 25 │ Wed 26 │ Thu 27 │ Fri 28 │       │ │
│  │ Ready.  │  🔴 42  │  🟡 61  │  🟡 68  │  🟢 82  │  🟢 84  │       │ │
│  │ Sleep   │  🟡 71  │  🟡 74  │  🟢 81  │  🟢 86  │  🟢 85  │       │ │
│  │ HRV     │  🔴 26  │  🟡 34  │  🟡 40  │  🟢 48  │  🟢 50  │       │ │
│  └─────────────────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────────┘
```

### Key elements:

- **Workout event marker** — Vertical dotted line from the 10K run, anchoring
  the recovery narrative.
- **Baseline bands** — Shaded `░░░` region showing personal normal range. The
  metric dips below, then recovers back into the band.
- **Convergence pattern** — All metrics visually converge back to the band over
  3 days. The shape of the recovery is the insight.
- **Daily score strip** — Traffic-light colored daily values. Scannable without
  reading the charts.
- **Compact sparklines** — Each panel is shorter than in the night view — enough
  to show the trend shape, not individual data points.

---

## W3 — 30-Day Trend View (scenario S4)

For long-term trend analysis and medical sharing.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Feb 27 — Mar 28, 2026                   [7D] [30D] [90D] [1Y] │
│  Resolution: ○ Daily  ● 7-Day Avg  ○ Monthly                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 📊 CORRELATION CARD                                          │   │
│  │                                                               │   │
│  │ Over the past 30 days:                                        │   │
│  │ • RHR trending up: 58 → 66 bpm (+14%)                        │   │
│  │ • HRV trending down: 48 → 32 ms (-33%)                       │   │
│  │ • Sleep score declining: 85 → 72 (-15%)                       │   │
│  │                                                               │   │
│  │ RHR ↔ Sleep Score correlation: -0.72 (strong inverse)         │   │
│  │ HRV ↔ Sleep Score correlation: +0.68 (strong positive)        │   │
│  │                                                    [Share ↗]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ── Feb 27 ────── Mar 5 ────── Mar 12 ────── Mar 19 ────── 28 ── │
│                                                                     │
│  ┌─ Resting HR ────────────────────────────────────────────────┐  │
│  │  bpm                                                         │  │
│  │  68 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╭──── 66  │  │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ╭──╯          │  │
│  │  62 ── avg ──────────────── ╭────────────────╯              │  │
│  │                      ╭─────╯                                 │  │
│  │  58 ──────────╮╭────╯                                        │  │
│  │               ╰╯                  ──── 7-day rolling avg     │  │
│  │                                   ···· raw daily values      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ HRV ───────────────────────────────────────────────────────┐  │
│  │  ms                                                          │  │
│  │  48 ──────────╮                                              │  │
│  │               ╰╮╭──╮                                         │  │
│  │  ░░░░░░░░░░░░░░╰╯░░╰──╮░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │
│  │  40 ── avg                ╰──╮                               │  │
│  │                               ╰──────╮                       │  │
│  │  32 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╰──────────── 32     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Sleep Score ───────────────────────────────────────────────┐  │
│  │  score                                                       │  │
│  │  85 ──────────╮                                              │  │
│  │  ░░░░░░░░░░░░░╰╮░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │
│  │  80 ── avg      ╰──╮                                        │  │
│  │                     ╰───╮                                    │  │
│  │  72 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╰──╮──────────────────────── 72    │  │
│  │                             ╰───────╮                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Respiratory Rate ──────────────────────────────────────────┐  │
│  │  rpm     14.5 ────────────── gradually rising ──── 16.2      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ SpO2 ──────────────────────────────────────────────────────┐  │
│  │  %       97 ──────────── stable ─────────────── 96           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  [Share this view ↗]  Select metrics to include in share   │   │
│  │  ☑ RHR  ☑ HRV  ☑ Sleep Score  ☐ Resp Rate  ☐ SpO2        │   │
│  │  Date range: Feb 27 — Mar 28  Expires: [7 days ▾]          │   │
│  │                                         [Create share link] │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Key elements:

- **7-day rolling average** — Smooths daily noise. Trendline becomes the primary
  visual, with raw data points as dots behind it.
- **Correlation card** — Computed Pearson correlation between selected metric
  pairs. Actionable: "strong inverse" tells the user these metrics are moving
  together.
- **Compact sparklines for secondary metrics** — Respiratory rate and SpO2 get
  single-line sparklines because they're supporting evidence, not the main story.
- **Share controls** — Inline share panel. User selects exactly which metrics and
  date range. The shared view shows the same layout but read-only.
- **Resolution toggle** — Daily / 7-day avg / monthly. Different time scales
  reveal different patterns.

---

## W4 — Weekly Pattern View (scenario S6)

A day-of-week lens for discovering recurring rhythms.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Weekly Patterns (last 8 weeks)               [Timeline] [Weekly]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 💡 Your readiness score is consistently lowest on Mondays    │   │
│  │ (avg 62) and peaks on Wednesdays (avg 81). Sleep score       │   │
│  │ follows the same pattern with a 1-day lag.                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  HEATMAP — Average by day of week                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Mon    Tue    Wed    Thu    Fri    Sat    Sun   │   │
│  │             ─────  ─────  ─────  ─────  ─────  ─────  ───── │   │
│  │  Readiness │ ██▒▒ │ ██▓▒ │ ████ │ ████ │ ██▓▒ │ ██▓▒ │ ██▒▒│   │
│  │    score   │  62  │  71  │  81  │  82  │  75  │  72  │  65 │   │
│  │            │      │      │      │      │      │      │     │   │
│  │  Sleep     │ ██▓▒ │ ██▒▒ │ ██▓▒ │ ████ │ ████ │ ██▓▒ │ ██▒▒│   │
│  │    score   │  74  │  68  │  78  │  84  │  83  │  75  │  66 │   │
│  │            │      │      │      │      │      │      │     │   │
│  │  HRV       │ ██▒▒ │ ██▓▒ │ ████ │ ████ │ ██▓▒ │ ██▓▒ │ ██▒▒│   │
│  │    (ms)    │  32  │  38  │  46  │  47  │  42  │  39  │  33 │   │
│  │            │      │      │      │      │      │      │     │   │
│  │  RHR       │ ████ │ ██▓▒ │ ██▒▒ │ ██▒▒ │ ██▓▒ │ ██▓▒ │ ████│   │
│  │    (bpm)   │  66  │  63  │  59  │  58  │  61  │  63  │  67 │   │
│  │            │      │      │      │      │      │      │     │   │
│  │  Deep      │ ██▒▒ │ ██▓▒ │ ████ │ ████ │ ██▓▒ │ ██▒▒ │ ██▒▒│   │
│  │    sleep   │  0.9 │  1.2 │  1.7 │  1.8 │  1.4 │  1.0 │  0.8│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Legend:  ████ = best quartile   ██▓▒ = mid   ██▒▒ = worst quartile │
│                                                                     │
│  ── Day-of-week sparklines ──────────────────────────────────────  │
│                                                                     │
│  Readiness  Mon ╌╌╌╮           ╭╌╌╌╌╌╌╮           ╭╌╌╌╌╌╮         │
│                     ╰╌╌╌╌╌╌╌╌╌╯       ╰╌╌╌╌╌╌╌╌╌╌╯     ╰╌╌╌ Sun │
│                     ▲ peak Wed/Thu      ▼ trough Sun/Mon            │
│                                                                     │
│  Sleep      Mon ╌╌╌╌╌╮         ╭╌╌╌╌╌╌╌╌╮         ╭╌╌╌╌╮         │
│                       ╰╌╌╌╌╌╌╌╯          ╰╌╌╌╌╌╌╌╌╯    ╰╌╌╌ Sun │
│                       ▲ peak Thu/Fri       ▼ trough Tue/Sun         │
│                                                                     │
│  ── Consistency score ──────────────────────────────────────────── │
│  │ Week-to-week variance:  Readiness ██░░░ High variance           │ │
│  │                         Sleep     ██░░░ High variance           │ │
│  │                         HRV       ████░ Moderate variance       │ │
│  │                                                                 │ │
│  │ "High weekly variance suggests a recurring behavioral pattern   │ │
│  │  rather than random noise."                                     │ │
│  └──────────────────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────────┘
```

### Key elements:

- **Heatmap** — Day-of-week x metric matrix. Color intensity encodes quartile
  rank. The "Monday dip" pattern jumps out visually.
- **Day-of-week sparklines** — The weekly rhythm as a continuous curve. Peak and
  trough days annotated.
- **Consistency score** — Week-to-week variance tells the user whether the
  pattern is real or just noise. High variance + consistent day-of-week pattern
  = behavioral cause.
- **Inverse RHR coloring** — RHR heatmap colors are inverted (higher = worse),
  so the visual pattern aligns with the other metrics.

---

## W5 — Anomaly Alert View (scenario S7)

When multiple metrics simultaneously deviate from baseline.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Mar 28, 2026                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ⚠️  ANOMALY: 5 of 6 tracked metrics are outside your        │   │
│  │ normal range today.                                          │   │
│  │                                                               │   │
│  │  Body Temp   +0.8C   ████████████████████░░░  ← you are here │   │
│  │  RHR         72 bpm  ██████████████████░░░░░                  │   │
│  │  HRV         22 ms   ██████████████████░░░░░                  │   │
│  │  Resp Rate   17.5    ████████████████░░░░░░░                  │   │
│  │  SpO2        94%     █████████████░░░░░░░░░░                  │   │
│  │  Sleep Score 52      ██████████████████░░░░░                  │   │
│  │                                                               │   │
│  │  This pattern is similar to Jan 12 (flu onset).               │   │
│  │                                            [View Jan 12 →]   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ── Deviation from baseline (30-day personal average) ────────── │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                ▼ today                                        │   │
│  │                :                                              │   │
│  │  Body Temp  ···:·················· +0.8°C  ████ (4x normal)  │   │
│  │  RHR        ···:·················· +13 bpm ███  (above range) │   │
│  │  HRV        ···:·················· -22 ms  ███  (below range) │   │
│  │  Resp Rate  ···:·················· +2.7    ██   (above range) │   │
│  │  SpO2       ···:·················· -3%     ██   (below range) │   │
│  │  Sleep      ···:·················· -31     ████ (below range) │   │
│  │                :                                              │   │
│  │           ◀── 7 day context ──▶   :                           │   │
│  │  normal range ░░░░░░░░░░░░░░░░░  :                           │   │
│  │  actual value ─────────────────  ● today                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ── Historical comparison ──────────────────────────────────────  │
│                                                                     │
│  ┌──────────────────────┬──────────────────────┐                   │
│  │  Today (Mar 28)      │  Jan 12 (flu onset)  │                   │
│  │                      │                      │                   │
│  │  Temp   +0.8C        │  Temp   +0.9C        │                   │
│  │  RHR    72 bpm       │  RHR    74 bpm       │                   │
│  │  HRV    22 ms        │  HRV    19 ms        │                   │
│  │  Resp   17.5 rpm     │  Resp   18.1 rpm     │                   │
│  │  SpO2   94%          │  SpO2   93%          │                   │
│  │  Sleep  52           │  Sleep  48           │                   │
│  └──────────────────────┴──────────────────────┘                   │
│                                                                     │
│  Pattern similarity: 94%                                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Key elements:

- **Anomaly card** — Count of deviating metrics + magnitude bars. The number
  "5 of 6" is the key signal — one metric off is normal, five is a pattern.
- **Horizontal deviation bars** — Each metric shows how far from normal it is.
  All bars pointing the same direction = systemic cause.
- **Historical pattern matching** — Side-by-side comparison with a past similar
  event. "This looks like your flu onset" is the highest-value insight.
- **7-day context sparklines** — Shows the metric was normal until today, making
  the sudden deviation visually stark.

---

## W6 — Component Architecture

How the wireframes map to React components:

```
<DashboardShell>
  ├── <DateNavigation />          ← date picker, range presets, view toggle
  ├── <InsightCard />             ← narrative card (conditional)
  ├── <MetricStripContainer>      ← shared time axis provider
  │   ├── <AnnotationLayer />     ← vertical event markers (meals, workouts)
  │   ├── <MetricStrip metric="glucose" />
  │   ├── <MetricStrip metric="heart_rate" />
  │   ├── <MetricStrip metric="rhr" />
  │   ├── <SleepHypnogram />      ← period-type visualization
  │   └── <LinkedBrush />         ← shared brush selection state
  │
  ├── <SummaryStrip />            ← daily scores with delta-from-avg
  ├── <CorrelationCard />         ← statistical correlation (30-day view)
  ├── <WeeklyHeatmap />           ← day-of-week pattern (weekly view)
  ├── <AnomalyCard />             ← multi-metric deviation alert
  └── <SharePanel />              ← inline share controls

<MetricStrip>
  ├── <MetricLabel />             ← name, current value, unit
  ├── <BaselineBand />            ← shaded normal range (30-day avg ± 1 SD)
  ├── <ThresholdLines />          ← clinical reference (e.g., glucose 70/180)
  ├── <SparklineChart />          ← the actual data line (Recharts Area/Line)
  └── <DeltaBadge />              ← "▲ 11 vs avg" indicator
```

### View modes and which components render:

| Component           | Night (W1) | Recovery (W2) | 30-Day (W3) | Weekly (W4) | Anomaly (W5) |
|---------------------|:----------:|:-------------:|:------------:|:-----------:|:------------:|
| InsightCard         |     x      |       x       |              |      x      |              |
| CorrelationCard     |            |               |       x      |             |              |
| AnomalyCard         |            |               |              |             |      x       |
| MetricStripContainer|     x      |       x       |       x      |             |      x       |
| AnnotationLayer     |     x      |       x       |              |             |              |
| SleepHypnogram      |     x      |               |              |             |              |
| SummaryStrip        |     x      |       x       |              |             |              |
| WeeklyHeatmap       |            |               |              |      x      |              |
| SharePanel          |            |               |       x      |             |              |
| LinkedBrush         |     x      |               |       x      |             |              |
| BaselineBand        |     x      |       x       |       x      |             |      x       |

---

## Interaction Patterns

### Linked Brushing
Select a time range in any MetricStrip → all other strips highlight the same
window. The selected range shows a tooltip with exact values for all visible
metrics at that point.

### Metric Strip Expand/Collapse
Click a MetricStrip header → expands to full chart height with Y-axis labels,
grid lines, and data point markers. Click again → collapses to compact sparkline.

### Annotation Hover
Hover over an annotation marker (meal, workout) → tooltip with event details
appears. The vertical line through all strips highlights the temporal context.

### View Switching
[Day] → single night (W1), intraday series + sleep hypnogram
[Night] → alias for Day, but time axis is 8 PM-6 AM
[Week] → 7-day timeline or weekly pattern heatmap (W4)
[30D] / [90D] / [1Y] → trend view (W3) with rolling average

### Baseline Band Toggle
Click "Show/hide normal range" → toggles the shaded baseline band on all
strips. Default: on.

---

## Figma Implementation Notes

When translating these wireframes to Figma:

1. **Use auto-layout** for the MetricStripContainer — strips should stack
   vertically and resize with the container.

2. **UChart plugin** can render realistic sparkline data from CSV. Export the
   mock data from `src/lib/mock-chart-data.ts` to CSV and import into UChart.

3. **Component variants** in Figma for MetricStrip:
   - State: collapsed (sparkline) / expanded (full chart)
   - Baseline: shown / hidden
   - Anomaly: normal / warning / critical

4. **Color tokens** — Use the existing design system CSS custom properties:
   - `--totus-ocean` (#1E5B7B) for primary metrics
   - `--totus-emerald` (#2FA87B) for positive/good states
   - `--totus-coral` (#E8845A) for warnings/anomalies
   - `--totus-mist` for borders, grid lines
   - `--totus-slate` for secondary text
   - Normal range bands: metric's chart color at 10% opacity

5. **Responsive breakpoints** — Dashboard is desktop-first but:
   - Mobile: single column, strips stack full-width
   - Tablet: same as desktop but narrower
   - The annotation layer collapses to icons on mobile

6. **Dark mode** — All wireframes should work with the existing dark mode tokens:
   - `dark:bg-[#1a2332]` for card backgrounds
   - `dark:border-[#2a3a4a]` for borders
   - Normal range bands use `rgba()` so they adapt automatically
