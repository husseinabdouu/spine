/**
 * Shared behavioral risk score calculation.
 * Used by /api/insights/calculate and /api/health/submit.
 *
 * Formula:
 *   healthScore  (0–100): sleep 40pts + HRV 35pts + activity 25pts
 *   finScore     (0–100): this week vs user's own 30-day typical weekly spend
 *   riskScore    = healthScore * 0.60 + finScore * 0.40  (rounded, 0–100)
 *
 * All health thresholds are personalized against the user's own 30-day
 * rolling averages — not population standards. A metric 20% below YOUR
 * average is bad regardless of the absolute number.
 *
 * Thresholds: LOW 0–30, MEDIUM 31–60, HIGH 61–100
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { NON_BEHAVIORAL_CATEGORIES, getBehavioralWeight } from '@/lib/categorize';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PersonalBaselines {
  avg_sleep: number;    // hours
  avg_hrv: number;      // ms
  avg_activity: number; // steps / active energy
  avg_weekly_spend: number; // dollars — typical 7-day behavioral spend
  days_used: number;    // how many days contributed to baselines
}

export interface CalculateRiskResult {
  risk_score: number;
  risk_level: RiskLevel;
  insights: string[];
  health_summary: { avg_sleep: string; avg_hrv: string; avg_activity: string };
  spending_summary: { last_7_days: string; prev_7_days: string; change_percent: string };
  score_breakdown: { health_score: number; fin_score: number };
  personal_baselines: PersonalBaselines;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Converts a "% deviation from personal baseline" into a 0-maxPts risk score.
 * deviationPct < 0  → below baseline (worse)
 * Breakpoints are relative, so they apply equally at any absolute level.
 *
 * deviationPct meanings for a metric where LOWER = worse (sleep, HRV, activity):
 *   >= +5%   on-par or above baseline → 0 risk
 *   -5% to -15%  slightly below       → ~25% of maxPts
 *   -15% to -30% moderately below     → ~65% of maxPts
 *   < -30%   severely below baseline  → maxPts
 */
function relativeHealthFactor(deviationPct: number, maxPts: number): number {
  if (deviationPct >= -5)   return 0;
  if (deviationPct >= -15)  return Math.round(maxPts * 0.25);
  if (deviationPct >= -30)  return Math.round(maxPts * 0.65);
  return maxPts;
}

/**
 * Like relativeHealthFactor but also applies a floor when the absolute value
 * is dangerously low regardless of the user's personal average — so a user
 * whose average sleep is 5h can't get a "good" score just because today was 5.2h.
 */
function sleepFactor(sleepHours: number, personalAvg: number, maxPts: number): number {
  const deviationPct = personalAvg > 0 ? ((sleepHours - personalAvg) / personalAvg) * 100 : 0;
  const relativePts = relativeHealthFactor(deviationPct, maxPts);

  // Hard-floor for critically low absolute sleep
  let absoluteFloorPts = 0;
  if (sleepHours < 4)       absoluteFloorPts = maxPts;
  else if (sleepHours < 5)  absoluteFloorPts = Math.round(maxPts * 0.75);
  else if (sleepHours < 6)  absoluteFloorPts = Math.round(maxPts * 0.35);

  return Math.max(relativePts, absoluteFloorPts);
}

// ── main export ──────────────────────────────────────────────────────────────

