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
// 2. EEP MitWork — HTML scraping with detail page lot data
//
// Strategy:
//  1. Search via URL: filter[search]=keyword & filter[top_filter_status]=1
//  2. Parse result rows (tr.item[data-key]) for announcement IDs + links
//  3. Fetch each announcement detail page (/ru/publics/buy/{id})
//  4. Collect: наименование закупки, lot details (номер, наименование, описание,
//     количество, цена, сумма)
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeEep(
  sourceUrl: string,
  name: string,
  keywords: string[]
): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();
  const baseUrl = 'https://eep.mitwork.kz';
  const maxPages = 5;

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9',
    Referer: `${baseUrl}/ru/publics/buys`,
  };

  for (const keyword of keywords) {
    console.log(`[eep.mitwork.kz] Поиск: "${keyword}"`);

    for (let page = 1; page <= maxPages; page++) {
      try {
        // Correct URL params: filter[search] (not filter[keyword])
        // filter[top_filter_status]=1 for "Опубликованные"
        const searchUrl =
          `${baseUrl}/ru/publics/buys?` +
          `filter%5Bsubmit%5D=` +
          `&filter%5Bsearch%5D=${encodeURIComponent(keyword)}` +
          `&filter%5Btop_filter_status%5D=1` +
          `&filter%5Bis_preliminary%5D=EMPTY` +
          `&page=${page}&per-page=50`;

        const response = await fetch(searchUrl, {
          headers,
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) break;

        const html = await response.text();
        const $ = cheerio.load(html);

        // Result rows: tr.item[data-key]
        const rows = $('tr.item[data-key]');
        if (rows.length === 0) break;

        console.log(`[eep.mitwork.kz] "${keyword}" стр.${page}: ${rows.length} объявлений`);

        // Collect announcement IDs and basic info from search results
        const announcements: {
          id: string;
          title: string;
          link: string;
          amount: string;
          method: string;
          organizer: string;
        }[] = [];

        rows.each((_, row) => {
          const $row = $(row);
          const id = $row.attr('data-key') || '';
          if (!id || seen.has(id)) return;
          seen.add(id);

          const anchor = $row.find('td:nth-child(2) a').first();
          const title = anchor.text().trim();
          const href = anchor.attr('href') || `${baseUrl}/ru/publics/buy/${id}`;
          const link = href.startsWith('http') ? href : `${baseUrl}${href}`;

          const amount = $row.find('td:nth-child(3)').text().trim();
          const method = $row.find('td:nth-child(4)').text().trim();
          const orgEl = $row.find('td:nth-child(7) a');
          const organizer = orgEl.attr('title') || orgEl.text().trim();

          announcements.push({ id, title, link, amount, method, organizer });
        });

        // Fetch detail page for each announcement to get lot data
        for (const ann of announcements) {
          try {
            const detailItems = await scrapeEepDetail(
              ann.id, ann.title, ann.link, ann.amount, ann.method,
              ann.organizer, keyword, sourceUrl, name, headers
            );
            items.push(...detailItems);
          } catch (err) {
            console.error(`[eep.mitwork.kz] Ошибка при загрузке объявления ${ann.id}:`, err);
            // Fallback: add the announcement without lot details
            items.push({
              title: ann.title.substring(0, 300),
              description: [
                ann.amount && `Сумма: ${ann.amount}`,
                ann.method && `Метод: ${ann.method}`,
                ann.organizer && `Организатор: ${ann.organizer}`,
              ].filter(Boolean).join(' | '),
              link: ann.link,
              matchedKeywords: [keyword],
              sourceUrl,
              sourceName: name,
            });
          }
        }

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

  console.log(`[eep.mitwork.kz] Итого: ${items.length} записей`);
  return items;
}

// ── Fetch one EEP announcement detail page and extract lot data ──────────────

async function scrapeEepDetail(
  id: string,
  title: string,
  link: string,
  amount: string,
  method: string,
  organizer: string,
  keyword: string,
  sourceUrl: string,
  sourceName: string,
  headers: Record<string, string>
): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];

  const response = await fetch(link, {
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract purchase name from detail page
  const nameRu = $('table.detail-view tr')
    .filter((_, r) => $(r).find('th').text().includes('Наименование на русском'))
    .find('td').text().trim() || title;

  // Find the lots table: it's inside a div.grid-view, with headers "Номер", "Наименование", "Количество"
  // The main detail table has class "detail-view", so we skip it
  let lotRows = $();

  $('div.grid-view table').each((_, tbl) => {
    const thTexts = $(tbl).find('th').map((__, th) => $(th).text().trim()).get().join(' ');
    if (thTexts.includes('Наименование') && thTexts.includes('Количество')) {
      lotRows = $(tbl).find('tbody tr');
      return false; // break
    }
  });

  if (lotRows.length > 0) {
    console.log(`[eep.mitwork.kz] ✓ №${id}: "${nameRu.substring(0, 50)}" — ${lotRows.length} лотов`);

    // Add one item per lot
    lotRows.each((_, row) => {
      const cells = $(row).find('td');
      const lotNumber = cells.eq(0).text().trim();
      const lotName = cells.eq(1).text().trim();
      const lotDesc = cells.eq(2).text().trim();
      const lotQty = cells.eq(3).text().trim();
      const lotPrice = cells.eq(4).text().trim();
      const lotTotal = cells.eq(5).text().trim();

      const descParts = [
        `Закупка: ${nameRu}`,
        lotNumber && `Лот: ${lotNumber}`,
        lotDesc && `Описание: ${lotDesc}`,
        lotQty && `Кол-во: ${lotQty}`,
        lotPrice && `Цена: ${lotPrice}`,
        lotTotal && `Сумма: ${lotTotal}`,
        method && `Метод: ${method}`,
        organizer && `Организатор: ${organizer}`,
      ].filter(Boolean);

      items.push({
        title: `${lotName || nameRu} (№${id}, лот ${lotNumber})`.substring(0, 300),
        description: descParts.join(' | ').substring(0, 1000),
        link,
        matchedKeywords: [keyword],
        sourceUrl,
        sourceName,
      });
    });
  } else {
    // No lots table — add the announcement as a single item
    console.log(`[eep.mitwork.kz] ✓ №${id}: "${nameRu.substring(0, 50)}" — без лотов`);
    items.push({
      title: `${nameRu} (№${id})`.substring(0, 300),
      description: [
        amount && `Сумма: ${amount}`,
        method && `Метод: ${method}`,
        organizer && `Организатор: ${organizer}`,
      ].filter(Boolean).join(' | ').substring(0, 1000),
      link,
      matchedKeywords: [keyword],
      sourceUrl,
      sourceName,
    });
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
