# SPINE — Full Product Vision
**This is where Spine is going. Not what we're building today.**
**Read this to understand architectural intent before making decisions.**

---

## The One-Sentence Full Vision

Spine is a biometric-informed life optimization platform — starting with finance, expanding to
every major decision domain — powered by Backbone, a multi-model AI that understands your
biological state in real time.

---

## What the Fully Built Spine Looks Like

### 1. Backbone — Multi-Model AI Engine

In the MVP, Backbone is Claude under the hood. In the full product, Backbone is a smart routing
layer that sends each query to the best model for that task type. The user never sees any of this
— they always just see "Backbone."

**Model routing strategy:**

| Model | Best For |
|-------|----------|
| Claude (Anthropic) | Behavioral narrative, long-context pattern analysis, nuanced plain-English insights |
| GPT-4o (OpenAI) | Structured data reasoning, categorization, rule-based spending logic, calculations |
| Gemini (Google) | Multimodal tasks — receipt scanning, image-based inputs, document parsing |

**How routing works:**
- A lightweight router classifies each incoming query by type
- Routes to the single best model for that type
- OR fans out to 2–3 models and selects the highest-confidence response
- Falls back gracefully if a model is unavailable
- Built using a custom router or LangChain/LlamaIndex

**Why this matters:**
- Future-proofs Spine against any single model vendor
- Each model genuinely has different strengths — routing improves answer quality
- If a better model ships, Backbone just gets smarter with a config change

**Architectural implication for MVP:**
Build Backbone as an abstraction layer NOW — all AI calls go through a `backbone.query()`
function, not directly to the Anthropic SDK. In MVP, that function only calls Claude.
Adding GPT-4o routing later is then a change inside that function, not a rewrite of the app.

```typescript
// MVP: backbone.ts routes everything to Claude
// Full vision: routes intelligently across Claude, GPT-4o, Gemini
async function backboneQuery(query: BackboneQuery): Promise<BackboneResponse> {
  const model = selectBestModel(query.type) // MVP: always returns 'claude'
  return await routeToModel(model, query)
}

type QueryType =
  | 'behavioral_narrative'    // → Claude
  | 'structured_calculation'  // → GPT-4o
  | 'receipt_scan'            // → Gemini
  | 'pattern_analysis'        // → Claude
  | 'categorization'          // → GPT-4o
```

---

### 2. Direct Wearable Integrations

In the MVP, health data comes from a single iOS Shortcut that reads Apple Health.
In the full product, Spine connects directly to every major wearable platform via REST APIs,
with a unified normalized health schema that doesn't care what device the user owns.

**Target integrations (priority order):**

| Platform | API Type | Key Data |
|----------|----------|----------|
| Oura Ring | REST API | Sleep staging, readiness score, HRV |
| Whoop | REST API | Recovery score, HRV, strain |
| Garmin Connect | REST API | Body battery, HRV, stress score |
| Fitbit / Google Fit | REST API | Sleep, heart rate, activity |
| Apple Watch | HealthKit (current MVP) | Sleep, HRV, steps, active energy |

**Normalized Spine Health Schema:**
Every wearable connector outputs this same structure regardless of source device.
Spine's correlation engine only ever touches this normalized format.

```typescript
interface SpineHealthSnapshot {
  date: string                    // YYYY-MM-DD
  source_device: string           // 'oura' | 'whoop' | 'garmin' | 'apple_watch' | 'fitbit'

  // Sleep
  sleep_hours: number             // total sleep duration
  sleep_score: number | null      // 0–100 if device provides it
  sleep_quality: 'poor' | 'fair' | 'good'  // derived from hours if no score

  // Stress / Recovery
  hrv_avg: number                 // ms — SDNN or RMSSD normalized
  readiness_score: number | null  // 0–100 if device provides it (Oura/Whoop)
  stress_level: 'low' | 'medium' | 'high'  // derived from HRV

  // Activity
  active_energy: number           // steps or calories — normalized
  workout_minutes: number | null
  recovery_status: 'recovered' | 'strained' | 'peak' | null  // Whoop-style if available
}
```

**Why this is a moat:**
Users can switch wearables and their Spine data stays intact.
Spine becomes wearable-agnostic — the health platform layer, not an Apple Health wrapper.

**Connector architecture:**
```
/lib/wearables/
  oura.ts       → OAuth + REST → normalize to SpineHealthSnapshot
  whoop.ts      → OAuth + REST → normalize to SpineHealthSnapshot
  garmin.ts     → OAuth + REST → normalize to SpineHealthSnapshot
  fitbit.ts     → OAuth + REST → normalize to SpineHealthSnapshot
  apple.ts      → iOS Shortcut POST (current) → normalize to SpineHealthSnapshot
```

Each connector is independent. Adding a new wearable = adding one new file.

---

### 3. Pre-Purchase Alerts — The Transaction Interception Problem

