'use strict';
/*
 * Shared helpers for the Windbreaker level tools (Node built-ins only).
 *
 *   loadChapters(dir)      read levels/src/chNN.json, sorted by chapter
 *   flatten(chapters)      -> numbered level entries
 *   findLevel(n, dir)      -> one entry by level number
 *   resolveLevelArg(args)  CLI helper: "<levelNumber | file.json [--index k]>"
 *   countRooms(def)        connected floor components (4-connectivity)
 *   formatting helpers shared by show / solve / check
 *
 * A level "entry" is { n, chapter, index, def, file, chapterTitle }, where
 * n = (chapter - 1) * 5 + index + 1 and index is 0-based within the chapter.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WB = require(path.join(ROOT, 'js', 'engine.js'));
const SRC_DIR = path.join(ROOT, 'levels', 'src');
const LEVELS_PER_CHAPTER = 5;
const CHAPTER_FILE_RE = /^ch(\d+)\.json$/i;
const LEVEL_KEYS = ['name', 'tip', 'wind', 'map', 'fixed', 'inventory', 'solution'];
const HAZARD_TYPES = ['candle', 'papers', 'fern'];

// ---------------------------------------------------------------------------
// Loading

/**
 * Offset of the first JSON syntax error in text (-1 if none). JSON.parse in
 * current Node versions often omits the position, and hand-edited level files
 * deserve a line number.
 */
function jsonErrorOffset(text) {
  let i = 0;
  const n = text.length;
  const ws = () => { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
  const fail = () => { throw i; }; // eslint-disable-line no-throw-literal
  const str = () => {
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '"') { i++; return; }
      if (c < ' ') fail();
      i++;
    }
    fail();
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++; ws();
      if (text[i] === close) { i++; return; }
      for (;;) {
        if (c === '{') { ws(); if (text[i] !== '"') fail(); str(); ws(); if (text[i] !== ':') fail(); i++; }
        value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === close) { i++; return; }
        fail();
      }
    }
    if (c === '"') { str(); return; }
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) fail();
    i += m[0].length;
  };
  try {
    value(); ws();
    if (i < n) fail();
    return -1;
  } catch (e) {
    if (typeof e === 'number') return e;
    throw e;
  }
}

function lineCol(text, pos) {
  const before = text.slice(0, pos).split('\n');
  return 'line ' + before.length + ' col ' + (before[before.length - 1].length + 1);
}

/** Path for messages: relative to cwd when inside it, else absolute. */
function displayPath(file) {
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    const pos = jsonErrorOffset(text);
    const where = pos >= 0 ? ' at ' + lineCol(text, pos) + ': ' + JSON.stringify(text.slice(pos, pos + 20)) : '';
    const err = new Error(displayPath(file) + ': invalid JSON' + where + ' (' + e.message + ')');
    err.code = 'EJSON';
    throw err;
  }
}

/**
 * Read one chapter file. Returns { file, chapter, title, levels, problems }.
 * problems: [{ severity: 'error'|'warn', msg }]. Never throws for content
 * problems (JSON errors are reported as an error problem with levels = []).
 */
function readChapterFile(file) {
  const problems = [];
  const base = path.basename(file);
  const m = CHAPTER_FILE_RE.exec(base);
  const fileNum = m ? +m[1] : null;
  let obj;
  try {
    obj = readJson(file);
  } catch (e) {
    return { file, chapter: fileNum, title: '', levels: [], problems: [{ severity: 'error', msg: e.message }] };
  }
  if (obj && Array.isArray(obj.map)) {
    // A bare level file (not a chapter): wrap it.
    return { file, chapter: null, title: '', levels: [obj], problems, single: true };
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.levels)) {
    problems.push({ severity: 'error', msg: base + ': expected { "chapter", "title", "levels": [...] }' });
    return { file, chapter: fileNum, title: '', levels: [], problems };
  }
  let chapter = obj.chapter;
  if (chapter == null) {
    chapter = fileNum;
    if (chapter == null) problems.push({ severity: 'error', msg: base + ': missing "chapter" number' });
  } else if (!Number.isInteger(chapter) || chapter < 1) {
    problems.push({ severity: 'error', msg: base + ': "chapter" must be a positive integer' });
    chapter = fileNum;
  } else if (fileNum != null && fileNum !== chapter) {
    problems.push({ severity: 'error', msg: base + ': file name says chapter ' + fileNum + ' but "chapter" is ' + chapter });
  }
  if (!obj.title) problems.push({ severity: 'warn', msg: base + ': chapter has no "title"' });
  const n = obj.levels.length;
  if (n > LEVELS_PER_CHAPTER) {
    problems.push({ severity: 'error', msg: base + ': has ' + n + ' levels, max ' + LEVELS_PER_CHAPTER });
  } else if (n < LEVELS_PER_CHAPTER) {
    problems.push({ severity: 'warn', msg: base + ': partial chapter (' + n + '/' + LEVELS_PER_CHAPTER + ' levels)' });
  }
  return { file, chapter, title: obj.title || '', levels: obj.levels, problems };
}

