/**
 * scraperBrowser.ts
 * Playwright-based browser scraper for SPAs protected by WAF/TLS fingerprinting.
 * Currently handles: zakup.sk.kz (Angular SPA — blocks all non-browser HTTP clients)
 *
 * Requirements:
 *  Local:  npm install playwright-core && npx playwright install chromium
 *  Vercel: add @sparticuz/chromium to dependencies
 */

import type { ScrapedItem } from './scraper';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkDetail {
  title: string;
  number: string;
  status: string;
  customer: string;
  method: string;
  amount: string;
  startDate: string;
  endDate: string;
}

// ─── Browser launcher ─────────────────────────────────────────────────────────

async function launchBrowser(): Promise<import('playwright-core').Browser> {
  // playwright-core must be installed (not bundled by Next.js webpack)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pw = require('playwright-core') as typeof import('playwright-core');

  // Serverless (Vercel / AWS Lambda) — try @sparticuz/chromium
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
        'zakup.sk.kz требует браузер. ' +
        'На Vercel установите @sparticuz/chromium. ' +
        'Локально запустите: npx playwright install chromium'
      );
    }
  }

  // Local development — use installed Playwright Chromium
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
    page.setDefaultTimeout(30000);

    // ── Step 1: navigate to search page ───────────────────────────────────
    console.log('[zakup.sk.kz] Открываю страницу...');
    await page.goto('https://zakup.sk.kz/#/ext', {
      waitUntil: 'networkidle',
      timeout: 40000,
    });
    await page.waitForTimeout(2000);

    // ── Step 2: select "Закупки" tab ───────────────────────────────────────
    await activatePurchasesTab(page);

    // ── Step 3: find search input ──────────────────────────────────────────
    const searchInput = await findSearchInput(page);
    if (!searchInput) {
      throw new Error('Поле поиска не найдено на zakup.sk.kz');
    }

    // ── Step 4: search for each keyword ───────────────────────────────────
    for (const keyword of keywords) {
      console.log(`[zakup.sk.kz] Поиск: "${keyword}"`);

      try {
        await performSearch(page, searchInput, keyword);
        const results = await collectResults(page, keyword, sourceUrl, name);
        console.log(`[zakup.sk.kz] "${keyword}" → ${results.length} объявлений`);
        allItems.push(...results);
        await page.waitForTimeout(800);
      } catch (err) {
        console.error(`[zakup.sk.kz] Ошибка при поиске "${keyword}":`, err);
        // Re-navigate to reset state
        try {
          await page.goto('https://zakup.sk.kz/#/ext', {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });
          await page.waitForTimeout(2000);
          await activatePurchasesTab(page);
        } catch { /* ignore recovery error */ }
      }
    }

    await context.close();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[zakup.sk.kz] Ошибка:', msg);
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

// ─── Activate "Закупки" tab ───────────────────────────────────────────────────

async function activatePurchasesTab(
  page: import('playwright-core').Page
): Promise<void> {
  const selectors = [
    'label:has-text("Закупки")',
    'button:has-text("Закупки")',
    '.nav-item:has-text("Закупки")',
    '[role="tab"]:has-text("Закупки")',
    'li:has-text("Закупки") a',
    'li:has-text("Закупки")',
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        await page.waitForTimeout(1000);
        return;
      }
    } catch { /* try next */ }
  }
  console.log('[zakup.sk.kz] Вкладка "Закупки" не найдена, используем текущий вид');
}

// ─── Find search input ────────────────────────────────────────────────────────

async function findSearchInput(
  page: import('playwright-core').Page
): Promise<import('playwright-core').Locator | null> {
  const selectors = [
    'input[placeholder*="поиска"]',
    'input[placeholder*="Слово для поиска"]',
    'input[placeholder*="ключевое"]',
    'input[placeholder*="номер закупки"]',
    'input[type="search"]',
    '.search-form input[type="text"]',
    'form input[type="text"]:first-of-type',
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        console.log(`[zakup.sk.kz] Поле поиска найдено: ${sel}`);
        return el;
      }
    } catch { /* try next */ }
  }
  return null;
}

// ─── Perform a keyword search ─────────────────────────────────────────────────

