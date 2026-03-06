import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const DEFAULT_KEYWORDS = [
  'MAN', 'Perkins', 'Deutz', 'Scania', 'Mitsubishi',
  'дизельный', 'агрегат', 'судовой', 'сзч', 'сменно',
  'сменные', 'запасные', 'части', 'двигатель',
];

export async function GET() {
  try {
    const { data: keywords, error } = await supabase
      .from('Keyword')
      .select('*')
      .order('word', { ascending: true });

    if (error) throw error;

    if (!keywords || keywords.length === 0) {
      await supabase.from('Keyword').insert(DEFAULT_KEYWORDS.map((word) => ({ word })));
      const { data: newKw, error: e2 } = await supabase
        .from('Keyword')
        .select('*')
        .order('word', { ascending: true });
      if (e2) throw e2;
      return NextResponse.json(newKw);
    }

    return NextResponse.json(keywords);
  } catch (error) {
    console.error('GET /api/keywords error:', error);
    return NextResponse.json({ error: 'Failed to fetch keywords' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { word } = await request.json();
    if (!word?.trim()) {
      return NextResponse.json({ error: 'Keyword is required' }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from('Keyword')
      .select('id')
      .eq('word', word.trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Keyword already exists' }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('Keyword')
      .insert({ word: word.trim() })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('POST /api/keywords error:', error);
    return NextResponse.json({ error: 'Failed to create keyword' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const { error } = await supabase.from('Keyword').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/keywords error:', error);
    return NextResponse.json({ error: 'Failed to delete keyword' }, { status: 500 });
  }
}
