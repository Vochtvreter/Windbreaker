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

  function simulate(L, pieces) {
    var W = L.w, H = L.h, N = W * H;
    var grid = new Array(N);
    var i;
    for (i = 0; i < N; i++) grid[i] = null;
    pieces = (pieces || []).map(normPiece);
    pieces.forEach(function (p) {
      if (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) grid[p.y * W + p.x] = p;
    });

    var stoveIndex = {};
    L.stoves.forEach(function (s, k) { stoveIndex[s.y * W + s.x] = k; });
    var nStoves = L.stoves.length;
    var maskSpan = 1 << nStoves;

    function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
    function cAt(x, y) { return inBounds(x, y) ? L.cells[y * W + x] : '~'; }
    function pAt(x, y) { return inBounds(x, y) ? grid[y * W + x] : null; }
    function isInlet(p) { return p.type === 'window' && windowRole(L, p) === 'inlet'; }

    // Trace one source. starts: [{x, y, d, s, fx, fy}] where (fx, fy) is the
    // point the air comes from (cell units).
    function trace(source, kind, starts) {
      var nodes = new Map(); // key -> node
      var cellFlow = new Map(); // cell index -> max strength
      var segments = [];
      var ends = [];
      var reached = 0; // mask of stoves reached
      var outlet = false;
      var queue = [];
      starts.forEach(function (st) {
        queue.push({ x: st.x, y: st.y, d: st.d, s: st.s, m: 0, fx: st.fx, fy: st.fy, dist: 0, parent: null });
      });

      function keyOf(x, y, d, s, m) {
        // x, y may be out of bounds by 1 only for outside terminals; offset by 1.
        return ((((((y + 1) * (W + 2) + (x + 1)) * 4 + d) * 64) + Math.min(s, 63)) * maskSpan) + m;
      }

      var head = 0;
      while (head < queue.length) {
        var st = queue[head++];
        var x = st.x, y = st.y, d = st.d, s = st.s, m = st.m;
        var cx = x + 0.5, cy = y + 0.5;
        var key = keyOf(x, y, d, s, m);
        var ch = cAt(x, y);
        var piece = pAt(x, y);
        var existing = nodes.get(key);

        // Terminal checks (outside / walls) first so we can draw to the right point.
        var term = null, endX = cx, endY = cy;
        if (isOutside(ch)) {
          term = 'outlet';
        } else if (isWall(ch)) {
          if (piece && piece.type === 'vent') {
            term = null;
          } else if (piece && piece.type === 'window' && !isInlet(piece)) {
            term = 'outlet'; endX = cx + 0.5 * DX[d]; endY = cy + 0.5 * DY[d];
          } else if (piece && piece.type === 'extractor') {
            term = 'outlet'; endX = cx + 0.5 * DX[d]; endY = cy + 0.5 * DY[d];
          } else {
            term = 'blocked'; endX = cx - 0.5 * DX[d]; endY = cy - 0.5 * DY[d];
          }
        }

        var segLen = Math.abs(endX - st.fx) + Math.abs(endY - st.fy);
        segments.push({ ax: st.fx, ay: st.fy, bx: endX, by: endY, s: s, smoke: m !== 0, dist: st.dist });
        var dist = st.dist + segLen;

        if (st.parent) st.parent.next.push(key);
        if (existing) continue; // merge into flow that is already traced

        var node = { key: key, m: m, next: [], term: null };
        nodes.set(key, node);

        if (term) {
          node.term = term;
          ends.push({ x: endX, y: endY, type: term });
          if (term === 'outlet') outlet = true;
          continue;
        }

        var succ = []; // [d, s]
        if (isWall(ch)) {
          // passing through a vent
          succ.push([d, s]);
        } else {
          var ci = y * W + x;
          var prev = cellFlow.get(ci) || 0;
          if (s > prev) cellFlow.set(ci, s);
          if (stoveIndex.hasOwnProperty(ci)) {
            var bit = 1 << stoveIndex[ci];
            m |= bit;
            reached |= bit;
            node.m = m;
          }
          var t = piece ? piece.type : null;
          if (t === 'fan') {
            succ.push([piece.d, s]);
          } else if (t === 'deflector') {
            succ.push([piece.d === 0 ? [1, 0, 3, 2][d] : [3, 2, 1, 0][d], s]);
          } else if (t === 'curtain') {
            if (s - 1 <= 0) {
              node.term = 'blocked';
              ends.push({ x: cx, y: cy, type: 'blocked' });
              continue;
            }
            succ.push([d, s - 1]);
          } else if (t === 'splitter') {
            var hs = Math.max(1, Math.floor(s / 2));
            succ.push([(d + 1) % 4, hs]);
            succ.push([(d + 3) % 4, hs]);
          } else if (t === 'skylight') {
            node.term = 'outlet';
            outlet = true;
            ends.push({ x: cx, y: cy, type: 'outlet' });
            continue;
          } else if (t === 'filter') {
            m = 0;
            succ.push([d, s]);
          } else {
            succ.push([d, s]);
          }
        }
        for (var k = 0; k < succ.length; k++) {
          var nd = succ[k][0];
          queue.push({
            x: x + DX[nd], y: y + DY[nd], d: nd, s: succ[k][1], m: m,
            fx: cx, fy: cy, dist: dist, parent: node
          });
        }
      }

      // Smoke failures: smoky blocked terminals and smoky states on cycles.
      var failed = 0;
      nodes.forEach(function (nd) {
        if (nd.m && nd.term === 'blocked') failed |= nd.m;
      });
      if (nStoves && reached) {
        var cyc = cycleNodes(nodes);
        cyc.forEach(function (nd) { failed |= nd.m; });
      }

      return {
        source: source,
        kind: kind,
        active: kind !== 'inlet' || outlet,
        segments: segments,
        ends: ends,
        cellFlow: cellFlow,
        reached: reached,
        failed: failed
      };
    }

    var trees = [];
    pieces.forEach(function (p) {
      var ox, oy;
      if (p.type === 'window') {
        if (!isInlet(p)) return;
        var wd = L.wind.dir;
        trees.push(trace(p, 'inlet', [{
          x: p.x + DX[wd], y: p.y + DY[wd], d: wd, s: L.wind.strength,
          fx: p.x + 0.5 - 0.5 * DX[wd], fy: p.y + 0.5 - 0.5 * DY[wd]
        }]));
      } else if (p.type === 'fan') {
        trees.push(trace(p, 'fan', [{
          x: p.x + DX[p.d], y: p.y + DY[p.d], d: p.d, s: 1, fx: p.x + 0.5, fy: p.y + 0.5
        }]));
      } else if (p.type === 'ceilingfan') {
        var starts = [];
        for (var d = 0; d < 4; d++) {
          starts.push({ x: p.x + DX[d], y: p.y + DY[d], d: d, s: 1, fx: p.x + 0.5, fy: p.y + 0.5 });
        }
        trees.push(trace(p, 'ceilingfan', starts));
      } else if (p.type === 'extractor') {
        var o = outwardDir(L, p.x, p.y);
        if (o < 0) return;
        var inward = (o + 2) % 4;
        ox = p.x + DX[inward]; oy = p.y + DY[inward];
        if (!isFloorish(cAt(ox, oy)) || pAt(ox, oy)) return;
        while (isFloorish(cAt(ox + DX[inward], oy + DY[inward])) && !pAt(ox + DX[inward], oy + DY[inward])) {
          ox += DX[inward]; oy += DY[inward];
        }
        trees.push(trace(p, 'pull', [{
          x: ox, y: oy, d: o, s: 1,
          fx: ox + 0.5 + 0.5 * DX[inward], fy: oy + 0.5 + 0.5 * DY[inward]
        }]));
      }
    });

    var flow = new Int32Array(N);
    var reachedAll = 0, failedAll = 0;
    trees.forEach(function (t) {
      if (!t.active) return;
      t.cellFlow.forEach(function (s, ci) { flow[ci] += s; });
      reachedAll |= t.reached;
      failedAll |= t.failed;
    });

    var stoves = L.stoves.map(function (s, k) {
      var bit = 1 << k;
      var r = (reachedAll & bit) !== 0;
      return { x: s.x, y: s.y, reached: r, cleared: r && (failedAll & bit) === 0 };
    });

    var goals = L.objects.map(function (o) {
      var f = flow[o.y * W + o.x];
      var ok, state;
      switch (o.type) {
        case 'pinwheel': ok = f >= 1; state = ok ? 'happy' : 'idle'; break;
        case 'laundry': ok = f >= 2; state = ok ? 'happy' : 'idle'; break;
        case 'candle': ok = f === 0; state = ok ? 'happy' : 'bad'; break;
        case 'papers': ok = f <= 1; state = ok ? 'happy' : 'bad'; break;
        case 'fern': ok = f === 1; state = ok ? 'happy' : (f === 0 ? 'idle' : 'bad'); break;
        case 'stove':
          var st = stoves[stoveIndex[o.y * W + o.x]];
          ok = st.cleared; state = ok ? 'happy' : (st.reached ? 'bad' : 'idle'); break;
        default: ok = true; state = 'happy';
      }
      return { type: o.type, x: o.x, y: o.y, flow: f, ok: ok, state: state };
    });

    trees.forEach(function (t) { delete t.cellFlow; delete t.reached; delete t.failed; });

    return {
      flow: flow,
      trees: trees,
      stoves: stoves,
      goals: goals,
      solved: goals.length > 0 && goals.every(function (g) { return g.ok; })
    };
  }

  // Nodes that lie on a directed cycle (Tarjan's SCC, iterative).
  function cycleNodes(nodes) {
    var index = 0;
    var idx = new Map(), low = new Map(), onStack = new Set();
    var stack = [];
    var result = [];
    nodes.forEach(function (start) {
      if (idx.has(start.key)) return;
      var work = [[start, 0]];
      idx.set(start.key, index); low.set(start.key, index); index++;
      stack.push(start); onStack.add(start.key);
      while (work.length) {
        var top = work[work.length - 1];
        var v = top[0];
        if (top[1] < v.next.length) {
          var wk = v.next[top[1]++];
          var w = nodes.get(wk);
          if (!w) continue;
          if (!idx.has(wk)) {
            idx.set(wk, index); low.set(wk, index); index++;
            stack.push(w); onStack.add(wk);
            work.push([w, 0]);
          } else if (onStack.has(wk)) {
            low.set(v.key, Math.min(low.get(v.key), idx.get(wk)));
          }
        } else {
          work.pop();
          if (work.length) {
            var u = work[work.length - 1][0];
            low.set(u.key, Math.min(low.get(u.key), low.get(v.key)));
          }
          if (low.get(v.key) === idx.get(v.key)) {
            var comp = [];
            var x;
            do {
              x = stack.pop();
              onStack.delete(x.key);
              comp.push(x);
            } while (x !== v);
            var selfLoop = comp.length === 1 && v.next.indexOf(v.key) >= 0;
            if (comp.length > 1 || selfLoop) result.push.apply(result, comp);
          }
        }
      }
    });
    return result;
  }

  function isSolved(L, pieces) {
    return simulate(L, pieces).solved;
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
