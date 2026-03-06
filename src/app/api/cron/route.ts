import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scrapeSite } from '@/lib/scraper';

// Vercel Cron endpoint - triggered by vercel.json cron config
export async function GET() {
  try {
    const { data: config } = await supabase
      .from('AppConfig')
      .select('*')
      .eq('id', 'main')
      .maybeSingle();

    if (!config?.scheduleEnabled) {
      return NextResponse.json({ message: 'Scheduled search is disabled', skipped: true });
    }

    const { data: sources } = await supabase
      .from('Source')
      .select('*')
      .eq('enabled', true);

    const { data: keywords } = await supabase.from('Keyword').select('*');
    const keywordWords = (keywords || []).map((k: { word: string }) => k.word);

    if (!sources?.length || !keywordWords.length) {
      return NextResponse.json({ message: 'No sources or keywords configured', skipped: true });
    }

    const sessionId = crypto.randomUUID();
    let totalFound = 0;

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
          await supabase.from('SearchResult').insert(rows);
          totalFound += rows.length;
        }
      } catch (error) {
        console.error(`Cron: Error scraping ${source.name}:`, error);
      }
    }

    return NextResponse.json({ success: true, count: totalFound, sessionId });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}
