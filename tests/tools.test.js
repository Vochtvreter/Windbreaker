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

// ---------------------------------------------------------------------------
// Adversarial audit of the solver against the independent brute force in
// tests/fixtures/bruteforce.js: every subset of the inventory on every valid
// cell and rotation, no pruning, solved configurations extended too. See that
// file's header for the exact definitions of solution / minimal / irredundant /
// reducible. compareWithSolver() demands: same solvable verdict and minPieces,
// every reported solution valid, solved (engine AND reference engine), a
// brute-force solution and irredundant, every minimal solution reported, and
// every brute-force solution reducible to a reported one.

const BF = require('./fixtures/bruteforce');
const REF_ENGINE = require('./fixtures/engine-reference');

function audit(def, solveOpts, invOverride) {
  const bfOpts = {};
  if (invOverride) bfOpts.inventory = invOverride;
  if (solveOpts && solveOpts.maxPieces != null) bfOpts.maxPieces = solveOpts.maxPieces;
  const b = BF.bruteForce(def, bfOpts);
  const r = solve(def, Object.assign({ timeMs: 120000, maxSolutions: 1e9 }, solveOpts));
  const probs = BF.compareWithSolver(def, b, r, Object.assign({ refEngine: REF_ENGINE }, bfOpts));
  assert.deepEqual(probs, [], def.name + ' ' + JSON.stringify(solveOpts || {}) + '\n' + JSON.stringify(def));
  return { b, r };
}

function randomLevels(cfg, n, firstSeed) {
  const out = [];
  for (let seed = firstSeed || 1; out.length < n && seed < (firstSeed || 1) + 100 * n; seed++) {
    const def = BF.randomLevel(seed, cfg);
    if (def) out.push(def);
  }
  assert.equal(out.length, n, 'generator produced enough levels for ' + JSON.stringify(cfg));
  return out;
}

test('audit: the brute-force oracle itself (definitions, and it catches a broken solver)', () => {
  const def = tiny('T1'); // window opposite the inlet; inventory window 2
  const b = BF.bruteForce(def);
  const one = BF.configKey([{ type: 'window', x: 6, y: 2 }]);
  assert.deepEqual([...b.minimal], [one]);
  assert.ok(b.irredundant.has(one));
  assert.ok(b.solved.size > 1, 'two-window supersets also solve');
  for (const [k, ps] of b.solved) {
    if (k === one) continue;
    assert.ok(!b.irredundant.has(k), 'a superset of the minimal solution is redundant: ' + k);
    assert.equal(BF.reducibleTo(ps, new Set([one])), one, 'reducible to the minimal solution');
  }
  assert.equal(BF.reducibleTo([], new Set([''])), '', 'the empty solution is reducible to itself');
  assert.equal(BF.reducibleTo([{ type: 'window', x: 6, y: 1 }], new Set([one])), null);

  // Mutations of a correct result must all be caught.
  const good = solve(def, { timeMs: 60000, maxSolutions: 1e9 });
  assert.deepEqual(BF.compareWithSolver(def, b, good), []);
  const drop = Object.assign({}, good, { solutions: [], count: 0, solvable: false, minPieces: null });
  assert.ok(BF.compareWithSolver(def, b, drop).some((p) => /missing minimal solution/.test(p)));
  assert.ok(BF.compareWithSolver(def, b, drop).some((p) => /not reducible/.test(p)));
  const fake = [{ type: 'window', x: 6, y: 1 }];
  const extra = Object.assign({}, good, { solutions: good.solutions.concat([fake]), count: good.count + 1 });
  assert.ok(BF.compareWithSolver(def, b, extra).some((p) => /does not solve/.test(p)));
  const red = [{ type: 'window', x: 6, y: 1 }, { type: 'window', x: 6, y: 2 }];
  const redundant = Object.assign({}, good, { solutions: good.solutions.concat([red]), count: good.count + 1 });
  assert.ok(BF.compareWithSolver(def, b, redundant).some((p) => /redundant/.test(p)));
});

