'use strict';
/*
 * Rule-level tests for js/engine.js. Every block refers to the section of
 * DESIGN.md it checks. Maps are tiny and hand-built so each test isolates one
 * rule. At the end, a randomized differential test compares the (optimised)
 * engine against the original implementation kept in
 * tests/fixtures/engine-reference.js.
 *
 * Run: npm test   (node --test tests/*.test.js)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const WB = require('../js/engine.js');
const REF = require('./fixtures/engine-reference.js');

const N = 0, E = 1, S = 2, W = 3;

// ---------------------------------------------------------------------------
// helpers

function lvl(map, from, strength, extra) {
  return WB.parseLevel(Object.assign({
    name: 'test',
    map: map,
    wind: { from: from === undefined ? 'W' : from, strength: strength === undefined ? 1 : strength }
  }, extra || {}));
}
function pc(type, x, y, d) { return { type: type, x: x, y: y, d: d || 0 }; }
function at(L, R, x, y) { return R.flow[y * L.w + x]; }
// Map rows with the total flow drawn on floor-ish cells ('.' = 0).
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
function dirOf(dx, dy) {
  if (dx === 0 && dy < 0) return N;
  if (dx > 0 && dy === 0) return E;
  if (dx === 0 && dy > 0) return S;
  if (dx < 0 && dy === 0) return W;
  return -1;
}
// Directions of the segments of a tree that start at the centre of cell (x, y).
function dirsFrom(tree, x, y) {
  return tree.segments
    .filter(function (g) { return g.ax === x + 0.5 && g.ay === y + 0.5; })
    .map(function (g) { return dirOf(g.bx - g.ax, g.by - g.ay); })
    .sort();
}
function sim(L, pieces) { return WB.simulate(L, pieces); }
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o) && !ArrayBuffer.isView(o)) {
    Object.freeze(o);
    Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
  }
  return o;
}

const ROOM9 = [ // 9 x 5, interior x 1..7, y 1..3
  '#########',
  '#.......#',
  '#.......#',
  '#.......#',
  '#########'
];
const ROOM7 = [ // 7 x 7, interior x 1..5, y 1..5, centre (3,3)
  '#######',
  '#.....#',
  '#.....#',
  '#.....#',
  '#.....#',
  '#.....#',
  '#######'
];
const ROOM5 = [
  '#####',
  '#...#',
  '#...#',
  '#...#',
  '#####'
];
const TWO_ROOMS = [ // interior wall at x = 4
  '#########',
  '#...#...#',
  '#...#...#',
  '#...#...#',
  '#########'
];
function withChar(map, x, y, ch) {
  return map.map(function (row, yy) { return yy === y ? row.slice(0, x) + ch + row.slice(x + 1) : row; });
}

// ---------------------------------------------------------------------------
// §1, §4 table, §5 table, §8 constants

describe('constants and tables (§1, §4, §5, §8)', function () {
  it('directions', function () {
    assert.deepEqual(WB.DX, [0, 1, 0, -1]);
    assert.deepEqual(WB.DY, [-1, 0, 1, 0]);
    assert.deepEqual(WB.DIR_NAMES, ['N', 'E', 'S', 'W']);
  });

  it('tool table: order, mounts, rotations and intro levels', function () {
    const table = [
      ['window', 'exterior', 1, 1], ['fan', 'floor', 4, 6], ['deflector', 'floor', 2, 11],
      ['curtain', 'floor', 1, 16], ['vent', 'interior', 1, 21], ['splitter', 'floor', 1, 26],
      ['extractor', 'exterior', 1, 31], ['skylight', 'floor', 1, 36], ['filter', 'floor', 1, 41],
      ['ceilingfan', 'floor', 1, 46]
    ];
    assert.deepEqual(WB.TOOL_ORDER, table.map(function (r) { return r[0]; }));
    table.forEach(function (r) {
      const t = WB.TOOLS[r[0]];
      assert.equal(t.id, r[0]);
      assert.equal(t.mount, r[1], r[0] + ' mount');
      assert.equal(t.rotations, r[2], r[0] + ' rotations');
      assert.equal(t.intro, r[3], r[0] + ' intro');
      assert.equal(typeof t.name, 'string');
      assert.equal(typeof t.desc, 'string');
    });
  });

  it('a new tool every 5 levels; all tools exist from level 46', function () {
    WB.TOOL_ORDER.forEach(function (id, i) { assert.equal(WB.TOOLS[id].intro, 1 + 5 * i); });
    assert.ok(WB.TOOL_ORDER.every(function (id) { return WB.TOOLS[id].intro <= 46; }));
  });

  it('object table: chars and intro levels', function () {
    const table = [['pinwheel', 'p', 1], ['candle', 'c', 3], ['stove', 's', 8],
      ['laundry', 'l', 13], ['papers', 'n', 18], ['fern', 'f', 23]];
    assert.deepEqual(WB.OBJECT_ORDER, table.map(function (r) { return r[0]; }));
    table.forEach(function (r) {
      const o = WB.OBJECTS[r[0]];
      assert.equal(o.id, r[0]);
      assert.equal(o.char, r[1]);
      assert.equal(o.intro, r[2]);
      assert.equal(typeof o.name, 'string');
      assert.equal(typeof o.desc, 'string');
    });
  });

  it('rotate cycles through the rotations of each tool', function () {
    assert.deepEqual([0, 1, 2, 3].map(function (d) { return WB.rotate('fan', d); }), [1, 2, 3, 0]);
    assert.deepEqual([0, 1].map(function (d) { return WB.rotate('deflector', d); }), [1, 0]);
    ['window', 'curtain', 'vent', 'splitter', 'extractor', 'skylight', 'filter', 'ceilingfan'].forEach(function (t) {
      assert.equal(WB.rotate(t, 0), 0, t);
    });
  });
});

// ---------------------------------------------------------------------------
// §2 map characters, parseLevel

describe('map characters and parseLevel (§2, §3)', function () {
  it('character classes', function () {
    ['.', 'o', 'p', 'l', 'c', 'n', 'f', 's'].forEach(function (ch) {
      assert.equal(WB.isFloorish(ch), true, ch);
      assert.equal(WB.isWall(ch), false, ch);
      assert.equal(WB.isOutside(ch), false, ch);
    });
    ['#', '%'].forEach(function (ch) {
      assert.equal(WB.isWall(ch), true, ch);
      assert.equal(WB.isFloorish(ch), false, ch);
      assert.equal(WB.isOutside(ch), false, ch);
    });
    assert.equal(WB.isOutside('~'), true);
    assert.equal(WB.isFloorish('~'), false);
    assert.equal(WB.isWall('~'), false);
    ['x', ' ', 'P', '#.'].forEach(function (ch) {
      assert.equal(WB.isFloorish(ch) || WB.isWall(ch) || WB.isOutside(ch), false, JSON.stringify(ch));
    });
  });

  it('cellAt: row-major cells, everything beyond the map edge is outside', function () {
    const L = lvl(['#%#', '#p#', '###']);
    assert.equal(WB.cellAt(L, 1, 0), '%');
    assert.equal(WB.cellAt(L, 1, 1), 'p');
    [[-1, 1], [3, 1], [1, -1], [1, 3], [-5, -5], [99, 0]].forEach(function (xy) {
      assert.equal(WB.cellAt(L, xy[0], xy[1]), '~', xy.join(','));
    });
  });

  it('parseLevel fields', function () {
    const def = {
      name: 'Name', tip: 'Tip', wind: { from: 'N', strength: 2 },
      map: ['######', '#ps..#', '#.lf.#', '######'],
      fixed: [{ type: 'window', x: 0, y: 1 }, { type: 'fan', x: 3, y: 1, d: 2 }],
      inventory: { fan: 2 }
    };
    const L = WB.parseLevel(def);
    assert.equal(L.def, def);
    assert.equal(L.name, 'Name');
    assert.equal(L.tip, 'Tip');
    assert.equal(L.w, 6);
    assert.equal(L.h, 4);
    assert.equal(L.cells.length, 24);
    assert.equal(L.cells.join(''), def.map.join(''));
    assert.deepEqual(L.objects, [
      { id: 0, type: 'pinwheel', x: 1, y: 1 },
      { id: 1, type: 'stove', x: 2, y: 1 },
      { id: 2, type: 'laundry', x: 2, y: 2 },
      { id: 3, type: 'fern', x: 3, y: 2 }
    ]);
    assert.deepEqual(L.fixed, [{ type: 'window', x: 0, y: 1, d: 0 }, { type: 'fan', x: 3, y: 1, d: 2 }]);
    assert.deepEqual(L.inventory, { fan: 2 });
    assert.notEqual(L.inventory, def.inventory);
    assert.deepEqual(L.wind, { from: N, dir: S, strength: 2 });
  });

  it('wind blows toward the opposite side: windDir = (from + 2) % 4', function () {
    [['N', S], ['E', W], ['S', N], ['W', E]].forEach(function (c) {
      const L = lvl(ROOM5, c[0], 1);
      assert.equal(L.wind.from, WB.DIR_NAMES.indexOf(c[0]));
      assert.equal(L.wind.dir, c[1], c[0]);
    });
  });

  it('objects and tables never block air', function () {
    const L = lvl(['############', '#.opslcnfo.#', '############'], 'W', 0);
    const R = sim(L, [pc('fan', 1, 1, E)]);
    assert.deepEqual(flowRows(L, R), ['############', '#.111111111#', '############']);
    assert.deepEqual(R.trees[0].ends, [{ x: 11, y: 1.5, type: 'blocked' }]);
  });
});

// ---------------------------------------------------------------------------
// §4 placement

describe('placement (§4 Placement)', function () {
  const FLOOR_TOOLS = ['fan', 'deflector', 'curtain', 'splitter', 'skylight', 'filter', 'ceilingfan'];

  it('floor tools: plain floor only, never tables, objects, walls, outside or occupied cells', function () {
    const L = lvl(['###########', '#.oplcnfs.#', '#.........#', '###########']);
    FLOOR_TOOLS.forEach(function (t) {
      assert.equal(WB.canPlace(L, [], t, 1, 1), true, t + ' on floor');
      assert.equal(WB.canPlace(L, [], t, 9, 2), true, t + ' on floor');
      for (let x = 2; x <= 8; x++) assert.equal(WB.canPlace(L, [], t, x, 1), false, t + ' on ' + L.cells[L.w + x]);
      assert.equal(WB.canPlace(L, [], t, 0, 1), false, t + ' on wall');
      assert.equal(WB.canPlace(L, [], t, 5, 0), false, t + ' on wall');
      assert.equal(WB.canPlace(L, [], t, -1, 1), false, t + ' beyond the map');
      assert.equal(WB.canPlace(L, [], t, 11, 1), false, t + ' beyond the map');
      assert.equal(WB.canPlace(L, [pc('curtain', 1, 1)], t, 1, 1), false, t + ' on an occupied cell');
      assert.equal(WB.canPlace(L, [pc('curtain', 1, 1)], t, 1, 2), true, t + ' next to a piece');
    });
  });

  it('floor tools never go on % walls or courtyard cells', function () {
    const L = lvl(['#######', '#.....#', '#.###.#', '#.#~#.#', '#.%##.#', '#.....#', '#######']);
    FLOOR_TOOLS.forEach(function (t) {
      assert.equal(WB.canPlace(L, [], t, 3, 3), false, t + ' on ~');
      assert.equal(WB.canPlace(L, [], t, 2, 4), false, t + ' on %');
    });
  });

  it('placementCells lists exactly the cells canPlace accepts', function () {
    const L = lvl(TWO_ROOMS.map(function (r, y) { return y === 2 ? '#.o.#.p.#' : r; }));
    const pieces = [pc('fan', 1, 1, E), pc('window', 8, 2)];
    WB.TOOL_ORDER.forEach(function (t) {
      const expected = [];
      for (let y = 0; y < L.h; y++) {
        for (let x = 0; x < L.w; x++) if (WB.canPlace(L, pieces, t, x, y)) expected.push({ x: x, y: y });
      }
      assert.deepEqual(WB.placementCells(L, pieces, t), expected, t);
    });
    assert.equal(WB.placementCells(L, pieces, 'window').length, 7 + 7 + 3 + 3 - 2 /* interior wall ends */ - 1 /* occupied */);
    assert.deepEqual(WB.placementCells(L, pieces, 'vent'), [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }]);
    assert.equal(WB.canPlace(L, [], 'banana', 1, 1), false);
  });

  it('exterior tools: # with outside on one side and floor-ish on the opposite side', function () {
    const L = lvl([
      '##%####',
      '#.....#',
      '%.....#',
      '#..o..#',
      '#######'
    ]);
    ['window', 'extractor'].forEach(function (t) {
      assert.equal(WB.canPlace(L, [], t, 3, 0), true, t + ' N wall');
      assert.equal(WB.canPlace(L, [], t, 6, 2), true, t + ' E wall');
      assert.equal(WB.canPlace(L, [], t, 3, 4), true, t + ' S wall, table inside');
      assert.equal(WB.canPlace(L, [], t, 0, 1), true, t + ' W wall');
      assert.equal(WB.canPlace(L, [], t, 2, 0), false, t + ' on %');
      assert.equal(WB.canPlace(L, [], t, 0, 2), false, t + ' on %');
      [[0, 0], [6, 0], [0, 4], [6, 4]].forEach(function (c) {
        assert.equal(WB.canPlace(L, [], t, c[0], c[1]), false, t + ' corner ' + c);
      });
      assert.equal(WB.canPlace(L, [], t, 2, 2), false, t + ' on floor');
      assert.equal(WB.canPlace(L, [pc('window', 3, 0)], t, 3, 0), false, t + ' occupied');
    });
    assert.equal(WB.outwardDir(L, 3, 0), N);
    assert.equal(WB.outwardDir(L, 6, 2), E);
    assert.equal(WB.outwardDir(L, 3, 4), S);
    assert.equal(WB.outwardDir(L, 0, 1), W);
    assert.equal(WB.outwardDir(L, 0, 0), -1);
    assert.equal(WB.outwardDir(L, 2, 0), -1, '% never mounts');
    assert.equal(WB.outwardDir(L, 2, 2), -1, 'floor');
  });

  it('exterior tools need floor directly inside (thick outer walls and interior walls do not qualify)', function () {
    const L = lvl([
      '##########',
      '##...#...#',
      '##...#...#',
      '##########'
    ]);
    ['window', 'extractor'].forEach(function (t) {
      assert.equal(WB.canPlace(L, [], t, 0, 1), false, t + ' thick wall, outer layer');
      assert.equal(WB.canPlace(L, [], t, 1, 1), false, t + ' thick wall, inner layer');
      assert.equal(WB.canPlace(L, [], t, 5, 1), false, t + ' interior wall');
      assert.equal(WB.canPlace(L, [], t, 9, 1), true, t + ' outer wall');
    });
  });

  it('a wall next to a courtyard (~ inside the map) is an exterior wall', function () {
    const L = lvl([
      '#######',
      '#.....#',
      '#.###.#',
      '#.#~#.#',
      '#.###.#',
      '#.....#',
      '#######'
    ]);
    assert.equal(WB.outwardDir(L, 3, 2), S);
    assert.equal(WB.outwardDir(L, 2, 3), E);
    assert.equal(WB.outwardDir(L, 4, 3), W);
    assert.equal(WB.outwardDir(L, 3, 4), N);
    assert.equal(WB.canPlace(L, [], 'window', 3, 2), true);
    assert.equal(WB.canPlace(L, [], 'extractor', 2, 3), true);
    assert.equal(WB.canPlace(L, [], 'window', 2, 2), false, 'courtyard corner');
    assert.equal(WB.canPlace(L, [], 'vent', 3, 2), false, 'touches the courtyard');
    assert.equal(WB.canPlace(L, [], 'vent', 2, 2), false, 'courtyard corner');
  });

  it('when several outward directions qualify, the first in N,E,S,W order wins', function () {
    // (1,1) has outside to the N and to the W, floor to the S and to the E.
    const map = ['~~##', '~#.#', '#..#', '####'];
    assert.deepEqual(WB.validateLevel({ map: withChar(map, 2, 2, 'p'), wind: { from: 'W', strength: 1 } }), []);
    const L = lvl(map, 'W', 1);
    assert.equal(WB.outwardDir(L, 1, 1), N);
    assert.equal(WB.windowRole(L, pc('window', 1, 1)), 'outlet', 'faces N, so a west wind does not make it an inlet');
    assert.equal(WB.windowRole(lvl(map, 'N', 1), pc('window', 1, 1)), 'inlet');
  });

  it('interior tools (vent): # with no outside neighbour and floor on both W/E or both N/S', function () {
    const L = lvl([
      '#########',
      '#...#...#',
      '#...#...#',
      '#...%...#',
      '##.###.##',
      '#.......#',
      '#########'
    ]);
    assert.equal(WB.canPlace(L, [], 'vent', 4, 1), true, 'W/E floor');
    assert.equal(WB.canPlace(L, [], 'vent', 4, 2), true, 'W/E floor');
    assert.equal(WB.canPlace(L, [], 'vent', 4, 3), false, '% wall');
    assert.equal(WB.canPlace(L, [], 'vent', 1, 4), true, 'N/S floor');
    assert.equal(WB.canPlace(L, [], 'vent', 3, 4), true, 'N/S floor');
    assert.equal(WB.canPlace(L, [], 'vent', 4, 4), false, 'junction: floor N? no, wall N');
    assert.equal(WB.canPlace(L, [], 'vent', 4, 0), false, 'exterior wall');
    assert.equal(WB.canPlace(L, [], 'vent', 0, 2), false, 'exterior wall');
    assert.equal(WB.canPlace(L, [], 'vent', 8, 5), false, 'exterior wall');
    assert.equal(WB.canPlace(L, [], 'vent', 0, 4), false, 'exterior wall');
    assert.equal(WB.canPlace(L, [], 'vent', 2, 2), false, 'floor');
    assert.equal(WB.canPlace(L, [pc('vent', 4, 1)], 'vent', 4, 1), false, 'occupied');
    // a vent is the only interior tool; exterior tools refuse interior walls
    assert.equal(WB.canPlace(L, [], 'window', 4, 1), false);
    assert.equal(WB.canPlace(L, [], 'extractor', 1, 4), false);
  });

  it('vent: not in a double wall, not with floor on one side only, yes in a free-standing pillar', function () {
    const D = lvl(['##########', '#...##...#', '#...##...#', '##########']);
    assert.equal(WB.canPlace(D, [], 'vent', 4, 1), false);
    assert.equal(WB.canPlace(D, [], 'vent', 5, 1), false);
    const P = lvl(['#######', '#.....#', '#..#..#', '#.....#', '#######']);
    assert.equal(WB.canPlace(P, [], 'vent', 3, 2), true);
    const T = lvl(['#######', '#..#..#', '#..#..#', '#.###.#', '#.....#', '#######']);
    assert.equal(WB.canPlace(T, [], 'vent', 3, 3), false, 'floor only to the S');
    assert.equal(WB.canPlace(T, [], 'vent', 2, 3), true, 'floor N and S');
  });
});

