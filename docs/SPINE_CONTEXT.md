# SPINE — Full Project Context
**Last Updated: March 2026**
**Stack: Next.js 14 + Supabase + Plaid (Production) + Claude API**

---

## What Spine Does (One Paragraph)

Spine connects biometric health data (sleep hours, HRV, activity) with bank transaction data to
calculate a daily behavioral risk score. On days when a user slept poorly, is stressed, or
exhausted, they spend more money — Spine quantifies this as "behavioral tax" and warns the user
before it happens. The AI layer (branded "Backbone") provides conversational insights grounded in
the user's actual biological state, not just their transaction history.

---

## Current App State

### What Works
- GitHub OAuth authentication via Supabase
- Plaid Link integration — user can connect bank account
- Transaction sync from Plaid (production approved as of March 2026)
- iOS Shortcut ("Sync Spine Health Data") sends sleep/HRV/steps to /api/health/submit
- Behavioral risk engine calculates 0–100 score from health metrics + spending trend
- Dashboard displays: risk score, active triggers, recent health metrics
- Transaction list page
- Legal pages: /privacy, /data-policy, /security-policy

### What Doesn't Exist Yet
- Insights page (Backbone chat interface) — highest priority
- Behavioral tax number displayed prominently
- Historical pattern charts
- Spending breakdown by category
- Weekly summary
- Auto-sync (currently manual)
- Push notifications

---

## Tech Stack Detail

```
Frontend:       Next.js 14 (App Router), TypeScript, Tailwind CSS
Backend:        Next.js API Routes (server-side only for sensitive ops)
Database:       Supabase (PostgreSQL)
Auth:           Supabase Auth — GitHub OAuth
Financial API:  Plaid (PRODUCTION) — Transactions + Balance products
Health Input:   iOS Shortcut → POST /api/health/submit
AI:             Anthropic Claude API (claude-sonnet-4-20250514)
Deployment:     Vercel (spine-one.vercel.app)
```

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=           # SERVER ONLY — never expose to client

# Plaid — NOW PRODUCTION
PLAID_CLIENT_ID=
PLAID_SECRET=                        # SERVER ONLY
PLAID_ENV=production                 # Changed from sandbox

# Anthropic
ANTHROPIC_API_KEY=                   # SERVER ONLY
```

---

## Database Schema

### plaid_items
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid REFERENCES auth.users NOT NULL
institution_name text
access_token    text NOT NULL          -- encrypted, server-side only
item_id         text                   -- Plaid's item identifier
cursor          text                   -- for /transactions/sync pagination
created_at      timestamptz DEFAULT now()
```

### transactions
```sql
id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id               uuid REFERENCES auth.users NOT NULL
plaid_transaction_id  text UNIQUE NOT NULL
amount_cents          integer NOT NULL               -- stored in cents
posted_at             date NOT NULL
merchant_name         text
description           text NOT NULL
category              text                           -- Spine category label
is_discretionary      boolean DEFAULT true
created_at            timestamptz DEFAULT now()
```

### health_data
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid REFERENCES auth.users NOT NULL
date            date NOT NULL
sleep_hours     numeric                    -- e.g. 6.5
sleep_quality   text                       -- 'poor' | 'fair' | 'good'
hrv_avg         numeric                    -- ms, from Apple Health SDNN
stress_level    text                       -- 'low' | 'medium' | 'high' (derived from HRV)
active_energy   numeric                    -- steps or active calories
workout_minutes numeric
created_at      timestamptz DEFAULT now()
UNIQUE(user_id, date)
```

### behavioral_insights
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid REFERENCES auth.users NOT NULL
date            date NOT NULL
risk_score      integer                    -- 0–100
insights        text[]                     -- e.g. ['Poor sleep correlating with increased spend']
health_summary  jsonb                      -- {avg_sleep, avg_hrv, avg_activity}
spending_summary jsonb                     -- {last_7_days, prev_7_days, change_percent}
created_at      timestamptz DEFAULT now()
UNIQUE(user_id, date)
```

### RLS Policies (All Tables)
```sql
-- Applied to ALL tables
CREATE POLICY "Users access own data only"
ON [table] FOR ALL
USING (auth.uid() = user_id);
```

---

## Behavioral Risk Score Algorithm

```
Score = sleep_factor + hrv_factor + activity_factor + spending_trend_factor

sleep_factor (0–30):
  sleep_hours >= 7    → 0
  sleep_hours 6–7     → 10
  sleep_hours 5–6     → 20
  sleep_hours < 5     → 30

hrv_factor (0–25):
  hrv >= 65ms         → 0
  hrv 50–65ms         → 10
  hrv 40–50ms         → 18
  hrv < 40ms          → 25

activity_factor (0–20):
  steps > 8000        → 0   (active, good)
  steps 5000–8000     → 5
  steps 2000–5000     → 10
  steps < 2000        → 15
  + intense workout yesterday → add 5 (recovery exhaustion)

spending_trend_factor (0–25):
  last 7 days vs prev 7 days
  change <= 0%        → 0
  change 0–15%        → 5
  change 15–30%       → 15
  change > 30%        → 25

Categories:
  LOW:    0–30  (green)
  MEDIUM: 31–60 (amber)
  HIGH:   61–100 (red)
```

