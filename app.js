'use strict';

const LB = 'https://letterboxd.com';
const PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

// ── DOM ───────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const el = {
  sphereWrap:   $('sphereWrap'),
  monkWrap:     $('monkWrap'),
  posterFig:    $('posterFig'),
  fileInput:    $('fileInput'),
  dropzone:     $('dropzone'),
  uploadError:  $('uploadError'),
  refreshBtn:   $('refreshBtn'),
  sourceSelect: $('sourceSelect'),
  sourceCount:  $('sourceCount'),
  drawBtn:      $('drawBtn'),
  backBtn:      $('backBtn'),
  resultYear:   $('resultYear'),
  resultTitle:  $('resultTitle'),
  resultLink:   $('resultLink'),
  spinAgain:    $('spinAgain'),
};
const screens = {
  upload:   $('screenUpload'),
  controls: $('screenControls'),
  result:   $('screenResult'),
};

// ── Text Sphere ───────────────────────────────────────────────────────────────

// The view onto the inside of a sphere. Text runs along the sphere's parallels
// (lines of latitude), each projected to a curved arc: the equator is straight,
// arcs bow further from centre and bunch toward the poles. The "spin" scrolls
// text ALONG each path (one startOffset number per line) — no 3D compositing,
// so it stays smooth.
const SVGNS = 'http://www.w3.org/2000/svg';

