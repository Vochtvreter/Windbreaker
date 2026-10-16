'use strict';
// Tests for the hint ladder's thinking (js/hints.js): the first press (an idea
// in words) never points the wrong way, and a piece that is needed somewhere
// else is a move, never "not needed". Run: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const WB = require('../js/engine.js');
const H = require('../js/hints.js');
const DATA = require('../js/levels.js');

const LEVELS = DATA.levels;
const norm = (p) => ({ type: p.type, x: p.x | 0, y: p.y | 0, d: p.d | 0 });
const COMPASS = /\b(north|east|south|west|inlet|outlet)s?\b/i;

// js/render.js in a sandbox, for its analysis of where the red × marks go
function loadRender() {
  const self = { WB, WBTheme: require('../js/theme.js'), WBSprites: require('../js/sprites.js') };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/render.js'), 'utf8'), { self, Math, Map, Float32Array });
  return self.WBRender;
}

// every board a player passes through when following the reference solution
function prefixes(def) {
  const sol = (def.solution || []).map(norm);
  const out = [];
  for (let i = 0; i <= sol.length; i++) out.push(sol.slice(0, i));
  return out;
}

test('hints: the red × cells match the marks the board draws', () => {
  const R = loadRender();
  let checked = 0;
  for (const def of LEVELS) {
    const L = WB.parseLevel(def);
    for (const pieces of prefixes(def)) {
      const sim = WB.simulate(L, L.fixed.map(norm).concat(pieces));
      const drawn = [];
      R.analyze(sim, L).stallEnds.forEach((e) => {
        const c = Math.floor(e.x + e.dx * 0.32) + ',' + Math.floor(e.y + e.dy * 0.32);
        if (!drawn.includes(c)) drawn.push(c);
      });
      const mine = H.stallCells(L, sim).map((c) => c.x + ',' + c.y);
      assert.deepEqual(mine.slice().sort(), drawn.slice().sort(), 'level ' + def.id + ' with ' + pieces.length + ' pieces');
      checked += mine.length;
    }
  }
  assert.ok(checked > 20, 'some stalled breezes were checked (' + checked + ')');
});

test('hints: "follow the dashed line" only when the next piece is a way out right where it stops, and harms nothing', () => {
  let dashed = 0;
  for (const def of LEVELS) {
    const L = WB.parseLevel(def);
    for (const pieces of prefixes(def)) {
      const all = L.fixed.map(norm).concat(pieces);
      const sim = WB.simulate(L, all);
      if (sim.solved) continue;
      const plan = H.plan(L, def, pieces);
      const idea = H.idea(L, pieces, sim, plan);
      const where = 'level ' + def.id + ' with ' + pieces.length + ' pieces: "' + idea.text + '"';
      assert.ok(idea.text && idea.text.length <= 140, where + ' (short)');
      assert.doesNotMatch(idea.text, COMPASS, where + ' (plain words)');
      if (!/dashed line/.test(idea.text)) continue;
      dashed++;
      const nx = plan.next;
      assert.ok(nx && (nx.type === 'window' || nx.type === 'extractor'), where + ': the next piece lets air out (' + JSON.stringify(nx) + ')');
      const cells = H.stallCells(L, sim);
      assert.ok(cells.some((c) => c.x === nx.x && c.y === nx.y), where + ': the next piece goes where a dashed line stops (' + JSON.stringify(cells) + ')');
      assert.deepEqual(idea.at, { x: nx.x, y: nx.y }, where + ': it points at that spot');
      const after = WB.simulate(L, all.concat([nx]));
      after.goals.forEach((g, i) => assert.ok(!(g.state === 'bad' && sim.goals[i].state !== 'bad'), where + ': following it harms nothing (' + g.type + ')'));
    }
  }
  assert.ok(dashed >= 2, 'the dashed-line idea still shows where it fits (' + dashed + ' boards)');
});

test('hints: on a candle level where the way out runs through the candle, the candle comes first', () => {
  for (const id of [6, 8]) {
    const def = LEVELS.find((l) => l.id === id);
    const L = WB.parseLevel(def);
    const sim = WB.simulate(L, L.fixed.map(norm));
    const idea = H.idea(L, [], sim, H.plan(L, def, []));
    assert.match(idea.text, /candle/, 'level ' + id + ': "' + idea.text + '"');
    assert.doesNotMatch(idea.text, /dashed/, 'level ' + id);
  }
});