---

## Behavioral Tax Calculation

```
Behavioral Tax = sum of (actual_spend - baseline_spend) on triggered days

baseline_spend = median daily discretionary spend on LOW risk days
triggered day = any day with risk_score > 30

Per category breakdown:
  food_delivery_tax = excess spend on food delivery on triggered days
  retail_tax = excess spend on retail on triggered days
  etc.

Display: "This month you spent $234 extra due to poor sleep and stress"
```

---

## Plaid Integration Details

### Transaction Sync Flow
```
1. User connects bank → Plaid Link → public_token returned
2. Server: POST /api/plaid/exchange → exchanges for access_token → stored in plaid_items
3. Server: POST /api/plaid/sync → calls /transactions/sync with cursor
4. Upsert transactions, store new cursor
5. Repeat sync on demand or via cron
```

### Critical: Use /transactions/sync not /transactions/get
```typescript
const response = await plaidClient.transactionsSync({
  access_token: accessToken,
  cursor: lastCursor ?? undefined,
})
const { added, modified, removed, next_cursor } = response.data
```

### Amount Convention
- Plaid returns positive amounts as money OUT (expenses)
- Negative amounts = deposits/income
- Store as cents: `Math.round(amount * 100)`

---

## Backbone (AI Layer)

### Branding Rule
- In the UI: always "Backbone" — never "Claude" or "Anthropic"
- Backbone is Spine's AI — it happens to use Claude under the hood

### Context Injection Template
Every Backbone API call injects this context:

```typescript
const backboneContext = {
  today: {
    sleep_hours: healthData.sleep_hours,
    hrv: healthData.hrv_avg,
    steps: healthData.active_energy,
    risk_score: todayRiskScore,
    risk_level: 'HIGH' | 'MEDIUM' | 'LOW',
    active_triggers: ['poor_sleep', 'high_stress'], // derived
  },
  spending: {
    last_30_days_total: number,
    baseline_daily: number,
    behavioral_tax_this_month: number,
    top_categories: [{category, amount, pct_of_total}],
  },
  patterns: {
    avg_spend_poor_sleep_days: number,
    avg_spend_good_sleep_days: number,
    most_expensive_trigger: 'sleep' | 'stress' | 'exhaustion',
    worst_day_of_week: string,
  }
}
```

### System Prompt
```
You are Backbone, Spine's behavioral finance AI. You help users understand the connection
between their physical state and their spending patterns. You are direct, data-driven,
and non-judgmental — you never shame users for spending. You provide awareness and agency.

When answering:
- Always cite specific numbers from the user's data
- Frame insights around biology, not willpower ("your HRV was low" not "you were weak")
- Keep responses concise (under 150 words unless the question requires depth)
- Lead with the most important insight first
- End with one actionable suggestion when relevant

You are NOT a financial advisor. Do not give investment advice, tax advice, or credit advice.
You analyze behavioral patterns only.
```

### Three Conversation Modes

**1. Morning Check-in (proactive, triggered by health sync)**
> "4.5 hours sleep and HRV is down to 48ms. Based on your history, today's a $55 risk day —
> mostly food delivery. You have $180 left in discretionary this month. Want me to set a soft
> limit on delivery today?"

**2. Q&A (on-demand, Insights tab)**
> User: "Why do I keep overspending on weekends?"
> Backbone: "Two things: your weekend sleep averages 5.2hrs vs 7.1hrs weekdays, and your HRV
> drops Friday nights. On high-stress weekends your food delivery spend is 3x normal. It's
> not willpower — it's recovery debt."

**3. Weekly Retrospective (Sunday)**
> "Behavioral tax this week: $127. Primary trigger: poor sleep Mon/Wed/Thu. Your best day was
> Saturday — 8hrs sleep, HRV at 72ms, $12 total spend. That's your baseline self."

---

## iOS Health Shortcut

### What it Does
Runs at 7am, aggregates prior day's data, POSTs to Spine:

```json
POST /api/health/submit
{
  "user_id": "uuid",
  "sleep_hours": 6.5,
  "hrv": 52,
  "steps": 4200,
  "date": "2026-03-03"
}
```

### API Route Handler
```typescript
// /app/api/health/submit/route.ts
// Validates user_id, upserts into health_data table
// Recalculates behavioral_insights for that date
// Returns { success: true, risk_score: number }
```

---

## Navigation Structure

```
/setup          → Login (GitHub OAuth)
/dashboard      → Main view (risk score + health + spending)
/transactions   → Full transaction history
/insights       → Backbone AI chat (TO BUILD)
/settings       → Account + connections + preferences
/privacy        → Privacy policy
/data-policy    → Data retention policy
/security-policy → Information security policy
```

---

## Key Product Principles (Never Violate)

1. **Spine is not a budgeting app** — don't build budget-setting in v1
2. **Predictive > reactive** — warn before the purchase, not after
3. **Biology explains behavior** — frame everything through physiology, not willpower
4. **The behavioral tax number is the hero metric** — make it visible everywhere
5. **Backbone is never preachy** — one insight, one suggestion, done
6. **Privacy is a feature** — users are sharing sensitive biometric + financial data; treat it visibly
