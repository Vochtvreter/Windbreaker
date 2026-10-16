'use strict';
// Tests for the field guide (js/guides.js) and the saved-progress migration
// (js/migrate.js). Run: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const WB = require('../js/engine.js');
const DATA = require('../js/levels.js');
const { GUIDES, GUIDE_ORDER } = require('../js/guides.js');

const LEVELS = DATA.levels;

// The level a card first shows on: a tool's or object's intro level, a twist's
// first level in play order.
function firstLevel(card) {
  if (card.kind === 'tool') return WB.TOOLS[card.id].intro;
  if (card.kind === 'object') return WB.OBJECTS[card.id].intro;
  const lv = LEVELS.find((l) => WB.levelConditions(l).includes(card.id));
  return lv ? lv.id : null;
}

function demoDef(card) {
  return { name: 'demo ' + card.id, wind: card.demo.wind, map: card.demo.map, fixed: card.demo.fixed, inventory: {} };
}

test('guides: one card for every tool, object and twist, in the order they are met', () => {
  const want = [].concat(WB.TOOL_ORDER, WB.OBJECT_ORDER, WB.CONDITION_ORDER).sort();
  assert.deepEqual(GUIDE_ORDER.slice().sort(), want);
  for (const id of GUIDE_ORDER) {
    const c = GUIDES[id];
    const kind = WB.TOOLS[id] ? 'tool' : WB.OBJECTS[id] ? 'object' : 'twist';
    assert.equal(c.kind, kind, id + ' kind');
  }
  const firsts = GUIDE_ORDER.map((id) => firstLevel(GUIDES[id]));
  firsts.forEach((n, i) => assert.ok(n != null, GUIDE_ORDER[i] + ' appears in some level'));
  for (let i = 1; i < firsts.length; i++) {
    assert.ok(firsts[i] >= firsts[i - 1], GUIDE_ORDER[i] + ' (level ' + firsts[i] + ') is listed after ' + GUIDE_ORDER[i - 1] + ' (level ' + firsts[i - 1] + ')');
  }
});

test('guides: every card has short, plain teaching text', () => {
  const compass = /\b(north|east|south|west|inlet|outlet)s?\b/i;
  for (const id of GUIDE_ORDER) {
    const c = GUIDES[id];
    for (const f of ['title', 'oneLiner', 'controls']) {
      assert.equal(typeof c[f], 'string', id + '.' + f);
      assert.ok(c[f].trim().length > 0, id + '.' + f + ' is empty');
    }
    assert.ok(Array.isArray(c.points) && c.points.length >= 2 && c.points.length <= 3, id + ': 2 or 3 points');
    if (c.kind !== 'twist') assert.ok(typeof c.recap === 'string' && c.recap.length > 0, id + ': a recap line');
    const texts = [c.title, c.oneLiner, c.controls, c.recap || '', c.demo.caption_before, c.demo.caption_after].concat(c.points);
    for (const t of texts) {
      assert.doesNotMatch(t, compass, id + ': no compass words or inlet/outlet in "' + t + '"');
      assert.ok(t.length <= 130, id + ': short text (' + t.length + ' chars): "' + t + '"');
    }
    assert.ok(c.oneLiner.length <= 80, id + ': the one-liner fits on a line or two');
  }
});

test('guides: every demo is a valid tiny house; "before" leaves something unhappy, "after" solves it', () => {
  for (const id of GUIDE_ORDER) {
    const c = GUIDES[id], d = c.demo;
    const def = demoDef(c);
    assert.deepEqual(WB.validateLevel(def), [], id + ': demo house is valid');
    assert.ok(d.map.length <= 5 && d.map[0].length <= 7, id + ': demo house is at most 7 x 5');
    const L = WB.parseLevel(def);
    for (const scene of ['before', 'after']) {
      const pieces = L.fixed.slice();
      for (const p of d[scene]) {
        assert.ok(WB.canPlace(L, pieces, p.type, p.x, p.y), id + ' ' + scene + ': ' + p.type + ' fits at ' + p.x + ',' + p.y);
        pieces.push({ type: p.type, x: p.x, y: p.y, d: p.d | 0 });
      }
      const solved = WB.isSolved(L, pieces);
      assert.equal(solved, scene === 'after', id + ': "' + scene + '" ' + (scene === 'after' ? 'makes everything happy' : 'leaves something unhappy'));
    }
    assert.notDeepEqual(d.before, d.after, id + ': the two scenes differ');
    assert.ok(d.caption_before && d.caption_after, id + ': a caption for each scene');
  }
});

test('guides: a demo shows its own thing and nothing the player has not met yet', () => {
  for (const id of GUIDE_ORDER) {
    const c = GUIDES[id];
    const n = firstLevel(c);
    const def = demoDef(c);
    const pieces = def.fixed.concat(c.demo.before, c.demo.after);
    const errs = WB.introErrors(Object.assign({}, def, { inventory: {} }), n)
      .concat(pieces.filter((p) => WB.TOOLS[p.type].intro > n).map((p) => p.type + ' arrives after level ' + n));
    assert.deepEqual(errs, [], id + ' (first shown on level ' + n + ')');
    const L = WB.parseLevel(def);
    if (c.kind === 'tool') assert.ok(pieces.some((p) => p.type === id), id + ': the demo uses the tool');
    if (c.kind === 'object') assert.ok(L.objects.some((o) => o.type === id), id + ': the demo has the object');
    if (c.kind === 'twist') assert.ok(WB.levelConditions(def).includes(id), id + ': the demo has the twist');
  }
});

// ------------------------------------------------------------------ js/migrate.js

function runMigrate(store) {
  const ls = {
    data: Object.assign({}, store),
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
  };
  const win = { localStorage: ls, WB: { LEVELS } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/migrate.js'), 'utf8'), { window: win });
  return ls.data;
}

test('migrate: v1.0 progress is translated by level key, once per browser', () => {
  const v1 = JSON.stringify({ completed: [1, 2, 3], boards: { 2: [{ type: 'window', x: 1, y: 0 }] }, boardSigs: { 2: 'x' }, sound: false });
  const out = runMigrate({ 'windbreaker.v1': v1 });
  const d = JSON.parse(out['windbreaker.v1']);
  const byKey = {};
  LEVELS.forEach((l) => { byKey[l.key] = l.id; });
  const want = [byKey['first-breeze'], byKey['wind-shift'], byKey.candlelight].sort((a, b) => a - b);
  assert.deepEqual(d.completed, want, 'solved levels follow their keys');
  assert.deepEqual(d.boards, {}, 'unfinished boards are dropped');
  assert.equal(d.sound, false, 'other settings are kept');
  assert.equal(out['windbreaker.levelset'], '2', 'marked as migrated');
  // a second run leaves the (already migrated) progress alone
  const again = runMigrate(out);
  assert.equal(again['windbreaker.v1'], out['windbreaker.v1']);
});

test('migrate: a fresh browser is only marked', () => {
  const out = runMigrate({});
  assert.equal(out['windbreaker.v1'], undefined);
  assert.equal(out['windbreaker.levelset'], '2');
});
