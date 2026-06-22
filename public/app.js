const form = document.querySelector('#price-form');
const productsInput = document.querySelector('#products');
const skusInput = document.querySelector('#skus');
const zipInput = document.querySelector('#zip-codes');
const limitInput = document.querySelector('#limit');
const passwordInput = document.querySelector('#scan-password');
const statusEl = document.querySelector('#status');
const resultsEl = document.querySelector('#results');
const warningsEl = document.querySelector('#warnings');
const rowCountEl = document.querySelector('#row-count');
const zipCountEl = document.querySelector('#zip-count');
const errorCountEl = document.querySelector('#error-count');
const downloadButton = document.querySelector('#download-csv');
const appUrl = `http://127.0.0.1:5173/${window.location.search || ''}`;
const POLL_INTERVAL_MS = 3000;
const PASSWORD_STORAGE_KEY = 'htmlsearch.scanPassword';
const LAST_JOB_STORAGE_KEY = 'htmlsearch.amazonFreshJobId';

let latestRows = [];
let pollTimer = null;

if (window.location.protocol === 'file:') {
  window.location.replace(appUrl);
}

passwordInput.value = localStorage.getItem(PASSWORD_STORAGE_KEY) || '';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function lines(value) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resetResults() {
  latestRows = [];
  clearTimeout(pollTimer);
  resultsEl.replaceChildren();
  warningsEl.replaceChildren();
  rowCountEl.textContent = '0';
  errorCountEl.textContent = '0';
  downloadButton.disabled = true;
}

function setSubmitDisabled(disabled) {
  form.querySelector('button[type="submit"]').disabled = disabled;
}

function renderRows(rows) {
  resultsEl.replaceChildren();

  for (const row of rows) {
    const tr = document.createElement('tr');
    const zip = document.createElement('td');
    const sku = document.createElement('td');
    const price = document.createElement('td');
    const title = document.createElement('td');
    const source = document.createElement('td');
    const link = document.createElement('a');

    zip.textContent = row.zip;
    sku.textContent = row.sku;
    price.textContent = row.price || 'Not found';
    link.textContent = row.title || row.query || row.sku;
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    title.append(link);
    source.textContent = row.source;

    tr.append(zip, sku, price, title, source);
    resultsEl.append(tr);
  }
}

function renderWarnings(errors) {
  warningsEl.replaceChildren();
  for (const error of errors) {
    const item = document.createElement('p');
    const context = [error.zip, error.query].filter(Boolean).join(' / ');
    item.textContent = context ? `${context}: ${error.message}` : error.message;
    warningsEl.append(item);
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv() {
  const header = ['zip', 'sku', 'price', 'title', 'source', 'query', 'url'];
  const body = latestRows.map((row) => header.map((key) => csvEscape(row[key])).join(','));
  const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'amazon-sku-prices.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function renderJob(job) {
  const rows = job.result?.rows || [];
  const errors = job.result?.errors || [];

  latestRows = rows;
  renderRows(rows);
  renderWarnings(errors);
  rowCountEl.textContent = String(rows.length);
  errorCountEl.textContent = String(errors.length);
  downloadButton.disabled = rows.length === 0;
}

function describeJob(job) {
  if (job.status === 'queued') {
    return `Queued as job ${job.id}. Position ${job.position || 1}.`;
  }

  if (job.status === 'running') {
    return `Running job ${job.id}. Amazon Fresh checks can take several minutes.`;
  }

  if (job.status === 'completed') {
    const rows = job.result?.rows?.length || 0;
    return rows ? `Finished job ${job.id}. Pulled ${rows} SKU price row${rows === 1 ? '' : 's'}.` : `Finished job ${job.id}, but no SKU prices were found.`;
  }

  return `Job ${job.id} failed. ${job.error || 'Check the server logs for details.'}`;
}

async function fetchJob(jobId, password) {
  const response = await fetch(`/api/amazon-prices/${encodeURIComponent(jobId)}`, {
    headers: { 'x-scan-password': password }
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Could not load job status.');
  }

  return payload;
}

async function pollJob(jobId, password) {
  try {
    const job = await fetchJob(jobId, password);
    setStatus(describeJob(job), job.status === 'failed');

    if (job.status === 'completed') {
      renderJob(job);
      setSubmitDisabled(false);
      return;
    }

    if (job.status === 'failed') {
      setSubmitDisabled(false);
      return;
    }

    pollTimer = setTimeout(() => pollJob(jobId, password), POLL_INTERVAL_MS);
  } catch (error) {
    setSubmitDisabled(false);
    setStatus(error.message, true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput.value.trim();
  const payload = {
    products: lines(productsInput.value),
    skus: lines(skusInput.value),
    zipCodes: lines(zipInput.value),
    limitPerProduct: Number(limitInput.value)
  };

  if (password) {
    localStorage.setItem(PASSWORD_STORAGE_KEY, password);
  } else {
    localStorage.removeItem(PASSWORD_STORAGE_KEY);
  }

  resetResults();
  zipCountEl.textContent = String(payload.zipCodes.length);
  setSubmitDisabled(true);
  setStatus('Submitting Amazon Fresh job.');

  try {
    const response = await fetch('/api/amazon-prices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-scan-password': password
      },
      body: JSON.stringify(payload)
    });
    const job = await response.json();

    if (!response.ok) {
      throw new Error(job.error || 'Amazon price job failed to start.');
    }

    localStorage.setItem(LAST_JOB_STORAGE_KEY, job.id);
    setStatus(describeJob(job));
    pollTimer = setTimeout(() => pollJob(job.id, password), POLL_INTERVAL_MS);
  } catch (error) {
    setStatus(error.message, true);
    setSubmitDisabled(false);
  }
});

async function restoreLastJob() {
  const password = passwordInput.value.trim();
  const jobId = localStorage.getItem(LAST_JOB_STORAGE_KEY);
  if (!password || !jobId) return;

  try {
    const job = await fetchJob(jobId, password);
    if (job.status === 'completed' || job.status === 'failed') {
      renderJob(job);
      setStatus(describeJob(job), job.status === 'failed');
      return;
    }

    setSubmitDisabled(true);
    setStatus(describeJob(job));
    pollTimer = setTimeout(() => pollJob(job.id, password), POLL_INTERVAL_MS);
  } catch {
    localStorage.removeItem(LAST_JOB_STORAGE_KEY);
  } finally {
    // The next manual run will create a new job.
  }
}

downloadButton.addEventListener('click', downloadCsv);
restoreLastJob();
