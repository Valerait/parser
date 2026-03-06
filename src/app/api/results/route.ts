import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data: results, error } = await supabase
      .from('SearchResult')
      .select('*')
      .order('foundAt', { ascending: false })
      .limit(500);

    if (error) throw error;
    return NextResponse.json(results || []);
  } catch (error) {
    console.error('GET /api/results error:', error);
    return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { error } = await supabase.from('SearchResult').delete().neq('id', '');
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/results error:', error);
    return NextResponse.json({ error: 'Failed to clear results' }, { status: 500 });
  }
}
