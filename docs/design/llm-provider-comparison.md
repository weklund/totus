# LLM Provider Comparison for Totus Insight Generation

### April 2026

### Purpose

Evaluate LLM providers for the P1 insight narrative feature described in
Dashboard Backend LLD Addendum A. The workload: generate 2-3 sentence
health data narratives from structured JSON input (~200 tokens in, ~150
tokens out), synchronously with a <1.5s latency budget, cached after first
generation.

---

## Evaluation Criteria (Ranked by Importance for Totus)

| # | Criterion | Weight | Why it matters |
|---|-----------|--------|----------------|
| 1 | Data privacy | Critical | Totus's brand is "you own your data." Prompts contain health-derived values (avg RHR, sleep deltas). Provider data handling directly impacts user trust. |
| 2 | Instruction adherence | Critical | "No medical advice" constraint is non-negotiable. A model that occasionally says "you should see a doctor" creates liability. |
| 3 | Structured output reliability | High | Must return `{ "title": "...", "body": "..." }` JSON every time. Parse failures add latency (retry) or degrade UX (template fallback). |
| 4 | Latency | High | <1.5s synchronous call with loading spinner. User is waiting. |
| 5 | Cost at scale | Medium | Matters at 50k users, negligible at MVP. Caching reduces call volume 80-90%. |
| 6 | Operational simplicity | Medium | Solo founder. No time for complex integrations or self-hosted inference. |
| 7 | Stack alignment | Medium | Totus runs on Vercel + AWS (Aurora, KMS). Integration friction matters. |
| 8 | Availability | Low | Template fallback covers outages. Not a hard dependency. |

---

## Providers Evaluated

```
  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
  │   Anthropic    │  │    OpenAI     │  │    Google     │  │  AWS Bedrock  │
  │   (Direct)     │  │   (Direct)    │  │  (Vertex AI)  │  │  (Gateway)    │
  │                │  │               │  │               │  │               │
  │  Claude Haiku  │  │  GPT-4.1      │  │  Gemini 2.5   │  │  Claude Haiku │
  │  4.5           │  │  mini / nano  │  │  Flash        │  │  + Nova Micro │
  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
```

---

## Head-to-Head Comparison

### 1. Data Privacy

