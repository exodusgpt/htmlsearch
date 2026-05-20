import dns from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_MS = 3500;
const DEFAULT_SCAN_TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS || 180000);

const KNOWN_VENDORS = [
  {
    id: 'triple-whale',
    name: 'Triple Whale',
    domains: ['triplewhale.com', 'trytriplewhale.com'],
    patterns: [/triplewhale/i, /triple-whale/i, /triple whale/i, /triplepixel/i, /triple-pixel/i, /whale\.js/i, /trytriplewhale/i]
  },
  {
    id: 'liveramp',
    name: 'LiveRamp',
    domains: ['liveramp.com', 'rlcdn.com'],
    patterns: [/liveramp/i, /live ramp/i, /ats\.js/i, /ats-wrapper/i, /ats\.rlcdn\.com/i, /rlcdn\.com/i, /identitylink/i, /idl_env/i]
  },
  {
    id: 'transunion',
    name: 'TransUnion',
    domains: ['transunion.com', 'agkn.com', 'iovation.com'],
    patterns: [/transunion/i, /trans union/i, /truoptik/i, /truaudience/i, /neustar/i, /agkn\.com/i, /iovation/i]
  },
  {
    id: 'experian',
    name: 'Experian',
    domains: ['experian.com', 'tapad.com', 'exelator.com'],
    patterns: [/experian/i, /tapad/i, /audienceengine/i, /audience engine/i, /experianmarketingservices/i, /exelator/i]
  },
  {
    id: 'adobe',
    name: 'Adobe',
    domains: ['adobe.com', 'adobedtm.com', 'demdex.net', 'everesttech.net', 'omtrdc.net'],
    patterns: [/adobe/i, /adobedtm/i, /demdex/i, /everesttech/i, /omtrdc/i, /adobetm/i, /launch-\w+\.min\.js/i, /satelliteLib/i, /_satellite/i, /alloy/i, /experiencecloud/i, /visitorapi\.js/i, /appmeasurement\.js/i, /adobe_mc/i]
  },
  {
    id: 'google',
    name: 'Google',
    domains: ['google.com', 'googletagmanager.com', 'google-analytics.com', 'doubleclick.net', 'gstatic.com', 'googleadservices.com', 'googleapis.com', 'googlesyndication.com', 'adtrafficquality.google'],
    patterns: [/google-analytics/i, /googletagmanager/i, /gtag/i, /doubleclick/i, /googleadservices/i, /googlesyndication/i]
  },
  {
    id: 'bing',
    name: 'Microsoft Advertising',
    domains: ['bing.com'],
    patterns: [/bat\.bing\.com/i, /\buetq\b/i]
  },
  {
    id: 'meta',
    name: 'Meta',
    domains: ['facebook.com', 'facebook.net', 'fbcdn.net', 'instagram.com'],
    patterns: [/facebook pixel/i, /fbevents/i, /\bfbq\b/i, /facebook\.net/i]
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    domains: ['tiktok.com', 'tiktokcdn.com'],
    patterns: [/tiktok/i, /ttq/i]
  },
  {
    id: 'snap',
    name: 'Snap',
    domains: ['snapchat.com', 'sc-static.net'],
    patterns: [/snapchat/i, /snaptr/i]
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    domains: ['pinterest.com', 'pinimg.com'],
    patterns: [/pinterest/i, /pintrk/i]
  },
  {
    id: 'klaviyo',
    name: 'Klaviyo',
    domains: ['klaviyo.com'],
    patterns: [/klaviyo/i]
  },
  {
    id: 'shopify',
    name: 'Shopify',
    domains: ['shopify.com', 'shopifycdn.net', 'myshopify.com'],
    patterns: [/shopify/i, /shopifycdn/i]
  },
  {
    id: 'segment',
    name: 'Segment',
    domains: ['segment.com', 'segment.io'],
    patterns: [/analytics\.js/i, /segment\.io/i, /segment\.com/i]
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    domains: ['amplitude.com'],
    patterns: [/amplitude/i]
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    domains: ['mixpanel.com'],
    patterns: [/mixpanel/i]
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    domains: ['hotjar.com'],
    patterns: [/hotjar/i, /hjSettings/i]
  },
  {
    id: 'fullstory',
    name: 'FullStory',
    domains: ['fullstory.com'],
    patterns: [/fullstory/i, /\b_FS\b/]
  },
  {
    id: 'optimizely',
    name: 'Optimizely',
    domains: ['optimizely.com'],
    patterns: [/optimizely/i]
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    domains: ['salesforce.com', 'force.com', 'exacttarget.com', 'salesforceliveagent.com'],
    patterns: [/salesforce/i, /exacttarget/i]
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    domains: ['hubspot.com', 'hsforms.com', 'hs-scripts.com', 'hs-analytics.net'],
    patterns: [/hubspot/i, /hsforms/i, /hbspt/i]
  },
  {
    id: 'onetrust',
    name: 'OneTrust',
    domains: ['onetrust.com', 'onetrust.io', 'cookielaw.org'],
    patterns: [/onetrust/i, /otSDKStub/i, /cookielaw/i]
  },
  {
    id: 'the-trade-desk',
    name: 'The Trade Desk',
    domains: ['adsrvr.org', 'adsrvr.com'],
    patterns: [/adsrvr/i, /the trade desk/i, /ttd_tdid/i]
  },
  {
    id: 'xandr',
    name: 'Xandr',
    domains: ['adnxs.com'],
    patterns: [/adnxs/i, /appnexus/i, /xandr/i]
  }
];

