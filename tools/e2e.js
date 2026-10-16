#!/usr/bin/env node
/*
 * Windbreaker end-to-end test.
 *
 * Drives the real game in headless Chromium through real input only: mouse
 * clicks and drags, touch taps, long-presses and drags (CDP touch events) and
 * the keyboard. The game is only *read* through the small window.__wb hook
 * (cell -> pixel mapping and a state snapshot) to know where to click and to
 * check the outcome.
 *
 *   node tools/e2e.js                        all sections, levels from js/levels.js
 *   node tools/e2e.js --levels other.js      serve another levels file as js/levels.js
 *   node tools/e2e.js --only walk,touch      run some sections
 *   node tools/e2e.js --full-motion          walk all levels without reduced motion (slower)
 *   node tools/e2e.js --headed               watch it
 *
 * Sections: home, walk, interact, touch, mobile, storage, file.
 * It starts its own static server (Node http, no dependencies) on a free port
 * and mounts the site under /windbreaker/, like GitHub Pages does, so any
 * absolute path in the game would 404 and fail the run. Needs Playwright with
 * Chromium (global install is fine). Exits 1 on any failure, including console
 * errors and uncaught page errors. Screenshots go to screenshots/e2e/.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots', 'e2e');
const MOUNT = '/windbreaker/';
const WB = require(path.join(ROOT, 'js', 'engine.js'));

// ------------------------------------------------------------------ options

const argv = process.argv.slice(2);
function flag(name) { return argv.includes('--' + name); }
function option(name) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
if (flag('help') || flag('h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}
const OPTS = {
  levels: option('levels') ? path.resolve(option('levels')) : null,
  only: option('only') ? option('only').split(',').map((s) => s.trim()).filter(Boolean) : null,
  fullMotion: flag('full-motion'),
  headed: flag('headed'),
  shots: !flag('no-shots'),
};
const SECTIONS = ['home', 'walk', 'interact', 'touch', 'mobile', 'storage', 'file'];
if (OPTS.only) {
  const bad = OPTS.only.filter((s) => !SECTIONS.includes(s));
  if (bad.length) { console.error('Unknown section(s): ' + bad.join(', ') + '. Known: ' + SECTIONS.join(', ')); process.exit(2); }
}
if (OPTS.levels && !fs.existsSync(OPTS.levels)) { console.error('No such levels file: ' + OPTS.levels); process.exit(2); }

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
const { chromium } = loadPlaywright();

// ------------------------------------------------------------------ fixture levels
// Two tiny hand-made levels for the interaction tests, so they do not depend on
// how the real levels are designed. Same format as js/levels.js.

const FIXTURE = {
  chapters: [{ n: 1, title: 'Test Rooms', tool: 'fan', first: 1, last: 2 }],
  levels: [
    {
      id: 1, chapter: 1, name: 'Test Room', tip: 'A fixture level for the end-to-end test.',
      wind: { from: 'W', strength: 1 },
      map: ['##########', '#........#', '#...p....#', '#........#', '#........#', '##########'],
      fixed: [{ type: 'window', x: 0, y: 2 }],
      inventory: { window: 2, fan: 1, deflector: 1 },
      solution: [{ type: 'window', x: 9, y: 2 }],
    },
    {
      id: 2, chapter: 1, name: 'Test Calm',
      wind: { from: 'N', strength: 0 },
      map: ['#########', '#.......#', '#..p....#', '#.......#', '#########'],
      fixed: [],
      inventory: { fan: 1 },
      solution: [{ type: 'fan', x: 3, y: 1, d: 2 }],
    },
  ],
};
const FIXTURE_JS = '(function (root) { var data = ' + JSON.stringify(FIXTURE) +
  '; root.WB = root.WB || {}; root.WB.CHAPTERS = data.chapters; root.WB.LEVELS = data.levels; })(self);\n';

// Sanity: the fixtures behave the way the interaction tests assume.
(function checkFixtures() {
  for (const def of FIXTURE.levels) {
    const errs = WB.validateLevel(def);
    if (errs.length) throw new Error('fixture level ' + def.id + ': ' + errs.join('; '));
    const L = WB.parseLevel(def);
    if (WB.isSolved(L, L.fixed)) throw new Error('fixture level ' + def.id + ' is solved when empty');
    if (!WB.isSolved(L, L.fixed.concat(def.solution))) throw new Error('fixture level ' + def.id + ' solution does not solve');
  }
  const L1 = WB.parseLevel(FIXTURE.levels[0]);
  // every intermediate board the interaction test builds on level 1 must stay unsolved
  const boards = [
    [{ type: 'fan', x: 1, y: 4, d: 1 }], [{ type: 'fan', x: 3, y: 4, d: 0 }], [{ type: 'fan', x: 3, y: 4, d: 1 }],
    [{ type: 'fan', x: 3, y: 4, d: 2 }], [{ type: 'fan', x: 3, y: 4, d: 3 }],
    [{ type: 'fan', x: 3, y: 4, d: 3 }, { type: 'window', x: 2, y: 0 }], [{ type: 'window', x: 2, y: 0 }],
    [{ type: 'window', x: 6, y: 0 }], [{ type: 'window', x: 2, y: 0 }, { type: 'window', x: 6, y: 0 }],
  ];
  boards.forEach((b) => { if (WB.isSolved(L1, L1.fixed.concat(b))) throw new Error('fixture board solves level 1: ' + JSON.stringify(b)); });
})();

// ------------------------------------------------------------------ static server

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function startServer() {
  const served = [];
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { p = '/'; }
    served.push(p);
    if (!p.startsWith(MOUNT)) { res.writeHead(404); res.end('not under ' + MOUNT); return; }
    let rel = p.slice(MOUNT.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let file = path.join(ROOT, path.normalize('/' + rel));
    if (rel === 'js/levels.js' && OPTS.levels) file = OPTS.levels;
    if (!file.startsWith(ROOT) && file !== OPTS.levels) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    server.served = served;
    resolve(server);
  }));
}

// ------------------------------------------------------------------ tiny test framework

const results = [];
const consoleProblems = [];
const consoleWarnings = new Set();
const T0 = Date.now();

class Skip extends Error {}

function fail(msg) { throw new Error(msg); }
function assert(cond, msg) { if (!cond) fail(msg); }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) fail(msg + '\n         expected ' + e + '\n         got      ' + a);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A section is a list of steps sharing one page; the first failing step skips
// the rest of its section (they would only fail in its wake).
async function section(name, fn) {
  if (OPTS.only && !OPTS.only.includes(name)) return;
  console.log('\n' + name);
  let broken = null;
  const step = async (title, body) => {
    if (broken) { results.push({ section: name, title, skipped: true }); console.log('  skip ' + title); return; }
    const t = Date.now();
    try {
      await body();
      results.push({ section: name, title, ok: true });
      console.log('  ok   ' + title + dim(' (' + (Date.now() - t) + ' ms)'));
    } catch (e) {
      if (e instanceof Skip) { results.push({ section: name, title, skipped: true }); console.log('  skip ' + title + ' — ' + e.message); return; }
      broken = title;
      results.push({ section: name, title, ok: false, error: e });
      console.log('  FAIL ' + title + '\n       ' + String(e && e.message || e).split('\n').join('\n       '));
    }
  };
  try {
    await fn(step);
  } catch (e) {
    results.push({ section: name, title: '(section crashed)', ok: false, error: e });
    console.log('  FAIL section crashed: ' + (e && e.stack || e));
  }
}
function dim(s) { return process.stdout.isTTY ? '\x1b[2m' + s + '\x1b[0m' : s; }

// ------------------------------------------------------------------ page helpers

let browser, server, BASE;

async function newPage(opts) {
  opts = opts || {};
  const ctx = await browser.newContext({
    viewport: { width: opts.w || 1280, height: opts.h || 800 },
    deviceScaleFactor: opts.dpr || 1,
    hasTouch: !!opts.touch,
    isMobile: !!opts.mobile,
    colorScheme: opts.dark ? 'dark' : 'light',
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
  });
  if (opts.fixture) {
    await ctx.route('**/js/levels.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIXTURE_JS }));
  }
  if (opts.noStorage) {
    await ctx.addInitScript(() => {
      const deny = { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } };
      Object.defineProperty(window, 'localStorage', deny);
      Object.defineProperty(window, 'sessionStorage', deny);
    });
  }
  // a short log of the input events the page saw, printed when a step fails
  await ctx.addInitScript(() => {
    const log = window.__inputLog = [];
    const desc = (t) => !t || !t.tagName ? '?' : t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') +
      (t.getAttribute && t.getAttribute('data-tool') ? '[' + t.getAttribute('data-tool') + ']' : '') + (t.className && typeof t.className === 'string' && !t.id ? '.' + t.className.split(' ')[0] : '');
    ['pointerdown', 'pointerup', 'pointercancel', 'click', 'contextmenu', 'keydown'].forEach((type) => {
      window.addEventListener(type, (e) => {
        log.push(Math.round(performance.now()) + ' ' + type + (e.pointerType ? ':' + e.pointerType : '') + (e.key ? ':' + e.key : '') +
          (e.clientX != null ? ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY) : '') + ' ' + desc(e.target));
        if (log.length > 16) log.shift();
      }, true);
    });
  });
  const page = await ctx.newPage();
  const label = opts.label || 'page';
  page.on('console', (m) => {
    if (m.type() === 'error') consoleProblems.push(label + ': console.error: ' + m.text() + (m.location() && m.location().url ? ' @ ' + m.location().url : ''));
    else if (m.type() === 'warning') consoleWarnings.add(m.text());
  });
  page.on('pageerror', (e) => consoleProblems.push(label + ': uncaught: ' + (e.stack || e.message)));
  page.on('requestfailed', (r) => consoleProblems.push(label + ': request failed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400) consoleProblems.push(label + ': HTTP ' + r.status() + ' ' + r.url()); });
  return page;
}

async function state(page) { return page.evaluate(() => window.__wb.state()); }

// Polls the game state until pred(state) holds.
async function expectState(page, pred, what, timeout) {
  const until = Date.now() + (timeout || 2500);
  let s;
  for (;;) {
    s = await state(page);
    if (pred(s)) return s;
    if (Date.now() > until) {
      const events = await page.evaluate(() => (window.__inputLog || []).slice(-10)).catch(() => []);
      fail('timed out waiting for: ' + what + '\n         state: ' + JSON.stringify({
        screen: s.screen, id: s.id, sel: s.sel, pieces: s.pieces, won: s.won, hint: s.hint, conflicts: s.conflicts, undo: s.undo, redo: s.redo,
      }) + (events.length ? '\n         last input events (ms):\n           ' + events.join('\n           ') : ''));
    }
    await sleep(20);
  }
}

// Waits until the board stops moving (layout settles after cards and tips render).
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    let last = '', same = 0, n = 0;
    (function tick() {
      const a = window.__wb.cell(0, 0), r = document.getElementById('board').getBoundingClientRect();
      const k = [a.x, a.y, a.size, r.width, r.height].join(',');
      if (k === last) same++; else { same = 0; last = k; }
      if (same >= 2 || ++n > 90) resolve(); else requestAnimationFrame(tick);
    })();
  }));
}