```
  STRONGEST ◄──────────────────────────────────────────────► WEAKEST

  AWS Bedrock          Anthropic          OpenAI          Google
  (Direct API)         (Direct API)       (Direct API)    (Developer API)

  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │ Zero         │  │ 30-day      │  │ 30-day      │  │ Free tier:  │
  │ retention    │  │ retention   │  │ retention   │  │ data used   │
  │ by default   │  │ for trust   │  │ for abuse   │  │ for training│
  │              │  │ & safety    │  │ monitoring  │  │             │
  │ Provider     │  │             │  │ ZDR avail-  │  │ Paid tier:  │
  │ never sees   │  │ Anthropic   │  │ able for    │  │ not used    │
  │ your data    │  │ can see     │  │ enterprise  │  │ for training│
  │ (isolated    │  │ API data    │  │             │  │             │
  │  accounts)   │  │ (not used   │  │ OpenAI can  │  │ Must use    │
  │              │  │  for train) │  │ see API data│  │ Vertex AI   │
  │ No training  │  │             │  │             │  │ for HIPAA   │
  │ No logging   │  │ No training │  │ No training │  │             │
  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

| | Bedrock | Anthropic Direct | OpenAI Direct | Google (Vertex AI) |
|---|---------|-----------------|---------------|-------------------|
| Data used for training? | No | No | No | No (paid API) |
| Data retention | **None** | 30 days | 30 days (ZDR available) | Not stored at rest (Vertex) |
| Provider sees prompts? | **No** (isolated) | Yes | Yes | Yes |
| SOC 2 | Yes (1/2/3) | Yes (Type II) | Yes (Type II) | Yes (1/2/3) |
| HIPAA BAA | **Yes** | Yes (enterprise) | Yes (enterprise) | Yes (Vertex AI) |
| FedRAMP | **Yes (High)** | No | No | Yes (High) |
| GDPR | Yes | Yes | Yes | Yes |

**Verdict:** Bedrock has the strongest privacy posture — the model provider
(Anthropic, Amazon, etc.) architecturally cannot access your prompts. For a
health data product, this is meaningfully better than "we promise not to look."

---

### 2. Model Quality for Health Narratives

This is the hardest criterion to evaluate without hands-on testing. Based on
publicly available benchmarks and the specific nature of our workload (short,
structured input → factual narrative output):

| Capability | Claude Haiku 4.5 | GPT-4.1 mini | GPT-4.1 nano | Gemini 2.5 Flash | Nova Micro |
|------------|-----------------|--------------|--------------|-----------------|------------|
| Instruction following | Excellent | Excellent | Good | Good | Fair |
| Factual precision (numbers) | Excellent | Excellent | Good | Good | Fair |
| Natural prose quality | Very good | Very good | Adequate | Good | Basic |
| "No medical advice" adherence | Excellent | Good | Untested | Good | Untested |
| Handling structured JSON input | Excellent | Excellent | Excellent | Good | Good |

**Assessment notes:**

- Claude models are known for strong instruction adherence and nuanced
  constraint following — critical for the "no medical advice" guardrail.
- GPT-4.1 mini is competitive on quality. Nano sacrifices quality for speed/cost.
- Gemini 2.5 Flash is strong on throughput but has less established reputation
  for tight constraint following on health-adjacent content.
- Nova Micro is the cheapest option but is a smaller model. Adequate for
  simple summaries, questionable for nuanced multi-metric narratives.

**Verdict:** Claude Haiku 4.5 or GPT-4.1 mini for quality. Must validate
with real prompts before committing — recommend a bake-off with 20 sample
inputs.

---

### 3. Structured Output Reliability

| | Claude Haiku 4.5 | GPT-4.1 mini/nano | Gemini 2.5 Flash | Nova Micro |
|---|-----------------|-------------------|-----------------|------------|
| JSON mode | Via tool use | Native (`json_schema`) | Native (`response_schema`) | Via Converse API |
| Schema enforcement | Tool use schema | **Constrained decoding** (100%) | Schema-enforced | Tool use schema |
| Reliability | Very high | **Highest** (guaranteed) | High (some edge cases) | High |
| Retry needed? | Rarely | Never (with strict mode) | Occasionally | Rarely |

**Verdict:** OpenAI's strict structured output is the gold standard — 100%
schema conformance guaranteed by constrained decoding. All others are very
reliable in practice but not guaranteed at the decoding level. For our use
case (simple 2-field JSON), all providers work fine. Tool use on
Claude/Bedrock is equally reliable for simple schemas.

---

### 4. Latency

For a ~200 token input, ~150 token output completion:

```
  Total estimated latency (TTFT + generation)
  ════════════════════════════════════════════

  GPT-4.1 nano      ████████░░░░░░░░░░░░░░░░░░░░░░  ~500-800ms
  GPT-4.1 mini      ████████████░░░░░░░░░░░░░░░░░░  ~700-1000ms
  Claude Haiku 4.5   ██████████████░░░░░░░░░░░░░░░░  ~800-1200ms
  Gemini 2.5 Flash  ██████████████░░░░░░░░░░░░░░░░  ~900-1200ms
  Bedrock (Haiku)   ████████████████░░░░░░░░░░░░░░  ~900-1400ms
  Nova Micro        ████████░░░░░░░░░░░░░░░░░░░░░░  ~500-800ms

  ├─────────┼─────────┼─────────┼─────────┤
  0ms     500ms    1000ms    1500ms    2000ms

  All within 1.5s budget ✓ (Bedrock Haiku is tight but feasible)
