'use strict';
/*
 * Independent audit of js/engine.js against DESIGN.md §1-§5 and §8.
 *
 * tests/engine.test.js covers each rule on its own. This file adds:
 *   1. hand-computed edge cases where rules interact: splitters entered again
 *      from another side, splitter branches that loop into each other, a fan
 *      inside a pull line, extractors next to corners, windows on courtyard
 *      walls and windows entered from the side, inlets that only get out
 *      through a vent, curtain chains, two stoves and a filter on one path,
 *      merges that are not terminals, and dist continuity;
 *   2. a randomized three-way differential test: the engine is compared with
 *      tests/fixtures/engine-reference.js, and with a small model written
 *      straight from the DESIGN.md text. The model traces depth-first, so any
 *      dependence on breadth-first order shows up. It runs on new seeds and a
 *      new level generator: L-shaped houses, courtyards, thick walls, every
 *      tool, and up to four stoves;
 *   3. the scratch buffers growing in the middle of a trace, on a fresh copy
 *      of the engine.
 *
 * Expected values in section 1 were worked out by hand from DESIGN.md.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const WB = require('../js/engine.js');
const REF = require('./fixtures/engine-reference.js');

const N = 0, E = 1, S = 2, W = 3;

function lvl(map, from, strength) {
  return WB.parseLevel({ name: 'audit', map: map, wind: { from: from, strength: strength } });
}
function pc(type, x, y, d) { return { type: type, x: x, y: y, d: d || 0 }; }
function flowRows(L, R) {
  const rows = [];
  for (let y = 0; y < L.h; y++) {
    let s = '';
    for (let x = 0; x < L.w; x++) {
      const ch = L.cells[y * L.w + x];
      const f = R.flow[y * L.w + x];
      s += WB.isFloorish(ch) ? (f ? String(f) : '.') : ch;
    }
    rows.push(s);
  }
  return rows;
}
function goal(R, x, y) { return R.goals.find(function (g) { return g.x === x && g.y === y; }); }
function treesOf(R, kind) { return R.trees.filter(function (t) { return t.kind === kind; }); }
function dirOf(g) {
  const dx = g.bx - g.ax, dy = g.by - g.ay;
  return dx === 0 ? (dy < 0 ? N : S) : (dx > 0 ? E : W);
}
// Directions of the segments that leave the centre of cell (x, y), sorted.
function dirsFrom(tree, x, y) {
  return tree.segments.filter(function (g) { return g.ax === x + 0.5 && g.ay === y + 0.5; }).map(dirOf).sort();
}
function segTuples(tree) {
  return tree.segments.map(function (g) { return [g.ax, g.ay, g.bx, g.by, g.dist, g.s, g.smoke ? 1 : 0]; });
}
function withRow(map, y, row) { return map.map(function (r, i) { return i === y ? row : r; }); }

const ROOM97 = [ // 9 x 7, interior x 1..7, y 1..5
  '#########',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#########'
];
const ROOM9 = ['#########', '#.......#', '#.......#', '#.......#', '#########'];
const ROOM7 = ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######'];

// ---------------------------------------------------------------------------
// §8 API surface

describe('audit: §8 API surface', function () {
  it('every documented export exists with the documented type', function () {
    ['parseLevel', 'validateLevel', 'cellAt', 'isFloorish', 'isWall', 'isOutside', 'outwardDir', 'canPlace',
      'placementCells', 'windowRole', 'rotate', 'simulate', 'isSolved'].forEach(function (k) {
      assert.equal(typeof WB[k], 'function', k);
    });
    ['DX', 'DY', 'DIR_NAMES', 'TOOL_ORDER', 'OBJECT_ORDER'].forEach(function (k) { assert.ok(Array.isArray(WB[k]), k); });
    assert.equal(typeof WB.TOOLS, 'object');
    assert.equal(typeof WB.OBJECTS, 'object');
  });

  it('Result shape: field names and types exactly as documented', function () {
    const L = lvl(withRow(ROOM9, 2, '#.s.p...#'), 'W', 1);
    const R = WB.simulate(L, [pc('window', 0, 2), pc('window', 8, 2), pc('fan', 2, 1, E)]);
    assert.deepEqual(Object.keys(R).sort(), ['flow', 'goals', 'solved', 'stoves', 'trees']);
    assert.ok(R.flow instanceof Int32Array);
    assert.equal(R.flow.length, L.w * L.h);
    R.trees.forEach(function (t) {
      assert.deepEqual(Object.keys(t).sort(), ['active', 'ends', 'kind', 'segments', 'source']);
      assert.deepEqual(Object.keys(t.source).sort(), ['d', 'type', 'x', 'y']);
      t.segments.forEach(function (g) { assert.deepEqual(Object.keys(g).sort(), ['ax', 'ay', 'bx', 'by', 'dist', 's', 'smoke']); });
      t.ends.forEach(function (e) { assert.deepEqual(Object.keys(e).sort(), ['type', 'x', 'y']); });
    });
    R.stoves.forEach(function (s) { assert.deepEqual(Object.keys(s).sort(), ['cleared', 'reached', 'x', 'y']); });
    R.goals.forEach(function (g) {
      assert.deepEqual(Object.keys(g).sort(), ['flow', 'ok', 'state', 'type', 'x', 'y']);
      assert.ok(['idle', 'happy', 'bad'].indexOf(g.state) >= 0);
    });
    assert.equal(typeof R.solved, 'boolean');
  });
});

// ---------------------------------------------------------------------------
// Splitters entered again and loops (§4 Splitter, §4 Tracing)

describe('audit: splitters entered again and splitter loops', function () {
  // wind W 3: inlet (0,3) -> splitter (4,3) moving E -> N branch to the outlet (4,0),
  // S branch: '\'(4,5) S->E, '/'(6,5) E->N, '\'(6,3) N->W, back into the splitter moving W.
  const LOOP = [pc('window', 0, 3), pc('splitter', 4, 3), pc('deflector', 4, 5, 1), pc('deflector', 6, 5, 0), pc('deflector', 6, 3, 1)];

  it('a branch that comes back into its own splitter from the E side splits N/S again and merges', function () {
    const L = lvl(ROOM97, 'W', 3);
    const R = WB.simulate(L, LOOP.concat([pc('window', 4, 0)]));
    const t = R.trees[0];
    assert.equal(t.active, true);
    assert.deepEqual(flowRows(L, R), [
      '#########',
      '#...1...#',
      '#...1...#',
      '#333311.#', // splitter cell: max(3 on the first pass, 1 on the second)
      '#...1.1.#',
      '#...111.#',
      '#########'
    ]);
    // 4 trunk + 3 N + 8 round the loop + 2 merge segments; one end only (merges are not terminals)
    assert.equal(t.segments.length, 17);
    assert.deepEqual(t.ends, [{ x: 4.5, y: 0, type: 'outlet' }]);
    assert.deepEqual(dirsFrom(t, 4, 3), [N, N, S, S], 'both passes leave N and S');
  });

  it('splitter branches looping into each other: perpendicular re-entry and max (not sum) where they cross', function () {
    // wind W 2: inlet (0,3), splitter (4,3), outlet (8,3). N branch: '/'(4,1) N->E, '\'(6,1) E->S, down
    // column 6, '/'(6,5) S->W, '\'(4,5) W->N, back into the splitter moving N. The S branch runs the
    // same loop the other way and comes back moving S. Each re-entry splits into E and W.
    const L = lvl(ROOM97, 'W', 2);
    const R = WB.simulate(L, [pc('window', 0, 3), pc('splitter', 4, 3), pc('window', 8, 3),
      pc('deflector', 4, 1, 0), pc('deflector', 6, 1, 1), pc('deflector', 6, 5, 0), pc('deflector', 4, 5, 1)]);
    const t = R.trees[0];
    assert.equal(R.trees.length, 1);
    assert.equal(t.active, true);
    assert.deepEqual(flowRows(L, R), [
      '#########',
      '#...111.#',
      '#...1.1.#',
      '#2222111#', // (6,3) is crossed S, N and E by the same tree: 1, not 3; (3,3): max(2, 1)
      '#...1.1.#',
      '#...111.#',
      '#########'
    ]);
    // the W stream from the re-entry runs back into the inlet window (blocked); E leaves
    assert.deepEqual(t.ends, [{ x: 1, y: 3.5, type: 'blocked' }, { x: 9, y: 3.5, type: 'outlet' }]);
    assert.deepEqual(dirsFrom(t, 4, 3), [N, E, E, S, W, W]);
    assert.equal(t.segments.length, 38);
  });

  it('a stove on a splitter loop is trapped even though some of its smoke leaves', function () {
    const L = lvl(withRow(ROOM97, 5, '#....s..#'), 'W', 3);
    const R = WB.simulate(L, LOOP.concat([pc('window', 4, 0)]));
    assert.equal(R.trees[0].active, true);
    // the clean and the smoky N branch are different states: two outlet ends at the same point
    assert.deepEqual(R.trees[0].ends, [{ x: 4.5, y: 0, type: 'outlet' }, { x: 4.5, y: 0, type: 'outlet' }]);
    assert.deepEqual(R.stoves, [{ x: 5, y: 5, reached: true, cleared: false }]);
    assert.equal(goal(R, 5, 5).state, 'bad');
  });

  it('a filter on that loop: still trapped (literal §4 reading, see note)', function () {
    // NOTE: the smoke always goes through the filter here, so the plain-words summary
    // ("blow it out or through a filter") suggests the stove is fine. The exact rule
    // says no smoky state may lie on a cycle, and the states between the stove and the
    // filter lie on one. This test records the current, literal behaviour.
    const L = lvl(withRow(ROOM97, 5, '#....s..#'), 'W', 3);
    const R = WB.simulate(L, LOOP.concat([pc('window', 4, 0), pc('filter', 6, 4)]));
    assert.deepEqual(R.trees[0].ends, [{ x: 4.5, y: 0, type: 'outlet' }], 'smoke never reaches the outlet');
    assert.deepEqual(R.stoves, [{ x: 5, y: 5, reached: true, cleared: false }]);
  });

  it('smoke trapped on the loop of a stalled inlet does not count (idle)', function () {
    const L = lvl(withRow(ROOM97, 5, '#....s..#'), 'W', 3);
    const R = WB.simulate(L, LOOP);
    const t = R.trees[0];
    assert.equal(t.active, false);
    assert.ok(R.flow.every(function (f) { return f === 0; }));
    assert.deepEqual(t.ends, [{ x: 4.5, y: 1, type: 'blocked' }, { x: 4.5, y: 1, type: 'blocked' }]);
    assert.equal(t.segments.length, 22, 'the ghost path is still traced in full');
    assert.ok(t.segments.some(function (g) { return g.smoke; }));
    assert.deepEqual(R.stoves, [{ x: 5, y: 5, reached: false, cleared: false }]);
    assert.equal(goal(R, 5, 5).state, 'idle');
  });
});

// ---------------------------------------------------------------------------
// Merging (§4 Tracing: "it is not a terminal")

describe('audit: a merge is not a terminal', function () {
  it('an inlet whose stream only merges back into itself has no ends and stalls; the fan tree still counts', function () {
    // inlet (0,3) -> fan (3,3) N -> '\'(3,1) N->W -> '/'(1,1) W->S -> down column 1 (across the
    // inlet's own path) -> '\'(1,5) S->E -> '/'(3,5) E->N -> back into the fan.
    const L = lvl(ROOM7, 'W', 1);
    const R = WB.simulate(L, [pc('window', 0, 3), pc('fan', 3, 3, N), pc('deflector', 3, 1, 1),
      pc('deflector', 1, 1, 0), pc('deflector', 1, 5, 1), pc('deflector', 3, 5, 0)]);
    const inlet = treesOf(R, 'inlet')[0], fan = treesOf(R, 'fan')[0];
    assert.deepEqual(inlet.ends, []);
    assert.equal(inlet.active, false, 'no outlet reached: stalled');
    assert.equal(inlet.segments.length, 16);
    assert.deepEqual(fan.ends, []);
    assert.equal(fan.active, true);
    assert.deepEqual(flowRows(L, R), ['#######', '#111..#', '#1.1..#', '#1.1..#', '#1.1..#', '#111..#', '#######'],
      'only the fan tree: (2,3) on the inlet\'s own path stays 0');
  });

  it('the same cell and direction at another strength is a new state: a curtain on a fan loop costs 1 per lap', function () {
    // wind W 3: inlet (0,1) -> fan (3,1) E -> '\'(5,1) E->S -> curtain (5,3) -> '/'(5,5) S->W ->
    // '\'(3,5) W->N -> back into the fan from behind. Laps at 3, 2 and 1; the third stops at the curtain.
    const L = lvl(ROOM7, 'W', 3);
    const R = WB.simulate(L, [pc('window', 0, 1), pc('fan', 3, 1, E), pc('deflector', 5, 1, 1), pc('curtain', 5, 3),
      pc('deflector', 5, 5, 0), pc('deflector', 3, 5, 1)]);
    const inlet = treesOf(R, 'inlet')[0];
    const strengths = function (s, n) { return Array(n).fill(s); };
    assert.deepEqual(inlet.segments.map(function (g) { return g.s; }),
      [].concat(strengths(3, 7), strengths(2, 12), strengths(1, 12)));
    assert.deepEqual(inlet.ends, [{ x: 5.5, y: 3.5, type: 'blocked' }]);
    assert.equal(inlet.active, false);
    assert.deepEqual(treesOf(R, 'fan')[0].ends, [{ x: 5.5, y: 3.5, type: 'blocked' }]);
    assert.deepEqual(flowRows(L, R)[1], '#...11#', 'only the fan\'s own stream, up to the curtain');
  });
});

// ---------------------------------------------------------------------------
// Extractors (§4 Extractor, §4 Placement)

describe('audit: extractors', function () {
  it('a fan inside the pull line: the pull starts after the fan; facing the extractor it adds +1', function () {
    const L = lvl(ROOM9, 'W', 0);
    const toward = WB.simulate(L, [pc('extractor', 8, 2), pc('fan', 4, 2, E)]);
    assert.equal(flowRows(L, toward)[2], '#....222#');
    assert.deepEqual(segTuples(treesOf(toward, 'pull')[0])[0], [5, 2.5, 5.5, 2.5, 0, 1, 0], 'pull starts at the face of the fan cell');
    assert.deepEqual(treesOf(toward, 'fan')[0].ends, [{ x: 9, y: 2.5, type: 'outlet' }]);
    const away = WB.simulate(L, [pc('extractor', 8, 2), pc('fan', 4, 2, W)]);
    assert.equal(flowRows(L, away)[2], '#111.111#');
    assert.deepEqual(treesOf(away, 'fan')[0].ends, [{ x: 1, y: 2.5, type: 'blocked' }]);
  });

  it('next to an inside corner of an L-shaped house', function () {
    const LMAP = ['~~#####', '~~#...#', '###...#', '#.....#', '#######'];
    const L = lvl(LMAP, 'W', 0);
    assert.equal(WB.outwardDir(L, 1, 2), N);
    assert.equal(WB.outwardDir(L, 2, 1), W);
    assert.equal(WB.outwardDir(L, 2, 2), -1, 'the corner itself');
    const a = WB.simulate(L, [pc('extractor', 1, 2)]);
    assert.deepEqual(flowRows(L, a)[3], '#1....#', 'one-cell pull line');
    assert.deepEqual(segTuples(a.trees[0]), [[1.5, 4, 1.5, 3.5, 0, 1, 0], [1.5, 3.5, 1.5, 2, 0.5, 1, 0]]);
    const b = WB.simulate(L, [pc('extractor', 2, 1)]);
    assert.deepEqual(flowRows(L, b)[1], '~~#111#');
    assert.deepEqual(b.trees[0].ends, [{ x: 2, y: 1.5, type: 'outlet' }]);
  });

  it('on a cell with outside on two sides: pulls along the first outward direction, takes air from any side', function () {
    const CORNER = ['~~##', '~#.#', '#..#', '####']; // (1,1): outside N and W, floor S and E
    const L = lvl(CORNER, 'W', 0);
    const R = WB.simulate(L, [pc('extractor', 1, 1), pc('fan', 2, 1, W)]);
    const pull = treesOf(R, 'pull')[0];
    assert.deepEqual(segTuples(pull), [[1.5, 3, 1.5, 2.5, 0, 1, 0], [1.5, 2.5, 1.5, 1, 0.5, 1, 0]], 'pulls from the S (outward is N)');
    assert.deepEqual(treesOf(R, 'fan')[0].ends, [{ x: 1, y: 1.5, type: 'outlet' }], 'air arriving from the E leaves too');
  });

  it('a pull line through a stove clears it; a filter in the line cuts the line instead', function () {
    const L = lvl(withRow(ROOM9, 2, '#..s....#'), 'W', 0);
    assert.equal(goal(WB.simulate(L, [pc('extractor', 8, 2)]), 3, 2).state, 'happy');
    const R = WB.simulate(L, [pc('extractor', 8, 2), pc('filter', 5, 2)]);
    assert.equal(flowRows(L, R)[2], '#.....11#');
    assert.equal(goal(R, 3, 2).state, 'idle');
  });
});

// ---------------------------------------------------------------------------
// Windows on courtyard walls, windows entered from the side (§2, §4 Window)

describe('audit: windows on courtyard walls and odd wall cells', function () {
  const CY = ['#######', '#.....#', '#.###.#', '#.#~#.#', '#.###.#', '#.....#', '#######'];

  it('a courtyard window facing the wind is an inlet', function () {
    const L = lvl(CY, 'E', 1);
    assert.equal(WB.windowRole(L, pc('window', 2, 3)), 'inlet', 'faces E into the courtyard');
    assert.equal(WB.windowRole(L, pc('window', 4, 3)), 'outlet');
    const R = WB.simulate(L, [pc('window', 2, 3), pc('window', 0, 3)]);
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(segTuples(R.trees[0]), [[3, 3.5, 1.5, 3.5, 0, 1, 0], [1.5, 3.5, 0, 3.5, 1.5, 1, 0]],
      'the inlet stream starts at the courtyard face');
    assert.equal(flowRows(L, R)[3], '#1#~#.#');
  });

  it('a stream can leave into a courtyard; the end lies beyond the wall centre, at the courtyard', function () {
    const L = lvl(CY, 'N', 1);
    const R = WB.simulate(L, [pc('window', 3, 0), pc('window', 3, 2)]);
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(R.trees[0].ends, [{ x: 3.5, y: 3, type: 'outlet' }]);
    // (3,4) faces N into the courtyard: an inlet in a N wind; it needs its own outlet
    const stalled = WB.simulate(L, [pc('window', 3, 4)]);
    assert.equal(stalled.trees[0].active, false);
    assert.deepEqual(stalled.trees[0].ends, [{ x: 3.5, y: 6, type: 'blocked' }]);
    assert.equal(WB.simulate(L, [pc('window', 3, 4), pc('window', 3, 6)]).trees[0].active, true);
  });

  it('a window cell entered from the side: outlet from any side, inlet blocks from any side', function () {
    // (2,1) is a wall stub with outside to the N and floor to the S, W and E.
    const PEN = ['##~####', '#.#...#', '#.....#', '#######'];
    assert.deepEqual(WB.validateLevel({ map: withRow(PEN, 2, '#..p..#'), wind: { from: 'W', strength: 1 } }), []);
    const L0 = lvl(PEN, 'W', 0);
    assert.equal(WB.outwardDir(L0, 2, 1), N);
    const out = WB.simulate(L0, [pc('window', 2, 1), pc('fan', 1, 1, E)]);
    assert.deepEqual(out.trees[0].ends, [{ x: 3, y: 1.5, type: 'outlet' }], 'end is drawn on the far (E) face');
    const L1 = lvl(PEN, 'N', 1);
    const R = WB.simulate(L1, [pc('window', 2, 1), pc('fan', 1, 1, E), pc('window', 2, 3)]);
    assert.deepEqual(treesOf(R, 'fan')[0].ends, [{ x: 2, y: 1.5, type: 'blocked' }]);
    assert.equal(treesOf(R, 'inlet')[0].active, true);
  });

  it('in a sealed map a vent cell is never next to a cell that can take a window or extractor', function () {
    const r = rng(31337);
    let vents = 0;
    for (let k = 0; k < 300; k++) {
      const def = genLevel(r, true);
      if (WB.validateLevel(def).some(function (e) { return /sealed/.test(e); })) continue;
      const L = WB.parseLevel(def);
      WB.placementCells(L, [], 'vent').forEach(function (c) {
        vents++;
        for (let d = 0; d < 4; d++) assert.equal(WB.outwardDir(L, c.x + WB.DX[d], c.y + WB.DY[d]), -1, JSON.stringify(def.map));
      });
    }
    assert.ok(vents > 200, 'enough vent cells: ' + vents);
  });
});

// ---------------------------------------------------------------------------
// Vents, curtains, dist (§4 Wall vent, Curtain, §8 dist)

describe('audit: vents, curtain chains and dist', function () {
  const VMAP = ['#######', '#.....#', '#.....#', '#######', '#.....#', '#.....#', '#######'];

  it('an inlet whose only outlet is reached through a vent after a turn; dist runs on through vent and turns', function () {
    const L = lvl(VMAP, 'W', 2);
    const base = [pc('window', 0, 1), pc('deflector', 3, 1, 1), pc('deflector', 3, 5, 1), pc('window', 6, 5)];
    const without = WB.simulate(L, base);
    assert.equal(without.trees[0].active, false);
    assert.deepEqual(without.trees[0].ends, [{ x: 3.5, y: 3, type: 'blocked' }]);
    const R = WB.simulate(L, base.concat([pc('vent', 3, 3)]));
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(flowRows(L, R), ['#######', '#222..#', '#..2..#', '#######', '#..2..#', '#..222#', '#######']);
    assert.equal(R.flow[3 * L.w + 3], 0, 'flow is only recorded on floor-ish cells, not in the vent');
    assert.deepEqual(segTuples(R.trees[0]), [
      [0, 1.5, 1.5, 1.5, 0, 2, 0], [1.5, 1.5, 2.5, 1.5, 1.5, 2, 0], [2.5, 1.5, 3.5, 1.5, 2.5, 2, 0],
      [3.5, 1.5, 3.5, 2.5, 3.5, 2, 0], [3.5, 2.5, 3.5, 3.5, 4.5, 2, 0], [3.5, 3.5, 3.5, 4.5, 5.5, 2, 0],
      [3.5, 4.5, 3.5, 5.5, 6.5, 2, 0], [3.5, 5.5, 4.5, 5.5, 7.5, 2, 0], [4.5, 5.5, 5.5, 5.5, 8.5, 2, 0],
      [5.5, 5.5, 7, 5.5, 9.5, 2, 0]
    ]);
  });

  it('both splitter branches continue the dist of the splitter; a stalled split tree keeps its ghost path', function () {
    const L = lvl(withRow(VMAP, 5, '#.p...#'), 'W', 2);
    const pieces = [pc('window', 0, 1), pc('deflector', 3, 1, 1), pc('vent', 3, 3), pc('splitter', 3, 5)];
    const stalled = WB.simulate(L, pieces);
    const t = stalled.trees[0];
    assert.equal(t.active, false);
    assert.equal(goal(stalled, 2, 5).state, 'idle');
    assert.ok(stalled.flow.every(function (f) { return f === 0; }));
    assert.deepEqual(segTuples(t).slice(7), [
      [3.5, 5.5, 2.5, 5.5, 7.5, 1, 0], [3.5, 5.5, 4.5, 5.5, 7.5, 1, 0],
      [2.5, 5.5, 1.5, 5.5, 8.5, 1, 0], [4.5, 5.5, 5.5, 5.5, 8.5, 1, 0],
      [1.5, 5.5, 1, 5.5, 9.5, 1, 0], [5.5, 5.5, 6, 5.5, 9.5, 1, 0]
    ]);
    assert.deepEqual(t.ends, [{ x: 1, y: 5.5, type: 'blocked' }, { x: 6, y: 5.5, type: 'blocked' }]);
    const R = WB.simulate(L, pieces.concat([pc('window', 6, 5)]));
    assert.equal(R.trees[0].active, true, 'one branch out is enough');
    assert.equal(flowRows(L, R)[5], '#11211#');
    assert.equal(goal(R, 2, 5).state, 'happy');
  });

  it('a curtain chain takes strength 3 down to 0: blocked at the third curtain, the inlet stalls', function () {
    const ROW = ['###########', '#.........#', '###########'];
    const L = lvl(ROW, 'W', 3);
    const R = WB.simulate(L, [pc('window', 0, 1), pc('curtain', 3, 1), pc('curtain', 5, 1), pc('curtain', 7, 1), pc('window', 10, 1)]);
    const t = R.trees[0];
    assert.equal(t.active, false);
    assert.deepEqual(t.segments.map(function (g) { return g.s; }), [3, 3, 3, 2, 2, 1, 1]);
    assert.deepEqual(t.ends, [{ x: 7.5, y: 1.5, type: 'blocked' }]);
    assert.ok(R.flow.every(function (f) { return f === 0; }));
    const two = WB.simulate(L, [pc('window', 0, 1), pc('curtain', 3, 1), pc('curtain', 5, 1), pc('window', 10, 1)]);
    assert.equal(flowRows(L, two)[1], '#333221111#');
  });
});

// ---------------------------------------------------------------------------
// Two stoves on one path (§4 Smoke)

describe('audit: two stoves on one path', function () {
  const TWO = ['###########', '#.s.s.....#', '###########'];
  const smoke = function (t) { return t.segments.map(function (g) { return g.smoke ? 1 : 0; }); };

  it('a filter between the stoves cleans only the first one\'s smoke', function () {
    const L = lvl(TWO, 'W', 0);
    const R = WB.simulate(L, [pc('fan', 1, 1, E), pc('filter', 3, 1)]);
    assert.deepEqual(smoke(R.trees[0]), [0, 1, 0, 1, 1, 1, 1, 1, 1]);
    assert.deepEqual(R.stoves, [{ x: 2, y: 1, reached: true, cleared: true }, { x: 4, y: 1, reached: true, cleared: false }]);
    assert.deepEqual(R.goals.map(function (g) { return g.state; }), ['happy', 'bad']);
  });

  it('a filter after both cleans both (the union of their smoke)', function () {
    const L = lvl(TWO, 'W', 0);
    const R = WB.simulate(L, [pc('fan', 1, 1, E), pc('filter', 6, 1)]);
    assert.deepEqual(smoke(R.trees[0]), [0, 1, 1, 1, 1, 0, 0, 0, 0]);
    assert.deepEqual(R.goals.map(function (g) { return g.state; }), ['happy', 'happy']);
  });

  it('out through a window both are fine, with or without the filter between', function () {
    const L = lvl(TWO, 'W', 0);
    [[], [pc('filter', 3, 1)]].forEach(function (extra) {
      const R = WB.simulate(L, [pc('fan', 1, 1, E), pc('window', 10, 1)].concat(extra));
      assert.deepEqual(R.goals.map(function (g) { return g.state; }), ['happy', 'happy']);
    });
  });

  it('a stalled inlet blowing the smoke into a wall does not spoil a stove an active tree clears', function () {
    // wind N: inlet (3,0) blows S over the stove into the floor's S wall and stalls; the extractor's
    // pull along row 2 takes the smoke out.
    const L = lvl(withRow(ROOM9, 2, '#..s....#'), 'N', 1);
    const R = WB.simulate(L, [pc('window', 3, 0), pc('extractor', 8, 2)]);
    const inlet = treesOf(R, 'inlet')[0];
    assert.equal(inlet.active, false);
    assert.deepEqual(inlet.ends, [{ x: 3.5, y: 4, type: 'blocked' }]);
    assert.ok(inlet.segments[inlet.segments.length - 1].smoke, 'its dead end is smoky');
    assert.deepEqual(R.stoves, [{ x: 3, y: 2, reached: true, cleared: true }]);
    assert.equal(WB.isSolved(L, [pc('window', 3, 0), pc('extractor', 8, 2)]), true);
  });
});

// ---------------------------------------------------------------------------
// isSolved (§5, §8) on its own: it has a separate code path from simulate()

describe('audit: isSolved for each object and flow', function () {
  // one object at (3,2); flow f there from an inlet of strength f (f = 0: the inlet stalls)
  it('agrees with §5 for every object type at flow 0..3', function () {
    const HAPPY = { p: [0, 1, 1, 1], c: [1, 0, 0, 0], l: [0, 0, 1, 1], n: [1, 1, 0, 0], f: [0, 1, 0, 0] };
    Object.keys(HAPPY).forEach(function (ch) {
      [0, 1, 2, 3].forEach(function (f) {
        const L = lvl(withRow(ROOM9, 2, '#..' + ch + '....#'), 'W', Math.max(f, 1));
        const pieces = f === 0 ? [pc('window', 0, 2)] : [pc('window', 0, 2), pc('window', 8, 2)];
        assert.equal(WB.simulate(L, pieces).flow[2 * L.w + 3], f);
        assert.equal(WB.isSolved(L, pieces), HAPPY[ch][f] === 1, ch + ' at flow ' + f);
      });
    });
  });

  it('stoves: not reached, trapped and cleared', function () {
    const L = lvl(withRow(ROOM9, 2, '#..s....#'), 'W', 0);
    assert.equal(WB.isSolved(L, []), false, 'not reached');
    assert.equal(WB.isSolved(L, [pc('fan', 1, 2, E)]), false, 'into a wall');
    assert.equal(WB.isSolved(L, [pc('fan', 1, 2, E), pc('window', 8, 2)]), true, 'out of a window');
    const loop = [pc('fan', 1, 2, E), pc('deflector', 6, 2, 1), pc('deflector', 6, 3, 0), pc('fan', 1, 3, N)];
    assert.equal(WB.simulate(L, loop).stoves[0].cleared, false);
    assert.equal(WB.isSolved(L, loop), false, 'on a loop');
  });

  it('a level without objects is never solved', function () {
    assert.equal(WB.isSolved(lvl(ROOM9, 'W', 1), [pc('window', 0, 2), pc('window', 8, 2)]), false);
  });
});

// ---------------------------------------------------------------------------
// Randomized differential tests

function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
function ri(r, n) { return Math.floor(r() * n); }

// Houses with L-shapes, courtyards, interior and thick walls with doors, pillars,
// tables, all objects and up to four stoves. A few maps stay unsealed.
function genLevel(r, alwaysSeal) {
  const w = 5 + ri(r, 9), h = 4 + ri(r, 7);
  const g = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.');
    g.push(row);
  }
  if (r() < 0.3 && w >= 8 && h >= 6) { // L-shape: a corner of the box is garden
    const cw = 2 + ri(r, Math.floor(w / 2) - 1), ch = 2 + ri(r, Math.floor(h / 2) - 1);
    const right = r() < 0.5, bottom = r() < 0.5;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) g[bottom ? h - 1 - y : y][right ? w - 1 - x : x] = '~';
  }
  const courtyards = r() < 0.35 ? 1 + ri(r, 2) : 0;
  for (let k = 0; k < courtyards && w >= 7 && h >= 7; k++) {
    const cw = 1 + ri(r, 2), ch = 1 + ri(r, 2);
    const cx = 2 + ri(r, w - 3 - cw), cy = 2 + ri(r, h - 3 - ch);
    for (let y = cy - 1; y <= cy + ch; y++) for (let x = cx - 1; x <= cx + cw; x++) if (g[y][x] !== '~') g[y][x] = '#';
    for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) g[y][x] = '~';
  }
  const walls = ri(r, 4);
  for (let k = 0; k < walls; k++) {
    if (r() < 0.5 && w >= 7) {
      const x = 2 + ri(r, w - 4), thick = r() < 0.15;
      for (let y = 1; y < h - 1; y++) {
        if (g[y][x] !== '.') continue;
        g[y][x] = r() < 0.1 ? '%' : '#';
        if (thick && g[y][x + 1] === '.') g[y][x + 1] = '#';
      }
      if (r() < 0.7) { const y = 1 + ri(r, h - 2); if (g[y][x] !== '~') g[y][x] = '.'; }
    } else if (h >= 6) {
      const y = 2 + ri(r, h - 4);
      for (let x = 1; x < w - 1; x++) if (g[y][x] === '.') g[y][x] = r() < 0.1 ? '%' : '#';
      if (r() < 0.7) { const x = 1 + ri(r, w - 2); if (g[y][x] !== '~') g[y][x] = '.'; }
    }
  }
  const pillars = ri(r, 3);
  for (let k = 0; k < pillars; k++) { const x = 1 + ri(r, w - 2), y = 1 + ri(r, h - 2); if (g[y][x] === '.') g[y][x] = '#'; }
  if (alwaysSeal || r() >= 0.04) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (g[y][x] !== '.') continue;
        for (let d = 0; d < 4; d++) {
          const nx = x + WB.DX[d], ny = y + WB.DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || g[ny][nx] === '~') { g[y][x] = '#'; break; }
        }
      }
    }
  } else {
    g[1 + ri(r, h - 2)][0] = r() < 0.5 ? '.' : '~';
  }
  const maxStoves = [0, 1, 2, 2, 3, 3, 4][ri(r, 7)];
  let stoves = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y][x] !== '.') continue;
      const q = r();
      if (q < 0.05) g[y][x] = 'o';
      else if (q < 0.22) {
        let c = 'plcnfss'[ri(r, 7)];
        if (c === 's') { if (stoves >= maxStoves) c = 'p'; else stoves++; }
        g[y][x] = c;
      }
    }
  }
  return { name: 'audit', wind: { from: 'NESW'[ri(r, 4)], strength: ri(r, 4) }, map: g.map(function (row) { return row.join(''); }) };
}

function genPieces(r, L, maxPieces, mix) {
  const pieces = [];
  if (L.wind.strength > 0 && r() < 0.6) { // an inlet and one to three ways out
    const inlets = WB.placementCells(L, pieces, 'window').filter(function (c) { return WB.outwardDir(L, c.x, c.y) === L.wind.from; });
    if (inlets.length) { const c = inlets[ri(r, inlets.length)]; pieces.push({ type: 'window', x: c.x, y: c.y }); }
    const outs = WB.placementCells(L, pieces, 'window').filter(function (c) { return WB.outwardDir(L, c.x, c.y) !== L.wind.from; });
    for (let j = 1 + ri(r, 3); j > 0 && outs.length; j--) {
      const c = outs.splice(ri(r, outs.length), 1)[0];
      pieces.push({ type: r() < 0.2 ? 'extractor' : 'window', x: c.x, y: c.y });
    }
  }
  const k = ri(r, maxPieces + 1);
  for (let i = 0; i < k; i++) {
    const type = mix[ri(r, mix.length)];
    let x, y;
    if (r() < 0.95) {
      const cells = WB.placementCells(L, pieces, type);
      if (!cells.length) continue;
      const c = cells[ri(r, cells.length)];
      x = c.x; y = c.y;
    } else { // unvalidated: anywhere, overlaps allowed
      x = ri(r, L.w); y = ri(r, L.h);
    }
    const p = { type: type, x: x, y: y };
    if (WB.TOOLS[type].rotations > 1) p.d = ri(r, WB.TOOLS[type].rotations);
    pieces.push(p);
  }
  return pieces;
}
const MIX_ALL = ['window', 'window', 'window', 'fan', 'fan', 'deflector', 'deflector'].concat(WB.TOOL_ORDER);
const MIX_LOOPS = ['deflector', 'deflector', 'deflector', 'fan', 'fan', 'splitter', 'splitter', 'filter', 'curtain',
  'ceilingfan', 'window', 'vent', 'extractor', 'skylight'];

// A deliberately plain model of DESIGN.md §4 (Tracing, Smoke) and §5, written from
// the text: string keys, depth-first order, explicit graph search for cycles.
// It returns only data that does not depend on the order of tracing.
function specModel(def, pieces) {
  const DX = WB.DX, DY = WB.DY;
  const map = def.map, H = map.length, Wd = map[0].length;
  const from = 'NESW'.indexOf(def.wind.from), strength = def.wind.strength, windDir = (from + 2) % 4;
  const ch = function (x, y) { return x < 0 || y < 0 || x >= Wd || y >= H ? '~' : map[y][x]; };
  const outside = function (c) { return c === '~'; };
  const wall = function (c) { return c === '#' || c === '%'; };
  const floorish = function (c) { return c === '.' || c === 'o' || 'plcnfs'.indexOf(c) >= 0; };
  const grid = new Map();
  pieces.forEach(function (p) { grid.set(p.x + ',' + p.y, p); }); // the last piece on a cell wins
  const pieceAt = function (x, y) { return grid.get(x + ',' + y) || null; };
  const outward = function (x, y) {
    if (ch(x, y) !== '#') return -1;
    for (let o = 0; o < 4; o++) if (outside(ch(x + DX[o], y + DY[o])) && floorish(ch(x - DX[o], y - DY[o]))) return o;
    return -1;
  };
  const isInlet = function (p) { return p.type === 'window' && strength > 0 && outward(p.x, p.y) === from; };
  const stoves = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < Wd; x++) if (map[y][x] === 's') stoves.push(x + ',' + y);

  function trace(starts) {
    const nodes = new Map(), cellFlow = new Map(), ends = [];
    let reached = 0, outlet = false, nSegs = 0;
    const stack = starts.map(function (s) { return { x: s[0], y: s[1], d: s[2], s: s[3], m: 0, parent: null }; }).reverse();
    while (stack.length) {
      const st = stack.pop();
      nSegs++;
      const key = [st.x, st.y, st.d, st.s, st.m].join(',');
      if (st.parent) st.parent.next.push(key);
      if (nodes.has(key)) continue; // merges into existing flow; not a terminal
      const node = { m: st.m, next: [], term: null };
      nodes.set(key, node);
      const x = st.x, y = st.y, d = st.d, s = st.s, c = ch(x, y), p = pieceAt(x, y);
      let m = st.m;
      const succ = [];
      if (outside(c)) node.term = 'outlet';
      else if (wall(c)) {
        if (p && p.type === 'vent') succ.push([d, s]);
        else if (p && ((p.type === 'window' && !isInlet(p)) || p.type === 'extractor')) node.term = 'outlet';
        else node.term = 'blocked';
      } else {
        const ci = y * Wd + x;
        cellFlow.set(ci, Math.max(cellFlow.get(ci) || 0, s));
        const k = stoves.indexOf(x + ',' + y);
        if (k >= 0) { m |= 1 << k; reached |= 1 << k; node.m = m; }
        const t = p ? p.type : null;
        if (t === 'fan') succ.push([p.d, s]);
        else if (t === 'deflector') succ.push([p.d === 0 ? [E, N, W, S][d] : [W, S, E, N][d], s]);
        else if (t === 'curtain') { if (s === 1) node.term = 'blocked'; else succ.push([d, s - 1]); }
        else if (t === 'splitter') { const hs = Math.max(1, Math.floor(s / 2)); succ.push([(d + 1) % 4, hs], [(d + 3) % 4, hs]); }
        else if (t === 'skylight') node.term = 'outlet';
        else if (t === 'filter') { m = 0; succ.push([d, s]); }
        else succ.push([d, s]);
      }
      if (node.term) {
        let ex = x + 0.5, ey = y + 0.5;
        if (wall(c)) { const f = node.term === 'outlet' ? 0.5 : -0.5; ex += f * DX[d]; ey += f * DY[d]; }
        ends.push(node.term + '@' + ex + ',' + ey);
        if (node.term === 'outlet') outlet = true;
      }
      for (let i = succ.length - 1; i >= 0; i--) {
        stack.push({ x: x + DX[succ[i][0]], y: y + DY[succ[i][0]], d: succ[i][0], s: succ[i][1], m: m, parent: node });
      }
    }
    let failed = 0;
    nodes.forEach(function (n, k) {
      if (!n.m) return;
      if (n.term === 'blocked') failed |= n.m;
      const seen = new Set(), todo = n.next.slice(); // does this smoky state reach itself?
      while (todo.length) {
        const v = todo.pop();
        if (v === k) { failed |= n.m; break; }
        if (seen.has(v)) continue;
        seen.add(v);
        todo.push.apply(todo, nodes.get(v).next);
      }
    });
    return { cellFlow: cellFlow, reached: reached, failed: failed, outlet: outlet, ends: ends.sort(), nSegs: nSegs };
  }

  const trees = [];
  pieces.forEach(function (p) {
    let t = null;
    if (p.type === 'window') { if (isInlet(p)) t = trace([[p.x + DX[windDir], p.y + DY[windDir], windDir, strength]]); }
    else if (p.type === 'fan') t = trace([[p.x + DX[p.d], p.y + DY[p.d], p.d, 1]]);
    else if (p.type === 'ceilingfan') t = trace([0, 1, 2, 3].map(function (d) { return [p.x + DX[d], p.y + DY[d], d, 1]; }));
    else if (p.type === 'extractor') {
      const o = outward(p.x, p.y);
      if (o >= 0) {
        const inw = (o + 2) % 4;
        let x = p.x + DX[inw], y = p.y + DY[inw];
        if (floorish(ch(x, y)) && !pieceAt(x, y)) {
          while (floorish(ch(x + DX[inw], y + DY[inw])) && !pieceAt(x + DX[inw], y + DY[inw])) { x += DX[inw]; y += DY[inw]; }
          t = trace([[x, y, o, 1]]);
        }
      }
    }
    if (t) {
      t.kind = { window: 'inlet', fan: 'fan', ceilingfan: 'ceilingfan', extractor: 'pull' }[p.type];
      t.active = t.kind !== 'inlet' || t.outlet;
      trees.push(t);
    }
  });
  const flow = new Array(Wd * H).fill(0);
  let reached = 0, failed = 0;
  trees.forEach(function (t) {
    if (!t.active) return;
    t.cellFlow.forEach(function (s, ci) { flow[ci] += s; });
    reached |= t.reached; failed |= t.failed;
  });
  const stoveList = stoves.map(function (key, k) {
    const xy = key.split(',').map(Number), r = (reached & (1 << k)) !== 0;
    return { x: xy[0], y: xy[1], reached: r, cleared: r && (failed & (1 << k)) === 0 };
  });
  const goals = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < Wd; x++) {
      const type = WB.OBJECT_BY_CHAR[map[y][x]];
      if (!type) continue;
      const f = flow[y * Wd + x];
      const ok = type === 'pinwheel' ? f >= 1 : type === 'candle' ? f === 0 : type === 'laundry' ? f >= 2
        : type === 'papers' ? f <= 1 : type === 'fern' ? f === 1 : stoveList[stoves.indexOf(x + ',' + y)].cleared;
      goals.push({ type: type, x: x, y: y, flow: f, ok: ok });
    }
  }
  return {
    flow: flow, stoves: stoveList, goals: goals, solved: goals.length > 0 && goals.every(function (g) { return g.ok; }),
    trees: trees.map(function (t) { return { kind: t.kind, active: t.active, ends: t.ends, nSegs: t.nSegs }; })
  };
}

function projection(R) {
  return {
    flow: Array.from(R.flow),
    stoves: R.stoves,
    goals: R.goals.map(function (g) { return { type: g.type, x: g.x, y: g.y, flow: g.flow, ok: g.ok }; }),
    solved: R.solved,
    trees: R.trees.map(function (t) {
      return {
        kind: t.kind, active: t.active, nSegs: t.segments.length,
        ends: t.ends.map(function (e) { return e.type + '@' + e.x + ',' + e.y; }).sort()
      };
    })
  };
}

// §8 geometry: segments are axis-aligned and non-empty; start segments (dist 0) begin
// at the source; every other segment begins where an earlier one ended, with
// dist = that segment's dist + its length; goal states follow §5.
function checkResult(L, R) {
  R.trees.forEach(function (t) {
    const endsAt = new Set();
    t.segments.forEach(function (g) {
      endsAt.add(g.bx + ',' + g.by + ',' + (g.dist + Math.abs(g.bx - g.ax) + Math.abs(g.by - g.ay)));
    });
    let starts = 0;
    const p = t.source;
    t.segments.forEach(function (g) {
      assert.ok((g.ax === g.bx) !== (g.ay === g.by), 'axis-aligned, non-empty');
      if (g.dist === 0) {
        starts++;
        if (t.kind === 'inlet') {
          assert.deepEqual([g.ax, g.ay], [p.x + 0.5 - 0.5 * WB.DX[L.wind.dir], p.y + 0.5 - 0.5 * WB.DY[L.wind.dir]]);
        } else if (t.kind !== 'pull') {
          assert.deepEqual([g.ax, g.ay], [p.x + 0.5, p.y + 0.5]);
        }
      } else {
        assert.ok(endsAt.has(g.ax + ',' + g.ay + ',' + g.dist), 'dist continuity');
      }
    });
    assert.equal(starts, t.kind === 'ceilingfan' ? 4 : 1, 'start segments');
  });
  R.goals.forEach(function (g) {
    const f = g.flow;
    const want = {
      pinwheel: f >= 1 ? 'happy' : 'idle',
      laundry: f >= 2 ? 'happy' : 'idle',
      candle: f === 0 ? 'happy' : 'bad',
      papers: f <= 1 ? 'happy' : 'bad',
      fern: f === 1 ? 'happy' : f === 0 ? 'idle' : 'bad'
    }[g.type];
    if (want) assert.equal(g.state, want);
    else {
      const st = R.stoves.find(function (s) { return s.x === g.x && s.y === g.y; });
      assert.equal(g.state, st.cleared ? 'happy' : st.reached ? 'bad' : 'idle');
    }
    assert.equal(g.ok, g.state === 'happy');
  });
}

function compareAll(def, L, LR, pieces) {
  const a = WB.simulate(L, pieces);
  const b = REF.simulate(LR, pieces);
  try {
    assert.deepStrictEqual(a, b);
  } catch (e) {
    assert.fail('engine differs from reference for ' + JSON.stringify({ def: def, pieces: pieces }) + '\n' + e.message.slice(0, 2000));
  }
  assert.equal(WB.isSolved(L, pieces), b.solved, 'isSolved');
  const norm = pieces.map(function (p) { return { type: p.type, x: p.x, y: p.y, d: p.d | 0 }; });
  try {
    assert.deepStrictEqual(projection(a), specModel(def, norm));
  } catch (e) {
    assert.fail('engine differs from the spec model for ' + JSON.stringify({ def: def, pieces: pieces }) + '\n' + e.message.slice(0, 2000));
  }
  checkResult(L, a);
  return a;
}

describe('audit: differential tests (reference engine and spec model)', function () {
  it('the spec model agrees with the hand-computed cases above', function () {
    const def = { map: withRow(ROOM97, 5, '#....s..#'), wind: { from: 'W', strength: 3 } };
    const pieces = [pc('window', 0, 3), pc('splitter', 4, 3), pc('deflector', 4, 5, 1), pc('deflector', 6, 5, 0),
      pc('deflector', 6, 3, 1), pc('window', 4, 0), pc('filter', 6, 4)];
    const m = specModel(def, pieces);
    assert.deepEqual(m.stoves, [{ x: 5, y: 5, reached: true, cleared: false }]);
    assert.deepEqual(m.trees, [{ kind: 'inlet', active: true, ends: ['outlet@4.5,0'], nSegs: 17 }]);
  });

  it('random houses with every tool and up to four stoves', function () {
    const r = rng(0xA0D17);
    let configs = 0, activeInlets = 0, smoky = 0, cleared = 0, solved = 0;
    for (let lv = 0; lv < 250; lv++) {
      const def = genLevel(r, false);
      const L = WB.parseLevel(def), LR = REF.parseLevel(def);
      for (let k = 0; k < 16; k++) {
        const R = compareAll(def, L, LR, genPieces(r, L, 3 + ri(r, 14), MIX_ALL));
        configs++;
        if (R.trees.some(function (t) { return t.kind === 'inlet' && t.active; })) activeInlets++;
        if (R.stoves.some(function (s) { return s.reached; })) smoky++;
        if (R.stoves.some(function (s) { return s.cleared; })) cleared++;
        if (R.solved) solved++;
      }
    }
    assert.equal(configs, 4000);
    assert.ok(activeInlets > 300, 'active inlets: ' + activeInlets);
    assert.ok(smoky > 400, 'stoves reached: ' + smoky);
    assert.ok(cleared > 150, 'stoves cleared: ' + cleared);
    assert.ok(solved > 100, 'solved: ' + solved);
  });

  it('dense loop-heavy rooms with several stoves', function () {
    const MAPS = [
      ROOM97,
      ['###########', '#....#....#', '#....#....#', '#.........#', '#....#....#', '#....#....#', '###########'],
      ['#########', '#.......#', '#.##.##.#', '#.#~~.#.#', '#.###.#.#', '#.......#', '#########'],
      ['~~~######', '~~~#....#', '####....#', '#.......#', '#.......#', '#########'],
      ['#############', '#.....#.....#', '#.....#.....#', '#.....#.....#', '###.#####.###', '#.....#.....#', '#.....#.....#', '#############']
    ];
    const r = rng(424242);
    let configs = 0, trapped = 0;
    for (let it = 0; it < 300; it++) {
      const g = MAPS[ri(r, MAPS.length)].map(function (row) { return row.split(''); });
      const nStoves = 1 + ri(r, 3);
      for (let k = 0; k < nStoves + 2; k++) {
        const y = 1 + ri(r, g.length - 2), x = 1 + ri(r, g[0].length - 2);
        if (g[y][x] === '.') g[y][x] = k < nStoves ? 's' : 'pclnf'[ri(r, 5)];
      }
      const def = { map: g.map(function (row) { return row.join(''); }), wind: { from: 'NESW'[ri(r, 4)], strength: ri(r, 4) } };
      if (WB.validateLevel(def).some(function (e) { return /sealed/.test(e); })) continue; // the 3rd map's '~~.' row
      const L = WB.parseLevel(def), LR = REF.parseLevel(def);
      for (let k = 0; k < 8; k++) {
        const R = compareAll(def, L, LR, genPieces(r, L, 6 + ri(r, 16), MIX_LOOPS));
        configs++;
        if (R.stoves.some(function (s) { return s.reached && !s.cleared; })) trapped++;
      }
    }
    assert.ok(configs > 1000, 'configs: ' + configs);
    assert.ok(trapped > 200, 'trapped smoke: ' + trapped);
  });
});

// ---------------------------------------------------------------------------
// Scratch buffers grow in the middle of the first trace (fresh engine instance)

describe('audit: buffer growth', function () {
  it('a fresh engine whose first trace outgrows its initial buffers matches the reference', function () {
    const path = require.resolve('../js/engine.js');
    const saved = require.cache[path];
    delete require.cache[path];
    let fresh;
    try { fresh = require('../js/engine.js'); } finally { require.cache[path] = saved; }
    assert.notEqual(fresh, WB);
    // 8 stoves at strength 3 on a 13 x 10 map: still the lookup table, not the Map fallback
    const def = {
      wind: { from: 'W', strength: 3 },
      map: ['#############', '#s....s....s#', '#...........#', '#...........#', '#s....s....s#',
        '#...........#', '#...........#', '#s....s.....#', '#...........#', '#############']
    };
    const pieces = [['window', 0, 2, 0], ['window', 12, 5, 0], ['splitter', 3, 2, 0], ['fan', 4, 1, 2], ['splitter', 7, 2, 0],
      ['splitter', 11, 3, 0], ['splitter', 3, 6, 0], ['deflector', 7, 3, 0], ['fan', 3, 4, 1], ['filter', 2, 2, 0],
      ['deflector', 7, 5, 1], ['ceilingfan', 1, 2, 0], ['splitter', 6, 3, 0], ['splitter', 7, 8, 0], ['splitter', 9, 5, 0],
      ['splitter', 6, 6, 0], ['splitter', 4, 3, 0], ['splitter', 9, 1, 0], ['deflector', 5, 1, 0], ['splitter', 10, 3, 0],
      ['filter', 3, 3, 0], ['splitter', 4, 8, 0], ['filter', 2, 8, 0], ['ceilingfan', 7, 1, 0], ['splitter', 3, 5, 0],
      ['fan', 9, 7, 3], ['ceilingfan', 11, 8, 0], ['fan', 8, 4, 2], ['filter', 2, 5, 0], ['ceilingfan', 11, 6, 0],
      ['splitter', 3, 7, 0], ['deflector', 5, 4, 0], ['filter', 1, 6, 0], ['splitter', 10, 8, 0], ['splitter', 2, 1, 0],
      ['fan', 1, 5, 0]
    ].map(function (a) { return pc(a[0], a[1], a[2], a[3]); });
    const L = fresh.parseLevel(def);
    assert.equal(L.stoves.length, 8);
    const R = fresh.simulate(L, pieces);
    // the initial queue and state buffers hold 256 entries; this tree has ~1,470 states
    assert.ok(R.trees.some(function (t) { return t.segments.length > 1500; }), 'one tree is far larger than the initial buffers');
    assert.deepStrictEqual(R, REF.simulate(REF.parseLevel(def), pieces));
    assert.equal(fresh.isSolved(L, pieces), R.solved);
    checkResult(L, R);
  });
});
