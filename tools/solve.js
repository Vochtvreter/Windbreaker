#!/usr/bin/env node
'use strict';
/*
 * Windbreaker solver: finds placements of the player's inventory pieces that
 * (together with the level's fixed pieces) make WB.simulate(...).solved true.
 * WB.simulate is the only rules oracle; this file never re-implements rules.
 *
 *   const { solve } = require('./tools/solve');
 *   solve(def, { timeMs, maxSolutions, maxPieces, excludeTools, inventory, pruneIdle })
 *     -> { status: 'exhaustive'|'timeout'|'capped', solvable: true|false|null,
 *          count, solutions: [sorted piece lists], minPieces, nodes, ms,
 *          space, completedDepth, maxDepth }
 *
 * SEARCH
 * ------
 * Pieces are split into
 *   SOURCES  - create airflow by themselves: fan (4 rotations), ceilingfan,
 *              extractor (pull + outlet), and windows on cells where a window
 *              is an *inlet*. Enumerated over ALL valid cells, as combinations
 *              in a canonical order (option index strictly increasing).
 *   PASSIVES - only change air that reaches them: deflector (2 rotations),
 *              curtain, splitter, skylight, filter (floor), plus vent and
 *              windows on cells where a window is an *outlet* (walls).
 *
 * A configuration is evaluated with WB.simulate; from its traced trees
 * (ALL trees, including stalled inlets and extractor pull streams) we read
 *   - touched cells: cells whose centre lies on any traced segment;
 *   - smoky cells: touched by a segment that carries smoke;
 *   - pull cells: touched by an extractor pull stream;
 *   - blocked walls: wall cells at which some branch ends 'blocked'.
 * A passive is only tried on a RELEVANT cell: floor passives on touched cells
 * (a filter only on smoky or pull cells: elsewhere it neither cleans smoke nor
 * cuts a pull line), vents / outlet windows on blocked walls.
 *
 * Search order: sources first (all canonical combinations within inventory),
 * then a DFS that adds one relevant passive at a time, recomputing relevance
 * after every placement. Passives may be added in ANY order (placing A can
 * create the flow that makes a cell relevant for B), so passive configurations
 * are de-duplicated by a canonical key (sorted piece codes). A solved
 * configuration is never extended. The DFS runs as iterative deepening on the
 * total number of player pieces (0, 1, 2, ...) until the first solution is
 * found, then one final pass covers all remaining depths: minPieces is exact
 * even if the search later times out.
 *
 * WHY RELEVANCE PRUNING IS COMPLETE
 * Take any solution S = Src + P (sources Src, passives P). Start from
 * fixed + Src (enumerated). Repeatedly place any piece of P that lies on a
 * relevant cell of the current configuration; stop when none does. Let C be
 * the result and R = P - C. No piece of R changes how any traced state of C is
 * processed: floor pieces of R sit on untouched cells (or are filters on cells
 * with neither smoke nor a pull stream), vents / outlet windows of R sit on
 * walls no stream enters (a stream entering a wall cell ends 'blocked' there).
 * A piece only influences states at its own cell, plus the pull line it would
 * cut - but pull lines are traced streams, so such cells are relevant. Passives
 * create no trees, so every tree of C is traced identically in C + R (same
 * flows, smoke, inlet activity): simulate(C) == simulate(S), C is solved.
 * C is reached by the search (each step placed a then-relevant piece; the
 * visited set only merges identical configurations, whose successors are
 * identical), unless a smaller prefix was already solved - also a solution
 * contained in S.
 *
 * IDLE-PIECE PRUNING (opts.pruneIdle, default on)
 * A configuration is not extended if one of its placed passives is idle: not
 * on any traced segment, not next to any stream end and not on an extractor's
 * inward ray (where it could be cutting a pull line). An idle piece changes
 * nothing, so every solution containing it is redundant. Completeness for a
 * minimal solution S: place its passives in this order - if a piece of S lies
 * on a current pull line, the one nearest its extractor (it now cuts that line
 * exactly as in S, for good); otherwise a FRONTIER piece: for some non-pull
 * tree, the piece at the first state of its trace in S whose processing a
 * not-yet-placed piece changes. Up to that state the tree is traced exactly as
 * in S, so the piece is relevant now; and each placed piece lies on that
 * common prefix of a trace, which only grows as more pieces of S are placed, so
 * no placed piece ever becomes idle. If neither rule applies, the current
 * configuration simulates exactly like S, so it is S itself (S is minimal).
 *
 * GUARANTEES (status 'exhaustive'): the solvable verdict is exact, every
 * minimal solution is found, and minPieces is exact.
 * COUNTED SOLUTIONS are the solved configurations reached in which no piece
 * is redundant (removing any single placed piece makes the level unsolved,
 * checked with extra simulate calls). Every minimal solution is counted.
 * Tested against brute force (all placements, no pruning) in
 * tests/tools.test.js and by random fuzzing.
 */

