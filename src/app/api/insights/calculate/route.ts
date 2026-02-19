import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { user_id } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const supabase = await createClient();

    // Get last 7 days of health data
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    const { data: healthData, error: healthError } = await supabase
      .from('health_data')
      .select('*')
      .eq('user_id', user_id)
      .gte('date', sevenDaysAgoStr)
      .order('date', { ascending: false });

    if (healthError) {
      console.error('Health data error:', healthError);
      return NextResponse.json({ error: 'Failed to fetch health data' }, { status: 500 });
    }

    if (!healthData || healthData.length < 3) {
      return NextResponse.json({
        error: 'Not enough health data. Need at least 3 days of data.'
      }, { status: 400 });
    }

    // Get last 7 days of transactions
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('amount_cents, posted_at')
      .eq('user_id', user_id)
      .gte('posted_at', sevenDaysAgoStr)
      .order('posted_at', { ascending: false });

    if (txError) {
      console.error('Transaction error:', txError);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    // Calculate health averages
    const avgSleep = healthData.reduce((sum, d) => sum + (d.sleep_hours || 0), 0) / healthData.length;
    const avgHRV = healthData.filter(d => d.hrv_avg).length > 0
      ? healthData.reduce((sum, d) => sum + (d.hrv_avg || 0), 0) / healthData.filter(d => d.hrv_avg).length
      : 0;
    const avgActivity = healthData.reduce((sum, d) => sum + (d.active_energy || 0), 0) / healthData.length;

    // Calculate spending averages
    const last7DaysSpend = transactions
      ? transactions.reduce((sum, t) => sum + (t.amount_cents || 0), 0) / 100
      : 0;

    // Get 14-day spending for comparison
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

    const { data: transactions14Day } = await supabase
      .from('transactions')
      .select('amount_cents, posted_at')
      .eq('user_id', user_id)
      .gte('posted_at', fourteenDaysAgoStr)
      .lt('posted_at', sevenDaysAgoStr);

    const prev7DaysSpend = transactions14Day
      ? transactions14Day.reduce((sum, t) => sum + (t.amount_cents || 0), 0) / 100
      : 0;

    // Calculate risk score (0-100)
    let riskScore = 0;
    const insights: string[] = [];

    // Sleep factor (0-30 points)
    if (avgSleep < 5) {
      riskScore += 30;
      insights.push('Critical: Very poor sleep detected (< 5 hours average)');
    } else if (avgSleep < 6) {
      riskScore += 20;
      insights.push('Warning: Poor sleep detected (< 6 hours average)');
    } else if (avgSleep < 7) {
      riskScore += 10;
      insights.push('Caution: Below optimal sleep (< 7 hours average)');
    } else {
      insights.push('Good: Healthy sleep patterns');
    }

    // HRV factor (0-25 points)
    if (avgHRV > 0) {
      if (avgHRV < 20) {
        riskScore += 25;
        insights.push('Critical: Very low HRV - poor recovery');
      } else if (avgHRV < 40) {
        riskScore += 15;
        insights.push('Warning: Low HRV - suboptimal recovery');
      } else if (avgHRV < 60) {
        riskScore += 5;
        insights.push('Caution: Moderate HRV');
      } else {
        insights.push('Good: Healthy HRV levels');
      }
    }

    // Activity factor (0-20 points)
    if (avgActivity < 2000) {
      riskScore += 20;
      insights.push('Warning: Very low activity levels');
    } else if (avgActivity < 5000) {
      riskScore += 10;
      insights.push('Caution: Below recommended activity');
    } else {
      insights.push('Good: Healthy activity levels');
    }

    // Spending trend (0-25 points)
    if (prev7DaysSpend > 0) {
      const spendingIncrease = ((last7DaysSpend - prev7DaysSpend) / prev7DaysSpend) * 100;

      if (spendingIncrease > 50) {
        riskScore += 25;
        insights.push(`Alert: Spending up ${spendingIncrease.toFixed(0)}% from previous week`);
      } else if (spendingIncrease > 20) {
        riskScore += 15;
        insights.push(`Caution: Spending increasing (up ${spendingIncrease.toFixed(0)}%)`);
      } else if (spendingIncrease > 0) {
        riskScore += 5;
        insights.push(`Notice: Slight spending increase (${spendingIncrease.toFixed(0)}%)`);
      } else {
        insights.push('Good: Spending stable or decreasing');
      }
    }

    // Overall assessment
    if (riskScore > 70) {
      insights.unshift('HIGH RISK: Strong impulse spending risk detected');
    } else if (riskScore > 40) {
      insights.unshift('MEDIUM RISK: Elevated impulse risk - be mindful of purchases');
    } else {
      insights.unshift('LOW RISK: Good behavioral balance');
    }

    // Pattern detection
    if (avgSleep < 6 && last7DaysSpend > prev7DaysSpend * 1.2) {
      insights.push('Pattern detected: Poor sleep correlating with increased spending');
    }

    // Store results
    const today = new Date().toISOString().split('T')[0];

    const { data: result, error: insertError } = await supabase
      .from('behavioral_insights')
      .upsert({
        user_id,
        date: today,
        risk_score: Math.min(riskScore, 100),
        insights,
        health_summary: {
          avg_sleep: avgSleep.toFixed(1),
          avg_hrv: avgHRV.toFixed(0),
          avg_activity: avgActivity.toFixed(0),
        },
        spending_summary: {
          last_7_days: last7DaysSpend.toFixed(2),
          prev_7_days: prev7DaysSpend.toFixed(2),
          change_percent: prev7DaysSpend > 0
            ? (((last7DaysSpend - prev7DaysSpend) / prev7DaysSpend) * 100).toFixed(1)
            : '0',
        },
      }, {
        onConflict: 'user_id,date',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to save insights' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      risk_score: Math.min(riskScore, 100),
      insights,
      data: result,
    });

  } catch (error) {
    console.error('Error calculating insights:', error);
    return NextResponse.json({ error: 'Failed to calculate insights' }, { status: 500 });
  }
}