```

| | TTFT (est.) | Output throughput | Total for 150 tokens |
|---|------------|-------------------|---------------------|
| GPT-4.1 nano | ~200-400ms | ~150-250 t/s | **~500-800ms** |
| GPT-4.1 mini | ~300-600ms | ~100-180 t/s | ~700-1000ms |
| Claude Haiku 4.5 | ~200-400ms | ~80-150 t/s | ~800-1200ms |
| Gemini 2.5 Flash | ~560ms | ~218-232 t/s | ~900-1200ms |
| Bedrock (Haiku) | ~300-500ms | ~80-150 t/s | ~900-1400ms |
| Nova Micro | ~200-400ms | ~150+ t/s | ~500-800ms |

**Notes:**
- All estimates from community benchmarks; actual performance varies by load.
- Bedrock adds slight overhead vs. direct API due to the proxy layer. Under
  high load, Bedrock variance increases ("noisy neighbor" effect).
- All options fit within the 1.5s budget. GPT-4.1 nano and Nova Micro are
  fastest, but may sacrifice narrative quality.

**Verdict:** All viable. Nano is fastest but weaker prose. Haiku and GPT-4.1
mini are the latency/quality sweet spot.

---

### 5. Cost at Scale

Estimated cost per insight: ~200 input tokens + ~150 output tokens.

| Provider/Model | Cost per call | 500 calls/day (MVP) | 25K calls/day (launch) |
|----------------|--------------|--------------------|-----------------------|
| **Nova Micro** (Bedrock) | **$0.000028** | **$0.42/mo** | **$21/mo** |
| GPT-4.1 nano | $0.000080 | $1.20/mo | $60/mo |
| Gemini 2.5 Flash | $0.000120 | $1.80/mo | $90/mo |
| GPT-4.1 mini | $0.000320 | $4.80/mo | $240/mo |
| Claude Haiku 4.5 (direct) | $0.000950 | $14.25/mo | $713/mo |
| Claude Haiku 4.5 (Bedrock) | $0.000950 | $14.25/mo | $713/mo |

**With 85% cache hit rate** (steady-state — most insights are cached):

| Provider/Model | Effective calls/day (launch) | Monthly cost |
|----------------|----------------------------|--------------|
| Nova Micro | 3,750 | **$3/mo** |
| GPT-4.1 nano | 3,750 | $9/mo |
| Gemini 2.5 Flash | 3,750 | $14/mo |
| GPT-4.1 mini | 3,750 | $36/mo |
| Claude Haiku 4.5 | 3,750 | $107/mo |

**Verdict:** At MVP, all options are under $15/mo. At launch scale with
caching, everything is under $110/mo. Cost is not a differentiator at Totus's
scale unless growth is extreme. Nova Micro and GPT-4.1 nano are 10-30x
cheaper than Haiku, but quality tradeoffs apply.

---

### 6. Operational Simplicity

| | Bedrock | Anthropic Direct | OpenAI Direct | Google Vertex AI |
|---|---------|-----------------|---------------|-----------------|
| Auth mechanism | IAM roles (existing) | API key | API key | Service account / ADC |
| API key management | **None needed** | Rotate + store in env | Rotate + store in env | JSON key file or ADC |
| Billing | **Unified AWS bill** | Separate invoice | Separate invoice | Separate GCP billing |
| Monitoring | **CloudWatch native** | Custom logging | Custom logging | Cloud Monitoring |
| SDK | AWS SDK v3 (existing) | @anthropic-ai/sdk (new) | openai (new) | @google/genai (new) |
| Model switching | **Change string** | Different SDK | Different SDK | Different SDK |

**Verdict:** Bedrock has the lowest operational overhead for a team already on
AWS. IAM auth eliminates API key management. Unified billing simplifies
accounting. If not on AWS, OpenAI has the simplest direct integration.

---

### 7. Stack Alignment with Totus

```
  Current Totus Stack
  ═══════════════════

  Vercel (Next.js) ──── AWS Aurora PostgreSQL
                   ──── AWS KMS (envelope encryption)
                   ──── Inngest (background jobs)
                   ──── Clerk (auth)

  Adding LLM calls:

  Option A: Direct API           Option B: AWS Bedrock
  ────────────────────           ─────────────────────

  Vercel → internet →            Vercel → AWS PrivateLink →
  Anthropic/OpenAI API           Bedrock (same region as Aurora)

  - New API key to manage        - IAM role (already have)
  - New billing relationship     - Same AWS bill
  - Data leaves AWS              - Data stays in AWS network
  - Custom latency monitoring    - CloudWatch metrics built-in
  - One model per provider       - Switch models freely
```

**Verdict:** Bedrock keeps health-derived data within the AWS network, uses
existing IAM, and unifies billing. Meaningful operational advantages for a
solo-founder AWS shop.

---

## Comparison Summary

```
  Weighted Scorecard (5 = best)
  ═════════════════════════════

                      Bedrock   Bedrock   Anthropic  OpenAI    Google
                      (Haiku)   (Nova)    Direct     Direct    Vertex
                      ───────   ───────   ─────────  ────────  ──────
  Data Privacy  (1)     5         5          4          4         4
  Quality       (2)     4         2          4          4*        3
  Struct Output (3)     4         3          4          5         4
  Latency       (4)     3         4          4          5*        4
  Cost          (5)     3         5          3          4         4
  Ops Simplicity(6)     5         5          3          3         3
  Stack Align   (7)     5         5          2          2         3
  Availability  (8)     4         4          3          4         4
                      ───────   ───────   ─────────  ────────  ──────
  Weighted Total       4.2       3.8        3.6        4.0       3.6

  * OpenAI GPT-4.1 mini for quality, nano for latency/cost
```

---

## Recommendation

### Primary: AWS Bedrock with Claude Haiku 4.5

```
  ┌──────────────────────────────────────────────────────┐
  │                  RECOMMENDED SETUP                    │
  │                                                      │
  │  Vercel (Next.js)                                    │
  │       │                                              │
  │       ▼                                              │
  │  AWS Bedrock (us-east-1, same region as Aurora)      │
  │       │                                              │
  │       ├── Claude Haiku 4.5 ← P1 cross-metric        │
  │       │   (via Converse API)  insight narratives     │
  │       │                                              │
  │       └── (Future) Nova Micro ← simple summaries    │
  │           if cost optimization needed at scale       │
  │                                                      │
  │  Auth: IAM role (no API keys)                        │
  │  Network: PrivateLink (data stays in AWS)            │
  │  Monitoring: CloudWatch (TTFT, errors, throttling)   │
  │  Billing: Unified AWS invoice                        │
  └──────────────────────────────────────────────────────┘
