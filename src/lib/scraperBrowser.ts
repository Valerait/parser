/**
 * scraperBrowser.ts
 * Playwright-based browser scraper for zakup.sk.kz
 *
 * Strategy:
 *  1. Navigate directly to the search URL with keyword in query params:
 *     https://zakup.sk.kz/#/ext?q=MAN&adst=PUBLISHED&lst=PUBLISHED&page=N
 *  2. Intercept the Angular app's XHR/fetch API calls to capture raw JSON results
 *     — this avoids fragile DOM scraping and gives structured data
 *  3. For each result item, navigate to its detail URL:
 *     https://zakup.sk.kz/#/ext(popup:item/{id}/advert)?tabs=advert&q=...
 *     and intercept the detail API response too
 *  4. Paginate via page=N until no more results
 *
 * Requirements:
 *  Local:  npm install playwright-core && npx playwright install chromium
 *  Vercel: add @sparticuz/chromium to dependencies
 */

import type { ScrapedItem } from './scraper';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkResult {
  id: string | number;
  number?: string;
  nameru?: string;
  nameRu?: string;
  name?: string;
  status?: string;
  statusNameRu?: string;
  amount?: number | string;
  totalAmount?: number | string;
  sumRu?: string;
  organizerNameRu?: string;
  customerNameRu?: string;
  methodNameRu?: string;
  acceptanceBeginDate?: string;
  acceptanceEndDate?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  [key: string]: unknown;
}

interface ApiPage {
  items?: SkResult[];
  content?: SkResult[];
  data?: SkResult[];
  results?: SkResult[];
  totalElements?: number;
  totalPages?: number;
  total?: number;
  last?: boolean;
}

// ─── Browser launcher ─────────────────────────────────────────────────────────

async function launchBrowser(): Promise<import('playwright-core').Browser> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pw = require('playwright-core') as typeof import('playwright-core');

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sparticuz = require('@sparticuz/chromium') as {
        args: string[];
        headless: boolean;
        executablePath: () => Promise<string>;
      };
      return pw.chromium.launch({
        args: sparticuz.args,
        executablePath: await sparticuz.executablePath(),
        headless: true,
      });
    } catch {
      throw new Error(
        'zakup.sk.kz требует браузер. На Vercel установите @sparticuz/chromium. ' +
        'Локально: npx playwright install chromium'
      );
    }
  }

  return pw.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function scrapeSkZakup(
  sourceUrl: string,
  name: string,
  keywords: string[]
): Promise<ScrapedItem[]> {
  const allItems: ScrapedItem[] = [];
  let browser: import('playwright-core').Browser | undefined;

  try {
    browser = await launchBrowser();

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'ru-RU',
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: { 'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8' },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(35000);

    for (const keyword of keywords) {
      console.log(`[zakup.sk.kz] Поиск: "${keyword}"`);
      try {
        const results = await searchByKeyword(page, keyword, sourceUrl, name);
        console.log(`[zakup.sk.kz] "${keyword}" → ${results.length} объявлений`);
        allItems.push(...results);
      } catch (err) {
        console.error(`[zakup.sk.kz] Ошибка при поиске "${keyword}":`, err);
      }
    }

    await context.close();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[zakup.sk.kz]', msg);
    if (allItems.length === 0) {
      allItems.push({
        title: `${name}: ошибка при сканировании`,
        description: msg,
        link: sourceUrl,
        matchedKeywords: [],
        sourceUrl,
        sourceName: name,
      });
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return allItems;
}

// ─── Search one keyword across all pages ─────────────────────────────────────

async function searchByKeyword(
  page: import('playwright-core').Page,
  keyword: string,
  sourceUrl: string,
  sourceName: string
): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];
  const maxPages = 10;

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    // Direct URL navigation — Angular router reads q/adst/page params from hash
    const searchUrl =
      `https://zakup.sk.kz/#/ext?` +
      `q=${encodeURIComponent(keyword)}` +
      `&adst=PUBLISHED&lst=PUBLISHED&page=${pageNum}`;

    console.log(`[zakup.sk.kz] Страница ${pageNum}: ${searchUrl}`);

    // Intercept API response while navigating
    const apiData = await navigateAndCapture(page, searchUrl);

    if (!apiData) {
      // API interception failed — fall back to DOM scraping
      const domItems = await collectFromDom(page, keyword, pageNum, sourceUrl, sourceName);
      items.push(...domItems);
      if (domItems.length === 0) break;
      continue;
    }

    const rows = apiData.items || apiData.content || apiData.data || apiData.results || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const item = buildItemFromApi(row, keyword, pageNum, sourceUrl, sourceName);
      items.push(item);
    }

    // Check if there are more pages
    const hasMore = checkHasMore(apiData, pageNum, rows.length);
    if (!hasMore) break;
  }

  return items;
}

// ─── Navigate and intercept API response ─────────────────────────────────────