async function cellXY(page, x, y) { return page.evaluate(([x, y]) => window.__wb.cell(x, y), [x, y]); }

// Fails if anything is covering the board at that point (a real tap would miss).
async function assertBoardAt(page, pt, what) {
  const hit = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    if (!e) return 'nothing (off-screen)';
    if (e.id === 'board') return null;
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') +
      (e.closest('[id]') && e.closest('[id]') !== e ? ' in #' + e.closest('[id]').id : '');
  }, [pt.x, pt.y]);
  if (hit) fail((what || 'board cell') + ' at (' + Math.round(pt.x) + ',' + Math.round(pt.y) + ') is covered by ' + hit);
}

async function clickCell(page, x, y, opts) {
  const pt = await cellXY(page, x, y);
  await assertBoardAt(page, pt, 'cell ' + x + ',' + y);
  await page.mouse.click(pt.x, pt.y, opts);
  return pt;
}

async function center(page, selector) {
  const loc = page.locator(selector);
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) fail('not visible: ' + selector);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}

async function mouseDrag(page, from, to, steps) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: steps || 12 });
  await page.mouse.up();
}

// Touch through CDP, so the game sees real touch pointer events.
async function cdp(page) {
  if (!page.__cdp) page.__cdp = await page.context().newCDPSession(page);
  return page.__cdp;
}
async function touch(page, type, pt) {
  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: pt.x, y: pt.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
}
// Like a finger: ease in and out, rest on the target before lifting (a fast
// release is a fling, and Chrome then swallows the next tap), then a short pause.
async function touchDrag(page, from, to, steps) {
  steps = steps || 14;
  await touch(page, 'touchStart', from);
  for (let i = 1; i <= steps; i++) {
    const k = 0.5 - Math.cos(Math.PI * i / steps) / 2;
    await touch(page, 'touchMove', { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
    await sleep(12);
  }
  for (let i = 0; i < 4; i++) { await touch(page, 'touchMove', to); await sleep(25); }
  await touch(page, 'touchEnd', null);
  await sleep(120);
}
async function longPress(page, pt, ms) {
  await touch(page, 'touchStart', pt);
  await sleep(ms || 650);
  await touch(page, 'touchEnd', null);
}

function key(p) { return p.type + '@' + p.x + ',' + p.y + (WB.TOOLS[p.type].rotations > 1 ? '/' + (p.d | 0) : ''); }

// The "Meet the …" card a level brings (js/guides.js): the chapter's new thing
// on the chapter's first level, or a twist on the first level that has it.
function levelGuides(data) {
  const out = {}, seen = {};
  data.levels.forEach((lv) => {
    const ch = data.chapters.find((c) => lv.id >= c.first && lv.id <= c.last);
    const intro = ch && (ch.intro || (ch.tool ? { kind: 'tool', id: ch.tool } : null));
    if (intro && ch.first === lv.id) out[lv.id] = intro.id;
    WB.levelConditions(lv).forEach((c) => { if (!seen[c]) { seen[c] = true; if (!out[lv.id]) out[lv.id] = c; } });
  });
  return out;
}
// The level's tip as the guidance line says it (screen words, not compass words).
const SIDE = { north: 'top', east: 'right', south: 'bottom', west: 'left' };
// (the walk plays with a mouse, so "tap" reads "click")
function plainTip(t) {
  return String(t || '').replace(/\bfrom the (north|east|south|west)\b/gi, (m, d) => 'from the ' + SIDE[d.toLowerCase()])
    .replace(/\bTap\b/g, 'Click').replace(/\btap\b/g, 'click');
}
async function guideUi(page) {
  return page.evaluate(() => {
    const g = document.getElementById('guide'), line = document.getElementById('guide-line');
    return {
      card: g.hidden ? null : (document.getElementById('guide-title') || {}).textContent || '',
      line: line.hidden ? null : document.getElementById('tip').textContent,
      more: !line.hidden && !document.getElementById('tip-more').hidden,
    };
  });
}
function keys(list) { return list.map(key).sort(); }

async function shot(page, name) {
  if (!OPTS.shots) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function noHorizontalScroll(page, where) {
  const r = await page.evaluate(() => {
    const d = document.documentElement;
    const sw = Math.max(d.scrollWidth, document.body.scrollWidth);
    window.scrollTo(200, window.scrollY);
    const sx = window.scrollX;
    window.scrollTo(0, window.scrollY);
    const over = [];
    document.querySelectorAll('body *').forEach((e) => {
      if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return;
      const b = e.getBoundingClientRect();
      if (b.width && b.right > window.innerWidth + 1 && !e.closest('.tray')) over.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) + ' right=' + Math.round(b.right));
    });
    return { sw, cw: d.clientWidth, iw: window.innerWidth, sx, over: over.slice(0, 6) };
  });
  assert(r.sw <= r.iw && r.sx === 0, where + ': horizontal scroll (scrollWidth ' + r.sw + ' > ' + r.iw + ', scrollX ' + r.sx + ')' + (r.over.length ? '; wide: ' + r.over.join(', ') : ''));
}

async function openHome(page, query) {
  await page.goto(BASE + (query || ''));
  await page.waitForSelector('#home:not([hidden]) .lvl');
}

// Reads levels and chapters from the page (whatever js/levels.js is served).
async function levelData(page) {
  return page.evaluate(() => ({ levels: window.WB.LEVELS, chapters: window.WB.CHAPTERS }));
}

// Places a reference solution exactly like a player would: select the tray
// chip, click the cell, then click the piece until it faces the right way.
// Stops early if the level is already won (a subset of the solution can solve).
async function placeSolution(page, solution, how) {
  for (const p of solution) {
    let s = await state(page);
    if (s.won) return;
    const rots = WB.TOOLS[p.type].rotations;
    if (s.sel !== p.type) {
      if (how === 'touch') await page.tap('.chip[data-tool="' + p.type + '"]');
      else await page.click('.chip[data-tool="' + p.type + '"]');
      s = await expectState(page, (st) => st.sel === p.type || st.won, 'tool "' + p.type + '" selected after tapping its chip');
      if (s.won) return;
    }
    const before = s.pieces.length;
    const pt = await cellXY(page, p.x, p.y);
    await assertBoardAt(page, pt, p.type + ' target ' + p.x + ',' + p.y);
    if (how === 'touch') await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
    s = await expectState(page, (st) => st.won || st.pieces.length === before + 1 && st.pieces.some((q) => q.type === p.type && q.x === p.x && q.y === p.y),
      p.type + ' placed at ' + p.x + ',' + p.y);
    if (rots > 1) {
      const want = (p.d | 0) % rots;
      for (let i = 0; i < rots; i++) {
        if (s.won) return;
        const cur = s.pieces.find((q) => q.x === p.x && q.y === p.y);
        if (cur.d === want) break;
        await assertBoardAt(page, pt, p.type + ' at ' + p.x + ',' + p.y + ' (to turn it)');
        if (how === 'touch') await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
        const was = cur.d;
        s = await expectState(page, (st) => st.won || st.pieces.find((q) => q.x === p.x && q.y === p.y && q.type === p.type).d !== was,
          p.type + ' at ' + p.x + ',' + p.y + ' turned by a tap');
      }
      if (!s.won) eq(s.pieces.find((q) => q.x === p.x && q.y === p.y).d, want, p.type + ' at ' + p.x + ',' + p.y + ' direction after turning');
    }
  }
}

// ------------------------------------------------------------------ sections

async function sectionHome() {
  await section('home', async (step) => {
    const page = await newPage({ label: 'home' });
    let data;
    await step('level select renders', async () => {
      await openHome(page);
      data = await levelData(page);
      assert(data.levels.length > 0, 'WB.LEVELS is empty');
      eq(await page.title(), 'Windbreaker', 'document title');
      assert(await page.isVisible('#home-title'), 'title visible');
      assert(/fresh air/i.test(await page.textContent('.tagline')), 'tagline');
      eq((await page.textContent('#btn-play')).trim(), 'Play', 'play button on a fresh start');
      const chapters = await page.$$eval('#chapters > section', (s) => s.length);
      eq(chapters, data.chapters.length, 'one block per chapter');
      const first = await page.$eval('.lvl[data-level="' + data.levels[0].id + '"]', (b) => ({ disabled: b.getAttribute('aria-disabled') === 'true', cls: b.className }));
      assert(!first.disabled && /is-next/.test(first.cls), 'first level is open and highlighted: ' + JSON.stringify(first));
      const toolIcons = await page.$$eval('#chapters .ch-icon', (c) => c.filter((x) => x.width > 0).length);
      assert(toolIcons >= Math.min(data.chapters.length, 1), 'chapter icons are drawn');
      await shot(page, 'home');
    });
    await step('locked levels do not open, a tap says why', async () => {
      const second = data.levels[1];
      if (!second) throw new Skip('only one level');
      const b = await page.$eval('.lvl[data-level="' + second.id + '"]', (e) => ({ disabled: e.getAttribute('aria-disabled') === 'true', label: e.getAttribute('aria-label') }));
      assert(b.disabled && /locked/.test(b.label), 'level ' + second.id + ' is locked: ' + JSON.stringify(b));
      const c = await center(page, '.lvl[data-level="' + second.id + '"]');
      await page.mouse.click(c.x, c.y);
      await sleep(150);
      assert(await page.isVisible('#home') && await page.isHidden('#game'), 'clicking a locked level does not open it');
      assert(/Solve level \d+ to unlock/.test(await page.textContent('#home-toast')) && await page.isVisible('#home-toast'), 'it says which level to solve first');
      // a deep link to a locked level lands on the level select
      await page.goto(BASE + '#' + second.id);
      await page.waitForSelector('#home:not([hidden]) .lvl');
      assert(await page.isHidden('#game'), 'a locked level cannot be opened by URL');
      const enabled = await page.$$eval('.lvl', (bs) => bs.filter((x) => x.getAttribute('aria-disabled') !== 'true').length);
      eq(enabled, 1, 'only one level open on a fresh start');
    });
    await step('?unlock opens every level', async () => {
      await openHome(page, '?unlock');
      const r = await page.$$eval('.lvl', (bs) => ({ n: bs.length, disabled: bs.filter((x) => x.getAttribute('aria-disabled') === 'true').length }));
      eq(r, { n: data.levels.length, disabled: 0 }, 'every level button present and enabled');
      const last = data.levels[data.levels.length - 1];
      await page.click('.lvl[data-level="' + last.id + '"]');
      await expectState(page, (s) => s.screen === 'game' && s.id === last.id, 'last level opens with ?unlock');
      assert(new URL(page.url()).search === '?unlock', 'the unlock flag survives navigation');
      await page.click('#btn-back');
      await page.waitForSelector('#home:not([hidden])');
      await shot(page, 'home-unlocked');
    });
    await page.context().close();
  });
}

// Every level: open it, check its screen, ask for a hint, place the reference
// solution like a player, see the win card, click Next.
async function sectionWalk() {
  await section('walk', async (step) => {
    const page = await newPage({ label: 'walk', reduced: !OPTS.fullMotion });
    // levels solved after a failure are played with ?unlock, which keeps its own progress
    let data, solvedIds = [], solvedUnlocked = [];
    const problems = [];
    await step('open level 1 from Play', async () => {
      await openHome(page);
      data = await levelData(page);
      await page.click('#btn-play');
      await expectState(page, (s) => s.screen === 'game' && s.id === data.levels[0].id, 'first level opens');
    });
    if (!data) return;
    const chapterOf = (id) => data.chapters.find((c) => id >= c.first && id <= c.last);
    // every new tool, object and twist brings its card on the level that introduces it
    const cards = levelGuides(data);
    const guides = await page.evaluate(() => window.WB.GUIDES || {});
    let unlocked = false; // set after a failure, to keep walking
    for (let i = 0; i < data.levels.length; i++) {
      const lv = data.levels[i];
      const next = data.levels[i + 1];
      const title = 'level ' + lv.id + ' "' + lv.name + '"';
      const t = Date.now();
      try {
        await expectState(page, (s) => s.screen === 'game' && s.id === lv.id, title + ' open');
        await settle(page);
        const ui = await page.evaluate(() => ({
          num: document.getElementById('lvl-num').textContent,
          chips: Array.from(document.querySelectorAll('.chip')).map((c) => [c.getAttribute('data-tool'), c.querySelector('.chip-count').textContent]),
          goals: document.querySelectorAll('#goals .goal').length,
          hash: location.hash,
        }));
        eq(ui.num, String(lv.id), title + ': level number in the top bar');
        eq(ui.hash, '#' + lv.id, title + ': URL hash');
        const inv = WB.TOOL_ORDER.filter((tt) => (lv.inventory[tt] || 0) > 0).map((tt) => [tt, String(lv.inventory[tt])]);
        eq(ui.chips, inv, title + ': tray chips and counts');
        const L = WB.parseLevel(lv);
        eq(ui.goals, new Set(L.objects.map((o) => o.type)).size, title + ': goals strip has one entry per object type');
        const ch = chapterOf(lv.id);
        const card = cards[lv.id] && guides[cards[lv.id]];
        eq((await state(page)).levelGuide, cards[lv.id] || null, title + ': the card this level brings');
        let gu = await guideUi(page);
        if (card && !unlocked) {
          // one voice: the card, and no tip line beside it
          eq(gu.card, 'Meet the ' + card.title.toLowerCase(), title + ': "Meet the …" card');
          eq(gu.line, null, title + ': no tip line while the card is open');
          if (i === 0) await shot(page, 'walk-level-' + lv.id + '-card');
          await page.click('#guide-go');
          gu = await guideUi(page);
          eq(gu.card, null, title + ': "Let\u2019s try it" folds the card away');
          assert(gu.more, title + ': the guidance line can open the card again');
          const want = i === 0 ? 'Make the pinwheel spin!' : lv.tip ? plainTip(lv.tip) : card.oneLiner.replace(/\bTap\b/g, 'Click').replace(/\btap\b/g, 'click');
          eq(gu.line, want, title + ': guidance line');
        } else if (!unlocked) {
          eq(gu.card, null, title + ': no card on a practice level');
          eq(gu.line, lv.tip ? plainTip(lv.tip) : null, title + ': tip line');
          eq(gu.more, false, title + ': just the tip on a practice level');
        }
        if (i === 0 && !unlocked) {
          // the first level's coach: where the wind comes in, then where it stops
          const inlet = WB.parseLevel(lv).fixed.find((p) => p.type === 'window');
          const c1 = await expectState(page, (st) => st.coach && st.coachStep === 'in', title + ': coach step 1 (the wind comes in here)');
          eq([c1.coach.x, c1.coach.y], [inlet.x, inlet.y], title + ': step 1 is pinned to the window the wind comes in by');
          await shot(page, 'walk-level-' + lv.id + '-coach');
          const bb = await page.locator('#board').boundingBox();
          await page.mouse.click(bb.x + 16, bb.y + 16); // a tap anywhere on the board: the next step
          await page.mouse.move(2, 2);
          const c2 = await expectState(page, (st) => st.coach && st.coachStep === 'out', title + ': coach step 2 (no way out: put a window here)');
          // on the first level, the answer is right where the breeze stops
          eq([c2.coach.x, c2.coach.y], [lv.solution[0].x, lv.solution[0].y], title + ': step 2 is pinned where the breeze stops');
          assert(await page.$eval('.chip[data-tool="window"]', (b) => b.classList.contains('is-coach')), title + ': the window in the tray calls softly');
        }
        if (i === 0) await shot(page, 'walk-level-' + lv.id + '-start');

        const sol = lv.solution || [];
        if (!sol.length) {
          problems.push(title + ': no reference solution, cannot be played through (skipped)');
          console.log('  skip ' + title + ' — no reference solution');
          if (next) { unlocked = true; await page.goto(BASE + '?unlock#' + next.id); }
          continue;
        }
        // the hint shows the first piece of the reference solution, at the right cell and rotation
        await page.click('#btn-hint');
        const hs = await expectState(page, (s) => !!s.hint, title + ': hint shows a piece');
        eq(key(hs.hint), key(sol[0]), title + ': hint ghost is the first solution piece');
        assert(await page.isVisible('#toast'), title + ': hint text is shown');
        await page.keyboard.press('Escape');
        await expectState(page, (s) => !s.hint, title + ': Esc hides the hint');

        await placeSolution(page, sol, 'mouse');
        await page.waitForSelector('#win:not([hidden])', { timeout: 6000 }).catch(() => fail(title + ': no win card after placing the reference solution'));
        const s = await state(page);
        assert(s.won && s.solved, title + ': state says won');
        (unlocked ? solvedUnlocked : solvedIds).push(lv.id);
        const sub = await page.textContent('#win-sub');
        assert(sub.includes('Level ' + lv.id), title + ': win card names the level (' + sub + ')');
        // the last level of a chapter: a small "chapter complete" moment, and what is next
        if (!unlocked && ch && ch.last === lv.id) {
          eq((await page.textContent('#win-title')).trim(), 'Chapter complete!', title + ': chapter complete');
          assert(await page.isVisible('#win-chapter'), title + ': the chapter recap is shown');
          const nch = next && chapterOf(next.id);
          const nit = nch && (nch.intro || (nch.tool ? { id: nch.tool } : null));
          if (nit) assert((await page.textContent('#win-teaser-text')).includes('meet the ' + guides[nit.id].title.toLowerCase()), title + ': it says what the next chapter brings');
          if (lv.id === data.chapters[0].last) await shot(page, 'walk-chapter-complete');
        } else if (!unlocked) {
          eq((await page.textContent('#win-title')).trim(), 'Fresh air!', title + ': win title');
        }
        if (i === 0) await shot(page, 'walk-level-' + lv.id + '-win');
        if (next) {
          await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'win-next', null, { timeout: 1000 })
            .catch(() => fail(title + ': "Next" is not focused on the win card'));
          await page.click('#win-next');
          await expectState(page, (st) => st.screen === 'game' && st.id === next.id, 'Next opens level ' + next.id);
          assert(await page.isHidden('#win'), 'win card closed after Next');
        } else {
          assert(await page.isVisible('#win-final'), title + ': last level shows the final message');
          assert(await page.isHidden('#win-next'), title + ': no Next on the last level');
          if (!problems.length && !unlocked) assert(/all \d+ levels/i.test(await page.textContent('#win-final')), 'final message says all levels are done');
          await shot(page, 'walk-final-win');
          await page.click('#win-levels');
          await page.waitForSelector('#home:not([hidden])');
        }
        results.push({ section: 'walk', title, ok: true });
        console.log('  ok   ' + title + dim(' (' + sol.length + ' piece' + (sol.length === 1 ? '' : 's') + ', ' + (Date.now() - t) + ' ms)'));
      } catch (e) {
        results.push({ section: 'walk', title, ok: false, error: e });
        console.log('  FAIL ' + title + '\n       ' + String(e.message || e).split('\n').join('\n       '));
        await shot(page, 'walk-FAIL-level-' + lv.id).catch(() => {});
        if (!next) break;
        // keep walking: skip ahead with everything unlocked
        unlocked = true;
        await page.goto(BASE + '?unlock#' + next.id);
      }
    }
    problems.forEach((p) => console.log('  note ' + p));
    await step('progress persists across reload', async () => {
      if (!solvedIds.length) throw new Skip('nothing solved');
      await page.goto(BASE);
      await page.waitForSelector('#home:not([hidden]) .lvl');
      const done = await page.$$eval('.lvl.is-done', (bs) => bs.map((b) => +b.getAttribute('data-level')));
      eq(done.sort((a, b) => a - b), solvedIds.slice().sort((a, b) => a - b), 'solved levels are marked done after a reload');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('windbreaker.v1')));
      eq(saved.completed.slice().sort((a, b) => a - b), solvedIds.slice().sort((a, b) => a - b), 'windbreaker.v1 completed list');
      if (solvedUnlocked.length) {
        const qa = await page.evaluate(() => JSON.parse(localStorage.getItem('windbreaker.v1.unlock') || '{"completed":[]}'));
        eq(qa.completed.slice().sort((a, b) => a - b), solvedUnlocked.slice().sort((a, b) => a - b), 'levels solved with ?unlock are kept apart (windbreaker.v1.unlock)');
      }
      assert(typeof saved.sound === 'boolean' && saved.boards && Array.isArray(saved.seenTools), 'storage shape { completed, boards, sound, seenTools }');
      const all = solvedIds.length === data.levels.length;
      const play = (await page.textContent('#btn-play')).trim();
      if (all) eq(play, 'Play again', 'Play button when everything is solved');
      await shot(page, 'walk-home-after');
    });
    await page.context().close();
  });
}

