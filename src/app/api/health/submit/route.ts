import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { user_id, sleep_hours, hrv, steps, date } = await request.json();

    // Validate required fields
    if (!user_id || !date) {
      return NextResponse.json({ error: 'Missing required fields: user_id and date' }, { status: 400 });
    }

    // Validate data ranges
    if (sleep_hours !== null && sleep_hours !== undefined) {
      if (sleep_hours < 0 || sleep_hours > 16) {
        return NextResponse.json({ error: 'Sleep hours must be between 0 and 16' }, { status: 400 });
      }
    }

    //skip HRV validation for now
  //  if (hrv !== null && hrv !== undefined) {
  //    if (hrv < 10 || hrv > 150) {
  //      return NextResponse.json({ error: 'HRV must be between 10 and 150' }, { status: 400 });
  //    }
  //  }

    if (steps !== null && steps !== undefined) {
      if (steps < 0 || steps > 50000) {
        return NextResponse.json({ error: 'Steps must be between 0 and 50,000' }, { status: 400 });
      }
    }

    const supabase = await createClient();

    // Insert or update health data
    const { data, error } = await supabase
  .from('health_data')
  .upsert({
    user_id,
    date,
    sleep_hours,
    hrv_avg: hrv,  // Changed to match your column name
    active_energy: steps,  // Using active_energy for steps since steps column doesn't exist
  }, {
        onConflict: 'user_id,date',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to save health data' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Health data saved successfully',
      data
    });

  } catch (error) {
    console.error('Error submitting health data:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}