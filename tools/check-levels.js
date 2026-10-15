#!/usr/bin/env node
'use strict';
/*
 * Runs every DESIGN.md section 6 check on the level sources and prints a
 * compact stats table. Exit code 1 on any hard failure.
 *
 *   node tools/check-levels.js [--file chNN.json | --level 7,12-15 | --chapter 3]
 *                              [--fast] [--time ms] [--intro-time ms] [--json] [--jobs N] [--targets] [--src dir]
 *
 * Hard failures: chapter file problems (bad JSON, >5 levels, wrong chapter
 * number), WB.validateLevel errors, malformed piece fields (x/y/d not integers,
 * e.g. d: "E", which the engine would silently read as 0), WB.introErrors (with
 * the real level number), level solved before anything is placed, reference
 * solution does not solve, intro level (1, 6, ..., 46) missing its new tool or
 * solvable without it, or NOT PROVEN unsolvable without it (the exclusion
 * search must be exhaustive: it gets its own, much larger budget, --intro-time,
 * default 60 s; tutorial levels are small, so a timeout means the level is too
 * big for an intro level or the budget too small), solver proves the level
 * unsolvable although the reference solves it or (exhaustive search) does not
 * report a reference solution that is minimal.
 * Warnings: partial chapters, unknown level / piece keys, intro level without a
 * tip, solvable with fewer pieces than the reference, decoy pieces before level
 * 76, solver timeout, big difficulty drop vs the previous level, and (with
 * --targets) DESIGN.md section 7 rough-target deviations.
 *
 * DIFFICULTY (higher = harder; level 1 is about 5, a hard level 30-40):
 *     D = log2(space)            configurations the pruned solver search had to evaluate
 *       + 2.0 * minPieces        pieces the player must place
 *       + 1.0 * decoys           inventory pieces that are not needed (inventory - minPieces)
 *       - 1.5 * log2(solutions)  many different solutions make a level easier
 *       + 1.0 * hazards          candles, papers, ferns (things air must avoid / stay gentle on)
 *       + 0.5 * objects          goals that must hold at the same time
 *       + 1.0 * (rooms - 1)      extra rooms to route air through
 *   clamped at 0. "~" marks an estimate (solver timed out: space and solutions
 *   are lower bounds; minPieces falls back to the reference solution length).
 */

const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const lib = require('./lib');
const { solve } = require('./solve');
const WB = lib.WB;

const DEFAULT_TIME = 3000;
const DEFAULT_INTRO_TIME = 60000;
const DECOY_FROM = 76;
const PIECE_KEYS = ['type', 'x', 'y', 'd'];

const TARGETS = [
  // [first, last, inv, objects, rooms] from DESIGN.md section 7
  [1, 5, [1, 2], [1, 2], [1, 1]],
  [6, 20, [1, 4], [1, 3], [1, 2]],
  [21, 50, [2, 5], [2, 4], [1, 3]],
  [51, 75, [3, 6], [3, 5], [2, 3]],
  [76, 100, [4, 8], [3, 7], [2, 4]]
];

function introTool(n) {
  if (n == null || n < 1 || (n - 1) % 5 !== 0) return null;
  return WB.TOOL_ORDER[(n - 1) / 5] || null;
}

function difficulty(f, s) {
  if (!s) return { value: null, approx: false };
  // 'timeout' and 'capped' searches stopped early: space and count are lower bounds.
  const exact = s.status === 'exhaustive';
  const minPieces = s.minPieces != null ? s.minPieces : f.ref;
  const count = Math.max(1, s.count);
  const space = Math.max(1, s.space);
  const decoys = Math.max(0, f.inv - minPieces);
  const d = Math.log2(space) + 2 * minPieces + decoys - 1.5 * Math.log2(count) +
    f.hazards + 0.5 * f.objects + (f.rooms - 1);
  return { value: Math.max(0, Math.round(d * 10) / 10), approx: !exact || s.minPieces == null };
}

/**
 * Piece fields the engine reads leniently (x | 0, d | 0): a typo such as
 * d: "E" or x: 2.5 would silently become 0 / 2 in the game. Returns
 * { errors, warnings } for the fixed and solution lists.
 */