// ---------------------------------------------------------------------------
// §3, §4 window roles and cross-ventilation

describe('windows (§4 Window)', function () {
  const SIDES = { N: [2, 0], E: [4, 2], S: [2, 4], W: [0, 2] };

  it('windowRole: inlet iff the wind blows into its outward face, for every direction', function () {
    ['N', 'E', 'S', 'W'].forEach(function (from) {
      [1, 2, 3].forEach(function (s) {
        const L = lvl(ROOM5, from, s);
        Object.keys(SIDES).forEach(function (side) {
          const p = pc('window', SIDES[side][0], SIDES[side][1]);
          assert.equal(WB.windowRole(L, p), side === from ? 'inlet' : 'outlet', 'wind ' + from + s + ', window ' + side);
        });
      });
    });
  });

  it('windowRole: every window is an outlet on a calm day', function () {
    ['N', 'E', 'S', 'W'].forEach(function (from) {
      const L = lvl(ROOM5, from, 0);
      Object.keys(SIDES).forEach(function (side) {
        assert.equal(WB.windowRole(L, pc('window', SIDES[side][0], SIDES[side][1])), 'outlet');
      });
      const R = sim(L, Object.keys(SIDES).map(function (k) { return pc('window', SIDES[k][0], SIDES[k][1]); }));
      assert.equal(R.trees.length, 0, 'no inlets, no streams');
      assert.ok(R.flow.every(function (f) { return f === 0; }));
    });
  });

  it('an inlet emits wind.strength into the house in windDir, through to the opposite outlet', function () {
    ['N', 'E', 'S', 'W'].forEach(function (from) {
      const o = WB.DIR_NAMES.indexOf(from);
      const opp = WB.DIR_NAMES[(o + 2) % 4];
      [1, 2, 3].forEach(function (s) {
        const L = lvl(ROOM5, from, s);
        const R = sim(L, [pc('window', SIDES[from][0], SIDES[from][1]), pc('window', SIDES[opp][0], SIDES[opp][1])]);
        assert.equal(R.trees.length, 1);
        const t = R.trees[0];
        assert.equal(t.kind, 'inlet');
        assert.equal(t.active, true);
        assert.deepEqual(t.source, pc('window', SIDES[from][0], SIDES[from][1]));
        const line = from === 'N' || from === 'S'
          ? [[2, 1], [2, 2], [2, 3]] : [[1, 2], [2, 2], [3, 2]];
        line.forEach(function (c) { assert.equal(at(L, R, c[0], c[1]), s); });
        const total = R.flow.reduce(function (a, b) { return a + b; }, 0);
        assert.equal(total, 3 * s, 'flow only on the line');
        assert.equal(dirOf(t.segments[0].bx - t.segments[0].ax, t.segments[0].by - t.segments[0].ay), L.wind.dir);
        assert.equal(t.ends.length, 1);
        assert.equal(t.ends[0].type, 'outlet');
      });
    });
  });

  it('stalled inlet: no outlet reachable means no airflow at all (but its would-be path is traced)', function () {
    const L = lvl(withChar(ROOM9, 4, 2, 'p'));
    const R = sim(L, [pc('window', 0, 2)]);
    assert.equal(R.trees.length, 1);
    assert.equal(R.trees[0].active, false);
    assert.ok(R.flow.every(function (f) { return f === 0; }));
    assert.equal(R.trees[0].segments.length, 8);
    assert.deepEqual(R.trees[0].ends, [{ x: 8, y: 2.5, type: 'blocked' }]);
    assert.equal(goal(R, 4, 2).state, 'idle');
    assert.equal(R.solved, false);
  });

  it('cross-ventilation via an outlet window in line', function () {
    const L = lvl(withChar(ROOM9, 4, 2, 'p'));
    const R = sim(L, [pc('window', 0, 2), pc('window', 8, 2)]);
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(flowRows(L, R), ['#########', '#.......#', '#1111111#', '#.......#', '#########']);
    assert.equal(R.solved, true);
  });

  it('an outlet window that the stream never reaches does not help', function () {
    const L = lvl(ROOM9);
    const R = sim(L, [pc('window', 0, 2), pc('window', 4, 0), pc('window', 8, 1)]);
    assert.equal(R.trees.length, 1);
    assert.equal(R.trees[0].active, false);
    assert.ok(R.flow.every(function (f) { return f === 0; }));
  });

  it('cross-ventilation via an extractor', function () {
    const L = lvl(ROOM9);
    const R = sim(L, [pc('window', 0, 2), pc('extractor', 8, 2)]);
    assert.equal(treesOf(R, 'inlet')[0].active, true);
    assert.deepEqual(treesOf(R, 'inlet')[0].ends, [{ x: 9, y: 2.5, type: 'outlet' }]);
    assert.deepEqual(flowRows(L, R)[2], '#2222222#', 'inlet 1 + pull 1');
  });

  it('cross-ventilation via a skylight', function () {
    const L = lvl(ROOM9);
    const R = sim(L, [pc('window', 0, 2), pc('skylight', 5, 2)]);
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(flowRows(L, R)[2], '#11111..#');
    assert.deepEqual(R.trees[0].ends, [{ x: 5.5, y: 2.5, type: 'outlet' }]);
  });

  it('cross-ventilation via a fan redirecting the stream to an outlet', function () {
    const L = lvl(ROOM9);
    const R = sim(L, [pc('window', 0, 2), pc('fan', 4, 2, N), pc('window', 4, 0)]);
    assert.equal(treesOf(R, 'inlet')[0].active, true);
    assert.deepEqual(flowRows(L, R), ['#########', '#...2...#', '#1111...#', '#.......#', '#########']);
    // without the outlet above the fan, the inlet stalls; the fan still blows
    const R2 = sim(L, [pc('window', 0, 2), pc('fan', 4, 2, N)]);
    assert.equal(treesOf(R2, 'inlet')[0].active, false);
    assert.equal(treesOf(R2, 'fan')[0].active, true);
    assert.deepEqual(flowRows(L, R2), ['#########', '#...1...#', '#.......#', '#.......#', '#########']);
  });

  it('cross-ventilation via one branch of a splitter while the other branch dead-ends', function () {
    const L = lvl(ROOM9);
    const R = sim(L, [pc('window', 0, 2), pc('splitter', 4, 2), pc('window', 4, 0)]);
    const t = R.trees[0];
    assert.equal(t.active, true);
    assert.deepEqual(flowRows(L, R), ['#########', '#...1...#', '#1111...#', '#...1...#', '#########']);
    assert.deepEqual(t.ends, [{ x: 4.5, y: 4, type: 'blocked' }, { x: 4.5, y: 0, type: 'outlet' }]);
  });

  it('a stream reaching an inlet window from inside is blocked', function () {
    const L = lvl(ROOM9);
    // A (0,1) -> E -> '\' at (3,1) turns S -> '/' at (3,3) turns W -> B (0,3), also an inlet.
    const R = sim(L, [pc('window', 0, 1), pc('window', 0, 3), pc('deflector', 3, 1, 1), pc('deflector', 3, 3, 0)]);
    assert.equal(R.trees.length, 2);
    assert.deepEqual(R.trees[0].ends, [{ x: 1, y: 3.5, type: 'blocked' }]);
    assert.deepEqual(R.trees[1].ends, [{ x: 1, y: 1.5, type: 'blocked' }]);
    assert.equal(R.trees[0].active, false);
    assert.equal(R.trees[1].active, false);
    assert.ok(R.flow.every(function (f) { return f === 0; }));
    // the same geometry with an extractor on the windward wall instead of B works (§4 Extractor)
    const R2 = sim(L, [pc('window', 0, 1), pc('extractor', 0, 3), pc('deflector', 3, 1, 1), pc('deflector', 3, 3, 0)]);
    assert.equal(treesOf(R2, 'inlet')[0].active, true);
    assert.deepEqual(treesOf(R2, 'inlet')[0].ends, [{ x: 0, y: 3.5, type: 'outlet' }]);
    assert.deepEqual(flowRows(L, R2), ['#########', '#111....#', '#..1....#', '#221....#', '#########']);
  });

  it('a stream reaching its own inlet from inside is blocked (head-on fan)', function () {
    const L = lvl(ROOM9);
    const R = sim(L, [pc('window', 0, 2), pc('fan', 4, 2, W), pc('window', 8, 2)]);
    const t = treesOf(R, 'inlet')[0];
    assert.equal(t.active, false);
    assert.deepEqual(t.ends, [{ x: 1, y: 2.5, type: 'blocked' }]);
    assert.deepEqual(flowRows(L, R)[2], '#111....#', 'only the fan\'s own stream');
  });

  it('two inlets are independent trees; flows add up', function () {
    const L = lvl(ROOM9, 'W', 1);
    const R = sim(L, [pc('window', 0, 1), pc('window', 0, 3), pc('fan', 4, 3, E), pc('window', 8, 1), pc('window', 8, 3)]);
    const inlets = treesOf(R, 'inlet');
    assert.equal(inlets.length, 2);
    assert.ok(inlets.every(function (t) { return t.active; }));
    assert.deepEqual(flowRows(L, R), ['#########', '#1111111#', '#.......#', '#1111222#', '#########']);
  });

  it('each inlet needs its own way out: crossing another tree\'s stream does not count', function () {
    const L = lvl(ROOM9, 'W', 1);
    // B's stream is turned N by the fan and crosses A's active stream, then hits the wall
    const R = sim(L, [pc('window', 0, 1), pc('window', 0, 3), pc('fan', 4, 3, N), pc('window', 8, 1)]);
    assert.deepEqual(treesOf(R, 'inlet').map(function (t) { return t.active; }), [true, false]);
    assert.deepEqual(flowRows(L, R), ['#########', '#1112111#', '#...1...#', '#.......#', '#########']);
  });
});