class TextSphere {
  constructor(container) {
    this.container = container;
    this._words = ['OBJECTBOXD'];
    this.lines = [];
    this.off = 0;
    this.raf = null;
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.id = 'sphereSvg';
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    this.container.appendChild(this.svg);
    this._build();
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => this._build(), 200); });
    this._frame();
  }

  _build() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.lines = [];
    const W = 1000, H = 800, cx = W / 2, cy = H / 2;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const defs = document.createElementNS(SVGNS, 'defs');
    this.svg.appendChild(defs);

    const C = 1.7, f = 640, S = 48;
    const latMax = 36 * Math.PI / 180, lamMax = 50 * Math.PI / 180, N = 11;

    for (let i = 0; i < N; i++) {
      const phi = -latMax + 2 * latMax * i / (N - 1);     // latitude of this parallel
      const cphi = Math.cos(phi), sphi = Math.sin(phi);
      let d = '';
      for (let j = 0; j <= S; j++) {
        const lam = -lamMax + 2 * lamMax * j / S;          // longitude across the front
        const x = cphi * Math.sin(lam), y = sphi, z = cphi * Math.cos(lam);
        const sx = cx + f * x / (C - z), sy = cy - f * y / (C - z);
        d += (j ? 'L' : 'M') + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' ';
      }

      const id = `par${i}`;
      const path = document.createElementNS(SVGNS, 'path');
      path.id = id; path.setAttribute('fill', 'none'); path.setAttribute('d', d);
      defs.appendChild(path);

      const mag = f / (C - cphi);
      const fontSize = Math.max(11, mag * 0.042);
      const frac = Math.abs(phi) / latMax;                 // 0 equator … 1 pole
      const text = document.createElementNS(SVGNS, 'text');
      text.setAttribute('font-size', fontSize.toFixed(1));
      text.setAttribute('opacity', (0.92 - 0.5 * frac).toFixed(2));
      const tp = document.createElementNS(SVGNS, 'textPath');
      tp.setAttribute('href', `#${id}`);
      tp.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${id}`);
      text.appendChild(tp);
      this.svg.appendChild(text);

      this.lines.push({ tp, fontSize, len: path.getTotalLength(), unit: 0 });
    }
    this._fill();
  }

  _fill() {
    const base = this._words.join('  ·  ') + '  ·  ';
    for (const ln of this.lines) {
      const charW = ln.fontSize * 0.56;
      ln.unit = base.length * charW;
      const need = Math.max(3, Math.ceil(ln.len / ln.unit) + 2);
      ln.tp.textContent = base.repeat(Math.min(need, 18));
    }
  }

  setWords(words) {
    this._words = words.length ? words : ['OBJECTBOXD'];
    this._fill();
  }

  _frame() {
    this.off += 0.5;
    for (const ln of this.lines) {
      ln.tp.setAttribute('startOffset', (ln.unit ? -(this.off % ln.unit) : 0).toFixed(1));
    }
    this.raf = requestAnimationFrame(() => this._frame());
  }

  start() { /* rAF started in constructor */ }
}

const sphere = new TextSphere(el.sphereWrap);
sphere.start();

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseLine(line) {
  const f = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { f.push(cur.trim()); cur = ''; } else cur += c;
  }
  f.push(cur.trim()); return f;
}

// Parse Letterboxd list export v7 format.
// Structure:
//   Line 0: "Letterboxd list export v7"
//   Line 1: "Date,Name,Tags,URL,Description"  ← list metadata header
//   Line 2: "<date>,<List Name>,<tags>,<url>,<description>"  ← list metadata
//   ...multi-line description possible...
//   Line N: "Position,Name,Year,URL,Description"  ← film section header
//   Line N+1+: individual film rows
function parseListV7(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);

  // Extract list name from metadata row
  let listName = '';
  const metaH = parseLine(lines[1] || '').map(x => x.toLowerCase().trim());
  const metaNameIdx = metaH.indexOf('name');
  if (metaNameIdx >= 0) {
    listName = parseLine(lines[2] || '')[metaNameIdx]?.trim() || '';
  }

  // Find the film section header (starts with "Position,")
  let filmHeaderIdx = -1;
  for (let i = 3; i < lines.length; i++) {
    if (/^position,/i.test(lines[i].trim())) { filmHeaderIdx = i; break; }
  }
  if (filmHeaderIdx < 0) return null;

  const fh = parseLine(lines[filmHeaderIdx]).map(x => x.toLowerCase().trim());
  const ni = fh.indexOf('name'), yi = fh.indexOf('year'), ui = fh.indexOf('url');
  if (ni < 0 || ui < 0) return null;

  const films = lines.slice(filmHeaderIdx + 1)
    .filter(l => l.trim() && !l.startsWith(','))
    .map(line => {
      const f = parseLine(line);
      const name = f[ni]?.trim() || '', year = yi >= 0 ? f[yi]?.trim() || '' : '', url = f[ui]?.trim() || '';
      return (name && url) ? { name, year, url } : null;
    })
    .filter(Boolean);

  return films.length ? { name: listName, films } : null;
}

// Simple root CSV (watchlist.csv): "Date,Name,Year,Letterboxd URI"
function parseSimple(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!lines.length) return null;
  const h = parseLine(lines[0]).map(x => x.toLowerCase().trim());
  const ni = h.indexOf('name');
  const yi = h.indexOf('year');
  const ui = h.findIndex(x => x.includes('uri') || x === 'url');
  if (ni < 0 || ui < 0) return null;
  const films = lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const f = parseLine(line);
      const name = f[ni]?.trim() || '', year = yi >= 0 ? f[yi]?.trim() || '' : '', url = f[ui]?.trim() || '';
      return (name && url) ? { name, year, url } : null;
    })
    .filter(Boolean);
  return films.length ? { films } : null;
}

const SKIP = new Set([
  'profile.csv','ratings.csv','diary.csv','reviews.csv',
  'comments.csv','watched.csv','films.csv','likes.csv',
]);

function ingest(filename, text, db) {
  const clean = text.replace(/^﻿/, '');

  // Watchlist is a root CSV in the simple format, not a list export
  if (filename === 'watchlist.csv') {
    const r = parseSimple(clean);
    if (r) {
      console.log(`[objectboxd] "Watchlist": ${r.films.length} films`);
      db.lists.push({ name: 'Watchlist', films: r.films });
    }
    return;
  }

  if (SKIP.has(filename)) return;
  if (!clean.startsWith('Letterboxd list export')) return;
  const result = parseListV7(clean);
  if (!result) return;
  // Fall back to filename-derived name if CSV metadata had none
  const name = result.name ||
    filename.replace(/\.csv$/, '').replace(/-/g, ' ').trim();
  console.log(`[objectboxd] "${name}": ${result.films.length} films`);
  db.lists.push({ name, films: result.films });
}

async function processFiles(files) {
  const db = { lists: [] };
  for (const file of files) {
    if (file.name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file);
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || !path.endsWith('.csv')) continue;
        ingest(path.split('/').pop().toLowerCase(), await entry.async('string'), db);
      }
    } else if (file.name.endsWith('.csv')) {
      ingest(file.name.toLowerCase(), await file.text(), db);
    }
  }
  if (!db.lists.length)
    throw new Error('No lists found — drop your full Letterboxd export .zip');
  // Watchlist first, then the rest in file order
  db.lists.sort((a, b) => (a.name === 'Watchlist' ? -1 : b.name === 'Watchlist' ? 1 : 0));
  return db;
}

// ── Poster fetch ──────────────────────────────────────────────────────────────

// filmUrl is a boxd.it or letterboxd.com URL; proxies follow redirects.
async function fetchPoster(filmUrl) {
  if (!filmUrl) return null;
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(filmUrl), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const m = (await res.text()).match(/<meta property="og:image" content="([^"]+)"/);
      if (m && m[1].includes('ltrbxd')) return m[1];
    } catch { /* next proxy */ }
  }
  return null;
}

// ── Routing ───────────────────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([k, s]) => s.classList.toggle('hidden', k !== name));
}

// ── Select population ─────────────────────────────────────────────────────────

function slugify(s) { return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, ''); }
function getFilms(db) { return db.lists.find(l => slugify(l.name) === el.sourceSelect.value)?.films ?? []; }
function wordsFrom(str) { const w = str.toUpperCase().split(/\s+/).filter(Boolean); return w.length ? w : ['OBJECTBOXD']; }

function populateSelect(db) {
  el.sourceSelect.innerHTML = '';
  db.lists.forEach(lst => {
    const o = document.createElement('option');
    o.value = slugify(lst.name);
    o.textContent = lst.name;
    el.sourceSelect.appendChild(o);
  });
  const sync = () => {
    const n = getFilms(db).length;
    el.sourceCount.textContent = `${n} film${n === 1 ? '' : 's'}`;
    sphere.setWords(wordsFrom(el.sourceSelect.options[el.sourceSelect.selectedIndex]?.textContent || 'objectboxd'));
  };
  el.sourceSelect.addEventListener('change', sync);
  sync();
}

// ── Spin ──────────────────────────────────────────────────────────────────────

let spinning = false;

async function spin(db) {
  if (spinning) return;
  spinning = true;
  el.drawBtn.disabled = true;

  const films = getFilms(db);
  if (!films.length) { spinning = false; el.drawBtn.disabled = false; return; }

  const picked = films[Math.floor(Math.random() * films.length)];

  // Pick is instant — show the title on the sphere, then reveal once the poster lands
  sphere.setWords(wordsFrom(picked.name));
  const posterUrl = await fetchPoster(picked.url);
  el.posterFig.style.backgroundImage = posterUrl ? `url("${posterUrl}")` : '';
  el.monkWrap.classList.add('picked');

  el.resultYear.textContent = picked.year || '';
  el.resultTitle.textContent = picked.name;
  el.resultLink.href = picked.url;

  screens.result.classList.remove('reveal');
  showScreen('result');
  void screens.result.offsetWidth;
  screens.result.classList.add('reveal');

  spinning = false;
  el.drawBtn.disabled = false;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function boot(db) {
  populateSelect(db);
  el.drawBtn.onclick = () => spin(db);
  el.spinAgain.onclick = () => {
    el.monkWrap.classList.remove('picked');
    el.posterFig.style.backgroundImage = '';
    screens.result.classList.remove('reveal');
    showScreen('controls');
    setTimeout(() => spin(db), 120);
  };
  el.backBtn.onclick = () => {
    el.monkWrap.classList.remove('picked');
    el.posterFig.style.backgroundImage = '';
    screens.result.classList.remove('reveal');
    showScreen('controls');
  };
  el.refreshBtn.onclick = () => {
    el.monkWrap.classList.remove('picked', 'show');
    sphere.setWords(['OBJECTBOXD']);
    showScreen('upload');
  };
  el.monkWrap.classList.add('show');
  showScreen('controls');
}

// ── Upload wiring ─────────────────────────────────────────────────────────────

function showErr(msg) {
  el.uploadError.textContent = msg;
  el.uploadError.classList.remove('hidden');
  setTimeout(() => el.uploadError.classList.add('hidden'), 5000);
}

async function handleFiles(files) {
  if (!files.length) return;
  try { boot(await processFiles(Array.from(files))); }
  catch (e) { showErr(e.message); }
}

el.fileInput.addEventListener('change', e => handleFiles(e.target.files));
el.dropzone.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.fileInput.click(); });
el.dropzone.addEventListener('dragover', e => { e.preventDefault(); el.dropzone.classList.add('drag-over'); });
el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('drag-over'));
el.dropzone.addEventListener('drop', e => {
  e.preventDefault();
  el.dropzone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

// Always start at upload — no saved state
showScreen('upload');
