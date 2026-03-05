# SPINE — Backbone AI Reference
**The AI layer of Spine. Powered by Claude. Branded as "Backbone".**

---

## Golden Rule
Never expose "Claude" or "Anthropic" anywhere in the UI.
The user always sees: "Backbone says…" / "Ask Backbone" / "Backbone is thinking…"

---

## API Route Structure

```
/app/api/backbone/
  chat/route.ts          → Main conversational endpoint
  morning/route.ts       → Generate proactive morning check-in
  weekly/route.ts        → Generate weekly retrospective summary
```

---

## Full Implementation: /app/api/backbone/chat/route.ts

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const SYSTEM_PROMPT = `You are Backbone, the behavioral finance AI inside Spine.
Your role is to help users understand how their physical state (sleep, stress, activity)
drives their spending behavior.

Rules:
- Always cite specific numbers from the user's data
- Frame everything through biology, not willpower ("your HRV was low" not "you lacked discipline")
- Never shame users for spending — provide awareness and agency
- Keep responses under 150 words unless depth is genuinely needed
- Lead with the single most important insight
- End with one actionable suggestion when appropriate
- Do not give investment, tax, or credit advice
- You are Backbone. Never mention Claude or Anthropic.`

export async function POST(req: NextRequest) {
  try {
    // 1. Auth
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { message, conversationHistory } = await req.json()

    // 2. Build context
    const context = await buildBackboneContext(supabase, user.id)

    // 3. Build messages array
    const messages = [
      ...conversationHistory,
      { role: 'user' as const, content: message }
    ]

    // 4. Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `${SYSTEM_PROMPT}\n\n## User's Current Context\n${JSON.stringify(context, null, 2)}`,
      messages,
    })

    const reply = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ response: reply })

  } catch (error) {
    console.error('Backbone error:', error)
    return NextResponse.json({ error: 'Backbone unavailable' }, { status: 500 })
  }
}

async function buildBackboneContext(supabase: any, userId: string) {
  const today = new Date().toISOString().split('T')[0]
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Health data
  const { data: healthData } = await supabase
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('date', sixtyDaysAgo)
    .order('date', { ascending: false })

  // Transactions
  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount_cents, posted_at, merchant_name, category')
    .eq('user_id', userId)
    .gte('posted_at', sixtyDaysAgo)
    .order('posted_at', { ascending: false })

  // Behavioral insights
  const { data: insights } = await supabase
    .from('behavioral_insights')
    .select('*')
    .eq('user_id', userId)
    .gte('date', sixtyDaysAgo)
    .order('date', { ascending: false })

  // Calculations
  const todayHealth = healthData?.find((h: any) => h.date === today)
  const todayInsight = insights?.find((i: any) => i.date === today)

  const lowRiskInsights = insights?.filter((i: any) => i.risk_score <= 30) ?? []
  const baselineDailySpend = calculateMedianDailySpend(transactions, lowRiskInsights)

  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const thisMonthTransactions = transactions?.filter((t: any) => t.posted_at >= thisMonthStart) ?? []
  const thisMonthSpend = thisMonthTransactions.reduce((sum: number, t: any) => sum + t.amount_cents, 0) / 100

  const highRiskDays = insights?.filter((i: any) => i.risk_score > 30 && i.date >= thisMonthStart) ?? []
  const behavioralTaxEstimate = highRiskDays.length * Math.max(0, (thisMonthSpend / 30) - baselineDailySpend)

  return {
    today: {
      date: today,
      sleep_hours: todayHealth?.sleep_hours ?? null,
      sleep_quality: todayHealth?.sleep_quality ?? null,
      hrv: todayHealth?.hrv_avg ?? null,
      stress_level: todayHealth?.stress_level ?? null,
      steps: todayHealth?.active_energy ?? null,
      risk_score: todayInsight?.risk_score ?? null,
      risk_level: getRiskLevel(todayInsight?.risk_score),
      active_triggers: todayInsight?.insights ?? [],
    },
    spending: {
      this_month_total_dollars: Math.round(thisMonthSpend),
      baseline_daily_dollars: Math.round(baselineDailySpend),
      behavioral_tax_estimate_dollars: Math.round(behavioralTaxEstimate),
      recent_transactions: transactions?.slice(0, 20).map((t: any) => ({
        merchant: t.merchant_name,
        amount_dollars: t.amount_cents / 100,
        date: t.posted_at,
        category: t.category,
      })),
    },
    patterns: {
      data_days_available: healthData?.length ?? 0,
      high_risk_days_this_month: highRiskDays.length,
    }
  }
}

