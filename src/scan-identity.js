import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanIdentityTools } from './identity-detector.js';

const url = process.argv[2] || process.env.SCAN_URL;
const OUTPUT_DIR = path.resolve('output');

function formatConsoleReport(result) {
  return [
    `Scanned: ${result.finalUrl}`,
    `Companies/vendors found: ${result.detections.length}`,
    '',
    ...result.detections.map((detection) => {
      const domains = detection.domains?.length ? ` [${detection.domains.join(', ')}]` : '';
      const header = `FOUND ${detection.name}${domains} (${detection.confidence})`;
      const evidence = detection.evidence.slice(0, 5).map((item) => `  - ${item.type}: ${item.evidence}`);
      return [header, ...evidence].join('\n');
    })
  ].join('\n');
}

if (!url) {
  console.error('Usage: npm run scan -- https://example.com');
  process.exitCode = 1;
} else {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const result = await scanIdentityTools({
      chromium,
      url,
      headless: process.env.HEADLESS !== 'false'
    });
    const outputPath = path.join(OUTPUT_DIR, 'identity-scan.json');

    await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
    console.log(formatConsoleReport(result));
    console.log('');
    console.log(`JSON report: ${outputPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