**The constraint:**
Plaid is read-only — it only sees transactions AFTER they post. Apple Pay cannot be
intercepted by third-party apps. There is no native hook into the payment flow.

This means Spine cannot warn a user mid-purchase without either:
a) A browser extension that detects checkout pages, or
b) A Spine-issued payment card with real-time authorization control

**Bridge solutions (near-term, pre-card):**

**Browser Extension**
- Detects checkout pages (Amazon, Shopify, any e-commerce)
- Overlays a Spine panel before the user hits "Place Order"
- Shows: today's risk score, remaining budget, similar past purchases on bad days
- Most impactful near-term solution — intercepts at the exact moment of purchase
- Technically straightforward, no financial licensing required

**iOS Widget**
- Home screen widget showing current risk score + remaining discretionary budget
- Visible when user picks up their phone before opening any shopping app
- Passive but always present — frictionless awareness

**Dynamic Apple Wallet Pass**
- A Wallet pass showing current Spine behavioral risk status
- Visible when user opens Wallet before tapping to pay
- Updates daily with risk level + budget status

**The Endgame — Spine Card:**

Issue a branded Spine virtual/physical debit card via Marqeta or Lithic (card-as-a-service
platforms). When the cardholder taps to pay anywhere, the authorization request hits Spine's
backend in real time — BEFORE the merchant is approved.

At that moment Spine can:
- Check the user's behavioral risk score for today
- Check remaining weekly/monthly budget
- **Approve silently** with a "✓ safe purchase" push notification
- **Approve with warning** — "this puts you 23% over your weekly limit"
- **Decline with explanation** — "you asked me to block purchases over $50 on HIGH risk days"

This is how Chime, Dave, and every modern fintech controls spending in real time.
Marqeta/Lithic handle banking infrastructure and compliance. Spine writes the authorization logic.

**What makes the Spine card different from any other debit card:**
The authorization logic isn't rule-based. It's biometric-informed.
No other card in the world declines a purchase because your HRV is low and you slept 4 hours.

**Timeline reality:**
The Spine card requires money transmission licensing or banking partnerships, KYC/AML
compliance, fraud infrastructure. This is an 18–24 month build minimum.
Do not architect the MVP around the card. Build the correlation engine first.
The card is only compelling once users trust Backbone's risk scoring.

---

### 4. Platform Expansion — Beyond Finance

Finance is the beachhead. The full vision is biometric-informed decision optimization across
every major life domain.

**Phase 1 (current):** Financial decisions
**Phase 2:** Career decisions — "Your HRV has been low for 3 weeks. This isn't the week to quit your job."
**Phase 3:** Health decisions — closing the loop, using financial outcomes to inform health behavior
**Phase 4:** Relationship / social — high-stress periods correlate with conflict; awareness before difficult conversations
**Phase 5:** Platform — API for developers to build biometric-informed apps on top of Spine's data layer

The core insight scales: every important decision is made better or worse by your biological state.
Finance is just the most measurable and most financially motivating place to start.

---

## What This Means for MVP Architecture

When building the MVP, make these decisions with the full vision in mind:

| Decision | MVP | Why (Full Vision) |
|----------|-----|-------------------|
| AI calls | Go through `backbone.query()` abstraction | Multi-model routing later = config change |
| Health data | Normalize to SpineHealthSnapshot on ingest | Wearable connectors just output same schema |
| Health source field | Store `source_device` on every health row | Can mix Oura + Apple Watch data cleanly |
| Categories | Use Spine's own category labels (not Plaid's) | Category logic upgrades without DB changes |
| Risk score | Keep calculation in one isolated function | Easy to improve algorithm without side effects |
| Backbone responses | Always return structured + text | Browser extension can consume structured data later |

---

## Full Vision Tech Stack (vs MVP)

| Layer | MVP | Full Vision |
|-------|-----|-------------|
| AI | Claude only via Anthropic SDK | Backbone router → Claude + GPT-4o + Gemini |
| Health input | iOS Shortcut → Apple Health | Direct Oura, Whoop, Garmin, Fitbit REST APIs |
| Spending control | Read-only via Plaid | Spine card via Marqeta/Lithic + browser extension |
| Platform | Web app | iOS native app + web + API for developers |
| Users | Solo founder testing | 100M+ wearable owners |
| Monetization | TBD / free beta | Premium subscription + Spine card interchange fees |

---

## The Defensible Moat at Each Layer

**Short term (now):** First to correlate biometric data with spending. No one else does this.

**Medium term:** Proprietary behavioral profiles per user that improve with time. The more data
Spine has on a user, the more accurate the predictions. This data advantage cannot be bought.

**Long term:** Backbone as the infrastructure layer for biometric-informed decisions.
The correlation engine, the normalized health schema, and the wearable connector network
become a platform that's extremely hard to replicate quickly.

**The one thing no competitor can copy without biometric data:**
The counterfactual.
"If your sleep had been above 7 hours every night this month, you'd have spent $340 less."
MoneyGPT will never be able to say that sentence. Only Spine can.