const SIGNAL_FIELDS = [
  'url',
  'method',
  'postData',
  'resourceType',
  'tagName',
  'src',
  'href',
  'id',
  'className',
  'name',
  'type',
  'content',
  'text',
  'key',
  'value',
  'domain'
];

const HOST_VENDOR_OVERRIDES = new Map(
  KNOWN_VENDORS.flatMap((vendor) => vendor.domains.map((domain) => [domain, vendor.name]))
);

const NOISE_HOST_PREFIXES = new Set(['www', 'cdn', 'static', 'assets', 'asset', 'js', 'img', 'images', 'scripts', 'script', 'api', 'app', 'apps', 'tags', 'tag', 'pixel', 'events', 'collect', 'secure', 's']);
const MULTIPART_TLDS = new Set(['co.uk', 'com.au', 'com.br', 'com.mx', 'co.jp', 'co.nz', 'com.sg', 'com.tr', 'com.ar', 'co.in']);
const IGNORED_DOMAINS = new Set(['schema.org', 'w3.org', 'xmlns.com']);
const blockedHostnames = new Set(['localhost', 'metadata.google.internal']);
const resolvedHostSafety = new Map();

function normalizeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) {
    throw new Error('Enter a URL to scan.');
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs can be scanned.');
  }

  return url.toString();
}

function navigationCandidates(rawUrl) {
  const value = String(rawUrl || '').trim();
  const explicitProtocol = /^https?:\/\//i.test(value);
  const initial = new URL(normalizeUrl(value));
  const candidates = [initial];

  if (!initial.hostname.startsWith('www.')) {
    const wwwUrl = new URL(initial.toString());
    wwwUrl.hostname = `www.${wwwUrl.hostname}`;
    candidates.push(wwwUrl);
  }

  if (!explicitProtocol) {
    for (const candidate of [...candidates]) {
      const httpUrl = new URL(candidate.toString());
      httpUrl.protocol = 'http:';
      candidates.push(httpUrl);
    }
  }

  return uniqueBy(candidates.map((candidate) => candidate.toString()), (candidate) => candidate);
}

function ipv4ToNumber(ip) {
  return ip.split('.').reduce((sum, octet) => (sum * 256) + Number(octet), 0);
}

function ipv4InRange(ip, start, end) {
  const value = ipv4ToNumber(ip);
  return value >= ipv4ToNumber(start) && value <= ipv4ToNumber(end);
}

function isBlockedIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    return [
      ['0.0.0.0', '0.255.255.255'],
      ['10.0.0.0', '10.255.255.255'],
      ['100.64.0.0', '100.127.255.255'],
      ['127.0.0.0', '127.255.255.255'],
      ['169.254.0.0', '169.254.255.255'],
      ['172.16.0.0', '172.31.255.255'],
      ['192.0.0.0', '192.0.0.255'],
      ['192.168.0.0', '192.168.255.255'],
      ['198.18.0.0', '198.19.255.255'],
      ['224.0.0.0', '255.255.255.255']
    ].some(([start, end]) => ipv4InRange(ip, start, end));
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('ff');
  }

  return true;
}

async function assertPublicUrl(urlString) {
  const url = new URL(urlString);
  const hostname = url.hostname.toLowerCase();

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs can be scanned.');
  }

  if (blockedHostnames.has(hostname) || hostname.endsWith('.local')) {
    throw new Error('Private, local, and metadata hostnames cannot be scanned.');
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error('Private, local, and reserved IP addresses cannot be scanned.');
    }
    return;
  }

  if (resolvedHostSafety.has(hostname)) {
    if (!resolvedHostSafety.get(hostname)) {
      throw new Error('This hostname resolves to a private or reserved IP address.');
    }
    return;
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  const isSafe = addresses.length > 0 && addresses.every((address) => !isBlockedIp(address.address));
  resolvedHostSafety.set(hostname, isSafe);

  if (!isSafe) {
    throw new Error('This hostname resolves to a private or reserved IP address.');
  }
}

function compact(value, maxLength = 320) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function hostnameFromValue(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function extractUrls(value) {
  return String(value || '').match(/https?:\/\/[^\s"'<>),\\]+/gi) || [];
}

function registeredDomain(hostname) {
  const labels = hostname
    .toLowerCase()
    .replace(/^(\*\.)?/, '')
    .replace(/\.$/, '')
    .split('.')
    .filter(Boolean);

  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9-]+$/i.test(label))) return '';

  while (labels.length > 2 && NOISE_HOST_PREFIXES.has(labels[0])) labels.shift();
  if (labels.length <= 2) {
    const domain = labels.join('.');
    return IGNORED_DOMAINS.has(domain) ? '' : domain;
  }

  const lastTwo = labels.slice(-2).join('.');
  if (MULTIPART_TLDS.has(lastTwo) && labels.length >= 3) {
    const domain = labels.slice(-3).join('.');
    return IGNORED_DOMAINS.has(domain) ? '' : domain;
  }

  const domain = labels.slice(-2).join('.');
  return IGNORED_DOMAINS.has(domain) ? '' : domain;
}

function displayNameFromDomain(domain) {
  if (HOST_VENDOR_OVERRIDES.has(domain)) return HOST_VENDOR_OVERRIDES.get(domain);

  return domain.split('.')[0]
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || domain;
}

function domainMatchesVendor(domain, vendor) {
  return vendor.domains.some((vendorDomain) => domain === vendorDomain || domain.endsWith(`.${vendorDomain}`));
}

function signalMatchesVendor(signal, vendor) {
  const text = SIGNAL_FIELDS.map((field) => signal[field]).filter(Boolean).join(' ');
  return vendor.patterns.some((pattern) => pattern.test(text));
}

function classifySignal(signal) {
  if (signal.source === 'network') {
    if (signal.resourceType === 'script') return 'SDK';
    if (/(^|[?&/_-])(auth|login|token|identity|envelope|sync|match|uid|uuid|visitor|userid|customerid)(=|&|\/|_|-|$)/i.test(`${signal.url} ${signal.postData || ''}`)) return 'Auth / identity call';
    return 'Network call';
  }

  if (signal.source === 'script-tag' || signal.tagName === 'SCRIPT') return 'SDK';
  if (signal.source === 'html' && /envelope|auth|identity|token|eid|uid|email|sha|hash|partner|vendor/i.test(`${signal.name} ${signal.id} ${signal.className} ${signal.content} ${signal.text}`)) return 'HTML parameter';
  if (signal.source === 'storage') return 'Browser storage';
  if (signal.source === 'cookie') return 'Cookie';

  return 'Page signal';
}

