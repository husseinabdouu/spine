import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

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
- You are Backbone. Never mention Claude or Anthropic.`;

export async function POST(req: NextRequest) {
  try {
    // 1. Auth
    const supabase = await createClient();
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token ?? '');

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message, conversationHistory } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    // 2. Build context
    const context = await buildBackboneContext(supabase, user.id);

    // 3. Build messages array (last 10 for context window)
    const history = Array.isArray(conversationHistory) ? conversationHistory : [];
    const recentHistory = history.slice(-10);
    const messages = [
      ...recentHistory.map((m: { role: string; content: string }) => ({
        role: (m.role === 'backbone' || m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];

    // 4. Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `${SYSTEM_PROMPT}\n\n## User's Current Context\n${JSON.stringify(context, null, 2)}`,
      messages,
    });

    const reply =
      response.content[0].type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ response: reply });
  } catch (error) {
    console.error('Backbone error:', error);
    return NextResponse.json(
      { error: 'Backbone unavailable' },
      { status: 500 }
    );
  }
}

async function buildBackboneContext(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const today = new Date().toISOString().split('T')[0];
  const sixtyDaysAgo = new Date(
    Date.now() - 60 * 24 * 60 * 60 * 1000
  ).toISOString().split('T')[0];

  // Health data
  const { data: healthData } = await supabase
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('date', sixtyDaysAgo)
    .order('date', { ascending: false });

  // Transactions
  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount_cents, posted_at, merchant_name, category')
    .eq('user_id', userId)
    .gte('posted_at', sixtyDaysAgo)
    .order('posted_at', { ascending: false });

  // Behavioral insights
  const { data: insights } = await supabase
    .from('behavioral_insights')
    .select('*')
    .eq('user_id', userId)
    .gte('date', sixtyDaysAgo)
    .order('date', { ascending: false });

  // Calculations
  const todayHealth = healthData?.find((h) => h.date === today);
  const todayInsight = insights?.find((i) => i.date === today);

  const lowRiskInsights = insights?.filter((i) => i.risk_score <= 30) ?? [];
  const baselineDailySpend = calculateMedianDailySpend(
    transactions ?? [],
    lowRiskInsights
  );

  const thisMonthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString().split('T')[0];
  const thisMonthTransactions =
    transactions?.filter((t) => t.posted_at >= thisMonthStart) ?? [];
  const thisMonthSpend =
    thisMonthTransactions.reduce((sum, t) => sum + (t.amount_cents || 0), 0) /
    100;

  const highRiskDays =
    insights?.filter((i) => i.risk_score > 30 && i.date >= thisMonthStart) ?? [];
  const behavioralTaxEstimate =
    highRiskDays.length *
    Math.max(0, thisMonthSpend / 30 - baselineDailySpend);

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
      recent_transactions: (transactions ?? [])
        .slice(0, 20)
        .map((t) => ({
          merchant: t.merchant_name,
          amount_dollars: t.amount_cents / 100,
          date: t.posted_at,
          category: t.category,
        })),
    },
    patterns: {
      data_days_available: healthData?.length ?? 0,
      high_risk_days_this_month: highRiskDays.length,
    },
  };
}

function calculateMedianDailySpend(
  transactions: { posted_at: string; amount_cents: number }[],
  lowRiskInsights: { date: string }[]
): number {
  if (!lowRiskInsights.length || !transactions.length) return 42;
  const lowRiskDates = new Set(lowRiskInsights.map((i) => i.date));
  const spendByDay: Record<string, number> = {};
  transactions.forEach((t) => {
    if (lowRiskDates.has(t.posted_at)) {
      spendByDay[t.posted_at] =
        (spendByDay[t.posted_at] ?? 0) + t.amount_cents / 100;
    }
  });
  const values = Object.values(spendByDay).sort((a, b) => a - b);
  if (!values.length) return 42;
  return values[Math.floor(values.length / 2)];
}

function getRiskLevel(
  score: number | null
): 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' {
  if (score === null) return 'UNKNOWN';
  if (score <= 30) return 'LOW';
  if (score <= 60) return 'MEDIUM';
  return 'HIGH';
}
