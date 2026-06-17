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
  posterBack:   $('posterBack'),
  figWindow:    $('figWindow'),
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

// A true 3D sphere of text. Each character is its own element placed on the
// sphere's surface (rotateY · rotateX · translateZ); the wrapper's CSS
// perspective then scales every glyph by its depth — real foreshortening,
// bigger toward the viewer, smaller as the surface curves away. The spin is a
// single GPU-composited rotateY on the globe, so it stays smooth.
class TextSphere {
  constructor(container) {
    this.container = container;
    this._words = ['OBJECTBOXD'];
    this.inside = !/\bconvex\b/.test(location.search);   // inside-the-sphere by default; ?convex for the ball
    this.globe = document.createElement('div');
    this.globe.id = 'sphereGlobe';
    this.container.appendChild(this.globe);
    this._build();
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => this._build(), 200); });
  }

  _build() {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    this.R = vmin * 0.62;                                       // larger → zoomed in
    this._fontSize = Math.max(18, this.R * 0.12);              // big text
    // inside: camera near the centre (small perspective) → strong barrel fisheye of the far wall.
    // convex: camera outside, looking at the ball.
    this.container.style.perspective = `${(vmin * (this.inside ? 0.28 : 0.66)).toFixed(0)}px`;
    this._buildRings();      // ring elements + spin animations (recreated only on layout change)
    this._fill();            // glyph content (re-run on every text change)
  }

  // Create the ring elements once per layout. Their CSS spin animations keep
  // running across text changes because _fill only swaps the glyphs inside them.
  _buildRings() {
    this.globe.style.setProperty('--fs', `${this._fontSize.toFixed(1)}px`);
    this.globe.replaceChildren();
    this.rows = [];
    const R = this.R, fontSize = this._fontSize;
    // 13 rows; drop both extreme pole rows (they bunch worst), and make the
    // next-in rows top & bottom a decorative symbol halo → 9 text rows between
    const latMax = 80, N = 13;
    for (let i = 0; i < N; i++) {
      if (i === 0 || i === N - 1) continue;
      const halo = (i === 1 || i === N - 2);
      const phi = -latMax + 2 * latMax * i / (N - 1);
      const circ = 2 * Math.PI * R * Math.cos(phi * Math.PI / 180);
      const nChars = Math.max(4, Math.min(Math.round(Math.abs(circ) / (fontSize * 0.66)), 34));
      const ring = document.createElement('div');
      ring.className = 'ring';
      const dur = 150 + i * 6;                                 // slow, slight per-ring variation
      ring.style.animation = `ringSpin ${dur}s linear infinite ${i % 2 ? 'reverse' : 'normal'}`;
      this.globe.appendChild(ring);
      this.rows.push({ ring, halo, phi, nChars });
    }
  }

  // Swap the glyphs inside the existing rings (does NOT touch the spin animation)
  _fill() {
    if (!this.rows) return;
    const R = this.R;
    const words = this._words.join(' ').toUpperCase().split(/\s+/).filter(Boolean);
    const SYMBOLS = '· • ';
    const zSign = this.inside ? -1 : 1, lamDir = this.inside ? -1 : 1;

    // assign each row its repeating text unit
    const textRows = this.rows.filter(r => !r.halo);
    const isIdle = this._words.length === 1 && this._words[0] === IDLE;
    if (isIdle && textRows.length === IDLE_LINES.length) {
      // idle quote: one hand-authored phrase per row, top→bottom
      const order = [...textRows].sort((a, b) => b.phi - a.phi);   // top first
      order.forEach((r, idx) => { r.unit = IDLE_LINES[idx].toUpperCase() + ' · '; });
    } else {
      const whole = words.join(' ') + ' · ';                   // film title: repeat on every row
      textRows.forEach(r => { r.unit = whole; });
    }
    this.rows.forEach(r => { if (r.halo) r.unit = SYMBOLS; });

    // build glyphs into each ring (replaceChildren keeps the ring + its animation)
    this.rows.forEach(r => {
      const unit = r.unit;
      // tile the phrase a WHOLE number of times around the ring → no wrap seam
      const count = Math.max(1, Math.round(r.nChars / unit.length)) * unit.length;
      const frag = document.createDocumentFragment();
      for (let k = 0; k < count; k++) {
        const ch = unit[k % unit.length];
        if (ch === ' ') continue;                              // spaces become gaps
        const lam = lamDir * 360 * k / count + 180;
        const s = document.createElement('span');
        s.className = 'glyph';
        s.textContent = ch;
        s.style.transform =
          `rotateY(${lam.toFixed(1)}deg) rotateX(${(-r.phi).toFixed(1)}deg) translateZ(${(zSign * R).toFixed(1)}px) translate(-50%,-50%)`;
        frag.appendChild(s);
      }
      r.ring.replaceChildren(frag);
    });
  }

  setWords(words) {
    this._words = words.length ? words : ['OBJECTBOXD'];
    this._fill();            // only swap glyphs — rings keep spinning
  }

  start() { /* spin is a CSS animation */ }
}