// Mouse + keyboard interactions on the fixture levels (normal motion).
async function sectionInteract() {
  await section('interact', async (step) => {
    const page = await newPage({ label: 'interact', fixture: true });
    const at = (x, y) => cellXY(page, x, y);
    const piecesAre = (list, what) => expectState(page, (s) => JSON.stringify(keys(s.pieces)) === JSON.stringify(keys(list)), what + ' → ' + JSON.stringify(keys(list)));

    await step('open the fixture level: the chapter\'s new tool brings its card', async () => {
      await openHome(page);
      await page.click('#btn-play');
      await expectState(page, (s) => s.screen === 'game' && s.id === 1, 'level 1 open');
      const gu = await guideUi(page);
      eq(gu.card, 'Meet the fan', '"Meet the fan" card on the chapter\'s first level');
      eq(gu.line, null, 'no tip line while the card speaks');
      assert(await page.$eval('#guide .gdemo canvas', (c) => c.width > 0), 'the card has its little demo');
      assert(await page.isVisible('#guide-show') && await page.isVisible('#guide-go'), '"Show me" and "Let\u2019s try it"');
      await settle(page);
      // the card is beside the board, never over it
      const r = await page.evaluate(() => {
        const g = document.getElementById('guide').getBoundingClientRect(), b = document.getElementById('board').getBoundingClientRect();
        return { overlap: g.left < b.right && g.right > b.left && g.top < b.bottom && g.bottom > b.top };
      });
      assert(!r.overlap, 'the card does not cover the board');
      // one voice: hovering the board says nothing while the card is open
      const p = await at(4, 2);
      await page.mouse.move(p.x, p.y);
      await sleep(700);
      assert(await page.isHidden('#tooltip'), 'no tooltip while the card is open');
      await page.mouse.move(2, 2);
      await shot(page, 'interact-guide-card');
    });
    await step('"Let\u2019s try it" folds the card into the guidance line, which opens it again', async () => {
      await page.click('#guide-go');
      await page.waitForSelector('#guide', { state: 'hidden' });
      let gu = await guideUi(page);
      eq(gu.line, 'A fixture level for the end-to-end test.', 'the tip line comes back');
      assert(gu.more, 'with an (i) for the card');
      await settle(page);
      await page.click('#tip-more');
      gu = await guideUi(page);
      eq(gu.card, 'Fan', 'the (i) opens the fan\'s card again');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#guide', { state: 'hidden' });
      await settle(page);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('windbreaker.v1')).seenTools);
      assert(saved.includes('fan'), 'a card seen is remembered');
    });
    await step('hover shows a tooltip; a fixed piece says it is fixed', async () => {
      const p = await at(4, 2);
      await page.mouse.move(p.x, p.y);
      await page.waitForSelector('#tooltip:not([hidden])', { timeout: 2000 });
      assert(/Pinwheel/.test(await page.textContent('#tooltip')), 'tooltip names the pinwheel');
      await clickCell(page, 0, 2);
      await page.waitForFunction(() => /fixed/i.test(document.getElementById('tooltip').textContent) && !document.getElementById('tooltip').hidden, null, { timeout: 2000 });
      await piecesAre([], 'a fixed piece cannot be picked up');
    });
    await step('right-click on a tool, tap on an object: their cards', async () => {
      await page.click('.chip[data-tool="deflector"]', { button: 'right' });
      eq((await guideUi(page)).card, 'Deflector', 'right-clicking a tool opens its card');
      eq((await state(page)).sel, null, 'and does not pick it up');
      await page.click('#guide-go');
      await page.waitForSelector('#guide', { state: 'hidden' });
      await settle(page);
      await clickCell(page, 4, 2);
      eq((await guideUi(page)).card, 'Pinwheel', 'clicking an object opens its card');
      assert(/Pinwheel/.test(await page.textContent('#guide .gcard-status')), 'with how this one is doing');
      await shot(page, 'interact-object-card');
      await page.click('#guide .gcard-close');
      await page.waitForSelector('#guide', { state: 'hidden' });
      await settle(page);
    });
    await step('drag a fan from the tray onto the board', async () => {
      const from = await center(page, '.chip[data-tool="fan"]');
      await mouseDrag(page, from, await at(1, 4));
      await piecesAre([{ type: 'fan', x: 1, y: 4, d: 1 }], 'fan dropped at 1,4 facing the wind (east)');
      eq((await state(page)).sel, null, 'dragging does not leave the tool selected');
      eq(await page.textContent('.chip[data-tool="fan"] .chip-count'), '0', 'tray count drops to 0');
      assert(await page.$eval('.chip[data-tool="fan"]', (b) => b.disabled), 'empty chip is disabled');
    });
    await step('drag a placed piece to move it', async () => {
      await mouseDrag(page, await at(1, 4), await at(3, 4));
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 1 }], 'fan moved to 3,4');
    });
    await step('click a fan to turn it, R turns the piece under the pointer', async () => {
      await clickCell(page, 3, 4);
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 2 }], 'fan turned once');
      await page.keyboard.press('r');
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 3 }], 'R turned it again');
    });
    await step('right-click removes a piece', async () => {
      await clickCell(page, 3, 4, { button: 'right' });
      await piecesAre([], 'fan removed by right-click');
      eq(await page.textContent('.chip[data-tool="fan"] .chip-count'), '1', 'fan back in the tray');
    });
    await step('undo and redo (button, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y)', async () => {
      await page.click('#btn-undo');
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 3 }], 'undo brings the fan back');
      await page.keyboard.press('Control+z');
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 2 }], 'Ctrl+Z undoes the R turn');
      await page.keyboard.press('Control+Shift+z');
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 3 }], 'Ctrl+Shift+Z redoes the turn');
      await page.keyboard.press('Control+y');
      await piecesAre([], 'Ctrl+Y redoes the removal');
      await page.keyboard.press('Control+z');
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 3 }], 'undo again');
      const s = await state(page);
      assert(s.redo === 1, 'one step left to redo');
    });
    await step('number keys select tools, Esc and a second tap deselect', async () => {
      await page.mouse.move(5, 5);
      await page.keyboard.press('1');
      await expectState(page, (s) => s.sel === 'window', 'key 1 selects the window');
      await page.keyboard.press('Escape');
      await expectState(page, (s) => s.sel === null, 'Esc deselects');
      await page.keyboard.press('3');
      await expectState(page, (s) => s.sel === 'deflector', 'key 3 selects the deflector');
      await page.click('.chip[data-tool="deflector"]');
      await expectState(page, (s) => s.sel === null, 'tapping the selected chip deselects');
    });
    await step('select a window and click a wall to place it; the tool stays selected while copies remain', async () => {
      await page.click('.chip[data-tool="window"]');
      await expectState(page, (s) => s.sel === 'window', 'window selected');
      await shot(page, 'interact-window-selected');
      await clickCell(page, 2, 0);
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 3 }, { type: 'window', x: 2, y: 0 }], 'window on the north wall');
      eq((await state(page)).sel, 'window', 'window still selected (one left)');
      await clickCell(page, 5, 3); // floor: not a valid spot for a window
      await sleep(80);
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 3 }, { type: 'window', x: 2, y: 0 }], 'a window does not go on the floor');
      await page.keyboard.press('Escape');
      await expectState(page, (s) => s.sel === null, 'Esc deselects');
    });
    await step('drag a piece off the board to remove it, then undo', async () => {
      const top = await center(page, '.level-title');
      await mouseDrag(page, await at(2, 0), { x: top.x, y: top.y });
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 3 }], 'window dragged off the board goes back to the tray');
      await page.keyboard.press('Control+z');
      await piecesAre([{ type: 'fan', x: 3, y: 4, d: 3 }, { type: 'window', x: 2, y: 0 }], 'undo puts it back');
    });
    await step('drag a piece onto the tray to remove it', async () => {
      await mouseDrag(page, await at(3, 4), await center(page, '.chip[data-tool="deflector"]'));
      await piecesAre([{ type: 'window', x: 2, y: 0 }], 'fan dropped on the tray');
    });
    await step('dropping a wall piece on the floor does nothing', async () => {
      await mouseDrag(page, await center(page, '.chip[data-tool="window"]'), await at(5, 3));
      await piecesAre([{ type: 'window', x: 2, y: 0 }], 'no window on the floor');
    });
    await step('reset clears the board and is undoable', async () => {
      await page.click('#btn-reset');
      await piecesAre([], 'board cleared');
      await page.waitForSelector('#toast:not([hidden])');
      assert(/cleared/i.test(await page.textContent('#toast-text')), 'toast says the board was cleared');
      await page.click('#toast-action');
      await piecesAre([{ type: 'window', x: 2, y: 0 }], 'Undo in the toast restores it');
      await page.click('#btn-reset');
      await piecesAre([], 'cleared again');
      await page.keyboard.press('Control+z');
      await piecesAre([{ type: 'window', x: 2, y: 0 }], 'Ctrl+Z restores it too');
    });
    await step('hint flags a piece that is not in the solution and offers to remove it', async () => {
      await page.click('#btn-hint');
      const s = await expectState(page, (st) => !!st.conflicts, 'conflicting pieces flagged');
      eq(s.conflicts, [{ x: 2, y: 0 }], 'the wrong window is flagged');
      eq((await page.textContent('#toast-action')).trim(), 'Remove it', 'toast offers to remove it');
      await shot(page, 'interact-hint-conflict');
      await page.click('#toast-action');
      const h = await expectState(page, (st) => !!st.hint, 'then the hint shows the next piece');
      eq(keys(h.pieces), [], 'conflicting window removed');
      eq(key(h.hint), 'window@9,2', 'hint ghost at the solution cell');
      assert(/window/i.test(await page.textContent('#toast-text')), 'hint text names the tool');
      await shot(page, 'interact-hint-ghost');
    });
    await step('keyboard only: Enter on a chip, arrows, Enter places, Delete removes', async () => {
      await page.keyboard.press('Escape');
      await expectState(page, (s) => !s.hint, 'hint hidden');
      await page.focus('.chip[data-tool="deflector"]');
      await page.keyboard.press('Enter');
      await expectState(page, (s) => s.sel === 'deflector', 'Enter on the chip selects the deflector');
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'board', null, { timeout: 1000 })
        .catch(() => fail('focus did not move to the board'));
      const c0 = (await expectState(page, (st) => !!st.cursor, 'keyboard cursor on the board')).cursor;
      // walk the cursor to 2,3 with the arrow keys
      const moves = [];
      for (let i = 0; i < Math.abs(2 - c0.x); i++) moves.push(c0.x > 2 ? 'ArrowLeft' : 'ArrowRight');
      for (let i = 0; i < Math.abs(3 - c0.y); i++) moves.push(c0.y > 3 ? 'ArrowUp' : 'ArrowDown');
      for (const k of moves) await page.keyboard.press(k);
      await expectState(page, (st) => st.cursor && st.cursor.x === 2 && st.cursor.y === 3, 'arrows move the cursor to 2,3 (from ' + c0.x + ',' + c0.y + ')');
      await page.keyboard.press('Enter');
      await piecesAre([{ type: 'deflector', x: 2, y: 3, d: 0 }], 'Enter places the deflector at the cursor');
      await page.keyboard.press('Delete');
      await piecesAre([], 'Delete removes the piece under the keyboard cursor');
      await page.keyboard.press('Escape');
    });
    await step('the board is saved per level and restored after a reload', async () => {
      await page.keyboard.press('Escape');
      await page.click('.chip[data-tool="fan"]');
      await clickCell(page, 1, 4);
      // a new fan faces the way the player last turned one (west, from the R key above)
      await piecesAre([{ type: 'fan', x: 1, y: 4, d: 3 }], 'fan placed by tap, facing the last direction used');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('windbreaker.v1')).boards);
      eq(saved['1'], [{ type: 'fan', x: 1, y: 4, d: 3 }], 'board saved in storage');
      await page.reload();
      await expectState(page, (s) => s.screen === 'game' && s.id === 1, 'level 1 reopens after reload');
      await piecesAre([{ type: 'fan', x: 1, y: 4, d: 3 }], 'board restored');
      assert(await page.isHidden('#guide'), 'a card seen does not open by itself again');
      assert((await guideUi(page)).more, 'the guidance line still offers it');
      await settle(page);
    });
    await step('solving shows the win card; closing it leaves a Next button', async () => {
      await page.click('.chip[data-tool="window"]');
      await clickCell(page, 9, 2);
      await expectState(page, (s) => s.solved, 'solved');
      await sleep(200);
      assert(await page.isHidden('#win'), 'no card during the short celebration');
      await page.waitForSelector('#win:not([hidden])', { timeout: 4000 });
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'win-next', null, { timeout: 1000 });
      assert(/Fresh air/i.test(await page.textContent('#win-title')), 'win title');
      await shot(page, 'interact-win');
      const done = await page.evaluate(() => JSON.parse(localStorage.getItem('windbreaker.v1')));
      assert(done.completed.includes(1) && !done.boards['1'], 'level marked complete, its board forgotten');
      await page.mouse.click(640, 60); // the backdrop
      await page.waitForSelector('#win', { state: 'hidden' });
      assert(await page.isVisible('#btn-next'), 'a "Next level" button takes the tray\'s place');
      const p = await at(4, 4);
      await page.mouse.click(p.x, p.y);
      await piecesAre([{ type: 'fan', x: 1, y: 4, d: 3 }, { type: 'window', x: 9, y: 2 }], 'the solved board stays put');
    });
    await step('back to levels: level 1 done, Continue opens level 2', async () => {
      await page.click('#btn-back');
      await page.waitForSelector('#home:not([hidden])');
      eq(await page.$eval('.lvl[data-level="1"]', (b) => /is-done/.test(b.className)), true, 'level 1 shown as done');
      eq(await page.$eval('.lvl[data-level="2"]', (b) => b.getAttribute('aria-disabled') !== 'true' && /is-next/.test(b.className)), true, 'level 2 unlocked and highlighted');
      eq((await page.textContent('#btn-play')).trim(), 'Continue · Level 2', 'Continue button');
      await page.click('#btn-play');
      await expectState(page, (s) => s.screen === 'game' && s.id === 2, 'level 2 opens');
      await settle(page);
    });
    await step('hint on a turnable piece; turning it solves the last level', async () => {
      await page.click('#btn-hint');
      const h = await expectState(page, (s) => !!s.hint, 'hint');
      eq(key(h.hint), 'fan@3,1/2', 'hint ghost: fan at 3,1 blowing south');
      assert(/south/.test(await page.textContent('#toast-text')), 'hint says which way');
      await page.keyboard.press('Escape');
      await page.click('.chip[data-tool="fan"]');
      await clickCell(page, 3, 1);
      await piecesAre([{ type: 'fan', x: 3, y: 1, d: 1 }], 'fan placed facing east (calm day default)');
      await page.click('#btn-hint');
      await expectState(page, (s) => !!s.hint && !s.conflicts, 'hint for a wrongly turned piece');
      assert(/turning/i.test(await page.textContent('#toast-text')), 'hint suggests turning it');
      await clickCell(page, 3, 1);
      await page.waitForSelector('#win:not([hidden])', { timeout: 4000 });
      assert(await page.isVisible('#win-final'), 'final message on the last level');
      assert(/all 2 levels/i.test(await page.textContent('#win-final')), 'it says every level is done');
      assert(await page.isHidden('#win-next'), 'no Next button');
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'win-levels', null, { timeout: 1000 });
      await shot(page, 'interact-final');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#win', { state: 'hidden' });
      eq((await page.textContent('#btn-next-label')).trim(), 'Levels', 'the Next pill goes to the level select');
      await page.click('#btn-next');
      await page.waitForSelector('#home:not([hidden])');
      assert(/All 2 levels solved/.test(await page.textContent('#home-progress')), 'home says all solved');
      eq((await page.textContent('#btn-play')).trim(), 'Play again', 'Play again');
    });
    await step('help dialog opens and closes', async () => {
      await page.click('.lvl[data-level="1"]');
      await expectState(page, (s) => s.screen === 'game' && s.id === 1, 'level 1');
      await page.click('#btn-help');
      await page.waitForSelector('#help:not([hidden])');
      const txt = await page.textContent('#help-body');
      assert(/way out/.test(txt) && /Fan/.test(txt) && /Pinwheel/.test(txt), 'help explains the rules and lists tools and objects');
      assert(/Field guide/.test(txt), 'help has the field guide');
      await shot(page, 'interact-help');
      await page.click('#help-body [data-guide="fan"]');
      await page.waitForSelector('#help-body .help-guide .gdemo canvas');
      assert(/Blows a gentle breeze/.test(await page.textContent('#help-body')), 'a field guide entry opens its card in the help');
      await page.click('#help-body .help-back');
      await page.waitForSelector('#help-body [data-guide="fan"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#help', { state: 'hidden' });
    });
    await step('sound setting and progress persist; reset progress asks first', async () => {
      await page.click('#btn-back');
      await page.waitForSelector('#home:not([hidden])');
      await page.click('#btn-sound');
      eq(await page.getAttribute('#btn-sound', 'aria-pressed'), 'false', 'sound off');
      await page.reload();
      await page.waitForSelector('#home:not([hidden]) .lvl');
      eq(await page.getAttribute('#btn-sound', 'aria-pressed'), 'false', 'sound stays off after reload');
      eq(await page.$$eval('.lvl.is-done', (b) => b.length), 2, 'both levels still done after reload');
      await page.click('#btn-sound');
      await page.click('#btn-reset-progress');
      await page.waitForSelector('#confirm:not([hidden])');
      await page.click('#confirm-no');
      await page.waitForSelector('#confirm', { state: 'hidden' });
      eq(await page.$$eval('.lvl.is-done', (b) => b.length), 2, '"Keep it" keeps progress');
      await page.click('#btn-reset-progress');
      await page.waitForSelector('#confirm:not([hidden])');
      await page.click('#confirm-yes');
      await page.waitForSelector('#confirm', { state: 'hidden' });
      eq(await page.$$eval('.lvl.is-done', (b) => b.length), 0, 'progress reset');
      eq(await page.$eval('.lvl[data-level="2"]', (b) => b.getAttribute('aria-disabled') === 'true'), true, 'level 2 locked again');
      eq((await page.textContent('#btn-play')).trim(), 'Play', 'Play');
    });
    await page.context().close();
  });
}

