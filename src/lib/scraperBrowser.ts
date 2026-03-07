/**
 * scraperBrowser.ts
 * Playwright-based browser scraper for zakup.sk.kz
 *
 * Strategy (UI interaction + DOM scraping):
 *  1. Open https://zakup.sk.kz/#/ext
 *  2. Ensure "Закупки" tab is active
 *  3. For each keyword:
 *     a. Type keyword into search input
 *     b. Click "Найти" button
 *     c. Wait for results (.m-found-item) or "ничего не найдено"
 *     d. Scrape result cards from DOM:
 *        - .m-found-item__num → announcement number (e.g. "№ 1198150")
 *        - h3.m-found-item__title → title
 *        - .m-found-item__layout → method (первый дочерний)
 *        - .m-found-item__col--sum → cost
 *     e. Build direct link: /#/ext(popup:item/{number}/advert)?tabs=advert&q=...
 *     f. Handle pagination via page=N in URL
 *  4. Only collect items where keyword appears in the announcement text
 *
 * Requirements:
 *  Local:  npm install playwright-core && npx playwright install chromium
 *  Vercel: add @sparticuz/chromium to dependencies
 */

import type { ScrapedItem } from './scraper';

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
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'ru-RU',
      viewport: { width: 1400, height: 900 },
      extraHTTPHeaders: { 'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8' },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(40000);

    // 1. Navigate to the portal (use domcontentloaded — SPA never fully idles)
    console.log('[zakup.sk.kz] Открываю портал...');
    await page.goto('https://zakup.sk.kz/#/ext', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    // Wait for Angular to bootstrap and render the search form
    await page.waitForSelector('input[placeholder*="Слово для поиска"], input[placeholder*="поиска"]', {
      timeout: 20000,
    });
    await page.waitForTimeout(2000);

    // 2. Ensure "Закупки" tab is active (click it)
    try {
      const zakupkiTab = page.locator('text=Закупки').first();
      if (await zakupkiTab.isVisible()) {
        await zakupkiTab.click();
        await page.waitForTimeout(1000);
        console.log('[zakup.sk.kz] Выбрана вкладка "Закупки"');
      }
    } catch {
      console.log('[zakup.sk.kz] Вкладка "Закупки" уже активна или не найдена');
    }

    // 3. Close any chatbot/popup if present
    try {
      const closeBtn = page.locator('[class*="chat"] button[class*="close"], [class*="skai"] button');
      if (await closeBtn.first().isVisible({ timeout: 2000 })) {
        await closeBtn.first().click();
        await page.waitForTimeout(500);
      }
    } catch { /* no chatbot */ }

    // 4. For each keyword — type, search, collect
    const seen = new Set<string>();

    for (const keyword of keywords) {
      console.log(`[zakup.sk.kz] ──── Поиск: "${keyword}" ────`);
      try {
        const results = await searchByKeyword(page, keyword, sourceUrl, name, seen);
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
  sourceName: string,
  seen: Set<string>
): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];
  const maxPages = 10;

  // ── Page 1: type keyword into search input and click "Найти" ──
  console.log(`[zakup.sk.kz] Ввожу "${keyword}" в поиск...`);

  // Find the search input by placeholder
  const searchInput = page.locator('input[placeholder*="Слово для поиска"], input[placeholder*="поиска"]').first();
  await searchInput.waitFor({ state: 'visible', timeout: 10000 });

  // Clear existing text and type keyword
  await searchInput.click({ clickCount: 3 }); // select all
  await page.waitForTimeout(200);
  await searchInput.fill(keyword);
  await page.waitForTimeout(300);

  // Click "Найти" button
  const findBtn = page.locator('button:has-text("Найти")').first();
  await findBtn.waitFor({ state: 'visible', timeout: 5000 });
  await findBtn.click();
  console.log(`[zakup.sk.kz] Нажата кнопка "Найти"`);

  // Wait for results to load after clicking
  const gotResults = await waitForResults(page);

  if (!gotResults) {
    console.log(`[zakup.sk.kz] "${keyword}": нет результатов`);
    return items;
  }

  // Collect page 1 results
  const page1Items = await collectResultCards(page, keyword, 1, sourceUrl, sourceName, seen);
  items.push(...page1Items);

  if (page1Items.length === 0) return items;

  // ── Pages 2+: use URL navigation for pagination ──
  for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
    const hasNextPage = await checkNextPage(page, pageNum - 1);
    if (!hasNextPage) break;

    // Navigate to next page via hash URL change
    const nextUrl =
      `https://zakup.sk.kz/#/ext?tabs=advert` +
      `&q=${encodeURIComponent(keyword)}` +
      `&adst=PUBLISHED&lst=PUBLISHED&page=${pageNum}`;

    console.log(`[zakup.sk.kz] Страница ${pageNum}...`);

    // Use evaluate to change the hash (avoids full page reload)
    await page.evaluate((url) => {
      window.location.hash = url.split('#')[1];
    }, nextUrl);

    await page.waitForTimeout(3000);

    const gotMore = await waitForResults(page);
    if (!gotMore) break;

    const pageItems = await collectResultCards(page, keyword, pageNum, sourceUrl, sourceName, seen);
    items.push(...pageItems);

    if (pageItems.length === 0) break;
  }

  return items;
}

