import * as cheerio from 'cheerio';

export interface ScrapedItem {
  title: string;
  description: string;
  link: string;
  matchedKeywords: string[];
  sourceUrl: string;
  sourceName: string;
}

// ─── Tizilim JSON API ─────────────────────────────────────────────────────────

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
  const maxPages = 15; // fetch up to 450 recent tenders

  for (let page = 1; page <= maxPages; page++) {
    try {
      const response = await fetch(`${apiBase}?page=${page}&per_page=30`, {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) break;

      const json: TizilimResponse = await response.json();
      const tenders = json.data || [];
      if (tenders.length === 0) break;

      for (const tender of tenders) {
        const searchText = [
          tender.name_ru,
          tender.name_kz,
          tender.customer?.name_ru,
          tender.type?.name_ru,
        ]
          .filter(Boolean)
          .join(' ');

        const matched = matchKeywords(searchText, keywords);
        if (matched.length === 0) continue;

        const link = `https://public.tizilim.gov.kz/ru/common/tender/${encodeURIComponent(
          tender.number
        )}`;

        const descParts = [
          tender.customer?.name_ru && `Заказчик: ${tender.customer.name_ru}`,
          tender.type?.name_ru && `Тип: ${tender.type.name_ru}`,
          tender.status?.name_ru && `Статус: ${tender.status.name_ru}`,
          tender.amount &&
            `Сумма: ${parseFloat(tender.amount).toLocaleString('ru-RU')} тг`,
          tender.end_date && `Срок: до ${tender.end_date.split(' ')[0]}`,
        ].filter(Boolean);

        items.push({
          title: tender.name_ru || tender.number,
          description: descParts.join(' | '),
          link,
          matchedKeywords: matched,
          sourceUrl,
          sourceName: name,
        });
      }

      if (page >= (json.meta?.last_page ?? 1)) break;
    } catch (err) {
      console.error(`Tizilim page ${page} error:`, err);
      break;
    }
  }

  return items;
}

// ─── Generic HTML scraper ─────────────────────────────────────────────────────

export async function scrapeSite(
  url: string,
  name: string,
  keywords: string[]
): Promise<ScrapedItem[]> {
  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

  // Tizilim uses a JS-rendered SPA — use their JSON API directly
  if (normalizedUrl.includes('tizilim.gov.kz')) {
    return scrapeTizilim(normalizedUrl, name, keywords);
  }

  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
          description: cells
            .map((_, c) => $(c).text().trim())
            .get()
            .join(' | ')
            .substring(0, 1000),
          link: href,
          matchedKeywords: matched,
          sourceUrl: normalizedUrl,
          sourceName: name,
        });
      }
    });

    // Strategy 2: Card/item/list elements
    const cardSelectors = [
      '[class*="card"]',
      '[class*="item"]',
      '[class*="tender"]',
      '[class*="announce"]',
      '[class*="purchase"]',
      '[class*="buy"]',
      '[class*="lot"]',
      '[class*="zakup"]',
      '[class*="result"]',
      '[class*="row"]:not(table [class*="row"])',
      'article',
      '.list-group-item',
    ];

    $(cardSelectors.join(', ')).each((_, el) => {
      const text = $(el).text().trim();
      if (!text || text.length < 10) return;

      const matched = matchKeywords(text, keywords);
      if (matched.length === 0) return;

      const titleEl = $(el)
        .find(
          'h1, h2, h3, h4, h5, a, [class*="title"], [class*="name"], [class*="subject"]'
        )
        .first();
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

    // Strategy 3: All links with keyword match (fallback)
    if (items.length === 0) {
      $('a').each((_, el) => {
        const linkText = $(el).text().trim();
        const parentText = $(el).parent().text().trim();
        const combined = linkText + ' ' + parentText;

        const matched = matchKeywords(combined, keywords);
        if (matched.length === 0) return;

        const href = resolveUrl($(el).attr('href'), normalizedUrl);

        if (linkText && linkText.length > 5 && !seen.has(linkText)) {
          seen.add(linkText);
          items.push({
            title: linkText.substring(0, 300),
            description: parentText.substring(0, 1000),
            link: href,
            matchedKeywords: matched,
            sourceUrl: normalizedUrl,
            sourceName: name,
          });
        }
      });
    }

    // Strategy 4: Full-page text search (last resort)
    if (items.length === 0) {
      const bodyText = $('body').text().trim();
      const matched = matchKeywords(bodyText, keywords);
      if (matched.length > 0) {
        items.push({
          title: `Найдены ключевые слова на странице: ${name}`,
          description: `На странице ${normalizedUrl} найдены совпадения: ${matched.join(
            ', '
          )}. Откройте страницу для детального просмотра.`,
          link: normalizedUrl,
          matchedKeywords: matched,
          sourceUrl: normalizedUrl,
          sourceName: name,
        });
      }
    }

    return items;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return [
      {
        title: `Ошибка при сканировании: ${name}`,
        description:
          error instanceof Error ? error.message : 'Неизвестная ошибка',
        link: url.startsWith('http') ? url : `https://${url}`,
        matchedKeywords: [],
        sourceUrl: url,
        sourceName: name,
      },
    ];
  }
}

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