// ---------------------------------------------------------------------------
// §4 fans

describe('fans (§4 Fan)', function () {
  it('a fan emits strength 1 in its direction; its own cell gets nothing from it', function () {
    [N, E, S, W].forEach(function (d) {
      const L = lvl(ROOM7, 'W', 0);
      const R = sim(L, [pc('fan', 3, 3, d)]);
      assert.equal(R.trees.length, 1);
      const t = R.trees[0];
      assert.equal(t.kind, 'fan');
      assert.equal(t.active, true);
      assert.equal(at(L, R, 3, 3), 0);
      assert.equal(at(L, R, 3 + WB.DX[d], 3 + WB.DY[d]), 1);
      assert.equal(at(L, R, 3 + 2 * WB.DX[d], 3 + 2 * WB.DY[d]), 1);
      assert.equal(at(L, R, 3 - WB.DX[d], 3 - WB.DY[d]), 0);
      assert.equal(R.flow.reduce(function (a, b) { return a + b; }, 0), 2);
      assert.deepEqual(t.ends, [{ x: 3.5 + 2.5 * WB.DX[d], y: 3.5 + 2.5 * WB.DY[d], type: 'blocked' }]);
    });
  });

  it('a fan facing a wall right away produces no flow', function () {
    const L = lvl(ROOM9, 'W', 0);
    const R = sim(L, [pc('fan', 1, 2, W)]);
    assert.ok(R.flow.every(function (f) { return f === 0; }));
    assert.deepEqual(R.trees[0].ends, [{ x: 1, y: 2.5, type: 'blocked' }]);
  });

  it('a fan redirects streams entering from any side, including head-on', function () {
    const L = lvl(ROOM7, 'W', 0);
    const F = pc('fan', 3, 3, N);
    const feeders = [
      { name: 'from behind', g: pc('fan', 3, 5, N), straightThrough: null },
      { name: 'from the W side', g: pc('fan', 1, 3, E), straightThrough: [4, 3] },
      { name: 'from the E side', g: pc('fan', 5, 3, W), straightThrough: [2, 3] },
      { name: 'head-on', g: pc('fan', 3, 1, S), straightThrough: [3, 4] }
    ];
    feeders.forEach(function (c) {
      const R = sim(L, [c.g, F]);
      const g = R.trees[0];
      assert.deepEqual(dirsFrom(g, 3, 3), [N], c.name + ': leaves the fan moving N');
      assert.equal(at(L, R, 3, 2), 2, c.name + ': fed stream + the fan\'s own stream');
      if (c.straightThrough) assert.equal(at(L, R, c.straightThrough[0], c.straightThrough[1]), 0, c.name + ': nothing passes straight');
    });
  });

  it('a fed fan adds +1 along its path', function () {
    [1, 2].forEach(function (s) {
      const L = lvl(ROOM9, 'W', s);
      const R = sim(L, [pc('window', 0, 2), pc('fan', 3, 2, E), pc('window', 8, 2)]);
      const a = String(s), b = String(s + 1);
      assert.deepEqual(flowRows(L, R)[2], '#' + a + a + a + b + b + b + b + '#');
      assert.equal(treesOf(R, 'inlet')[0].active, true);
    });
  });

  it('a fan pointing back at the inlet bounces the stream into it (blocked)', function () {
    const L = lvl(withChar(ROOM9, 6, 2, 'c'), 'W', 1);
    const R = sim(L, [pc('window', 0, 2), pc('fan', 4, 2, W), pc('window', 8, 2)]);
    assert.equal(goal(R, 6, 2).state, 'happy', 'nothing gets past the fan');
  });
});

// ---------------------------------------------------------------------------
// §4 deflectors

describe('deflectors (§4 Deflector)', function () {
  const TURN = { 0: { 0: E, 1: N, 2: W, 3: S }, 1: { 0: W, 3: N, 2: E, 1: S } };
  [0, 1].forEach(function (o) {
    [N, E, S, W].forEach(function (din) {
      const dout = TURN[o][din];
      it((o === 0 ? '/' : '\\') + ' turns ' + WB.DIR_NAMES[din] + ' into ' + WB.DIR_NAMES[dout], function () {
        const L = lvl(ROOM7, 'W', 0);
        const fan = pc('fan', 3 - 2 * WB.DX[din], 3 - 2 * WB.DY[din], din);
        const R = sim(L, [fan, pc('deflector', 3, 3, o)]);
        assert.deepEqual(dirsFrom(R.trees[0], 3, 3), [dout]);
        assert.equal(at(L, R, 3, 3), 1);
        assert.equal(at(L, R, 3 + WB.DX[dout], 3 + WB.DY[dout]), 1);
        assert.equal(at(L, R, 3 + 2 * WB.DX[dout], 3 + 2 * WB.DY[dout]), 1);
        assert.equal(at(L, R, 3 - WB.DX[dout], 3 - WB.DY[dout]), 0);
        assert.equal(at(L, R, 3 + WB.DX[din], 3 + WB.DY[din]), 0);
      });
    });
  });

  it('strength is unchanged', function () {
    const L = lvl(ROOM9, 'W', 3);
    const R = sim(L, [pc('window', 0, 2), pc('deflector', 4, 2, 0), pc('window', 4, 0)]);
    assert.deepEqual(flowRows(L, R), ['#########', '#...3...#', '#3333...#', '#.......#', '#########']);
  });
});

// ---------------------------------------------------------------------------
// §4 curtains

describe('curtains (§4 Curtain)', function () {
  it('s = 1: the stream stops at the curtain (flow is recorded there)', function () {
    const L = lvl(ROOM9, 'W', 0);
    const R = sim(L, [pc('fan', 1, 2, E), pc('curtain', 4, 2)]);
    assert.deepEqual(flowRows(L, R)[2], '#.111...#');
    assert.deepEqual(R.trees[0].ends, [{ x: 4.5, y: 2.5, type: 'blocked' }]);
  });

  it('s = 1: a curtain counts as blocked for cross-ventilation', function () {
    const L = lvl(ROOM9, 'W', 1);
    const R = sim(L, [pc('window', 0, 2), pc('curtain', 4, 2), pc('window', 8, 2)]);
    assert.equal(R.trees[0].active, false);
    assert.ok(R.flow.every(function (f) { return f === 0; }));
  });

  it('s = 2 and s = 3 lose 1', function () {
    const L3 = lvl(ROOM9, 'W', 3);
    const R3 = sim(L3, [pc('window', 0, 2), pc('curtain', 4, 2), pc('window', 8, 2)]);
    assert.deepEqual(flowRows(L3, R3)[2], '#3333222#');
    const L2 = lvl(ROOM9, 'W', 2);
    const R2 = sim(L2, [pc('window', 0, 2), pc('curtain', 4, 2), pc('window', 8, 2)]);
    assert.deepEqual(flowRows(L2, R2)[2], '#2222111#');
  });

  it('two curtains stop a strength-2 stream', function () {
    const L = lvl(ROOM9, 'W', 2);
    const R = sim(L, [pc('window', 0, 2), pc('curtain', 3, 2), pc('curtain', 5, 2), pc('window', 8, 2)]);
    assert.equal(R.trees[0].active, false);
    assert.deepEqual(R.trees[0].ends, [{ x: 5.5, y: 2.5, type: 'blocked' }]);
  });
});

// ---------------------------------------------------------------------------
// §4 vents