// Touch input on a phone-sized screen (fixture levels).
async function sectionTouch() {
  await section('touch', async (step) => {
    const page = await newPage({ label: 'touch', fixture: true, w: 390, h: 844, dpr: 2, touch: true, mobile: true });
    const at = (x, y) => cellXY(page, x, y);
    const piecesAre = (list, what) => expectState(page, (s) => JSON.stringify(keys(s.pieces)) === JSON.stringify(keys(list)), what + ' → ' + JSON.stringify(keys(list)));
    let T = 0;
    await step('tap a level, dismiss the card', async () => {
      await openHome(page);
      await page.tap('.lvl[data-level="1"]');
      await expectState(page, (s) => s.screen === 'game' && s.id === 1, 'level 1');
      // a bottom sheet on a phone: under the board, not over it
      const r = await page.evaluate(() => {
        const g = document.getElementById('guide').getBoundingClientRect(), b = document.getElementById('board').getBoundingClientRect();
        return { g: g.top, b: b.bottom };
      });
      assert(r.g >= r.b - 1, 'the card sits below the board (card top ' + Math.round(r.g) + ', board bottom ' + Math.round(r.b) + ')');
      await shot(page, 'touch-guide-sheet');
      await page.tap('#guide-go');
      await page.waitForSelector('#guide', { state: 'hidden' });
      await settle(page);
      T = (await state(page)).T;
      await noHorizontalScroll(page, '390x844 game');
    });
    await step('tap a chip, tap a cell to place; tap the piece to turn it', async () => {
      await page.tap('.chip[data-tool="fan"]');
      await expectState(page, (s) => s.sel === 'fan', 'fan selected');
      const p = await at(1, 4);
      await assertBoardAt(page, p);
      await page.touchscreen.tap(p.x, p.y);
      await piecesAre([{ type: 'fan', x: 1, y: 4, d: 1 }], 'fan placed by tap');
      await sleep(350); // a second tap right away would be a double-tap
      await page.touchscreen.tap(p.x, p.y);
      await piecesAre([{ type: 'fan', x: 1, y: 4, d: 2 }], 'tap turns it');
    });
    await step('long-press removes a piece', async () => {
      await longPress(page, await at(1, 4), 700);
      await piecesAre([], 'long-press removed the fan');
    });
    await step('long-press on a tool opens its card (the lifting finger taps nothing)', async () => {
      await settle(page);
      await longPress(page, await center(page, '.chip[data-tool="window"]'), 750);
      await sleep(150);
      eq((await guideUi(page)).card, 'Window', 'the window\'s card');
      eq((await state(page)).sel, null, 'the tool is not picked up');
      await page.tap('#guide-go');
      await page.waitForSelector('#guide', { state: 'hidden' });
      await settle(page);
    });
    // While dragging on touch the piece floats above the finger, so the finger
    // aims a little below the target cell, as a player's would.
    const lift = () => Math.min(40, T * 0.9);
    await step('drag a window from the tray onto a wall', async () => {
      const from = await center(page, '.chip[data-tool="window"]');
      const to = await at(2, 0);
      await touchDrag(page, from, { x: to.x, y: to.y + lift() });
      await piecesAre([{ type: 'window', x: 2, y: 0 }], 'window dropped on the north wall');
    });
    await step('drag a placed piece to another wall cell', async () => {
      const from = await at(2, 0);
      const to = await at(6, 0);
      await touchDrag(page, from, { x: to.x, y: to.y + lift() }, 20);
      await piecesAre([{ type: 'window', x: 6, y: 0 }], 'window moved to 6,0');
      await shot(page, 'touch-moved');
    });
    await step('drag a piece off the board to remove it', async () => {
      const from = await at(6, 0);
      const tray = await center(page, '.chip[data-tool="deflector"]');
      await touchDrag(page, from, { x: tray.x, y: tray.y + lift() }, 20);
      await piecesAre([], 'window dragged onto the tray');
    });
    await step('solve by touch and see the win card', async () => {
      await placeSolution(page, FIXTURE.levels[0].solution, 'touch');
      await page.waitForSelector('#win:not([hidden])', { timeout: 4000 });
      await shot(page, 'touch-win');
      await page.tap('#win-next');
      await expectState(page, (s) => s.screen === 'game' && s.id === 2, 'level 2 opens');
    });
    await page.context().close();
  });
}

