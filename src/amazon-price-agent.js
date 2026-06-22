const DEFAULT_ZIPS = ['10001', '75201', '60601', '90041'];
const AMAZON_ORIGIN = 'https://www.amazon.com';
const AMAZON_FRESH_DEPARTMENT = 'amazonfresh';
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_LIMIT_PER_PRODUCT = 8;
const DEFAULT_JOB_TIMEOUT_MS = 8 * 60 * 1000;

function cleanLines(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeZip(zip) {
  const value = String(zip || '').trim();
  if (!/^\d{5}$/.test(value)) {
    throw new Error(`Invalid ZIP code: ${value || '(blank)'}`);
  }

  return value;
}

export function normalizeAmazonInput(input = {}) {
  const zipCodes = (cleanLines(input.zipCodes).length ? cleanLines(input.zipCodes) : DEFAULT_ZIPS).map(normalizeZip);
  const products = cleanLines(input.products || input.productName || input.product);
  const skus = cleanLines(input.skus || input.sku || input.asins).map((sku) => sku.toUpperCase());
  const limitPerProduct = Math.max(1, Math.min(Number(input.limitPerProduct || DEFAULT_LIMIT_PER_PRODUCT), 20));

  if (!products.length && !skus.length) {
    throw new Error('Enter at least one product name or SKU/ASIN.');
  }

  return {
    zipCodes: [...new Set(zipCodes)],
    products: [...new Set(products)],
    skus: [...new Set(skus)],
    limitPerProduct
  };
}

async function textContent(locator) {
  try {
    const value = await locator.first().textContent({ timeout: 2500 });
    return value?.replace(/\s+/g, ' ').trim() || '';
  } catch {
    return '';
  }
}

async function clickFirst(page, selectors, timeout = 3500) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.click({ timeout });
      return true;
    } catch {
      // Keep trying Amazon's alternate layouts.
    }
  }

  return false;
}

async function clickByText(page, labels, timeout = 3500) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const clicked = await page.evaluate((targetLabels) => {
      const normalize = (value) => value?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
      const labelsLower = targetLabels.map((label) => label.toLowerCase());
      const candidates = [...document.querySelectorAll('button, input, a, span')];

      for (const element of candidates) {
        const text = normalize(element.innerText || element.value || element.getAttribute('aria-label'));
        if (!text || !labelsLower.some((label) => text.includes(label))) continue;

        element.click();
        return true;
      }

      return false;
    }, labels).catch(() => false);

    if (clicked) return true;
    await page.waitForTimeout(250);
  }

  return false;
}

async function dismissInterruptions(page) {
  await clickFirst(page, [
    'input[data-action-type="DISMISS"]',
    'input[aria-labelledby*="continue"]',
    '#sp-cc-accept',
    'input[name="accept"]'
  ], 1200);
  await clickByText(page, ['Dismiss', 'Continue shopping'], 1200);
}

async function detectBlock(page) {
  const body = await textContent(page.locator('body'));
  if (/captcha|enter the characters you see|sorry, we just need to make sure|robot check|automated access/i.test(body)) {
    throw new Error('Amazon showed an automation/CAPTCHA check. Run headed mode or try again later.');
  }
}

async function pageDiagnostic(page) {
  try {
    return await page.evaluate(() => {
      const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
      return {
        title: document.title,
        url: location.href,
        text: text.slice(0, 220)
      };
    });
  } catch {
    return { title: '', url: page.url(), text: '' };
  }
}

async function setDeliveryZipViaAjax(page, zip) {
  const result = await page.evaluate(async (targetZip) => {
    const body = new URLSearchParams({
      locationType: 'LOCATION_INPUT',
      zipCode: targetZip,
      storeContext: 'generic',
      deviceType: 'web',
      pageType: 'Gateway',
      actionSource: 'glow'
    });

    try {
      const response = await fetch('/gp/delivery/ajax/address-change.html', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest'
        },
        body: body.toString()
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        text: text.replace(/\s+/g, ' ').slice(0, 500)
      };
    } catch (error) {
      return { ok: false, status: 0, text: error.message };
    }
  }, zip);

  if (!result.ok) {
    throw new Error(`Amazon ZIP AJAX update failed with status ${result.status}: ${result.text}`);
  }

  if (/captcha|robot check|automated access|enter the characters/i.test(result.text)) {
    throw new Error('Amazon returned a CAPTCHA/robot-check response while setting the ZIP.');
  }

  await page.waitForTimeout(1000);
}