// ─── Wait for results to load ─────────────────────────────────────────────────

async function waitForResults(page: import('playwright-core').Page): Promise<boolean> {
  try {
    // Wait up to 15 seconds for either results or "nothing found"
    await Promise.race([
      page.waitForSelector('.m-found-item', { timeout: 15000 }),
      page.waitForSelector('text=По вашему запросу ничего не найдено', { timeout: 15000 }),
      page.waitForSelector('text=ничего не найдено', { timeout: 15000 }),
    ]);

    // Give Angular a moment to fully render
    await page.waitForTimeout(1500);

    // Check if we have actual result items
    const itemCount = await page.locator('.m-found-item').count();
    return itemCount > 0;
  } catch {
    // Timeout — try to check if there are any items anyway
    await page.waitForTimeout(2000);
    const itemCount = await page.locator('.m-found-item').count();
    return itemCount > 0;
  }
}

// ─── Collect result cards from DOM ────────────────────────────────────────────

async function collectResultCards(
  page: import('playwright-core').Page,
  keyword: string,
  pageNum: number,
  sourceUrl: string,
  sourceName: string,
  seen: Set<string>
): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];

  const cards = page.locator('.m-found-item');
  const count = await cards.count();

  console.log(`[zakup.sk.kz] Найдено карточек на странице: ${count}`);

  for (let i = 0; i < count; i++) {
    try {
      const card = cards.nth(i);

      // Extract announcement number: .m-found-item__num → "№ 1198150"
      const numText = await card.locator('.m-found-item__num').innerText().catch(() => '');
      const number = numText.replace(/[^0-9]/g, '').trim();

      // Skip duplicates
      if (!number || seen.has(number)) continue;

      // Extract title: h3.m-found-item__title
      const title = await card.locator('h3.m-found-item__title').innerText().catch(() => '');

      // Extract method: first .m-found-item__layout that doesn't contain cost/days
      const layouts = card.locator('.m-found-item__layout');
      const layoutCount = await layouts.count();
      let method = '';
      for (let j = 0; j < layoutCount; j++) {
        const text = await layouts.nth(j).innerText().catch(() => '');
        if (text && !text.includes('Осталось') && !text.includes('Стоимость')) {
          method = text.trim();
          break;
        }
      }

      // Extract cost: .m-found-item__col--sum
      const cost = await card.locator('.m-found-item__col--sum').innerText().catch(() => '');

      // Extract remaining days: .m-found-item__col (without --sum)
      const daysEl = card.locator('.m-found-item__col').first();
      const daysText = await daysEl.innerText().catch(() => '');
      const days = daysText.includes('Осталось') ? daysText.trim() : '';

      // The site's search already filters by keyword (we typed it and clicked "Найти").
      // The card text is limited — the keyword may be in the full announcement description,
      // lots, or specs, which aren't visible in the card preview. Trust the site's search.
      seen.add(number);

      // Build direct link to this announcement
      const q = encodeURIComponent(keyword);
      const link = `https://zakup.sk.kz/#/ext(popup:item/${number}/advert)?tabs=advert&q=${q}&adst=PUBLISHED&lst=PUBLISHED&page=${pageNum}`;

      // Build description
      const descParts = [
        number && `№ ${number}`,
        method && `Метод: ${method}`,
        cost   && cost,
        days   && days,
      ].filter(Boolean);

      items.push({
        title: title.substring(0, 300) || `Объявление №${number}`,
        description: descParts.join(' | ').substring(0, 1000),
        link,
        matchedKeywords: [keyword],
        sourceUrl,
        sourceName,
      });

      console.log(`[zakup.sk.kz] ✓ №${number}: ${title.substring(0, 60)}`);

    } catch (err) {
      console.error(`[zakup.sk.kz] Ошибка при обработке карточки ${i}:`, err);
    }
  }

  return items;
}

// ─── Check if there is a next page ────────────────────────────────────────────

async function checkNextPage(
  page: import('playwright-core').Page,
  currentPage: number
): Promise<boolean> {
  try {
    // Check the item count text: "Показано 1 - 10 из 16 элементов."
    const countText = await page.locator('.jhi-item-count').innerText().catch(() => '');
    if (countText) {
      const match = countText.match(/(\d+)\s*-\s*(\d+)\s*из\s*(\d+)/);
      if (match) {
        const end = parseInt(match[2], 10);
        const total = parseInt(match[3], 10);
        console.log(`[zakup.sk.kz] Показано до ${end} из ${total}`);
        return end < total;
      }
    }

    // Fallback: check if next page button exists and is not disabled
    const nextBtn = page.locator('.page-item').filter({ hasText: '»' }).first();
    if (await nextBtn.isVisible()) {
      const isDisabled = await nextBtn.evaluate(
        el => el.classList.contains('disabled')
      ).catch(() => true);
      return !isDisabled;
    }

    return false;
  } catch {
    return false;
  }
}