function pieceFieldIssues(def) {
  const errors = [], warnings = [];
  for (const list of ['fixed', 'solution']) {
    const v = def[list];
    if (v == null) continue;
    if (!Array.isArray(v)) { errors.push(list + ' must be an array'); continue; }
    v.forEach((p, i) => {
      const label = list + '[' + i + ']';
      if (!p || typeof p !== 'object' || Array.isArray(p)) { errors.push(label + ' is not an object'); return; }
      for (const k of ['x', 'y']) {
        if (!Number.isInteger(p[k])) errors.push(label + ': ' + k + ' must be an integer (got ' + JSON.stringify(p[k]) + ')');
      }
      if (p.d !== undefined && !Number.isInteger(p.d)) {
        errors.push(label + ': d must be an integer rotation (got ' + JSON.stringify(p.d) + '; fans 0-3 = N E S W, deflectors 0 = / 1 = \\)');
      }
      for (const k of Object.keys(p)) if (!PIECE_KEYS.includes(k)) warnings.push(label + ': unknown key "' + k + '" (ignored)');
    });
  }
  return { errors, warnings };
}

/** No proper subset of the (solving) piece list solves the level. */
function isMinimalSolution(L, fixed, sol) {
  for (let m = 0; m < (1 << sol.length) - 1; m++) {
    if (WB.isSolved(L, fixed.concat(sol.filter((_, i) => m & (1 << i))))) return false;
  }
  return true;
}

/**
 * Check one level entry ({ n, chapter, index, def, file }).
 * opts: { fast, timeMs, introTimeMs, targets }. Returns a plain report object.
 */
function checkLevel(entry, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const def = entry.def || {};
  const n = entry.n;
  const rep = {
    n, chapter: entry.chapter, index: entry.index,
    file: entry.file ? path.basename(entry.file) : null,
    name: def.name || '',
    facts: null, solver: null, excluded: null,
    difficulty: null, difficultyApprox: false,
    errors: [], warnings: [], ms: 0
  };
  const err = (m) => rep.errors.push(m);
  const warn = (m) => rep.warnings.push(m);

  if (!def || typeof def !== 'object' || Array.isArray(def)) { err('level is not an object'); return rep; }
  for (const k of Object.keys(def)) if (!lib.LEVEL_KEYS.includes(k)) warn('unknown key "' + k + '" (ignored by the build)');
  if (!def.name) err('level has no name');

  // 1-2: structure, placement, inventory.
  const pf = pieceFieldIssues(def);
  pf.errors.forEach(err);
  pf.warnings.forEach(warn);
  const verrs = WB.validateLevel(def);
  verrs.forEach(err);
  if (verrs.length || pf.errors.length) { rep.ms = Date.now() - t0; return rep; }
  const f = rep.facts = lib.levelFacts(def);

  // 3: introductions.
  if (n == null) warn('level number unknown: intro checks skipped (use a chapter file or --n)');
  else WB.introErrors(def, n).forEach(err);

  // 4-5: initial state and reference solution.
  const L = WB.parseLevel(def);
  const fixed = def.fixed || [];
  const sol = def.solution || [];
  const initiallySolved = WB.simulate(L, fixed).solved;
  if (initiallySolved) err('already solved before anything is placed');
  const refSolves = WB.simulate(L, fixed.concat(sol)).solved;
  if (!refSolves) err(sol.length ? 'reference solution does not solve the level' : 'no reference solution');

  // 6: tool intro levels.
  const tool = introTool(n);
  if (tool) {
    if (!((def.inventory || {})[tool] > 0)) err('intro level for ' + tool + ' but ' + tool + ' is not in the inventory');
    if (!def.tip) warn('intro level for ' + tool + ' has no tip');
    if (!opts.fast) {
      // Must be a proof: the exclusion search gets its own, larger budget and
      // anything short of an exhaustive "unsolvable" fails the check.
      const introTime = opts.introTimeMs != null ? opts.introTimeMs : DEFAULT_INTRO_TIME;
      const x = solve(def, { timeMs: introTime, maxSolutions: 1, excludeTools: [tool] });
      rep.excluded = { tool, status: x.status, solvable: x.solvable, ms: x.ms, nodes: x.nodes, completedDepth: x.completedDepth, maxDepth: x.maxDepth };
      if (x.solvable === true) err('solvable without ' + tool + ': ' + lib.piecesShort(x.solutions[0]));
      else if (x.solvable === null) {
        err('could not prove the level unsolvable without ' + tool + ' (solver ' + x.status + ' after ' + x.ms +
          ' ms, exhaustive up to ' + x.completedDepth + ' of ' + x.maxDepth + ' pieces): make the intro level smaller or raise --intro-time');
      }
    }
  }

  // Solver stats.
  if (!opts.fast) {
    const s = solve(def, { timeMs: opts.timeMs });
    rep.solver = {
      status: s.status, solvable: s.solvable, count: s.count, minPieces: s.minPieces,
      nodes: s.nodes, space: s.space, ms: s.ms, completedDepth: s.completedDepth, maxDepth: s.maxDepth,
      first: s.solutions.length ? s.solutions[0] : null
    };
    if (s.solvable === false && refSolves) err('solver says unsolvable but the reference solution solves it (solver/engine bug?)');
    // Runtime completeness cross-check: an exhaustive search reports every
    // minimal solution, so a minimal reference solution must be among them.
    if (s.status === 'exhaustive' && refSolves && sol.length <= 12 && isMinimalSolution(L, fixed, sol)) {
      const key = JSON.stringify(lib.sortPieces(sol));
      if (!s.solutions.some((x) => JSON.stringify(x) === key)) err('solver did not report the (minimal) reference solution: solver bug, please report');
    }
    if (s.minPieces != null && s.minPieces < sol.length) {
      warn('solvable with ' + s.minPieces + ' piece' + (s.minPieces === 1 ? '' : 's') + ' (reference uses ' + sol.length + '): ' + lib.piecesShort(s.solutions[0]));
    }
    if (s.status === 'timeout') warn('solver timed out after ' + s.ms + ' ms (exhaustive up to ' + s.completedDepth + ' of ' + s.maxDepth + ' pieces)');
    const d = difficulty(f, s);
    rep.difficulty = d.value;
    rep.difficultyApprox = d.approx;
  }

  if (n != null && n < DECOY_FROM && sol.length < f.inv && refSolves && !initiallySolved) {
    warn('reference uses ' + sol.length + ' of ' + f.inv + ' inventory pieces (decoys are for levels ' + DECOY_FROM + '+)');
  }

  if (opts.targets && n != null) {
    const t = TARGETS.find((r) => n >= r[0] && n <= r[1]);
    if (t) {
      const chk = (label, v, range) => {
        if (v < range[0] || v > range[1]) warn('target: ' + label + ' ' + v + ' outside ' + range[0] + '-' + range[1] + ' for levels ' + t[0] + '-' + t[1]);
      };
      chk('inventory', f.inv, t[2]);
      chk('objects', f.objects, t[3]);
      chk('rooms', f.rooms, t[4]);
    }
  }

  rep.ms = Date.now() - t0;
  return rep;
}