```

**Why Bedrock + Haiku:**

1. **Privacy:** Strongest data isolation. Anthropic never sees the prompts.
   Health-derived data stays within the AWS network. Zero retention by default.
   HIPAA BAA available. This aligns perfectly with Totus's "you own your data"
   brand.

2. **Quality:** Claude Haiku 4.5 has the best instruction adherence for the
   "no medical advice" constraint. Strong at factual, nuanced prose from
   structured data.

3. **Operational fit:** Totus is already on AWS (Aurora, KMS). Bedrock adds
   zero new auth mechanisms, billing relationships, or key management. IAM
   roles, CloudWatch monitoring, and PrivateLink come free.

4. **Model flexibility:** The Converse API lets you swap to Nova Micro, GPT-4.1
   mini (when available on Bedrock), or newer Claude models by changing a model
   ID string. No SDK changes needed.

5. **Cost:** Same per-token as Anthropic direct ($1.00/$5.00 for Haiku 4.5 on
   Bedrock). With 85% cache hit rate, ~$107/mo at launch scale. If cost
   optimization is needed, route simpler insights to Nova Micro ($3/mo).

### Why not the alternatives?

| Alternative | Why not primary | When to reconsider |
|-------------|-----------------|-------------------|
| Anthropic Direct | Same model, weaker privacy (30-day retention), separate API key/billing, data leaves AWS | If Bedrock latency proves unacceptable under load |
| OpenAI Direct | Best structured output, fast, cheap (nano). But separate ecosystem, no AWS integration, weaker instruction adherence testing for health constraints | If structured output failures become a problem, or if cost at extreme scale matters |
| Google Vertex AI | Strong compliance, fast Flash model. But adds GCP dependency to an AWS-native stack, free-tier data training risk, less established for health constraint following | If Gemini quality leapfrogs Claude for short-form narratives |
| Nova Micro | 30x cheaper. But prose quality is noticeably weaker for multi-metric narratives | As a cost-optimization tier for simple single-metric insights once P0 templates feel limiting |

### Suggested Validation Step

Before committing, run a **20-prompt bake-off**:

1. Create 20 representative `InsightGenerationInput` objects from each P1
   rule type (sleep disruption, recovery arc, weekly rhythm, trend alert).
2. Send each to Claude Haiku 4.5 (via Bedrock), GPT-4.1 mini, and Gemini 2.5
   Flash with the system prompt from Addendum A §A.5.
3. Evaluate each response on: factual accuracy, "no medical advice"
   compliance, natural prose quality, and JSON format reliability.
4. If results are within 10% of each other on quality, go with Bedrock Haiku
   for operational reasons. If one clearly outperforms, reconsider.

**Estimated effort:** 2-3 hours. Worth doing before locking in the provider.

---

## Integration Checklist (If Bedrock + Haiku Selected)

- [ ] Enable Bedrock model access for `anthropic.claude-haiku-4-5` in us-east-1
- [ ] Create IAM role for Bedrock invocation with least-privilege policy
- [ ] Add `@aws-sdk/client-bedrock-runtime` to web app dependencies
- [ ] Configure Bedrock client with region matching Aurora
- [ ] Test Converse API call with sample insight prompt
- [ ] Validate latency from Vercel serverless function → Bedrock (target <1.5s)
- [ ] Set up CloudWatch alarm for Bedrock invocation errors and TTFT > 2s
- [ ] (Optional) Configure VPC PrivateLink endpoint for Bedrock

---

## Appendix: Pricing Reference

All prices per 1M tokens (on-demand), as of April 2026. Verify before use.

| Model | Input | Output | Via |
|-------|-------|--------|-----|
| Claude Haiku 4.5 | $1.00 | $5.00 | Anthropic or Bedrock |
| Claude 3.5 Haiku | $0.80 | $4.00 | Anthropic or Bedrock |
| GPT-4.1 mini | $0.40 | $1.60 | OpenAI |
| GPT-4.1 nano | $0.10 | $0.40 | OpenAI |
| Gemini 2.5 Flash | $0.15 | $0.60 | Google AI / Vertex AI |
| Nova Micro | $0.035 | $0.14 | Bedrock only |
| Nova Lite | $0.06 | $0.24 | Bedrock only |
