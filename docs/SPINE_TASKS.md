# SPINE — Build Tasks
**Current Phase: MVP → Production**
**Updated: March 2026**

---

## Two Horizons — Always Know Which One You're In

### 🎯 MVP (Phases 1–6 below)
Deploy, validate, get 20 real users seeing their behavioral tax number and having the
"holy shit" moment. Prove the correlation engine works with real data. Everything in
Phases 1–6 is what gets built NOW.

### 🔭 Full Vision (see SPINE_VISION.md)
- Backbone as multi-model router (Claude + GPT-4o + Gemini)
- Direct wearable integrations (Oura, Whoop, Garmin, Fitbit) via normalized health schema
- Pre-purchase alerts: browser extension → iOS widget → Spine card (Marqeta/Lithic)
- Platform expansion beyond finance

**Do not build Full Vision features yet. But make MVP architecture decisions that
don't block them.** Key example: all AI calls go through a `backbone.query()` abstraction
now, so adding multi-model routing later is a config change, not a rewrite.

---

Work through these in order. Each task has enough detail to give directly to Cursor.

---

## 🔴 PHASE 1 — Production Readiness (Do First)

### TASK 1.1 — Switch Plaid to Production
**Status:** Plaid production approved ✅
**What to do:**
- Change `PLAID_ENV=production` in Vercel environment variables
- Change `PLAID_ENV=production` in `.env.local`
- In `/app/api/plaid/` routes, ensure `PlaidEnvironments.Production` is used
- Test: connect a real bank account end-to-end
- Verify transactions sync with real data

**Plaid env config:**
```typescript
const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as 'production'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
})
```

**Acceptance criteria:** Real bank connected, real transactions visible in /transactions

---

### TASK 1.2 — Add Transaction Cursor Storage
**Problem:** Currently may not be storing the Plaid sync cursor, causing full re-syncs
**What to do:**
- Ensure `plaid_items` table has a `cursor` column (text, nullable)
- On each /transactions/sync call, read the stored cursor and send it
- After sync completes, store `next_cursor` back to plaid_items row
- This enables incremental syncs (only new/changed transactions)

```sql
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS cursor text;
```

**Acceptance criteria:** Second sync only fetches new transactions, not all history

---

### TASK 1.3 — Verify Behavioral Risk Calculation with Real Data
**What to do:**
- After connecting real bank, run `/api/insights/calculate` manually
- Verify risk_score is being calculated correctly
- Verify behavioral_insights row is created in Supabase
- Add a manual "Recalculate" button in settings (dev tool, can hide later)

**Acceptance criteria:** Dashboard shows real risk score based on real health + spending data

---

## 🟠 PHASE 2 — Insights Page (Backbone AI Chat)

### TASK 2.1 — Build Insights Page Shell
**File:** `/app/insights/page.tsx`
**What to build:**
- Chat-style interface layout
- Message bubbles: Backbone (left, with spine logo) / User (right)
- Input bar at bottom with send button
- Suggested questions as tappable chips (shown when chat is empty)
- Loading state (typing indicator while Backbone responds)

**Suggested starter questions (hardcode these):**
```
"What's my behavioral tax this month?"
"Why do I overspend on weekends?"
"What's my biggest spending trigger?"
"How much would better sleep save me?"
"When am I most likely to overspend?"
```

**UI notes:**
- Clean, minimal — think iMessage but with a dark/neutral Spine aesthetic
- Backbone messages should feel like a knowledgeable friend, not a chatbot
- No avatars — just a small spine/backbone icon on Backbone messages

---

### TASK 2.2 — Build Backbone API Route
**File:** `/app/api/backbone/chat/route.ts`
**What to build:**

```typescript
// POST /api/backbone/chat
// Body: { message: string, conversationHistory: Message[] }
// Auth: validate user session first
// 1. Fetch user's context (health data last 60 days, transactions last 60 days, behavioral_insights)
// 2. Build context injection object (see SPINE_CONTEXT.md → Backbone section)
// 3. Call Anthropic claude-sonnet-4-20250514 with system prompt + context + conversation
// 4. Return { response: string }
```

**Context builder function:**
```typescript
async function buildBackboneContext(userId: string) {
  // Query last 60 days health_data
  // Query last 60 days transactions
  // Query behavioral_insights (last 30 days)
  // Calculate: baseline daily spend (median on LOW risk days)
  // Calculate: behavioral tax this month
  // Calculate: avg spend on poor sleep days vs good sleep days
  // Return structured context object
}
```

