#!/usr/bin/env node
'use strict';
/*
 * ASCII visualiser for level designers.
 *
 *   node tools/show.js <levelNumber | file.json [--index k]> [--solution] [--pieces '<JSON>'] [--fixed-only]
 *
 * Default view: fixed pieces + the reference solution. --fixed-only shows the
 * starting position. --pieces '[{"type":"fan","x":3,"y":2,"d":"E"}]' shows
 * fixed + those pieces (add --solution to keep the reference solution too).
 *
 * Piece glyphs (never collide with map chars # % . o ~ p l c n f s):
 *   W inlet window   w outlet window   ^ > v < fan (blowing N E S W)
 *   / \ deflector    : curtain         = vent     Y splitter   X extractor
 *   @ skylight       + filter          * ceiling fan
 * Flow grid: digit = total flow, '.' = no flow, ',' = only a stalled inlet's
 * would-be path passes here.
 */

const lib = require('./lib');
const WB = lib.WB;

const GLYPH = {
  fan: '^>v<', deflector: '/\\', curtain: ':', vent: '=', splitter: 'Y',
  extractor: 'X', skylight: '@', filter: '+', ceilingfan: '*'
};
const GLYPH_NAME = {
  W: 'inlet window', w: 'outlet window', '^': 'fan N', '>': 'fan E', v: 'fan S', '<': 'fan W',
  '/': 'deflector /', '\\': 'deflector \\', ':': 'curtain', '=': 'vent', Y: 'splitter',
  X: 'extractor', '@': 'skylight', '+': 'filter', '*': 'ceiling fan'
};
const OBJ_CHAR = {};
for (const id of WB.OBJECT_ORDER) OBJ_CHAR[id] = WB.OBJECTS[id].char;

function glyph(L, p) {
  if (p.type === 'window') return WB.windowRole(L, p) === 'inlet' ? 'W' : 'w';
  const g = GLYPH[p.type];
  if (!g) return '?';
  return g.length > 1 ? g[(p.d | 0) % g.length] : g;
}

/** Cells whose centre lies on a traced segment -> Uint8Array(N). */
function segmentCells(L, tree, out) {
  const W = L.w, H = L.h;
  const mark = (X, Y) => {
    if (!(X & 1) || !(Y & 1)) return;
    const x = (X - 1) >> 1, y = (Y - 1) >> 1;
    if (x >= 0 && y >= 0 && x < W && y < H) out[y * W + x] = 1;
  };
  for (const s of tree.segments) {
    let ax = Math.round(s.ax * 2), ay = Math.round(s.ay * 2);
    const bx = Math.round(s.bx * 2), by = Math.round(s.by * 2);
    if (ax !== bx && ay !== by) { mark(ax, ay); mark(bx, by); continue; }
    const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
    for (;;) { mark(ax, ay); if (ax === bx && ay === by) break; ax += sx; ay += sy; }
  }
  return out;
}

/** Terminal point (cell units) -> "x,y" of the cell where the stream ends. */
function endCell(L, grid, e) {
  const X = Math.round(e.x * 2), Y = Math.round(e.y * 2);
  if ((X & 1) && (Y & 1)) return ((X - 1) >> 1) + ',' + ((Y - 1) >> 1);
  let cands = [];
  if (!(X & 1) && (Y & 1)) cands = [[X / 2 - 1, (Y - 1) / 2], [X / 2, (Y - 1) / 2]];
  else if ((X & 1) && !(Y & 1)) cands = [[(X - 1) / 2, Y / 2 - 1], [(X - 1) / 2, Y / 2]];
  else return (e.x) + ',' + (e.y);
  const pieceAt = (c) => grid.get(c[0] + ',' + c[1]);
  let best;
  if (e.type === 'outlet') {
    best = cands.find((c) => { const p = pieceAt(c); return p && (p.type === 'window' || p.type === 'extractor'); }) ||
      cands.find((c) => WB.isOutside(WB.cellAt(L, c[0], c[1])));
  } else {
    best = cands.find((c) => WB.isWall(WB.cellAt(L, c[0], c[1])) && !(pieceAt(c) && pieceAt(c).type === 'vent'));
  }
  best = best || cands[1];
  return best[0] + ',' + best[1];
}

