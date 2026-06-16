'use strict';

const STORAGE_KEY = 'objectboxd_v1';
const LB_BASE = 'https://letterboxd.com';

// Poster CORS proxies — tried in order; only one film fetched per spin.
const PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const screens = {
  upload:   $('screenUpload'),
  controls: $('screenControls'),
  result:   $('screenResult'),
};
const el = {
  dropzone:     $('dropzone'),
  fileInput:    $('fileInput'),
  dzBrowse:     $('dzBrowse'),
  uploadError:  $('uploadError'),
  lastUpdated:  $('lastUpdated'),
  refreshBtn:   $('refreshBtn'),
  sourceSelect: $('sourceSelect'),
  sourceCount:  $('sourceCount'),
  spinBtn:      $('spinBtn'),
  spinOverlay:  $('spinOverlay'),
  spinFlash:    $('spinFlash'),
  spinBarFill:  $('spinBarFill'),
  bgPoster:     $('bgPoster'),
  backBtn:      $('backBtn'),
  resultYear:   $('resultYear'),
  resultTitle:  $('resultTitle'),
  resultLink:   $('resultLink'),
  spinAgain:    $('spinAgain'),
};

// ── Routing ───────────────────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([k, s]) => s.classList.toggle('hidden', k !== name));
}

// ── Storage ───────────────────────────────────────────────────────────────────

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields.map(f => f.trim());
}

function csvToFilms(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const nameIdx = headers.indexOf('name');
  const yearIdx = headers.indexOf('year');
  const urlIdx  = headers.indexOf('letterboxd_uri');
  if (nameIdx === -1 || urlIdx === -1) return [];

  return lines.slice(1).map(line => {
    const f = parseCSVLine(line);
    const name = f[nameIdx] || '';
    const year = yearIdx >= 0 ? f[yearIdx] || '' : '';
    const url  = f[urlIdx]  || '';
    if (!name || !url) return null;
    // Extract film slug from URL  e.g. https://boxd.it/xxxx OR https://letterboxd.com/film/slug/
    const slugMatch = url.match(/letterboxd\.com\/film\/([^/]+)/);
    const slug = slugMatch ? slugMatch[1] : '';
    return { name, year, url, slug };
  }).filter(Boolean);
}

function slugify(str) {
  return str.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
}

// ── ZIP / file processing ─────────────────────────────────────────────────────

async function processFiles(files) {
  const db = { updated: new Date().toISOString(), watchlist: [], lists: [] };

  for (const file of files) {
    if (file.name.endsWith('.zip')) {
      await processZip(file, db);
    } else if (file.name.endsWith('.csv')) {
      await processCSV(file, db);
    }
  }

  if (db.watchlist.length === 0 && db.lists.length === 0) {
    throw new Error('No film data found — are these Letterboxd export files?');
  }
  return db;
}

async function processZip(file, db) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.entries(zip.files).filter(([, e]) => !e.dir);

  for (const [path, entry] of entries) {
    const filename = path.split('/').pop().toLowerCase();
    if (!filename.endsWith('.csv')) continue;
    const text = await entry.async('text');
    ingestCSV(filename, text, db);
  }
}

async function processCSV(file, db) {
  const text = await file.text();
  ingestCSV(file.name.toLowerCase(), text, db);
}

const SKIP_FILES = new Set(['ratings.csv', 'diary.csv', 'reviews.csv',
  'profile.csv', 'comments.csv', 'likes.csv', 'films.csv']);

function ingestCSV(filename, text, db) {
  if (SKIP_FILES.has(filename)) return;
  const films = csvToFilms(text);
  if (!films.length) return;

  if (filename === 'watchlist.csv') {
    db.watchlist.push(...films);
    return;
  }
  // Named list — clean up filename into a readable label
  const name = filename
    .replace(/\.csv$/, '')
    .replace(/^list-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-/, '') // strip LB date prefix
    .replace(/-/g, ' ')
    .trim();
  db.lists.push({ name: name || filename, films });
}

// ── Populate select ───────────────────────────────────────────────────────────

function populateSelect(db) {
  el.sourceSelect.innerHTML = '';
  if (db.watchlist.length) {
    const o = document.createElement('option');
    o.value = '__watchlist__';
    o.textContent = '★ Watchlist';
    el.sourceSelect.appendChild(o);
  }
  db.lists.forEach(lst => {
    const o = document.createElement('option');
    o.value = slugify(lst.name);
    o.textContent = lst.name;
    el.sourceSelect.appendChild(o);
  });
  updateCount(db);
  el.sourceSelect.addEventListener('change', () => updateCount(db));
}

function updateCount(db) {
  const val = el.sourceSelect.value;
  const films = val === '__watchlist__'
    ? db.watchlist
    : (db.lists.find(l => slugify(l.name) === val)?.films ?? []);
  el.sourceCount.textContent = `${films.length} film${films.length === 1 ? '' : 's'}`;
}