test('audit: solver == brute force on 250 seeded random levels (all tools, 5 generator focuses)', () => {
  let solvable = 0, multi = 0;
  for (const focus of [null, 'passive', 'stalled', 'pull', 'smoke']) {
    for (const def of randomLevels({ focus, maxConfigs: 20000, maxObj: 4, planted: 0.8 }, 50, 1)) {
      const { b } = audit(def);
      if (b.solved.size) solvable++;
      if (b.minPieces >= 2) multi++;
    }
  }
  assert.ok(solvable >= 150, 'enough solvable levels (' + solvable + ')');
  assert.ok(multi >= 5, 'some levels need 2+ pieces (' + multi + '; the 3+ piece test below covers more)');
});

test('audit: solver == brute force on random levels whose fewest-piece solution needs 3-4 pieces', () => {
  // Seeds found by searching the generator (focus, maxInv 4, maxObj 4, planted 0.95);
  // pull 1643 and smoke 1150 replaced seeds whose levels changed with the clean-laundry rule.
  const HARD = {
    passive: [140, 389, 2195, 3410], stalled: [62, 179, 318, 820], pull: [221, 343, 1568, 1643],
    smoke: [38, 790, 895, 1150], null: [472, 564, 860, 912]
  };
  for (const [f, seeds] of Object.entries(HARD)) {
    for (const seed of seeds) {
      const def = BF.randomLevel(seed, { focus: f === 'null' ? null : f, maxInv: 4, maxObj: 4, planted: 0.95, maxConfigs: 25000 });
      assert.ok(def, 'seed ' + seed + ' still generates a level');
      const { b } = audit(def);
      assert.ok(b.minPieces >= 3, def.name + ' needs 3+ pieces');
    }
  }
});

test('audit: solver == brute force on large maps (up to 13x10, 1-2 pieces) and on 5-6 piece inventories', () => {
  for (const def of randomLevels({ maxW: 13, maxH: 10, minW: 8, minH: 6, maxInv: 2, maxObj: 4, planted: 0.8, maxConfigs: 40000 }, 30, 1)) audit(def);
  // More than 4 passives exercises the solver's string-keyed visited set.
  const many = randomLevels({ focus: 'passive', maxW: 6, maxH: 5, minW: 5, minH: 4, minInv: 5, maxInv: 6, maxObj: 4, planted: 0.9, maxConfigs: 60000 }, 12, 1);
  for (const def of many) audit(def);
});

test('audit: solver options (maxPieces, excludeTools, inventory) == restricted brute force; pruneIdle off agrees', () => {
  let runs = 0;
  for (const def of randomLevels({ maxInv: 4, maxObj: 3, planted: 0.8, maxConfigs: 15000 }, 40, 1)) {
    const rnd = BF.mulberry32(def.name.length * 7919 + runs);
    const invKeys = Object.keys(def.inventory);
    const total = invKeys.reduce((t, k) => t + def.inventory[k], 0);
    audit(def, { maxPieces: Math.floor(rnd() * (total + 1)) });
    const ex = invKeys[Math.floor(rnd() * invKeys.length)];
    const rest = {};
    for (const k of invKeys) if (k !== ex) rest[k] = def.inventory[k];
    audit(def, { excludeTools: [ex] }, rest);
    const over = { deflector: 1, window: 1 };
    over[WB.TOOL_ORDER[Math.floor(rnd() * WB.TOOL_ORDER.length)]] = 1;
    if (BF.estimateConfigs(def, over) <= 30000) audit(def, { inventory: over }, over);
    audit(def, { pruneIdle: false });
    runs++;
  }
  assert.equal(runs, 40);
});

