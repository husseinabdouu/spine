/**
 * Shared behavioral risk score calculation.
 * Used by /api/insights/calculate and /api/health/submit.
 *
 * Formula:
 *   healthScore  (0–100): sleep 40pts + HRV 35pts + activity 25pts
 *   finScore     (0–100): this-week vs baseline spend ratio
 *   riskScore    = healthScore * 0.60 + finScore * 0.40  (rounded, 0–100)
 *
 * Thresholds: LOW 0–30, MEDIUM 31–60, HIGH 61–100
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { NON_BEHAVIORAL_CATEGORIES } from '@/lib/categorize';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CalculateRiskResult {
  risk_score: number;
  risk_level: RiskLevel;
  insights: string[];
  health_summary: { avg_sleep: string; avg_hrv: string; avg_activity: string };
  spending_summary: { last_7_days: string; prev_7_days: string; change_percent: string };
  score_breakdown: { health_score: number; fin_score: number };
}

export async function calculateBehavioralRisk(
  supabase: SupabaseClient,
  userId: string,
  targetDate: string
): Promise<CalculateRiskResult | null> {
  // Need at least 3 days of health data to calculate
  const fourteenDaysAgo = new Date(targetDate);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

  const { data: healthData, error: healthError } = await supabase
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('date', fourteenDaysAgoStr)
    .lte('date', targetDate)
    .order('date', { ascending: false });

  if (healthError || !healthData || healthData.length < 1) {
    return null;
  }

  // Use the requested date's data, or fall back to the most recent available day
  const targetDayHealth =
    healthData.find((h) => h.date === targetDate) ?? healthData[0];

  const sleepHours = targetDayHealth.sleep_hours ?? 0;
  const hrv = targetDayHealth.hrv_avg ?? 0;
  const steps = targetDayHealth.active_energy ?? 0;
  const workoutMinutes = targetDayHealth.workout_minutes ?? 0;

  // Yesterday's workout for +5 exhaustion bonus
  const yesterday = new Date(targetDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const yesterdayHealth = healthData.find((h) => h.date === yesterdayStr);
  const intenseWorkoutYesterday = (yesterdayHealth?.workout_minutes ?? 0) >= 30;

  // Spending: last 7 days vs prior 7 days
  const sevenDaysAgo = new Date(targetDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  const { data: last7Tx } = await supabase
    .from('transactions')
    .select('amount_cents, posted_at, category')
    .eq('user_id', userId)
    .gte('posted_at', sevenDaysAgoStr)
    .lte('posted_at', targetDate);

  const { data: prev7Tx } = await supabase
    .from('transactions')
    .select('amount_cents, posted_at, category')
    .eq('user_id', userId)
    .gte('posted_at', fourteenDaysAgoStr)
    .lt('posted_at', sevenDaysAgoStr);

  // Exclude non-behavioral categories (Internal Transfer, ATM Withdrawal, Income)
  // and income rows (negative amount_cents) from spending trend calculations.
  const nonBehavioral = NON_BEHAVIORAL_CATEGORIES as readonly string[];
  const isBehavioralSpend = (t: { amount_cents: number; category?: string | null }) =>
    t.amount_cents > 0 && !nonBehavioral.includes(t.category ?? "");

  const last7DaysSpend =
    (last7Tx ?? []).filter(isBehavioralSpend).reduce((sum, t) => sum + (t.amount_cents || 0), 0) / 100;
  const prev7DaysSpend =
    (prev7Tx ?? []).filter(isBehavioralSpend).reduce((sum, t) => sum + (t.amount_cents || 0), 0) / 100;

  // ── Health component (0–100) ─────────────────────────────────────────────
  // Sleep sub-score (0–40): higher = worse
  let sleepFactor = 0;
  if (sleepHours >= 7)      sleepFactor = 0;
  else if (sleepHours >= 6) sleepFactor = 14;
  else if (sleepHours >= 5) sleepFactor = 27;
  else                      sleepFactor = 40;

  // HRV sub-score (0–35): higher = worse
  let hrvFactor = 0;
  if (hrv > 0) {
    if (hrv >= 65)      hrvFactor = 0;
    else if (hrv >= 50) hrvFactor = 12;
    else if (hrv >= 40) hrvFactor = 23;
    else                hrvFactor = 35;
  }

  // Activity sub-score (0–25): higher = worse
  let activityFactor = 0;
  if (steps > 8000)       activityFactor = 0;
  else if (steps >= 5000) activityFactor = 7;
  else if (steps >= 2000) activityFactor = 14;
  else                    activityFactor = 20;
  if (intenseWorkoutYesterday) activityFactor = Math.min(activityFactor + 5, 25);

  const healthScore = Math.min(sleepFactor + hrvFactor + activityFactor, 100);

  // ── Financial component (0–100) ──────────────────────────────────────────
  // Compare this week's daily average spend to the prior-week daily average.
  // finScore = 0 when spending is at or below baseline; scales to 100 at 3× baseline.
  const last7DailyAvg = last7DaysSpend / 7;
  const prev7DailyAvg = prev7DaysSpend > 0 ? prev7DaysSpend / 7 : last7DailyAvg;

  let finScore = 0;
  if (prev7DailyAvg > 0 && last7DailyAvg > 0) {
    const ratio = last7DailyAvg / prev7DailyAvg; // 1.0 = on baseline
    if (ratio <= 1.0)       finScore = 0;
    else if (ratio <= 1.15) finScore = 10;
    else if (ratio <= 1.5)  finScore = 30;
    else if (ratio <= 2.0)  finScore = 60;
    else if (ratio <= 3.0)  finScore = 80;
    else                    finScore = 100;
  }

  const spendingChangePercent =
    prev7DaysSpend > 0
      ? ((last7DaysSpend - prev7DaysSpend) / prev7DaysSpend) * 100
      : 0;

  // ── Blended score ────────────────────────────────────────────────────────
  const riskScore = Math.min(Math.round(healthScore * 0.6 + finScore * 0.4), 100);

  const riskLevel: RiskLevel =
    riskScore <= 30 ? 'LOW' : riskScore <= 60 ? 'MEDIUM' : 'HIGH';

  const insights: string[] = [];
  if (sleepHours >= 7) {
    insights.push('Good: Healthy sleep');
  } else if (sleepHours >= 6) {
    insights.push('Caution: Below optimal sleep (6–7 hrs)');
  } else if (sleepHours >= 5) {
    insights.push('Warning: Poor sleep (5–6 hrs)');
  } else {
    insights.push('Critical: Very poor sleep (< 5 hrs)');
  }

  if (hrv > 0) {
    if (hrv >= 65) insights.push('Good: Healthy HRV');
    else if (hrv >= 50) insights.push('Caution: Moderate HRV');
    else if (hrv >= 40) insights.push('Warning: Low HRV');
    else insights.push('Critical: Very low HRV');
  }

  if (steps > 8000) insights.push('Good: Active');
  else if (steps >= 5000) insights.push('Caution: Moderate activity');
  else if (steps >= 2000) insights.push('Warning: Low activity');
  else insights.push('Critical: Very low activity');

  if (prev7DaysSpend > 0) {
    if (spendingChangePercent <= 0) insights.push('Good: Spending stable or decreasing');
    else if (spendingChangePercent < 15)
      insights.push(`Notice: Spending up ${spendingChangePercent.toFixed(0)}%`);
    else if (spendingChangePercent <= 30)
      insights.push(`Caution: Spending up ${spendingChangePercent.toFixed(0)}%`);
    else insights.push(`Alert: Spending up ${spendingChangePercent.toFixed(0)}%`);
  }

  if (riskLevel === 'HIGH') insights.unshift('HIGH RISK: Strong impulse spending risk');
  else if (riskLevel === 'MEDIUM')
    insights.unshift('MEDIUM RISK: Elevated impulse risk — be mindful');
  else insights.unshift('LOW RISK: Good behavioral balance');

  return {
    risk_score: riskScore,
    risk_level: riskLevel,
    insights,
    health_summary: {
      avg_sleep: String(sleepHours.toFixed(1)),
      avg_hrv: String(hrv.toFixed(0)),
      avg_activity: String(steps.toFixed(0)),
    },
    spending_summary: {
      last_7_days: last7DaysSpend.toFixed(2),
      prev_7_days: prev7DaysSpend.toFixed(2),
      change_percent: spendingChangePercent.toFixed(1),
    },
    score_breakdown: {
      health_score: Math.round(healthScore),
      fin_score: Math.round(finScore),
    },
  };
}
