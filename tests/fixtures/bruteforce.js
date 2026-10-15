'use strict';
/*
 * Independent brute-force oracle for auditing tools/solve.js.
 *
 * Nothing here is shared with the solver: it enumerates EVERY subset of the
 * inventory over EVERY valid cell and rotation (no relevance pruning, no
 * source/passive split, no idle pruning, solved configurations ARE extended)
 * and asks the engine whether each one is solved.
 *
 *   bruteForce(def, { inventory, maxPieces, engine }) ->
 *     { configs, solved: Map<key, pieces>, minimal: Set<key>, irredundant: Set<key>, minPieces }
 *   compareWithSolver(def, bf, res) -> string[]      (empty = agrees)
 *   randomLevel(seed, cfg) -> level def | null       (seeded, valid levels only)
 *   estimateConfigs(def, inventory) -> upper bound on the number of configurations
 *
 * Definitions used by compareWithSolver (all over sets of placed pieces, a
 * piece being (type, x, y, d) with d = 0 for single-rotation tools):
 *   solution     a configuration (fits the inventory, valid cells, no overlap)
 *                that the engine reports solved;
 *   minimal      a solution no PROPER subset of which is a solution;
 *   irredundant  a solution from which removing any ONE piece breaks it;
 *   reducible    a solution B is reducible to a solution F if F is a subset of
 *                B (F is B with zero or more pieces removed). Every solution
 *                is reducible to some minimal solution, so "every solution is
 *                reducible to a solution the solver reports" holds iff the
 *                solver reports every minimal solution.
 */

const path = require('path');
const WB = require(path.join(__dirname, '..', '..', 'js', 'engine.js'));

// ---------------------------------------------------------------------------
// Keys

function pieceKey(p) {
  const rot = WB.TOOLS[p.type] ? WB.TOOLS[p.type].rotations : 1;
  return p.type + '@' + p.x + ',' + p.y + ':' + (rot > 1 ? (p.d | 0) : 0);
}

function configKey(pieces) {
  return pieces.map(pieceKey).sort().join(' ');
}

// ---------------------------------------------------------------------------
// Enumeration

function inventoryOf(def, opts) {
  const src = (opts && opts.inventory) || def.inventory || {};
  const inv = {};
  for (const t of WB.TOOL_ORDER) if ((src[t] | 0) > 0) inv[t] = src[t] | 0;
  return inv;
}

/** Every concrete placement of every inventory tool on the level (fixed pieces only). */
function allOptions(L, inv) {
  const out = [];
  for (const t of WB.TOOL_ORDER) {
    if (!inv[t]) continue;
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (!WB.canPlace(L, L.fixed, t, x, y)) continue;
        for (let d = 0; d < WB.TOOLS[t].rotations; d++) out.push({ type: t, x, y, d });
      }
    }
  }
  return out;
}

function estimateConfigs(def, inventory) {
  const L = WB.parseLevel(def);
  const inv = inventoryOf(def, { inventory });
  const opts = allOptions(L, inv);
  const byType = {};
  for (const o of opts) byType[o.type] = (byType[o.type] || 0) + 1;
  let est = 1;
  for (const t of Object.keys(inv)) {
    // sum_{k <= inv[t]} C(n, k): an upper bound per type (cells may collide across types)
    const n = byType[t] || 0;
    let s = 0, c = 1;
    for (let k = 0; k <= inv[t]; k++) { s += c; c = c * (n - k) / (k + 1); }
    est *= s;
  }
  return est;
}

/**
 * opts.engine: an engine object with isSolved(L, pieces) / parseLevel (default:
 * js/engine.js). opts.maxPieces limits the configuration size.
 */
