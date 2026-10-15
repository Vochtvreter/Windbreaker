'use strict';
// Tests for the level-authoring toolchain in tools/ (lib, solve, show, build, check).
// Run: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const lib = require('../tools/lib');
const { solve } = require('../tools/solve');
const show = require('../tools/show');
const builder = require('../tools/build-levels');
const checker = require('../tools/check-levels');
const WB = lib.WB;

const FIX = path.join(__dirname, 'fixtures');
const TINY = lib.readJson(path.join(FIX, 'tiny-levels.json')).levels;
const tiny = (prefix) => TINY.find((d) => d.name.startsWith(prefix));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tools-'));
}

function runTool(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'tools', script)].concat(args), { cwd: ROOT, encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// Brute force: evaluate EVERY placement of every subset of the inventory
// (no pruning at all) and classify the solved configurations.

function bruteForce(def) {
  const L = WB.parseLevel(def);
  const inv = def.inventory || {};
  const options = [];
  for (const t of WB.TOOL_ORDER) {
    if (!(inv[t] > 0)) continue;
    for (const c of WB.placementCells(L, L.fixed, t)) {
      for (let d = 0; d < WB.TOOLS[t].rotations; d++) options.push({ type: t, x: c.x, y: c.y, d });
    }
  }
  const status = new Map(); // key -> solved
  const solved = [];
  const used = {}, occ = new Set(), cur = [];
  const key = (ps) => JSON.stringify(lib.sortPieces(ps));
  (function rec(from) {
    const s = WB.simulate(L, L.fixed.concat(cur)).solved;
    status.set(key(cur), s);
    if (s) solved.push(cur.slice());
    for (let i = from; i < options.length; i++) {
      const o = options[i], cell = o.x + ',' + o.y;
      if ((used[o.type] || 0) >= inv[o.type] || occ.has(cell)) continue;
      used[o.type] = (used[o.type] || 0) + 1; occ.add(cell); cur.push(o);
      rec(i + 1);
      cur.pop(); occ.delete(cell); used[o.type]--;
    }
  })(0);
  const minimal = [], irredundant = [];
  for (const ps of solved) {
    let properSubsetSolves = false;
    for (let m = 0; m < (1 << ps.length) - 1 && !properSubsetSolves; m++) {
      if (status.get(key(ps.filter((_, i) => m & (1 << i))))) properSubsetSolves = true;
    }
    if (!properSubsetSolves) minimal.push(key(ps));
    if (!ps.some((_, i) => status.get(key(ps.filter((_, j) => j !== i))))) irredundant.push(key(ps));
  }
  const minPieces = solved.length ? Math.min(...solved.map((s) => s.length)) : null;
  return { solved: new Set(solved.map(key)), minimal, irredundant: new Set(irredundant), minPieces };
}

/** Solver result must contain every minimal solution and only irredundant real solutions. */
function assertMatchesBruteForce(def, opts) {
  const b = bruteForce(def);
  const r = solve(def, Object.assign({ timeMs: 60000, maxSolutions: 1e9 }, opts));
  const label = def.name + ' ' + JSON.stringify(opts || {});
  assert.equal(r.status, 'exhaustive', label);
  const got = new Set(r.solutions.map((s) => JSON.stringify(s)));
  assert.equal(got.size, r.solutions.length, label + ': duplicate solutions');
  for (const k of got) {
    assert.ok(b.solved.has(k), label + ': not a solution: ' + k);
    assert.ok(b.irredundant.has(k), label + ': redundant solution: ' + k);
  }
  for (const k of b.minimal) assert.ok(got.has(k), label + ': missing minimal solution ' + k);
  assert.equal(r.solvable, b.solved.size > 0, label + ': solvable');
  assert.equal(r.minPieces, b.minPieces, label + ': minPieces');
  return { r, b };
}

// Deterministic random tiny levels (same generator idea as the fuzzer used
// during development; thousands of seeds passed).
function randomLevel(seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const ri = (n) => Math.floor(rnd() * n);
  const pick = (a) => a[ri(a.length)];
  const iw = 3 + ri(3), ih = 2 + ri(2), w = iw + 2, h = ih + 2;
  const g = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.');
    g.push(row);
  }
  if (iw >= 5 && rnd() < 0.5) {
    const cx = 2 + ri(iw - 3);
    for (let y = 1; y < h - 1; y++) g[y][cx] = '#';
    if (rnd() < 0.5) g[1 + ri(ih)][cx] = '.';
  }
  for (let i = 1 + ri(3); i > 0; i--) {
    const x = 1 + ri(iw), y = 1 + ri(ih);
    if (g[y][x] === '.') g[y][x] = pick(['p', 'p', 'c', 's', 's', 'l', 'n', 'f', 'o']);
  }
  const def = {
    name: 'random ' + seed,
    wind: { from: pick(['N', 'E', 'S', 'W']), strength: pick([0, 1, 1, 2, 3]) },
    map: g.map((r) => r.join('')), fixed: [], inventory: {}, solution: []
  };
  const L = WB.parseLevel(def);
  if (!L.objects.length) return null;
  for (let i = 1 + ri(3); i > 0; i--) {
    const t = pick(['window', 'window', 'fan', 'extractor', 'extractor', 'ceilingfan', 'deflector', 'vent', 'splitter']);
    const cells = WB.placementCells(L, def.fixed, t);
    if (cells.length) { const c = pick(cells); def.fixed.push({ type: t, x: c.x, y: c.y, d: ri(WB.TOOLS[t].rotations) }); }
  }
  for (let i = 2 + ri(2); i > 0; i--) {
    const t = pick(['deflector', 'deflector', 'curtain', 'splitter', 'skylight', 'filter', 'filter', 'vent', 'window', 'window', 'extractor', 'fan', 'ceilingfan']);
    def.inventory[t] = (def.inventory[t] || 0) + 1;
  }
  if (WB.validateLevel(def).length) return null;
  let est = 1;
  for (const t of Object.keys(def.inventory)) est *= Math.pow(WB.placementCells(L, def.fixed, t).length * WB.TOOLS[t].rotations + 1, def.inventory[t]);
  return est > 60000 ? null : def;
}