function xAxis(w) {
  const lines = [];
  if (w > 10) {
    let t = '';
    for (let x = 0; x < w; x++) t += x >= 10 ? String(Math.floor(x / 10) % 10) : ' ';
    lines.push(t);
  }
  let u = '';
  for (let x = 0; x < w; x++) u += String(x % 10);
  lines.push(u);
  return lines;
}

function flowChar(f) {
  if (f <= 9) return String(f);
  if (f <= 35) return String.fromCharCode(87 + f);
  return '!';
}

/** Problems with a piece list against the level (placement, overlap, inventory). */
function pieceProblems(L, def, fixed, extra) {
  const out = [];
  const placedSoFar = fixed.slice();
  const used = {};
  for (const p of extra) {
    if (!WB.TOOLS[p.type]) { out.push('unknown tool "' + p.type + '"'); continue; }
    if (!WB.canPlace(L, placedSoFar, p.type, p.x, p.y)) out.push(lib.pieceShort(p) + ': cannot be placed there');
    if ((p.d | 0) >= WB.TOOLS[p.type].rotations) out.push(lib.pieceShort(p) + ': bad rotation ' + p.d);
    placedSoFar.push(p);
    used[p.type] = (used[p.type] || 0) + 1;
  }
  const inv = def.inventory || {};
  for (const k of Object.keys(used)) {
    if (used[k] > (inv[k] || 0)) out.push('uses ' + used[k] + ' ' + k + ', inventory has ' + (inv[k] || 0));
  }
  return out;
}

/**
 * Render a level with the given pieces (fixed + player). Pieces may carry
 * fixed: true for labelling. opts: { header: true, legend: true, tip: true,
 * problems: [] }. Returns a multi-line string.
 */
