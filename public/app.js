const form = document.querySelector('#scan-form');
const urlInput = document.querySelector('#url');
const passwordInput = document.querySelector('#scan-password');
const statusEl = document.querySelector('#status');
const resultsEl = document.querySelector('#results');
const template = document.querySelector('#result-card-template');
const detectedCountEl = document.querySelector('#detected-count');
const requestCountEl = document.querySelector('#request-count');
const signalCountEl = document.querySelector('#signal-count');
const finalUrlEl = document.querySelector('#final-url');
const appUrl = `http://127.0.0.1:5173/${window.location.search || ''}`;
const CLIENT_SCAN_TIMEOUT_MS = 75000;
const PASSWORD_STORAGE_KEY = 'htmlsearch.scanPassword';

if (window.location.protocol === 'file:') {
  window.location.replace(appUrl);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function resetSummary() {
  detectedCountEl.textContent = '0';
  requestCountEl.textContent = '0';
  signalCountEl.textContent = '0';
  finalUrlEl.textContent = '';
}

passwordInput.value = localStorage.getItem(PASSWORD_STORAGE_KEY) || '';

function renderResults(result) {
  detectedCountEl.textContent = String(result.totals.detectedCompanies ?? result.totals.detectedProducts);
  requestCountEl.textContent = String(result.totals.requests);
  signalCountEl.textContent = String(result.rawSignalCount);
  finalUrlEl.textContent = result.finalUrl;
  resultsEl.replaceChildren();

  for (const detection of result.detections) {
    const card = template.content.cloneNode(true);
    const badge = card.querySelector('.badge');
    const tags = card.querySelector('.signal-tags');
    const evidenceList = card.querySelector('.evidence-list');

    card.querySelector('h3').textContent = detection.name;
    card.querySelector('.category').textContent = detection.domains?.length ? detection.domains.join(', ') : detection.category;
    badge.textContent = detection.confidence;
    badge.classList.add('found');

    for (const type of detection.signalTypes) {
      const tag = document.createElement('span');
      tag.textContent = type;
      tags.append(tag);
    }

    for (const item of detection.evidence) {
      const li = document.createElement('li');
      const type = document.createElement('strong');
      type.textContent = `${item.type}: `;
      li.append(type, item.evidence);
      evidenceList.append(li);
    }

    resultsEl.append(card);
  }

  setStatus(result.detections.length ? `Finished. Found ${result.detections.length} compan${result.detections.length === 1 ? 'y' : 'ies'} or vendors in the inspected page signals.` : 'Finished. No third-party companies or vendors were found in the inspected page signals.');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector('button');
  const url = urlInput.value.trim();
  const password = passwordInput.value.trim();

  if (password) {
    localStorage.setItem(PASSWORD_STORAGE_KEY, password);
  } else {
    localStorage.removeItem(PASSWORD_STORAGE_KEY);
  }

  resetSummary();
  resultsEl.replaceChildren();
  submitButton.disabled = true;
  setStatus('Scanning with Playwright. This usually takes 10 to 60 seconds.');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_SCAN_TIMEOUT_MS);

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-scan-password': password
      },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Scan failed.');
    }

    renderResults(payload);
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Scan stopped after 75 seconds. This page is taking too long or blocking automation; try the full https:// URL or run it again.'
      : error.message;
    setStatus(message, true);
  } finally {
    clearTimeout(timeoutId);
    submitButton.disabled = false;
  }
});

const initialUrl = new URLSearchParams(window.location.search).get('url');
if (initialUrl && window.location.protocol !== 'file:') {
  urlInput.value = initialUrl;
  form.requestSubmit();
}