/** checkLevel that turns an exception (engine/tool bug) into a FAIL for that level. */
function safeCheck(entry, opts) {
  try {
    return checkLevel(entry, opts);
  } catch (e) {
    return {
      n: entry.n, chapter: entry.chapter, index: entry.index,
      file: entry.file ? path.basename(entry.file) : null, name: (entry.def && entry.def.name) || '',
      facts: null, solver: null, excluded: null, difficulty: null, difficultyApprox: false,
      errors: ['internal error while checking: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e)],
      warnings: [], ms: 0
    };
  }
}

/** Cross-level warnings (needs the reports in level order). */
function addSequenceWarnings(reports) {
  const byN = new Map(reports.map((r) => [r.n, r]));
  for (const r of reports) {
    if (r.n == null || r.difficulty == null || introTool(r.n)) continue;
    const p = byN.get(r.n - 1);
    if (!p || p.difficulty == null) continue;
    const margin = Math.max(5, 0.25 * p.difficulty);
    if (r.difficulty < p.difficulty - margin) {
      r.warnings.push('difficulty ' + r.difficulty + ' is much lower than level ' + p.n + "'s " + p.difficulty);
    }
  }
}

// ---------------------------------------------------------------------------
// Parallel runner (worker_threads; each level is independent)

function runParallel(entries, opts, jobs) {
  if (jobs <= 1 || entries.length <= 1) return Promise.resolve(entries.map((e) => safeCheck(e, opts)));
  return new Promise((resolve, reject) => {
    const results = new Array(entries.length);
    let next = 0, done = 0, failed = false;
    const workers = [];
    const send = (w) => {
      const i = next++;
      const e = entries[i];
      w.postMessage({ i, entry: { n: e.n, chapter: e.chapter, index: e.index, def: e.def, file: e.file }, opts });
    };
    const count = Math.min(jobs, entries.length);
    for (let k = 0; k < count; k++) {
      const w = new Worker(__filename, { workerData: { wbCheckWorker: true } });
      workers.push(w);
      w.on('message', (m) => {
        results[m.i] = m.rep;
        done++;
        if (next < entries.length) send(w);
        else w.terminate();
        if (done === entries.length) resolve(results);
      });
      w.on('error', (e) => {
        if (failed) return;
        failed = true;
        workers.forEach((x) => x.terminate());
        reject(e);
      });
      send(w);
    }
  });
}

if (!isMainThread && workerData && workerData.wbCheckWorker) {
  parentPort.on('message', (job) => {
    parentPort.postMessage({ i: job.i, rep: safeCheck(job.entry, job.opts) });
  });
}

// ---------------------------------------------------------------------------
// CLI

const USAGE = `usage: node tools/check-levels.js [selection] [options]
selection (default: every levels/src/chNN.json):
  --file path        one chapter file (or a bare level file with --n N)
  --level list       level numbers, e.g. 7 or 6-10,12
  --chapter list     chapter numbers, e.g. 3 or 1-4
options:
  --fast             skip the solver (no intro-exclusion check, no difficulty)
  --time ms          solver time limit per search (default ${DEFAULT_TIME})
  --intro-time ms    budget for the exhaustive "unsolvable without the new tool"
                     proof on intro levels (default ${DEFAULT_INTRO_TIME}; a timeout FAILS)
  --jobs N           parallel workers (default: cores - 1, max 4)
  --targets          also warn about DESIGN.md section 7 rough targets
  --json             machine-readable output
  --src dir          chapter directory (default levels/src)`;

function parseList(s) {
  const out = new Set();
  for (const part of String(s).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) throw new Error('bad number list "' + s + '"');
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
  }
  return out;
}