/**
 * Load every chNN.json in dir, sorted by chapter number.
 * Returns { chapters: [...readChapterFile results], problems: [...] } where
 * problems also includes cross-file issues (duplicates).
 */
function loadChapters(dir) {
  dir = dir || SRC_DIR;
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => CHAPTER_FILE_RE.test(f));
  } catch (e) {
    return { chapters: [], problems: [{ severity: 'error', msg: 'cannot read ' + dir + ': ' + e.message }] };
  }
  const chapters = files.map((f) => readChapterFile(path.join(dir, f)));
  chapters.sort((a, b) => (a.chapter || 0) - (b.chapter || 0) || a.file.localeCompare(b.file));
  const problems = [];
  const seen = new Map();
  for (const ch of chapters) {
    problems.push(...ch.problems);
    if (ch.chapter == null) continue;
    if (seen.has(ch.chapter)) {
      problems.push({ severity: 'error', msg: 'chapter ' + ch.chapter + ' defined twice: ' +
        path.basename(seen.get(ch.chapter)) + ' and ' + path.basename(ch.file) });
    } else {
      seen.set(ch.chapter, ch.file);
    }
  }
  return { chapters, problems };
}

function levelNumber(chapter, index) {
  return (chapter - 1) * LEVELS_PER_CHAPTER + index + 1;
}

/** Chapter results -> [{ n, chapter, index, def, file, chapterTitle }] sorted by n. */
function flatten(chapters) {
  const out = [];
  for (const ch of chapters) {
    if (ch.chapter == null) continue;
    ch.levels.forEach((def, index) => {
      if (index >= LEVELS_PER_CHAPTER) return; // over-full chapter: reported as an error elsewhere
      out.push({ n: levelNumber(ch.chapter, index), chapter: ch.chapter, index, def, file: ch.file, chapterTitle: ch.title });
    });
  }
  out.sort((a, b) => a.n - b.n);
  return out;
}

function loadAllLevels(dir) {
  const { chapters, problems } = loadChapters(dir);
  return { chapters, problems, levels: flatten(chapters) };
}

function findLevel(n, dir) {
  return loadAllLevels(dir).levels.find((e) => e.n === n) || null;
}

/**
 * Resolve the common CLI level argument:
 *   <levelNumber>                    from levels/src (or --src dir)
 *   <file.json> [--index k]          a chapter file (k is 0-based, default 0)
 *   <level.json>                     a bare level object file (number from --n, optional)
 * Throws an Error with a readable message on failure.
 */
