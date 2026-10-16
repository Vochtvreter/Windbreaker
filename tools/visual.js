#!/usr/bin/env node
/*
 * Windbreaker visual check — did a graphics change alter anything you did not mean to?
 *
 *   node tools/visual.js --baseline     render every scene and keep the pictures as the reference
 *   node tools/visual.js --compare      render again and compare with the reference, pixel by pixel
 *   node tools/visual.js                just render (to screenshots/gfx/current/)
 *   node tools/visual.js --perf         time the board drawing on the busiest scenes (ms per frame)
 *   node tools/visual.js --list         list the scenes
 *
 * Options:
 *   --only a,b          only scenes whose name contains "a" or "b"
 *   --tolerance <pct>   most differing pixels allowed per picture, in % (default 0.05)
 *   --threshold <n>     how much a colour channel (0-255) may change before the pixel
 *                       counts as different (default 0: any change counts)
 *   --live              use today's js/engine.js and js/levels.js instead of the copies
 *                       pinned with the baseline
 *   --from <rev>        with --baseline: render the game as it was at a git revision
 *                       (e.g. HEAD: "what the last commit looked like"), rules and
 *                       levels included, then --compare shows what the working tree changed
 *   --pin-from <rev>    with --baseline: pin engine.js and levels.js from a git revision
 *   --root <dir>        serve the game from another checkout of it
 *   --headed            watch it
 *
 * Every scene is drawn at a frozen moment (window.__wbFreezeTime, see js/render.js):
 * animations are settled and all "random" wind streaks come from a fixed seed, so
 * the same code always draws the same pixels; CSS transitions are off and CSS
 * animations are run to their end before each picture. Each scene is taken in light and dark
 * mode, on a phone (390x844) and a desktop (1280x800).
 *
 * The baseline also keeps a copy of the rules (js/engine.js) and levels
 * (js/levels.js), and --compare plays those copies, so level edits never show up
 * as graphics changes. Besides real levels, three hand-made "gallery" rooms
 * (ids 901-903, tools/gallery.js) show every tool and every object in every state.
 *
 * Pictures go to screenshots/gfx/ (git-ignored): baseline/, current/ and diff/
 * (the diff pictures show changed pixels in magenta over a faded copy).
 * The comparison runs inside the browser (canvas getImageData), so it needs
 * nothing but Playwright with Chromium. Exits 1 when a picture differs by more
 * than the tolerance, there is no baseline at all, or the page logs an error
 * (a scene added since the baseline is reported as new).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots', 'gfx');
const BASE_DIR = path.join(OUT, 'baseline');
const CUR_DIR = path.join(OUT, 'current');
const DIFF_DIR = path.join(OUT, 'diff');
const PIN_DIR = path.join(BASE_DIR, 'pinned');
const MOUNT = '/windbreaker/';
const FREEZE_MS = 4321000; // the frozen moment every scene is drawn at

// ------------------------------------------------------------------ options

const argv = process.argv.slice(2);
function flag(name) { return argv.includes('--' + name); }
function option(name) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
if (flag('help') || flag('h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, '').replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}
const OPTS = {
  baseline: flag('baseline'),
  compare: flag('compare'),
  perf: flag('perf'),
  list: flag('list'),
  only: option('only') ? option('only').split(',').map((s) => s.trim()).filter(Boolean) : null,
  tolerance: option('tolerance') != null ? parseFloat(option('tolerance')) : 0.05,
  threshold: option('threshold') != null ? parseInt(option('threshold'), 10) : 0,
  live: flag('live'),
  pinFrom: option('pin-from') || option('from'),
  from: option('from'),
  root: option('root') ? path.resolve(option('root')) : null,
  headed: flag('headed'),
};
// where the game's files are served from (the working tree, --root or --from)
let GAME_ROOT = OPTS.root || ROOT;
if (OPTS.from && !OPTS.baseline) { console.error('--from only goes with --baseline'); process.exit(2); }

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* try the global install */ }
  try {
    const g = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return require(path.join(g, 'playwright'));
  } catch (e) {
    console.error('Playwright is not installed. Install it with: npm i -g playwright && npx playwright install chromium');
    process.exit(2);
  }
}

// ------------------------------------------------------------------ gallery rooms
// Hand-made rooms that show everything at once (tools/gallery.js). They are
// appended to the levels (not to any chapter), so they open with ?unlock#901 etc.

