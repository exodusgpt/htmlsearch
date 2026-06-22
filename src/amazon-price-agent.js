const DEFAULT_ZIPS = ['10001', '75201', '60601', '90041'];
const AMAZON_ORIGIN = 'https://www.amazon.com';
const AMAZON_FRESH_DEPARTMENT = 'amazonfresh';
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_LIMIT_PER_PRODUCT = 8;

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

async function attribute(locator, name) {
  try {
    return await locator.first().getAttribute(name, { timeout: 2500 });
  } catch {
    return null;
  }
}

async function clickFirst(page, selectors, timeout = 3500) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.click({ timeout });
      return true;
    } catch {
      // Keep trying Amazon's alternate layouts.
    }
  }

  return false;
}

async function dismissInterruptions(page) {
  await clickFirst(page, [
    'input[data-action-type="DISMISS"]',
    'button:has-text("Dismiss")',
    'button:has-text("Continue shopping")',
    'input[aria-labelledby*="continue"]',
    '#sp-cc-accept',
    'input[name="accept"]'
  ], 1200);
}

async function detectBlock(page) {
  const body = await textContent(page.locator('body'));
  if (/captcha|enter the characters you see|sorry, we just need to make sure/i.test(body)) {
    throw new Error('Amazon showed an automation/CAPTCHA check. Run headed mode or try again later.');
  }
}

async function setDeliveryZip(page, zip) {
  await page.goto(AMAZON_ORIGIN, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await dismissInterruptions(page);
  await detectBlock(page);

  const opened = await clickFirst(page, [
    '#nav-global-location-popover-link',
    '#glow-ingress-block',
    '[data-action-type="SELECT_LOCATION"]'
  ]);

  if (!opened) {
    throw new Error(`Could not open Amazon delivery location picker for ZIP ${zip}.`);
  }

  const zipInput = page.locator('#GLUXZipUpdateInput, input[aria-label*="ZIP"], input[placeholder*="ZIP"]').first();
  await zipInput.fill(zip, { timeout: DEFAULT_TIMEOUT_MS });

  await clickFirst(page, [
    '#GLUXZipUpdate',
    'input[aria-labelledby="GLUXZipUpdate-announce"]',
    'span:has-text("Apply") >> xpath=ancestor::span[contains(@class, "a-button")]//input',
    'button:has-text("Apply")'
  ], DEFAULT_TIMEOUT_MS);

  await page.waitForTimeout(1500);
  await clickFirst(page, [
    '#GLUXConfirmClose',
    'button:has-text("Done")',
    'input[aria-labelledby="GLUXConfirmClose-announce"]'
  ], 2500);
  await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  await dismissInterruptions(page);
}

function amazonFreshSearchUrl(query) {
  const url = new URL('/s', AMAZON_ORIGIN);
  url.searchParams.set('i', AMAZON_FRESH_DEPARTMENT);
  url.searchParams.set('k', query);
  return url.toString();
}

async function extractSearchResults(page, productName, zip, limit) {
  const url = amazonFreshSearchUrl(productName);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await dismissInterruptions(page);
  await detectBlock(page);
  await page.waitForSelector('[data-component-type="s-search-result"], [data-asin]', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});

  const cards = page.locator('[data-component-type="s-search-result"][data-asin]');
  const count = Math.min(await cards.count(), limit);
  const rows = [];

  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const sku = await attribute(card, 'data-asin');
    if (!sku) continue;

    const title = await textContent(card.locator('h2 span, h2 a span, [data-cy="title-recipe"] span'));
    const price = await textContent(card.locator('.a-price .a-offscreen, [data-a-color="price"] .a-offscreen, .a-color-price'));
    const productUrl = await attribute(card.locator('h2 a, a.a-link-normal.s-no-outline'), 'href');

    rows.push({
      zip,
      query: productName,
      sku,
      title,
      price: price || 'Not found',
      source: 'amazon-fresh-search',
      url: productUrl ? new URL(productUrl, AMAZON_ORIGIN).toString() : url
    });
  }

  return rows;
}

async function extractSku(page, sku, zip) {
  const url = amazonFreshSearchUrl(sku);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await dismissInterruptions(page);
  await detectBlock(page);
  await page.waitForSelector('[data-component-type="s-search-result"], [data-asin]', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});

  const card = page.locator(`[data-component-type="s-search-result"][data-asin="${sku}"]`).first();
  const found = await card.count().catch(() => 0);

  if (!found) {
    throw new Error(`SKU/ASIN ${sku} was not found in Amazon Fresh results for ZIP ${zip}.`);
  }

  const title = await textContent(card.locator('h2 span, h2 a span, [data-cy="title-recipe"] span'));
  const price = await textContent(card.locator('.a-price .a-offscreen, [data-a-color="price"] .a-offscreen, .a-color-price'));
  const productUrl = await attribute(card.locator('h2 a, a.a-link-normal.s-no-outline'), 'href');

  return {
    zip,
    query: sku,
    sku,
    title,
    price: price || 'Not found',
    source: 'amazon-fresh-sku-search',
    url: productUrl ? new URL(productUrl, AMAZON_ORIGIN).toString() : url
  };
}

export async function scanAmazonPrices({ chromium, ...input }) {
  const options = normalizeAmazonInput(input);
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args: ['--disable-blink-features=AutomationControlled']
  });
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
      try {
        await setDeliveryZip(page, zip);
      } catch (error) {
        errors.push({ zip, message: error.message });
        continue;
      }

      for (const product of options.products) {
        try {
          rows.push(...await extractSearchResults(page, product, zip, options.limitPerProduct));
        } catch (error) {
          errors.push({ zip, query: product, message: error.message });
        }
      }

      for (const sku of options.skus) {
        try {
          rows.push(await extractSku(page, sku, zip));
        } catch (error) {
          errors.push({ zip, query: sku, message: error.message });
        }
      }
    }
  } finally {
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
