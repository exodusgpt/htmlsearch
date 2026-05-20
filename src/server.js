import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanIdentityTools } from './identity-detector.js';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const SCAN_PASSWORD = process.env.SCAN_PASSWORD || 'Narrative';
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SCANS = Number(process.env.RATE_LIMIT_MAX_SCANS || 12);
const scanAttemptsByIp = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': MIME_TYPES['.json'] });
  response.end(JSON.stringify(payload));
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
  for await (const chunk of request) chunks.push(chunk);
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
    response.writeHead(200, { 'content-type': MIME_TYPES[path.extname(normalized)] || 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
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

  if (request.method === 'GET' || request.method === 'HEAD') {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(405, { allow: 'GET, HEAD, POST' });
  response.end();
});

server.listen(PORT, HOST, () => {
  const localUrl = HOST === '0.0.0.0' ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Page vendor scanner running at ${localUrl}`);
});