function evidenceText(signal) {
  const parts = [
    signal.url,
    signal.src,
    signal.href,
    signal.name && `${signal.name}=${signal.content || signal.value || ''}`,
    signal.id && `id=${signal.id}`,
    signal.className && `class=${signal.className}`,
    signal.key && `${signal.key}=${signal.value || ''}`,
    signal.domain,
    signal.text
  ];

  return compact(parts.filter(Boolean).join(' | '));
}

function domainsFromSignal(signal) {
  const rawValues = SIGNAL_FIELDS.map((field) => signal[field]).filter(Boolean);
  const hosts = [];

  for (const value of rawValues) {
    const directHost = hostnameFromValue(value);
    if (directHost) hosts.push(directHost);

    for (const url of extractUrls(value)) {
      const host = hostnameFromValue(url);
      if (host) hosts.push(host);
    }
  }

  return [...new Set(hosts.map(registeredDomain).filter(Boolean))];
}

function evidenceForSignal(signal) {
  return {
    type: classifySignal(signal),
    source: signal.source,
    evidence: evidenceText(signal),
    detail: {
      url: signal.url || signal.src || signal.href || '',
      name: signal.name || signal.key || signal.id || '',
      resourceType: signal.resourceType || '',
      tagName: signal.tagName || ''
    }
  };
}

function detectionConfidence(evidence) {
  const strongTypes = new Set(['SDK', 'Auth / identity call', 'Browser storage', 'Cookie']);
  const strongCount = evidence.filter((item) => strongTypes.has(item.type)).length;
  if (evidence.length >= 5 || strongCount >= 3) return 'high';
  if (evidence.length >= 2 || strongCount >= 1) return 'medium';
  return 'low';
}

function summarizeDetections(rawSignals, firstPartyDomain) {
  const candidateMap = new Map();

  for (const signal of rawSignals) {
    for (const domain of domainsFromSignal(signal)) {
      if (!domain || domain === firstPartyDomain) continue;

      const knownVendor = KNOWN_VENDORS.find((vendor) => domainMatchesVendor(domain, vendor));
      const id = knownVendor?.id || `domain:${domain}`;
      const candidate = candidateMap.get(id) || {
        id,
        name: knownVendor?.name || displayNameFromDomain(domain),
        category: knownVendor ? 'Known vendor' : 'Observed domain',
        domains: new Set(),
        matchedBy: knownVendor ? 'known vendor domain' : 'observed domain',
        evidence: []
      };

      candidate.domains.add(domain);
      candidate.evidence.push(evidenceForSignal(signal));
      candidateMap.set(id, candidate);
    }
  }

  for (const vendor of KNOWN_VENDORS) {
    const matches = rawSignals.filter((signal) => signalMatchesVendor(signal, vendor));
    if (!matches.length) continue;

    const candidate = candidateMap.get(vendor.id) || {
      id: vendor.id,
      name: vendor.name,
      category: 'Known vendor',
      domains: new Set(vendor.domains),
      matchedBy: 'known vendor pattern',
      evidence: []
    };

    matches.forEach((signal) => candidate.evidence.push(evidenceForSignal(signal)));
    candidateMap.set(vendor.id, candidate);
  }

  return [...candidateMap.values()]
    .map((candidate) => {
      const evidence = uniqueBy(candidate.evidence, (match) => `${match.type}:${match.evidence}`).slice(0, 20);
      const signalTypes = [...new Set(evidence.map((match) => match.type))];
      const domains = [...candidate.domains].sort();

      return {
        id: candidate.id,
        name: candidate.name,
        category: candidate.category,
        domains,
        detected: true,
        confidence: detectionConfidence(evidence),
        signalTypes,
        matchedBy: candidate.matchedBy,
        evidence
      };
    })
    .sort((a, b) => {
      const confidenceRank = { high: 0, medium: 1, low: 2 };
      return confidenceRank[a.confidence] - confidenceRank[b.confidence] || a.name.localeCompare(b.name);
    });
}

