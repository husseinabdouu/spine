import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { calculateBehavioralRisk } from '@/lib/insights/calculate-risk';

export async function POST(request: Request) {
  try {
    const { user_id, sleep_hours, hrv, steps, date } = await request.json();

    if (!user_id || !date) {
      return NextResponse.json({ error: 'Missing required fields: user_id and date' }, { status: 400 });
    }

    if (sleep_hours !== null && sleep_hours !== undefined) {
      if (sleep_hours < 0 || sleep_hours > 16) {
        return NextResponse.json({ error: 'Sleep hours must be between 0 and 16' }, { status: 400 });
      }
    }

    if (steps !== null && steps !== undefined) {
      if (steps < 0 || steps > 50000) {
        return NextResponse.json({ error: 'Steps must be between 0 and 50,000' }, { status: 400 });
      }
    }

    const supabase = await createClient();

    const { data: healthData, error } = await supabase
      .from('health_data')
      .upsert(
        {
          user_id,
          date,
          sleep_hours,
          hrv_avg: hrv,
          active_energy: steps,
        },
        { onConflict: 'user_id,date', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to save health data' }, { status: 500 });
    }

    // Recalculate behavioral insights for this date
    const riskResult = await calculateBehavioralRisk(supabase, user_id, date);

    if (riskResult) {
      await supabase
        .from('behavioral_insights')
        .upsert(
          {
            user_id,
            date,
            risk_score: riskResult.risk_score,
            insights: riskResult.insights,
            health_summary: riskResult.health_summary,
            spending_summary: riskResult.spending_summary,
          },
          { onConflict: 'user_id,date', ignoreDuplicates: false }
        );
    }

    return NextResponse.json({
      success: true,
      message: 'Health data saved successfully',
      data: healthData,
      risk_score: riskResult?.risk_score ?? null,
    });
  } catch (error) {
    console.error('Error submitting health data:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