test('audit: hand-made adversarial levels (pull cut by passives, stalled chains, smoke, splitter, curtains)', () => {
  const cases = [
    { name: 'A1 pull line cut by a curtain or deflector', wind: { from: 'N', strength: 0 },
      map: ['#######', '#c...p#', '#.....#', '#######'],
      fixed: [{ type: 'extractor', x: 6, y: 1 }], inventory: { curtain: 1, deflector: 1 },
      minimal: ['curtain@2,1:0', 'curtain@3,1:0', 'curtain@4,1:0', 'deflector@2,1:0', 'deflector@2,1:1',
        'deflector@3,1:0', 'deflector@3,1:1', 'deflector@4,1:0', 'deflector@4,1:1'] },
    { name: 'A2 stalled inlet: vent, then an outlet (window, or deflector + window)', wind: { from: 'W', strength: 1 },
      map: ['###########', '#.........#', '#....#....#', '#....#..p.#', '###########'],
      fixed: [{ type: 'window', x: 0, y: 3 }], inventory: { vent: 1, window: 1, deflector: 1 },
      minimal: ['vent@5,3:0 window@10,3:0', 'deflector@9,3:0 vent@5,3:0 window@9,0:0', 'deflector@9,3:1 vent@5,3:0 window@9,4:0'] },
    { name: 'A3 fan turning the inlet stream onto the laundry', wind: { from: 'W', strength: 2 },
      map: ['#######', '#.....#', '#.....#', '#..l..#', '#######'],
      fixed: [{ type: 'window', x: 0, y: 1 }, { type: 'window', x: 3, y: 4 }], inventory: { fan: 1 },
      minimal: ['fan@3,1:2'] },
    { name: 'A4 splitter feeds two pinwheels', wind: { from: 'S', strength: 2 },
      map: ['#######', '#p...p#', '#.....#', '#.....#', '#######'],
      fixed: [{ type: 'window', x: 3, y: 4 }, { type: 'window', x: 0, y: 1 }, { type: 'window', x: 6, y: 1 }],
      inventory: { splitter: 1, deflector: 1 }, minimal: ['splitter@3,1:0'] },
    { name: 'A5 stalled smoke: only a skylight activates the inlet', wind: { from: 'W', strength: 1 },
      map: ['########', '#..s...#', '#......#', '########'],
      fixed: [{ type: 'window', x: 0, y: 1 }], inventory: { filter: 1, skylight: 1, curtain: 1 },
      minimal: ['skylight@4,1:0', 'skylight@5,1:0', 'skylight@6,1:0'] },
    { name: 'A6 curtain softens the laundry wind for the papers', wind: { from: 'W', strength: 2 },
      map: ['#########', '#.l...n.#', '#.......#', '#########'],
      fixed: [{ type: 'window', x: 0, y: 1 }, { type: 'window', x: 8, y: 1 }], inventory: { curtain: 2, deflector: 1 },
      minimal: ['curtain@3,1:0', 'curtain@4,1:0', 'curtain@5,1:0'] },
    { name: 'A7 two extractors with crossing pull lines', wind: { from: 'E', strength: 1 },
      map: ['#######', '#.....#', '#.c...#', '#...f.#', '#.....#', '#######'],
      fixed: [{ type: 'extractor', x: 0, y: 3 }, { type: 'extractor', x: 2, y: 0 }], inventory: { filter: 1, skylight: 1, deflector: 1 },
      minimal: ['deflector@2,1:0', 'deflector@2,1:1', 'filter@2,1:0', 'skylight@2,1:0'] },
    { name: 'A8 smoky branch of an active tree needs a filter', wind: { from: 'W', strength: 1 },
      map: ['########', '#s.....#', '#......#', '########'],
      fixed: [{ type: 'window', x: 0, y: 1 }, { type: 'splitter', x: 3, y: 1 }, { type: 'window', x: 3, y: 3 }],
      inventory: { filter: 1, deflector: 1 }, minimal: ['filter@2,1:0'] }
  ];
  for (const c of cases) {
    const def = Object.assign({ solution: [] }, c);
    const { b } = audit(def);
    assert.deepEqual([...b.minimal].sort(), c.minimal.slice().sort(), c.name + ': intended minimal solutions');
    audit(def, { pruneIdle: false });
  }
});