function render(entry, pieces, opts) {
  opts = Object.assign({ header: true, legend: true, tip: true }, opts || {});
  const def = entry.def;
  const L = WB.parseLevel(def);
  const W = L.w, H = L.h;
  const norm = pieces.map((p) => ({ type: p.type, x: p.x | 0, y: p.y | 0, d: p.d | 0, fixed: !!p.fixed }));
  const r = WB.simulate(L, norm);
  const grid = new Map();
  for (const p of norm) grid.set(p.x + ',' + p.y, p);
  const out = [];

  if (opts.header) {
    const facts = lib.levelFacts(def);
    out.push(lib.levelLabel(entry) +
      (entry.chapter != null ? '  ch' + entry.chapter + '[' + entry.index + ']' : '') +
      '  ' + W + 'x' + H + ' rooms ' + facts.rooms + '  wind ' + lib.windLong(def.wind));
    out.push('inv: ' + lib.inventoryString(def.inventory));
    if (opts.tip && def.tip) out.push('tip: ' + def.tip);
    for (const msg of opts.problems || []) out.push('! ' + msg);
  }

  // Grids: map (with pieces) and total flow, side by side.
  const stalled = new Uint8Array(W * H);
  for (const t of r.trees) if (!t.active) segmentCells(L, t, stalled);
  const gap = '   ';
  const ax = xAxis(W);
  out.push('   ' + lib.pad('map', W) + gap + '   flow');
  for (const line of ax) out.push('   ' + line + gap + '   ' + line);
  for (let y = 0; y < H; y++) {
    let m = '', f = '';
    for (let x = 0; x < W; x++) {
      const ch = L.cells[y * W + x];
      const p = grid.get(x + ',' + y);
      m += p ? glyph(L, p) : ch;
      if (WB.isOutside(ch)) f += ' ';
      else if (WB.isWall(ch)) f += p ? glyph(L, p) : ch;
      else {
        const v = r.flow[y * W + x];
        f += v > 0 ? flowChar(v) : stalled[y * W + x] ? ',' : '.';
      }
    }
    const lab = lib.lpad(y, 2) + ' ';
    out.push(lab + m + gap + lab + f);
  }


  // Pieces.
  const fixedP = norm.filter((p) => p.fixed), playerP = norm.filter((p) => !p.fixed);
  const plist = (list) => list.length ? list.map((p) => glyph(L, p) + ' ' + p.x + ',' + p.y).join('  ') : '-';
  out.push('fixed: ' + plist(fixedP) + '   placed: ' + plist(playerP));

  // Objects.
  const happy = r.goals.filter((g) => g.ok).length;
  out.push('objects ' + happy + '/' + r.goals.length + ':');
  const stoveAt = new Map(r.stoves.map((s) => [s.x + ',' + s.y, s]));
  for (const g of r.goals) {
    let extra = '';
    if (g.type === 'stove') {
      const s = stoveAt.get(g.x + ',' + g.y);
      extra = s ? (s.cleared ? ' smoke cleared' : s.reached ? ' smoke TRAPPED' : ' no air') : '';
    }
    out.push('  ' + OBJ_CHAR[g.type] + ' ' + lib.pad(g.type, 8) + ' ' + lib.pad(g.x + ',' + g.y, 5) +
      ' flow ' + g.flow + '  ' + (g.ok ? 'ok' : g.state.toUpperCase()) + extra);
  }

  // Trees.
  out.push('trees ' + r.trees.length + ':');
  for (const t of r.trees) {
    let maxS = 0;
    for (const s of t.segments) if (s.s > maxS) maxS = s.s;
    const counts = new Map();
    for (const e of t.ends) {
      const k = (e.type === 'outlet' ? 'out ' : 'blk ') + endCell(L, grid, e);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const ends = [...counts].map(([k, c]) => k + (c > 1 ? ' x' + c : '')).join(', ') || '-';
    const src = t.source;
    out.push('  ' + lib.pad(t.kind, 10) + ' ' + glyph(L, src) + ' ' + lib.pad(src.x + ',' + src.y, 5) + ' ' +
      lib.pad(t.active ? 'active' : 'STALLED', 7) + ' max ' + maxS + '  ends: ' + ends);
  }

  out.push(r.solved ? 'SOLVED' : 'not solved (' + happy + '/' + r.goals.length + ' happy)');

  if (opts.legend) {
    const seen = [];
    for (const p of norm) { const g = glyph(L, p); if (!seen.includes(g)) seen.push(g); }
    if (seen.length) out.push('legend: ' + seen.map((g) => g + ' ' + GLYPH_NAME[g]).join(', ') + '; flow , = stalled path');
  }
  return out.join('\n');
}

const USAGE = `usage: node tools/show.js <levelNumber | file.json [--index k]> [options]
  (default)          fixed pieces + reference solution
  --fixed-only       starting position (fixed pieces only)
  --pieces '<JSON>'  fixed + these pieces, e.g. '[{"type":"fan","x":3,"y":2,"d":"E"}]'
  --solution         with --pieces: also keep the reference solution
  --no-tip           hide the tip line
  --src dir          chapter directory (default levels/src)
glyphs: W inlet window, w outlet window, ^ > v < fan, / \\ deflector, : curtain, = vent,
        Y splitter, X extractor, @ skylight, + filter, * ceiling fan
flow grid: digit = total flow, . = none, , = stalled inlet path only`;

function main(argv) {
  const a = lib.parseArgs(argv, {
    values: ['pieces', 'index', 'src', 'n'],
    bools: ['solution', 'fixed-only', 'no-tip']
  });
  if (a.flags.help || !a._.length) { console.log(USAGE); return a.flags.help ? 0 : 2; }
  const entry = lib.resolveLevelArg(a._[0], a.flags);
  const def = entry.def;
  const L = WB.parseLevel(def);
  const fixed = (def.fixed || []).map((p) => ({ type: p.type, x: p.x, y: p.y, d: p.d | 0, fixed: true }));
  let player = [];
  if (a.flags['fixed-only']) player = [];
  else if (a.flags.pieces) {
    player = lib.parsePieceList(a.flags.pieces);
    if (a.flags.solution) player = (def.solution || []).concat(player);
  } else player = (def.solution || []).slice();
  const problems = pieceProblems(L, def, fixed, player);
  console.log(render(entry, fixed.concat(player), { problems, tip: !a.flags['no-tip'] }));
  return 0;
}

module.exports = { render, glyph, GLYPH, GLYPH_NAME, pieceProblems, endCell, USAGE };

if (require.main === module) lib.runCli(main);
