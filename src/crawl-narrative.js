import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const START_URL = 'https://www.narrative.io/';
const HOST = 'www.narrative.io';
const OUTPUT_DIR = path.resolve('output');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 500);
const HEADLESS = process.env.HEADLESS !== 'false';

const SKIP_EXTENSIONS = /\.(?:pdf|zip|png|jpe?g|gif|webp|svg|mp4|mov|avi|mp3|wav|css|js|json|xml|ico)$/i;
const SKIP_PATHS = [
  '/cdn-cgi/',
  '/wp-json/',
  '/feed',
  '/author/',
  '/tag/',
  '/category/'
];

function normalizeUrl(rawUrl, baseUrl = START_URL) {
  try {
    const url = new URL(rawUrl, baseUrl);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    if (url.hostname === 'narrative.io') {
      url.hostname = HOST;
    }

    url.protocol = 'https:';
    url.hash = '';
    url.searchParams.delete('hsCtaTracking');

    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return null;
  }
}

function shouldVisit(urlString) {
  const url = new URL(urlString);

  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.hostname !== HOST) return false;
  if (SKIP_EXTENSIONS.test(url.pathname)) return false;
  if (SKIP_PATHS.some((prefix) => url.pathname.startsWith(prefix))) return false;
  if (url.searchParams.has('s')) return false;

  return true;
}

function slugFor(urlString) {
  const url = new URL(urlString);
  const readable = `${url.pathname}${url.search}`
    .replace(/^\/$/, 'home')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const hash = crypto.createHash('sha1').update(urlString).digest('hex').slice(0, 8);
  return `${readable || 'page'}-${hash}`;
}

function compactText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unique(values) {
  return [...new Set(values.map((value) => compactText(value)).filter(Boolean))];
}