// ---------------------------------------------------------------------------
// lib

test('lib: level numbering and lookup', () => {
  assert.equal(lib.levelNumber(1, 0), 1);
  assert.equal(lib.levelNumber(3, 4), 15);
  assert.equal(lib.levelNumber(20, 4), 100);
  const { levels, problems } = lib.loadAllLevels(path.join(FIX, 'good'));
  assert.deepEqual(levels.map((e) => e.n), [1, 2]);
  assert.equal(levels[1].def.name, 'Two Pinwheels');
  assert.ok(problems.some((p) => p.severity === 'warn' && /partial chapter \(2\/5/.test(p.msg)));
  assert.equal(lib.findLevel(2, path.join(FIX, 'good')).def.name, 'Two Pinwheels');
  assert.equal(lib.findLevel(3, path.join(FIX, 'good')), null);
});

test('lib: countRooms uses 4-connectivity and walls separate rooms', () => {
  const rooms = (map) => lib.countRooms({ map });
  assert.equal(rooms(['#####', '#...#', '#####']), 1);
  assert.equal(rooms(['#######', '#..#..#', '#..#..#', '#######']), 2);
  assert.equal(rooms(['#######', '#..#..#', '#.....#', '#######']), 1, 'doorway joins rooms');
  assert.equal(rooms(['#####', '#.#.#', '##.##', '#####']), 3, 'diagonal does not connect');
  assert.equal(rooms(['#######', '#p.#oc#', '#######']), 2, 'objects and tables are floor');
  assert.equal(rooms(['###', '#%#', '###']), 0);
});

test('lib: chapter loading reports structural problems', () => {
  const dir = tmpDir();
  const lvl = JSON.parse(JSON.stringify(lib.readJson(path.join(FIX, 'good', 'ch01.json')).levels[0]));
  fs.writeFileSync(path.join(dir, 'ch01.json'), JSON.stringify({ chapter: 1, title: 'A', levels: [lvl, lvl, lvl, lvl, lvl, lvl] }));
  fs.writeFileSync(path.join(dir, 'ch02.json'), JSON.stringify({ chapter: 3, title: 'B', levels: [lvl] }));
  fs.writeFileSync(path.join(dir, 'ch04.json'), '{ "chapter": 4,\n  "levels": [ } ');
  const { problems, levels } = lib.loadAllLevels(dir);
  const msgs = problems.map((p) => p.severity + ': ' + p.msg).join('\n');
  assert.match(msgs, /error: ch01\.json: has 6 levels, max 5/);
  assert.match(msgs, /error: ch02\.json: file name says chapter 2 but "chapter" is 3/);
  assert.match(msgs, /error: .*ch04\.json: invalid JSON at line 2 col 15 near "} ": Unexpected token/);
  assert.match(msgs, /warn: ch02\.json: partial chapter/);
  assert.deepEqual(levels.map((e) => e.n), [1, 2, 3, 4, 5, 11], 'over-full chapter truncated to 5');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib: resolveLevelArg accepts numbers, chapter files with --index, bare level files', () => {
  const e = lib.resolveLevelArg(path.join(FIX, 'broken', 'ch02.json'), { index: '2' });
  assert.equal(e.n, 8);
  assert.equal(e.def.name, 'Already Solved');
  assert.equal(lib.resolveLevelArg('2', { src: path.join(FIX, 'good') }).def.name, 'Two Pinwheels');
  assert.throws(() => lib.resolveLevelArg('9', { src: path.join(FIX, 'good') }), /level 9 not found/);
  assert.throws(() => lib.resolveLevelArg(path.join(FIX, 'good', 'ch01.json'), { index: '5' }), /--index must be 0\.\.1/);
  const dir = tmpDir();
  const f = path.join(dir, 'one.json');
  fs.writeFileSync(f, JSON.stringify(tiny('T1')));
  const b = lib.resolveLevelArg(f, { n: '12' });
  assert.equal(b.n, 12);
  assert.equal(b.def.name, tiny('T1').name);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib: jsonErrorOffset finds the first syntax error', () => {
  const at = (t) => lib.jsonErrorOffset(t);
  assert.equal(at('{"a": [1, 2], "b": "x"}'), -1);
  assert.equal(at('[1, 2,]'), 6, 'trailing comma');
  assert.equal(at('{"a": 1,}'), 8);
  assert.equal(at('{"a" 1}'), 5, 'missing colon');
  assert.equal(at('["x" "y"]'), 5, 'missing comma');
  assert.equal(at('{"a": tru}'), 6);
  assert.equal(at('[1] x'), 4, 'trailing garbage');
  assert.equal(at('{"s": "a\\"b"}'), -1, 'escaped quote');
});

test('lib: parseArgs', () => {
  const a = lib.parseArgs(['7', '--time', '100', '--show', '--exclude=fan,vent'], { values: ['time', 'exclude'], bools: ['show'] });
  assert.deepEqual(a._, ['7']);
  assert.equal(a.flags.time, '100');
  assert.equal(a.flags.show, true);
  assert.deepEqual(lib.listFlag(a.flags, 'exclude'), ['fan', 'vent']);
  assert.throws(() => lib.parseArgs(['--bogus'], {}), /unknown option --bogus/);
  assert.throws(() => lib.parseArgs(['--time'], { values: ['time'] }), /needs a value/);
});

// ---------------------------------------------------------------------------
// solve

test('solve: exact solution counts on hand-made tiny levels', () => {
  const expected = {
    'T1': { count: 1, min: 1 },   // only the window opposite the inlet
    'T2': { count: 6, min: 1 },   // every fan cell/direction whose stream crosses the pinwheel
    'T3': { count: 1, min: 2 },   // second deflector only relevant after the first
    'T4': { count: 1, min: 2 },   // outlet window only relevant after the vent
    'T5': { count: 11, min: 2 },  // smoke: fan + (outlet window | filter)
    'T6': { count: 1, min: 1 },   // filter cutting an extractor pull line (no smoke involved)
    'T7': { count: 0, min: null },
    'T8': { count: 4, min: 1 }
  };
  for (const [prefix, want] of Object.entries(expected)) {
    const r = solve(tiny(prefix));
    assert.equal(r.status, 'exhaustive', prefix);
    assert.equal(r.count, want.count, prefix + ' count');
    assert.equal(r.minPieces, want.min, prefix + ' minPieces');
    assert.equal(r.solvable, want.count > 0, prefix + ' solvable');
  }
  assert.deepEqual(solve(tiny('T1')).solutions, [[{ type: 'window', x: 6, y: 2 }]]);
  assert.deepEqual(solve(tiny('T3')).solutions, [[{ type: 'deflector', x: 1, y: 1, d: 1 }, { type: 'deflector', x: 1, y: 3, d: 1 }]]);
});

test('solve: matches brute force over ALL placements on the tiny levels (both pruning modes)', () => {
  for (const def of TINY) {
    const { r } = assertMatchesBruteForce(def);
    const off = solve(def, { timeMs: 60000, maxSolutions: 1e9, pruneIdle: false });
    assert.equal(off.minPieces, r.minPieces);
    assertMatchesBruteForce(def, { pruneIdle: false });
  }
});

test('solve: matches brute force on deterministic random tiny levels', () => {
  let checked = 0, solvable = 0;
  for (let seed = 1; checked < 40 && seed < 1000; seed++) {
    const def = randomLevel(seed);
    if (!def) continue;
    const { b } = assertMatchesBruteForce(def);
    checked++;
    if (b.solved.size) solvable++;
  }
  assert.equal(checked, 40);
  assert.ok(solvable >= 10, 'enough solvable random levels (' + solvable + ')');
});

test('solve: options (exclude, maxPieces, inventory override, cap, timeout)', () => {
  const t4 = solve(tiny('T4'), { excludeTools: ['vent'] });
  assert.equal(t4.status, 'exhaustive');
  assert.equal(t4.solvable, false);

  const t3 = solve(tiny('T3'), { maxPieces: 1 });
  assert.equal(t3.status, 'exhaustive');
  assert.equal(t3.solvable, false);
  assert.equal(t3.maxDepth, 1);

  const t1 = solve(tiny('T1'), { inventory: { deflector: 1 } });
  assert.equal(t1.solvable, false);

  const t2 = solve(tiny('T2'), { maxSolutions: 2 });
  assert.equal(t2.status, 'capped');
  assert.equal(t2.count, 2);
  assert.equal(t2.solvable, true);

  const big = {
    name: 'big', wind: { from: 'W', strength: 2 },
    map: ['#############', '#.....#.....#', '#..l..#..n..#', '#.....#.....#', '##.####..o..#',
      '#..p..#..f..#', '#..c..#..s..#', '#.....#.....#', '#############'],
    fixed: [{ type: 'window', x: 0, y: 2 }],
    inventory: { window: 2, fan: 2, deflector: 2, curtain: 1, vent: 1, filter: 1 }, solution: []
  };
  const t0 = Date.now();
  const r = solve(big, { timeMs: 150 });
  assert.equal(r.status, 'timeout');
  assert.notEqual(r.solvable, false);
  assert.ok(Date.now() - t0 < 1500, 'respects timeMs');
  assert.ok(r.nodes > 0 && r.completedDepth >= 0);
});

test('solve: a level solved without pieces has the empty solution', () => {
  const def = lib.readJson(path.join(FIX, 'broken', 'ch02.json')).levels[2];
  const r = solve(def);
  assert.equal(r.status, 'exhaustive');
  assert.equal(r.count, 1);
  assert.equal(r.minPieces, 0);
  assert.deepEqual(r.solutions, [[]]);
});

// ---------------------------------------------------------------------------
// show

test('show: glyphs never collide with map characters', () => {
  const mapChars = new Set('#%.o~plcnfs'.split(''));
  const glyphs = new Set(['W', 'w']);
  for (const g of Object.values(show.GLYPH)) for (const ch of g) glyphs.add(ch);
  for (const g of glyphs) assert.ok(!mapChars.has(g), 'glyph ' + g + ' collides');
  assert.equal(glyphs.size, 2 + 4 + 2 + 7, 'all glyphs distinct');
});

test('show: renders map, flow grid, objects, trees and status', () => {
  const entry = { n: 1, chapter: 1, index: 0, def: lib.readJson(path.join(FIX, 'good', 'ch01.json')).levels[0] };
  const fixed = entry.def.fixed.map((p) => Object.assign({ fixed: true }, p));
  const solved = show.render(entry, fixed.concat(entry.def.solution));
  assert.match(solved, / 2 W\.\.\.p\.\.\.w {4}2 W1111111w/);
  assert.match(solved, /p pinwheel 4,2 +flow 1 +ok/);
  assert.match(solved, /inlet +W 0,2 +active +max 1 +ends: out 8,2/);
  assert.match(solved, /\nSOLVED\n/);
  const start = show.render(entry, fixed);
  assert.match(start, / 2 W,,,,,,,#/, 'stalled path drawn with commas');
  assert.match(start, /STALLED .* ends: blk 8,2/);
  assert.match(start, /not solved \(0\/1 happy\)/);
});

test('show: CLI views', () => {
  const file = path.join(FIX, 'tiny-levels.json');
  const a = runTool('show.js', [file, '--index', '2']);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /SOLVED/);
  assert.match(a.stdout, /\\/);
  const b = runTool('show.js', [file, '--index', '2', '--fixed-only']);
  assert.match(b.stdout, /not solved/);
  const c = runTool('show.js', [file, '--index', '1', '--pieces', '[{"type":"fan","x":5,"y":2,"d":"W"}]']);
  assert.match(c.stdout, / 2 #\.p\.\.<#/);
  assert.match(c.stdout, /SOLVED/);
  const d = runTool('show.js', [file, '--index', '1', '--pieces', '[{"type":"fan","x":2,"y":2,"d":1}]']);
  assert.match(d.stdout, /! fan 2,2 E: cannot be placed there/);
  const e = runTool('show.js', [file, '--index', '9']);
  assert.notEqual(e.status, 0);
  assert.match(e.stderr, /--index must be/);
});

// ---------------------------------------------------------------------------
// build

test('build: round trip through a temp file (Node and browser)', () => {
  const dir = tmpDir();
  const out = path.join(dir, 'levels.js');
  const res = builder.build({ src: path.join(FIX, 'good'), out });
  assert.ok(res.ok, res.errors.join('\n'));
  assert.ok(res.written);
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text.split('\n')[0], /Generated by tools\/build-levels\.js .*Do not edit by hand\./);
  assert.match(text, /\n {8}"#\.\.\.p\.\.\.#",\n/, 'one map row per line');

  const data = require(out);
  const src = lib.readJson(path.join(FIX, 'good', 'ch01.json'));
  assert.deepEqual(data.chapters, [{ n: 1, title: 'Open Windows', tool: 'window', first: 1, last: 2 }]);
  assert.equal(data.levels.length, 2);
  src.levels.forEach((def, i) => {
    const L = data.levels[i];
    assert.equal(L.id, i + 1);
    assert.equal(L.chapter, 1);
    assert.equal(L.name, def.name);
    assert.equal(L.tip, def.tip);
    assert.deepEqual(L.wind, def.wind);
    assert.deepEqual(L.map, def.map);
    assert.deepEqual(L.fixed, def.fixed);
    assert.deepEqual(L.inventory, def.inventory);
    assert.deepEqual(L.solution, def.solution);
    assert.deepEqual(Object.keys(L), ['id', 'chapter', 'name'].concat(def.tip ? ['tip'] : [], ['wind', 'map', 'fixed', 'inventory', 'solution']));
  });

  const sandbox = { self: {} };
  vm.runInNewContext(text, sandbox);
  assert.equal(sandbox.self.WB.LEVELS.length, 2);
  assert.equal(sandbox.self.WB.CHAPTERS[0].title, 'Open Windows');

  assert.ok(builder.build({ src: path.join(FIX, 'good'), out, check: true }).upToDate);
  const again = builder.build({ src: path.join(FIX, 'good'), out });
  assert.equal(again.written, false, 'deterministic output');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('build: normalises pieces and inventory, chapter tool is null after chapter 10', () => {
  const def = { name: 'x', wind: { from: 'w', strength: 1 }, map: ['###', '#p#', '###'], fixed: [], inventory: { fan: 1, window: 0 },
    solution: [{ type: 'fan', x: 1, y: 1 }, { type: 'window', x: 0, y: 1, d: 0, note: 'dropped' }] };
  const L = builder.normLevel(def, 51, 11);
  assert.deepEqual(L.wind, { from: 'W', strength: 1 });
  assert.deepEqual(L.inventory, { fan: 1 });
  assert.deepEqual(L.solution, [{ type: 'fan', x: 1, y: 1, d: 0 }, { type: 'window', x: 0, y: 1 }]);
  const dir = tmpDir();
  const lvl = lib.readJson(path.join(FIX, 'good', 'ch01.json')).levels[0];
  fs.writeFileSync(path.join(dir, 'ch12.json'), JSON.stringify({ chapter: 12, title: 'Late', levels: [lvl] }));
  const res = builder.build({ src: dir, out: path.join(dir, 'out.js') });
  assert.ok(res.ok);
  assert.deepEqual(res.data.chapters, [{ n: 12, title: 'Late', tool: null, first: 56, last: 56 }]);
  assert.ok(res.warnings.some((w) => /chapter 1 is missing/.test(w)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('build: refuses to write when a level is invalid', () => {
  const dir = tmpDir();
  const out = path.join(dir, 'levels.js');
  const res = builder.build({ src: path.join(FIX, 'broken'), out });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /Leaky.*not sealed/.test(e)), res.errors.join('\n'));
  assert.equal(fs.existsSync(out), false);
  const cli = runTool('build-levels.js', ['--src', path.join(FIX, 'broken'), '--out', out]);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /build failed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// check

test('check: good chapter passes', () => {
  const cli = runTool('check-levels.js', ['--src', path.join(FIX, 'good'), '--jobs', '1']);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /^ +1 +First Breeze +9x5 +1 +1 +1 +1 +0 W1 +ok +exh +1 +1 /m);
  assert.match(cli.stdout, /OK: 2 levels, 0 failures, 1 warning/);
  const json = JSON.parse(runTool('check-levels.js', ['--src', path.join(FIX, 'good'), '--json', '--jobs', '2']).stdout);
  assert.equal(json.summary.failures, 0);
  assert.equal(json.levels.length, 2);
  assert.equal(json.levels[0].excluded.solvable, false);
  assert.ok(json.levels[1].difficulty > json.levels[0].difficulty);
});

test('check: broken chapter fails with specific messages', () => {
  const cli = runTool('check-levels.js', ['--file', path.join(FIX, 'broken', 'ch02.json')]);
  assert.equal(cli.status, 1);
  const out = cli.stdout;
  assert.match(out, /#6 +FAIL +solvable without fan: window 6,2/);
  assert.match(out, /#7 +FAIL +reference solution does not solve the level/);
  assert.match(out, /#8 +FAIL +already solved before anything is placed/);
  assert.match(out, /#9 +FAIL +tool deflector not introduced until level 11/);
  assert.match(out, /#10 +FAIL +floor at 6,2 touches outside/);
  assert.match(out, /FAILED: 5 levels, 5 failures/);
  const one = runTool('check-levels.js', ['--file', path.join(FIX, 'broken', 'ch02.json'), '--level', '7', '--fast']);
  assert.equal(one.status, 1);
  assert.match(one.stdout, /OK|FAILED: 1 level/);
});

test('check: checkLevel warnings and intro rules', () => {
  const good = lib.readJson(path.join(FIX, 'good', 'ch01.json')).levels;
  // Intro level without its tool.
  const noTool = Object.assign({}, good[0], { inventory: { window: 1 } });
  let rep = checker.checkLevel({ n: 6, def: noTool }, { timeMs: 2000 });
  assert.ok(rep.errors.includes('intro level for fan but fan is not in the inventory'), rep.errors.join('\n'));
  // Decoys before level 76 and a shorter solution than the reference.
  const decoy = Object.assign({}, good[0], { inventory: { window: 2 } });
  rep = checker.checkLevel({ n: 2, def: decoy }, { timeMs: 2000 });
  assert.deepEqual(rep.errors, []);
  assert.ok(rep.warnings.some((w) => /reference uses 1 of 2 inventory pieces/.test(w)));
  const longRef = Object.assign({}, good[0], { inventory: { window: 2 },
    solution: [{ type: 'window', x: 8, y: 2 }, { type: 'window', x: 8, y: 1 }] });
  rep = checker.checkLevel({ n: 80, def: longRef }, { timeMs: 2000 });
  assert.ok(rep.warnings.some((w) => /solvable with 1 piece \(reference uses 2\): window 8,2/.test(w)), rep.warnings.join('\n'));
  assert.ok(!rep.warnings.some((w) => /decoys/.test(w)), 'decoys allowed from 76');
  // Unknown keys are reported, --fast skips the solver.
  rep = checker.checkLevel({ n: 2, def: Object.assign({ colour: 'red' }, good[1]) }, { fast: true });
  assert.ok(rep.warnings.some((w) => /unknown key "colour"/.test(w)));
  assert.equal(rep.solver, null);
  assert.equal(rep.difficulty, null);
});

test('check: difficulty heuristic and drop warning', () => {
  const f = { inv: 2, hazards: 1, objects: 3, rooms: 2, ref: 2 };
  const d = checker.difficulty(f, { status: 'exhaustive', count: 4, minPieces: 2, space: 1024 });
  // 10 + 2*2 + 0 - 1.5*2 + 1 + 1.5 + 1 = 14.5
  assert.equal(d.value, 14.5);
  assert.equal(d.approx, false);
  assert.equal(checker.difficulty(f, { status: 'timeout', count: 0, minPieces: null, space: 1 }).approx, true);
  const reps = [
    { n: 11, difficulty: 30, warnings: [] }, // intro level: never warned
    { n: 12, difficulty: 20, warnings: [] },
    { n: 13, difficulty: 10, warnings: [] }
  ];
  checker.addSequenceWarnings(reps);
  assert.equal(reps[0].warnings.length, 0);
  assert.equal(reps[1].warnings.length, 1, 'drop of 10 from 30');
  assert.equal(reps[2].warnings.length, 1, 'drop of 10 from 20');
  assert.equal(checker.introTool(46), 'ceilingfan');
  assert.equal(checker.introTool(51), null);
  assert.equal(checker.introTool(7), null);
});

// ---------------------------------------------------------------------------
// The real sources (levels/src) must at least load and validate.

test('levels/src: every chapter loads and validates', () => {
  const { levels, problems } = lib.loadAllLevels();
  assert.deepEqual(problems.filter((p) => p.severity === 'error'), []);
  assert.ok(levels.length >= 1);
  for (const e of levels) assert.deepEqual(WB.validateLevel(e.def), [], '#' + e.n);
});
