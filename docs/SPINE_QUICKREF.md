# SPINE — Quick Reference

## Start Every Cursor Session With
"Read .cursorrules and SPINE_CONTEXT.md, then help me with [task]."

---

## Current Priority Order
1. Switch Plaid to production (PLAID_ENV=production) → real bank data
2. Build Insights page + Backbone chat API
3. Add behavioral tax number to dashboard
4. Add 7-day trend chart to dashboard
5. Set up Vercel crons for auto-sync

---

## Key Constraints (Never Forget)
- SUPABASE_SERVICE_ROLE_KEY → server only, never client
- PLAID_SECRET → server only, never client
- ANTHROPIC_API_KEY → server only, never client
- All DB queries: service role key server-side OR anon key + RLS client-side
- AI is branded "Backbone" in UI — never "Claude" or "Anthropic"
- Spine is NOT a budgeting app — no budget-setting in v1

---

## Risk Score Quick Reference
| Score | Level  | Color  |
|-------|--------|--------|
| 0–30  | LOW    | Green  |
| 31–60 | MEDIUM | Amber  |
| 61–100| HIGH   | Red    |

## Risk Score Formula
sleep (0–30) + hrv (0–25) + activity (0–20) + spending_trend (0–25) = 0–100

---

## Plaid
- Env: production
- Products: Transactions + Balance
- Use: /transactions/sync with cursor
- Amount: stored in CENTS (multiply by 100 on store, divide by 100 on display)
- Positive amount = expense, negative = income/deposit

---

## Supabase Tables
- plaid_items, transactions, health_data, behavioral_insights
- All have RLS: user_id = auth.uid()

---

## App Routes
- /setup → login
- /dashboard → main (build here first)
- /transactions → transaction list
- /insights → Backbone chat (build next)
- /settings → account + connections

---

## Backbone Conversation Modes
1. Morning check-in (auto on insights page open, first time today)
2. Q&A (user-initiated chat)
3. Weekly summary (generated Sunday, shown as card)

---

## The Core Metric to Display Everywhere
**Behavioral Tax** = extra money spent on bad health days
Formula: sum(daily_spend - baseline_spend) for all MEDIUM/HIGH risk days
Baseline = median spend on LOW risk days

---

## Files in This Folder
- .cursorrules → Auto-loaded by Cursor (keep this in project root)
- SPINE_CONTEXT.md → Full technical + product context
- SPINE_TASKS.md → Prioritized build list with implementation details
- SPINE_BACKBONE.md → Backbone AI full implementation reference
- SPINE_QUICKREF.md → This file
