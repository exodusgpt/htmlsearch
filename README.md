# Narrative.io Site Crawler

This project includes three Playwright utilities:

- A Narrative.io site crawler that extracts visible page content.
- A local Page Vendor Scanner that checks a company URL for companies and vendors visible in page HTML, scripts, browser storage, cookies, and network requests.
- A local Amazon Price Agent that sets delivery ZIP codes, searches Amazon Fresh product names, validates SKU / ASIN values against Amazon Fresh search results, and returns SKU-to-price rows.

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

For a public deployment, the scanner requires a password before it will run. The default password is `SaraTest`; set `SCAN_PASSWORD` in Render if you want to change it. The server also blocks localhost, private IP ranges, link-local addresses, cloud metadata hostnames, and private subresource requests so the scanner cannot be used to probe internal networks.

### Amazon Price Agent

Start the local UI:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`, enter product names and optional SKU / ASIN values, then run the agent. Searches are constrained to the Amazon Fresh department. Explicit SKU / ASIN values are also looked up through Amazon Fresh search, so non-Fresh ASINs are reported as warnings instead of returning general Amazon prices. The default ZIP codes are `10001`, `75201`, `60601`, and `90041`, and the default product is `Haagen Daaz 14 oz`.

Amazon may show CAPTCHA or automation checks. If that happens, run with `HEADLESS=false npm run dev` so you can watch the browser and handle any manual challenge.

The public web version submits Amazon Fresh scans as queued jobs instead of holding one long HTTP request open. Jobs are persisted as JSON files in `output/amazon-jobs` locally, or in `AMAZON_JOB_DIR` when that environment variable is set.

Useful production environment variables:

- `SCAN_PASSWORD`: required shared password for running and viewing jobs
- `AMAZON_JOB_DIR`: directory for persisted job JSON files, for example `/var/data/amazon-jobs`
- `MAX_CONCURRENT_AMAZON_JOBS`: browser job concurrency, defaults to `1`
- `RATE_LIMIT_MAX_SCANS`: per-IP job submission limit per 10 minutes, defaults to `12`
- `MAX_JSON_BODY_BYTES`: API request body size limit, defaults to `65536`

### Render

Use a Web Service with:

```bash
npm run render:build
```

Start command:

```bash
npm run render:start
```

Recommended environment variables:

- `SCAN_PASSWORD`: set this to a strong password
- `AMAZON_JOB_DIR`: optional directory for persisted job files if you later add a paid persistent disk
- `MAX_CONCURRENT_AMAZON_JOBS`: set to `1`
- `RATE_LIMIT_MAX_SCANS`: optional per-IP scan limit per 10 minutes, defaults to `12`
- `SCAN_TIMEOUT_MS`: optional scan timeout, defaults to `180000`

The included `render.yaml` creates a free Render Node web service named `amazon-fresh-price-agent` and installs Playwright Chromium during build. On the free plan, job JSON files are stored on Render's ephemeral filesystem, so they can disappear after redeploys or service restarts. Add a paid persistent disk later if you need durable job history.

To get it live on Render:

1. Push this repository to GitHub.
2. In Render, choose **New** then **Blueprint**.
3. Connect the GitHub repository and let Render read `render.yaml`.
4. Set `SCAN_PASSWORD` when Render asks for the synced secret.
5. Create the service and wait for the build to finish.
6. Open the generated Render URL.
7. Enter the password, product names or Fresh ASINs, and run a job.
8. Watch the job status until it completes, then download the CSV.

For a fully public audience, keep the password private or replace it with real user accounts before sharing the URL broadly. Amazon may block cloud-hosted browser automation more aggressively than local runs, so expect to test with a small product list first. Render's free instance is also small, so Playwright jobs may be slow or fail under memory pressure; use the free plan for testing before paying for a larger instance.

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

### Dropbox Blog Crawler

```bash
npm run crawl:dropbox
```

Outputs:

- `output/dropbox-blog-pages.json`: structured extraction for visited Dropbox Blog pages
- `output/dropbox-blog-summary.md`: comprehensive markdown summary with AI and partnership references prioritized first

The generic crawler also accepts environment variables:

```bash
START_URL=https://blog.dropbox.com/ HOST=blog.dropbox.com OUTPUT_PREFIX=dropbox-blog MAX_PAGES=1000 node src/crawl-site.js
```

To rebuild the Dropbox summary from existing JSON:

```bash
npm run summarize:dropbox
```