test('hints: a needed piece in the wrong spot is a move, never "not needed"', () => {
  let moves = 0;
  for (const def of LEVELS) {
    const L = WB.parseLevel(def);
    const sol = (def.solution || []).map(norm);
    const fixed = L.fixed.map(norm);
    sol.forEach((p, i) => {
      const used = sol.filter((q) => q.type === p.type).length;
      if ((L.inventory[p.type] || 0) !== used) return; // a spare copy in the tray: placing it is the hint
      const rest = sol.filter((q, j) => j !== i);
      const spot = WB.placementCells(L, fixed.concat(rest), p.type).find((c) => !sol.some((q) => q.x === c.x && q.y === c.y));
      if (!spot) return;
      const pieces = rest.concat([{ type: p.type, x: spot.x, y: spot.y, d: p.d }]);
      const sim = WB.simulate(L, fixed.concat(pieces));
      if (sim.solved) return; // another answer
      const plan = H.plan(L, def, pieces);
      const where = 'level ' + def.id + ': ' + p.type + ' at ' + spot.x + ',' + spot.y + ' instead of ' + p.x + ',' + p.y;
      assert.equal(plan.conflicts.length, 0, where + ': nothing is "not needed"');
      assert.equal(plan.moves.length, 1, where + ': one move');
      assert.equal(plan.moves[0].from, pieces[pieces.length - 1], where + ': the misplaced piece moves');
      assert.deepEqual([plan.moves[0].to.x, plan.moves[0].to.y], [p.x, p.y], where + ': to its spot');
      const idea = H.idea(L, pieces, sim, plan, { name: (t) => WB.TOOLS[t].name.toLowerCase() });
      if (!plan.turns.length) assert.match(idea.text, /could do more somewhere else/, where + ': "' + idea.text + '"');
      moves++;
    });
  }
  assert.ok(moves > 50, 'checked many misplaced pieces (' + moves + ')');
});

test('hints: a spare piece the answer does not use is "not needed"; one that helps right now is said gently', () => {
  // level 2: one window, placed on a wall where it lets air out but helps nobody
  const def = LEVELS.find((l) => l.id === 2);
  const L = WB.parseLevel(def);
  const fixed = L.fixed.map(norm);
  const sol = def.solution.map(norm);
  const wrong = WB.placementCells(L, fixed, 'window').find((c) => !sol.some((q) => q.x === c.x && q.y === c.y));
  const pieces = [{ type: 'window', x: wrong.x, y: wrong.y, d: 0 }];
  const plan = H.plan(L, def, pieces);
  assert.equal(plan.moves.length, 1, 'the only window is needed elsewhere: a move');
  // the e2e fixture's case: two windows in the tray, one used wrongly while the other is still in the tray
  const fx = {
    id: 1, name: 'Fixture', wind: { from: 'W', strength: 1 },
    map: ['##########', '#........#', '#...p....#', '#........#', '#........#', '##########'],
    fixed: [{ type: 'window', x: 0, y: 2 }], inventory: { window: 2, fan: 1 }, solution: [{ type: 'window', x: 9, y: 2 }],
  };
  const FL = WB.parseLevel(fx);
  const p2 = H.plan(FL, fx, [{ type: 'window', x: 2, y: 0, d: 0 }]);
  assert.equal(p2.moves.length, 0, 'a copy is left in the tray: no move');
  assert.equal(p2.conflicts.length, 1, 'the wrong window is not needed');
  assert.equal(p2.helping.length, 0, 'and it helps nobody');
  assert.equal(p2.next.x, 9, 'the next piece is the solution window');
  // a fan that spins the pinwheel but is not in the answer
  const p4 = H.plan(FL, fx, [{ type: 'fan', x: 2, y: 2, d: 1 }]);
  assert.equal(p4.conflicts.length, 1, 'a fan the answer does not use is not needed');
  assert.equal(p4.helping.length, 1, 'but it spins the pinwheel right now');
  const sim4 = WB.simulate(FL, FL.fixed.concat([{ type: 'fan', x: 2, y: 2, d: 1 }]));
  assert.match(H.idea(FL, [{ type: 'fan', x: 2, y: 2, d: 1 }], sim4, p4).text, /won.t be needed in the end/, 'said gently');
});
