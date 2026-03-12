import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are Backbone, the behavioral finance AI inside Spine.
Your role is to help users understand how their physical state (sleep, stress, activity)
drives their spending behavior.

## STRICT DATA RULES — NEVER VIOLATE
- The "User's Current Data" section below is the ONLY source of truth for the user's numbers.
- If a field is null or marked "no data", you MUST NOT invent or estimate a value for it.
  Say "I don't have your [metric] for today" instead of guessing.
- Never cite a sleep hours, HRV, recovery score, strain, risk score, or spending figure
  that does not appear verbatim in the User's Current Data section.
- If today's health data is null, say so explicitly — do not reference any biometric numbers.

## COMMUNICATION RULES
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
      system: `${SYSTEM_PROMPT}\n\n## User's Current Data (GROUND TRUTH — only cite numbers from here)\n${JSON.stringify(context, null, 2)}`,
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
  // Use America/New_York so "today" matches the date stored by the iOS shortcut
  // and Whoop sync, which run on the user's local clock — not UTC.
  const TZ = 'America/New_York';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const sixtyDaysAgo = new Date(
    Date.now() - 60 * 24 * 60 * 60 * 1000
  ).toLocaleDateString('en-CA', { timeZone: TZ });

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

  // Personal health baselines — last 30 days excluding today
  const baselineDays = (healthData ?? []).filter((h) => h.date !== today);
  const validSleepDays  = baselineDays.filter((h) => h.sleep_hours  != null);
  const validHrvDays    = baselineDays.filter((h) => h.hrv_avg      != null);
  const validStepsDays  = baselineDays.filter((h) => h.active_energy != null);
  const validRecovDays  = baselineDays.filter((h) => h.whoop_recovery_score != null);

  const personalAvgSleep    = validSleepDays.length  > 0
    ? validSleepDays.reduce((s, h)  => s + h.sleep_hours, 0)           / validSleepDays.length  : null;
  const personalAvgHrv      = validHrvDays.length    > 0
    ? validHrvDays.reduce((s, h)    => s + h.hrv_avg, 0)               / validHrvDays.length    : null;
  const personalAvgActivity = validStepsDays.length  > 0
    ? validStepsDays.reduce((s, h)  => s + h.active_energy, 0)         / validStepsDays.length  : null;
  const personalAvgRecovery = validRecovDays.length  > 0
    ? validRecovDays.reduce((s, h)  => s + h.whoop_recovery_score, 0)  / validRecovDays.length  : null;

  // Personal spending baseline — billable 30-day total ÷ 30
  const billable30Spend = (transactions ?? [])
    .filter((t) => t.amount_cents > 0)
    .reduce((sum, t) => sum + t.amount_cents, 0) / 100;
  const personalDailySpendBaseline = billable30Spend / 60; // 60-day window fetched

  const lowRiskInsights = insights?.filter((i) => i.risk_score <= 30) ?? [];
  const baselineDailySpend = calculateMedianDailySpend(
    transactions ?? [],
    lowRiskInsights
  );

  // Use NYC timezone so month boundary matches how dates are stored
  const thisMonthStart = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 7) + '-01';
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

  // Build health block — only include fields with real values so Claude
  // cannot confuse null with a plausible number.
  const healthToday = todayHealth
    ? {
        date: todayHealth.date,
        sleep_hours:          todayHealth.sleep_hours          ?? "no data",
        hrv_avg_ms:           todayHealth.hrv_avg              ?? "no data",
        whoop_recovery_score: todayHealth.whoop_recovery_score ?? "no data",
        whoop_strain:         todayHealth.whoop_strain         ?? "no data",
        resting_heart_rate:   todayHealth.resting_heart_rate   ?? "no data",
        active_energy_steps:  todayHealth.active_energy        ?? "no data",
        stress_level:         todayHealth.stress_level         ?? "no data",
        sleep_quality:        todayHealth.sleep_quality        ?? "no data",
      }
    : "NO HEALTH DATA AVAILABLE FOR TODAY — do not cite any biometric numbers";

  return {
    IMPORTANT: "Only cite numbers that appear in this object. null or 'no data' means the metric is unavailable — never invent a value.",
    today_date: today,
    health_today: healthToday,
    // Personal baselines derived from the user's own last 30 days — use these
    // as the reference point when contextualising today's metrics.
    personal_baselines: {
      avg_sleep_hours:           personalAvgSleep    != null ? Math.round(personalAvgSleep    * 10) / 10 : "no data",
      avg_hrv_ms:                personalAvgHrv      != null ? Math.round(personalAvgHrv)              : "no data",
      avg_activity:              personalAvgActivity != null ? Math.round(personalAvgActivity)          : "no data",
      avg_whoop_recovery_score:  personalAvgRecovery != null ? Math.round(personalAvgRecovery * 10) / 10 : "no data",
      avg_daily_spend_dollars:   Math.round(personalDailySpendBaseline * 100) / 100,
      baseline_days_available:   baselineDays.length,
    },
    risk_today: todayInsight
      ? {
          risk_score: todayInsight.risk_score,
          risk_level: getRiskLevel(todayInsight.risk_score),
          active_triggers: todayInsight.insights ?? [],
        }
      : "NO RISK SCORE CALCULATED YET",
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
      health_data_days_available: healthData?.length ?? 0,
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