const GALLERY = require('./gallery.js');

// ------------------------------------------------------------------ scenes
// setup(page, h) runs after the level has opened; h holds small helpers.

const SCENES = [
  { name: 'home', url: '' },
  { name: 'home-unlocked', url: '?unlock', sizes: ['desktop'] },
  { name: 'level-1-start', url: '?unlock#1' },
  { name: 'gallery-tools', url: '?unlock#901', pieces: 'solution', closeWin: true },
  { name: 'gallery-trouble', url: '?unlock#902', pieces: 'solution' },
  { name: 'gallery-quiet', url: '?unlock#903' },
  { name: 'gallery-tools-reduced', url: '?unlock#901', pieces: 'solution', closeWin: true, reduced: true },
  { name: 'gallery-trouble-reduced', url: '?unlock#902', pieces: 'solution', reduced: true },
  {
    name: 'select-fan', url: '?unlock#903',
    setup: async (page, h) => { await page.evaluate(() => window.WBGame.select('fan')); await h.hover(4, 1); },
  },
  {
    name: 'select-window', url: '?unlock#903',
    setup: async (page, h) => { await page.evaluate(() => window.WBGame.select('window')); await h.hover(12, 6); },
  },
  {
    name: 'hint', url: '?unlock#3',
    setup: async (page) => { await page.evaluate(() => window.WBGame.hint()); },
  },
  {
    name: 'help', url: '?unlock#901', sizes: ['phone', 'desktop'],
    setup: async (page) => { await page.click('#btn-help'); await page.waitForSelector('#help:not([hidden])'); },
  },
  { name: 'calm', url: '?unlock#6', pieces: 'solution', closeWin: true },
  { name: 'busy-solved', url: '?unlock#100', pieces: 'solution', winCard: true },
  // the example art manifest (art/examples/art.js): images, layers, states, code, texture, tokens
  { name: 'art-examples', url: '?unlock&art=examples#901', pieces: 'solution', closeWin: true, sizes: ['desktop'] },
  { name: 'art-examples-trouble', url: '?unlock&art=examples#902', pieces: 'solution', sizes: ['phone'] },
];

const SIZES = {
  phone: { w: 390, h: 844, dpr: 2, touch: true, mobile: true },
  desktop: { w: 1280, h: 800, dpr: 1 },
};
const MODES = ['light', 'dark'];

function shots() {
  const list = [];
  for (const sc of SCENES) {
    if (OPTS.only && !OPTS.only.some((o) => sc.name.includes(o))) continue;
    for (const mode of MODES) {
      for (const size of sc.sizes || Object.keys(SIZES)) list.push({ scene: sc, mode, size, file: sc.name + '.' + mode + '.' + size + '.png' });
    }
  }
  return list;
}

// ------------------------------------------------------------------ pinned rules + levels