const path = require('path');
const lib = require('./lib');
const WB = lib.WB;

const T = {};
WB.TOOL_ORDER.forEach((t, i) => { T[t] = i; });
const NT = WB.TOOL_ORDER.length;
const ROT = WB.TOOL_ORDER.map((t) => WB.TOOLS[t].rotations);
const FLOOR_PASSIVES = ['deflector', 'curtain', 'splitter', 'skylight', 'filter'].map((t) => T[t]);

// ---------------------------------------------------------------------------
// Static, per-level analysis (cached: designers call solve() repeatedly)

const staticCache = new Map();

function levelSignature(def) {
  return JSON.stringify([def.map, def.fixed || [], def.wind || null]);
}

function prepare(def) {
  const sig = levelSignature(def);
  const hit = staticCache.get(sig);
  if (hit) return hit;
  const L = WB.parseLevel(def);
  const W = L.w, H = L.h, N = W * H;
  const fixed = L.fixed.map((p) => ({ type: p.type, x: p.x, y: p.y, d: p.d | 0 }));
  const baseOcc = new Uint8Array(N);
  for (const p of fixed) if (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) baseOcc[p.y * W + p.x] = 1;
  const mark = (type) => {
    const a = new Uint8Array(N);
    for (const c of WB.placementCells(L, fixed, type)) a[c.y * W + c.x] = 1;
    return a;
  };
  const floorOK = mark('fan');
  const extOK = mark('window');
  const ventOK = mark('vent');
  const inletOK = new Uint8Array(N);
  const outletWinOK = new Uint8Array(N);
  for (let ci = 0; ci < N; ci++) {
    if (!extOK[ci]) continue;
    const role = WB.windowRole(L, { type: 'window', x: ci % W, y: (ci / W) | 0, d: 0 });
    if (role === 'inlet') inletOK[ci] = 1; else outletWinOK[ci] = 1;
  }
  const opts = new Array(NT * 4 * N);
  const info = { sig, L, W, H, N, fixed, baseOcc, floorOK, extOK, ventOK, inletOK, outletWinOK, opts };
  if (staticCache.size > 64) staticCache.clear();
  staticCache.set(sig, info);
  return info;
}

/** Interned option (one concrete placement) for tool index ti, rotation d, cell ci. */
function option(S, ti, d, ci) {
  const code = (ti * 4 + d) * S.N + ci;
  let o = S.opts[code];
  if (!o) {
    const x = ci % S.W, y = (ci / S.W) | 0, type = WB.TOOL_ORDER[ti];
    o = S.opts[code] = { ti, d, ci, x, y, code, type, piece: { type, x, y, d } };
  }
  return o;
}

// Piece codes are < NT * 4 * N <= 10 * 4 * 130 = 5200, so 4 of them (+1) fit in 2^53.
const KEY_BASE = 8192;

function insertSorted(a, v) {
  let i = a.length;
  a.push(v);
  while (i > 0 && a[i - 1] > v) { a[i] = a[i - 1]; i--; }
  a[i] = v;
}

function removeSorted(a, v) {
  const i = a.indexOf(v);
  for (let j = i; j < a.length - 1; j++) a[j] = a[j + 1];
  a.pop();
}

/** Floor-ish cells on the inward ray of an extractor at cell ci (cached Uint8Array). */
function extractorRay(S, ci) {
  if (!S.rays) S.rays = new Map();
  let ray = S.rays.get(ci);
  if (!ray) {
    ray = new Uint8Array(S.N);
    const x0 = ci % S.W, y0 = (ci / S.W) | 0;
    const o = WB.outwardDir(S.L, x0, y0);
    if (o >= 0) {
      const d = (o + 2) % 4;
      let x = x0 + WB.DX[d], y = y0 + WB.DY[d];
      while (WB.isFloorish(WB.cellAt(S.L, x, y))) { ray[y * S.W + x] = 1; x += WB.DX[d]; y += WB.DY[d]; }
    }
    S.rays.set(ci, ray);
  }
  return ray;
}