async function performSearch(
  page: import('playwright-core').Page,
  searchInput: import('playwright-core').Locator,
  keyword: string
): Promise<void> {
  // Clear and fill search input
  await searchInput.click({ clickCount: 3 });
  await searchInput.fill('');
  await searchInput.type(keyword, { delay: 60 });
  await page.waitForTimeout(400);

  // Click "Найти" button
  const btnSelectors = [
    'button:has-text("Найти")',
    '.btn:has-text("Найти")',
    '[type="submit"]:has-text("Найти")',
    'button[class*="search"]',
    'button[class*="find"]',
  ];

  let clicked = false;
  for (const sel of btnSelectors) {
    try {
      const btn = page.locator(sel).last();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        clicked = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (!clicked) {
    console.warn('[zakup.sk.kz] Кнопка "Найти" не найдена, отправляю Enter');
    await searchInput.press('Enter');
  }

  // Wait for results to load
  await page.waitForTimeout(3000);

  // Wait for spinner to disappear
  try {
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '.loading, .sk-spinner, .spinner, [class*="loader"], [class*="loading"]'
        ),
      { timeout: 12000 }
    );
  } catch { /* no spinner or timeout — proceed anyway */ }
}

// ─── Collect all results from the current search page ────────────────────────

async function collectResults(
  page: import('playwright-core').Page,
  keyword: string,
  sourceUrl: string,
  sourceName: string
): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];

  // Try several selectors for the result rows
  const rowSelectors = [
    'table tbody tr',
    'table tr:not(:first-child)',
    '.purchases-list .purchase-row',
    '.results-table tbody tr',
    '[class*="purchase"] [class*="row"]',
    '[class*="tender"] [class*="item"]',
    '.list-group .list-group-item',
    '[class*="result"] li',
  ];

  let usedSelector = '';
  let rowCount = 0;

  for (const sel of rowSelectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        usedSelector = sel;
        rowCount = count;
        console.log(`[zakup.sk.kz] Результаты (${sel}): ${count} строк`);
        break;
      }
    } catch { /* try next */ }
  }

  if (rowCount === 0) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const noResults =
      /ничего не найдено|нет результатов|не найдено|нет данных/i.test(bodyText);
    if (!noResults) {
      console.log('[zakup.sk.kz] Не удалось определить список результатов');
    }
    return items;
  }

  // Process each row: click → extract detail → close
  for (let i = 0; i < rowCount; i++) {
    try {
      // Always re-query to avoid stale references
      const row = page.locator(usedSelector).nth(i);
      if (!(await row.isVisible({ timeout: 3000 }).catch(() => false))) continue;

      await row.click();
      await page.waitForTimeout(2000);

      // Wait for detail panel
      await waitForDetail(page);

      // Extract data
      const detail = await extractDetail(page);
      const link = await getDirectLink(page, sourceUrl);

      items.push({
        title: detail.title || `Объявление №${detail.number || i + 1}`,
        description: buildDescription(detail),
        link,
        matchedKeywords: [keyword],
        sourceUrl,
        sourceName,
      });

      // Close detail
      await closeDetail(page);
      await page.waitForTimeout(800);

    } catch (err) {
      console.error(`[zakup.sk.kz] Ошибка строки ${i}:`, err);
      await closeDetail(page).catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  return items;
}

// ─── Wait for detail panel to open ───────────────────────────────────────────

async function waitForDetail(page: import('playwright-core').Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const sel = '.modal, .drawer, .side-panel, dialog, [class*="detail-view"], [class*="view-detail"]';
        const el = document.querySelector(sel) as HTMLElement | null;
        return el !== null && el.offsetParent !== null;
      },
      { timeout: 8000 }
    );
  } catch {
    await page.waitForTimeout(2000);
  }
}

// ─── Extract detail data ──────────────────────────────────────────────────────