async function navigateAndCapture(
  page: import('playwright-core').Page,
  url: string
): Promise<ApiPage | null> {
  // Patterns that match zakup.sk.kz's procurement search endpoint
  const apiPatterns = [
    '4dv3rts',
    'eprocsearch',
    '/advert',
    '/purchase',
    '/search',
    '/filter',
    '/tenders',
  ];

  let captured: ApiPage | null = null;

  // Set up response interceptor BEFORE navigating
  const responseHandler = async (response: import('playwright-core').Response) => {
    try {
      const responseUrl = response.url();
      const isApiCall = apiPatterns.some(p => responseUrl.includes(p));
      if (!isApiCall) return;

      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;

      const body = await response.json().catch(() => null);
      if (!body) return;

      // Accept if it looks like a list response
      const hasItems =
        Array.isArray(body?.items) || Array.isArray(body?.content) ||
        Array.isArray(body?.data) || Array.isArray(body?.results);

      if (hasItems) {
        console.log(`[zakup.sk.kz] Перехвачен API ответ: ${responseUrl}`);
        captured = body as ApiPage;
      }
    } catch { /* ignore */ }
  };

  page.on('response', responseHandler);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // Give Angular a bit more time to finish rendering
    await page.waitForTimeout(1500);
  } catch {
    await page.waitForTimeout(2000);
  } finally {
    page.off('response', responseHandler);
  }

  return captured;
}

// ─── Build ScrapedItem from API JSON row ──────────────────────────────────────

function buildItemFromApi(
  row: SkResult,
  keyword: string,
  pageNum: number,
  sourceUrl: string,
  sourceName: string
): ScrapedItem {
  const id = String(row.id || '');
  const title =
    String(row.nameru || row.nameRu || row.name || `Объявление №${id}`).trim();
  const number = String(row.number || id);
  const status = String(row.statusNameRu || row.status || '');
  const organizer = String(row.organizerNameRu || row.customerNameRu || '');
  const method = String(row.methodNameRu || '');
  const rawAmount = row.totalAmount ?? row.amount ?? '';
  const amount = rawAmount
    ? `${parseFloat(String(rawAmount)).toLocaleString('ru-RU')} ₸`
    : '';
  const start = String(row.acceptanceBeginDate || row.startDate || '').split('T')[0];
  const end = String(row.acceptanceEndDate || row.endDate || '').split('T')[0];

  // Canonical link to this announcement
  const q = encodeURIComponent(keyword);
  const link = id
    ? `https://zakup.sk.kz/#/ext(popup:item/${id}/advert)?tabs=advert&q=${q}&adst=PUBLISHED&lst=PUBLISHED&page=${pageNum}`
    : sourceUrl;

  const descParts = [
    number    && `Номер: ${number}`,
    organizer && `Заказчик: ${organizer}`,
    method    && `Метод: ${method}`,
    amount    && `Сумма: ${amount}`,
    start     && `Начало: ${start}`,
    end       && `Окончание: ${end}`,
    status    && `Статус: ${status}`,
  ].filter(Boolean);

  return {
    title: title.substring(0, 300),
    description: descParts.join(' | ').substring(0, 1000),
    link,
    matchedKeywords: [keyword],
    sourceUrl,
    sourceName,
  };
}

// ─── Check pagination ─────────────────────────────────────────────────────────

function checkHasMore(apiData: ApiPage, currentPage: number, rowCount: number): boolean {
  if (apiData.last === true) return false;
  if (apiData.totalPages !== undefined && currentPage >= apiData.totalPages) return false;
  if (rowCount === 0) return false;
  return true;
}

// ─── DOM fallback — when API interception fails ───────────────────────────────

async function collectFromDom(
  page: import('playwright-core').Page,
  keyword: string,
  pageNum: number,
  sourceUrl: string,
  sourceName: string
): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];

  // Wait a bit longer for Angular to render
  await page.waitForTimeout(3000);

  // Attempt to find the results table/list
  const rowSelectors = [
    'table tbody tr',
    '.purchase-list-item',
    '[class*="purchase"][class*="row"]',
    '[class*="result"][class*="item"]',
    '.purchases-list li',
    '.advert-item',
    '[class*="advert"][class*="row"]',
  ];

  let rows: import('playwright-core').Locator | null = null;
  for (const sel of rowSelectors) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count > 0) { rows = page.locator(sel); break; }
  }

  if (!rows) return items;

  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    try {
      const row = rows.nth(i);
      const text = await row.innerText().catch(() => '');
      if (!text.trim()) continue;

      // Try to find an anchor with a link
      const anchor = row.locator('a[href*="item"]').first();
      const href = await anchor.getAttribute('href').catch(() => null);
      const link = href
        ? (href.startsWith('http') ? href : `https://zakup.sk.kz/${href}`)
        : sourceUrl;

      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const title = lines[0] || `Объявление (стр. ${pageNum}, строка ${i + 1})`;

      items.push({
        title: title.substring(0, 300),
        description: lines.slice(1, 6).join(' | ').substring(0, 1000),
        link,
        matchedKeywords: [keyword],
        sourceUrl,
        sourceName,
      });
    } catch { /* skip broken row */ }
  }

  return items;
}
