import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const DEFAULT_SOURCES = [
  { name: 'EEP MitWork - Закупки', url: 'https://eep.mitwork.kz/ru/publics/buys', enabled: true },
  { name: 'Zakup SK - Самрук-Казына', url: 'https://zakup.sk.kz', enabled: true },
  { name: 'Tizilim - Тендеры', url: 'https://public.tizilim.gov.kz/ru/common/tender', enabled: true },
];

export async function GET() {
  try {
    const { data: sources, error } = await supabase
      .from('Source')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    if (!sources || sources.length === 0) {
      const { error: insertError } = await supabase.from('Source').insert(DEFAULT_SOURCES);
      if (insertError) throw insertError;

      const { data: newSources, error: refetchError } = await supabase
        .from('Source')
        .select('*')
        .order('name', { ascending: true });
      if (refetchError) throw refetchError;
      return NextResponse.json(newSources);
    }

    return NextResponse.json(sources);
  } catch (error) {
    console.error('GET /api/sources error:', error);
    return NextResponse.json({ error: 'Failed to fetch sources' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, url } = body;

    if (!name || !url) {
      return NextResponse.json({ error: 'Name and URL are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('Source')
      .insert({ name, url, enabled: true })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('POST /api/sources error:', error);
    return NextResponse.json({ error: 'Failed to create source' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const { error } = await supabase.from('Source').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/sources error:', error);
    return NextResponse.json({ error: 'Failed to delete source' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('Source')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('PATCH /api/sources error:', error);
    return NextResponse.json({ error: 'Failed to update source' }, { status: 500 });
  }
}