// Idle text shown on the sphere whenever no film is drawn.
// IDLE is the key passed to setWords; IDLE_LINES is the hand-authored per-row split (no commas).
const IDLE = 'In nature we never see anything isolated, but everything in connection with something else which is before it, beside it, under it, and over it.';
const IDLE_LINES = [
  'In nature', 'we never see', 'anything isolated', 'but in connection with', 'something else which is',
  'before it', 'beside it', 'under it', 'and over it',
];

const sphere = new TextSphere(el.sphereWrap);
sphere.setWords([IDLE]);
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

// Key a film for the watched-exclusion set (boxd.it vs letterboxd.com URLs
// differ across exports, so match on name+year instead of URL)
const watchedKey = (name, year) => `${(name || '').trim().toLowerCase()}|${(year || '').trim()}`;

const SKIP = new Set([
  'profile.csv','ratings.csv','diary.csv','reviews.csv',
  'comments.csv','films.csv','likes.csv',
]);

function ingest(filename, text, db) {
  const clean = text.replace(/^﻿/, '');

  // Watched: not a selectable list — just collect keys so we can exclude them
  if (filename === 'watched.csv') {
    const r = parseSimple(clean);
    if (r) {
      r.films.forEach(f => db.watched.add(watchedKey(f.name, f.year)));
      console.log(`[objectboxd] watched: ${r.films.length} films (excluded from picks)`);
    }
    return;
  }

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
  const db = { lists: [], watched: new Set() };
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
function getFilms(db) {
  const films = db.lists.find(l => slugify(l.name) === el.sourceSelect.value)?.films ?? [];
  return films.filter(f => !db.watched.has(watchedKey(f.name, f.year)));   // drop already-watched
}
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
    sphere.setWords([IDLE]);                              // idle quote until a film is drawn
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
  if (posterUrl) {
    el.figWindow.style.backgroundImage = `url("${posterUrl}")`;                 // fills the figure, crossfades in
    el.figWindow.classList.add('revealed');
  }
  document.body.classList.add('result-mode');                                   // flip to black bg / red text

  el.resultYear.textContent = picked.year || '';
  el.resultTitle.textContent = picked.name;
  el.resultLink.href = picked.url;

  screens.result.classList.remove('reveal');
  showScreen('result');
  void screens.result.offsetWidth;
  fitResultTitle();
  screens.result.classList.add('reveal');

  spinning = false;
  el.drawBtn.disabled = false;
}

// Shrink the result title until it fits on one line (long names spill otherwise)
function fitResultTitle() {
  const t = el.resultTitle;
  if (!t.textContent) return;
  const avail = Math.min(740, window.innerWidth - 64);
  let fs = Math.min(window.innerWidth * 0.12, 132);
  t.style.fontSize = `${fs}px`;
  let guard = 0;
  while (t.scrollWidth > avail && fs > 16 && guard++ < 80) {
    fs *= 0.93;
    t.style.fontSize = `${fs}px`;
  }
}
// Re-fit when the font finishes loading or the window resizes
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitResultTitle());
let _fitT;
window.addEventListener('resize', () => {
  if (screens.result.classList.contains('hidden')) return;
  clearTimeout(_fitT); _fitT = setTimeout(fitResultTitle, 150);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

// back to the idle state: figure → black silhouette, drop the poster backdrop
function resetPoster() {
  el.figWindow.classList.remove('revealed');     // fade poster back out to the black silhouette
  el.posterBack.classList.remove('show');
  document.body.classList.remove('result-mode'); // flip back to red bg / black text
}

function boot(db) {
  populateSelect(db);
  el.drawBtn.onclick = () => spin(db);
  el.spinAgain.onclick = () => {
    resetPoster();
    screens.result.classList.remove('reveal');
    showScreen('controls');
    setTimeout(() => spin(db), 120);
  };
  el.backBtn.onclick = () => {
    resetPoster();
    screens.result.classList.remove('reveal');
    sphere.setWords([IDLE]);
    showScreen('controls');
  };
  el.refreshBtn.onclick = () => {
    resetPoster();
    sphere.setWords([IDLE]);
    showScreen('upload');
  };
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