function resolveLevelArg(pos, flags) {
  if (pos == null) throw new Error('missing level: give a level number or a chapter file');
  const s = String(pos);
  if (/^\d+$/.test(s)) {
    const n = +s;
    const { levels, problems } = loadAllLevels(flags.src);
    const e = levels.find((x) => x.n === n);
    if (!e) {
      const errs = problems.filter((p) => p.severity === 'error').map((p) => p.msg);
      throw new Error('level ' + n + ' not found in ' + displayPath(path.resolve(flags.src || SRC_DIR)) +
        (levels.length ? ' (have ' + levels.map((x) => x.n).join(',') + ')' : ' (no levels)') +
        (errs.length ? '\n' + errs.join('\n') : ''));
    }
    return e;
  }
  const file = path.resolve(s);
  if (!fs.existsSync(file)) throw new Error('no such file: ' + s);
  const ch = readChapterFile(file);
  const err = ch.problems.find((p) => p.severity === 'error' && /invalid JSON|expected \{/.test(p.msg));
  if (err) throw new Error(err.msg);
  const index = flags.index != null ? +flags.index : 0;
  if (!Number.isInteger(index) || index < 0 || index >= ch.levels.length) {
    throw new Error(path.basename(file) + ' has ' + ch.levels.length + ' level(s); --index must be 0..' + (ch.levels.length - 1));
  }
  let n = null;
  if (flags.n != null) n = +flags.n;
  else if (!ch.single && ch.chapter != null) n = levelNumber(ch.chapter, index);
  return { n, chapter: ch.chapter, index, def: ch.levels[index], file, chapterTitle: ch.title };
}

// ---------------------------------------------------------------------------
// Argument parsing

/**
 * Minimal flag parser. spec = { values: ['time', ...], bools: ['show', ...] }.
 * Accepts --k v, --k=v and -h. Unknown flags throw.
 */
function parseArgs(argv, spec) {
  const values = new Set(spec.values || []);
  const bools = new Set(spec.bools || []);
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.flags.help = true; continue; }
    if (a.startsWith('--')) {
      let k = a.slice(2), v;
      const eq = k.indexOf('=');
      if (eq >= 0) { v = k.slice(eq + 1); k = k.slice(0, eq); }
      if (values.has(k)) {
        if (v === undefined) {
          if (i + 1 >= argv.length) throw new Error('--' + k + ' needs a value');
          v = argv[++i];
        }
        out.flags[k] = v;
      } else if (bools.has(k)) {
        out.flags[k] = v === undefined ? true : !/^(0|false|no)$/i.test(v);
      } else {
        throw new Error('unknown option --' + k);
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function numFlag(flags, k, dflt) {
  if (flags[k] == null) return dflt;
  const v = Number(flags[k]);
  if (!Number.isFinite(v)) throw new Error('--' + k + ' must be a number');
  return v;
}

function listFlag(flags, k) {
  if (flags[k] == null || flags[k] === true) return [];
  return String(flags[k]).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Run a CLI main() with friendly error reporting. */
function runCli(main) {
  try {
    const code = main(process.argv.slice(2));
    if (code && typeof code.then === 'function') {
      code.then((c) => { process.exitCode = c || 0; }, (e) => { console.error('error: ' + e.message); process.exitCode = 2; });
    } else {
      process.exitCode = code || 0;
    }
  } catch (e) {
    console.error('error: ' + (process.env.WB_DEBUG ? e.stack : e.message));
    process.exitCode = 2;
  }
}

// ---------------------------------------------------------------------------
// Level facts

function isFloorish(ch) { return WB.isFloorish(ch); }

/** Rooms = connected components of floor-ish cells, 4-connectivity; walls separate. */
function countRooms(def) {
  const map = def.map || [];
  const h = map.length, w = h ? map[0].length : 0;
  const seen = new Uint8Array(w * h);
  let rooms = 0;
  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !isFloorish(map[y][x])) continue;
      rooms++;
      seen[y * w + x] = 1;
      stack.push(x, y);
      while (stack.length) {
        const cy = stack.pop(), cx = stack.pop();
        for (let d = 0; d < 4; d++) {
          const nx = cx + WB.DX[d], ny = cy + WB.DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const i = ny * w + nx;
          if (seen[i] || !isFloorish(map[ny][nx])) continue;
          seen[i] = 1;
          stack.push(nx, ny);
        }
      }
    }
  }
  return rooms;
}

function inventoryTotal(inv) {
  let t = 0;
  for (const k of Object.keys(inv || {})) t += inv[k] | 0;
  return t;
}

/** Object counts by type, e.g. { pinwheel: 2, candle: 1 }. */
function objectCounts(def) {
  const counts = {};
  for (const row of def.map || []) {
    for (const ch of row) {
      const t = WB.OBJECT_BY_CHAR[ch];
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
  }
  return counts;
}

function levelFacts(def) {
  const map = def.map || [];
  const oc = objectCounts(def);
  let objects = 0, hazards = 0;
  for (const k of Object.keys(oc)) {
    objects += oc[k];
    if (HAZARD_TYPES.includes(k)) hazards += oc[k];
  }
  return {
    w: map.length ? map[0].length : 0,
    h: map.length,
    rooms: countRooms(def),
    inv: inventoryTotal(def.inventory),
    ref: (def.solution || []).length,
    objects,
    hazards,
    stoves: oc.stove || 0,
    objectCounts: oc,
    wind: windShort(def.wind)
  };
}

// ---------------------------------------------------------------------------
// Formatting

function windShort(wind) {
  if (!wind || !(wind.strength > 0)) return 'calm';
  return String(wind.from).toUpperCase() + wind.strength;
}

function windLong(wind) {
  if (!wind || !(wind.strength > 0)) return 'calm';
  return 'from ' + String(wind.from).toUpperCase() + ', strength ' + wind.strength;
}

function inventoryString(inv) {
  const keys = WB.TOOL_ORDER.filter((k) => (inv || {})[k] > 0);
  for (const k of Object.keys(inv || {})) if (!keys.includes(k) && inv[k] > 0) keys.push(k);
  return keys.length ? keys.map((k) => k + ' ' + inv[k]).join(', ') : '(none)';
}

/** Piece as written in level JSON: d only for rotatable tools. */
function cleanPiece(p) {
  const out = { type: p.type, x: p.x | 0, y: p.y | 0 };
  const t = WB.TOOLS[p.type];
  if ((t && t.rotations > 1) || (p.d | 0) !== 0) out.d = p.d | 0;
  return out;
}

function pieceOrder(a, b) {
  const ta = WB.TOOL_ORDER.indexOf(a.type), tb = WB.TOOL_ORDER.indexOf(b.type);
  return ta - tb || a.y - b.y || a.x - b.x || (a.d | 0) - (b.d | 0);
}

function sortPieces(list) {
  return list.map(cleanPiece).sort(pieceOrder);
}

const ROT_SUFFIX = {
  fan: ['N', 'E', 'S', 'W'],
  deflector: ['/', '\\']
};

/** "window 8,2", "fan 3,4 E", "deflector 2,2 /". */
function pieceShort(p) {
  const r = ROT_SUFFIX[p.type];
  return p.type + ' ' + p.x + ',' + p.y + (r ? ' ' + r[p.d | 0] : '');
}

function piecesShort(list) {
  return list.length ? list.map(pieceShort).join(' | ') : '(no pieces)';
}

/** Accept d as 0..3 or 'N'/'E'/'S'/'W' (fans) or '/' '\' (deflectors). */
function parsePieceList(json) {
  let arr;
  try { arr = JSON.parse(json); } catch (e) { throw new Error('--pieces is not valid JSON: ' + e.message); }
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map((p, i) => {
    if (!p || typeof p !== 'object' || !p.type) throw new Error('--pieces[' + i + '] needs a "type"');
    let d = p.d == null ? 0 : p.d;
    if (typeof d === 'string') {
      const s = d.toUpperCase();
      d = s === '/' ? 0 : s === '\\' ? 1 : WB.DIR_NAMES.indexOf(s);
      if (d < 0) throw new Error('--pieces[' + i + ']: bad rotation ' + JSON.stringify(p.d));
    }
    return { type: p.type, x: p.x | 0, y: p.y | 0, d: d | 0 };
  });
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function trunc(s, n) { s = String(s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

function levelLabel(e) {
  return (e.n != null ? '#' + e.n : '#?') + ' "' + ((e.def && e.def.name) || '') + '"';
}

module.exports = {
  ROOT, SRC_DIR, WB, LEVELS_PER_CHAPTER, LEVEL_KEYS, HAZARD_TYPES,
  readJson, jsonErrorOffset, displayPath, readChapterFile, loadChapters, flatten, loadAllLevels, findLevel, levelNumber,
  resolveLevelArg, parseArgs, numFlag, listFlag, runCli,
  countRooms, inventoryTotal, objectCounts, levelFacts,
  windShort, windLong, inventoryString, cleanPiece, pieceOrder, sortPieces,
  pieceShort, piecesShort, parsePieceList, pad, lpad, trunc, levelLabel
};