function effectiveInventory(def, opts) {
  const src = opts.inventory || def.inventory || {};
  const excl = new Set(opts.excludeTools || []);
  const inv = new Int32Array(NT);
  for (const k of Object.keys(src)) {
    if (T[k] === undefined || excl.has(k)) continue;
    inv[T[k]] = Math.max(0, src[k] | 0);
  }
  return inv;
}

// ---------------------------------------------------------------------------
// solve

function solve(def, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const timeMs = opts.timeMs != null ? opts.timeMs : 5000;
  const deadline = t0 + timeMs;
  const maxSolutions = opts.maxSolutions != null ? opts.maxSolutions : 1000;

  const S = prepare(def);
  const { L, W, H, N, floorOK, ventOK, inletOK, outletWinOK } = S;
  const remaining = effectiveInventory(def, opts);
  let invTotal = 0;
  for (let i = 0; i < NT; i++) invTotal += remaining[i];
  const maxDepth = Math.min(invTotal, opts.maxPieces != null ? Math.max(0, opts.maxPieces | 0) : Infinity);

  // Source options (canonical order = by code).
  const srcOpts = [];
  if (remaining[T.window] > 0 && L.wind.strength > 0) {
    for (let ci = 0; ci < N; ci++) if (inletOK[ci]) srcOpts.push(option(S, T.window, 0, ci));
  }
  if (remaining[T.fan] > 0) {
    for (let d = 0; d < 4; d++) for (let ci = 0; ci < N; ci++) if (floorOK[ci]) srcOpts.push(option(S, T.fan, d, ci));
  }
  if (remaining[T.extractor] > 0) {
    for (let ci = 0; ci < N; ci++) if (S.extOK[ci]) srcOpts.push(option(S, T.extractor, 0, ci));
  }
  if (remaining[T.ceilingfan] > 0) {
    for (let ci = 0; ci < N; ci++) if (floorOK[ci]) srcOpts.push(option(S, T.ceilingfan, 0, ci));
  }
  srcOpts.sort((a, b) => a.code - b.code);

  // Mutable search state.
  const occ = S.baseOcc.slice();
  const cur = S.fixed.slice();           // fixed + placed pieces (passed to simulate)
  const placed = [];                     // placed options (stack)
  const passiveCodes = [];               // codes of placed passives, kept sorted
  const visited = new Set();
  let nodes = 0, iterNodes = 0;
  let stop = null;                       // null | 'timeout' | 'capped'
  let K = 0;                             // current depth limit
  let recordFrom = 0;                    // count solved configurations of depth >= recordFrom
  let frontierOpen = false;
  const solutions = [];
  const solutionKeys = new Set();

  // Relevance scratch (generation-stamped to avoid clearing).
  const touchStamp = new Int32Array(N), smokeStamp = new Int32Array(N), pullStamp = new Int32Array(N);
  const wallStamp = new Int32Array(N), endStamp = new Int32Array(N);
  const touched = [], walls = [];
  let gen = 0;
  const pruneIdle = opts.pruneIdle !== false;
  const numericKeys = NT * 4 * N + 1 < KEY_BASE; // always true for maps within 13x10

  // Full evaluation (trees are needed to compute relevance) ...
  function evaluate() {
    nodes++; iterNodes++;
    if ((nodes & 7) === 0 && Date.now() > deadline) stop = 'timeout';
    return WB.simulate(L, cur);
  }
  // ... and the cheap one for leaves of the current iteration (only "solved?").
  function evaluateLeaf() {
    nodes++; iterNodes++;
    if ((nodes & 7) === 0 && Date.now() > deadline) stop = 'timeout';
    return WB.isSolved(L, cur);
  }

  function place(o) {
    occ[o.ci] = 1; remaining[o.ti]--; placed.push(o); cur.push(o.piece);
  }
  function unplace(o) {
    occ[o.ci] = 0; remaining[o.ti]++; placed.pop(); cur.pop();
  }

  // (X, Y) are doubled coordinates; odd/odd is a cell centre.
  function markPoint(X, Y, smoke, pull) {
    if (!(X & 1) || !(Y & 1)) return;
    const x = (X - 1) >> 1, y = (Y - 1) >> 1;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const ci = y * W + x;
    if (touchStamp[ci] !== gen) { touchStamp[ci] = gen; touched.push(ci); }
    if (smoke) smokeStamp[ci] = gen;
    if (pull) pullStamp[ci] = gen;
  }
  function markEnd(x, y, blocked) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const ci = y * W + x;
    endStamp[ci] = gen;
    if (blocked && wallStamp[ci] !== gen) { wallStamp[ci] = gen; walls.push(ci); }
  }

  // Is cell ci on the inward ray of an extractor in the current configuration?
  function onExtractorRay(ci) {
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i];
      if (p.type === 'extractor' && extractorRay(S, p.y * W + p.x)[ci]) return true;
    }
    return false;
  }

  // Analyse the simulate result r of the current configuration. Returns null
  // if a placed passive is idle (see header), else the relevant passive
  // placements (see header comment).
  function analyze(r) {
    gen++;
    touched.length = 0; walls.length = 0;
    const trees = r.trees;
    for (let t = 0; t < trees.length; t++) {
      const tree = trees[t];
      const pull = tree.kind === 'pull';
      const segs = tree.segments;
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k];
        let ax = Math.round(s.ax * 2), ay = Math.round(s.ay * 2);
        const bx = Math.round(s.bx * 2), by = Math.round(s.by * 2);
        const smoke = !!s.smoke;
        if (ax !== bx && ay !== by) { markPoint(ax, ay, smoke, pull); markPoint(bx, by, smoke, pull); continue; }
        const sx = bx > ax ? 1 : bx < ax ? -1 : 0, sy = by > ay ? 1 : by < ay ? -1 : 0;
        for (;;) {
          markPoint(ax, ay, smoke, pull);
          if (ax === bx && ay === by) break;
          ax += sx; ay += sy;
        }
      }
      const ends = tree.ends;
      for (let k = 0; k < ends.length; k++) {
        const e = ends[k];
        const blocked = e.type === 'blocked';
        const X = Math.round(e.x * 2), Y = Math.round(e.y * 2);
        const xo = X & 1, yo = Y & 1;
        if (xo && yo) markEnd((X - 1) / 2, (Y - 1) / 2, false);  // ends mid-cell (curtain, skylight)
        else if (!xo && yo) { markEnd(X / 2 - 1, (Y - 1) / 2, blocked); markEnd(X / 2, (Y - 1) / 2, blocked); }
        else if (xo && !yo) { markEnd((X - 1) / 2, Y / 2 - 1, blocked); markEnd((X - 1) / 2, Y / 2, blocked); }
        else { for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) markEnd(X / 2 + dx, Y / 2 + dy, blocked); }
      }
    }
    if (pruneIdle) {
      for (let i = placed.length - passiveCodes.length; i < placed.length; i++) { // placed passives
        const ci = placed[i].ci;
        if (touchStamp[ci] !== gen && endStamp[ci] !== gen && !onExtractorRay(ci)) return null;
      }
    }
    const list = [];
    for (let i = 0; i < touched.length; i++) {
      const ci = touched[i];
      if (occ[ci] || !floorOK[ci]) continue;
      for (let j = 0; j < FLOOR_PASSIVES.length; j++) {
        const ti = FLOOR_PASSIVES[j];
        if (remaining[ti] <= 0) continue;
        // A filter only matters where smoke passes or where it would cut a pull line.
        if (ti === T.filter && smokeStamp[ci] !== gen && pullStamp[ci] !== gen) continue;
        for (let d = 0; d < ROT[ti]; d++) list.push(option(S, ti, d, ci));
      }
    }
    for (let i = 0; i < walls.length; i++) {
      const ci = walls[i];
      if (occ[ci]) continue;
      if (ventOK[ci] && remaining[T.vent] > 0) list.push(option(S, T.vent, 0, ci));
      if (outletWinOK[ci] && remaining[T.window] > 0) list.push(option(S, T.window, 0, ci));
    }
    return list;
  }

  function passiveKey() {
    // Exact key of the (sorted) passive set: up to 4 codes packed into a safe
    // integer (base KEY_BASE digits, all >= 1), longer sets as a string.
    const n = passiveCodes.length;
    if (n <= 4 && numericKeys) {
      let k = 0;
      for (let i = 0; i < n; i++) k = k * KEY_BASE + passiveCodes[i] + 1;
      return k;
    }
    return passiveCodes.join(',');
  }

  // A solved configuration at depth K: count it unless a piece is redundant.
  function record() {
    const nf = S.fixed.length;
    for (let i = 0; i < placed.length; i++) {
      const without = cur.slice(0, nf + i).concat(cur.slice(nf + i + 1));
      nodes++;
      if (WB.isSolved(L, without)) return; // piece i is redundant
    }
    const sol = lib.sortPieces(placed.map((o) => o.piece));
    const key = JSON.stringify(sol);
    if (solutionKeys.has(key)) return;
    solutionKeys.add(key);
    solutions.push(sol);
    if (solutions.length >= maxSolutions) stop = 'capped';
  }

  // Evaluate the current configuration (of the given depth). Returns the
  // passive candidate list if it should be expanded, else null.
  function visit(depth) {
    if (depth === K) {
      if (evaluateLeaf()) record();
      else frontierOpen = true;
      return null;
    }
    const r = evaluate();
    if (r.solved) {
      // Normally found (and counted) in an earlier iteration; after the jump
      // to full depth, depths above the last completed iteration are new.
      if (depth >= recordFrom) record();
      return null;
    }
    return analyze(r);
  }

  function expandSources(depth, from, cands) {
    for (let i = from; i < srcOpts.length && !stop; i++) {
      const o = srcOpts[i];
      if (remaining[o.ti] <= 0 || occ[o.ci]) continue;
      place(o);
      const c2 = visit(depth + 1);
      if (c2 && !stop) expandSources(depth + 1, i + 1, c2);
      unplace(o);
    }
    if (stop) return;
    visited.clear(); // passive configurations below a different source set never coincide
    expandPassives(depth, cands);
  }

  function expandPassives(depth, cands) {
    for (let i = 0; i < cands.length && !stop; i++) {
      const o = cands[i];
      if (remaining[o.ti] <= 0 || occ[o.ci]) continue;
      place(o); insertSorted(passiveCodes, o.code);
      const key = passiveKey();
      if (!visited.has(key)) {
        visited.add(key);
        const c2 = visit(depth + 1);
        if (c2 && !stop) expandPassives(depth + 1, c2);
      }
      removeSorted(passiveCodes, o.code); unplace(o);
    }
  }

  // Iterative deepening. Once a solution has fixed minPieces, the remaining
  // depths are searched in one final pass (K = maxDepth) instead of one
  // iteration per depth; while nothing is found, each depth is completed in
  // turn, so a timeout still reports "no solution with <= completedDepth pieces".
  let completedDepth = -1, space = 0;
  K = 0;
  while (K <= maxDepth) {
    frontierOpen = false;
    iterNodes = 0;
    const c0 = visit(0);
    if (c0 && !stop) expandSources(0, 0, c0);
    if (stop) { space = Math.max(space, iterNodes); break; }
    completedDepth = K;
    space = iterNodes;
    if (!frontierOpen || K === maxDepth) break; // nothing of size K left to extend
    if (solutions.length) { recordFrom = K + 1; K = maxDepth; } else { K++; recordFrom = K; }
  }

  const status = stop || 'exhaustive';
  const count = solutions.length;
  solutions.sort((a, b) => a.length - b.length); // stable: DFS order within a size
  return {
    status,
    solvable: count > 0 ? true : status === 'exhaustive' ? false : null,
    count,
    solutions,
    minPieces: count ? solutions[0].length : null,
    nodes,
    ms: Date.now() - t0,
    space,
    completedDepth,
    maxDepth
  };
}