async function extractDetail(
  page: import('playwright-core').Page
): Promise<SkDetail> {
  return page.evaluate((): SkDetail => {
    // Get the panel text
    const panel =
      document.querySelector<HTMLElement>(
        '.modal, .drawer, .side-panel, dialog, [class*="detail-view"]'
      ) || document.body;

    const text = panel.innerText || '';

    // Number
    const numMatch = text.match(/№\s*(\d+)/);
    const number = numMatch ? numMatch[1] : '';

    // Title — find the biggest heading inside the panel
    let title = '';
    const headings = panel.querySelectorAll<HTMLElement>('h1, h2, h3, h4');
    for (const h of Array.from(headings)) {
      const t = h.innerText.trim();
      if (t.length > 5) { title = t; break; }
    }
    if (!title) {
      // Try title/subject elements
      const titleEl = panel.querySelector<HTMLElement>(
        '[class*="title"], [class*="subject"], [class*="name"]'
      );
      if (titleEl) title = titleEl.innerText.trim();
    }

    // Status badge
    const badge = panel.querySelector<HTMLElement>(
      '[class*="badge"], [class*="status"], [class*="label"]'
    );
    const status = badge ? badge.innerText.trim() : '';

    // Key-value extraction from text
    const extract = (patterns: RegExp[]): string => {
      for (const re of patterns) {
        const m = text.match(re);
        if (m && m[1]) return m[1].trim();
      }
      return '';
    };

    const customer = extract([
      /(?:ЗАКАЗЧИК|Заказчик)[:\s]*\n?([^\n]+)/,
      /(?:Организатор|ОРГАНИЗАТОР)[:\s]*\n?([^\n]+)/,
    ]);

    const method = extract([
      /(?:МЕТОД ЗАКУПКИ|Метод закупки|Способ)[:\s]*\n?([^\n]+)/i,
    ]);

    const amount = extract([
      /(?:ОБЩАЯ СУММА ЛОТОВ|Сумма лотов|СУММА)[:\s]*\n?([\d\s,.]+[₸тгTT]+[^\n]*)/i,
      /(?:ОБЩАЯ СУММА)[:\s]*\n?([^\n]+)/i,
    ]);

    const startDate = extract([
      /(?:НАЧАЛО ПРИЕМА ЗАЯВОК|Начало приема)[:\s]*\n?([0-9.]+\s+[0-9:]+)/i,
    ]);

    const endDate = extract([
      /(?:КОНЕЦ ПРИЕМА ЗАЯВОК|Конец приема|Окончание)[:\s]*\n?([0-9.]+\s+[0-9:]+)/i,
    ]);

    return { title, number, status, customer, method, amount, startDate, endDate };
  });
}

// ─── Build description string ─────────────────────────────────────────────────

function buildDescription(d: SkDetail): string {
  return [
    d.number   && `Номер: ${d.number}`,
    d.customer && `Заказчик: ${d.customer}`,
    d.method   && `Метод: ${d.method}`,
    d.amount   && `Сумма: ${d.amount}`,
    d.startDate && `Начало: ${d.startDate}`,
    d.endDate  && `Окончание: ${d.endDate}`,
    d.status   && `Статус: ${d.status}`,
  ].filter(Boolean).join(' | ');
}

// ─── Get direct link ──────────────────────────────────────────────────────────

async function getDirectLink(
  page: import('playwright-core').Page,
  fallback: string
): Promise<string> {
  const selectors = [
    'a:has-text("Открыть в новой вкладке")',
    'a[target="_blank"]',
    'a[href*="purchase"]',
    'a[href*="tender"]',
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        const href = await el.getAttribute('href');
        if (href && href.length > 5) {
          return href.startsWith('http')
            ? href
            : new URL(href, 'https://zakup.sk.kz').href;
        }
      }
    } catch { /* try next */ }
  }

  const url = page.url();
  return url && url !== 'about:blank' ? url : fallback;
}

// ─── Close detail panel ───────────────────────────────────────────────────────

async function closeDetail(page: import('playwright-core').Page): Promise<void> {
  const selectors = [
    'button[aria-label*="lose"]',
    'button[aria-label*="акрыть"]',
    '.modal-header .close',
    '.btn-close',
    '[class*="close-btn"]',
    '[class*="closeBtn"]',
    'button:has-text("✕")',
    'button:has-text("×")',
    'button:has-text("✖")',
    'mat-icon:has-text("close")',
    '.mat-dialog-close',
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        await el.click();
        await page.waitForTimeout(600);
        return;
      }
    } catch { /* try next */ }
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}
