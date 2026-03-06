import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data: config, error } = await supabase
      .from('AppConfig')
      .select('*')
      .eq('id', 'main')
      .maybeSingle();

    if (error) throw error;

    if (!config) {
      const { data: newConfig, error: insertError } = await supabase
        .from('AppConfig')
        .insert({ id: 'main', scheduleTime: '09:00', scheduleEnabled: false })
        .select()
        .single();
      if (insertError) throw insertError;
      return NextResponse.json(newConfig);
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('GET /api/schedule error:', error);
    return NextResponse.json({ error: 'Failed to fetch schedule' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { scheduleTime, scheduleEnabled } = await request.json();

    const { data, error } = await supabase
      .from('AppConfig')
      .upsert({
        id: 'main',
        ...(scheduleTime !== undefined && { scheduleTime }),
        ...(scheduleEnabled !== undefined && { scheduleEnabled }),
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('PUT /api/schedule error:', error);
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 });
  }
}