**Critical:** Never return raw Plaid access tokens or Supabase service keys in the response.
Strip sensitive fields before passing data to Claude.

---

### TASK 2.3 — Wire Up Backbone Chat
**What to do:**
- Connect Insights page input to `/api/backbone/chat`
- Maintain conversation history in component state (last 10 messages for context window)
- Stream responses if possible (use Anthropic streaming API for better UX)
- Handle errors gracefully — show "Backbone is unavailable" if API fails

**Streaming setup (optional but improves UX):**
```typescript
// Use Anthropic SDK streaming
const stream = await anthropic.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1000,
  messages: conversationMessages,
  system: systemPrompt,
})
// Stream chunks to client via ReadableStream
```

---

### TASK 2.4 — Morning Risk Check-in Message
**What to do:**
- When user opens Insights page for the first time today, automatically show a proactive
  Backbone message based on today's health data
- This is NOT a notification — it's an auto-generated first message in the chat
- If no health data for today: "Sync your health data to see today's risk assessment"
- If health data exists: generate morning check-in using today's risk score + context

**Trigger logic:**
```typescript
// Check if last_checkin_date !== today
// If different, generate morning message automatically on page load
// Store last_checkin_date in localStorage to avoid re-generating on refresh
```

---

## 🟡 PHASE 3 — Dashboard Enhancement

### TASK 3.1 — Behavioral Tax Display
**Problem:** The behavioral tax number is the hero metric but isn't prominently displayed
**What to add to /app/dashboard:**

Top of dashboard, below risk score:
```
┌─────────────────────────────────────┐
│  Behavioral Tax — March             │
│  $234 extra due to poor sleep       │
│  +$127 from stress                  │
│  Your baseline day costs $38        │
└─────────────────────────────────────┘
```

**Calculation to build:**
```typescript
// behavioral_tax_this_month =
//   sum of (daily_spend - baseline_spend) for all HIGH/MEDIUM days this month
// where baseline_spend = median spend on LOW risk days
```

---

### TASK 3.2 — Weekly Trend Chart
**What to add to /app/dashboard:**
- Simple 7-day bar chart: daily spend colored by risk level
  - Green bar = LOW risk day
  - Amber bar = MEDIUM risk day
  - Red bar = HIGH risk day
- Use recharts (already in typical Next.js setups) or a lightweight alternative
- Tooltip: show date, spend amount, risk score on hover

```tsx
// Data shape needed:
const weekData = [
  { date: 'Mon', spend: 42, riskLevel: 'LOW' },
  { date: 'Tue', spend: 89, riskLevel: 'HIGH' },
  // ...
]
```

---

### TASK 3.3 — Health Metrics Display Improvement
**Current state:** Health metrics shown but likely raw numbers
**Improve to:**
- Sleep: show hours + quality badge (POOR / FAIR / GOOD)
- HRV: show ms + status (STRESSED / NORMAL / RECOVERED) relative to user's own baseline
- Steps: show count + context (SEDENTARY / ACTIVE)
- Each metric has a color indicator tied to its impact on risk score

---

### TASK 3.4 — Empty States
**Add proper empty states for:**
- No health data today → "Run your iOS Shortcut to sync today's data" + setup instructions
- No bank connected → "Connect your bank to see spending patterns" + Plaid Link button
- Less than 14 days of data → "Backbone is still learning your patterns — check back in X days"
- No transactions in date range → "No transactions found for this period"

---

## 🟢 PHASE 4 — Transactions Enhancement

### TASK 4.1 — Category Labels
**What to build:**
- Auto-assign Spine categories from Plaid's personal_finance_category
- Spine category map:
  ```
  FOOD_AND_DRINK + delivery merchant → "Food Delivery"
  FOOD_AND_DRINK + restaurant → "Dining Out"
  FOOD_AND_DRINK + grocery → "Groceries"
  GENERAL_MERCHANDISE → "Shopping"
  ENTERTAINMENT → "Entertainment"
  TRANSPORTATION → "Transport"
  TRAVEL → "Travel"
  PERSONAL_CARE → "Personal Care"
  ```
- Show category chip on each transaction row

---

### TASK 4.2 — Behavioral Tag on Transactions
**What to build:**
- For transactions on HIGH/MEDIUM risk days, show a small tag: "⚡ Risk day"
- Tooltip/expand: "You slept 4.2hrs on this day. Behavioral risk was HIGH."
- This makes the behavioral tax concept tangible and concrete

---

### TASK 4.3 — Spending Summary Cards
**Add to /app/transactions:**
- This month total spend
- Behavioral tax this month
- Biggest category
- Vs last month (% change)