function readPinned(name) {
  if (OPTS.live) return fs.readFileSync(path.join(GAME_ROOT, 'js', name), 'utf8');
  const p = path.join(PIN_DIR, name);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return fs.readFileSync(path.join(GAME_ROOT, 'js', name), 'utf8');
}
function pin() {
  fs.mkdirSync(PIN_DIR, { recursive: true });
  for (const name of ['engine.js', 'levels.js']) {
    const src = OPTS.pinFrom
      ? execFileSync('git', ['show', OPTS.pinFrom + ':js/' + name], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
      : fs.readFileSync(path.join(GAME_ROOT, 'js', name), 'utf8');
    fs.writeFileSync(path.join(PIN_DIR, name), src);
  }
}
// --from <rev>: the whole game as it was at that revision, in a temporary folder
function checkoutRev(rev) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-visual-'));
  const tar = execFileSync('git', ['archive', '--format=tar', rev], { cwd: ROOT, maxBuffer: 256 << 20 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return dir;
}
const INFO_FILE = path.join(BASE_DIR, 'baseline.json');
function readInfo() { try { return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8')); } catch (e) { return null; } }
function levelsJs() {
  return readPinned('levels.js') + '\n/* tools/visual.js gallery rooms */\n(function (root) { root.WB.LEVELS = root.WB.LEVELS.concat(' +
    JSON.stringify(GALLERY) + '); })(self);\n';
}

// ------------------------------------------------------------------ static server (mounted like GitHub Pages)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};
function startServer() {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { p = '/'; }
    if (!p.startsWith(MOUNT)) { res.writeHead(404); res.end(); return; }
    let rel = p.slice(MOUNT.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const send = (body, type) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (rel === 'js/levels.js') return send(levelsJs(), TYPES['.js']);
    if (rel === 'js/engine.js') return send(readPinned('engine.js'), TYPES['.js']);
    const file = path.join(GAME_ROOT, path.normalize('/' + rel));
    if (!file.startsWith(GAME_ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      send(data, TYPES[path.extname(file)] || 'application/octet-stream');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------------ rendering

const problems = [];
const warnings = new Set();

async function newContext(browser, mode, sizeName, reduced) {
  const sz = SIZES[sizeName];
  const ctx = await browser.newContext({
    viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: sz.dpr,
    hasTouch: !!sz.touch, isMobile: !!sz.mobile,
    colorScheme: mode, reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await ctx.addInitScript((freeze) => {
    window.__wbFreezeTime = freeze;
    try { localStorage.clear(); } catch (e) { /* no storage */ }
    // No CSS transitions: an element that just transitioned can stay on its
    // own compositor layer for a while and be rasterised a shade differently.
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '*, *::before, *::after { transition: none !important; }';
      document.head.appendChild(st);
    });
  }, FREEZE_MS);
  return ctx;
}

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(label + ': console.error: ' + m.text());
    else if (m.type() === 'warning') warnings.add(m.text());
  });
  page.on('pageerror', (e) => problems.push(label + ': uncaught: ' + (e.stack || e.message)));
  page.on('requestfailed', (r) => problems.push(label + ': request failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(label + ': HTTP ' + r.status() + ' ' + r.url()); });
}

const frames = (page, n) => page.evaluate((k) => new Promise((done) => {
  (function tick(i) { if (i <= 0) done(); else requestAnimationFrame(() => tick(i - 1)); })(k);
}), n || 3);

async function waitFor(page, fn, what, timeout) {
  try { await page.waitForFunction(fn, null, { timeout: timeout || 5000, polling: 50 }); } catch (e) { throw new Error('timed out waiting for ' + what); }
}

async function renderShot(page, shot, base) {
  const sc = shot.scene;
  await page.goto(base + sc.url);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  if (/[?&]art=/.test(sc.url)) await waitFor(page, () => window.WBSprites && window.WBSprites.ready(), 'the art manifest and its images');
  if (/#\d+/.test(sc.url)) {
    await waitFor(page, () => window.__wb && window.__wb.state().screen === 'game' && window.__wb.state().T > 0, 'the level to open');
    if (sc.pieces === 'solution') {
      await page.evaluate(() => window.WBGame.solve());
      const solved = await page.evaluate(() => window.__wb.state().solved);
      if (solved) {
        await waitFor(page, () => !document.getElementById('win').hidden, 'the win card');
        if (!sc.winCard) {
          await page.keyboard.press('Escape');
          await waitFor(page, () => document.getElementById('win').hidden, 'the win card to close');
        }
      }
    }
    const h = {
      hover: async (x, y) => {
        const c = await page.evaluate(([cx, cy]) => window.__wb.cell(cx, cy), [x, y]);
        await page.mouse.move(c.x, c.y);
      },
    };
    if (sc.setup) await sc.setup(page, h);
  } else {
    await page.waitForSelector('#home:not([hidden]) .lvl');
  }
  await frames(page, 3);
  await settleCss(page);
  return page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'device' });
}

// Runs every finite CSS transition and animation to its end (a goal chip that
// just changed state fades its outline in over .25s) until the page is still.
async function settleCss(page) {
  for (let i = 0; i < 10; i++) {
    const running = await page.evaluate(() => {
      let n = 0;
      for (const a of document.getAnimations()) {
        const t = a.effect && a.effect.getComputedTiming();
        if (a.playState === 'running' && t && isFinite(t.endTime)) { a.finish(); n++; }
      }
      return n;
    });
    if (!running) return;
    await frames(page, 2);
  }
}

async function renderAll(browser, base, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const list = shots();
  const groups = {};
  for (const s of list) {
    const k = s.mode + '|' + s.size + '|' + (s.scene.reduced ? 'r' : '');
    (groups[k] = groups[k] || []).push(s);
  }
  const out = [];
  for (const k of Object.keys(groups)) {
    const g = groups[k];
    const ctx = await newContext(browser, g[0].mode, g[0].size, !!g[0].scene.reduced);
    const page = await ctx.newPage();
    watch(page, k);
    for (const s of g) {
      const t = Date.now();
      try {
        const png = await renderShot(page, s, base);
        fs.writeFileSync(path.join(dir, s.file), png);
        out.push(s);
        console.log('  ok   ' + s.file + dim(' (' + (Date.now() - t) + ' ms)'));
      } catch (e) {
        problems.push(s.file + ': ' + e.message);
        console.log('  FAIL ' + s.file + ' — ' + e.message);
      }
    }
    await ctx.close();
  }
  return out;
}

// ------------------------------------------------------------------ comparison (in the browser)

async function compareAll(browser, list) {
  fs.mkdirSync(DIFF_DIR, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } });
  const page = await ctx.newPage();
  watch(page, 'compare');
  await page.setContent('<!doctype html><title>compare</title>');
  const rows = [];
  for (const s of list) {
    const bp = path.join(BASE_DIR, s.file), cp = path.join(CUR_DIR, s.file);
    if (!fs.existsSync(bp)) { rows.push({ file: s.file, missing: true }); continue; }
    const a = 'data:image/png;base64,' + fs.readFileSync(bp).toString('base64');
    const b = 'data:image/png;base64,' + fs.readFileSync(cp).toString('base64');
    const r = await page.evaluate(async ([srcA, srcB, threshold]) => {
      function load(src) {
        return new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('bad png')); im.src = src; });
      }
      function pixels(im) {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0);
        return x.getImageData(0, 0, c.width, c.height);
      }
      const A = pixels(await load(srcA)), B = pixels(await load(srcB));
      if (A.width !== B.width || A.height !== B.height) return { sizeA: A.width + 'x' + A.height, sizeB: B.width + 'x' + B.height };
      const n = A.width * A.height, da = A.data, db = B.data;
      const c = document.createElement('canvas');
      c.width = A.width; c.height = A.height;
      const x = c.getContext('2d');
      const D = x.createImageData(A.width, A.height), dd = D.data;
      let diff = 0, maxDelta = 0;
      for (let i = 0; i < n * 4; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
        if (d > maxDelta) maxDelta = d;
        if (d > threshold) { diff++; dd[i] = 255; dd[i + 1] = 0; dd[i + 2] = 200; dd[i + 3] = 255; }
        else { const g = (da[i] + da[i + 1] + da[i + 2]) / 3; dd[i] = dd[i + 1] = dd[i + 2] = 255 - (255 - g) * 0.25; dd[i + 3] = 255; }
      }
      let png = null;
      if (diff) { x.putImageData(D, 0, 0); png = c.toDataURL('image/png'); }
      return { pct: diff / n * 100, diff, n, maxDelta, png };
    }, [a, b, OPTS.threshold]);
    if (r.png) fs.writeFileSync(path.join(DIFF_DIR, s.file), Buffer.from(r.png.split(',')[1], 'base64'));
    else if (fs.existsSync(path.join(DIFF_DIR, s.file))) fs.unlinkSync(path.join(DIFF_DIR, s.file));
    rows.push(Object.assign({ file: s.file }, r, { png: undefined }));
  }
  await ctx.close();
  return rows;
}