test('audit: the real levels in levels/src agree with brute force (incl. intro exclusions)', () => {
  const { levels } = lib.loadAllLevels();
  let checked = 0;
  for (const e of levels) {
    if (WB.validateLevel(e.def).length) continue;
    const def = Object.assign({}, e.def, { name: '#' + e.n + ' ' + e.def.name });
    if (BF.estimateConfigs(def) <= 40000) {
      const { b } = audit(def);
      if (def.solution && def.solution.length && WB.isSolved(WB.parseLevel(def), WB.parseLevel(def).fixed.concat(def.solution))) {
        assert.ok(b.solved.has(BF.configKey(def.solution)), def.name + ': reference solution is a brute-force solution');
      }
      checked++;
    }
    const tool = checker.introTool(e.n);
    if (tool) {
      const rest = Object.assign({}, def.inventory);
      delete rest[tool];
      if (BF.estimateConfigs(def, rest) <= 40000) audit(def, { excludeTools: [tool] }, rest);
    }
  }
  assert.ok(checked >= Math.min(1, levels.length));
});

// ---------------------------------------------------------------------------
// check-levels: section 6 hardening

test('check: intro "unsolvable without the new tool" must be an exhaustive proof', () => {
  const good = lib.readJson(path.join(FIX, 'good', 'ch01.json')).levels[0];
  let rep = checker.checkLevel({ n: 1, def: good }, { timeMs: 2000 });
  assert.equal(rep.excluded.status, 'exhaustive');
  assert.equal(rep.excluded.solvable, false);
  assert.deepEqual(rep.errors, []);
  // A big level posing as the deflector intro. Without the deflector it needs 3+ pieces (no solution
  // with <= 2: 31k configurations), so with a 0 ms budget the exclusion search times out -> FAIL, not a warning.
  const big = {
    name: 'big', tip: 't', wind: { from: 'W', strength: 2 },
    map: ['#############', '#.....#.....#', '#..p..#..p..#', '#.....#.....#', '##.####..o..#',
      '#..p..#..p..#', '#.....#.....#', '#.....#.....#', '#############'],
    fixed: [{ type: 'window', x: 0, y: 2 }],
    inventory: { window: 2, fan: 1, deflector: 2 }, solution: []
  };
  rep = checker.checkLevel({ n: 11, def: Object.assign({}, big, { inventory: { window: 3, fan: 2, deflector: 1 } }) }, { timeMs: 30, introTimeMs: 0 });
  assert.equal(rep.excluded.status, 'timeout');
  assert.ok(rep.errors.some((e) => /could not prove the level unsolvable without deflector/.test(e)), rep.errors.join('\n'));
  assert.ok(!rep.warnings.some((w) => /unknown whether/.test(w)));
  assert.equal(checker.DEFAULT_INTRO_TIME >= 30000, true, 'intro proofs get a large default budget');
});

test('check: malformed piece fields are hard failures (the engine would read d: "E" as 0)', () => {
  const good = lib.readJson(path.join(FIX, 'good', 'ch01.json')).levels[0];
  const bad = Object.assign({}, good, {
    fixed: [{ type: 'window', x: 0, y: 2, d: 'E' }],
    solution: [{ type: 'window', x: 8.5, y: 2, note: 'x' }]
  });
  const rep = checker.checkLevel({ n: 2, def: bad }, { fast: true });
  assert.ok(rep.errors.some((e) => /fixed\[0\]: d must be an integer rotation \(got "E"/.test(e)), rep.errors.join('\n'));
  assert.ok(rep.errors.some((e) => /solution\[0\]: x must be an integer \(got 8\.5\)/.test(e)), rep.errors.join('\n'));
  assert.ok(rep.warnings.some((w) => /solution\[0\]: unknown key "note"/.test(w)));
  assert.deepEqual(checker.pieceFieldIssues(good), { errors: [], warnings: [] });
});

test('check: capped searches give approximate difficulty; minimal reference must be reported', () => {
  const f = { inv: 2, hazards: 0, objects: 1, rooms: 1, ref: 2 };
  assert.equal(checker.difficulty(f, { status: 'capped', count: 1000, minPieces: 2, space: 5000 }).approx, true);
  assert.equal(checker.difficulty(f, { status: 'exhaustive', count: 3, minPieces: 2, space: 5000 }).approx, false);
  const t3 = tiny('T3');
  const L = WB.parseLevel(t3);
  assert.equal(checker.isMinimalSolution(L, L.fixed, t3.solution), true);
  assert.equal(checker.isMinimalSolution(L, L.fixed, t3.solution.concat([{ type: 'deflector', x: 5, y: 1, d: 0 }])), false);
});