---

## 🔵 PHASE 5 — Automation & Reliability

### TASK 5.1 — Vercel Cron: Daily Transaction Sync
**File:** `/app/api/cron/sync-transactions/route.ts`

```typescript
// Runs daily at 6am via Vercel cron
// For each user with a connected Plaid item:
//   1. Call /transactions/sync with stored cursor
//   2. Upsert new transactions
//   3. Store updated cursor
// vercel.json:
{
  "crons": [{"path": "/api/cron/sync-transactions", "schedule": "0 6 * * *"}]
}
```

**Secure with:** `CRON_SECRET` environment variable checked in route handler

---

### TASK 5.2 — Vercel Cron: Daily Risk Calculation
**File:** `/app/api/cron/calculate-insights/route.ts`

```typescript
// Runs daily at 7am (after health sync window)
// For each user with health data for today:
//   1. Run behavioral risk calculation
//   2. Upsert into behavioral_insights
//   3. Generate and store Backbone morning message
```

---

### TASK 5.3 — Plaid Webhook Handler
**File:** `/app/api/plaid/webhook/route.ts`

```typescript
// Handle TRANSACTIONS_SYNC_UPDATES_AVAILABLE
// When Plaid notifies of new data, trigger sync for that item
// Plaid webhook verification: check X-Plaid-Verification header
```

---

## 🟣 PHASE 6 — Polish (Pre-Beta)

### TASK 6.1 — Disconnect Bank Flow
- Add "Disconnect bank" button in settings
- On confirm: call Plaid /item/remove, delete plaid_items row, soft-delete transactions
- Clear confirmation modal with explanation of what gets deleted

### TASK 6.2 — Re-auth Flow
- When Plaid returns ITEM_LOGIN_REQUIRED error
- Show banner: "Your bank connection needs to be refreshed"
- Re-launch Plaid Link in update mode

### TASK 6.3 — Weekly Summary
- Every Sunday, auto-generate a Backbone weekly summary
- Stored in behavioral_insights as insight_type='weekly_summary'
- Shown as a card at top of Insights page
- Content: behavioral tax, primary trigger, best day, trend vs last week

### TASK 6.4 — Data Export
- Settings page: "Download my data" button
- Export: JSON blob of all transactions + health data + insights
- Required for GDPR compliance (already in privacy policy)

### TASK 6.5 — Delete Account
- Multi-step confirmation
- Deletes: all transactions, health_data, behavioral_insights, plaid_items (+ Plaid /item/remove)
- Deletes Supabase auth user
- Redirects to /setup with "Account deleted" message

---

## Prompts to Use in Cursor

**Starting a new task:**
> "I'm working on [TASK X.X] from SPINE_TASKS.md. Read .cursorrules and SPINE_CONTEXT.md first, then help me build this."

**When debugging:**
> "This is a Spine app — Next.js 14 App Router, Supabase, Plaid production, Claude API. [describe bug]. Check .cursorrules for architecture constraints."

**When building a new component:**
> "Build a React component for [feature]. This is Spine — behavioral finance app. Tailwind for styling, TypeScript strict, server component unless interactivity needed. See .cursorrules for conventions."

---

## 🔭 FULL VISION — Future Phases (Do Not Build Yet)

These are documented here so architectural decisions in the MVP don't block them later.
Full specs in SPINE_VISION.md.

### FUTURE: Backbone Multi-Model Router
- Claude → behavioral narrative and pattern analysis
- GPT-4o → structured data reasoning and categorization
- Gemini → receipt scanning and multimodal inputs
- Smart router classifies query type and sends to best model
- **MVP action:** Build all AI calls through `backbone.query()` abstraction now

### FUTURE: Direct Wearable Integrations
- Oura Ring, Whoop, Garmin Connect, Fitbit via direct REST APIs
- Normalized SpineHealthSnapshot schema — device-agnostic
- **MVP action:** Store `source_device` column on health_data rows now

### FUTURE: Pre-Purchase Alerts
- Phase A: Browser extension — overlays Spine panel on checkout pages
- Phase B: iOS widget — passive risk score on home screen
- Phase C: Dynamic Apple Wallet pass — risk status when opening Wallet
- Phase D: Spine Card — real-time authorization via Marqeta or Lithic
- **MVP action:** None required, but don't hardcode assumptions that Plaid is the only data source

### FUTURE: Platform Expansion
- Finance → Career → Health → Relationships → Developer API
- Biometric-informed decision optimization across all life domains