// ------------------------------------------------------------------ performance

async function perf(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'perf');
  const out = [];
  for (const url of ['?unlock#100', '?unlock#901', '?unlock#902']) {
    await page.goto(base + url);
    await waitFor(page, () => window.__wb && window.__wb.state().screen === 'game' && window.__wb.state().T > 0, 'the level to open');
    await page.evaluate(() => window.WBGame.solve());
    await page.waitForTimeout(1800);
    await page.keyboard.press('Escape');
    const r = await page.evaluate(() => new Promise((done) => {
      const b = window.WBGame.board, orig = b.draw, times = [];
      b.draw = function (S, now) { const t0 = performance.now(); orig.call(this, S, now); times.push(performance.now() - t0); };
      setTimeout(() => {
        b.draw = orig;
        times.sort((p, q) => p - q);
        const mean = times.reduce((p, q) => p + q, 0) / times.length;
        done({ frames: times.length, mean, median: times[times.length >> 1], p95: times[Math.floor(times.length * 0.95)] });
      }, 4000);
    }));
    out.push(Object.assign({ scene: url.replace('?unlock#', 'level ') }, r));
  }
  await ctx.close();
  return out;
}

// ------------------------------------------------------------------ main

function dim(s) { return process.stdout.isTTY ? '\x1b[2m' + s + '\x1b[0m' : s; }