describe('wall vents (§4 Wall vent)', function () {
  it('a vent makes an interior wall passable (cross-ventilation through two rooms)', function () {
    const L = lvl(TWO_ROOMS, 'W', 1);
    const without = sim(L, [pc('window', 0, 2), pc('window', 8, 2)]);
    assert.equal(without.trees[0].active, false);
    const R = sim(L, [pc('window', 0, 2), pc('vent', 4, 2), pc('window', 8, 2)]);
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(flowRows(L, R)[2], '#111#111#', 'no flow is recorded in the vent cell itself');
    assert.equal(R.trees[0].ends[0].x, 9);
  });

  it('two vents in a row through two interior walls', function () {
    const L = lvl(['#############', '#...#...#...#', '#...#...#...#', '#...#...#...#', '#############'], 'W', 2);
    const R = sim(L, [pc('window', 0, 2), pc('vent', 4, 2), pc('vent', 8, 2), pc('window', 12, 2)]);
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(flowRows(L, R)[2], '#222#222#222#');
  });

  it('a double wall cannot take vents; if forced, the tracing rule still passes both', function () {
    const L = lvl(['##########', '#...##...#', '#...##...#', '##########'], 'W', 0);
    assert.equal(WB.canPlace(L, [], 'vent', 4, 1), false);
    assert.equal(WB.canPlace(L, [], 'vent', 5, 1), false);
    const R = sim(L, [pc('fan', 1, 1, E), pc('vent', 4, 1), pc('vent', 5, 1)]);
    assert.deepEqual(flowRows(L, R)[1], '#.11##111#');
  });

  it('a vent in a free-standing pillar passes air on both axes', function () {
    const L = lvl(['#######', '#.....#', '#..#..#', '#.....#', '#######'], 'W', 0);
    const R = sim(L, [pc('fan', 1, 2, E), pc('fan', 3, 1, S), pc('vent', 3, 2)]);
    assert.deepEqual(flowRows(L, R), ['#######', '#.....#', '#.1#11#', '#..1..#', '#######']);
    const blocked = sim(L, [pc('fan', 1, 2, E)]);
    assert.deepEqual(blocked.trees[0].ends, [{ x: 3, y: 2.5, type: 'blocked' }]);
  });

  it('vents cannot be placed on exterior walls', function () {
    const L = lvl(TWO_ROOMS);
    for (let x = 0; x < L.w; x++) {
      assert.equal(WB.canPlace(L, [], 'vent', x, 0), false);
      assert.equal(WB.canPlace(L, [], 'vent', x, 4), false);
    }
    for (let y = 0; y < L.h; y++) {
      assert.equal(WB.canPlace(L, [], 'vent', 0, y), false);
      assert.equal(WB.canPlace(L, [], 'vent', 8, y), false);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 splitters

describe('splitters (§4 Splitter)', function () {
  const MAP = [
    '#########',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#########'
  ];
  [[1, 1], [2, 1], [3, 1], [4, 2], [5, 2]].forEach(function (c) {
    const s = c[0], h = c[1];
    it('s = ' + s + ' splits into two streams of ' + h, function () {
      const L = lvl(MAP, 'W', s); // strengths 4 and 5 are not valid in levels, but the rule is defined for them
      const R = sim(L, [pc('window', 0, 3), pc('splitter', 4, 3), pc('window', 4, 0), pc('window', 4, 6)]);
      const a = String(s), b = String(h);
      assert.deepEqual(flowRows(L, R), [
        '#########',
        '#...' + b + '...#',
        '#...' + b + '...#',
        '#' + a + a + a + a + '...#',
        '#...' + b + '...#',
        '#...' + b + '...#',
        '#########'
      ]);
      assert.equal(R.trees[0].active, true);
      assert.deepEqual(R.trees[0].ends.map(function (e) { return e.type; }), ['outlet', 'outlet']);
    });
  });

  it('branches go left and right of the incoming direction, (d+1)%4 then (d+3)%4', function () {
    const L = lvl(MAP, 'W', 0);
    const R = sim(L, [pc('fan', 4, 5, N), pc('splitter', 4, 3)]);
    assert.deepEqual(flowRows(L, R), [
      '#########', '#.......#', '#.......#', '#1111111#', '#...1...#', '#.......#', '#########'
    ]);
    const t = R.trees[0];
    const fromSplitter = t.segments.filter(function (g) { return g.ax === 4.5 && g.ay === 3.5; });
    assert.deepEqual(fromSplitter.map(function (g) { return dirOf(g.bx - g.ax, g.by - g.ay); }), [E, W]);
  });
});

// ---------------------------------------------------------------------------
// §4 extractors

describe('extractors (§4 Extractor)', function () {
  it('pulls a strength-1 stream from the far end of the room', function () {
    const L = lvl(ROOM9, 'W', 0);
    const R = sim(L, [pc('extractor', 8, 2)]);
    assert.equal(R.trees.length, 1);
    const t = R.trees[0];
    assert.equal(t.kind, 'pull');
    assert.equal(t.active, true);
    assert.deepEqual(t.source, pc('extractor', 8, 2));
    assert.deepEqual(flowRows(L, R)[2], '#1111111#');
    assert.deepEqual(t.ends, [{ x: 9, y: 2.5, type: 'outlet' }]);
    assert.deepEqual(t.segments[0], { ax: 1, ay: 2.5, bx: 1.5, by: 2.5, s: 1, smoke: false, dist: 0 });
  });

  it('pull works on every wall', function () {
    const L = lvl(ROOM7, 'W', 0);
    const R = sim(L, [pc('extractor', 3, 0)]);
    assert.deepEqual(flowRows(L, R).map(function (r) { return r[3]; }).join(''), '#11111#');
    assert.deepEqual(R.trees[0].ends, [{ x: 3.5, y: 0, type: 'outlet' }]);
    const R2 = sim(L, [pc('extractor', 0, 2)]);
    assert.deepEqual(flowRows(L, R2)[2], '#11111#');
    assert.deepEqual(R2.trees[0].ends, [{ x: 0, y: 2.5, type: 'outlet' }]);
  });

  it('the pull line stops at pieces', function () {
    const L = lvl(ROOM9, 'W', 0);
    ['curtain', 'fan', 'deflector', 'splitter', 'skylight', 'filter', 'ceilingfan'].forEach(function (t) {
      const R = sim(L, [pc('extractor', 8, 2), pc(t, 4, 2, 0)]);
      const pull = treesOf(R, 'pull')[0];
      assert.equal(pull.segments[0].ax, 5, t);
      assert.equal(pull.segments[0].ay, 2.5, t);
      assert.equal(pull.segments.length, 4, t);
      const row = flowRows(L, R)[2];
      assert.equal(row.slice(5, 8), t === 'ceilingfan' ? '222' : '111', t);
    });
  });

  it('the pull line passes objects and tables', function () {
    const L = lvl(['#########', '#.......#', '#.lop.c.#', '#.......#', '#########'], 'W', 0);
    const R = sim(L, [pc('extractor', 8, 2)]);
    assert.deepEqual(flowRows(L, R)[2], '#1111111#');
    assert.equal(goal(R, 6, 2).state, 'bad', 'candle in the pull line');
    assert.equal(goal(R, 4, 2).state, 'happy', 'pinwheel in the pull line');
  });

  it('no pull stream when the cell just inside holds a piece', function () {
    const L = lvl(ROOM9, 'W', 0);
    const R = sim(L, [pc('extractor', 8, 2), pc('curtain', 7, 2)]);
    assert.equal(treesOf(R, 'pull').length, 0);
    assert.ok(R.flow.every(function (f) { return f === 0; }));
  });

  it('a one-cell pull line', function () {
    const L = lvl(['#####', '#...#', '#####'], 'W', 0);
    const R = sim(L, [pc('extractor', 4, 1), pc('curtain', 2, 1)]);
    assert.deepEqual(flowRows(L, R)[1], '#..1#');
  });

  it('works on the windward wall and is always an outlet (never an inlet)', function () {
    ['N', 'E', 'S', 'W'].forEach(function (from) {
      [0, 1, 3].forEach(function (s) {
        const L = lvl(ROOM9, from, s);
        const R = sim(L, [pc('extractor', 8, 2)]);
        assert.equal(R.trees.length, 1, from + s);
        assert.equal(R.trees[0].kind, 'pull');
        assert.deepEqual(flowRows(L, R)[2], '#1111111#', from + s);
      });
    });
  });

  it('acts as an outlet for other streams', function () {
    const L = lvl(ROOM9, 'W', 0);
    const R = sim(L, [pc('fan', 4, 3, N), pc('extractor', 4, 0)]);
    assert.deepEqual(treesOf(R, 'fan')[0].ends, [{ x: 4.5, y: 0, type: 'outlet' }]);
  });
});

// ---------------------------------------------------------------------------
// §4 skylights, filters, ceiling fans

describe('skylights, filters, ceiling fans (§4)', function () {
  it('skylight: an outlet in the floor; flow is recorded in its cell', function () {
    const L = lvl(ROOM9, 'W', 0);
    const R = sim(L, [pc('fan', 1, 2, E), pc('skylight', 4, 2)]);
    assert.deepEqual(flowRows(L, R)[2], '#.111...#');
    assert.deepEqual(R.trees[0].ends, [{ x: 4.5, y: 2.5, type: 'outlet' }]);
  });

  it('skylight: lets smoke out', function () {
    const L = lvl(withChar(ROOM9, 2, 2, 's'), 'W', 0);
    const R = sim(L, [pc('fan', 1, 2, E), pc('skylight', 5, 2)]);
    assert.equal(goal(R, 2, 2).state, 'happy');
    assert.deepEqual(R.stoves, [{ x: 2, y: 2, reached: true, cleared: true }]);
  });

  it('filter: strength unchanged', function () {
    const L = lvl(ROOM9, 'W', 2);
    const R = sim(L, [pc('window', 0, 2), pc('filter', 4, 2), pc('window', 8, 2)]);
    assert.deepEqual(flowRows(L, R)[2], '#2222222#');
  });

  it('filter: clears smoke so it may then hit a wall', function () {
    const L = lvl(withChar(ROOM9, 2, 2, 's'), 'W', 0);
    const bad = sim(L, [pc('fan', 1, 2, E)]);
    assert.equal(goal(bad, 2, 2).state, 'bad');
    const R = sim(L, [pc('fan', 1, 2, E), pc('filter', 5, 2)]);
    assert.equal(goal(R, 2, 2).state, 'happy');
    const segs = R.trees[0].segments;
    assert.deepEqual(segs.map(function (g) { return g.smoke; }), [false, true, true, true, false, false, false]);
  });

  it('filter: before the stove it does not help', function () {
    const L = lvl(withChar(ROOM9, 4, 2, 's'), 'W', 0);
    const R = sim(L, [pc('fan', 1, 2, E), pc('filter', 2, 2)]);
    assert.equal(goal(R, 4, 2).state, 'bad');
  });

  it('ceiling fan: four strength-1 streams', function () {
    const L = lvl(ROOM7, 'W', 0);
    const R = sim(L, [pc('ceilingfan', 3, 3)]);
    assert.equal(R.trees.length, 1);
    assert.equal(R.trees[0].kind, 'ceilingfan');
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(flowRows(L, R), ['#######', '#..1..#', '#..1..#', '#11.11#', '#..1..#', '#..1..#', '#######']);
    assert.deepEqual(R.trees[0].ends.map(function (e) { return e.type; }), ['blocked', 'blocked', 'blocked', 'blocked']);
    assert.deepEqual(dirsFrom(R.trees[0], 3, 3), [N, E, S, W]);
  });

  it('ceiling fan: streams pass straight through unchanged', function () {
    const L = lvl(ROOM7, 'W', 2);
    const R = sim(L, [pc('window', 0, 3), pc('ceilingfan', 3, 3), pc('window', 6, 3)]);
    // inlet 2 everywhere on row 3; the ceiling fan adds 1 on both sides (its W stream hits the inlet)
    assert.deepEqual(flowRows(L, R), ['#######', '#..1..#', '#..1..#', '#33233#', '#..1..#', '#..1..#', '#######']);
    assert.deepEqual(dirsFrom(treesOf(R, 'inlet')[0], 3, 3), [E]);
    assert.equal(treesOf(R, 'inlet')[0].active, true);
  });
});

// ---------------------------------------------------------------------------
// §4 Tracing: per-tree max, cross-tree sum, merging

describe('flow accounting (§4 Tracing)', function () {
  it('per tree, the flow at a cell is the max over its states (a stream crossing itself)', function () {
    const L = lvl(ROOM7, 'W', 0);
    // fan E along row 3, '/' at (4,3) -> N, '\' at (4,1) -> W, '/' at (2,1) -> S, crosses row 3 at (2,3)
    const R = sim(L, [pc('fan', 1, 3, E), pc('deflector', 4, 3, 0), pc('deflector', 4, 1, 1), pc('deflector', 2, 1, 0)]);
    assert.deepEqual(flowRows(L, R), ['#######', '#.111.#', '#.1.1.#', '#.111.#', '#.1...#', '#.1...#', '#######']);
  });

  it('per tree max with different strengths', function () {
    const L = lvl(ROOM7, 'W', 3);
    // inlet 3 along row 3, curtain at (3,3) -> 2, then loops back across (2,3) going S to an outlet
    const R = sim(L, [pc('window', 0, 3), pc('curtain', 3, 3), pc('deflector', 4, 3, 0), pc('deflector', 4, 1, 1),
      pc('deflector', 2, 1, 0), pc('window', 2, 6)]);
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(flowRows(L, R), ['#######', '#.222.#', '#.2.2.#', '#3332.#', '#.2...#', '#.2...#', '#######']);
  });

  it('across trees, flows are summed', function () {
    const L = lvl(ROOM7, 'W', 0);
    const R = sim(L, [pc('fan', 1, 3, E), pc('fan', 3, 1, S)]);
    assert.deepEqual(flowRows(L, R), ['#######', '#.....#', '#..1..#', '#.1211#', '#..1..#', '#..1..#', '#######']);
  });

  it('a fan loop terminates (states are visited once) and has no ends', function () {
    const L = lvl(ROOM7, 'W', 0);
    const R = sim(L, [pc('fan', 1, 1, E), pc('deflector', 5, 1, 1), pc('deflector', 5, 5, 0), pc('deflector', 1, 5, 1)]);
    assert.deepEqual(flowRows(L, R), ['#######', '#11111#', '#1...1#', '#1...1#', '#1...1#', '#11111#', '#######']);
    assert.deepEqual(R.trees[0].ends, []);
  });

  it('total flow ignores stalled inlets but counts fans, ceiling fans and pulls', function () {
    const L = lvl(ROOM7, 'W', 1);
    const R = sim(L, [pc('window', 0, 1), pc('fan', 1, 3, E), pc('ceilingfan', 3, 5), pc('extractor', 6, 2)]);
    assert.deepEqual(R.trees.map(function (t) { return t.kind + ':' + t.active; }),
      ['inlet:false', 'fan:true', 'ceilingfan:true', 'pull:true']);
    assert.deepEqual(flowRows(L, R), ['#######', '#..1..#', '#11211#', '#.1211#', '#..1..#', '#11.11#', '#######']);
  });

  it('leaving the map (only possible in an unsealed map) is an outlet', function () {
    const L = lvl(['#######', '~.....#', '#######'], 'E', 1);
    const R = sim(L, [pc('window', 6, 1)]);
    assert.equal(R.trees[0].active, true);
    assert.deepEqual(R.trees[0].ends, [{ x: 0.5, y: 1.5, type: 'outlet' }]);
    const L2 = lvl(['#####', '#...#', '#....', '#####'], 'W', 0);
    const R2 = sim(L2, [pc('fan', 1, 2, E)]);
    assert.deepEqual(R2.trees[0].ends, [{ x: 5.5, y: 2.5, type: 'outlet' }]);
    assert.deepEqual(flowRows(L2, R2)[2], '#.111');
  });

  it('only the given pieces count (pieces = fixed + player pieces)', function () {
    const L = WB.parseLevel({ map: withChar(ROOM9, 4, 2, 'p'), wind: { from: 'W', strength: 1 }, fixed: [pc('window', 0, 2)] });
    assert.equal(sim(L, []).trees.length, 0);
    assert.equal(sim(L).trees.length, 0);
    assert.equal(sim(L, L.fixed.concat([pc('window', 8, 2)])).solved, true);
  });
});

// ---------------------------------------------------------------------------
// §4 Smoke

describe('smoke (§4 Smoke)', function () {
  const SMAP = withChar(ROOM9, 3, 2, 's');

  it('not reached: idle', function () {
    const L = lvl(SMAP, 'W', 0);
    const R = sim(L, [pc('fan', 1, 1, E)]);
    assert.equal(goal(R, 3, 2).state, 'idle');
    assert.equal(goal(R, 3, 2).ok, false);
    assert.deepEqual(R.stoves, [{ x: 3, y: 2, reached: false, cleared: false }]);
  });

  it('blown into a wall: bad', function () {
    const L = lvl(SMAP, 'W', 0);
    const R = sim(L, [pc('fan', 1, 2, E)]);
    assert.equal(goal(R, 3, 2).state, 'bad');
    assert.deepEqual(R.stoves, [{ x: 3, y: 2, reached: true, cleared: false }]);
  });

  it('out of a window: happy', function () {
    const L = lvl(SMAP, 'W', 1);
    const R = sim(L, [pc('window', 0, 2), pc('window', 8, 2)]);
    assert.equal(goal(R, 3, 2).state, 'happy');
    assert.equal(goal(R, 3, 2).ok, true);
    assert.deepEqual(R.stoves, [{ x: 3, y: 2, reached: true, cleared: true }]);
    assert.deepEqual(R.trees[0].segments.map(function (g) { return g.smoke; }), [false, false, false, true, true, true, true, true]);
  });

  it('out of an extractor (pull through the stove): happy', function () {
    const L = lvl(SMAP, 'W', 0);
    assert.equal(goal(sim(L, [pc('extractor', 8, 2)]), 3, 2).state, 'happy');
  });

  it('a stalled inlet carrying smoke into a wall does not count (idle)', function () {
    const L = lvl(SMAP, 'W', 1);
    const R = sim(L, [pc('window', 0, 2)]);
    assert.equal(R.trees[0].active, false);
    assert.equal(goal(R, 3, 2).state, 'idle');
  });

  it('split, one smoky branch into a wall: bad; both branches out: happy', function () {
    const L = lvl(SMAP, 'W', 1);
    const bad = sim(L, [pc('window', 0, 2), pc('splitter', 5, 2), pc('window', 5, 0)]);
    assert.equal(bad.trees[0].active, true);
    assert.equal(goal(bad, 3, 2).state, 'bad');
    const good = sim(L, [pc('window', 0, 2), pc('splitter', 5, 2), pc('window', 5, 0), pc('window', 5, 4)]);
    assert.equal(goal(good, 3, 2).state, 'happy');
  });

  it('split, smoky branch filtered before the wall: happy', function () {
    const L = lvl(withChar(SMAP, 5, 1, '.'), 'W', 1);
    const R = sim(L, [pc('window', 0, 2), pc('splitter', 5, 2), pc('window', 5, 0), pc('filter', 5, 3)]);
    assert.equal(goal(R, 3, 2).state, 'happy');
  });

  it('smoke into a curtain that stops it: bad (curtain counts as blocked)', function () {
    const L = lvl(SMAP, 'W', 0);
    const R = sim(L, [pc('fan', 1, 2, E), pc('curtain', 5, 2)]);
    assert.equal(goal(R, 3, 2).state, 'bad');
  });

  it('smoke into an inlet window from inside: bad', function () {
    const L = lvl(SMAP, 'E', 1);
    // inlet on the E wall; the fan blows the smoke east, into the inlet
    const R = sim(L, [pc('window', 8, 2), pc('fan', 1, 2, E), pc('window', 0, 2)]);
    assert.equal(goal(R, 3, 2).state, 'bad');
  });

  it('smoke on a fan loop: bad', function () {
    const L = lvl(withChar(ROOM7, 3, 1, 's'), 'W', 0);
    const loop = [pc('fan', 1, 1, E), pc('deflector', 5, 1, 1), pc('deflector', 5, 5, 0), pc('deflector', 1, 5, 1)];
    const R = sim(L, loop);
    assert.deepEqual(R.trees[0].ends, [], 'no terminal at all');
    assert.equal(goal(R, 3, 1).state, 'bad');
    assert.deepEqual(R.stoves, [{ x: 3, y: 1, reached: true, cleared: false }]);
  });

  it('a loop elsewhere does not taint smoke that leaves cleanly', function () {
    const L = lvl([
      '#########',
      '#.......#',
      '#.......#',
      '#.......#',
      '#.......#',
      '#s......#',
      '#########'
    ], 'W', 0);
    const loop = [pc('fan', 2, 1, E), pc('deflector', 6, 1, 1), pc('deflector', 6, 4, 0), pc('deflector', 2, 4, 1)];
    const R = sim(L, loop.concat([pc('extractor', 8, 5)]));
    assert.equal(goal(R, 1, 5).state, 'happy');
  });

  it('two smoky branches merging (no cycle): fine', function () {
    const L = lvl([
      '###########',
      '#.........#',
      '#.........#',
      '#.s.......#',
      '#.........#',
      '#.........#',
      '###########'
    ], 'W', 1);
    const pieces = [pc('window', 0, 3), pc('splitter', 4, 3),
      pc('deflector', 4, 2, 0), pc('deflector', 6, 2, 1), // N branch: N -> E -> S into the fan
      pc('deflector', 4, 4, 1), pc('deflector', 6, 4, 0), // S branch: S -> E -> N into the fan
      pc('fan', 6, 3, E), pc('window', 10, 3)];
    const R = sim(L, pieces);
    const inlet = treesOf(R, 'inlet')[0];
    assert.equal(inlet.active, true);
    // both branches enter the fan and leave as the same state: only one end for the inlet tree
    assert.deepEqual(inlet.ends, [{ x: 11, y: 3.5, type: 'outlet' }]);
    const intoNext = inlet.segments.filter(function (g) { return g.bx === 7.5 && g.by === 3.5; });
    assert.equal(intoNext.length, 2, 'two segments arrive at the merge state');
    assert.equal(goal(R, 2, 3).state, 'happy');
  });

  it('multiple stoves are independent', function () {
    const L = lvl([
      '#########',
      '#.s.....#',
      '#.......#',
      '#.s.....#',
      '#########'
    ], 'W', 0);
    const R = sim(L, [pc('fan', 1, 1, E), pc('window', 8, 1), pc('fan', 1, 3, E)]);
    assert.deepEqual(R.stoves, [
      { x: 2, y: 1, reached: true, cleared: true },
      { x: 2, y: 3, reached: true, cleared: false }
    ]);
    assert.deepEqual(R.goals.map(function (g) { return g.state; }), ['happy', 'bad']);
    const R2 = sim(L, [pc('fan', 1, 1, E), pc('window', 8, 1)]);
    assert.deepEqual(R2.goals.map(function (g) { return g.state; }), ['happy', 'idle']);
  });

  it('a stream carrying two smokes into a wall spoils both', function () {
    const L = lvl(['#########', '#.s.s...#', '#########'], 'W', 0);
    const R = sim(L, [pc('fan', 1, 1, E)]);
    assert.deepEqual(R.goals.map(function (g) { return g.state; }), ['bad', 'bad']);
    const R2 = sim(L, [pc('fan', 1, 1, E), pc('window', 8, 1)]);
    assert.deepEqual(R2.goals.map(function (g) { return g.state; }), ['happy', 'happy']);
  });

  it('every active tree must be clean: a second tree blowing the smoke into a wall spoils it', function () {
    const L = lvl(['#########', '#.s.....#', '#.......#', '#########'], 'W', 0);
    const good = sim(L, [pc('fan', 1, 1, E), pc('window', 8, 1)]);
    assert.equal(goal(good, 2, 1).state, 'happy');
    const R = sim(L, [pc('fan', 1, 1, E), pc('window', 8, 1), pc('fan', 2, 2, N)]);
    assert.equal(goal(R, 2, 1).state, 'bad');
  });
});

// ---------------------------------------------------------------------------
// §5 goals

describe('objects and the goal (§5)', function () {
  // flow f at (3,2): 0 = stalled inlet, else inlet + outlet with strength f
  function withFlow(ch, f) {
    const L = lvl(withChar(ROOM9, 3, 2, ch), 'W', Math.max(1, f));
    const R = sim(L, f === 0 ? [pc('window', 0, 2)] : [pc('window', 0, 2), pc('window', 8, 2)]);
    assert.equal(at(L, R, 3, 2), f);
    return goal(R, 3, 2);
  }
  const CASES = {
    p: ['idle', 'happy', 'happy', 'happy'],
    c: ['happy', 'bad', 'bad', 'bad'],
    l: ['idle', 'idle', 'happy', 'happy'],
    n: ['happy', 'happy', 'bad', 'bad'],
    f: ['idle', 'happy', 'bad', 'bad']
  };
  Object.keys(CASES).forEach(function (ch) {
    it(WB.OBJECT_BY_CHAR[ch] + ': states for flow 0..3', function () {
      [0, 1, 2, 3].forEach(function (f) {
        const g = withFlow(ch, f);
        assert.equal(g.type, WB.OBJECT_BY_CHAR[ch]);
        assert.equal(g.x, 3);
        assert.equal(g.y, 2);
        assert.equal(g.flow, f);
        assert.equal(g.state, CASES[ch][f], 'flow ' + f);
        assert.equal(g.ok, CASES[ch][f] === 'happy', 'flow ' + f);
      });
    });
  });

  it('stove: idle / bad / happy', function () {
    const L = lvl(withChar(ROOM9, 3, 2, 's'), 'W', 0);
    assert.equal(goal(sim(L, []), 3, 2).state, 'idle');
    assert.equal(goal(sim(L, [pc('fan', 1, 2, E)]), 3, 2).state, 'bad');
    const g = goal(sim(L, [pc('fan', 1, 2, E), pc('window', 8, 2)]), 3, 2);
    assert.deepEqual(g, { type: 'stove', x: 3, y: 2, flow: 1, ok: true, state: 'happy' });
  });

  it('goals are listed in map order with their flow', function () {
    const L = lvl(['#########', '#c.....p#', '#..l.f..#', '#n......#', '#########'], 'W', 1);
    const R = sim(L, [pc('window', 0, 2), pc('window', 8, 2)]);
    assert.deepEqual(R.goals.map(function (g) { return [g.type, g.x, g.y, g.flow]; }), [
      ['candle', 1, 1, 0], ['pinwheel', 7, 1, 0], ['laundry', 3, 2, 1], ['fern', 5, 2, 1], ['papers', 1, 3, 0]
    ]);
  });

  it('solved requires every object to be happy at the same time', function () {
    const L = lvl(['#########', '#c......#', '#..p.f..#', '#.......#', '#########'], 'W', 1);
    const open = [pc('window', 0, 2), pc('window', 8, 2)];
    const R = sim(L, open);
    assert.deepEqual(R.goals.map(function (g) { return g.state; }), ['happy', 'happy', 'happy']);
    assert.equal(R.solved, true);
    assert.equal(WB.isSolved(L, open), true);
    const R2 = sim(L, [pc('window', 0, 1), pc('window', 8, 1)]); // candle row instead
    assert.deepEqual(R2.goals.map(function (g) { return g.state; }), ['bad', 'idle', 'idle']);
    assert.equal(R2.solved, false);
    assert.equal(WB.isSolved(L, [pc('window', 0, 1), pc('window', 8, 1)]), false);
    const L2 = lvl(['#########', '#.......#', '#..p.l..#', '#.......#', '#########'], 'W', 1);
    const R3 = sim(L2, open);
    assert.deepEqual(R3.goals.map(function (g) { return g.state; }), ['happy', 'idle']);
    assert.equal(R3.solved, false);
  });

  it('a map without objects is never solved', function () {
    assert.equal(sim(lvl(ROOM9), []).solved, false);
  });
});

// ---------------------------------------------------------------------------
// §6 level checks: validateLevel / introErrors

describe('validateLevel (§2, §6)', function () {
  function base() {
    return {
      name: 'ok', wind: { from: 'W', strength: 1 },
      map: withChar(ROOM9, 4, 2, 'p'),
      fixed: [{ type: 'window', x: 0, y: 2 }],
      inventory: { window: 1, fan: 1 },
      solution: [{ type: 'window', x: 8, y: 2 }]
    };
  }
  function errs(mut) { const d = base(); mut(d); return WB.validateLevel(d); }
  function has(list, re) { assert.ok(list.some(function (e) { return re.test(e); }), 'expected ' + re + ' in ' + JSON.stringify(list)); }

  it('a valid level has no errors', function () {
    assert.deepEqual(WB.validateLevel(base()), []);
    assert.deepEqual(errs(function (d) { d.wind = { from: 'N', strength: 0 }; }), []);
    assert.deepEqual(errs(function (d) { d.solution.push({ type: 'fan', x: 2, y: 2, d: 3 }); }), []);
  });

  it('empty or missing map', function () {
    assert.deepEqual(WB.validateLevel({}), ['map is missing or empty']);
    assert.deepEqual(WB.validateLevel({ map: [] }), ['map is missing or empty']);
    assert.deepEqual(WB.validateLevel(null), ['map is missing or empty']);
  });

  it('non-rectangular map', function () {
    has(errs(function (d) { d.map[2] = '#..p...#'; }), /row 2 has length 8, expected 9/);
    has(errs(function (d) { d.map[1] = 7; }), /row 1 is not a string/);
  });

  it('unsealed map: floor touching the map edge or a courtyard', function () {
    has(errs(function (d) { d.map = withChar(d.map, 0, 1, '.'); }), /floor at 0,1 touches outside/);
    has(errs(function (d) { d.map = withChar(d.map, 8, 3, '~'); }), /floor at 7,3 touches outside/);
    has(errs(function (d) { d.map = ['#######', '#.....#', '#..~..#', '#..p..#', '#######']; d.fixed = []; d.solution = []; }), /not sealed/);
    // a sealed courtyard is fine
    assert.deepEqual(errs(function (d) {
      d.map = ['#######', '#.....#', '#.###.#', '#.#~#.#', '#.###.#', '#..p..#', '#######'];
      d.fixed = []; d.solution = [{ type: 'window', x: 3, y: 2 }];
    }), []);
  });

  it('unknown characters', function () {
    has(errs(function (d) { d.map = withChar(d.map, 2, 2, 'x'); }), /unknown char "x" at 2,2/);
    has(errs(function (d) { d.map = withChar(d.map, 2, 2, ' '); }), /unknown char " " at 2,2/);
  });

  it('size limit 13 x 10', function () {
    const wide = ['##############', '#p...........#', '##############'];
    has(errs(function (d) { d.map = wide; d.fixed = []; d.solution = []; }), /map is 14x3, max 13x10/);
    const tall = ['###'].concat(Array(9).fill('#p#')).concat(['###']);
    has(errs(function (d) { d.map = tall; d.fixed = []; d.solution = []; }), /map is 3x11, max 13x10/);
    const ok = ['#############'].concat(Array(8).fill('#p..........#')).concat(['#############']);
    assert.deepEqual(errs(function (d) { d.map = ok; d.fixed = []; d.solution = []; }), []);
  });

  it('bad wind', function () {
    [4, -1, 1.5, '1', null, undefined].forEach(function (s) {
      has(errs(function (d) { d.wind = { from: 'W', strength: s }; }), /wind.strength must be an integer 0..3/);
    });
    has(errs(function (d) { delete d.wind; }), /wind.strength/);
    has(errs(function (d) { d.wind = { from: 'X', strength: 1 }; }), /wind.from must be one of N, E, S, W/);
    has(errs(function (d) { d.wind = { strength: 1 }; }), /wind.from/);
  });

  it('no objects', function () {
    has(errs(function (d) { d.map = ROOM9; }), /no objects/);
  });

  it('pieces on bad cells', function () {
    has(errs(function (d) { d.solution = [{ type: 'window', x: 4, y: 1 }]; }), /solution\[0\]: window cannot be mounted at 4,1/);
    has(errs(function (d) { d.solution = [{ type: 'window', x: 0, y: 0 }]; }), /cannot be mounted at 0,0/);
    has(errs(function (d) { d.fixed.push({ type: 'fan', x: 8, y: 1 }); }), /fixed\[1\]: fan cannot be mounted at 8,1/);
    has(errs(function (d) { d.fixed.push({ type: 'fan', x: 4, y: 2 }); }), /fan cannot be mounted at 4,2/);
    has(errs(function (d) { d.inventory.vent = 1; d.solution.push({ type: 'vent', x: 8, y: 2 }); }), /vent cannot be mounted/);
    has(errs(function (d) { d.fixed.push({ type: 'fan', x: 20, y: 1 }); }), /cannot be mounted at 20,1/);
    has(errs(function (d) { d.fixed.push({ type: 'rocket', x: 2, y: 1 }); }), /fixed\[1\]: unknown tool rocket/);
  });

  it('overlapping pieces', function () {
    has(errs(function (d) { d.solution = [{ type: 'window', x: 0, y: 2 }]; }), /solution\[0\]: window overlaps another piece at 0,2/);
    has(errs(function (d) { d.fixed.push({ type: 'fan', x: 2, y: 1 }, { type: 'curtain', x: 2, y: 1 }); }), /fixed\[2\]: curtain overlaps/);
  });

  it('bad rotations', function () {
    has(errs(function (d) { d.solution.push({ type: 'fan', x: 2, y: 1, d: 4 }); }), /rotation 4 invalid for fan/);
    has(errs(function (d) { d.inventory.deflector = 1; d.solution.push({ type: 'deflector', x: 2, y: 1, d: 2 }); }), /rotation 2 invalid for deflector/);
    has(errs(function (d) { d.solution[0].d = 1; }), /rotation 1 invalid for window/);
  });

  it('solution must fit the inventory', function () {
    has(errs(function (d) { d.solution.push({ type: 'window', x: 8, y: 1 }); }), /solution uses 2 window but inventory has 1/);
    has(errs(function (d) { d.solution.push({ type: 'curtain', x: 2, y: 1 }); }), /solution uses 1 curtain but inventory has 0/);
  });

  it('inventory entries', function () {
    has(errs(function (d) { d.inventory.rocket = 1; }), /unknown tool in inventory: rocket/);
    has(errs(function (d) { d.inventory.fan = 1.5; }), /inventory count for fan/);
    has(errs(function (d) { d.inventory.fan = -1; }), /inventory count for fan/);
  });
});

describe('introErrors (§5, §6.3)', function () {
  function def(extra) {
    return Object.assign({ map: withChar(ROOM9, 4, 2, 'p'), wind: { from: 'W', strength: 1 }, fixed: [], inventory: {} }, extra || {});
  }
  it('a plain level-1 level is fine', function () {
    assert.deepEqual(WB.introErrors(def({ inventory: { window: 2 } }), 1), []);
  });

  it('tools only from their intro level (inventory and fixed)', function () {
    WB.TOOL_ORDER.forEach(function (t) {
      const intro = WB.TOOLS[t].intro;
      const inv = {}; inv[t] = 1;
      const placement = WB.placementCells(lvl(TWO_ROOMS), [], t)[0];
      const fixed = [pc(t, placement.x, placement.y)];
      const wind = { from: 'W', strength: 1 };
      const map = TWO_ROOMS.map(function (r, y) { return y === 2 ? '#.p.#.p.#' : r; });
      if (intro > 1) {
        assert.ok(WB.introErrors(def({ map: map, wind: wind, inventory: inv }), intro - 1).some(function (e) { return e.indexOf('tool ' + t) === 0; }), t);
        assert.ok(WB.introErrors(def({ map: map, wind: wind, fixed: fixed }), intro - 1).some(function (e) { return e.indexOf('fixed ' + t) === 0; }), t);
      }
      assert.deepEqual(WB.introErrors(def({ map: map, wind: wind, inventory: inv, fixed: fixed }), intro), [], t);
      assert.deepEqual(WB.introErrors(def({ map: map, wind: wind, inventory: inv, fixed: fixed }), 100), [], t);
    });
  });

  it('an inventory count of 0 for a future tool is not an error', function () {
    assert.deepEqual(WB.introErrors(def({ inventory: { window: 1, ceilingfan: 0 } }), 1), []);
  });

  it('objects only from their intro level', function () {
    WB.OBJECT_ORDER.forEach(function (o) {
      const intro = WB.OBJECTS[o].intro;
      const d = def({ map: withChar(ROOM9, 4, 2, WB.OBJECTS[o].char) });
      if (intro > 1) {
        assert.deepEqual(WB.introErrors(d, intro - 1), ['object ' + o + ' not introduced until level ' + intro]);
      }
      assert.deepEqual(WB.introErrors(d, intro), []);
    });
  });

  it('calm days from level 6, wind 2 from level 13, wind 3 from level 26', function () {
    function w(s, n) { return WB.introErrors(def({ wind: { from: 'W', strength: s } }), n); }
    assert.equal(w(0, 5).length, 1);
    assert.match(w(0, 5)[0], /calm/);
    assert.deepEqual(w(0, 6), []);
    assert.equal(w(2, 12).length, 1);
    assert.match(w(2, 12)[0], /strength 2/);
    assert.deepEqual(w(2, 13), []);
    assert.equal(w(3, 25).length, 1);
    assert.match(w(3, 25)[0], /strength 3/);
    assert.deepEqual(w(3, 26), []);
    assert.deepEqual(w(1, 1), []);
  });
});

// ---------------------------------------------------------------------------
// §8 Result geometry

// Every non-start segment continues from the end of an earlier segment, and its
// dist is that segment's dist plus its length.
function checkGeometry(R) {
  R.trees.forEach(function (t) {
    t.segments.forEach(function (g, i) {
      assert.ok(g.ax === g.bx || g.ay === g.by, 'axis aligned');
      assert.ok(g.s >= 1, 'strength');
      assert.equal(typeof g.smoke, 'boolean');
      if (g.dist === 0) return;
      const prev = t.segments.slice(0, i).find(function (h) {
        return h.bx === g.ax && h.by === g.ay &&
          h.dist + Math.abs(h.bx - h.ax) + Math.abs(h.by - h.ay) === g.dist;
      });
      assert.ok(prev, 'segment ' + i + ' continues an earlier one');
    });
    t.ends.forEach(function (e) {
      assert.ok(t.segments.some(function (g) { return g.bx === e.x && g.by === e.y; }), 'end is the end of a segment');
    });
  });
}

describe('result geometry (§8)', function () {
  it('inlet: starts at the outer face of the window, dist grows along a straight path', function () {
    const L = lvl(ROOM9, 'W', 1);
    const R = sim(L, [pc('window', 0, 2), pc('window', 8, 2)]);
    const segs = R.trees[0].segments;
    assert.deepEqual(segs[0], { ax: 0, ay: 2.5, bx: 1.5, by: 2.5, s: 1, smoke: false, dist: 0 });
    assert.deepEqual(segs.map(function (g) { return g.dist; }), [0, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
    for (let i = 1; i < segs.length; i++) assert.ok(segs[i].dist >= segs[i - 1].dist);
    assert.deepEqual(segs[7], { ax: 7.5, ay: 2.5, bx: 9, by: 2.5, s: 1, smoke: false, dist: 7.5 });
    checkGeometry(R);
  });

  it('fan: starts at the fan centre', function () {
    const L = lvl(ROOM9, 'W', 0);
    const R = sim(L, [pc('fan', 2, 2, E)]);
    assert.deepEqual(R.trees[0].segments.map(function (g) { return [g.ax, g.bx, g.dist]; }),
      [[2.5, 3.5, 0], [3.5, 4.5, 1], [4.5, 5.5, 2], [5.5, 6.5, 3], [6.5, 7.5, 4], [7.5, 8, 5]]);
  });

  it('outlet ends lie beyond the wall centre, blocked ends at the wall face', function () {
    const L = lvl(ROOM7, 'W', 0);
    [N, E, S, W].forEach(function (d) {
      const wx = 3 + 3 * WB.DX[d], wy = 3 + 3 * WB.DY[d];
      const blocked = sim(L, [pc('fan', 3, 3, d)]).trees[0].ends;
      assert.deepEqual(blocked, [{ x: wx + 0.5 - 0.5 * WB.DX[d], y: wy + 0.5 - 0.5 * WB.DY[d], type: 'blocked' }]);
      const out = sim(L, [pc('fan', 3, 3, d), pc('window', wx, wy)]).trees[0].ends;
      assert.deepEqual(out, [{ x: wx + 0.5 + 0.5 * WB.DX[d], y: wy + 0.5 + 0.5 * WB.DY[d], type: 'outlet' }]);
      const ex = sim(L, [pc('fan', 3, 3, d), pc('extractor', wx, wy)]);
      assert.deepEqual(treesOf(ex, 'fan')[0].ends, out);
    });
  });

  it('a vent is drawn through: the segment ends at the vent centre and continues', function () {
    const L = lvl(TWO_ROOMS, 'W', 1);
    const R = sim(L, [pc('window', 0, 2), pc('vent', 4, 2), pc('window', 8, 2)]);
    const segs = R.trees[0].segments;
    assert.ok(segs.some(function (g) { return g.ax === 3.5 && g.bx === 4.5 && g.ay === 2.5; }));
    assert.ok(segs.some(function (g) { return g.ax === 4.5 && g.bx === 5.5 && g.ay === 2.5; }));
    checkGeometry(R);
  });

  it('segment strength follows curtains and splitters', function () {
    const L = lvl(ROOM9, 'W', 3);
    const R = sim(L, [pc('window', 0, 2), pc('curtain', 2, 2), pc('splitter', 5, 2), pc('window', 5, 0), pc('window', 5, 4)]);
    const segs = R.trees[0].segments;
    assert.deepEqual(segs.map(function (g) { return g.s; }), [3, 3, 2, 2, 2, 1, 1, 1, 1]);
    checkGeometry(R);
  });
});

// ---------------------------------------------------------------------------
// determinism, purity

const BUSY = {
  name: 'busy', wind: { from: 'W', strength: 2 },
  map: [
    '#############',
    '#.....#.....#',
    '#..s..#..l..#',
    '#.....#.....#',
    '#.....#..p..#',
    '##.####.....#',
    '#..c..#..n..#',
    '#.....#..f..#',
    '#.....#.....#',
    '#############'
  ]
};
const BUSY_PIECES = [
  { type: 'window', x: 0, y: 2 }, { type: 'window', x: 12, y: 2, d: 0 }, { type: 'vent', x: 6, y: 2, d: 0 },
  { type: 'fan', x: 1, y: 4, d: 1 }, { type: 'fan', x: 4, y: 3, d: 1 }, { type: 'fan', x: 7, y: 1, d: 1 },
  { type: 'splitter', x: 2, y: 1, d: 0 }, { type: 'splitter', x: 5, y: 2, d: 0 },
  { type: 'deflector', x: 11, y: 4, d: 1 }, { type: 'deflector', x: 8, y: 4, d: 0 }, { type: 'deflector', x: 5, y: 4, d: 0 },
  { type: 'ceilingfan', x: 2, y: 7, d: 0 }
];

describe('determinism and purity (§8)', function () {
  it('the busy benchmark level: sane geometry', function () {
    const L = WB.parseLevel(BUSY);
    const R = sim(L, BUSY_PIECES);
    assert.equal(R.trees.length, 5);
    assert.ok(R.trees.every(function (t) { return t.active; }));
    assert.deepEqual(R.stoves, [{ x: 3, y: 2, reached: true, cleared: false }]);
    checkGeometry(R);
  });

  it('same input gives deep-equal output', function () {
    const L = WB.parseLevel(BUSY);
    const a = sim(L, BUSY_PIECES);
    const b = sim(L, BUSY_PIECES);
    const c = sim(WB.parseLevel(BUSY), JSON.parse(JSON.stringify(BUSY_PIECES)));
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(a, c);
    assert.notEqual(a.flow, b.flow, 'a fresh flow array per call');
  });

  it('results do not share state between calls', function () {
    const L = WB.parseLevel(BUSY);
    const a = sim(L, BUSY_PIECES);
    const snapshot = JSON.stringify(a, function (k, v) { return ArrayBuffer.isView(v) ? Array.from(v) : v; });
    sim(L, BUSY_PIECES.slice(0, 4));
    sim(lvl(ROOM9), [pc('fan', 1, 1, E)]);
    WB.isSolved(L, BUSY_PIECES.slice(3));
    assert.equal(JSON.stringify(a, function (k, v) { return ArrayBuffer.isView(v) ? Array.from(v) : v; }), snapshot);
  });

  it('total flow and goals do not depend on piece order', function () {
    const L = WB.parseLevel(BUSY);
    const a = sim(L, BUSY_PIECES);
    const b = sim(L, BUSY_PIECES.slice().reverse());
    assert.deepEqual(Array.from(a.flow), Array.from(b.flow));
    assert.deepEqual(a.goals, b.goals);
    assert.deepEqual(a.stoves, b.stoves);
  });

  it('simulate does not mutate its inputs', function () {
    const def = JSON.parse(JSON.stringify(BUSY));
    const pieces = JSON.parse(JSON.stringify(BUSY_PIECES));
    const L = WB.parseLevel(def);
    const before = JSON.stringify([def, L, pieces]);
    deepFreeze(L); deepFreeze(pieces);
    const R = sim(L, pieces);
    WB.isSolved(L, pieces);
    assert.equal(JSON.stringify([def, L, pieces]), before);
    assert.deepStrictEqual(R, sim(WB.parseLevel(BUSY), BUSY_PIECES));
    // the source of a tree is a normalised copy, not the caller's piece
    assert.notEqual(R.trees[0].source, pieces[0]);
    assert.deepEqual(R.trees[0].source, { type: 'window', x: 0, y: 2, d: 0 });
  });

  it('isSolved agrees with simulate().solved', function () {
    const L = WB.parseLevel(BUSY);
    for (let k = 0; k <= BUSY_PIECES.length; k++) {
      const p = BUSY_PIECES.slice(0, k);
      assert.equal(WB.isSolved(L, p), sim(L, p).solved);
    }
  });

  it('a level whose cells change in place is re-read', function () {
    const L = WB.parseLevel({ map: withChar(ROOM9, 4, 2, 'p'), wind: { from: 'W', strength: 1 } });
    const pieces = [pc('window', 0, 2), pc('window', 8, 2)];
    assert.equal(sim(L, pieces).solved, true);
    L.cells[2 * L.w + 6] = '#';
    const R = sim(L, pieces);
    assert.equal(R.trees[0].active, false);
    assert.deepStrictEqual(R, REF.simulate(L, pieces));
  });
});

// ---------------------------------------------------------------------------
// Randomized differential test against the original engine

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

function randomLevelDef(r) {
  const w = 5 + ri(r, 9), h = 4 + ri(r, 7);
  const g = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? (r() < 0.08 ? '%' : '#') : '.');
    g.push(row);
  }
  const walls = ri(r, 3);
  for (let k = 0; k < walls; k++) {
    if (r() < 0.5 && w >= 7) {
      const x = 2 + ri(r, w - 4);
      for (let y = 1; y < h - 1; y++) g[y][x] = r() < 0.1 ? '%' : '#';
      if (r() < 0.6) g[1 + ri(r, h - 2)][x] = '.';
    } else if (h >= 6) {
      const y = 2 + ri(r, h - 4);
      for (let x = 1; x < w - 1; x++) g[y][x] = r() < 0.1 ? '%' : '#';
      if (r() < 0.6) g[y][1 + ri(r, w - 2)] = '.';
    }
  }
  if (r() < 0.25 && w >= 7 && h >= 7) { // courtyard
    const cx = 2 + ri(r, w - 4), cy = 2 + ri(r, h - 4);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) g[y][x] = '#';
    g[cy][cx] = '~';
  }
  if (r() < 0.15) g[1 + ri(r, h - 2)][1 + ri(r, w - 2)] = '#'; // pillar
  let stoves = 0;
  const maxStoves = r() < 0.8 ? 1 + ri(r, 3) : 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (g[y][x] !== '.') continue;
      const q = r();
      if (q < 0.05) g[y][x] = 'o';
      else if (q < 0.15) {
        const ch = 'plcnfs'[ri(r, 6)];
        if (ch === 's' && stoves >= maxStoves) continue;
        if (ch === 's') stoves++;
        g[y][x] = ch;
      }
    }
  }
  if (r() < 0.08) { // unsealed: a hole in the outer wall
    if (r() < 0.5) g[0][1 + ri(r, w - 2)] = r() < 0.5 ? '~' : '.';
    else g[1 + ri(r, h - 2)][w - 1] = r() < 0.5 ? '~' : '.';
  }
  return {
    name: 'random',
    wind: { from: 'NESW'[ri(r, 4)], strength: ri(r, 4) },
    map: g.map(function (row) { return row.join(''); })
  };
}

function randomPieces(r, L, maxPieces) {
  const pieces = [];
  if (L.wind.strength > 0 && r() < 0.4) { // an inlet with a window straight across from it
    const inlets = WB.placementCells(L, [], 'window').filter(function (c) { return WB.outwardDir(L, c.x, c.y) === L.wind.from; });
    if (inlets.length) {
      const c = inlets[ri(r, inlets.length)];
      pieces.push({ type: 'window', x: c.x, y: c.y });
      let x = c.x + WB.DX[L.wind.dir], y = c.y + WB.DY[L.wind.dir];
      while (WB.isFloorish(WB.cellAt(L, x, y))) { x += WB.DX[L.wind.dir]; y += WB.DY[L.wind.dir]; }
      if (WB.canPlace(L, pieces, 'window', x, y)) pieces.push({ type: 'window', x: x, y: y });
    }
  }
  const k = ri(r, maxPieces + 1);
  for (let i = 0; i < k; i++) {
    const type = r() < 0.35 ? 'window' : WB.TOOL_ORDER[ri(r, WB.TOOL_ORDER.length)];
    let x, y;
    if (r() < 0.88) {
      const cells = WB.placementCells(L, pieces, type);
      if (!cells.length) continue;
      const c = cells[ri(r, cells.length)];
      x = c.x; y = c.y;
    } else { // unvalidated placement: any cell, possibly overlapping
      x = ri(r, L.w); y = ri(r, L.h);
    }
    const p = { type: type, x: x, y: y };
    const rot = WB.TOOLS[type].rotations;
    if (rot > 1 || r() < 0.3) p.d = ri(r, rot);
    if (type === 'deflector' && r() < 0.05) p.d = 2 + ri(r, 2); // out of range: treated as '\'
    pieces.push(p);
  }
  return pieces;
}

function sameResult(a, b, info) {
  try {
    assert.deepStrictEqual(a, b);
  } catch (e) {
    assert.fail('engine differs from reference for ' + JSON.stringify(info) + '\n' + e.message.slice(0, 3000));
  }
}

describe('differential test against the original engine', function () {
  it('random levels and random pieces', function () {
    const r = rng(20261015);
    let configs = 0, activeInlets = 0, smoky = 0, solved = 0;
    for (let lv = 0; lv < 300; lv++) {
      const def = randomLevelDef(r);
      const L = WB.parseLevel(def);
      const LR = REF.parseLevel(def);
      for (let k = 0; k < 12; k++) {
        const pieces = randomPieces(r, L, 12);
        const a = WB.simulate(L, pieces);
        const b = REF.simulate(LR, pieces);
        sameResult(a, b, { def: def, pieces: pieces });
        assert.equal(WB.isSolved(L, pieces), b.solved);
        configs++;
        if (b.trees.some(function (t) { return t.kind === 'inlet' && t.active; })) activeInlets++;
        if (b.stoves.some(function (s) { return s.reached; })) smoky++;
        if (b.solved) solved++;
      }
    }
    assert.equal(configs, 3600);
    // the generator must keep exercising the interesting cases
    assert.ok(activeInlets > 500, 'enough active inlets: ' + activeInlets);
    assert.ok(smoky > 150, 'enough smoke: ' + smoky);
    assert.ok(solved > 100, 'some solved: ' + solved);
  });

  it('dense random pieces on handmade levels', function () {
    const r = rng(7);
    const defs = [BUSY,
      { map: ROOM9, wind: { from: 'W', strength: 1 } },
      { map: withChar(withChar(ROOM7, 3, 1, 's'), 4, 4, 's'), wind: { from: 'N', strength: 3 } },
      { map: ['#############', '#..s..#..s..#', '#.....#.....#', '#..p..#..l..#', '#.....#.....#', '###.#####.###', '#.....#.....#', '#..c..#..f..#', '#.s...#...n.#', '#############'], wind: { from: 'E', strength: 2 } },
      { map: ['#######', '#.....#', '#.###.#', '#.#~#.#', '#.###.#', '#..s..#', '#######'], wind: { from: 'S', strength: 1 } }
    ];
    defs.forEach(function (def) {
      [0, 1, 2, 3].forEach(function (s) {
        const d = Object.assign({}, def, { wind: { from: def.wind.from, strength: s } });
        const L = WB.parseLevel(d);
        const LR = REF.parseLevel(d);
        for (let k = 0; k < 150; k++) {
          const pieces = randomPieces(r, L, 16);
          sameResult(WB.simulate(L, pieces), REF.simulate(LR, pieces), { def: d, pieces: pieces });
          assert.equal(WB.isSolved(L, pieces), REF.isSolved(LR, pieces));
        }
      });
    });
  });

  it('interleaving levels gives the same answers (no stale per-level state)', function () {
    const r = rng(99);
    const defs = [];
    for (let i = 0; i < 6; i++) defs.push(randomLevelDef(r));
    const Ls = defs.map(WB.parseLevel);
    const LRs = defs.map(REF.parseLevel);
    for (let k = 0; k < 600; k++) {
      const i = ri(r, defs.length);
      const pieces = randomPieces(r, Ls[i], 10);
      sameResult(WB.simulate(Ls[i], pieces), REF.simulate(LRs[i], pieces), { def: defs[i], pieces: pieces });
    }
  });

  it('unusual inputs: many stoves, pieces outside the map, odd wind strengths', function () {
    const r = rng(4242);
    // 16 stoves: the state space is too large for the lookup table (Map fallback)
    const stovey = {
      map: ['#############', '#s.s.s.s.s..#', '#...........#', '#s.s.s.s.s..#', '#...........#', '#s.s.s.s.s..#', '#...........#', '#s.......p..#', '#############'],
      wind: { from: 'W', strength: 2 }
    };
    const L1 = WB.parseLevel(stovey), LR1 = REF.parseLevel(stovey);
    assert.equal(L1.stoves.length, 16);
    for (let k = 0; k < 300; k++) {
      const pieces = randomPieces(r, L1, 14);
      sameResult(WB.simulate(L1, pieces), REF.simulate(LR1, pieces), { def: stovey, pieces: pieces });
      assert.equal(WB.isSolved(L1, pieces), REF.isSolved(LR1, pieces));
    }
    // pieces on the margin and far outside the map; fans there still emit (they are traced as given)
    const def = { map: TWO_ROOMS, wind: { from: 'E', strength: 1 } };
    const L2 = WB.parseLevel(def), LR2 = REF.parseLevel(def);
    const outside = [pc('fan', -1, 2, E), pc('fan', 9, 1, W), pc('ceilingfan', 4, -1), pc('fan', -5, -5, N),
      pc('window', -1, 2), pc('extractor', 9, 2), pc('ceilingfan', 100, 3), pc('splitter', 2, 5)];
    for (let k = 0; k < 300; k++) {
      const pieces = randomPieces(r, L2, 6).concat(outside.filter(function () { return r() < 0.4; }));
      sameResult(WB.simulate(L2, pieces), REF.simulate(LR2, pieces), { def: def, pieces: pieces });
      assert.equal(WB.isSolved(L2, pieces), REF.isSolved(LR2, pieces));
    }
    // wind strengths parseLevel never produces (hand-made Level objects)
    [-1, 1.5, 2.5, 7, 70].forEach(function (s) {
      const d = { map: withChar(withChar(ROOM7, 2, 2, 's'), 4, 4, 'p'), wind: { from: 'W', strength: 1 } };
      const L3 = WB.parseLevel(d), LR3 = REF.parseLevel(d);
      L3.wind.strength = s; LR3.wind.strength = s;
      for (let k = 0; k < 150; k++) {
        const pieces = [pc('window', 0, 3), pc('window', 6, 3)].concat(randomPieces(r, L3, 8));
        sameResult(WB.simulate(L3, pieces), REF.simulate(LR3, pieces), { strength: s, pieces: pieces });
        assert.equal(WB.isSolved(L3, pieces), REF.isSolved(LR3, pieces));
      }
    });
  });

  it('every Result owns its flow array', function () {
    const L = lvl(ROOM9, 'W', 1);
    const results = [];
    for (let k = 0; k < 100; k++) results.push(sim(L, [pc('window', 0, 2), pc('window', 8, 2)]));
    results[0].flow.fill(9);
    results[50].flow[20] = 7;
    for (let k = 1; k < 100; k++) {
      assert.equal(results[k].flow.length, L.w * L.h);
      assert.equal(results[k].flow[19], 1);
      assert.equal(results[k].flow[20], k === 50 ? 7 : 1);
      assert.equal(results[k].flow[0], 0);
    }
  });

  it('the placeholder levels in js/levels.js', function () {
    const data = require('../js/levels.js');
    data.levels.forEach(function (def) {
      const L = WB.parseLevel(def);
      const LR = REF.parseLevel(def);
      [L.fixed, L.fixed.concat(def.solution || [])].forEach(function (pieces) {
        sameResult(WB.simulate(L, pieces), REF.simulate(LR, pieces), { level: def.id });
      });
    });
  });
});

describe('laundry needs clean air (DESIGN.md §5)', function () {
  // Calm room: a fan blows E across the stove at 2,1 and the laundry at 4,1, out of a window at 6,1.
  const def = { map: ['#######', '#.s.l.#', '#.....#', '#######'], wind: { from: 'W', strength: 0 }, fixed: [], inventory: {} };
  const L = WB.parseLevel(def);
  const laundry = function (R) { return R.goals.filter(function (g) { return g.type === 'laundry'; })[0]; };

  it('smoky air through the laundry makes it dirty (bad), even when strong enough', function () {
    const pieces = [{ type: 'fan', x: 1, y: 1, d: 1 }, { type: 'fan', x: 3, y: 1, d: 1 }, { type: 'window', x: 6, y: 1 }];
    const R = WB.simulate(L, pieces);
    const g = laundry(R);
    assert.equal(g.flow, 2);
    assert.equal(g.smoky, true);
    assert.equal(g.state, 'bad');
    assert.equal(g.ok, false);
    assert.equal(R.solved, false);
    assert.equal(WB.isSolved(L, pieces), false);
  });

  it('a filter between the stove and the laundry keeps it clean', function () {
    const pieces = [{ type: 'fan', x: 1, y: 1, d: 1 }, { type: 'filter', x: 3, y: 1 }, { type: 'fan', x: 5, y: 1, d: 3 },
      { type: 'window', x: 6, y: 1 }];
    // the second fan faces W back into the laundry: clean air from the E side too
    const R = WB.simulate(L, pieces);
    const g = laundry(R);
    assert.equal(g.smoky, false);
    assert.notEqual(g.state, 'bad');
  });

  it('clean strong air is happy; smoke only counts from active trees', function () {
    // Wind from the W through a stove row that is stalled (no outlet): its smoke does not dirty anything.
    const d2 = { map: ['#######', '#.s...#', '#....l#', '#######'], wind: { from: 'W', strength: 2 }, fixed: [], inventory: {} };
    const L2 = WB.parseLevel(d2);
    const pieces = [{ type: 'window', x: 0, y: 1 }, { type: 'window', x: 0, y: 2 }, { type: 'window', x: 6, y: 2 }];
    const R = WB.simulate(L2, pieces);
    const g = R.goals.filter(function (x) { return x.type === 'laundry'; })[0];
    assert.equal(R.trees[0].active, false, 'the stove row inlet is stalled');
    assert.equal(g.flow, 2);
    assert.equal(g.smoky, false);
    assert.equal(g.state, 'happy');
  });
});