function calculateMedianDailySpend(transactions: any[], lowRiskInsights: any[]) {
  if (!lowRiskInsights.length || !transactions) return 42 // fallback default
  const lowRiskDates = new Set(lowRiskInsights.map((i: any) => i.date))
  const spendByDay: Record<string, number> = {}
  transactions.forEach((t: any) => {
    if (lowRiskDates.has(t.posted_at)) {
      spendByDay[t.posted_at] = (spendByDay[t.posted_at] ?? 0) + t.amount_cents / 100
    }
  })
  const values = Object.values(spendByDay).sort((a, b) => a - b)
  if (!values.length) return 42
  return values[Math.floor(values.length / 2)]
}

function getRiskLevel(score: number | null): 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' {
  if (score === null) return 'UNKNOWN'
  if (score <= 30) return 'LOW'
  if (score <= 60) return 'MEDIUM'
  return 'HIGH'
}
```

---

## Insights Page Component

```typescript
// /app/insights/page.tsx
'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'backbone'
  content: string
  timestamp: Date
}

const SUGGESTED_QUESTIONS = [
  "What's my behavioral tax this month?",
  "Why do I overspend on weekends?",
  "What's my biggest spending trigger?",
  "How much would better sleep save me?",
  "When am I most likely to overspend?",
]

export default function InsightsPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const conversationHistory = messages.map(m => ({
        role: m.role === 'backbone' ? 'assistant' : 'user',
        content: m.content,
      }))

      const res = await fetch('/api/backbone/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationHistory }),
      })

      const data = await res.json()
      const backboneMessage: Message = {
        role: 'backbone',
        content: data.response,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, backboneMessage])
    } catch {
      setMessages(prev => [...prev, {
        role: 'backbone',
        content: 'Backbone is unavailable right now. Try again in a moment.',
        timestamp: new Date(),
      }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b">
        <h1 className="font-semibold">Backbone</h1>
        <p className="text-sm text-gray-500">Your behavioral finance AI</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Ask Backbone anything about your patterns.</p>
            {SUGGESTED_QUESTIONS.map(q => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="block w-full text-left px-4 py-2 rounded-lg border text-sm hover:bg-gray-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${
              msg.role === 'user'
                ? 'bg-black text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-900 rounded-bl-sm'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-2xl rounded-bl-sm">
              <span className="text-sm text-gray-500">Backbone is thinking…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask Backbone…"
            className="flex-1 px-4 py-2 border rounded-full text-sm outline-none"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="px-4 py-2 bg-black text-white rounded-full text-sm disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
```

---

## Morning Check-in Generation

```typescript
// /app/api/backbone/morning/route.ts
// Called when user opens Insights page for the first time today
// Returns a proactive Backbone message based on today's health data

const MORNING_PROMPT = `Generate a concise morning behavioral finance check-in for this user.
Rules:
- Under 80 words
- Lead with the most relevant health metric (sleep or HRV)
- Reference their predicted extra spend in dollars if risk is MEDIUM or HIGH
- One concrete suggestion
- Tone: direct but not alarming — like a knowledgeable friend
- If LOW risk: brief positive acknowledgment + spending outlook
- Never say "Good morning" or generic greetings`
```

---

## Counterfactual: The Question Only Spine Can Answer

When user asks "How much would better sleep save me?" — this is Spine's killer answer:

```typescript
// Calculate counterfactual
const avgSpendPoorSleep = calculateAvgSpend(transactions, healthData, day => day.sleep_hours < 6.5)
const avgSpendGoodSleep = calculateAvgSpend(transactions, healthData, day => day.sleep_hours >= 7)
const dailyDelta = avgSpendPoorSleep - avgSpendGoodSleep
const monthlyImpact = dailyDelta * 30

// Backbone says:
// "On nights you sleep under 6.5 hours, you spend an average of $67/day.
//  On nights you sleep 7+ hours, you spend $34/day.
//  That's a $33/day difference. Over a month, better sleep could save you ~$450."
```

This number is the core product. No other app can calculate it.
