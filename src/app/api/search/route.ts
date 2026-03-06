import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scrapeSite } from '@/lib/scraper';
import { randomUUID } from 'crypto';

export async function POST() {
  try {
    const { data: sources, error: srcError } = await supabase
      .from('Source')
      .select('*')
      .eq('enabled', true);

    if (srcError) throw srcError;

    if (!sources || sources.length === 0) {
      return NextResponse.json(
        { error: 'Нет активных источников. Добавьте хотя бы один.' },
        { status: 400 }
      );
    }

    const { data: keywords, error: kwError } = await supabase
      .from('Keyword')
      .select('*');

    if (kwError) throw kwError;
    const keywordWords = (keywords || []).map((k: { word: string }) => k.word);

    if (keywordWords.length === 0) {
      return NextResponse.json(
        { error: 'Нет ключевых слов. Добавьте хотя бы одно.' },
        { status: 400 }
      );
    }

    const sessionId = randomUUID();
    let totalFound = 0;
    const errors: string[] = [];

    for (const source of sources) {
      try {
        const items = await scrapeSite(source.url, source.name, keywordWords);

        if (items.length > 0) {
          const rows = items.map((item) => ({
            sourceUrl: item.sourceUrl,
            sourceName: item.sourceName,
            title: item.title,
            description: item.description,
            link: item.link,
            matchedKeywords: item.matchedKeywords.join(', '),
            sessionId,
            foundAt: new Date().toISOString(),
          }));

          const { error: insertError } = await supabase.from('SearchResult').insert(rows);
          if (insertError) throw insertError;
          totalFound += rows.length;
        }
      } catch (error) {
        const msg = `Ошибка при сканировании ${source.name}: ${
          error instanceof Error ? error.message : 'Unknown'
        }`;
        console.error(msg);
        errors.push(msg);
      }
    }

    return NextResponse.json({
      success: true,
      count: totalFound,
      sessionId,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('POST /api/search error:', error);
    return NextResponse.json(
      { error: 'Ошибка при выполнении поиска' },
      { status: 500 }
    );
  }
}
