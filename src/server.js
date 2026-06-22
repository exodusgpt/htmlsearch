import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanIdentityTools } from './identity-detector.js';
import { normalizeAmazonInput, scanAmazonPrices } from './amazon-price-agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const AMAZON_JOB_DIR = path.resolve(process.env.AMAZON_JOB_DIR || path.resolve(__dirname, '..', 'output', 'amazon-jobs'));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const SCAN_PASSWORD = process.env.SCAN_PASSWORD || 'SaraTest';
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SCANS = Number(process.env.RATE_LIMIT_MAX_SCANS || 12);
const MAX_CONCURRENT_AMAZON_JOBS = Math.max(1, Number(process.env.MAX_CONCURRENT_AMAZON_JOBS || 1));
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 64 * 1024);
const AMAZON_JOB_TIMEOUT_MS = Number(process.env.AMAZON_JOB_TIMEOUT_MS || 8 * 60 * 1000);
const scanAttemptsByIp = new Map();
const amazonJobs = new Map();
const amazonQueue = [];
let activeAmazonJobs = 0;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': MIME_TYPES['.json']
  });
  response.end(JSON.stringify(payload));
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    input: job.input,
    result: job.result,
    error: job.error,
    progress: job.progress,
    position: job.status === 'queued' ? amazonQueue.indexOf(job.id) + 1 : 0
  };
}

async function persistAmazonJob(job) {
  await fs.mkdir(AMAZON_JOB_DIR, { recursive: true });
  await fs.writeFile(path.join(AMAZON_JOB_DIR, `${job.id}.json`), JSON.stringify(publicJob(job), null, 2));
}

async function readAmazonJob(jobId) {
  const existing = amazonJobs.get(jobId);
  if (existing) return existing;

  if (!/^[a-f0-9-]{36}$/i.test(jobId)) return null;

  try {
    const raw = await fs.readFile(path.join(AMAZON_JOB_DIR, `${jobId}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function processAmazonQueue() {
  while (activeAmazonJobs < MAX_CONCURRENT_AMAZON_JOBS && amazonQueue.length) {
    const jobId = amazonQueue.shift();
    const job = amazonJobs.get(jobId);
    if (!job || job.status !== 'queued') continue;

    activeAmazonJobs += 1;
    runAmazonJob(job).finally(() => {
      activeAmazonJobs -= 1;
      processAmazonQueue();
    });
  }
}

async function runAmazonJob(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.updatedAt = job.startedAt;
  job.progress = 'Starting browser.';
  await persistAmazonJob(job);

  try {
    const { chromium } = await import('playwright');
    const result = await scanAmazonPrices({
      chromium,
      ...job.input,
      timeoutMs: AMAZON_JOB_TIMEOUT_MS,
      onProgress: async (progress) => {
        job.progress = progress;
        job.updatedAt = new Date().toISOString();
        await persistAmazonJob(job);
      }
    });
    job.status = 'completed';
    job.result = result;
    job.progress = 'Completed.';
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.progress = 'Failed.';
  } finally {
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    await persistAmazonJob(job);
  }
}

async function createAmazonJob(input, ip) {
  const normalizedInput = normalizeAmazonInput(input);
  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    input: normalizedInput,
    result: null,
    error: null,
    progress: 'Queued.',
    ip
  };

  amazonJobs.set(job.id, job);
  amazonQueue.push(job.id);
  await persistAmazonJob(job);
  processAmazonQueue();
  return publicJob(job);
}

function requestIp(request) {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return request.socket.remoteAddress || 'unknown';
}

function hasValidPassword(request) {
  return request.headers['x-scan-password'] === SCAN_PASSWORD;
}

function isRateLimited(ip) {
  const now = Date.now();
  const attempts = (scanAttemptsByIp.get(ip) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (attempts.length >= RATE_LIMIT_MAX_SCANS) {
    scanAttemptsByIp.set(ip, attempts);
    return true;
  }

  attempts.push(now);
  scanAttemptsByIp.set(ip, attempts);
  return false;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new Error('Request is too large.');
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

async function serveStatic(request, response) {
  const requestedPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const safePath = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.join(PUBLIC_DIR, safePath);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(normalized);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'content-type': MIME_TYPES[path.extname(normalized)] || 'application/octet-stream'
    });
    response.end(content);
  } catch {
    response.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const parsedUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === 'POST' && request.url === '/api/scan') {
    try {
      if (!hasValidPassword(request)) {
        sendJson(response, 401, { error: 'Password required.' });
        return;
      }

      const ip = requestIp(request);
      if (isRateLimited(ip)) {
        sendJson(response, 429, { error: 'Too many scans. Wait a few minutes and try again.' });
        return;
      }

      const { url } = await readJson(request);
      const { chromium } = await import('playwright');
      const result = await scanIdentityTools({ chromium, url });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/amazon-prices') {
    try {
      if (!hasValidPassword(request)) {
        sendJson(response, 401, { error: 'Password required.' });
        return;
      }

      const ip = requestIp(request);
      if (isRateLimited(ip)) {
        sendJson(response, 429, { error: 'Too many scans. Wait a few minutes and try again.' });
        return;
      }

      const payload = await readJson(request);
      const job = await createAmazonJob(payload, ip);
      sendJson(response, 202, job);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  const amazonJobMatch = parsedUrl.pathname.match(/^\/api\/amazon-prices\/([a-f0-9-]{36})$/i);
  if (request.method === 'GET' && amazonJobMatch) {
    try {
      if (!hasValidPassword(request)) {
        sendJson(response, 401, { error: 'Password required.' });
        return;
      }

      const job = await readAmazonJob(amazonJobMatch[1]);
      if (!job) {
        sendJson(response, 404, { error: 'Job not found.' });
        return;
      }

      sendJson(response, 200, publicJob(job));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(405, { allow: 'GET, HEAD, POST' });
  response.end();
});

server.listen(PORT, HOST, () => {
  const localUrl = HOST === '0.0.0.0' ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Amazon price agent running at ${localUrl}`);
});
