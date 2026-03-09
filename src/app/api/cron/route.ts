import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scrapeSite } from '@/lib/scraper';

// Vercel Cron endpoint - triggered by vercel.json cron config
export async function GET(request: Request) {
  try {
    // Verify CRON_SECRET to prevent unauthorized access
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: config } = await supabase
      .from('AppConfig')
      .select('*')
      .eq('id', 'main')
      .maybeSingle();

    if (!config?.scheduleEnabled) {
      return NextResponse.json({ message: 'Scheduled search is disabled', skipped: true });
    }

    // Check if today is an allowed day
    if (config.scheduleDays) {
      const allowedDays = config.scheduleDays.split(',').map(Number);
      const today = new Date().getDay(); // 0=Sun, 1=Mon, ...
      if (!allowedDays.includes(today)) {
        return NextResponse.json({ message: `Today (day ${today}) is not in schedule`, skipped: true });
      }
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
