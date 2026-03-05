import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { calculateBehavioralRisk } from '@/lib/insights/calculate-risk';

export async function POST(request: Request) {
  try {
    const { user_id, date } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    // Default to today; if no health data exists for today, the risk engine
    // will automatically fall back to the most recent available day
    const targetDate = date ?? new Date().toISOString().split('T')[0];
    const supabase = await createClient();

    const result = await calculateBehavioralRisk(supabase, user_id, targetDate);

    if (!result) {
      return NextResponse.json({
        error: 'Not enough health data. Need at least 3 days of data including the target date.',
      }, { status: 400 });
    }

    const { data, error: insertError } = await supabase
      .from('behavioral_insights')
      .upsert(
        {
          user_id,
          date: targetDate,
          risk_score: result.risk_score,
          insights: result.insights,
          health_summary: result.health_summary,
          spending_summary: result.spending_summary,
        },
        { onConflict: 'user_id,date', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to save insights' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      risk_score: result.risk_score,
      risk_level: result.risk_level,
      insights: result.insights,
      data,
    });
  } catch (error) {
    console.error('Error calculating insights:', error);
    return NextResponse.json({ error: 'Failed to calculate insights' }, { status: 500 });
  }
}