// ---------------------------------------------------------------------------
// CLI

const USAGE = `usage: node tools/solve.js <levelNumber | file.json [--index k]> [options]
  --time ms          time limit (default 5000)
  --max N            stop after N solutions (default 1000)
  --exclude a,b      solve without these tools
  --max-pieces k     only consider solutions with at most k pieces
  --list N           print the first N solutions (default 5; 0 = none)
  --show             draw the printed solutions (map + flow)
  --json             print the full result as JSON
  --src dir          chapter directory (default levels/src)`;

function sameSolution(a, b) {
  return JSON.stringify(lib.sortPieces(a)) === JSON.stringify(lib.sortPieces(b));
}

function summaryLine(res) {
  const rate = res.ms > 0 ? Math.round(res.nodes / res.ms * 1000) : res.nodes * 1000;
  const verdict = res.solvable === true ? 'SOLVABLE' : res.solvable === false ? 'UNSOLVABLE' : 'unknown';
  return res.status + ': ' + verdict + ', ' + res.count + ' solution' + (res.count === 1 ? '' : 's') +
    (res.minPieces != null ? ', min ' + res.minPieces + ' piece' + (res.minPieces === 1 ? '' : 's') : '') +
    ' | ' + res.nodes + ' nodes, ' + res.ms + ' ms' +
    (res.ms >= 50 ? ', ' + (rate >= 10000 ? Math.round(rate / 1000) + 'k' : rate) + ' nodes/s' : '') +
    ', depth ' + res.completedDepth + '/' + res.maxDepth;
}