(async function main() {
  if (OPTS.list) {
    shots().forEach((s) => console.log(s.file));
    return;
  }
  let tmp = null;
  if (OPTS.from) {
    tmp = GAME_ROOT = checkoutRev(OPTS.from);
    process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
  }
  if (OPTS.baseline) pin();
  const { chromium } = loadPlaywright();
  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port + MOUNT;
  const browser = await chromium.launch({ headless: !OPTS.headed });
  let failed = false;
  const T0 = Date.now();
  try {
    const pinned = !OPTS.live && fs.existsSync(path.join(PIN_DIR, 'levels.js'));
    console.log('Windbreaker visual check · ' + (pinned ? 'rules + levels pinned with the baseline' : 'live rules + levels') + ' · chromium ' + browser.version());
    if (OPTS.from) console.log('rendering the game as of ' + OPTS.from + ' (' + execFileSync('git', ['rev-parse', '--short', OPTS.from], { cwd: ROOT, encoding: 'utf8' }).trim() + ')');
    else if (GAME_ROOT !== ROOT) console.log('rendering the game in ' + GAME_ROOT);
    const info = readInfo();
    if (OPTS.compare && info) console.log('baseline: ' + info.game + ', taken ' + info.date + (info.chromium !== browser.version() ? ' with chromium ' + info.chromium + ' (now ' + browser.version() + ': expect small differences)' : ''));
    if (OPTS.perf) {
      const rows = await perf(browser, base);
      console.log('\nboard drawing time (desktop, 2x, solved, moving):');
      rows.forEach((r) => console.log('  ' + r.scene.padEnd(10) + ' mean ' + r.mean.toFixed(2) + ' ms · median ' + r.median.toFixed(2) + ' ms · p95 ' + r.p95.toFixed(2) + ' ms (' + r.frames + ' frames)'));
    } else {
      const dir = OPTS.baseline ? BASE_DIR : CUR_DIR;
      console.log('\nrendering ' + shots().length + ' pictures to ' + path.relative(process.cwd(), dir) + '/');
      const done = await renderAll(browser, base, dir);
      if (OPTS.baseline) {
        fs.writeFileSync(INFO_FILE, JSON.stringify({
          game: OPTS.from ? 'git ' + OPTS.from + ' (' + execFileSync('git', ['rev-parse', '--short', OPTS.from], { cwd: ROOT, encoding: 'utf8' }).trim() + ')' : GAME_ROOT === ROOT ? 'the working tree' : GAME_ROOT,
          rules: OPTS.pinFrom ? 'git ' + OPTS.pinFrom : 'the working tree',
          date: new Date().toISOString().slice(0, 16).replace('T', ' '),
          chromium: browser.version(),
        }, null, 2) + '\n');
      }
      if (OPTS.compare) {
        console.log('\ncomparing with ' + path.relative(process.cwd(), BASE_DIR) + '/ (a pixel counts as changed when a channel moves by more than ' + OPTS.threshold + ')');
        const rows = await compareAll(browser, done);
        let worst = 0;
        for (const r of rows) {
          let line, bad = false;
          if (r.missing) { line = 'new: no baseline yet'; bad = !rows.some((q) => !q.missing); }
          else if (r.sizeA) { line = 'size changed: ' + r.sizeA + ' -> ' + r.sizeB; bad = true; }
          else {
            worst = Math.max(worst, r.pct);
            bad = r.pct > OPTS.tolerance;
            line = (r.diff ? r.pct.toFixed(4) + '% changed (' + r.diff + ' px, max channel delta ' + r.maxDelta + ') · diff/' + r.file : 'identical');
          }
          if (bad) failed = true;
          console.log('  ' + (bad ? 'FAIL ' : 'ok   ') + r.file.padEnd(44) + ' ' + line);
        }
        console.log('\nworst picture: ' + worst.toFixed(4) + '% changed (tolerance ' + OPTS.tolerance + '%)');
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  warnings.forEach((w) => console.log('  note console.warn: ' + w));
  if (problems.length) {
    failed = true;
    console.log('\nproblems:');
    problems.forEach((p) => console.log('  FAIL ' + p));
  }
  console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ' · ' + ((Date.now() - T0) / 1000).toFixed(1) + ' s');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