// Phone and tablet screens with the real levels: no horizontal scroll, the
// house fully in view and clear of the "New" card, finger-sized chips, and
// levels played with touch taps. Landscape runs in dark mode.
async function sectionMobile() {
  await section('mobile', async (step) => {
    for (const [w, h, dark] of [[360, 740, false], [768, 1024, false], [844, 390, true]]) {
      const tag = w + 'x' + h + (dark ? ' dark' : '');
      const file = 'mobile-' + w + 'x' + h;
      const page = await newPage({ label: 'mobile ' + tag, w, h, dpr: 2, touch: true, mobile: w < 600 || h < 600, dark });
      let data;
      await step(tag + ': level select has no horizontal scroll', async () => {
        await openHome(page, '?unlock');
        data = await levelData(page);
        await noHorizontalScroll(page, tag + ' home');
        await shot(page, file + '-home');
      });
      if (!data) { await page.context().close(); continue; }
      // the biggest map, the level with the most tools, and the biggest tool-intro level
      const area = (l) => l.map.length * l.map[0].length;
      const biggest = (list) => list.reduce((a, b) => (area(b) > area(a) ? b : a));
      const big = biggest(data.levels);
      const many = data.levels.reduce((a, b) => (Object.keys(b.inventory).length > Object.keys(a.inventory).length ? b : a));
      const intros = data.levels.filter((l) => data.chapters.some((c) => (c.intro || c.tool) && c.first === l.id));
      const intro = intros.length ? biggest(intros) : null;
      const picks = [big, many, intro].filter((l, i, arr) => l && arr.indexOf(l) === i);
      for (const lv of picks) {
        await step(tag + ': level ' + lv.id + ' (' + lv.map[0].length + 'x' + lv.map.length + ', ' + Object.keys(lv.inventory).length + ' tools' +
          (lv === intro ? ', "Meet" card' : '') + ') fits', async () => {
          await page.goto(BASE + '?unlock#' + lv.id);
          await expectState(page, (s) => s.screen === 'game' && s.id === lv.id, 'level open');
          await settle(page);
          await noHorizontalScroll(page, tag + ' level ' + lv.id);
          const measure = () => page.evaluate((L) => {
            const a = window.__wb.cell(0, 0), b = window.__wb.cell(L.w - 1, L.h - 1);
            const chips = Array.from(document.querySelectorAll('.chip')).map((c) => { const q = c.getBoundingClientRect(); return Math.min(q.width, q.height); });
            const card = document.getElementById('guide');
            const cr = card.hidden ? null : card.getBoundingClientRect();
            return { left: a.x - a.size / 2, top: a.y - a.size / 2, right: b.x + b.size / 2, bottom: b.y + b.size / 2, T: a.size, chips,
              card: cr && { top: cr.top, bottom: cr.bottom, left: cr.left, right: cr.right }, iw: innerWidth, ih: innerHeight };
          }, { w: lv.map[0].length, h: lv.map.length });
          let r = await measure();
          const inView = (what) => {
            const box = Math.round(r.left) + ',' + Math.round(r.top) + '..' + Math.round(r.right) + ',' + Math.round(r.bottom);
            assert(r.left >= 0 && r.right <= r.iw && r.top >= 0 && r.bottom <= r.ih, 'house fully in view' + what + ' (' + box + ' in ' + r.iw + 'x' + r.ih + ')');
            assert(r.T >= 16, 'tiles are not tiny' + what + ' (' + r.T + ' px)');
            return box;
          };
          if (lv === intro) {
            assert(r.card, '"Meet" card shown on the first level of a chapter');
            const box = inView(' with the card open');
            const overlap = r.card.bottom > r.top && r.card.top < r.bottom && r.card.right > r.left && r.card.left < r.right;
            assert(!overlap, '"Meet" card (' + Math.round(r.card.top) + '..' + Math.round(r.card.bottom) + ') covers the house (' + box + ')');
            await shot(page, file + '-level-' + lv.id + '-card');
            await page.tap('#guide-go');
            await page.waitForSelector('#guide', { state: 'hidden' });
            await settle(page);
            r = await measure();
          } else if (r.card) {
            await page.tap('#guide-go');
            await page.waitForSelector('#guide', { state: 'hidden' });
            await settle(page);
            r = await measure();
          }
          inView('');
          assert(r.chips.every((c) => c >= 44), 'tray chips at least 44 px (' + r.chips.map(Math.round).join(', ') + ')');
          await shot(page, file + '-level-' + lv.id);
        });
      }
      for (const lv of [data.levels[0], intro, big].filter((l, i, arr) => l && arr.indexOf(l) === i)) {
        await step(tag + ': play level ' + lv.id + ' with touch taps', async () => {
          if (!lv.solution || !lv.solution.length) throw new Skip('no reference solution');
          await page.goto(BASE + '?unlock#' + lv.id);
          await expectState(page, (s) => s.screen === 'game' && s.id === lv.id, 'level open');
          await settle(page);
          if (await page.isVisible('#guide')) {
            await page.tap('#guide-go');
            await page.waitForSelector('#guide', { state: 'hidden' });
            await settle(page);
          }
          await placeSolution(page, lv.solution, 'touch');
          await page.waitForSelector('#win:not([hidden])', { timeout: 6000 });
          await noHorizontalScroll(page, tag + ' win card');
          await shot(page, file + '-win-' + lv.id);
        });
      }
      await page.context().close();
    }
  });
}

