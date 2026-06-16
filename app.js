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

// Concentric rings of curved text — the view from inside a sphere/dome.
// Rings are sin-spaced (bunch toward the rim) and scale with radius for depth;
// each ring spins at its own rate to give the warping, swirling motion.
const SVGNS = 'http://www.w3.org/2000/svg';

class TextSphere {
  constructor(container) {
    this.container = container;
    this._words = ['OBJECTBOXD'];
    this.rings = [];
    this.rot = 0;
    this.raf = null;
    this.speed = 0.11;          // base deg/frame
    this._init();
  }

  _init() {
    const VB = 1000, C = 500, RMAX = 730, N = 17;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.id = 'sphereSvg';
    svg.setAttribute('viewBox', `0 0 ${VB} ${VB}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    const defs = document.createElementNS(SVGNS, 'defs');
    svg.appendChild(defs);

    for (let k = 1; k <= N; k++) {
      const theta = (k / (N + 1)) * (Math.PI / 2);   // 0..~90°
      const r = RMAX * Math.sin(theta);
      const depth = r / RMAX;                          // 0 centre (far) … 1 rim (near)
      const fontSize = 7 + depth * 30;

      const id = `ring${k}`;
      const path = document.createElementNS(SVGNS, 'path');
      path.id = id;
      path.setAttribute('fill', 'none');
      path.setAttribute('d',
        `M ${C - r} ${C} a ${r} ${r} 0 1 1 ${2 * r} 0 a ${r} ${r} 0 1 1 ${-2 * r} 0`);
      defs.appendChild(path);

      const g = document.createElementNS(SVGNS, 'g');
      const text = document.createElementNS(SVGNS, 'text');
      text.setAttribute('font-size', fontSize.toFixed(1));
      text.setAttribute('opacity', (0.28 + depth * 0.62).toFixed(2));
      const tp = document.createElementNS(SVGNS, 'textPath');
      tp.setAttribute('href', `#${id}`);
      tp.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${id}`);
      text.appendChild(tp);
      g.appendChild(text);
      svg.appendChild(g);

      this.rings.push({ g, tp, fontSize, depth, circ: 2 * Math.PI * r, dir: k % 2 ? 1 : -1 });
    }
    this.container.appendChild(svg);
    this._fill();
  }

  _fill() {
    const base = this._words.join('  ·  ') + '  ·  ';
    for (const ring of this.rings) {
      const charW = ring.fontSize * 0.56;
      const need = Math.max(1, Math.ceil(ring.circ / charW / base.length));
      ring.tp.textContent = base.repeat(Math.min(need, 36));
    }
  }

  setWords(words) {
    this._words = words.length ? words : ['OBJECTBOXD'];
    this._fill();
  }

  _frame() {
    this.rot += this.speed;
    for (const ring of this.rings) {
      const a = this.rot * ring.dir * (0.45 + ring.depth);
      ring.g.setAttribute('transform', `rotate(${a.toFixed(2)} 500 500)`);
    }
    this.raf = requestAnimationFrame(() => this._frame());
  }

  start() { if (!this.raf) this._frame(); }

  flashWords(wordArrays, doneCallback) {
    let i = 0, interval = 45;
    const tick = () => {
      if (i >= wordArrays.length) { doneCallback(); return; }
      this.setWords(wordArrays[i++]);
      interval = Math.min(interval * 1.08, 280);
      setTimeout(tick, interval);
    };
    tick();
  }
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
  const posterP = fetchPoster(picked.url);

  const allTitles = films.map(f => wordsFrom(f.name));
  const picks = [...allTitles].sort(() => Math.random() - .5).slice(0, 28);
  picks.push(wordsFrom(picked.name));

  await new Promise(resolve => sphere.flashWords(picks, resolve));
  sphere.setWords(wordsFrom(picked.name));
  await wait(300);

  const posterUrl = await posterP;
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

const wait = ms => new Promise(r => setTimeout(r, ms));

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
