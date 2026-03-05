/**
 * Shared behavioral risk score calculation.
 * Used by /api/insights/calculate and /api/health/submit.
 *
 * Formula (per SPINE_CONTEXT.md):
 * - sleep_factor (0–30): 7+ hrs=0, 6–7=10, 5–6=20, <5=30
 * - hrv_factor (0–25): 65ms+=0, 50–65=10, 40–50=18, <40=25
 * - activity_factor (0–20): 8000+=0, 5000–8000=5, 2000–5000=10, <2000=15, +5 if workout yesterday
 * - spending_trend_factor (0–25): last 7 vs prev 7 days — ≤0%=0, 0–15%=5, 15–30%=15, >30%=25
 * - Total 0–100: LOW 0–30, MEDIUM 31–60, HIGH 61–100
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CalculateRiskResult {
  risk_score: number;
  risk_level: RiskLevel;
  insights: string[];
  health_summary: { avg_sleep: string; avg_hrv: string; avg_activity: string };
  spending_summary: { last_7_days: string; prev_7_days: string; change_percent: string };
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
    .select('amount_cents, posted_at')
    .eq('user_id', userId)
    .gte('posted_at', sevenDaysAgoStr)
    .lte('posted_at', targetDate);

  const { data: prev7Tx } = await supabase
    .from('transactions')
    .select('amount_cents, posted_at')
    .eq('user_id', userId)
    .gte('posted_at', fourteenDaysAgoStr)
    .lt('posted_at', sevenDaysAgoStr);

  const last7DaysSpend =
    (last7Tx ?? []).reduce((sum, t) => sum + (t.amount_cents || 0), 0) / 100;
  const prev7DaysSpend =
    (prev7Tx ?? []).reduce((sum, t) => sum + (t.amount_cents || 0), 0) / 100;

  const spendingChangePercent =
    prev7DaysSpend > 0
      ? ((last7DaysSpend - prev7DaysSpend) / prev7DaysSpend) * 100
      : 0;

  // Sleep factor (0–30)
  let sleepFactor = 0;
  if (sleepHours >= 7) {
    sleepFactor = 0;
  } else if (sleepHours >= 6) {
    sleepFactor = 10;
  } else if (sleepHours >= 5) {
    sleepFactor = 20;
  } else {
    sleepFactor = 30;
  }

  // HRV factor (0–25)
  let hrvFactor = 0;
  if (hrv > 0) {
    if (hrv >= 65) {
      hrvFactor = 0;
    } else if (hrv >= 50) {
      hrvFactor = 10;
    } else if (hrv >= 40) {
      hrvFactor = 18;
    } else {
      hrvFactor = 25;
    }
  }

  // Activity factor (0–20)
  let activityFactor = 0;
  if (steps > 8000) {
    activityFactor = 0;
  } else if (steps >= 5000) {
    activityFactor = 5;
  } else if (steps >= 2000) {
    activityFactor = 10;
  } else {
    activityFactor = 15;
  }
  if (intenseWorkoutYesterday) {
    activityFactor += 5;
  }
  activityFactor = Math.min(activityFactor, 20);

  // Spending trend factor (0–25)
  let spendingFactor = 0;
  if (prev7DaysSpend > 0) {
    if (spendingChangePercent <= 0) {
      spendingFactor = 0;
    } else if (spendingChangePercent < 15) {
      spendingFactor = 5;
    } else if (spendingChangePercent <= 30) {
      spendingFactor = 15;
    } else {
      spendingFactor = 25;
    }
  }

  const riskScore = Math.min(
    sleepFactor + hrvFactor + activityFactor + spendingFactor,
    100
  );

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
  };
}