function select(flags) {
  let problems, levels;
  if (flags.file) {
    const ch = lib.readChapterFile(path.resolve(flags.file));
    problems = ch.problems;
    if (ch.single) {
      levels = [{ n: flags.n != null ? +flags.n : null, chapter: null, index: 0, def: ch.levels[0], file: ch.file }];
    } else {
      levels = lib.flatten([ch]);
    }
  } else {
    const all = lib.loadAllLevels(flags.src);
    problems = all.problems;
    levels = all.levels;
  }
  if (flags.level) {
    const want = parseList(flags.level);
    levels = levels.filter((e) => want.has(e.n));
  }
  if (flags.chapter) {
    const want = parseList(flags.chapter);
    levels = levels.filter((e) => want.has(e.chapter));
    problems = problems.filter((p) => !/^ch\d+\.json/i.test(p.msg) || [...want].some((c) => p.msg.toLowerCase().startsWith('ch' + String(c).padStart(2, '0') + '.json')));
  }
  return { problems, levels };
}

function statusShort(s) {
  if (!s) return '-';
  return s.status === 'exhaustive' ? 'exh' : s.status === 'timeout' ? 'TIME' : 'cap';
}

function introShort(x) {
  if (!x) return '-';
  return x.solvable === true ? 'FAIL' : x.solvable === false ? 'ok' : '?';
}

function table(reports) {
  const { pad, lpad, trunc } = lib;
  const lines = [];
  lines.push('   #  ' + pad('name', 22) + ' ' + pad('map', 5) + ' rm inv ref obj hz wind  w/o  solver sols min    space     ms  diff');
  for (const r of reports) {
    const f = r.facts;
    const s = r.solver;
    const cells = [
      lpad(r.n == null ? '?' : r.n, 4) + '  ' + pad(trunc(r.name, 22), 22),
      pad(f ? f.w + 'x' + f.h : '-', 5),
      lpad(f ? f.rooms : '-', 2), lpad(f ? f.inv : '-', 3), lpad(f ? f.ref : '-', 3),
      lpad(f ? f.objects : '-', 3), lpad(f ? f.hazards : '-', 2), pad(f ? f.wind : '-', 5),
      pad(introShort(r.excluded), 4),
      pad(statusShort(s), 6), lpad(s ? s.count : '-', 4), lpad(s && s.minPieces != null ? s.minPieces : '-', 3),
      lpad(s ? s.space : '-', 8), lpad(s ? s.ms : '-', 6),
      lpad(r.difficulty == null ? '-' : (r.difficultyApprox ? '~' : '') + r.difficulty.toFixed(1), 5)
    ];
    lines.push(cells.join(' ') + (r.errors.length ? '  FAIL' : ''));
  }
  return lines.join('\n');
}