// localStorage throws on every access: the game must still be playable.
async function sectionStorage() {
  await section('storage', async (step) => {
    const page = await newPage({ label: 'no-storage', noStorage: true, reduced: true });
    let data;
    await step('loads without storage', async () => {
      await openHome(page);
      data = await levelData(page);
      const threw = await page.evaluate(() => { try { void window.localStorage; return false; } catch (e) { return true; } });
      assert(threw, 'storage really is disabled');
    });
    await step('play the first levels without storage', async () => {
      await page.click('#btn-play');
      const playable = data.levels.slice(0, 2).filter((l) => l.solution && l.solution.length);
      if (!playable.length) throw new Skip('no level with a reference solution');
      for (let i = 0; i < playable.length; i++) {
        const lv = playable[i];
        if (i > 0) await page.click('#win-next');
        await expectState(page, (s) => s.screen === 'game' && s.id === lv.id, 'level ' + lv.id + ' open');
        await settle(page);
        await placeSolution(page, lv.solution, 'mouse');
        await page.waitForSelector('#win:not([hidden])', { timeout: 6000 });
      }
      await page.click('#win-levels');
      await page.waitForSelector('#home:not([hidden])');
      eq(await page.$$eval('.lvl.is-done', (b) => b.length), playable.length, 'progress kept in memory for the session');
    });
    await page.context().close();
  });
}