async function setDeliveryZip(page, zip, onProgress) {
  await onProgress?.(`Opening Amazon for ZIP ${zip}.`);
  await page.goto(AMAZON_ORIGIN, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await dismissInterruptions(page);
  await detectBlock(page);

  try {
    await onProgress?.(`Setting ZIP ${zip} through Amazon location request.`);
    await setDeliveryZipViaAjax(page, zip);
    return;
  } catch {
    // Fall back to the visible picker; Amazon changes this flow often.
  }

  await onProgress?.(`Opening Amazon location picker for ZIP ${zip}.`);
  const opened = await clickFirst(page, [
    '#nav-global-location-popover-link',
    '#glow-ingress-block',
    '#glow-ingress-line2',
    '[data-action-type="SELECT_LOCATION"]'
  ]) || await clickByText(page, ['Deliver to'], 3500);

  if (!opened) {
    const diagnostic = await pageDiagnostic(page);
    throw new Error(`Could not open Amazon delivery location picker for ZIP ${zip}. Page "${diagnostic.title}" at ${diagnostic.url}. Text: ${diagnostic.text}`);
  }

  const zipInput = page.locator('#GLUXZipUpdateInput, input[aria-label*="ZIP"], input[placeholder*="ZIP"]').first();
  await zipInput.fill(zip, { timeout: DEFAULT_TIMEOUT_MS });

  await clickFirst(page, [
    '#GLUXZipUpdate',
    'input[aria-labelledby="GLUXZipUpdate-announce"]',
    'input[name="glowDoneButton"]',
    'input[type="submit"][aria-label*="Apply"]'
  ], DEFAULT_TIMEOUT_MS) || await clickByText(page, ['Apply'], DEFAULT_TIMEOUT_MS);

  await page.waitForTimeout(1500);
  await clickFirst(page, [
    '#GLUXConfirmClose',
    'input[aria-labelledby="GLUXConfirmClose-announce"]'
  ], 2500);
  await clickByText(page, ['Done'], 2500);
  await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  await dismissInterruptions(page);
}

function amazonFreshSearchUrl(query) {
  const url = new URL('/s', AMAZON_ORIGIN);
  url.searchParams.set('i', AMAZON_FRESH_DEPARTMENT);
  url.searchParams.set('k', query);
  return url.toString();
}

function queryVariants(query) {
  const variants = [query];
  const normalized = query.replace(/\s+/g, ' ').trim();

  if (/haagen\s+daaz/i.test(normalized)) {
    variants.push(normalized.replace(/haagen\s+daaz/ig, 'Haagen Dazs'));
    variants.push(normalized.replace(/haagen\s+daaz/ig, 'Häagen-Dazs'));
  }

  if (/haagen\s+dazs/i.test(normalized)) {
    variants.push(normalized.replace(/haagen\s+dazs/ig, 'Häagen-Dazs'));
  }

  return [...new Set(variants)];
}

async function extractResultCards(page, query, zip, source, limit) {
  return page.evaluate(({ limit: resultLimit, query: productQuery, source: resultSource, zip: resultZip }) => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || '';
    const absolutize = (href) => {
      try {
        return href ? new URL(href, location.origin).toString() : location.href;
      } catch {
        return location.href;
      }
    };
    const descendants = (root) => [...root.getElementsByTagName('*')];
    const hasClass = (element, className) => element.classList?.contains(className);
    const attr = (element, name) => element.getAttribute?.(name) || '';
    const includesAttr = (element, name, value) => attr(element, name).includes(value);
    const firstElement = (root, predicate) => descendants(root).find(predicate) || null;
    const nearestLink = (root) => firstElement(root, (element) => {
      if (element.tagName !== 'A') return false;
      const href = attr(element, 'href');
      return href.includes('/dp/') || href.includes('/gp/product/') || hasClass(element, 'a-link-normal');
    });

    return [...document.getElementsByTagName('*')]
      .filter((element) => element.hasAttribute?.('data-asin'))
      .map((card) => {
        const sku = card.getAttribute('data-asin')?.trim();
        if (!sku) return null;

        const titleEl = firstElement(card, (element) => {
          const aria = attr(element, 'aria-label');
          return element.tagName === 'H2' || includesAttr(element, 'data-cy', 'title') || (element.tagName === 'A' && Boolean(aria));
        });
        const linkEl = nearestLink(card);
        const priceEl = firstElement(card, (element) => {
          const className = attr(element, 'class').toLowerCase();
          return hasClass(element, 'a-offscreen') || hasClass(element, 'a-color-price') || className.includes('price');
        });
        const title = clean(titleEl?.textContent) || clean(titleEl?.getAttribute?.('aria-label')) || clean(linkEl?.textContent);
        const price = clean(priceEl?.textContent);

        if (!title && !price) return null;

        return {
          zip: resultZip,
          query: productQuery,
          sku,
          title: title || sku,
          price: price || 'Not found',
          source: resultSource,
          url: absolutize(linkEl?.getAttribute('href'))
        };
      })
      .filter(Boolean)
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.sku === row.sku) === index)
      .slice(0, resultLimit);
  }, { limit, query, source, zip });
}