export async function calculateBehavioralRisk(
  supabase: SupabaseClient,
  userId: string,
  targetDate: string
): Promise<CalculateRiskResult | null> {
  // Fetch 30 days of health data for personal baselines + today's metrics
  const thirtyDaysAgo = new Date(targetDate);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  const { data: healthData, error: healthError } = await supabase
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('date', thirtyDaysAgoStr)
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

  // Yesterday for workout-exhaustion bonus
  const yesterday = new Date(targetDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const yesterdayHealth = healthData.find((h) => h.date === yesterdayStr);
  const intenseWorkoutYesterday = (yesterdayHealth?.workout_minutes ?? 0) >= 30;

  // ── Personal baselines from the last 30 days (excluding today) ────────────
  const baselineDays = healthData.filter((h) => h.date !== targetDayHealth.date);

  const validSleepDays  = baselineDays.filter((h) => h.sleep_hours != null);
  const validHrvDays    = baselineDays.filter((h) => h.hrv_avg     != null);
  const validStepsDays  = baselineDays.filter((h) => h.active_energy != null);

  const avgSleep    = validSleepDays.length  > 0
    ? validSleepDays.reduce((s, h)  => s + h.sleep_hours, 0)  / validSleepDays.length
    : 7.0;   // sensible fallback if no baseline yet
  const avgHrv      = validHrvDays.length    > 0
    ? validHrvDays.reduce((s, h)    => s + h.hrv_avg, 0)      / validHrvDays.length
    : 55.0;
  const avgActivity = validStepsDays.length  > 0
    ? validStepsDays.reduce((s, h)  => s + h.active_energy, 0) / validStepsDays.length
    : 6000;

  // ── Spending data ─────────────────────────────────────────────────────────
  // Fetch 30 days of transactions to build a personal typical weekly spend
  const { data: last30Tx } = await supabase
    .from('transactions')
    .select('amount_cents, posted_at, category')
    .eq('user_id', userId)
    .gte('posted_at', thirtyDaysAgoStr)
    .lte('posted_at', targetDate);

  const nonBehavioral = NON_BEHAVIORAL_CATEGORIES as readonly string[];

  /**
   * Weight each transaction by its subcategory behavioral impulse weight.
   * This makes the financial component sensitive to the *type* of spending,
   * not just the raw dollar amount.
   */
  const weightedAmount = (t: { amount_cents: number; category?: string | null }) =>
    t.amount_cents * getBehavioralWeight(t.category);

  const isBehavioralSpend = (t: { amount_cents: number; category?: string | null }) =>
    t.amount_cents > 0 && !nonBehavioral.includes(t.category ?? '');

  const billable30 = (last30Tx ?? []).filter(isBehavioralSpend);

  // This week (last 7 days ending on targetDate)
  const sevenDaysAgo = new Date(targetDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  // Use weighted amounts: $100 on food delivery (weight 0.9) = $90 weighted
  const last7DaysSpend =
    billable30
      .filter((t) => t.posted_at >= sevenDaysAgoStr)
      .reduce((sum, t) => sum + weightedAmount(t), 0) / 100;

  // Previous week (days 8–14)
  const fourteenDaysAgo = new Date(targetDate);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

  const prev7DaysSpend =
    billable30
      .filter((t) => t.posted_at >= fourteenDaysAgoStr && t.posted_at < sevenDaysAgoStr)
      .reduce((sum, t) => sum + weightedAmount(t), 0) / 100;

  // Personal typical weekly weighted spend = 30-day weighted total ÷ (30/7) ≈ 4.3 weeks
  const total30DaysSpend = billable30.reduce((sum, t) => sum + weightedAmount(t), 0) / 100;
  const personalTypicalWeeklySpend = total30DaysSpend / (30 / 7);

  // ── Health component (0–100) ──────────────────────────────────────────────
  // Each sub-score is computed relative to the user's own baseline.

  // Sleep (0–40 pts: higher = more risk)
  const sleepScore = sleepFactor(sleepHours, avgSleep, 40);

  // HRV (0–35 pts)
  let hrvScore = 0;
  if (hrv > 0 && avgHrv > 0) {
    const hrvDevPct = ((hrv - avgHrv) / avgHrv) * 100;
    hrvScore = relativeHealthFactor(hrvDevPct, 35);
  }

  // Activity (0–25 pts)
  let activityScore = 0;
  if (avgActivity > 0) {
    const actDevPct = ((steps - avgActivity) / avgActivity) * 100;
    activityScore = relativeHealthFactor(actDevPct, 20);
  }
  if (intenseWorkoutYesterday) activityScore = Math.min(activityScore + 5, 25);

  const healthScore = Math.min(sleepScore + hrvScore + activityScore, 100);

  // ── Financial component (0–100) ───────────────────────────────────────────
  // Compare this week's daily avg to the user's own personal typical weekly
  // spend, so "normal" is always relative to the individual.
  const last7DailyAvg           = last7DaysSpend / 7;
  const personalTypicalDailyAvg = personalTypicalWeeklySpend > 0
    ? personalTypicalWeeklySpend / 7
    : last7DailyAvg; // fallback when no baseline exists yet

  let finScore = 0;
  if (personalTypicalDailyAvg > 0 && last7DailyAvg > 0) {
    // ratio = 1.0 means spending exactly at personal typical level
    const ratio = last7DailyAvg / personalTypicalDailyAvg;
    if (ratio <= 1.0)       finScore = 0;
    else if (ratio <= 1.15) finScore = 10;
    else if (ratio <= 1.5)  finScore = 30;
    else if (ratio <= 2.0)  finScore = 60;
    else if (ratio <= 3.0)  finScore = 80;
    else                    finScore = 100;
  }

  // Change % vs prior week (for display / insight messages)
  const spendingChangePercent =
    prev7DaysSpend > 0
      ? ((last7DaysSpend - prev7DaysSpend) / prev7DaysSpend) * 100
      : 0;

  // ── Blended score ─────────────────────────────────────────────────────────
  const riskScore = Math.min(Math.round(healthScore * 0.6 + finScore * 0.4), 100);

  const riskLevel: RiskLevel =
    riskScore <= 30 ? 'LOW' : riskScore <= 60 ? 'MEDIUM' : 'HIGH';

  // ── Insight messages (personalized language) ──────────────────────────────
  const sleepDevPct   = avgSleep   > 0 ? ((sleepHours - avgSleep)   / avgSleep)   * 100 : 0;
  const hrvDevPct     = avgHrv     > 0 ? ((hrv - avgHrv)           / avgHrv)     * 100 : 0;
  const actDevPct     = avgActivity > 0 ? ((steps - avgActivity)    / avgActivity) * 100 : 0;

  const insights: string[] = [];

  // Sleep insight
  if (sleepScore === 0) {
    insights.push(`Good: Sleep on par with your average (${avgSleep.toFixed(1)}h avg)`);
  } else if (sleepDevPct >= -15) {
    insights.push(`Caution: Sleep slightly below your average (${sleepHours.toFixed(1)}h vs ${avgSleep.toFixed(1)}h avg)`);
  } else if (sleepDevPct >= -30) {
    insights.push(`Warning: Sleep notably below your average (${sleepHours.toFixed(1)}h vs ${avgSleep.toFixed(1)}h avg)`);
  } else {
    insights.push(`Critical: Sleep far below your average (${sleepHours.toFixed(1)}h vs ${avgSleep.toFixed(1)}h avg)`);
  }

  // HRV insight
  if (hrv > 0 && avgHrv > 0) {
    if (hrvScore === 0) {
      insights.push(`Good: HRV on par with your average (${avgHrv.toFixed(0)}ms avg)`);
    } else if (hrvDevPct >= -15) {
      insights.push(`Caution: HRV slightly below your average (${hrv.toFixed(0)}ms vs ${avgHrv.toFixed(0)}ms avg)`);
    } else if (hrvDevPct >= -30) {
      insights.push(`Warning: HRV notably below your average (${hrv.toFixed(0)}ms vs ${avgHrv.toFixed(0)}ms avg)`);
    } else {
      insights.push(`Critical: HRV far below your average (${hrv.toFixed(0)}ms vs ${avgHrv.toFixed(0)}ms avg)`);
    }
  }

  // Activity insight
  if (activityScore === 0) {
    insights.push(`Good: Activity on par with your typical level`);
  } else if (actDevPct >= -15) {
    insights.push(`Caution: Activity slightly below your typical level`);
  } else if (actDevPct >= -30) {
    insights.push(`Warning: Activity notably below your typical level`);
  } else {
    insights.push(`Critical: Activity far below your typical level`);
  }

  // Spending insight
  if (prev7DaysSpend > 0) {
    if (spendingChangePercent <= 0) {
      insights.push('Good: Spending stable or below your prior week');
    } else if (spendingChangePercent < 15) {
      insights.push(`Notice: Spending up ${spendingChangePercent.toFixed(0)}% vs last week`);
    } else if (spendingChangePercent <= 30) {
      insights.push(`Caution: Spending up ${spendingChangePercent.toFixed(0)}% vs last week`);
    } else {
      insights.push(`Alert: Spending up ${spendingChangePercent.toFixed(0)}% vs last week`);
    }
  }
  if (personalTypicalWeeklySpend > 0 && last7DaysSpend > 0) {
    const vsTypical = ((last7DaysSpend - personalTypicalWeeklySpend) / personalTypicalWeeklySpend) * 100;
    if (vsTypical > 30) {
      insights.push(`Alert: This week's spend is ${vsTypical.toFixed(0)}% above your typical weekly level ($${personalTypicalWeeklySpend.toFixed(0)})`);
    }
  }

  if (riskLevel === 'HIGH')        insights.unshift('HIGH RISK: Strong impulse spending risk');
  else if (riskLevel === 'MEDIUM') insights.unshift('MEDIUM RISK: Elevated impulse risk — be mindful');
  else                             insights.unshift('LOW RISK: Good behavioral balance');

  const personalBaselines: PersonalBaselines = {
    avg_sleep:          Math.round(avgSleep * 10) / 10,
    avg_hrv:            Math.round(avgHrv),
    avg_activity:       Math.round(avgActivity),
    avg_weekly_spend:   Math.round(personalTypicalWeeklySpend * 100) / 100,
    days_used:          baselineDays.length,
  };

  return {
    risk_score: riskScore,
    risk_level: riskLevel,
    insights,
    health_summary: {
      avg_sleep:    String(sleepHours.toFixed(1)),
      avg_hrv:      String(hrv.toFixed(0)),
      avg_activity: String(steps.toFixed(0)),
    },
    spending_summary: {
      last_7_days:    last7DaysSpend.toFixed(2),
      prev_7_days:    prev7DaysSpend.toFixed(2),
      change_percent: spendingChangePercent.toFixed(1),
    },
    score_breakdown: {
      health_score: Math.round(healthScore),
      fin_score:    Math.round(finScore),
    },
    personal_baselines: personalBaselines,
  };
}