// Opened straight from disk.
async function sectionFile() {
  await section('file', async (step) => {
    const page = await newPage({ label: 'file://' });
    await step('index.html works from file://', async () => {
      await page.goto('file://' + path.join(ROOT, 'index.html'));
      await page.waitForSelector('#home:not([hidden]) .lvl');
      await page.click('#btn-play');
      await expectState(page, (s) => s.screen === 'game' && s.T > 0, 'a level opens');
      await settle(page);
      await page.click('#btn-back');
      await page.waitForSelector('#home:not([hidden])');
    });
    await page.context().close();
  });
}

// ------------------------------------------------------------------ main

(async function main() {
  server = await startServer();
  BASE = 'http://127.0.0.1:' + server.address().port + MOUNT;
  browser = await chromium.launch({ headless: !OPTS.headed });
  console.log('Windbreaker e2e · ' + BASE + (OPTS.levels ? ' · levels: ' + path.relative(process.cwd(), OPTS.levels) : '') +
    ' · chromium ' + browser.version());
  try {
    await sectionHome();
    await sectionWalk();
    await sectionInteract();
    await sectionTouch();
    await sectionMobile();
    await sectionStorage();
    await sectionFile();
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\nconsole');
  consoleWarnings.forEach((w) => console.log('  note console.warn: ' + w));
  if (consoleProblems.length) {
    consoleProblems.forEach((p) => console.log('  FAIL ' + p.split('\n').join('\n       ')));
    results.push({ section: 'console', title: 'no console errors', ok: false, error: new Error(consoleProblems.length + ' problem(s)') });
  } else {
    console.log('  ok   no console errors, page errors or failed requests');
    results.push({ section: 'console', title: 'no console errors', ok: true });
  }

  const failed = results.filter((r) => r.ok === false);
  const passed = results.filter((r) => r.ok === true).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log('\n' + (failed.length ? 'FAILED' : 'PASSED') + ': ' + passed + ' passed, ' + failed.length + ' failed' +
    (skipped ? ', ' + skipped + ' skipped' : '') + ' · ' + ((Date.now() - T0) / 1000).toFixed(1) + ' s' +
    (OPTS.shots ? ' · screenshots in ' + path.relative(process.cwd(), SHOTS) + '/' : ''));
  if (failed.length) {
    failed.forEach((r) => console.log('  - ' + r.section + ': ' + r.title));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