function bruteForce(def, opts) {
  opts = opts || {};
  const E = opts.engine || WB;
  const L = E.parseLevel(def);
  const inv = inventoryOf(def, opts);
  const maxPieces = opts.maxPieces != null ? opts.maxPieces : Infinity;
  const options = allOptions(WB.parseLevel(def), inv);
  const fixed = L.fixed;
  const used = {};
  const occ = new Set();
  const cur = [];
  const solved = new Map();
  let configs = 0;

  (function rec(from) {
    configs++;
    if (E.isSolved(L, fixed.concat(cur))) solved.set(configKey(cur), cur.slice());
    if (cur.length >= maxPieces) return;
    for (let i = from; i < options.length; i++) {
      const o = options[i];
      const cell = o.x + ',' + o.y;
      if ((used[o.type] || 0) >= inv[o.type] || occ.has(cell)) continue;
      used[o.type] = (used[o.type] || 0) + 1; occ.add(cell); cur.push(o);
      rec(i + 1);
      cur.pop(); occ.delete(cell); used[o.type]--;
    }
  })(0);

  const minimal = new Set(), irredundant = new Set();
  let minPieces = null;
  for (const [key, ps] of solved) {
    if (minPieces === null || ps.length < minPieces) minPieces = ps.length;
    let properSubsetSolves = false;
    for (let m = 0; m < (1 << ps.length) - 1 && !properSubsetSolves; m++) {
      if (solved.has(configKey(ps.filter((_, i) => m & (1 << i))))) properSubsetSolves = true;
    }
    if (!properSubsetSolves) minimal.add(key);
    let oneRemovalSolves = false;
    for (let i = 0; i < ps.length && !oneRemovalSolves; i++) {
      if (solved.has(configKey(ps.filter((_, j) => j !== i)))) oneRemovalSolves = true;
    }
    if (!oneRemovalSolves) irredundant.add(key);
  }
  return { configs, solved, minimal, irredundant, minPieces, options: options.length };
}

// ---------------------------------------------------------------------------
// Comparison

/** The key of a found solution that B (pieces) is reducible to, or null. */
function reducibleTo(B, foundKeys) {
  for (let m = (1 << B.length) - 1; m >= 0; m--) {
    const k = configKey(B.filter((_, i) => m & (1 << i)));
    if (foundKeys.has(k)) return k;
  }
  return null;
}

/**
 * Compare a solve() result with the brute force of the same level and
 * inventory. Returns a list of human-readable problems (empty = agrees).
 * opts.refEngine: also re-simulate every reported solution with this engine.
 */