function main(argv) {
  const a = lib.parseArgs(argv, {
    values: ['time', 'max', 'exclude', 'max-pieces', 'index', 'list', 'src', 'n'],
    bools: ['show', 'json']
  });
  if (a.flags.help || !a._.length) { console.log(USAGE); return a.flags.help ? 0 : 2; }
  const entry = lib.resolveLevelArg(a._[0], a.flags);
  const def = entry.def;
  const opts = {
    timeMs: lib.numFlag(a.flags, 'time', 5000),
    maxSolutions: lib.numFlag(a.flags, 'max', 1000),
    excludeTools: lib.listFlag(a.flags, 'exclude'),
    maxPieces: a.flags['max-pieces'] != null ? lib.numFlag(a.flags, 'max-pieces') : undefined
  };
  const bad = opts.excludeTools.filter((t) => !WB.TOOLS[t]);
  if (bad.length) throw new Error('unknown tool(s) in --exclude: ' + bad.join(', '));
  const res = solve(def, opts);
  if (a.flags.json) {
    console.log(JSON.stringify(Object.assign({ n: entry.n, name: def.name }, res)));
    return 0;
  }
  const ref = def.solution || [];
  console.log(lib.levelLabel(entry) + '  wind ' + lib.windLong(def.wind) + '  inv: ' + lib.inventoryString(def.inventory) +
    (opts.excludeTools.length ? '  (excluding ' + opts.excludeTools.join(', ') + ')' : '') +
    '  ref: ' + ref.length + ' piece' + (ref.length === 1 ? '' : 's'));
  console.log(summaryLine(res));
  const list = lib.numFlag(a.flags, 'list', 5);
  const shown = res.solutions.slice(0, Math.max(0, list));
  let show = null;
  if (a.flags.show && shown.length) show = require('./show');
  shown.forEach((sol, i) => {
    const tag = ref.length && sameSolution(sol, ref) ? '   = ref' : '';
    console.log('  ' + (i + 1) + '. ' + lib.piecesShort(sol) + tag);
    if (show) console.log(show.render(entry, withFixed(def, sol), { header: false, legend: i === 0 }).replace(/^/gm, '     '));
  });
  if (res.count > shown.length) console.log('  ... ' + (res.count - shown.length) + ' more (--list N)');
  const restricted = opts.excludeTools.length || opts.maxPieces != null;
  if (ref.length && !restricted && res.status === 'exhaustive' && !res.solutions.some((s) => sameSolution(s, ref))) {
    console.log('  note: ' + referenceNote(def, res));
  }
  return 0;
}

/** Why is the reference solution not among the counted solutions? */
function referenceNote(def, res) {
  const L = WB.parseLevel(def);
  const fixed = def.fixed || [];
  const ref = def.solution || [];
  if (!WB.simulate(L, fixed.concat(ref)).solved) return 'reference solution does NOT solve the level';
  if (ref.length > 12) return 'reference solution solves but was not counted (too long to analyse)';
  // Smallest proper subset that still solves (k <= 12, so at most 4095 subsets).
  let best = null;
  for (let m = 0; m < (1 << ref.length) - 1; m++) {
    const sub = ref.filter((_, i) => m & (1 << i));
    if ((!best || sub.length < best.length) && WB.simulate(L, fixed.concat(sub)).solved) best = sub;
  }
  if (best) return 'reference solution is not minimal; ' + (best.length ? lib.piecesShort(best) : 'no pieces at all') + ' also solves';
  return 'reference solution is minimal but was not found: solver bug, please report';
}

function withFixed(def, sol) {
  return (def.fixed || []).map((p) => Object.assign({ fixed: true }, p)).concat(sol);
}

module.exports = { solve, summaryLine, referenceNote, USAGE };

if (require.main === module) lib.runCli(main);