async function collectDomSignals(page) {
  return await page.evaluate(() => {
    const compact = (value, maxLength = 1000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

    const elementSignals = [...document.querySelectorAll('script, iframe, img, link, meta, input, form, [id], [class], [name]')]
      .slice(0, 2500)
      .map((node) => ({
        source: node.tagName === 'SCRIPT' ? 'script-tag' : 'html',
        tagName: node.tagName,
        src: node.getAttribute('src') || node.getAttribute('data-src') || '',
        href: node.getAttribute('href') || '',
        id: node.id || '',
        className: typeof node.className === 'string' ? node.className : '',
        name: node.getAttribute('name') || node.getAttribute('property') || node.getAttribute('data-name') || '',
        type: node.getAttribute('type') || '',
        content: node.getAttribute('content') || node.getAttribute('value') || '',
        text: node.tagName === 'SCRIPT' ? compact(node.textContent, 1200) : compact(node.textContent, 220)
      }));

    const storageSignals = [];
    for (const sourceName of ['localStorage', 'sessionStorage']) {
      try {
        const storage = window[sourceName];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          storageSignals.push({
            source: 'storage',
            name: sourceName,
            key,
            value: compact(storage.getItem(key), 1200)
          });
        }
      } catch {
        storageSignals.push({
          source: 'storage',
          name: sourceName,
          key: 'unavailable',
          value: ''
        });
      }
    }

    return [...elementSignals, ...storageSignals];
  });
}

export async function scanIdentityTools({ chromium, url, headless = true, waitMs = DEFAULT_WAIT_MS, timeoutMs = DEFAULT_TIMEOUT_MS, scanTimeoutMs = DEFAULT_SCAN_TIMEOUT_MS }) {
  const candidates = navigationCandidates(url);
  for (const candidate of candidates) {
    await assertPublicUrl(candidate);
  }

  const browser = await chromium.launch({ headless });
  const timeoutId = setTimeout(() => {
    browser.close().catch(() => {});
  }, scanTimeoutMs);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  const networkSignals = [];

  await page.route('**/*', async (route) => {
    try {
      await assertPublicUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });

  page.on('request', (request) => {
    networkSignals.push({
      source: 'network',
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      postData: compact(request.postData() || '', 1200)
    });
  });

  try {
    const navigationErrors = [];
    let loaded = false;

    for (const candidateUrl of candidates) {
      try {
        await page.goto(candidateUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        loaded = true;
        break;
      } catch (error) {
        navigationErrors.push(`${candidateUrl}: ${error.message}`);
      }
    }

    if (!loaded) {
      throw new Error(`Could not open the URL. Tried ${candidates.join(', ')}. Last error: ${navigationErrors.at(-1) || 'unknown error'}`);
    }

    await page.getByRole('button', { name: /accept|agree|allow|ok/i }).click({ timeout: 2500 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(waitMs);

    const [domSignals, cookies] = await Promise.all([
      collectDomSignals(page).catch(() => []),
      context.cookies().catch(() => [])
    ]);

    const cookieSignals = cookies.map((cookie) => ({
      source: 'cookie',
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain
    }));

    const rawSignals = [...networkSignals, ...domSignals, ...cookieSignals];
    const firstPartyDomain = registeredDomain(new URL(page.url()).hostname);
    const detections = summarizeDetections(rawSignals, firstPartyDomain);

    return {
      inputUrl: url,
      finalUrl: page.url(),
      scannedAt: new Date().toISOString(),
      title: await page.title().catch(() => ''),
      totals: {
        requests: networkSignals.length,
        domSignals: domSignals.length,
        cookies: cookieSignals.length,
        detectedProducts: detections.length,
        detectedCompanies: detections.length
      },
      detections,
      rawSignalCount: rawSignals.length
    };
  } catch (error) {
    if (/Target page, context or browser has been closed/i.test(error.message)) {
      throw new Error(`Scan timed out after ${Math.round(scanTimeoutMs / 1000)} seconds. The target page may be blocking automation or running too many long-lived scripts.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    await browser.close().catch(() => {});
  }
}

export { KNOWN_VENDORS, normalizeUrl };