function compareWithSolver(def, bf, res, opts) {
  opts = opts || {};
  const problems = [];
  const L = WB.parseLevel(def);
  const inv = inventoryOf(def, opts);
  if (res.status !== 'exhaustive') problems.push('solver status ' + res.status + ' (expected exhaustive)');
  const bfSolvable = bf.solved.size > 0;
  if (res.solvable !== bfSolvable) problems.push('solvable: solver ' + res.solvable + ', brute force ' + bfSolvable);
  if (res.minPieces !== bf.minPieces) problems.push('minPieces: solver ' + res.minPieces + ', brute force ' + bf.minPieces);
  if (res.count !== res.solutions.length) problems.push('count ' + res.count + ' != solutions.length ' + res.solutions.length);

  const found = new Set();
  for (const sol of res.solutions) {
    const k = configKey(sol);
    if (found.has(k)) problems.push('duplicate solution ' + k);
    found.add(k);
    // independent re-checks of the reported solution
    const used = {};
    const placed = L.fixed.slice();
    let valid = true;
    for (const p of sol) {
      used[p.type] = (used[p.type] || 0) + 1;
      const rot = WB.TOOLS[p.type] ? WB.TOOLS[p.type].rotations : 0;
      if (!WB.canPlace(L, placed, p.type, p.x, p.y) || (p.d | 0) < 0 || (p.d | 0) >= rot) valid = false;
      placed.push({ type: p.type, x: p.x, y: p.y, d: p.d | 0 });
    }
    for (const t of Object.keys(used)) if (used[t] > (inv[t] || 0)) valid = false;
    if (!valid) problems.push('invalid placement / over inventory: ' + k);
    if (!WB.simulate(L, placed).solved) problems.push('reported solution does not solve (simulate): ' + k);
    if (opts.refEngine && !opts.refEngine.simulate(opts.refEngine.parseLevel(def), placed).solved) {
      problems.push('reported solution does not solve (reference engine): ' + k);
    }
    if (!bf.solved.has(k)) problems.push('reported solution not a brute-force solution: ' + k);
    else if (!bf.irredundant.has(k)) problems.push('reported solution is redundant: ' + k);
  }
  for (const k of bf.minimal) if (!found.has(k)) problems.push('missing minimal solution: ' + k);
  for (const [k, B] of bf.solved) {
    if (reducibleTo(B, found) === null) { problems.push('brute-force solution not reducible to a reported one: ' + k); break; }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Random levels

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_TOOLS = WB.TOOL_ORDER;
const SOURCE_TOOLS = ['window', 'fan', 'extractor', 'ceilingfan'];

/**
 * A random valid level (maps 4x4 up to 7x6 by default, see cfg), or null if the draw was rejected.
 * cfg: { maxConfigs (default 150000), planted (probability, default 0.5),
 *        minInv..maxInv (inventory size, default 1..3), maxObj (objects 1..maxObj, default 3),
 *        minW..maxW x minH..maxH (map size incl. walls, default 4..7 x 4..6),
 *        focus: null | 'pull' | 'stalled' | 'smoke' | 'passive' }
 *  - planted: place the inventory pieces at random first and choose the
 *    objects to match the resulting flow, so the level is usually solvable.
 */
function randomLevel(seed, cfg) {
  cfg = cfg || {};
  const rnd = mulberry32(seed * 2654435761 + 12345);
  const ri = (n) => Math.floor(rnd() * n);
  const pick = (a) => a[ri(a.length)];
  const maxW = cfg.maxW || 7, maxH = cfg.maxH || 6, minW = cfg.minW || 4, minH = cfg.minH || 4;
  const W = minW + ri(maxW - minW + 1), H = minH + ri(maxH - minH + 1); // including walls

  // House outline: the rectangle, optionally minus a corner notch.
  const inside = [];
  for (let y = 0; y < H; y++) { inside.push([]); for (let x = 0; x < W; x++) inside[y].push(true); }
  if (W >= 6 && H >= 5 && rnd() < 0.35) {
    const nw = 1 + ri(W - 5), nh = 1 + ri(H - 4);
    const right = rnd() < 0.5, bottom = rnd() < 0.5;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) inside[bottom ? H - 1 - y : y][right ? W - 1 - x : x] = false;
  }
  const g = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      if (!inside[y][x]) { row.push('~'); continue; }
      let floor = true;
      for (let dy = -1; dy <= 1 && floor; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !inside[ny][nx]) { floor = false; break; }
        }
      }
      row.push(floor ? '.' : '#');
    }
    g.push(row);
  }
  // Interior wall (vertical or horizontal) with an optional doorway.
  if (rnd() < 0.45) {
    if (W >= 6 && rnd() < 0.6) {
      const cx = 2 + ri(W - 4);
      const cells = [];
      for (let y = 1; y < H - 1; y++) if (g[y][cx] === '.') { g[y][cx] = '#'; cells.push(y); }
      if (cells.length && rnd() < 0.4) g[pick(cells)][cx] = '.';
    } else if (H >= 5) {
      const cy = 2 + ri(H - 4);
      const cells = [];
      for (let x = 1; x < W - 1; x++) if (g[cy][x] === '.') { g[cy][x] = '#'; cells.push(x); }
      if (cells.length && rnd() < 0.4) g[cy][pick(cells)] = '.';
    }
  }
  // A few solid walls and tables.
  for (let i = ri(3); i > 0; i--) {
    const x = ri(W), y = ri(H);
    if (g[y][x] === '#') g[y][x] = '%';
  }
  if (rnd() < 0.3) {
    const x = 1 + ri(W - 2), y = 1 + ri(H - 2);
    if (g[y][x] === '.') g[y][x] = 'o';
  }

  const windFrom = pick(['N', 'E', 'S', 'W']);
  const strength = pick([0, 1, 1, 1, 2, 2, 3]);
  const def = { name: 'bf' + seed, wind: { from: windFrom, strength }, map: g.map((r) => r.join('')), fixed: [], inventory: {}, solution: [] };
  let L = WB.parseLevel(def);

  const PASSIVES = ['deflector', 'deflector', 'curtain', 'vent', 'vent', 'splitter', 'skylight', 'filter', 'window', 'window'];
  const toolPool = cfg.focus === 'passive' ? PASSIVES
    : cfg.focus === 'pull' ? ['extractor', 'extractor', 'deflector', 'curtain', 'filter', 'skylight', 'splitter', 'window', 'fan']
    : cfg.focus === 'stalled' ? ['window', 'window', 'deflector', 'deflector', 'vent', 'splitter', 'skylight', 'curtain', 'extractor']
      : cfg.focus === 'smoke' ? ['filter', 'filter', 'window', 'extractor', 'skylight', 'deflector', 'fan', 'ceilingfan', 'curtain']
        : ALL_TOOLS;
  // Fixed pieces: anything, at random.
  const nFixed = cfg.focus === 'stalled' || cfg.focus === 'passive' ? 1 + ri(3) : ri(4);
  for (let i = 0; i < nFixed; i++) {
    const t = cfg.focus === 'stalled' && i === 0 ? 'window' : cfg.focus === 'pull' && i === 0 ? 'extractor'
      : cfg.focus === 'passive' ? pick(i === 0 ? SOURCE_TOOLS : ALL_TOOLS.concat(SOURCE_TOOLS)) : pick(ALL_TOOLS.concat(SOURCE_TOOLS));
    const cells = WB.placementCells(L, def.fixed, t);
    if (!cells.length) continue;
    const c = pick(cells);
    def.fixed.push({ type: t, x: c.x, y: c.y, d: ri(WB.TOOLS[t].rotations) });
  }

  // Inventory: minInv..maxInv pieces drawn from the tool pool (all tools by default).
  const minInv = cfg.minInv || 1;
  const nInv = minInv + ri(Math.max(1, (cfg.maxInv || 3) - minInv + 1));
  const invList = [];
  for (let i = 0; i < nInv; i++) invList.push(pick(toolPool));
  for (const t of invList) def.inventory[t] = (def.inventory[t] || 0) + 1;

  // Objects.
  const floorCells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === '.' && !def.fixed.some((p) => p.x === x && p.y === y)) floorCells.push({ x, y });
  if (!floorCells.length) return null;
  const nObj = 1 + ri(cfg.maxObj || 3);
  const planted = rnd() < (cfg.planted != null ? cfg.planted : 0.5);
  if (planted) {
    // Place the inventory at random, then choose objects that the flow satisfies.
    const plantedPieces = [];
    for (const t of invList) {
      const cells = WB.placementCells(L, def.fixed.concat(plantedPieces), t);
      if (!cells.length) continue;
      const c = pick(cells);
      plantedPieces.push({ type: t, x: c.x, y: c.y, d: ri(WB.TOOLS[t].rotations) });
    }
    const r = WB.simulate(L, def.fixed.concat(plantedPieces));
    const r0 = WB.simulate(L, def.fixed);
    const free = floorCells.filter((c) => !plantedPieces.some((p) => p.x === c.x && p.y === c.y));
    // Prefer cells whose flow the planted pieces change (so the pieces matter).
    const changed = free.filter((c) => r.flow[c.y * W + c.x] !== r0.flow[c.y * W + c.x]);
    for (let i = 0; i < nObj && free.length; i++) {
      const pool = changed.length && rnd() < 0.7 ? changed : free;
      const c = pool.splice(ri(pool.length), 1)[0];
      if (pool === changed) free.splice(free.indexOf(c), 1); else if (changed.indexOf(c) >= 0) changed.splice(changed.indexOf(c), 1);
      const f = r.flow[c.y * W + c.x];
      const ch = f >= 2 ? pick(['l', 'p', 's']) : f === 1 ? pick(['p', 'f', 'n', 's']) : pick(['c', 'n', 'c']);
      g[c.y][c.x] = ch;
    }
    def.solution = plantedPieces.map((p) => Object.assign({}, p));
  } else {
    for (let i = 0; i < nObj; i++) {
      const c = pick(floorCells);
      g[c.y][c.x] = pick(['p', 'p', 'c', 's', 's', 'l', 'n', 'f']);
    }
  }
  def.map = g.map((r) => r.join(''));
  L = WB.parseLevel(def);
  if (!L.objects.length) return null;
  // Planted solution pieces may now sit on object cells (never: we excluded them) - validate anyway.
  if (WB.validateLevel(def).length) {
    def.solution = [];
    if (WB.validateLevel(def).length) return null;
  }
  if (estimateConfigs(def) > (cfg.maxConfigs || 150000)) return null;
  return def;
}

module.exports = { bruteForce, compareWithSolver, reducibleTo, randomLevel, estimateConfigs, configKey, pieceKey, mulberry32 };
