'use strict';

const STORAGE_KEY = 'objectboxd_v2';
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
  posterImg:    $('posterImg'),
  monkOutline:  $('monkOutline'),
  fileInput:    $('fileInput'),
  dropzone:     $('dropzone'),
  uploadError:  $('uploadError'),
  lastUpdated:  $('lastUpdated'),
  refreshBtn:   $('refreshBtn'),
  sourceSelect: $('sourceSelect'),
  sourceCount:  $('sourceCount'),
  spinBtn:      $('spinBtn'),
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

class TextSphere {
  constructor(container) {
    this.container = container;
    this.spans = [];
    this.pts = [];
    this.rot = 0;
    this.raf = null;
    this._words = ['OBJECTBOXD'];
    this.speed = 0.22; // deg/frame — slow, hypnotic
  }

  setWords(words) {
    this._words = words.length ? words : ['OBJECTBOXD'];
    this._build();
  }

  _build() {
    this.spans.forEach(s => s.remove());
    this.spans = []; this.pts = [];

    const N = 72;
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const word = this._words[i % this._words.length];
      const s = document.createElement('span');
      s.className = 'sw';
      s.textContent = word;
      this.container.appendChild(s);
      this.spans.push(s);
      this.pts.push({ x, y, z, s });
    }
  }

  _frame() {
    this.rot += this.speed * Math.PI / 180;
    const cosA = Math.cos(this.rot), sinA = Math.sin(this.rot);
    const tilt = 0.28;
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    const W = window.innerWidth / 2, H = window.innerHeight / 2;
    const R = Math.min(W, H) * 0.62;
    const FOV = Math.min(W, H) * 1.8;

    for (const { x, y, z, s } of this.pts) {
      // rotate Y
      const rx = x * cosA + z * sinA;
      const ry = y;
      const rz = -x * sinA + z * cosA;
      // tilt X
      const ty = ry * cosT - rz * sinT;
      const tz = ry * sinT + rz * cosT;

      const scale = FOV / (FOV + tz * R);
      const px = W + rx * R * scale;
      const py = H + ty * R * scale;
      const depth = (tz + 1) / 2; // 0=back 1=front
      const opacity = 0.08 + depth * 0.86;
      const fs = (0.55 + depth * 0.65).toFixed(2);

      s.style.cssText = `left:${px.toFixed(1)}px;top:${py.toFixed(1)}px;opacity:${opacity.toFixed(2)};font-size:${fs}rem;z-index:${(depth * 10)|0}`;
    }

    this.raf = requestAnimationFrame(() => this._frame());
  }

  start() {
    if (!this.pts.length) this._build();
    if (!this.raf) this._frame();
  }

  flashWords(wordArrays, doneCallback) {
    // rapidly cycle through arrays of words, then resolve
    let i = 0, interval = 45;
    const tick = () => {
      if (i >= wordArrays.length) { doneCallback(); return; }
      this.setWords(wordArrays[i]);
      i++;
      interval = Math.min(interval * 1.08, 280); // slow down
      setTimeout(tick, interval);
    };
    tick();
  }
}

const sphere = new TextSphere(el.sphereWrap);
sphere.start();

// ── Storage ───────────────────────────────────────────────────────────────────

const save = d => localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
const load = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } };

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseLine(line) {
  const f = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { f.push(cur.trim()); cur = ''; } else cur += c;
  }
  f.push(cur.trim()); return f;
}

function csvFilms(text) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return [];
  const h = parseLine(rows[0]).map(x => x.toLowerCase().replace(/\s+/g,'_'));
  const ni = h.indexOf('name'), yi = h.indexOf('year'), ui = h.indexOf('letterboxd_uri');
  if (ni < 0 || ui < 0) return [];
  return rows.slice(1).map(r => {
    const f = parseLine(r);
    const name = f[ni]||'', year = yi>=0?f[yi]||'':'', url = f[ui]||'';
    if (!name||!url) return null;
    const m = url.match(/letterboxd\.com\/film\/([^/?]+)/);
    return { name, year, url, slug: m?m[1]:'' };
  }).filter(Boolean);
}

const SKIP = new Set(['ratings.csv','diary.csv','reviews.csv','profile.csv','comments.csv','likes.csv','films.csv']);

function ingest(filename, text, db) {
  if (SKIP.has(filename)) return;
  const films = csvFilms(text);
  if (!films.length) return;
  if (filename === 'watchlist.csv') { db.watchlist.push(...films); return; }
  const name = filename.replace(/\.csv$/,'')
    .replace(/^list-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-/,'')
    .replace(/-/g,' ').trim() || filename;
  db.lists.push({ name, films });
}

async function processFiles(files) {
  const db = { updated: new Date().toISOString(), watchlist: [], lists: [] };
  for (const file of files) {
    if (file.name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file);
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || !path.endsWith('.csv')) continue;
        ingest(path.split('/').pop().toLowerCase(), await entry.async('text'), db);
      }
    } else if (file.name.endsWith('.csv')) {
      ingest(file.name.toLowerCase(), await file.text(), db);
    }
  }
  if (!db.watchlist.length && !db.lists.length)
    throw new Error('No film data found — are these Letterboxd export files?');
  return db;
}

