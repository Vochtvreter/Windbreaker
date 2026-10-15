/*
 * Windbreaker — rules and airflow simulation.
 * Implements DESIGN.md. No DOM, no dependencies.
 * Browser: defines window.WB. Node: module.exports = WB.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.WB = Object.assign(root.WB || {}, api);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DX = [0, 1, 0, -1];
  var DY = [-1, 0, 1, 0];
  var DIR_NAMES = ['N', 'E', 'S', 'W'];

  var TOOL_ORDER = [
    'window', 'fan', 'deflector', 'curtain', 'vent',
    'splitter', 'extractor', 'skylight', 'filter', 'ceilingfan'
  ];

  var TOOLS = {
    window: {
      name: 'Window', mount: 'exterior', rotations: 1,
      desc: 'Fits in an outside wall. Facing the wind, it lets a breeze in, but only if the air has a way out. Anywhere else, it lets air out.'
    },
    fan: {
      name: 'Fan', mount: 'floor', rotations: 4,
      desc: 'Blows a gentle breeze the way it faces. Air that reaches it gets pushed along too. Tap to turn it.'
    },
    deflector: {
      name: 'Deflector', mount: 'floor', rotations: 2,
      desc: 'Turns airflow by 90 degrees. Tap to flip it.'
    },
    curtain: {
      name: 'Curtain', mount: 'floor', rotations: 1,
      desc: 'Softens airflow passing through it by 1. A gentle breeze stops here.'
    },
    vent: {
      name: 'Wall vent', mount: 'interior', rotations: 1,
      desc: 'Fits in an inside wall and lets air pass straight through it.'
    },
    splitter: {
      name: 'Splitter', mount: 'floor', rotations: 1,
      desc: 'Splits airflow into two streams, left and right, each half as strong (but at least 1).'
    },
    extractor: {
      name: 'Extractor', mount: 'exterior', rotations: 1,
      desc: 'Fits in any outside wall, even one facing the wind. Lets air out, and pulls a gentle breeze toward itself.'
    },
    skylight: {
      name: 'Skylight', mount: 'floor', rotations: 1,
      desc: 'Air that reaches it escapes through the roof.'
    },
    filter: {
      name: 'Air filter', mount: 'floor', rotations: 1,
      desc: 'Cleans the smoke out of air passing through it.'
    },
    ceilingfan: {
      name: 'Ceiling fan', mount: 'floor', rotations: 1,
      desc: 'Pushes a gentle breeze out in all four directions. Air passes beneath it unchanged.'
    }
  };
  TOOL_ORDER.forEach(function (id, i) {
    TOOLS[id].id = id;
    TOOLS[id].intro = 1 + 5 * i;
  });

  var OBJECT_ORDER = ['pinwheel', 'candle', 'stove', 'laundry', 'papers', 'fern'];
  var OBJECTS = {
    pinwheel: { char: 'p', name: 'Pinwheel', intro: 1, desc: 'Needs a breeze.' },
    candle: { char: 'c', name: 'Candle', intro: 3, desc: 'Keep it out of any airflow.' },
    stove: { char: 's', name: 'Stove', intro: 8, desc: 'Its smoke must be blown outside or through a filter, never into a wall.' },
    laundry: { char: 'l', name: 'Laundry', intro: 13, desc: 'Needs a strong breeze (2 or more).' },
    papers: { char: 'n', name: 'Papers', intro: 18, desc: 'A gentle breeze is fine, but no more than 1.' },
    fern: { char: 'f', name: 'Fern', intro: 23, desc: 'Wants exactly a gentle breeze (1).' }
  };
  var OBJECT_BY_CHAR = {};
  OBJECT_ORDER.forEach(function (id) {
    OBJECTS[id].id = id;
    OBJECT_BY_CHAR[OBJECTS[id].char] = id;
  });

  var MAX_W = 13;
  var MAX_H = 10;
  var CALM_INTRO = 6;
  var WIND2_INTRO = 13;
  var WIND3_INTRO = 26;

  // ---------------------------------------------------------------------
  // Cells

  function isOutside(ch) { return ch === '~'; }
  function isWall(ch) { return ch === '#' || ch === '%'; }
  function isFloorish(ch) { return ch === '.' || ch === 'o' || OBJECT_BY_CHAR.hasOwnProperty(ch); }
  function isKnownChar(ch) { return isOutside(ch) || isWall(ch) || isFloorish(ch); }

  function cellAt(L, x, y) {
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return '~';
    return L.cells[y * L.w + x];
  }

  function dirIndex(v) {
    if (typeof v === 'number') return v >= 0 && v < 4 ? v | 0 : -1;
    var i = DIR_NAMES.indexOf(String(v).toUpperCase());
    return i;
  }

  // ---------------------------------------------------------------------
  // Levels

  function normPiece(p) {
    return { type: p.type, x: p.x | 0, y: p.y | 0, d: (p.d | 0) };
  }

  function parseLevel(def) {
    var map = def.map || [];
    var h = map.length;
    var w = h ? map[0].length : 0;
    var cells = [];
    var objects = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = map[y].charAt(x) || '~';
        cells.push(ch);
        if (OBJECT_BY_CHAR.hasOwnProperty(ch)) {
          objects.push({ id: objects.length, type: OBJECT_BY_CHAR[ch], x: x, y: y });
        }
      }
    }
    var windDef = def.wind || { from: 'W', strength: 0 };
    var strength = windDef.strength | 0;
    var from = dirIndex(windDef.from == null ? 'W' : windDef.from);
    if (from < 0) from = 3;
    return {
      def: def,
      name: def.name || '',
      tip: def.tip || '',
      w: w,
      h: h,
      cells: cells,
      objects: objects,
      stoves: objects.filter(function (o) { return o.type === 'stove'; }),
      fixed: (def.fixed || []).map(normPiece),
      inventory: Object.assign({}, def.inventory || {}),
      wind: { from: from, dir: (from + 2) % 4, strength: strength }
    };
  }

  function outwardDir(L, x, y) {
    if (cellAt(L, x, y) !== '#') return -1;
    for (var o = 0; o < 4; o++) {
      if (isOutside(cellAt(L, x + DX[o], y + DY[o])) &&
          isFloorish(cellAt(L, x - DX[o], y - DY[o]))) {
        return o;
      }
    }
    return -1;
  }

  function isInteriorMount(L, x, y) {
    if (cellAt(L, x, y) !== '#') return false;
    for (var d = 0; d < 4; d++) {
      if (isOutside(cellAt(L, x + DX[d], y + DY[d]))) return false;
    }
    var we = isFloorish(cellAt(L, x - 1, y)) && isFloorish(cellAt(L, x + 1, y));
    var ns = isFloorish(cellAt(L, x, y - 1)) && isFloorish(cellAt(L, x, y + 1));
    return we || ns;
  }

  function pieceAtXY(pieces, x, y) {
    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].x === x && pieces[i].y === y) return pieces[i];
    }
    return null;
  }

  function mountOk(L, type, x, y) {
    var t = TOOLS[type];
    if (!t) return false;
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return false;
    if (t.mount === 'floor') return cellAt(L, x, y) === '.';
    if (t.mount === 'exterior') return outwardDir(L, x, y) >= 0;
    if (t.mount === 'interior') return isInteriorMount(L, x, y);
    return false;
  }

  function canPlace(L, pieces, type, x, y) {
    return mountOk(L, type, x, y) && !pieceAtXY(pieces || [], x, y);
  }

  function placementCells(L, pieces, type) {
    var out = [];
    for (var y = 0; y < L.h; y++) {
      for (var x = 0; x < L.w; x++) {
        if (canPlace(L, pieces, type, x, y)) out.push({ x: x, y: y });
      }
    }
    return out;
  }

  function windowRole(L, piece) {
    if (L.wind.strength > 0 && outwardDir(L, piece.x, piece.y) === L.wind.from) return 'inlet';
    return 'outlet';
  }

  function rotate(type, d) {
    var r = TOOLS[type] ? TOOLS[type].rotations : 1;
    return ((d | 0) + 1) % r;
  }

  function validateLevel(def) {
    var errors = [];
    if (!def || !Array.isArray(def.map) || def.map.length === 0) {
      return ['map is missing or empty'];
    }
    var w = def.map[0].length;
    def.map.forEach(function (row, y) {
      if (typeof row !== 'string') errors.push('row ' + y + ' is not a string');
      else if (row.length !== w) errors.push('row ' + y + ' has length ' + row.length + ', expected ' + w);
    });
    if (errors.length) return errors;
    if (w > MAX_W || def.map.length > MAX_H) {
      errors.push('map is ' + w + 'x' + def.map.length + ', max ' + MAX_W + 'x' + MAX_H);
    }
    var L = parseLevel(def);
    for (var y = 0; y < L.h; y++) {
      for (var x = 0; x < L.w; x++) {
        var ch = cellAt(L, x, y);
        if (!isKnownChar(ch)) errors.push('unknown char "' + ch + '" at ' + x + ',' + y);
        if (isFloorish(ch)) {
          for (var d = 0; d < 4; d++) {
            if (isOutside(cellAt(L, x + DX[d], y + DY[d]))) {
              errors.push('floor at ' + x + ',' + y + ' touches outside (map not sealed)');
              break;
            }
          }
        }
      }
    }
    if (L.objects.length === 0) errors.push('level has no objects');

    var wind = def.wind;
    if (!wind || typeof wind.strength !== 'number' || wind.strength < 0 || wind.strength > 3 || (wind.strength | 0) !== wind.strength) {
      errors.push('wind.strength must be an integer 0..3');
    } else if (wind.strength > 0 && dirIndex(wind.from) < 0) {
      errors.push('wind.from must be one of N, E, S, W');
    }

    var inv = def.inventory || {};
    Object.keys(inv).forEach(function (k) {
      if (!TOOLS[k]) errors.push('unknown tool in inventory: ' + k);
      else if (!(inv[k] >= 0) || (inv[k] | 0) !== inv[k]) errors.push('inventory count for ' + k + ' must be a non-negative integer');
    });

    var placed = [];
    function checkPiece(p, label) {
      if (!p || !TOOLS[p.type]) {
        errors.push(label + ': unknown tool ' + (p && p.type));
        return;
      }
      var d = p.d | 0;
      if (d < 0 || d >= TOOLS[p.type].rotations) errors.push(label + ': rotation ' + d + ' invalid for ' + p.type);
      if (!mountOk(L, p.type, p.x, p.y)) errors.push(label + ': ' + p.type + ' cannot be mounted at ' + p.x + ',' + p.y);
      else if (pieceAtXY(placed, p.x, p.y)) errors.push(label + ': ' + p.type + ' overlaps another piece at ' + p.x + ',' + p.y);
      placed.push(normPiece(p));
    }
    (def.fixed || []).forEach(function (p, i) { checkPiece(p, 'fixed[' + i + ']'); });
    var used = {};
    (def.solution || []).forEach(function (p, i) {
      checkPiece(p, 'solution[' + i + ']');
      if (p && p.type) used[p.type] = (used[p.type] || 0) + 1;
    });
    Object.keys(used).forEach(function (k) {
      if (used[k] > (inv[k] || 0)) errors.push('solution uses ' + used[k] + ' ' + k + ' but inventory has ' + (inv[k] || 0));
    });
    return errors;
  }

  // Errors about tools/objects/wind used before they are introduced (n = 1-based level number).
  function introErrors(def, n) {
    var errors = [];
    var L = parseLevel(def);
    function toolOk(t) { return TOOLS[t] && TOOLS[t].intro <= n; }
    Object.keys(def.inventory || {}).forEach(function (t) {
      if ((def.inventory[t] || 0) > 0 && !toolOk(t)) errors.push('tool ' + t + ' not introduced until level ' + (TOOLS[t] ? TOOLS[t].intro : '?'));
    });
    (def.fixed || []).forEach(function (p) {
      if (!toolOk(p.type)) errors.push('fixed ' + p.type + ' not introduced until level ' + (TOOLS[p.type] ? TOOLS[p.type].intro : '?'));
    });
    L.objects.forEach(function (o) {
      if (OBJECTS[o.type].intro > n) errors.push('object ' + o.type + ' not introduced until level ' + OBJECTS[o.type].intro);
    });
    var s = L.wind.strength;
    if (s === 0 && n < CALM_INTRO) errors.push('calm wind not allowed before level ' + CALM_INTRO);
    if (s === 2 && n < WIND2_INTRO) errors.push('wind strength 2 not allowed before level ' + WIND2_INTRO);
    if (s === 3 && n < WIND3_INTRO) errors.push('wind strength 3 not allowed before level ' + WIND3_INTRO);
    return errors;
  }

  // ---------------------------------------------------------------------
  // Simulation
  //
  // This is the hot path: the level tools call simulate()/isSolved() millions
  // of times. Tracing therefore runs on flat typed arrays in module-level
  // scratch buffers: a state (x, y, d, s, smoke) is an integer key into a
  // generation-stamped lookup table, the BFS queue and the state graph are
  // parallel typed arrays, and nothing is allocated per state except the
  // segment/end objects of the returned Result. The results are identical to
  // the plain implementation kept in tests/fixtures/engine-reference.js (a
  // randomized differential test in tests/engine.test.js checks this).
  //
  // isSolved() runs the same trace without building trees, segments, ends or
  // goal objects, so it is the cheapest way to ask "is this solved?".

  var T_WINDOW = 1, T_FAN = 2, T_DEFLECTOR = 3, T_CURTAIN = 4, T_VENT = 5,
    T_SPLITTER = 6, T_EXTRACTOR = 7, T_SKYLIGHT = 8, T_FILTER = 9, T_CEILINGFAN = 10;
  var TYPE_CODE = Object.create(null);
  TOOL_ORDER.forEach(function (id, i) { TYPE_CODE[id] = i + 1; });

  // Cell kinds. K_OTHER (an unknown character) behaves like floor while
  // tracing but is not floor-ish (for mounts and extractor pull lines).
  var K_OUT = 0, K_WALL = 1, K_SOLID = 2, K_FLOOR = 3, K_OTHER = 4;
  var KIND_BY_CODE = new Uint8Array(128);
  (function () {
    var i;
    for (i = 0; i < 128; i++) KIND_BY_CODE[i] = K_OTHER;
    KIND_BY_CODE[126] = K_OUT; // '~'
    KIND_BY_CODE[35] = K_WALL; // '#'
    KIND_BY_CODE[37] = K_SOLID; // '%'
    var fl = '.o' + OBJECT_ORDER.map(function (id) { return OBJECTS[id].char; }).join('');
    for (i = 0; i < fl.length; i++) KIND_BY_CODE[fl.charCodeAt(i)] = K_FLOOR;
  })();
  function cellKind(ch) {
    if (typeof ch === 'string' && ch.length === 1) {
      var c = ch.charCodeAt(0);
      if (c < 128) return KIND_BY_CODE[c];
    }
    return isOutside(ch) ? K_OUT : ch === '#' ? K_WALL : ch === '%' ? K_SOLID : isFloorish(ch) ? K_FLOOR : K_OTHER;
  }

  var TERM_OUTLET = 1, TERM_BLOCKED = 2;
  // Deflector turns: REFLECT[(d === 0 ? 0 : 4) + incoming direction]
  var REFLECT = new Int8Array([1, 0, 3, 2, 3, 2, 1, 0]);
  var KEY_TABLE_LIMIT = 1 << 20; // larger state spaces fall back to a Map

  // Scratch buffers, grown on demand and reused across calls.
  var SC = {
    cellCap: 0, kind: null, stoveAt: null, pgrid: null, tflowI: null, tflowF: null, tstamp: null, touched: null, flow: null,
    pieceCap: 0, ptype: null, px: null, py: null, pd: null, pinlet: null,
    keyCap: 0, kstamp: null, knode: null,
    gen: 0,
    qCap: 0, qx: null, qy: null, qd: null, qsI: null, qsF: null, qm: null, qp: null, qfx: null, qfy: null, qdist: null,
    nodeCap: 0, nm: null, nterm: null, nn0: null, nn1: null, tidx: null, tlow: null, tstk: null, ton: null, wn: null, we: null
  };
  function grown(Ctor, old, n) {
    var a = new Ctor(n);
    if (old) a.set(old.length > n ? old.subarray(0, n) : old);
    return a;
  }
  function ensureCells(n) {
    if (SC.cellCap >= n) return;
    var c = Math.max(n, 256);
    SC.kind = new Uint8Array(c); SC.stoveAt = new Int32Array(c); SC.pgrid = new Int32Array(c);
    SC.tflowI = new Int32Array(c); SC.tflowF = new Float64Array(c);
    SC.tstamp = new Int32Array(c); SC.touched = new Int32Array(c);
    SC.flow = new Int32Array(c);
    SC.cellCap = c;
    lvL = null; // the cached cell kinds lived in the old array
  }
  function ensurePieces(n) {
    if (SC.pieceCap >= n) return;
    var c = Math.max(n, 2 * SC.pieceCap, 32);
    SC.ptype = new Uint8Array(c); SC.px = new Int32Array(c); SC.py = new Int32Array(c);
    SC.pd = new Int32Array(c); SC.pinlet = new Uint8Array(c);
    SC.pieceCap = c;
  }
  function ensureKeys(n) {
    if (SC.keyCap >= n) return;
    var c = Math.max(n, 2 * SC.keyCap, 4096);
    SC.kstamp = new Int32Array(c); SC.knode = new Int32Array(c);
    SC.keyCap = c;
  }
  function growQueue() {
    var c = Math.max(2 * SC.qCap, 256);
    SC.qx = grown(Int32Array, SC.qx, c); SC.qy = grown(Int32Array, SC.qy, c); SC.qd = grown(Int8Array, SC.qd, c);
    SC.qsI = grown(Int32Array, SC.qsI, c); SC.qsF = grown(Float64Array, SC.qsF, c); SC.qm = grown(Int32Array, SC.qm, c); SC.qp = grown(Int32Array, SC.qp, c);
    SC.qfx = grown(Float64Array, SC.qfx, c); SC.qfy = grown(Float64Array, SC.qfy, c); SC.qdist = grown(Float64Array, SC.qdist, c);
    SC.qCap = c;
  }
  function growNodes() {
    var c = Math.max(2 * SC.nodeCap, 256);
    SC.nm = grown(Int32Array, SC.nm, c); SC.nterm = grown(Uint8Array, SC.nterm, c);
    SC.nn0 = grown(Int32Array, SC.nn0, c); SC.nn1 = grown(Int32Array, SC.nn1, c);
    SC.tidx = new Int32Array(c); SC.tlow = new Int32Array(c); SC.tstk = new Int32Array(c);
    SC.ton = new Uint8Array(c); SC.wn = new Int32Array(c); SC.we = new Int8Array(c);
    SC.nodeCap = c;
  }
  function nextGen() {
    if (SC.gen >= 0x3fffffff) {
      SC.gen = 0;
      if (SC.kstamp) SC.kstamp.fill(0);
      if (SC.tstamp) SC.tstamp.fill(0);
    }
    return ++SC.gen;
  }
  growQueue();
  growNodes();

  // Cell kinds of the most recent level. Re-used only when the level, its
  // cells array and every cell are unchanged (cells may be edited in place).
  var lvL = null, lvCells = null, lvN = -1, lvCopy = [];
  function prepareKinds(L, N) {
    var cells = L.cells, i;
    if (lvL === L && lvCells === cells && lvN === N) {
      for (i = 0; i < N; i++) if (cells[i] !== lvCopy[i]) break;
      if (i === N) return;
    }
    var kind = SC.kind;
    for (i = 0; i < N; i++) { var ch = cells[i]; lvCopy[i] = ch; kind[i] = cellKind(ch); }
    lvL = L; lvCells = cells; lvN = N;
  }

  // The flow array of a Result. Typed arrays over 64 bytes are slow to
  // allocate one by one (off-heap backing store), so small ones are carved
  // out of a shared slab; every Result still gets its own, zeroed region.
  var SLAB_BYTES = 8192, slab = null, slabOff = SLAB_BYTES;
  function newFlowArray(n) {
    var bytes = n * 4;
    if (bytes > 1024) return new Int32Array(n);
    if (slabOff + bytes > SLAB_BYTES) { slab = new ArrayBuffer(SLAB_BYTES); slabOff = 0; }
    var a = new Int32Array(slab, slabOff, n);
    slabOff += bytes;
    return a;
  }

  // Per-call context shared by run() and traceTree().
  var cx_W = 0, cx_H = 0, cx_table = true, cx_SK = 64, cx_MS = 1, cx_nStoves = 0;
  // Per-tree results of traceTree().
  var tr_outlet = false, tr_reached = 0, tr_failed = 0, tr_touched = 0;

  // outwardDir() on the kind array.
  function outDirK(kind, W, H, x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H || kind[y * W + x] !== K_WALL) return -1;
    for (var o = 0; o < 4; o++) {
      var ax = x + DX[o], ay = y + DY[o];
      if (ax >= 0 && ay >= 0 && ax < W && ay < H && kind[ay * W + ax] !== K_OUT) continue;
      var bx = x - DX[o], by = y - DY[o];
      if (bx >= 0 && by >= 0 && bx < W && by < H && kind[by * W + bx] === K_FLOOR) return o;
    }
    return -1;
  }

  // Trace one source whose qt start states are already in the queue.
  // Fills SC.tflow/SC.touched (stamped with the tree's generation) and the
  // tr_* results; with `full`, appends segments and ends.
  function traceTree(qt, full, segs, ends) {
    var W = cx_W, H = cx_H, W2 = W + 2, SK = cx_SK, MS = cx_MS, table = cx_table;
    var kind = SC.kind, pgrid = SC.pgrid, stoveAt = SC.stoveAt;
    var ptype = SC.ptype, pd = SC.pd, pinlet = SC.pinlet;
    var tflow = table ? SC.tflowI : SC.tflowF, tstamp = SC.tstamp, touched = SC.touched;
    var kstamp = SC.kstamp, knode = SC.knode;
    var qCap = SC.qCap, qx = SC.qx, qy = SC.qy, qd = SC.qd, qs = table ? SC.qsI : SC.qsF, qm = SC.qm, qp = SC.qp;
    var qfx = SC.qfx, qfy = SC.qfy, qdist = SC.qdist;
    var nm = SC.nm, nterm = SC.nterm, nn0 = SC.nn0, nn1 = SC.nn1;
    var kmap = table ? null : new Map();
    var gen = nextGen();
    var nNodes = 0, nTouched = 0, reached = 0, failed = 0, outlet = false, merges = 0;
    var head = 0;

    while (head < qt) {
      var qi = head++;
      var x = qx[qi], y = qy[qi], d = qd[qi], s = qs[qi], m = qm[qi], par = qp[qi];
      var inb = x >= 0 && y >= 0 && x < W && y < H;
      var ci = inb ? y * W + x : -1;
      var kc = inb ? kind[ci] : K_OUT;
      var pi = inb ? pgrid[ci] : -1;
      var pt = pi >= 0 ? ptype[pi] : 0;
      var isWallCell = kc === K_WALL || kc === K_SOLID;
      var term = 0, face = 0; // face: +1 = beyond the wall centre, -1 = at the wall face
      if (kc === K_OUT) {
        term = TERM_OUTLET;
      } else if (isWallCell && pt !== T_VENT) {
        if ((pt === T_WINDOW && pinlet[pi] === 0) || pt === T_EXTRACTOR) { term = TERM_OUTLET; face = 1; }
        else { term = TERM_BLOCKED; face = -1; }
      }

      var cx = 0, cy = 0, endX = 0, endY = 0, dist = 0;
      if (full) {
        cx = x + 0.5; cy = y + 0.5; endX = cx; endY = cy;
        if (face === 1) { endX = cx + 0.5 * DX[d]; endY = cy + 0.5 * DY[d]; }
        else if (face === -1) { endX = cx - 0.5 * DX[d]; endY = cy - 0.5 * DY[d]; }
        var fx = qfx[qi], fy = qfy[qi], d0 = qdist[qi];
        segs.push({ ax: fx, ay: fy, bx: endX, by: endY, s: s, smoke: m !== 0, dist: d0 });
        dist = d0 + (Math.abs(endX - fx) + Math.abs(endY - fy));
      }

      var key = ((((y + 1) * W2 + (x + 1)) * 4 + d) * SK + (s > 63 ? 63 : s)) * MS + m;
      var node;
      if (table) {
        node = kstamp[key] === gen ? knode[key] : -1;
      } else {
        node = kmap.get(key);
        if (node === undefined) node = -1;
      }
      var isNew = node < 0;
      if (isNew) node = nNodes;
      if (par >= 0) {
        if (nn0[par] < 0) nn0[par] = node; else nn1[par] = node;
      }
      if (!isNew) { // merges into flow that is already traced
        if (par >= 0) merges++;
        continue;
      }

      if (nNodes === SC.nodeCap) {
        growNodes();
        nm = SC.nm; nterm = SC.nterm; nn0 = SC.nn0; nn1 = SC.nn1;
      }
      nNodes++;
      if (table) { kstamp[key] = gen; knode[key] = node; } else kmap.set(key, node);
      nm[node] = m; nterm[node] = 0; nn0[node] = -1; nn1[node] = -1;

      if (term !== 0) {
        nterm[node] = term;
        if (term === TERM_OUTLET) outlet = true; else failed |= m;
        if (full) ends.push({ x: endX, y: endY, type: term === TERM_OUTLET ? 'outlet' : 'blocked' });
        continue;
      }

      var nsucc = 1, nd0 = d, nd1 = 0, ns = s;
      if (!isWallCell) {
        // floor-ish: record flow (per tree: max), pick up smoke, apply the piece
        if (tstamp[ci] !== gen) { tstamp[ci] = gen; tflow[ci] = s; touched[nTouched++] = ci; }
        else if (s > tflow[ci]) tflow[ci] = s;
        var si = stoveAt[ci];
        if (si >= 0) {
          var bit = 1 << si;
          m |= bit; reached |= bit;
          nm[node] = m;
        }
        if (pt === T_FAN) {
          nd0 = pd[pi] & 3;
        } else if (pt === T_DEFLECTOR) {
          nd0 = REFLECT[(pd[pi] === 0 ? 0 : 4) + d];
        } else if (pt === T_CURTAIN) {
          if (s - 1 <= 0) {
            nterm[node] = TERM_BLOCKED;
            failed |= m;
            if (full) ends.push({ x: cx, y: cy, type: 'blocked' });
            continue;
          }
          ns = s - 1;
        } else if (pt === T_SPLITTER) {
          ns = Math.max(1, Math.floor(s / 2));
          nd0 = (d + 1) % 4; nd1 = (d + 3) % 4; nsucc = 2;
        } else if (pt === T_SKYLIGHT) {
          nterm[node] = TERM_OUTLET;
          outlet = true;
          if (full) ends.push({ x: cx, y: cy, type: 'outlet' });
          continue;
        } else if (pt === T_FILTER) {
          m = 0;
        }
      } // else: a vent, straight on

      for (var k = 0; k < nsucc; k++) {
        var nd = k === 0 ? nd0 : nd1;
        if (qt === qCap) {
          growQueue();
          qCap = SC.qCap; qx = SC.qx; qy = SC.qy; qd = SC.qd; qs = table ? SC.qsI : SC.qsF; qm = SC.qm; qp = SC.qp;
          qfx = SC.qfx; qfy = SC.qfy; qdist = SC.qdist;
        }
        qx[qt] = x + DX[nd]; qy[qt] = y + DY[nd]; qd[qt] = nd; qs[qt] = ns; qm[qt] = m; qp[qt] = node;
        if (full) { qfx[qt] = cx; qfy[qt] = cy; qdist[qt] = dist; }
        qt++;
      }
    }

    // Smoke going round a loop (without passing a filter) never leaves.
    // Without merge edges the state graph is a forest, so there is no cycle.
    if (cx_nStoves && reached && merges) failed |= cycleSmoke(nNodes, reached);

    tr_outlet = outlet; tr_reached = reached; tr_failed = failed; tr_touched = nTouched;
  }

  // Mask of stoves whose smoke is trapped circling: stove b is trapped when the
  // states carrying b's smoke contain a directed cycle among themselves. A loop
  // that passes through a filter is broken (the states after the filter are
  // clean), so filtered loops are fine. Iterative Tarjan SCC per stove bit,
  // restricted to states whose mask has that bit (each state has <= 2 successors).
  function cycleSmoke(n, reached) {
    var nm = SC.nm, nn0 = SC.nn0, nn1 = SC.nn1;
    var idx = SC.tidx, low = SC.tlow, stk = SC.tstk, on = SC.ton, wn = SC.wn, we = SC.we;
    var v, w, i, smoke = 0;
    for (var bit = 1; bit <= reached; bit <<= 1) {
      if ((reached & bit) === 0) continue;
      for (i = 0; i < n; i++) { idx[i] = -1; on[i] = 0; }
      var index = 0, sp = 0, wp = 0;
      for (var root = 0; root < n && (smoke & bit) === 0; root++) {
        if (idx[root] >= 0 || (nm[root] & bit) === 0) continue;
        idx[root] = low[root] = index++;
        stk[sp++] = root; on[root] = 1;
        wn[wp] = root; we[wp] = 0; wp++;
        while (wp > 0) {
          v = wn[wp - 1];
          var e = we[wp - 1];
          if (e < 2) {
            we[wp - 1] = e + 1;
            w = e === 0 ? nn0[v] : nn1[v];
            if (w < 0 || (nm[w] & bit) === 0) continue;
            if (idx[w] < 0) {
              idx[w] = low[w] = index++;
              stk[sp++] = w; on[w] = 1;
              wn[wp] = w; we[wp] = 0; wp++;
            } else if (on[w] && idx[w] < low[v]) {
              low[v] = idx[w];
            }
          } else {
            wp--;
            if (wp > 0) {
              var u = wn[wp - 1];
              if (low[v] < low[u]) low[u] = low[v];
            }
            if (low[v] === idx[v]) {
              var size = 0;
              do {
                w = stk[--sp];
                on[w] = 0;
                size++;
              } while (w !== v);
              if (size > 1 || nn0[v] === v || nn1[v] === v) smoke |= bit;
            }
          }
        }
      }
    }
    return smoke;
  }

  function run(L, pieces, full) {
    var W = L.w, H = L.h, N = W * H;
    var i, k;
    pieces = pieces || [];
    var np = pieces.length;
    ensureCells(N);
    ensurePieces(np);
    prepareKinds(L, N);
    var kind = SC.kind, stoveAt = SC.stoveAt, pgrid = SC.pgrid;
    stoveAt.fill(-1, 0, N);
    pgrid.fill(-1, 0, N);
    var stoves = L.stoves, nStoves = stoves.length;
    for (k = 0; k < nStoves; k++) {
      var sx = stoves[k].x, sy = stoves[k].y;
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) stoveAt[sy * W + sx] = k;
    }

    var strength = L.wind.strength, from = L.wind.from, wd = L.wind.dir;
    var ptype = SC.ptype, px = SC.px, py = SC.py, pd = SC.pd, pinlet = SC.pinlet;
    var inside = true;
    for (i = 0; i < np; i++) {
      var p = pieces[i];
      var t = TYPE_CODE[p.type] || 0, x = p.x | 0, y = p.y | 0;
      ptype[i] = t; px[i] = x; py[i] = y; pd[i] = p.d | 0;
      if (x >= 0 && y >= 0 && x < W && y < H) pgrid[y * W + x] = i; else inside = false;
      pinlet[i] = t === T_WINDOW && strength > 0 && outDirK(kind, W, H, x, y) === from ? 1 : 0;
    }

    // State keys: ((cell incl. a 1-cell margin) * 4 + d) * SK + min(s, 63)) * MS + smoke.
    // A typed lookup table when the key space is small (always for real
    // levels), otherwise a Map with exactly the reference engine's keys.
    var MS = 1 << nStoves;
    var SK = Math.min(Math.max(strength, 1), 63) + 1;
    var keySpace = (W + 2) * (H + 2) * 4 * SK * MS;
    var table = inside && nStoves <= 12 && strength === (strength | 0) && wd >= 0 && wd < 4 && wd === (wd | 0) &&
      keySpace <= KEY_TABLE_LIMIT;
    if (table) ensureKeys(keySpace); else SK = 64;
    cx_W = W; cx_H = H; cx_table = table; cx_SK = SK; cx_MS = MS; cx_nStoves = nStoves;

    var flow = full ? newFlowArray(N) : SC.flow;
    if (!full) flow.fill(0, 0, N);
    var trees = full ? [] : null;
    var reachedAll = 0, failedAll = 0;
    var qx = SC.qx, qy = SC.qy, qd = SC.qd, qs = table ? SC.qsI : SC.qsF, qm = SC.qm, qp = SC.qp;
    var qfx = SC.qfx, qfy = SC.qfy, qdist = SC.qdist;

    for (i = 0; i < np; i++) {
      var pt = ptype[i], ox = px[i], oy = py[i], kindName, nStarts = 1;
      if (pt === T_WINDOW) {
        if (!pinlet[i]) continue;
        kindName = 'inlet';
        qx[0] = ox + DX[wd]; qy[0] = oy + DY[wd]; qd[0] = wd; qs[0] = strength;
        qfx[0] = ox + 0.5 - 0.5 * DX[wd]; qfy[0] = oy + 0.5 - 0.5 * DY[wd];
      } else if (pt === T_FAN) {
        var fd = pd[i] & 3;
        kindName = 'fan';
        qx[0] = ox + DX[fd]; qy[0] = oy + DY[fd]; qd[0] = fd; qs[0] = 1;
        qfx[0] = ox + 0.5; qfy[0] = oy + 0.5;
      } else if (pt === T_CEILINGFAN) {
        kindName = 'ceilingfan';
        nStarts = 4;
        for (k = 0; k < 4; k++) {
          qx[k] = ox + DX[k]; qy[k] = oy + DY[k]; qd[k] = k; qs[k] = 1;
          qfx[k] = ox + 0.5; qfy[k] = oy + 0.5;
        }
      } else if (pt === T_EXTRACTOR) {
        var o = outDirK(kind, W, H, ox, oy);
        if (o < 0) continue;
        var inward = (o + 2) % 4, ix = DX[inward], iy = DY[inward];
        var ex = ox + ix, ey = oy + iy;
        if (!(ex >= 0 && ey >= 0 && ex < W && ey < H && kind[ey * W + ex] === K_FLOOR && pgrid[ey * W + ex] < 0)) continue;
        for (;;) {
          var nx = ex + ix, ny = ey + iy;
          if (!(nx >= 0 && ny >= 0 && nx < W && ny < H && kind[ny * W + nx] === K_FLOOR && pgrid[ny * W + nx] < 0)) break;
          ex = nx; ey = ny;
        }
        kindName = 'pull';
        qx[0] = ex; qy[0] = ey; qd[0] = o; qs[0] = 1;
        qfx[0] = ex + 0.5 + 0.5 * ix; qfy[0] = ey + 0.5 + 0.5 * iy;
      } else {
        continue;
      }
      for (k = 0; k < nStarts; k++) { qm[k] = 0; qp[k] = -1; qdist[k] = 0; }

      var segs = full ? [] : null, ends = full ? [] : null;
      traceTree(nStarts, full, segs, ends);
      // traceTree may have grown the queue
      qx = SC.qx; qy = SC.qy; qd = SC.qd; qs = table ? SC.qsI : SC.qsF; qm = SC.qm; qp = SC.qp;
      qfx = SC.qfx; qfy = SC.qfy; qdist = SC.qdist;

      var active = pt !== T_WINDOW || tr_outlet;
      if (active) {
        var touched = SC.touched, tflow = table ? SC.tflowI : SC.tflowF;
        for (k = 0; k < tr_touched; k++) flow[touched[k]] += tflow[touched[k]];
        reachedAll |= tr_reached;
        failedAll |= tr_failed;
      }
      if (full) {
        trees.push({ source: normPiece(pieces[i]), kind: kindName, active: active, segments: segs, ends: ends });
      }
    }

    var objects = L.objects, no = objects.length, ob, f, bit;
    if (!full) {
      if (no === 0) return false;
      for (i = 0; i < no; i++) {
        ob = objects[i];
        f = flow[ob.y * W + ob.x];
        switch (ob.type) {
          case 'pinwheel': if (!(f >= 1)) return false; break;
          case 'laundry': if (!(f >= 2)) return false; break;
          case 'candle': if (f !== 0) return false; break;
          case 'papers': if (!(f <= 1)) return false; break;
          case 'fern': if (f !== 1) return false; break;
          case 'stove':
            bit = 1 << stoveAt[ob.y * W + ob.x];
            if ((reachedAll & bit) === 0 || (failedAll & bit) !== 0) return false;
            break;
        }
      }
      return true;
    }

    var stoveList = [];
    for (k = 0; k < nStoves; k++) {
      bit = 1 << k;
      var r = (reachedAll & bit) !== 0;
      stoveList.push({ x: stoves[k].x, y: stoves[k].y, reached: r, cleared: r && (failedAll & bit) === 0 });
    }
    var goals = [];
    var solved = no > 0;
    for (i = 0; i < no; i++) {
      ob = objects[i];
      f = flow[ob.y * W + ob.x];
      var ok, state;
      switch (ob.type) {
        case 'pinwheel': ok = f >= 1; state = ok ? 'happy' : 'idle'; break;
        case 'laundry': ok = f >= 2; state = ok ? 'happy' : 'idle'; break;
        case 'candle': ok = f === 0; state = ok ? 'happy' : 'bad'; break;
        case 'papers': ok = f <= 1; state = ok ? 'happy' : 'bad'; break;
        case 'fern': ok = f === 1; state = ok ? 'happy' : (f === 0 ? 'idle' : 'bad'); break;
        case 'stove':
          var st = stoveList[stoveAt[ob.y * W + ob.x]];
          ok = st.cleared; state = ok ? 'happy' : (st.reached ? 'bad' : 'idle'); break;
        default: ok = true; state = 'happy';
      }
      goals.push({ type: ob.type, x: ob.x, y: ob.y, flow: f, ok: ok, state: state });
      if (!ok) solved = false;
    }

    return { flow: flow, trees: trees, stoves: stoveList, goals: goals, solved: solved };
  }

  function simulate(L, pieces) {
    return run(L, pieces, true);
  }

  function isSolved(L, pieces) {
    return run(L, pieces, false);
  }

  return {
    DX: DX, DY: DY, DIR_NAMES: DIR_NAMES,
    TOOLS: TOOLS, TOOL_ORDER: TOOL_ORDER,
    OBJECTS: OBJECTS, OBJECT_ORDER: OBJECT_ORDER, OBJECT_BY_CHAR: OBJECT_BY_CHAR,
    MAX_W: MAX_W, MAX_H: MAX_H,
    CALM_INTRO: CALM_INTRO, WIND2_INTRO: WIND2_INTRO, WIND3_INTRO: WIND3_INTRO,
    parseLevel: parseLevel,
    validateLevel: validateLevel,
    introErrors: introErrors,
    cellAt: cellAt,
    isFloorish: isFloorish, isWall: isWall, isOutside: isOutside,
    outwardDir: outwardDir,
    canPlace: canPlace,
    placementCells: placementCells,
    windowRole: windowRole,
    rotate: rotate,
    simulate: simulate,
    isSolved: isSolved
  };
});
