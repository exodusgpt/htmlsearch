# Narrative.io Site Crawler

This project includes two Playwright utilities:

- A Narrative.io site crawler that extracts visible page content.
- A local Page Vendor Scanner that checks a company URL for companies and vendors visible in page HTML, scripts, browser storage, cookies, and network requests.

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

### Page Vendor Scanner

Start the local UI:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`, enter a company URL, and run a scan.

The scanner builds a dynamic inventory from observed third-party domains and known vendor aliases. It labels evidence as SDK, HTML parameter, auth / identity call, browser storage, cookie, or network call, and exposes the exact matching evidence so you can inspect why a company was flagged.

For a public deployment, the scanner requires a password before it will run. The default password is `Narrative`; set `SCAN_PASSWORD` in Render if you want to change it. The server also blocks localhost, private IP ranges, link-local addresses, cloud metadata hostnames, and private subresource requests so the scanner cannot be used to probe internal networks.

### Render

Use a Web Service with:

```bash
npm install && npx playwright install --with-deps chromium
```

Start command:

```bash
npm start
```

Recommended environment variables:

- `SCAN_PASSWORD`: optional tool password, defaults to `Narrative`
- `RATE_LIMIT_MAX_SCANS`: optional per-IP scan limit per 10 minutes, defaults to `12`
- `SCAN_TIMEOUT_MS`: optional scan timeout, defaults to `180000`

You can also scan from the command line:

```bash
npm run scan -- https://example.com
```

The latest CLI JSON report is written to `output/identity-scan.json`.

### Narrative.io Crawler

```bash
npm run crawl
```

Outputs are written to `output/`:

- `narrative-pages.json`: structured extraction for every visited page
- `narrative-summary.md`: compiled human-readable summary
- `screenshots/`: screenshots for each crawled page

To watch the browser while it runs:

```bash
npm run crawl:headed
```

By default the crawler stops at 500 pages as a safety guard. Override that with `MAX_PAGES=1000 npm run crawl` if the site grows and you want a deeper run.

To rebuild the markdown summary from the existing JSON extraction without crawling again:

```bash
npm run summarize
```