function setUpdatedLabel(iso) {
  const d = new Date(iso);
  el.lastUpdated.textContent = `last updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// ── Poster fetching ───────────────────────────────────────────────────────────

async function fetchPoster(filmUrl) {
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(filmUrl), {
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const m = html.match(/<meta property="og:image" content="([^"]+)"/);
      if (m && m[1].includes('ltrbxd.com')) return m[1];
    } catch { /* try next */ }
  }
  return null;
}

// ── Spin logic ────────────────────────────────────────────────────────────────

let spinning = false;

async function spin(db) {
  if (spinning) return;
  spinning = true;
  el.spinBtn.disabled = true;

  // Which list is selected?
  const val = el.sourceSelect.value;
  const films = val === '__watchlist__'
    ? db.watchlist
    : db.lists.find(l => slugify(l.name) === val)?.films ?? [];

  if (!films.length) {
    spinning = false; el.spinBtn.disabled = false;
    return;
  }

  const picked = films[Math.floor(Math.random() * films.length)];

  // ── Animation ──
  el.spinOverlay.classList.remove('hidden');
  el.spinBarFill.style.width = '0%';

  // kick off poster fetch in parallel with the animation
  const posterPromise = picked.slug
    ? fetchPoster(`${LB_BASE}/film/${picked.slug}/`)
    : Promise.resolve(null);

  // Flash titles from the list — start fast, ramp progress bar
  const titles = films.map(f => f.name);
  const TOTAL_MS = 2200;
  const start = Date.now();
  let frameHandle;

  await new Promise(resolve => {
    let interval = 55;

    function flash() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / TOTAL_MS, 1);

      el.spinBarFill.style.width = `${progress * 100}%`;
      el.spinFlash.textContent = titles[Math.floor(Math.random() * titles.length)];

      // slow down over time
      interval = 55 + progress * 340;

      if (progress >= 1) { resolve(); return; }
      frameHandle = setTimeout(flash, interval);
    }
    flash();
  });

  // final scramble onto the picked title
  await scramble(el.spinFlash, picked.name.toUpperCase(), 600);

  // wait for poster (it's been fetching in parallel)
  const posterUrl = await posterPromise;

  // ── Reveal ──
  el.spinOverlay.classList.add('hidden');

  // set poster bg
  el.bgPoster.classList.remove('visible', 'no-poster');
  if (posterUrl) {
    el.bgPoster.style.backgroundImage = `url("${posterUrl}")`;
    el.bgPoster.classList.add('visible');
  } else {
    el.bgPoster.style.backgroundImage = '';
    el.bgPoster.classList.add('no-poster', 'visible');
  }

  // fill result
  el.resultYear.textContent = picked.year || '';
  el.resultTitle.textContent = picked.name;
  el.resultLink.href = picked.url || `${LB_BASE}/film/${picked.slug}/`;

  // animate in
  screens.result.classList.remove('reveal');
  showScreen('result');
  void screens.result.offsetWidth; // force reflow
  screens.result.classList.add('reveal');

  spinning = false;
  el.spinBtn.disabled = false;
}

// Character scramble on the flash text when landing
function scramble(element, target, duration) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789—·';
  return new Promise(resolve => {
    const start = Date.now();
    const step = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(elapsed / duration, 1);
      const resolved = Math.floor(p * target.length);
      let out = '';
      for (let i = 0; i < target.length; i++) {
        if (i < resolved || target[i] === ' ') out += target[i];
        else out += chars[Math.floor(Math.random() * chars.length)];
      }
      element.textContent = out;
      if (p < 1) requestAnimationFrame(step);
      else { element.textContent = target; resolve(); }
    };
    requestAnimationFrame(step);
  });
}

// ── Upload handling ───────────────────────────────────────────────────────────

function showError(msg) {
  el.uploadError.textContent = msg;
  el.uploadError.classList.remove('hidden');
  setTimeout(() => el.uploadError.classList.add('hidden'), 4000);
}

async function handleFiles(files) {
  if (!files.length) return;
  try {
    const db = await processFiles(Array.from(files));
    saveData(db);
    boot(db);
  } catch (err) {
    showError(err.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function boot(db) {
  populateSelect(db);
  setUpdatedLabel(db.updated);
  showScreen('controls');

  el.spinBtn.onclick = () => spin(db);
  el.spinAgain.onclick = () => {
    screens.result.classList.remove('reveal');
    el.bgPoster.classList.remove('visible', 'no-poster');
    showScreen('controls');
    setTimeout(() => spin(db), 80);
  };
  el.backBtn.onclick = () => {
    screens.result.classList.remove('reveal');
    el.bgPoster.classList.remove('visible', 'no-poster');
    showScreen('controls');
  };
  el.refreshBtn.onclick = () => {
    el.bgPoster.classList.remove('visible', 'no-poster');
    showScreen('upload');
  };
}

// File input / drag-drop wiring
el.fileInput.addEventListener('change', e => handleFiles(e.target.files));
el.dzBrowse.addEventListener('click', e => { e.stopPropagation(); el.fileInput.click(); });
el.dropzone.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.fileInput.click(); });

el.dropzone.addEventListener('dragover', e => { e.preventDefault(); el.dropzone.classList.add('drag-over'); });
el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('drag-over'));
el.dropzone.addEventListener('drop', e => {
  e.preventDefault();
  el.dropzone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

// Load persisted data on startup
const saved = loadData();
if (saved && (saved.watchlist?.length || saved.lists?.length)) {
  boot(saved);
} else {
  showScreen('upload');
}