async function main(argv) {
  const a = lib.parseArgs(argv, {
    values: ['file', 'level', 'chapter', 'time', 'intro-time', 'jobs', 'src', 'n'],
    bools: ['fast', 'json', 'targets']
  });
  if (a.flags.help) { console.log(USAGE); return 0; }
  if (a._.length) {
    // Convenience: a bare number = --level, a path = --file.
    if (/^[\d,-]+$/.test(a._[0])) a.flags.level = a._[0]; else a.flags.file = a._[0];
  }
  const t0 = Date.now();
  const { problems, levels } = select(a.flags);
  const os = require('os');
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const jobs = Math.max(1, Math.floor(lib.numFlag(a.flags, 'jobs', Math.min(4, Math.max(1, cores - 1)))));
  const opts = {
    fast: !!a.flags.fast, timeMs: lib.numFlag(a.flags, 'time', DEFAULT_TIME),
    introTimeMs: lib.numFlag(a.flags, 'intro-time', DEFAULT_INTRO_TIME), targets: !!a.flags.targets
  };
  if (!levels.length && !problems.some((p) => p.severity === 'error')) {
    throw new Error('no levels to check' + (a.flags.level ? ' (--level ' + a.flags.level + ')' : '') +
      (a.flags.chapter ? ' (--chapter ' + a.flags.chapter + ')' : ''));
  }
  const reports = await runParallel(levels, opts, a.flags.fast ? 1 : jobs);
  addSequenceWarnings(reports);

  const fileErrors = problems.filter((p) => p.severity === 'error').map((p) => p.msg);
  const fileWarnings = problems.filter((p) => p.severity === 'warn').map((p) => p.msg);
  const failures = fileErrors.length + reports.reduce((t, r) => t + r.errors.length, 0);
  const warnings = fileWarnings.length + reports.reduce((t, r) => t + r.warnings.length, 0);
  const summary = {
    levels: reports.length, failures, warnings, failedLevels: reports.filter((r) => r.errors.length).map((r) => r.n),
    ms: Date.now() - t0, fast: opts.fast, timeMs: opts.timeMs
  };

  if (a.flags.json) {
    // Valid JSON, one level per line (compact but still greppable).
    console.log('{"summary":' + JSON.stringify(summary) + ',"fileErrors":' + JSON.stringify(fileErrors) +
      ',"fileWarnings":' + JSON.stringify(fileWarnings) + ',"levels":[\n' +
      reports.map((r) => JSON.stringify(r)).join(',\n') + '\n]}');
    return failures ? 1 : 0;
  }
  if (reports.length) console.log(table(reports));
  const issues = [];
  for (const m of fileErrors) issues.push('FAIL  ' + m);
  for (const m of fileWarnings) issues.push('warn  ' + m);
  for (const r of reports) {
    const tag = lib.pad('#' + (r.n == null ? '?' : r.n), 5);
    for (const m of r.errors) issues.push(tag + 'FAIL  ' + m);
    for (const m of r.warnings) issues.push(tag + 'warn  ' + m);
  }
  if (issues.length) console.log(issues.join('\n'));
  console.log((failures ? 'FAILED' : 'OK') + ': ' + reports.length + ' level' + (reports.length === 1 ? '' : 's') +
    ', ' + failures + ' failure' + (failures === 1 ? '' : 's') + ', ' + warnings + ' warning' + (warnings === 1 ? '' : 's') +
    ' (' + (summary.ms / 1000).toFixed(1) + ' s' + (opts.fast ? ', --fast: solver skipped' : ', solver ' + opts.timeMs + ' ms/search, intro proofs up to ' + opts.introTimeMs + ' ms') + ')');
  return failures ? 1 : 0;
}

module.exports = {
  checkLevel, safeCheck, addSequenceWarnings, difficulty, introTool, pieceFieldIssues, isMinimalSolution, runParallel, table,
  DEFAULT_TIME, DEFAULT_INTRO_TIME
};

if (isMainThread && require.main === module) lib.runCli(main);