// ── Poster fetch ──────────────────────────────────────────────────────────────

async function fetchPoster(slug) {
  if (!slug) return null;
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(`${LB}/film/${slug}/`), {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const m = (await res.text()).match(/<meta property="og:image" content="([^"]+)"/);
      if (m && m[1].includes('ltrbxd')) return m[1];
    } catch { /* next proxy */ }
  }
  return null;
}

// ── Routing ───────────────────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([k,s]) => s.classList.toggle('hidden', k !== name));
}

// ── Select population ─────────────────────────────────────────────────────────

function slugify(s) { return s.replace(/[^a-z0-9]+/gi,'-').toLowerCase().replace(/^-|-$/g,''); }

function getFilms(db) {
  const v = el.sourceSelect.value;
  return v === '__watchlist__'
    ? db.watchlist
    : (db.lists.find(l => slugify(l.name) === v)?.films ?? []);
}

function populateSelect(db) {
  el.sourceSelect.innerHTML = '';
  if (db.watchlist.length) {
    const o = document.createElement('option');
    o.value = '__watchlist__'; o.textContent = '★ Watchlist';
    el.sourceSelect.appendChild(o);
  }
  db.lists.forEach(lst => {
    const o = document.createElement('option');
    o.value = slugify(lst.name); o.textContent = lst.name;
    el.sourceSelect.appendChild(o);
  });
  const updateCount = () => {
    const n = getFilms(db).length;
    el.sourceCount.textContent = `${n} film${n===1?'':'s'}`;
    sphere.setWords(wordsFrom(el.sourceSelect.options[el.sourceSelect.selectedIndex]?.textContent || 'objectboxd'));
  };
  el.sourceSelect.addEventListener('change', updateCount);
  updateCount();
}

function wordsFrom(str) {
  const w = str.toUpperCase().split(/\s+/).filter(Boolean);
  return w.length ? w : ['OBJECTBOXD'];
}

// ── Spin ──────────────────────────────────────────────────────────────────────

let spinning = false;

async function spin(db) {
  if (spinning) return;
  spinning = true; el.spinBtn.disabled = true;

  const films = getFilms(db);
  if (!films.length) { spinning = false; el.spinBtn.disabled = false; return; }

  const picked = films[Math.floor(Math.random() * films.length)];

  // Kick off poster fetch in parallel with the animation
  const posterP = fetchPoster(picked.slug);

  // Build a sequence of word-sets: flash all film names from this list
  const allTitles = films.map(f => wordsFrom(f.name));
  // Shuffle for visual randomness, then end on the picked title
  const picks = [...allTitles].sort(() => Math.random()-.5).slice(0,28);
  picks.push(wordsFrom(picked.name)); // final frame = picked film

  await new Promise(resolve => sphere.flashWords(picks, resolve));

  // Settle sphere on picked title (keep rotating with this title)
  sphere.setWords(wordsFrom(picked.name));

  // Short pause before revealing the monk/poster
  await wait(300);

  // Reveal monk
  const posterUrl = await posterP;
  el.posterImg.setAttribute('href', posterUrl || '');
  el.monkWrap.classList.add('visible');

  // Fill result text
  el.resultYear.textContent = picked.year || '';
  el.resultTitle.textContent = picked.name;
  el.resultLink.href = picked.url || `${LB}/film/${picked.slug}/`;

  screens.result.classList.remove('reveal');
  showScreen('result');
  void screens.result.offsetWidth;
  screens.result.classList.add('reveal');

  spinning = false; el.spinBtn.disabled = false;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Boot ──────────────────────────────────────────────────────────────────────

function boot(db) {
  populateSelect(db);
  const d = new Date(db.updated);
  el.lastUpdated.textContent = `updated ${d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;

  el.spinBtn.onclick = () => spin(db);

  el.spinAgain.onclick = () => {
    el.monkWrap.classList.remove('visible');
    el.posterImg.setAttribute('href', '');
    screens.result.classList.remove('reveal');
    showScreen('controls');
    setTimeout(() => spin(db), 120);
  };

  el.backBtn.onclick = () => {
    el.monkWrap.classList.remove('visible');
    el.posterImg.setAttribute('href', '');
    screens.result.classList.remove('reveal');
    showScreen('controls');
  };

  el.refreshBtn.onclick = () => {
    el.monkWrap.classList.remove('visible');
    sphere.setWords(['OBJECTBOXD']);
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
  try {
    const db = await processFiles(Array.from(files));
    save(db); boot(db);
  } catch (e) { showErr(e.message); }
}

el.fileInput.addEventListener('change', e => handleFiles(e.target.files));
el.dropzone.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') el.fileInput.click(); });
el.dropzone.addEventListener('dragover', e => { e.preventDefault(); el.dropzone.classList.add('drag-over'); });
el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('drag-over'));
el.dropzone.addEventListener('drop', e => {
  e.preventDefault();
  el.dropzone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

// ── Init ──────────────────────────────────────────────────────────────────────

const saved = load();
if (saved?.watchlist?.length || saved?.lists?.length) {
  boot(saved);
} else {
  showScreen('upload');
}
