# Customer Discovery Research — April 2026

Pre-development validation research for Totus. Covers Reddit signal analysis,
Exa-powered competitor/clinician/pricing research, value prop assessment, and
MVP must-haves.

---

## Table of Contents

1. [Reddit Signal Summary](#1-reddit-signal-summary)
2. [Competitor Landscape](#2-competitor-landscape)
3. [Clinician Perspective](#3-clinician-perspective)
4. [Willingness to Pay](#4-willingness-to-pay)
5. [Value Prop Assessment](#5-value-prop-assessment)
6. [MVP Must-Haves](#6-mvp-must-haves)
7. [Pre-Development Checklist](#7-pre-development-checklist)
8. [Recommended Tools](#8-recommended-tools)

---

## 1. Reddit Signal Summary

Analyzed 30+ threads across r/ouraring, r/QuantifiedSelf, r/Biohackers, r/whoop,
r/AppleWatch, r/AppleWatchFitness, r/Garmin, r/privacy, r/PeterAttia, r/Freestylelibre,
r/ChronicPain, and r/TwoXChromosomes (2022–2026).

**Verdict: The pain is real, loud, and consistent.**

### Pain Point 1: Sharing wearable data with doctors is broken

- People search for an app to export Oura/Apple Watch data as a clean report
  for their doctor — and find nothing.
- A developer built a free Oura report generator for doctor visits and was
  flooded with interest + privacy questions.
- Doctor reception is mixed: cardiologists love the data, ER docs are annoyed
  by one-off readings, many PCPs dismiss it entirely. Presentation format
  determines engagement.

Key quotes:

> "I used to email spreadsheets or print Oura reports for my doctor."

> "Does this really not exist? If so shoot me a DM, I can write a quick Swift
> app to pull all that data out for you."

> "If you do make one pls dont collect anyone's data. Just charge a fee for
> unlimited reports."

> "I have mentioned my Oura ring to healthcare professionals and no one has ever
> shown a bit of interest, but to be able to share the trends will be so helpful."

### Pain Point 2: Health data fragmentation is the #1 unsolved QS problem

- Every thread independently uses "silos" and "fragmented" without prompting.
- One user called it "a 9-to-5 hobby" to manually export CSVs and correlate
  data across apps.
- 6–8 people across threads are building their own dashboards (Python scripts,
  Google Sheets + APIs, InfluxDB + Grafana, custom AWS Lambda).
- No existing tool is the consensus answer. Gyroscope, Exist.io, Guava, Oplin —
  all mentioned, none dominant.

Key quotes:

> "I keep hitting the same wall: The Silo Problem. I'm just fkn tired of
> manually exporting CSVs and putting them together. It's like a 9to5 hobby."

> "From what I've seen, there isn't really a true unified hub yet that does all
> three things well: collect across domains, correlate meaningfully, and surface
> conclusions without you doing manual analysis."

> "I've given up on the idea of the universal aggregator."

> "The thing that eventually pushed me over the edge was wanting to ask questions
> across sources, like 'how does my sleep change in weeks when I lift heavier'."

### Pain Point 3: Health data privacy anxiety is intense and growing

- A viral r/ouraring post from a cybersecurity professional exposed Oura's lack
  of MFA, audit trails, and session logs.
- Oura-Palantir/DoD partnership triggered massive backlash, especially around
  reproductive health data post-Roe.
- Users explicitly ask for: audit logs, no data selling, encryption, revocable
  access, ability to self-host.
- Flo Health FTC fine for sharing pregnancy data with Facebook made mainstream
  news.

Key quotes:

> "My coffee rewards web app has 2FA, but Oura? Nope. It's like they built a
> high-tech vault and left the key on the mat."

> "Try using the DuckDuckGo app tracking blocker. Oura is BY FAR the most
> egregious of any app on my phone, sending nearly 10,000 trackers." (33
> upvotes)

> "Those of us in the United States who don't have GDPR or any protection on the
> books regarding personal data... It's a free for all on monetizing US Data."
> (65 upvotes)

> "Focus on privacy and ease of use, not engagement within the app. Most
> important to me: include a privacy policy to prevent you and future investors
> from monetizing their pain data." (11 upvotes)

> "Can you just open source it so we can run it locally? You know, health data
> and all."

### Pattern: People are building their own solutions

At least 6–8 developers across threads mention building custom health dashboards
because nothing commercial works. Tools built include Google Sheets + AppScript
dashboards, Python + local database setups, InfluxDB + Grafana stacks, and
custom AWS Lambda pipelines. This is the strongest demand signal — people are
building rather than waiting.

### Workarounds people currently use

| Tool                       | Type             | Frequency        |
| -------------------------- | ---------------- | ---------------- |
| Apple Health               | Hub/pipe         | Very frequently  |
| Guava Health               | Aggregator app   | Frequently       |
| Google Sheets / Excel      | Manual           | Frequently       |
| Python scripts + APIs      | DIY              | Frequently       |
| InfluxDB + Grafana         | Self-hosted      | Multiple         |
| Exist.io                   | Aggregator       | Multiple         |
| Gyroscope                  | Aggregator app   | Multiple         |
| Cronometer                 | Nutrition        | Multiple         |
| CSV exports + ChatGPT      | Manual + AI      | Emerging pattern |

---

## 2. Competitor Landscape

### Heads Up Health (most direct competitor)

- **What:** Health data analytics platform (est. 2014). Personal + professional
  (clinician) plans. Integrates Oura, Fitbit, Apple Health, Cronometer, LabCorp,
  Quest.
- **What works:** Concept is praised. Labs + wearables + nutrition in one place.
  Clinician version enables branded reports and client management.
- **What's broken:** Dominant theme is "buggy to the point of being unusable."
  Crashes, broken syncs, half the features don't work, zero support response.
  Google Play rating: 2.8 stars.
- **Pricing:** Personal $8.99/mo, Professional $49–149/mo.
- **Totus opportunity:** Heads Up validates the market thesis but has
  catastrophically poor execution. Totus can deliver what Heads Up promises.
  Time-limited sharing with audit logs is more privacy-forward than anything
  Heads Up offers.

### Oplin (newer competitor)

- **What:** Built by a longevity scientist. Android-only. Connects 100+
  wearables via Terra API. AI-powered insights/correlations. ~700 users.
- **What works:** Built from community feedback. Device comparison feature.
  Privacy-conscious (raw data not sent to LLM). Free to use.
- **What's broken:** Very early stage, no iOS, unclear pricing model.
- **Totus opportunity:** Oplin is closest in spirit but lacks the doctor-sharing
  angle entirely. Android-only is a significant limitation.

### Gyroscope (established QS dashboard)

- **What:** All-in-one health dashboard (est. 2014). AI coaching, "Food X-Ray,"
  CGM integration. 10+ years of iteration.
- **What works:** Beautiful visualization. Loyal long-term users. A physician
  recommends it to patients.
- **What's broken:** Aggressive price increases are actively destroying the
  community. Multiple confusing tiers ($30–$179). A user was banned from the
  subreddit after posting pricing criticism. Subreddit is nearly dead.
- **Pricing:** G1 $29.99, X $99, Pro V6 $95.99, AI Coach $29–179, Ultra $99.
- **Totus opportunity:** Gyroscope proves beautiful visualization has a market
  but shows the danger of opaque, aggressive monetization. Totus should learn
  from its strengths (visualization) while avoiding the pricing trap.

### Terra API (developer-focused aggregation)

- **What:** Unified API for 500+ health metrics. B2B/developer tool, not
  consumer-facing.
- **Pricing:** $499/mo base. Effective cost: ~$4,800–$10,800/yr for 500–1,000
  users.
- **Totus relevance:** Potential vendor for rapid multi-device expansion, not a
  competitor. At $499/mo, expensive for pre-PMF. Direct Oura integration is more
  cost-effective for MVP scope.

### Sahha (health data API)

- **What:** Australian health data API. Works with just a smartphone (Apple
  Health/Google Fit). AI-powered health scores and behavioral biomarkers.
- **Pricing:** Free sandbox (25 users), $299/mo (up to 1,000 users).
- **Totus relevance:** Another potential vendor. Phone-only data collection
  trades accuracy for coverage — may not meet clinical-sharing accuracy needs.

### Other competitors found in the wild

| Name          | Status               | Notes                                   |
| ------------- | -------------------- | --------------------------------------- |
| WearSync      | Open-source          | Garmin + Whoop + Apple Health + Oura    |
| Realize Me    | Early stage          | Correlation focus                       |
| MediSafe      | Local-first vault    | AI health assistant, no cloud           |
| Omnio         | Waitlist             | Cross-source analytics with AI Q&A      |
| FitnessSyncer | Established          | Syncs 70+ platforms, no analysis        |
| Reflect       | iOS app              | Shows correlations, weekly reports      |
| Kygo          | New                  | Nutrition + wearable correlation        |
| Welltory      | Established          | "Starting to slip," no desktop          |

### Strategic takeaway

Nobody owns the "secure health vault for doctor sharing" positioning. Heads Up
is the closest but execution is catastrophically poor. Totus's time-limited
sharing with audit logs is a genuine differentiator. Execution quality (reliable
sync, polished UX) is the moat — the #1 complaint across every competitor is
bugs and broken syncs.

---

## 3. Clinician Perspective

Based on Exa research including peer-reviewed systematic reviews (npj Digital
Medicine, JMIR, J Gen Intern Med), clinical case studies, and practitioner
content.

### Do doctors actually want patient wearable data?

**Yes, but conditionally.**

- 90.5% of HCPs in a VA study agreed wearable data promotes patient engagement
  and said they would refer to automatically collected sensor data.
- 75% of secondary care providers said they would trust smartwatch data as much
  as information from directly questioning patients.
- Some HCPs noted that even imperfect consumer data outweighs having no data at
  all.

**Conditions under which they want it:**

- When it provides info they can't get otherwise (between-visit data, sleep,
  daily activity)
- When data is relevant to the clinical context (chronic disease, post-surgical
  recovery)
- When they control the timing (not real-time alerts pushed to them)
- When it is summarized and contextualized, not raw data dumps
- When institutional guidelines exist for how to act on it

### What format do clinicians want?

**Summaries and trends over raw data, every time.**

- Line graphs were the most popular visualization (50%).
- Color-coded charts (red/yellow/green) strongly favored for instant
  interpretation.
- Surgeons want baseline comparisons (where patient started vs. now).
- One physician specifically asked for: "Summary of PGHD from past week
  automatically sent to clinician the day before an appointment."

**What they do NOT want:**

- Proprietary synthetic indices (e.g., "sleep scores") with unknown algorithms —
  they want underlying metrics (HRV, RHR, sleep duration)
- Real-time automated alerts that create liability
- Raw unprocessed data streams
- Having to log into a separate portal

### Workflow barriers

1. **Time and workload** — #1 concern. Adding data review is seen as an unfunded
   mandate. Solution: delegate initial triage to nurses/health coaches.
2. **EHR integration** — 100% of providers said reports should integrate with
   the EHR. Currently most sharing is ad hoc (phone screens, texted
   screenshots).
3. **Medical-legal liability** — If data sits in a portal, the physician has
   responsibility. One doctor: "If a patient captures their own data and
   discards it, there's no liability. But if it's sitting in a portal for me,
   there is."
4. **Data accuracy** — Major concerns about validity and reliability. Passively
   collected data (steps, HR, sleep) trusted more than actively reported data.
5. **Expectation management** — Patients may expect providers to validate all
   data regardless of clinical meaning.

### Which clinicians are most receptive?

**Tier 1 — Already using wearable data (the beachhead):**

- Functional medicine / integrative medicine practitioners (Living Proof
  Institute, Dr. Florence Comite, Ciba Health all use Oura + CGM data)
- NBHWC-certified health coaches (use wearable data more frequently and
  enthusiastically than clinical providers in VA study)
- Concierge / longevity medicine (premium fees, time for data review)

**Tier 2 — Strong interest, emerging use:**

- Cardiologists (wearable ECG changing arrhythmia detection)
- Endocrinologists / diabetes care (CGM is most mature wearable-to-clinician
  pipeline)
- Sleep medicine (HRV, RHR, sleep staging, SpO2 directly relevant)
- Mental health / psychiatry (sleep, HRV, activity as behavioral markers)

**Tier 3 — Interested but significant barriers:**

- Primary care / general practice (positive conceptually but 15-min visits leave
  no room)
- Surgeons (interested in post-op recovery monitoring)

**Tier 4 — Low interest:**

- Emergency / acute care

### What clinicians wish existed

1. Dashboard integrated into the EHR with annotated wearable metrics
2. Pre-visit summaries — past week/month of data, color-coded for out-of-range
3. Specialty-specific views — different presentations for different contexts
4. Clinician-controlled alert thresholds
5. Baseline comparison tools (auto before/after treatment)

Key clinician quote:

> "When you have thousands of patients in your program, what you really need are
> reports to quickly surface the clients who have gone out of range. We use the
> Heads Up reporting tools to flag out-of-range glucose values from the
> Freestyle Libre CGM, weight readings from the Withings scale, and HRV/Temp/HR
> from Oura, so our coaches can start their day with a short list of clients who
> need attention first." — Dr. Innocent Clement, MD (Ciba Health)

### Implication for Totus

- **Beachhead market is functional medicine + health coaches**, not mainstream
  primary care.
- **Core product value is the "pre-visit summary"** — contextualized, color-coded
  report with delta-from-baseline.
- **Position as patient-sharing (patient initiates), not clinical monitoring
  (provider responsible).** This distinction determines adoption and avoids
  liability concerns.
- **"No account needed" for viewers is validated.** Clinicians don't want
  another login.

---

## 4. Willingness to Pay

### Consumer price expectations

| Tier            | Price      | What consumers expect                                             |
| --------------- | ---------- | ----------------------------------------------------------------- |
| Free            | $0         | Basic metric display, scores, access to own data, simple trends   |
| Sweet spot      | $5–10/mo   | Cross-device aggregation, correlations, shareable reports          |
| Premium         | $12–15/mo  | AI-powered coaching, personalized recommendations                 |
| Resistance      | $20–30/mo  | Whoop at $30/mo generates active resentment and churn             |

Reference points: Oura $5.99/mo, Fitbit Premium $9.99/mo, Cora $9.99/mo.

### What drives payment vs. expectation of free

**Worth paying for:**

- Actionable, personalized insights (not generic AI summaries)
- Cross-device data aggregation
- Correlation analysis ("how does X affect Y?")
- Data security and privacy ($12–13 WTP for cybersecurity features alone)
- Sharing with healthcare providers

**Not worth paying for (generates resentment):**

- Access to your own raw data (Oura subscription backlash)
- Generic AI summaries that restate what metrics already show (Garmin Connect+
  backlash)
- Gamification without underlying intelligence

### Subscription fatigue is real

- 95% of users actively avoid subscription-based wearables (PCMag poll)
- Multiple brands (Amazfit, Xiaomi, Ultrahuman, RingConn) explicitly market
  "subscription-free" as primary differentiator
- Users are stacking: Oura ($6) + Fitbit ($10) + nutrition app ($10) + workout
  app ($10–15) = $36–41/mo just for health tracking
- "No-sub trackers now rival premiums in basics" — Wirecutter, March 2026

### B2B pricing signals

- Coaching platforms: $50–100/mo per practitioner
- Health data API middleware: $300–500/mo base
- RPM (Remote Patient Monitoring) apps can bill through insurance reimbursement
  codes — scalable recurring revenue
- PHR market: $10.6B in 2024, growing at 8.11% CAGR

### Pricing implications for Totus

1. **$5–10/mo for consumers** is the validated sweet spot.
2. **Free tier must be genuinely useful** — data sync + basic dashboard + simple
   trends. Making free useless (Oura's approach) creates resentment, not
   upgrades.
3. **Pay-wall the intelligence, not the data.** Consumers expect to see their
   own data for free. Charge for correlations, reports, and sharing.
4. **Position as subscription consolidation.** "One dashboard to replace 3
   subscriptions" > "another subscription on top."
5. **B2B (coaches/clinicians) is the higher-margin path.** $50–100+/mo per
   practitioner is validated.
6. **Privacy is a premium differentiator**, not just compliance. Lead with it.
7. **Avoid the "AI summary" trap.** Generic AI that restates metrics is worth $0.

---

## 5. Value Prop Assessment

### Current messaging

- Pill badge: "Your personal health data vault"
- H1: "See your health data clearly. Share it securely."
- Sub: "Connect your Oura Ring. Visualize years of trends. Share a link that
  expires after your appointment."
- Steps: Visualize everything → Share with one link → Stay in control

### What's working

- "Share it securely" IS the differentiator — no competitor does this cleanly
- "vault" framing resonates with the privacy-anxious segment
- "No account needed" for doctors — exactly what clinicians asked for
- "Free during early access" — smart given subscription fatigue

### What's misaligned

**1. Headline leads with "see" but the market screams "unify."**

"See your health data clearly" assumes the data is already in one place. The #1
pain is that it's NOT. Every thread independently uses "silos" and "fragmented."
The first word should be about aggregation/unification, not visualization.

**2. "Connect your Oura Ring" is too narrow.**

Every target user has 3–5 devices. If someone wears a Garmin and uses a CGM,
they bounce. Even if Oura is the only live integration, signal multi-device
intent.

**3. Privacy is buried as Step 3.**

The Oura-Palantir thread got hundreds of upvotes. Flo's FTC fine made
mainstream news. Privacy/security is the highest-value WTP attribute ($12–13).
Move trust signals above the fold.

**4. No mention of what users will learn.**

People don't want to "see" data — they want to spot patterns and understand
correlations. "Spot patterns across sleep, heart rate, and glucose" is more
compelling than "see your health data clearly."

**5. "Doctor" is too narrow for the beachhead.**

Functional medicine practitioners and health coaches are the day-1 adopters.
Messaging should say "doctor, coach, or trainer."

### Suggested reframe

**Pill badge:** `Your health data, finally in one place`

**H1:** `All your health data. One vault. You hold the keys.`

**Sub:** `Connect your Oura Ring (CGM and Garmin coming soon). See trends across
months and years. Share a secure link with your doctor or coach — it expires
when you want.`

**Steps reframed:**

| Current                 | Suggested                                                                                                             | Rationale                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Visualize everything | **Unify your data** — Connect Oura, CGM, and wearables. Everything in one encrypted dashboard.                        | Leads with #1 pain (fragmentation)                                 |
| 2. Share with one link  | **Share on your terms** — Pick metrics, set an expiration. Your doctor or coach opens a clean viewer. No account needed. | Adds "coach," reinforces control                                   |
| 3. Stay in control      | **We never touch your data** — Every view is logged. Revoke any link instantly. We never sell your data. No ads. Ever.   | Trust statement, not feature list. Directly counters Oura/Flo fear |

**Add trust strip below hero:**

- "End-to-end encrypted with your own key"
- "Full audit log — see who viewed what and when"
- "We never sell your data. Ever."
- "Export or delete everything, anytime"

---

## 6. MVP Must-Haves

### Already built and validated by research (ship confidently)

| Feature                   | Research signal                                              |
| ------------------------- | ------------------------------------------------------------ |
| Oura integration          | Most common wearable in QS/biohacker communities             |
| Time-limited share links  | THE differentiator. Nobody else does this cleanly.           |
| Audit log                 | Top-3 trust signal. Explicitly requested on every tool thread |
| Revoke/delete controls    | Directly addresses "faith-based data handling" anxiety        |
| No doctor account needed  | Clinicians unanimously don't want another login              |
| Metric-scoped sharing     | Clinicians want only relevant data, not everything           |
| Free tier                 | Non-negotiable given subscription fatigue                    |

### Not built — MUST-HAVE before launch

**1. Email capture on landing page**

Current CTA goes straight to /sign-up. That's high-commitment. Need a
lightweight email input directly on the landing page + "which devices do you
use?" dropdown. Does double duty: demand validation (count signups) + market
research (device distribution). PRD goal = 500 signups in 60 days; need a
low-friction path.

**2. Baseline reference bands on charts**

The single most impactful visualization feature missing. Research is
unambiguous: users "can't interpret raw values without context." Clinicians
specifically asked for color-coded normal ranges. Adding a shaded 30-day avg ±
1 SD band behind each metric transforms "here's a number" into "here's whether
it's unusual for you." This is FR-1 in dashboard-requirements.md (P0 priority).

Without baselines = pretty chart. With baselines = diagnostic tool.

**3. Delta badges on the shared viewer page**

Clinicians want pre-visit summaries with color-coded deviations: "Your RHR was
11 bpm above your 30-day average" in red. The viewer needs a summary strip at
the top with key metrics, their values, and delta-from-baseline (green/yellow/
red). The doctor has 8 minutes — this is what makes them actually look at it.
This is FR-2 in dashboard-requirements.md.

> "A summary of PGHD from the past week automatically sent to clinician the day
> before an appointment" — physician in VA study (this IS the viewer page with
> delta badges)

**4. "Coming soon" device section on landing page**

Static section with device logos (Garmin, Whoop, Dexcom, Apple Health, Withings)
and "Coming soon" badges. Target audience has 3–5 devices. If the page reads
"Oura only," CGM/Garmin/Whoop users bounce — which is most of the addressable
market. Don't need to build integrations, just signal intent.

**5. Privacy-first trust signals above the fold**

Move encryption/audit/no-data-selling messaging UP. Not Step 3. Not the footer.
Above the fold or immediately below the hero. The product actually HAS these
trust features — lead with them.

### Nice-to-have — not blocking launch

| Feature                  | Status      | Why it can wait                                                          |
| ------------------------ | ----------- | ------------------------------------------------------------------------ |
| CSV import               | Not started | Mentioned by some users, not top-5 pain                                  |
| Correlation coefficients | Not started | Chart overlays are a decent v1; formal correlation is Phase 2            |
| AI insights              | Not started | Generic AI summaries worth $0. Wait until enough data to do it well      |
| Additional adapters      | Stubbed     | Oura-first is correct. Add based on waitlist device data                 |
| 2FA                      | Not started | Important but not blocking free early-access launch                      |
| Weekly pattern view      | Not started | Requires 4+ weeks of data — users won't have it at launch               |

### Research-driven priority stack

1. Landing page: email capture + device dropdown + trust signals above fold +
   coming soon devices
2. Baseline bands on all chart metrics (30-day avg ± 1 SD)
3. Delta summary strip on the viewer/shared page (color-coded deviations)
4. Messaging reframe (unify > visualize, privacy up, doctor + coach)
5. Ship and start talking to users

---

## 7. Pre-Development Checklist

### Phase 1: Problem Validation (1–2 weeks)

- [ ] Interview 15–20 target users (Oura/CGM/Garmin owners who see doctors
      regularly). Split: 10 QS enthusiasts + 5 chronic condition trackers.
      Source from r/ouraring, r/Biohackers, r/QuantifiedSelf, CGM Facebook
      groups.
- [ ] Interview 5–8 clinicians (PCPs, cardiologists, endocrinologists, health
      coaches). Source via Doximity, LinkedIn, personal referrals.
- [ ] Document current workarounds (screenshots of what people actually do
      today).
- [ ] Score pain 1–5 for each interviewee. If <60% rate it 4 or 5, pain isn't
      strong enough.

### Phase 2: Solution Validation (1–2 weeks)

- [ ] Build clickable Figma prototype of share flow + doctor viewer (5–7
      screens).
- [ ] Run 10 prototype tests with Phase 1 interviewees.
- [ ] Test willingness to pay — Van Westendorp or "$0 / $5 / $10 / $15 / $20+"
      scale.
- [ ] Test the doctor viewer with 3+ clinicians — time how long to extract
      useful info. If >60 seconds, rethink UX.

### Phase 3: Demand Capture (start during Phase 1)

- [ ] Ship landing page with email capture + "which devices do you use?"
      dropdown.
- [ ] Set validation threshold before starting (e.g., 200 emails in 30 days =
      proceed).
- [ ] Run small paid ad test ($200–500 total): Meta/Instagram + Reddit ads.
      Test 3–4 different value prop headlines.
- [ ] Post in communities (participate genuinely first): r/ouraring,
      r/QuantifiedSelf, r/Biohackers, r/diabetes, Oura forums, QS meetup
      groups.

### Phase 4: Competitive & Market Analysis

- [ ] Map competitive landscape honestly (see Section 2).
- [ ] Articulate why Totus wins in one sentence referencing something
      competitors can't or won't do.

### Phase 5: Go/No-Go Decision

- [ ] Compile 1-page decision doc: pain scores, clinician insights, waitlist
      size, ad results, competitive gaps, biggest risk.
- [ ] Decide: build MVP, pivot focus, or kill it.

---

## 8. Recommended Tools

### Reaching your customer base

| Tool                      | Use case                           | Why                                                  |
| ------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Cal.com / Calendly        | Schedule discovery interviews      | Free tier, low friction                              |
| Tally.so / Typeform       | Screener + post-interview survey   | Tally is free and clean                              |
| Grain / Otter.ai          | Record + transcribe interviews     | AI summaries save hours                              |
| Reddit (organic + ads)    | Reach Oura/CGM/QS community       | Exact target audience lives here                     |
| Meta Ads Manager          | Small paid tests ($200–500)        | Best targeting for health/fitness interests           |
| Substack / Beehiiv        | Newsletter for waitlist nurturing  | Build audience pre-launch, free                      |
| X (Twitter)               | Build in public                    | #BuildInPublic, health-tech community active         |

### Organizing the work

| Tool                      | Use case                           | Why                                                  |
| ------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Notion                    | Interview notes, research database | Best for unstructured research                       |
| Linear                    | Task tracking                      | You'll need it for dev anyway                        |
| Dovetail / Notion + tags  | Qualitative research synthesis     | Tag interview quotes by theme                        |
| Figma                     | Clickable prototypes               | MCP integration already set up                       |
| Google Sheets             | Waitlist, ad spend, pain scores    | Simple, shareable, no overhead                       |
| PostHog / Plausible       | Landing page analytics             | Privacy-friendly, aligns with brand                  |

---

## Appendix: Key Reddit Threads Referenced

| Thread | Subreddit | Date | Signal |
| --- | --- | --- | --- |
| Apple Health data as PDF for doctors | r/AppleWatch | Sep 2024 | Doctor-sharing pain |
| Apple Watch health tracking legit or gimmick? | r/AppleWatch | Jan 2025 | Mixed doctor reception |
| Apple primary care clinics with Watch data | r/apple | Jun 2021 | ER doc perspective (420 upvotes) |
| The health tracking ecosystem is so fragmented | r/QuantifiedSelf | Feb 2026 | Fragmentation pain |
| Built a personal Health Dashboard with Claude | r/whoop | Mar 2026 | DIY aggregation |
| Whoop for heart issues | r/whoop | May 2025 | Accuracy/trust gap |
| Apple Health great at collecting, terrible at telling | r/AppleWatchFitness | Jan 2026 | Data without insights |
| Data fatigue — apps more stressful than helpful | r/AppleWatchFitness | Jan 2026 | Overwhelm without context |
| Spent $100K on longevity protocols, still frustrated | r/PeterAttia | Jan 2025 | Data-to-action gap |
| Frustrated with standard health dashboards | r/Biohackers | Mar 2026 | Correlation is killer feature |
| Oura privacy concerns (cybersecurity pro) | r/ouraring | Aug 2025 | Privacy anxiety (viral) |
| What does "without your consent" mean? | r/ouraring | Sep 2025 | Privacy policy distrust |
| Can we chill about Oura x DoD x Palantir | r/ouraring | Aug 2025 | Reproductive data fears |
| Built free Oura report generator for doctors | r/ouraring | Jan 2026 | Direct product validation |
| Oura useless without subscription | r/ouraring | Sep 2025 | Subscription resentment |
| The Silo Problem | r/QuantifiedSelf | Jan 2026 | "9-to-5 hobby" to consolidate |
| How do you keep track of all health data? | r/QuantifiedSelf | Jan 2025 | DIY solutions dominate |
| Good aggregator for multiple devices? | r/QuantifiedSelf | Jul 2022 | "Given up on universal aggregator" |
| Ultimate Quantified Self app wishlist | r/QuantifiedSelf | Mar 2025 | Automation + correlation |
| Chronic pain symptom tracker gaps | r/ChronicPain | Jul 2025 | Privacy is #1 barrier |
| Flo Health FTC fine for sharing pregnancy data | r/TwoXChromosomes | 2026 | Mainstream privacy fear |