async function extractSearchResultsForQuery(page, productName, zip, limit) {
  await page.waitForTimeout(500);
  const url = amazonFreshSearchUrl(productName);
  const diagnosticBefore = await pageDiagnostic(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await dismissInterruptions(page);
  await detectBlock(page);
  await page.waitForTimeout(1500);

  const rows = await extractResultCards(page, productName, zip, 'amazon-fresh-search', limit);

  if (!rows.length) {
    const diagnostic = await pageDiagnostic(page);
    throw new Error(`No Amazon Fresh result cards for "${productName}" in ZIP ${zip}. Before search: "${diagnosticBefore.title}". Search page: "${diagnostic.title}" at ${diagnostic.url}. Text: ${diagnostic.text}`);
  }

  return rows;
}

async function extractSearchResults(page, productName, zip, limit) {
  const failures = [];

  for (const variant of queryVariants(productName)) {
    try {
      return await extractSearchResultsForQuery(page, variant, zip, limit);
    } catch (error) {
      failures.push(`${variant}: ${error.message}`);
    }
  }

  throw new Error(`No Amazon Fresh result cards after trying query variants. ${failures.join(' | ')}`);
}

async function extractSku(page, sku, zip) {
  const url = amazonFreshSearchUrl(sku);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await dismissInterruptions(page);
  await detectBlock(page);
  await page.waitForTimeout(1500);

  const rows = await extractResultCards(page, sku, zip, 'amazon-fresh-sku-search', 20);
  const row = rows.find((result) => result.sku === sku);

  if (!row) {
    throw new Error(`SKU/ASIN ${sku} was not found in Amazon Fresh results for ZIP ${zip}.`);
  }

  return row;
}

export async function scanAmazonPrices({ chromium, ...input }) {
  const options = normalizeAmazonInput(input);
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : null;
  const timeoutMs = Number(input.timeoutMs || process.env.AMAZON_JOB_TIMEOUT_MS || DEFAULT_JOB_TIMEOUT_MS);
  let timedOut = false;

  await onProgress?.('Launching Chromium.');
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args: ['--disable-blink-features=AutomationControlled']
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    browser.close().catch(() => {});
  }, timeoutMs);
  timeout.unref?.();

  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

  const rows = [];
  const errors = [];

  try {
    for (const zip of options.zipCodes) {
      if (timedOut) throw new Error(`Amazon Fresh job timed out after ${Math.round(timeoutMs / 1000)} seconds.`);

      try {
        await setDeliveryZip(page, zip, onProgress);
      } catch (error) {
        errors.push({ zip, message: error.message });
        continue;
      }

      for (const product of options.products) {
        if (timedOut) throw new Error(`Amazon Fresh job timed out after ${Math.round(timeoutMs / 1000)} seconds.`);

        try {
          await onProgress?.(`Searching Amazon Fresh for "${product}" in ZIP ${zip}.`);
          rows.push(...await extractSearchResults(page, product, zip, options.limitPerProduct));
        } catch (error) {
          errors.push({ zip, query: product, message: error.message });
        }
      }

      for (const sku of options.skus) {
        if (timedOut) throw new Error(`Amazon Fresh job timed out after ${Math.round(timeoutMs / 1000)} seconds.`);

        try {
          await onProgress?.(`Looking up Fresh ASIN ${sku} in ZIP ${zip}.`);
          rows.push(await extractSku(page, sku, zip));
        } catch (error) {
          errors.push({ zip, query: sku, message: error.message });
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    await browser.close();
  }

  return {
    category: 'Amazon Fresh',
    productCount: options.products.length,
    skuCount: options.skus.length,
    zipCodes: options.zipCodes,
    rows,
    errors
  };
}
