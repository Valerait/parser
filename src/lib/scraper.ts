/**
 * scraper.ts — Universal procurement site scraper
 *
 * Routing:
 *  - tizilim.gov.kz  → JSON API (public REST endpoint, no auth)
 *  - eep.mitwork.kz  → HTML scraping with URL keyword search params
 *  - zakup.sk.kz     → Playwright browser automation (SPA + WAF)
 *  - other sites     → Generic Cheerio HTML scraping (multi-strategy)
 */

import * as cheerio from 'cheerio';

export interface ScrapedItem {
  title: string;
  description: string;
  link: string;
  matchedKeywords: string[];
  sourceUrl: string;
  sourceName: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════════

export async function scrapeSite(
  url: string,
  name: string,
  keywords: string[]
): Promise<ScrapedItem[]> {
  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

  // ── tizilim.gov.kz: JS-rendered SPA → use public JSON API ─────────────────
  if (normalizedUrl.includes('tizilim.gov.kz')) {
    return scrapeTizilim(normalizedUrl, name, keywords);
  }

  // ── zakup.sk.kz: Angular SPA with WAF → use Playwright browser ────────────
  if (normalizedUrl.includes('zakup.sk.kz')) {
    const { scrapeSkZakup } = await import('./scraperBrowser');
    return scrapeSkZakup(normalizedUrl, name, keywords);
  }

  // ── eep.mitwork.kz: traditional HTML app → URL-based keyword search ────────
  if (normalizedUrl.includes('eep.mitwork.kz')) {
    return scrapeEep(normalizedUrl, name, keywords);
  }

  // ── Generic: try HTML scraping with multiple strategies ────────────────────
  return scrapeGeneric(normalizedUrl, name, keywords);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Tizilim — JSON API
// ═══════════════════════════════════════════════════════════════════════════════

interface TizilimTender {
  number: string;
  name_ru: string | null;
  name_kz: string | null;
  customer?: { name_ru: string | null };
  type?: { name_ru: string | null };
  status?: { name_ru: string | null };
  amount?: string;
  end_date?: string;
}

interface TizilimResponse {
  data: TizilimTender[];
  meta?: { last_page: number };
}

async function scrapeTizilim(
  sourceUrl: string,
  name: string,
  keywords: string[]
): Promise<ScrapedItem[]> {
  const apiBase = 'https://public.tizilim.gov.kz/api/public/tenders';
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();
  const maxPages = 10;

  // Search per-keyword using the API's search parameter
  for (const keyword of keywords) {
    console.log(`[tizilim] Поиск: "${keyword}"`);

    for (let page = 1; page <= maxPages; page++) {
      try {
        const url =
          `${apiBase}?page=${page}&per_page=30` +
          `&search=${encodeURIComponent(keyword)}`;

        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) break;

        const json: TizilimResponse = await response.json();
        const tenders = json.data || [];
        if (tenders.length === 0) break;

        for (const tender of tenders) {
          // Only collect published tenders (Опубликован)
          if (tender.status?.name_ru !== 'Опубликован') continue;

          // Skip duplicates
          if (seen.has(tender.number)) continue;
          seen.add(tender.number);

          // No link — site requires login to view full tender
          const descParts = [
            tender.number && `№ ${tender.number}`,
            tender.customer?.name_ru && `Заказчик: ${tender.customer.name_ru}`,
            tender.type?.name_ru && `Тип: ${tender.type.name_ru}`,
            tender.amount &&
              `Сумма: ${parseFloat(tender.amount).toLocaleString('ru-RU')} тг`,
            tender.end_date && `Срок: до ${tender.end_date.split(' ')[0]}`,
          ].filter(Boolean);

          items.push({
            title: tender.name_ru || tender.number,
            description: descParts.join(' | '),
            link: sourceUrl, // link to portal main page (login required for details)
            matchedKeywords: [keyword],
            sourceUrl,
            sourceName: name,
          });

          console.log(`[tizilim] ✓ ${tender.number}: ${(tender.name_ru || '').substring(0, 60)}`);
        }

        if (page >= (json.meta?.last_page ?? 1)) break;
      } catch (err) {
        console.error(`[tizilim] Ошибка (keyword="${keyword}", page=${page}):`, err);
        break;
      }
    }

    console.log(`[tizilim] "${keyword}" → ${items.length} объявлений всего`);
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EEP MitWork — HTML scraping with URL keyword search
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeEep(
  sourceUrl: string,
  name: string,
  keywords: string[]
): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();
  const baseUrl = 'https://eep.mitwork.kz';
  const maxPages = 5; // up to 250 results per keyword

  for (const keyword of keywords) {
    console.log(`[eep.mitwork.kz] Поиск: "${keyword}"`);

    for (let page = 1; page <= maxPages; page++) {
      try {
        const searchUrl =
          `${baseUrl}/ru/publics/buys?` +
          `filter%5Bkeyword%5D=${encodeURIComponent(keyword)}` +
          `&page=${page}&per-page=50`;

        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9',
            Referer: `${baseUrl}/ru/publics/buys`,
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) break;

        const html = await response.text();
        const $ = cheerio.load(html);

        // Result rows: tr.item[data-key]
        const rows = $('tr.item[data-key]');
        if (rows.length === 0) break;

        rows.each((_, row) => {
          const $row = $(row);
          const id = $row.attr('data-key') || '';

          const anchor = $row.find('td:nth-child(2) a.word-break').first();
          const title = anchor.text().trim();
          const href = anchor.attr('href') || `${baseUrl}/ru/publics/buy/${id}`;
          const link = href.startsWith('http') ? href : `${baseUrl}${href}`;

          if (!title || seen.has(id)) return;
          seen.add(id);

          const amount   = $row.find('td:nth-child(3)').text().trim();
          const method   = $row.find('td:nth-child(4)').text().trim();
          const start    = $row.find('td:nth-child(5)').text().trim();
          const end      = $row.find('td:nth-child(6)').text().trim();
          const orgEl    = $row.find('td:nth-child(7) a');
          const organizer= orgEl.attr('title') || orgEl.text().trim();
          const status   = $row.find('td:nth-child(8)').text().trim();

          const descParts = [
            amount    && `Сумма: ${amount}`,
            method    && `Метод: ${method}`,
            start     && `Начало: ${start}`,
            end       && `Окончание: ${end}`,
            organizer && `Организатор: ${organizer}`,
            status    && `Статус: ${status}`,
          ].filter(Boolean);

          items.push({
            title: title.substring(0, 300),
            description: descParts.join(' | ').substring(0, 1000),
            link,
            matchedKeywords: [keyword],
            sourceUrl,
            sourceName: name,
          });
        });

        // Check for next page
        const hasNextPage =
          $('li.next:not(.disabled)').length > 0 ||
          $('a[rel="next"]').length > 0;
        if (!hasNextPage) break;

      } catch (err) {
        console.error(`[eep.mitwork.kz] Error (keyword="${keyword}", page=${page}):`, err);
        break;
      }
    }
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Generic — HTML scraping (multi-strategy Cheerio)
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeGeneric(
  normalizedUrl: string,
  name: string,
  keywords: string[]
): Promise<ScrapedItem[]> {
  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const items: ScrapedItem[] = [];
    const seen = new Set<string>();

    // Strategy 1: Table rows
    $('table tbody tr, table tr').each((_, row) => {
      const text = $(row).text().trim();
      if (!text || text.length < 5) return;
      const matched = matchKeywords(text, keywords);
      if (matched.length === 0) return;
      const cells = $(row).find('td');
      if (cells.length === 0) return;
      const firstLink = $(row).find('a').first();
      const href = resolveUrl(firstLink.attr('href'), normalizedUrl);
      const title = firstLink.text().trim() || cells.first().text().trim();
      if (title && !seen.has(title)) {
        seen.add(title);
        items.push({
          title: title.substring(0, 300),
          description: cells.map((_, c) => $(c).text().trim()).get().join(' | ').substring(0, 1000),
          link: href,
          matchedKeywords: matched,
          sourceUrl: normalizedUrl,
          sourceName: name,
        });
      }
    });

    // Strategy 2: Card elements
    const cardSelectors = [
      '[class*="card"]', '[class*="item"]', '[class*="tender"]',
      '[class*="announce"]', '[class*="purchase"]', '[class*="buy"]',
      '[class*="lot"]', '[class*="zakup"]', '[class*="result"]',
      '[class*="row"]:not(table [class*="row"])', 'article', '.list-group-item',
    ];
    $(cardSelectors.join(', ')).each((_, el) => {
      const text = $(el).text().trim();
      if (!text || text.length < 10) return;
      const matched = matchKeywords(text, keywords);
      if (matched.length === 0) return;
      const titleEl = $(el).find('h1,h2,h3,h4,h5,a,[class*="title"],[class*="name"],[class*="subject"]').first();
      const firstLink = $(el).find('a').first();
      const href = resolveUrl(firstLink.attr('href'), normalizedUrl);
      const title = titleEl.text().trim() || text.substring(0, 150);
      if (title && !seen.has(title)) {
        seen.add(title);
        items.push({
          title: title.substring(0, 300),
          description: text.substring(0, 1000),
          link: href,
          matchedKeywords: matched,
          sourceUrl: normalizedUrl,
          sourceName: name,
        });
      }
    });

    // Strategy 3: Links fallback
    if (items.length === 0) {
      $('a').each((_, el) => {
        const linkText = $(el).text().trim();
        const parentText = $(el).parent().text().trim();
        const matched = matchKeywords(linkText + ' ' + parentText, keywords);
        if (matched.length === 0) return;
        const href = resolveUrl($(el).attr('href'), normalizedUrl);
        if (linkText && linkText.length > 5 && !seen.has(linkText)) {
          seen.add(linkText);
          items.push({ title: linkText.substring(0, 300), description: parentText.substring(0, 1000), link: href, matchedKeywords: matched, sourceUrl: normalizedUrl, sourceName: name });
        }
      });
    }

    // Strategy 4: Full-page text
    if (items.length === 0) {
      const bodyText = $('body').text().trim();
      const matched = matchKeywords(bodyText, keywords);
      if (matched.length > 0) {
        items.push({
          title: `Найдены ключевые слова на странице: ${name}`,
          description: `На странице ${normalizedUrl} найдены: ${matched.join(', ')}. Откройте для просмотра.`,
          link: normalizedUrl,
          matchedKeywords: matched,
          sourceUrl: normalizedUrl,
          sourceName: name,
        });
      }
    }

    return items;
  } catch (error) {
    console.error(`[generic] Error scraping ${normalizedUrl}:`, error);
    return [
      {
        title: `Ошибка при сканировании: ${name}`,
        description: error instanceof Error ? error.message : 'Неизвестная ошибка',
        link: normalizedUrl,
        matchedKeywords: [],
        sourceUrl: normalizedUrl,
        sourceName: name,
      },
    ];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function matchKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase()));
}

function resolveUrl(href: string | undefined, base: string): string {
  if (!href || href === '#' || href.startsWith('javascript:')) return '';
  try {
    if (href.startsWith('http')) return href;
    return new URL(href, base).href;
  } catch {
    return href;
  }
}