async function autoExplorePage(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const originalUrl = normalizeUrl(page.url());

  const menuSelectors = [
    'button[aria-expanded]',
    'button[aria-haspopup]',
    '[role="button"][aria-expanded]',
    'summary',
    'button:has-text("Solutions")',
    'button:has-text("Products")',
    'button:has-text("Resources")',
    'button:has-text("Company")'
  ];

  for (const selector of menuSelectors) {
    const elements = await page.locator(selector).all().catch(() => []);
    for (const element of elements.slice(0, 20)) {
      if (!await element.isVisible().catch(() => false)) continue;
      await element.click({ timeout: 1200 }).catch(() => {});
      await page.waitForTimeout(250);
      if (normalizeUrl(page.url()) !== originalUrl) {
        await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }
  }

  const tabLike = page.locator('[role="tab"], [data-tab], .tab:not(a), .tabs button');
  const count = Math.min(await tabLike.count().catch(() => 0), 80);

  for (let index = 0; index < count; index += 1) {
    const element = tabLike.nth(index);
    const label = compactText(await element.innerText({ timeout: 500 }).catch(() => ''));
    if (!label || label.length > 80) continue;
    if (/(accept|reject|subscribe|submit|log in|login|book|demo|contact|talk|sales|download|start|request|close)/i.test(label)) continue;
    if (await element.evaluate((node) => Boolean(node.closest('header, nav, footer'))).catch(() => false)) continue;

    const before = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    await element.click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(350);
    if (normalizeUrl(page.url()) !== originalUrl) {
      await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      continue;
    }
    const after = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');

    if (after.length > before.length) {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}

async function extractPage(page, url) {
  return await page.evaluate(({ url }) => {
    const clean = (value) => (value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const textFrom = (selector) => [...document.querySelectorAll(selector)]
      .map((node) => clean(node.innerText || node.textContent || ''))
      .filter(Boolean);

    const meta = (name) => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content || '';

    const links = [...document.querySelectorAll('a[href]')]
      .map((anchor) => ({
        text: clean(anchor.innerText || anchor.getAttribute('aria-label') || anchor.title || ''),
        href: anchor.href
      }))
      .filter((link) => link.href);

    const images = [...document.querySelectorAll('img')]
      .map((img) => ({
        alt: clean(img.alt),
        src: img.currentSrc || img.src
      }))
      .filter((img) => img.alt || img.src);

    const removable = [...document.querySelectorAll('body *')].filter((node) => {
      const style = window.getComputedStyle(node);
      const text = clean(node.innerText || '');
      const fixedOrSticky = style.position === 'fixed' || style.position === 'sticky';
      return fixedOrSticky && /rosetta|chat with|assistant|schedule a call/i.test(text);
    });
    removable.forEach((node) => node.remove());

    const root = document.querySelector('main') || document.body;
    const mainText = clean(root?.innerText || '');

    return {
      url,
      title: clean(document.title),
      description: clean(meta('description') || meta('og:description')),
      h1: textFrom('h1'),
      h2: textFrom('h2'),
      h3: textFrom('h3'),
      navigation: textFrom('nav a, header a, footer a'),
      buttons: textFrom('button, [role="button"]'),
      links,
      images,
      mainText,
      bodyText: clean(document.body?.innerText || '')
    };
  }, { url });
}

function summarizePage(page) {
  const headings = unique([...page.h1, ...page.h2, ...page.h3]);
  const callsToAction = unique(page.buttons)
    .filter((button) => /demo|contact|start|learn|explore|talk|download|request|get/i.test(button));
  const sourceText = page.mainText || page.bodyText || '';
  const bodyLines = unique(sourceText.split('\n'))
    .filter((line) => line.length > 20)
    .filter((line) => !/^(Explore Narrative|Book A Demo|We would love to hear from you|Chat with us now|Rosetta is thinking)/i.test(line))
    .filter((line) => !/Hi! I.m Rosetta, your big data assistant/i.test(line))
    .slice(0, 45);

  return [
    `## ${page.title || page.url}`,
    '',
    `URL: ${page.url}`,
    page.description ? `Description: ${page.description}` : '',
    '',
    headings.length ? `### Headings\n${headings.map((item) => `- ${item}`).join('\n')}` : '',
    callsToAction.length ? `\n### Calls to Action\n${callsToAction.map((item) => `- ${item}`).join('\n')}` : '',
    bodyLines.length ? `\n### Extracted Visible Text\n${bodyLines.map((item) => `- ${item}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}

function buildSiteSummary(pages) {
  const allHeadings = unique(pages.flatMap((page) => [...page.h1, ...page.h2, ...page.h3]));
  const allLinks = pages.flatMap((page) => page.links)
    .filter((link) => link.href.includes(HOST))
    .map((link) => `${link.text || '(untitled)'} - ${link.href}`);
  const linkInventory = unique(allLinks).sort();

  return [
    '# Narrative.io Site Crawl Summary',
    '',
    `Crawled ${pages.length} pages from ${START_URL}.`,
    `Generated at ${new Date().toISOString()}.`,
    '',
    '## High-Level Themes',
    '',
    ...allHeadings.slice(0, 80).map((heading) => `- ${heading}`),
    '',
    '## Page Summaries',
    '',
    ...pages.map(summarizePage),
    '',
    '## Same-Site Link Inventory',
    '',
    ...linkInventory.map((link) => `- ${link}`)
  ].join('\n');
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const queue = [normalizeUrl(START_URL)];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];

  while (queue.length && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (!url || visited.has(url) || !shouldVisit(url)) continue;

    console.log(`Crawling ${visited.size + 1}/${MAX_PAGES}: ${url}`);
    visited.add(url);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.getByRole('button', { name: /accept|agree|allow/i }).click({ timeout: 2500 }).catch(() => {});
      await autoExplorePage(page);

      const data = await extractPage(page, url);
      const screenshotName = `${slugFor(url)}.png`;
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: true }).catch(() => {});
      data.screenshot = `screenshots/${screenshotName}`;
      pages.push(data);

      for (const link of data.links) {
        const next = normalizeUrl(link.href, url);
        if (!next || queued.has(next) || visited.has(next) || !shouldVisit(next)) continue;
        queued.add(next);
        queue.push(next);
      }
    } catch (error) {
      console.warn(`Failed ${url}: ${error.message}`);
      pages.push({ url, error: error.message, title: '', description: '', h1: [], h2: [], h3: [], links: [], buttons: [], bodyText: '' });
    }
  }

  await browser.close();

  pages.sort((a, b) => a.url.localeCompare(b.url));

  await fs.writeFile(path.join(OUTPUT_DIR, 'narrative-pages.json'), JSON.stringify(pages, null, 2));
  await fs.writeFile(path.join(OUTPUT_DIR, 'narrative-summary.md'), buildSiteSummary(pages));

  console.log(`Done. Crawled ${pages.length} pages.`);
  console.log(`Summary: ${path.join(OUTPUT_DIR, 'narrative-summary.md')}`);
}

async function summarizeExisting() {
  const pagesPath = path.join(OUTPUT_DIR, 'narrative-pages.json');
  const pages = JSON.parse(await fs.readFile(pagesPath, 'utf8'));
  const seen = new Set();
  const cleaned = [];

  for (const page of pages) {
    const normalized = normalizeUrl(page.url);
    if (!normalized || page.error || seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push({ ...page, url: normalized });
  }

  cleaned.sort((a, b) => a.url.localeCompare(b.url));

  await fs.writeFile(pagesPath, JSON.stringify(cleaned, null, 2));
  await fs.writeFile(path.join(OUTPUT_DIR, 'narrative-summary.md'), buildSiteSummary(cleaned));

  console.log(`Cleaned ${pages.length} extracted pages down to ${cleaned.length} valid unique pages.`);
  console.log(`Summary: ${path.join(OUTPUT_DIR, 'narrative-summary.md')}`);
}

const command = process.env.SUMMARIZE_ONLY === 'true' ? summarizeExisting : main;

command().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
