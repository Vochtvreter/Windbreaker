/*
 * Windbreaker — canvas renderer.
 * Draws a board from (level, pieces, simulation result, UI state, time):
 * the garden, the house, the airflow and the marks over it. What each tool,
 * object and status pip looks like comes from the sprite registry
 * (js/sprites.js); every colour comes from the theme (js/theme.js).
 * Keeps only cosmetic animation state (spin angles, eased values, wind streaks).
 * Exposes window.WBRender = { Board, icon, analyze }.
 */
(function (root) {
  'use strict';

  var WB = root.WB;
  var Theme = root.WBTheme;
  var SPR = root.WBSprites;
  var K = SPR.kit;
  var DX = [0, 1, 0, -1];
  var DY = [-1, 0, 1, 0];
  var TAU = Math.PI * 2;

  // ------------------------------------------------------------------ theme + shapes

  var P = Theme.color;
  // tuning numbers: speeds and sizes (js/theme.js; 1 = as designed)
  var N = Theme.num;
  var mix = Theme.mix, alpha = Theme.alpha, darker = Theme.darker;
  var rr = K.rr, fillRR = K.fillRR, circle = K.circle, line = K.line;

  // ------------------------------------------------------------------ utils

  var clamp = K.clamp;
  function easeOutBack(t) {
    t = clamp(t, 0, 1);
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function approach(cur, target, rate, dt) {
    if (SETTLE) return target;
    return cur + (target - cur) * (1 - Math.exp(-rate * dt));
  }

  // Test hook (tools/visual.js): while window.__wbFreezeTime is a number (ms),
  // every frame is drawn at that moment as a pure function of the scene: eased
  // values are settled, nothing spins on, and spin angles and wind streaks come
  // from a fixed seed. Never set in normal play.
  var RAND = Math.random, SETTLE = false;
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash01(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function mod(a, n) { var r = a % n; return r < 0 ? r + n : r; }

  function isWallTool(type) { return WB.TOOLS[type] && WB.TOOLS[type].mount !== 'floor'; }
  // sprite names, built once
  var TOOL_SPRITE = {}, OBJ_SPRITE = {};
  WB.TOOL_ORDER.forEach(function (t) { TOOL_SPRITE[t] = 'tool.' + t; });
  Object.keys(WB.OBJECTS).forEach(function (t) { OBJ_SPRITE[t] = 'object.' + t; });

  // Requirement meters: one slot per unit of air.
  //   req = must be filled, opt = may be filled, bar = no more than this, plus = or more.
  var METER = {
    laundry: { slots: ['req', 'req'], cap: false },
    papers: { slots: ['opt'], cap: true },
    fern: { slots: ['req'], cap: true }
  };

  // ------------------------------------------------------------------ requirement meter (shared with icons)

  // Draws a requirement meter centred at (0,0), in CSS px.
  function meterShape(ctx, type, flow, state, T) {
    var spec = METER[type];
    if (!spec) return;
    var dr = Math.max(2.9, T * 0.062), g = Math.max(2.2, T * 0.045);
    var barW = Math.max(1.4, T * 0.03), pl = dr * 0.9, padX = Math.max(3.5, T * 0.07);
    var list = [], k;
    for (k = 0; k < spec.slots.length; k++) list.push({ k: 'slot', w: dr * 2, req: spec.slots[k] === 'req', on: k < flow });
    if (spec.cap) {
      list.push({ k: 'bar', w: barW });
      var over = Math.max(0, Math.min(3, flow - spec.slots.length));
      for (k = 0; k < over; k++) list.push({ k: 'over', w: dr * 2 });
    } else {
      list.push({ k: 'plus', w: pl * 2, on: flow > spec.slots.length });
    }
    var W = padX * 2 + g * (list.length - 1);
    for (k = 0; k < list.length; k++) W += list[k].w;
    var h = dr * 2 + Math.max(4, T * 0.09);
    ctx.save();
    ctx.globalAlpha = state === 'happy' ? 0.62 : 1;
    ctx.beginPath(); rr(ctx, -W / 2, -h / 2, W, h, h / 2);
    ctx.fillStyle = P('surface');
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = alpha(P('ink'), 0.16);
    ctx.stroke();
    // laundry is only ever 'bad' when smoky air reaches it: its meter fills grey
    var fillCol = state === 'happy' ? P('good') : state === 'bad' && type === 'laundry' ? darker(P('smoke'), 0.12) : P('air-deep');
    var ringW = Math.max(1.2, dr * 0.42);
    var x = -W / 2 + padX;
    ctx.lineCap = 'round';
    for (k = 0; k < list.length; k++) {
      var it = list[k], c = x + it.w / 2;
      if (it.k === 'slot') {
        if (it.on) { ctx.beginPath(); circle(ctx, c, 0, dr); ctx.fillStyle = fillCol; ctx.fill(); }
        else {
          ctx.beginPath(); circle(ctx, c, 0, dr - ringW / 2);
          ctx.lineWidth = ringW;
          ctx.strokeStyle = alpha(P('ink-soft'), it.req ? 0.75 : 0.35);
          ctx.stroke();
        }
      } else if (it.k === 'over') {
        ctx.beginPath(); circle(ctx, c, 0, dr); ctx.fillStyle = P('bad'); ctx.fill();
      } else if (it.k === 'bar') {
        ctx.beginPath(); line(ctx, c, -dr * 1.3, c, dr * 1.3);
        ctx.strokeStyle = alpha(P('ink-soft'), 0.8);
        ctx.lineWidth = barW;
        ctx.stroke();
      } else {
        ctx.beginPath(); line(ctx, c - pl, 0, c + pl, 0); line(ctx, c, -pl, c, pl);
        ctx.strokeStyle = it.on ? fillCol : alpha(P('ink-soft'), 0.75);
        ctx.lineWidth = Math.max(1.3, dr * 0.5);
        ctx.stroke();
      }
      x += it.w + g;
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ icons

  function setupCanvas(canvas, w, h) {
    var dpr = Math.min(root.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // icon(canvas, kind, id, cssSize)
  //   kind: 'tool' | 'pair' ('a+b') | 'object' | 'swirl' | 'ui'
  //   ui ids: pip-idle, pip-happy, pip-bad, stall, table, inlet, outlet, meter-<type>-<flow>, lanes-<n>,
  //           courtyard, solid, calm (the field guide's twists)
  // Tools are the sprites icon.<tool>, objects object.<type> (js/sprites.js).
  function icon(canvas, kind, id, size) {
    var ctx = setupCanvas(canvas, size, size);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    if (kind === 'tool') {
      var s = size * 0.86;
      ctx.scale(s, s);
      SPR.draw('icon.' + id, ctx);
    } else if (kind === 'pair') {
      var ids = String(id).split('+');
      var s2 = size * 0.86;
      ctx.scale(s2, s2);
      ctx.save(); ctx.translate(-0.17, -0.15); ctx.scale(0.64, 0.64); SPR.draw('icon.' + ids[0], ctx); ctx.restore();
      ctx.beginPath(); rr(ctx, -0.04, -0.02, 0.5, 0.5, 0.14);
      ctx.fillStyle = P('bg-2'); ctx.fill();
      ctx.save(); ctx.translate(0.21, 0.23); ctx.scale(0.64, 0.64); SPR.draw('icon.' + (ids[1] || ids[0]), ctx); ctx.restore();
    } else if (kind === 'object') {
      var so = size * 0.92;
      ctx.scale(so, so);
      // icon: true picks an image override's 'icon' state (else its happy one)
      var st = { angle: 0.5, lit: 1, dry: 1, flow: 0, scatter: 0, flutter: 0, bend: 0, sway: 0, small: size < 30, px: 1 / so, icon: true };
      SPR.draw('object.' + id, ctx, st, 0.2);
    } else if (kind === 'ui') {
      uiIcon(ctx, id, size);
    } else {
      var k = size / 64;
      ctx.translate(-size / 2, -size / 2);
      ctx.scale(k, k);
      ctx.lineCap = 'round';
      ctx.lineWidth = 4.6;
      ctx.strokeStyle = P('air');
      ctx.stroke(new Path2D('M13 26h24a7.5 7.5 0 1 0-7.5-7.5'));
      ctx.stroke(new Path2D('M13 37h30a8 8 0 1 1-8 8'));
      ctx.globalAlpha = 0.5;
      ctx.stroke(new Path2D('M19 47h8'));
    }
    ctx.restore();
  }

  function uiIcon(ctx, id, size) {
    var parts = String(id).split('-');
    if (parts[0] === 'pip') { SPR.draw('ui.pip', ctx, { state: parts[1], r: size * 0.3 }); return; }
    if (parts[0] === 'meter') { meterShape(ctx, parts[1], +parts[2] || 0, parts[3] || 'idle', size * 0.75); return; }
    if (id === 'stall') {
      ctx.beginPath(); line(ctx, -size * 0.46, 0, size * 0.12, 0);
      ctx.setLineDash([size * 0.06, size * 0.1]);
      ctx.strokeStyle = alpha(P('air'), 0.8);
      ctx.lineWidth = Math.max(1.3, size * 0.05);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
      fillRR(ctx, size * 0.15, -size * 0.32, size * 0.3, size * 0.64, size * 0.06, P('icon-wall'));
      SPR.draw('ui.stall', ctx, { x: size * 0.3, y: 0, r: size * 0.15 });
      return;
    }
    if (id === 'table') {
      var tw = size * 0.66, th = size * 0.5;
      fillRR(ctx, -tw / 2, -th / 2 + size * 0.04, tw, th, size * 0.1, P('table-edge'));
      fillRR(ctx, -tw / 2, -th / 2, tw, th, size * 0.1, P('table'));
      ctx.beginPath();
      line(ctx, -tw / 2 + size * 0.05, -th / 2 + th * 0.38, tw / 2 - size * 0.05, -th / 2 + th * 0.38);
      line(ctx, -tw / 2 + size * 0.05, -th / 2 + th * 0.66, tw / 2 - size * 0.05, -th / 2 + th * 0.66);
      ctx.strokeStyle = alpha(P('table-edge'), 0.45);
      ctx.lineWidth = Math.max(1, size * 0.03);
      ctx.stroke();
      return;
    }
    // twists (the field guide): a courtyard, a hatched wall, a calm day
    if (id === 'courtyard' || id === 'solid') {
      var bw = size * 0.72, br = size * 0.14;
      fillRR(ctx, -bw / 2, -bw / 2, bw, bw, br, P(id === 'solid' ? 'wall-solid' : 'icon-wall'));
      if (id === 'courtyard') {
        var cw = bw * 0.5;
        fillRR(ctx, -cw / 2, -cw / 2, cw, cw, br * 0.6, P('garden'));
        ctx.beginPath();
        line(ctx, -cw * 0.18, cw * 0.18, -cw * 0.24, -cw * 0.06); line(ctx, 0, cw * 0.2, 0, -cw * 0.12); line(ctx, cw * 0.18, cw * 0.18, cw * 0.24, -cw * 0.06);
        ctx.strokeStyle = P('o-leaf');
        ctx.lineWidth = Math.max(1, size * 0.035);
        ctx.lineCap = 'round';
        ctx.stroke();
      } else {
        ctx.save();
        ctx.beginPath(); rr(ctx, -bw / 2, -bw / 2, bw, bw, br); ctx.clip();
        ctx.beginPath();
        for (var hk = -bw; hk < bw; hk += size * 0.13) line(ctx, hk, bw / 2, hk + bw, -bw / 2);
        ctx.strokeStyle = P('wall-hatch');
        ctx.lineWidth = Math.max(1, size * 0.05);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    if (id === 'calm') {
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.4, size * 0.06);
      ctx.strokeStyle = alpha(P('air'), 0.45);
      ctx.beginPath(); line(ctx, -size * 0.32, -size * 0.08, size * 0.18, -size * 0.08); ctx.stroke();
      ctx.beginPath(); line(ctx, -size * 0.2, size * 0.12, size * 0.3, size * 0.12); ctx.stroke();
      ctx.fillStyle = P('air');
      [[-0.3, -0.26], [0.26, -0.22], [-0.08, 0.3], [0.32, 0.3]].forEach(function (m) {
        ctx.beginPath(); circle(ctx, m[0] * size, m[1] * size, Math.max(1.4, size * 0.045)); ctx.fill();
      });
      return;
    }
    if (parts[0] === 'lanes') {
      var n = +parts[1] || 1, gap = size * 0.16, lw = Math.max(1.5, size * 0.07);
      ctx.beginPath(); line(ctx, -size * 0.4, 0, size * 0.4, 0);
      ctx.strokeStyle = alpha(P('air'), 0.2);
      ctx.lineWidth = (n - 1) * gap + lw + size * 0.14;
      ctx.lineCap = 'round';
      ctx.stroke();
      for (var j = 0; j < n; j++) {
        var off = (j - (n - 1) / 2) * gap;
        ctx.beginPath(); line(ctx, -size * 0.36 + j * size * 0.08, off, size * 0.1 + j * size * 0.08, off);
        ctx.strokeStyle = P('air');
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      return;
    }
    if (id === 'inlet' || id === 'outlet') {
      var s = size;
      ctx.scale(s, s);
      fillRR(ctx, -0.5, -0.05, 1, 0.3, 0.06, P('icon-wall'));
      ctx.translate(0, 0.1);
      ctx.scale(0.6, 0.6);
      SPR.draw('tool.window', ctx, { outward: 0, role: id, px: 1 / (s * 0.6) });
    }
  }

  // ------------------------------------------------------------------ simulation analysis (cached on the result)
  //
  // Every tree's segments are cut into half-cell steps keyed by (start, direction).
  // Steps shared by several trees are merged and their strengths summed, so the
  // drawing shows the real strength of a stream. Straight chains of equal steps
  // become runs, which are what gets drawn.

  function hkey(hx, hy, d) { return ((hy + 32) * 2048 + (hx + 32)) * 4 + d; }
  function dirOf(dx, dy) { return dy < 0 ? 0 : dx > 0 ? 1 : dy > 0 ? 2 : 3; }
  function isCentre(v) { return Math.abs(mod(v, 1) - 0.5) < 1e-6; }

  function analyze(sim, L) {
    if (sim._wbr) return sim._wbr;
    var A = { runs: [], stalled: [], outEnds: [], blockEnds: [], stallEnds: [], dir: new Float32Array(L.w * L.h * 2) };
    var steps = new Map(), order = [], endSeen = {};
    sim.trees.forEach(function (tr) {
      var mine = new Map();
      tr.segments.forEach(function (sg) {
        var dx = Math.sign(sg.bx - sg.ax), dy = Math.sign(sg.by - sg.ay);
        var len = Math.abs(sg.bx - sg.ax) + Math.abs(sg.by - sg.ay);
        if (len < 1e-6) return;
        var d = dirOf(dx, dy), n = Math.round(len * 2);
        var hx0 = Math.round(sg.ax * 2), hy0 = Math.round(sg.ay * 2);
        for (var k = 0; k < n; k++) {
          var hx = hx0 + dx * k, hy = hy0 + dy * k, key = hkey(hx, hy, d), dist = sg.dist + k * 0.5;
          var e = mine.get(key);
          if (!e) mine.set(key, { hx: hx, hy: hy, d: d, s: sg.s, smoke: !!sg.smoke, dist: dist });
          else {
            if (sg.s > e.s) e.s = sg.s;
            if (sg.smoke) e.smoke = true;
            if (dist < e.dist) e.dist = dist;
          }
        }
      });
      // The step that runs into an end. At a wall face two steps can meet
      // there (e.g. a stream that turned back onto its own inlet window): the
      // one heading into the wall is the one that stops.
      function lastStep(e) {
        var ex = Math.round(e.x * 2), ey = Math.round(e.y * 2), any = null;
        for (var d = 0; d < 4; d++) {
          var st = mine.get(hkey(ex - DX[d], ey - DY[d], d));
          if (!st) continue;
          if (WB.isWall(WB.cellAt(L, Math.floor(e.x + DX[d] * 0.25), Math.floor(e.y + DY[d] * 0.25)))) return st;
          if (!any) any = st;
        }
        return any;
      }
      if (!tr.active) {
        mine.forEach(function (e) { A.stalled.push(e); });
        tr.ends.forEach(function (e) {
          var st = lastStep(e);
          A.stallEnds.push({ x: e.x, y: e.y, dx: st ? DX[st.d] : 0, dy: st ? DY[st.d] : 0 });
        });
        return;
      }
      mine.forEach(function (e, key) {
        var st = steps.get(key);
        if (!st) {
          st = { hx: e.hx, hy: e.hy, d: e.d, s: e.s, smoke: e.smoke, dist: e.dist, best: e.s };
          steps.set(key, st);
          order.push(st);
        } else {
          st.s += e.s;
          if (e.smoke) st.smoke = true;
          if (e.s > st.best) { st.best = e.s; st.dist = e.dist; }
        }
      });
      tr.ends.forEach(function (e) {
        var st = lastStep(e);
        var d = st ? st.d : -1;
        var k = e.type + ':' + Math.round(e.x * 2) + ',' + Math.round(e.y * 2) + ',' + d;
        if (endSeen[k]) return;
        endSeen[k] = true;
        var it = {
          x: e.x, y: e.y, d: d, dx: d >= 0 ? DX[d] : 0, dy: d >= 0 ? DY[d] : 0,
          key: st ? hkey(st.hx, st.hy, st.d) : -1, sky: false, s: 1, smoke: false, dist: 0
        };
        if (e.type === 'outlet') { it.sky = isCentre(e.x) && isCentre(e.y); A.outEnds.push(it); }
        else A.blockEnds.push(it);
      });
    });
    function finishEnd(it) {
      var st = it.key >= 0 ? steps.get(it.key) : null;
      if (st) { it.s = st.s; it.smoke = st.smoke; it.dist = st.dist + 0.5; }
    }
    A.outEnds.forEach(finishEnd);
    A.blockEnds.forEach(finishEnd);
    order.forEach(function (st) {
      var cx = Math.floor((st.hx + DX[st.d] * 0.5) / 2), cy = Math.floor((st.hy + DY[st.d] * 0.5) / 2);
      if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return;
      var i = (cy * L.w + cx) * 2;
      A.dir[i] += DX[st.d] * st.s; A.dir[i + 1] += DY[st.d] * st.s;
    });
    function same(a, b) { return a.s === b.s && a.smoke === b.smoke && Math.abs(a.dist + 0.5 - b.dist) < 1e-6; }
    order.forEach(function (st) {
      var p = steps.get(hkey(st.hx - DX[st.d], st.hy - DY[st.d], st.d));
      if (p && same(p, st)) return; // not the start of a run
      var cur = st, len = 0.5;
      for (;;) {
        var nx = steps.get(hkey(cur.hx + DX[cur.d], cur.hy + DY[cur.d], cur.d));
        if (nx && same(cur, nx)) { cur = nx; len += 0.5; } else break;
      }
      A.runs.push({
        ax: st.hx / 2, ay: st.hy / 2, bx: st.hx / 2 + DX[st.d] * len, by: st.hy / 2 + DY[st.d] * len,
        dx: DX[st.d], dy: DY[st.d], d: st.d, s: st.s, smoke: st.smoke, dist: st.dist, len: len
      });
    });
    A.runs.sort(function (a, b) { return a.s - b.s; });
    sim._wbr = A;
    return A;
  }

  // ------------------------------------------------------------------ Board

  function Board(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.L = null;
    this.T = 32;
    this.m = 1;
    this.ox = 0; this.oy = 0;
    this.cssW = 0; this.cssH = 0;
    this.dpr = 1;
    this.gardenLayer = document.createElement('canvas');
    this.houseLayer = document.createElement('canvas');
    this.anim = {};
    this.streaks = [];
    this.lastNow = 0;
    this.seed = 1;
    this.lay = null;
  }

  Board.prototype.setLevel = function (L, seed) {
    this.L = L;
    this.seed = seed || 1;
    this.anim = {};
    this.streaks = [];
    this.streakSeeded = false;
    this.lay = null;
  };

  // Fill availW x availH CSS pixels with the scene. The house is fitted with at
  // least ~0.75 tile of garden around it, below `reserveTop` px kept free for a card.
  Board.prototype.layout = function (availW, availH, reserveTop) {
    var L = this.L;
    if (!L) return null;
    availW = Math.max(60, Math.floor(availW)); availH = Math.max(60, Math.floor(availH));
    reserveTop = Math.max(0, Math.round(reserveTop || 0));
    // the whole stage is repainted every frame: 2x is crisp and spares 3x phones
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var lay = this.lay, maxT = N('max-tile');
    if (lay && lay.L === L && lay.w === availW && lay.h === availH && lay.r === reserveTop && lay.dpr === dpr && lay.maxT === maxT) {
      return { w: this.cssW, h: this.cssH, T: this.T };
    }
    var sizeChanged = !lay || lay.L !== L || lay.w !== availW || lay.h !== availH || lay.r !== reserveTop || lay.maxT !== maxT;
    this.lay = { L: L, w: availW, h: availH, r: reserveTop, dpr: dpr, maxT: maxT };
    var hAvail = Math.max(60, availH - reserveTop);
    var m = 1;
    var T = Math.min(availW / (L.w + 2 * m), hAvail / (L.h + 2 * m));
    if (T < 40) {
      m = 0.75;
      T = Math.min(availW / (L.w + 2 * m), hAvail / (L.h + 2 * m));
    }
    // still small (a big house on a phone): a slimmer strip of garden, so the
    // house, and every spot to tap, gets bigger
    if (T < 34) {
      m = 0.35;
      T = Math.min(availW / (L.w + 2 * m), hAvail / (L.h + 2 * m));
    }
    T = T >= 20 ? Math.floor(T) : Math.max(10, T);
    T = Math.min(T, maxT);
    this.T = T;
    this.m = m;
    this.cssW = availW;
    this.cssH = availH;
    this.ox = Math.round((availW - L.w * T) / 2);
    var oy = Math.round((availH - L.h * T) / 2);
    if (reserveTop > 0) oy = Math.max(oy, Math.round(reserveTop + m * T * 0.6));
    this.oy = Math.min(oy, Math.max(0, availH - L.h * T - Math.round(m * T * 0.6)));
    this.dpr = dpr;
    var c = this.canvas;
    c.style.width = this.cssW + 'px';
    c.style.height = this.cssH + 'px';
    c.width = Math.round(this.cssW * dpr);
    c.height = Math.round(this.cssH * dpr);
    this.renderStatic();
    if (sizeChanged) {
      this.streaks = [];
      this.streakSeeded = false;
    }
    return { w: this.cssW, h: this.cssH, T: T };
  };

  // The theme or the art changed: rebuild the cached garden and house layers
  // (the rest is drawn fresh every frame).
  Board.prototype.refreshPalette = function () {
    if (this.L && this.cssW) this.renderStatic();
  };

  // client coords -> cell (x,y may be outside the map); fx/fy are fractional cells
  Board.prototype.pick = function (clientX, clientY) {
    var r = this.canvas.getBoundingClientRect();
    var px = clientX - r.left, py = clientY - r.top;
    var fx = (px - this.ox) / this.T, fy = (py - this.oy) / this.T;
    var x = Math.floor(fx), y = Math.floor(fy);
    var L = this.L;
    return {
      x: x, y: y, fx: fx, fy: fy,
      onCanvas: px >= 0 && py >= 0 && px <= r.width && py <= r.height,
      inMap: !!L && x >= 0 && y >= 0 && x < L.w && y < L.h
    };
  };

  // cell rect in CSS px relative to the canvas
  Board.prototype.cellRect = function (x, y) {
    return { left: this.ox + x * this.T, top: this.oy + y * this.T, size: this.T };
  };

  Board.prototype.renderStatic = function () {
    var L = this.L, T = this.T, dpr = this.dpr;
    var W = this.cssW, H = this.cssH;
    function cell(x, y) { return WB.cellAt(L, x, y); }
    function isWall(x, y) { var c = cell(x, y); return c === '#' || c === '%'; }
    function isFloor(x, y) { return WB.isFloorish(cell(x, y)); }
    function isHouse(x, y) { return !WB.isOutside(cell(x, y)); }
    var x, y;

    // ---------- garden
    var g = this.gardenLayer;
    g.width = Math.round(W * dpr); g.height = Math.round(H * dpr);
    var gc = g.getContext('2d');
    gc.setTransform(dpr, 0, 0, dpr, 0, 0);
    gc.fillStyle = P('garden');
    gc.fillRect(0, 0, W, H);
    var hcx = this.ox + L.w * T / 2, hcy = this.oy + L.h * T / 2;
    var grad = gc.createRadialGradient(hcx, hcy, Math.min(W, H) * 0.25, hcx, hcy, Math.max(W, H) * 0.8);
    grad.addColorStop(0, alpha(P('garden-2'), 0));
    grad.addColorStop(1, P('garden-2'));
    gc.fillStyle = grad;
    gc.fillRect(0, 0, W, H);
    var tex = texturePattern(gc, 'garden', T, dpr);
    if (tex) { gc.save(); gc.globalAlpha = tex.alpha; gc.fillStyle = tex.pattern; gc.fillRect(0, 0, W, H); gc.restore(); }
    var rand = rng(this.seed * 7919 + L.w * 31 + L.h);
    gc.strokeStyle = P('garden-mark');
    gc.lineWidth = Math.max(1, T * 0.045);
    gc.lineCap = 'round';
    var tufts = Math.min(900, Math.round((W * H) / (T * T) * 0.45));
    gc.beginPath();
    for (var i = 0; i < tufts; i++) {
      var gx = rand() * W, gy = rand() * H;
      var cx = Math.floor((gx - this.ox) / T), cy = Math.floor((gy - this.oy) / T);
      var near = false;
      for (var yy = -1; yy <= 1 && !near; yy++) {
        for (var xx = -1; xx <= 1; xx++) {
          if (isHouse(cx + xx, cy + yy)) {
            var hx0 = this.ox + (cx + xx) * T, hy0 = this.oy + (cy + yy) * T;
            if (gx > hx0 - T * 0.25 && gx < hx0 + T * 1.25 && gy > hy0 - T * 0.3 && gy < hy0 + T * 1.3) { near = true; break; }
          }
        }
      }
      if (near) continue;
      var s = T * (0.09 + rand() * 0.06);
      gc.moveTo(gx - s * 0.6, gy); gc.lineTo(gx - s * 0.9, gy - s);
      gc.moveTo(gx, gy); gc.lineTo(gx, gy - s * 1.3);
      gc.moveTo(gx + s * 0.6, gy); gc.lineTo(gx + s * 0.9, gy - s);
    }
    gc.stroke();

    // ---------- house
    var h = this.houseLayer;
    h.width = Math.round(W * dpr); h.height = Math.round(H * dpr);
    var c = h.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.translate(this.ox, this.oy);

    // shadow silhouette
    c.save();
    c.shadowColor = P('house-shadow');
    c.shadowBlur = T * 0.45 * dpr;
    c.shadowOffsetY = T * 0.14 * dpr;
    c.beginPath();
    var R = T * 0.22;
    for (y = 0; y < L.h; y++) {
      for (x = 0; x < L.w; x++) {
        if (isHouse(x, y)) {
          rr(c, x * T, y * T, T, T, [
            !isHouse(x, y - 1) && !isHouse(x - 1, y) ? R : 0,
            !isHouse(x, y - 1) && !isHouse(x + 1, y) ? R : 0,
            !isHouse(x, y + 1) && !isHouse(x + 1, y) ? R : 0,
            !isHouse(x, y + 1) && !isHouse(x - 1, y) ? R : 0
          ]);
        }
      }
    }
    c.fillStyle = P('wall');
    c.fill();
    c.restore();

    // floor
    c.beginPath();
    for (y = 0; y < L.h; y++) for (x = 0; x < L.w; x++) if (isFloor(x, y)) c.rect(x * T, y * T, T, T);
    c.fillStyle = P('floor');
    c.fill();
    tex = texturePattern(c, 'floor', T, dpr);
    if (tex) { c.save(); c.globalAlpha = tex.alpha; c.fillStyle = tex.pattern; c.fill(); c.restore(); }
    c.beginPath();
    var hp = 0.5 / dpr;
    for (y = 0; y < L.h; y++) {
      for (x = 0; x < L.w; x++) {
        if (!isFloor(x, y)) continue;
        if (isFloor(x + 1, y)) line(c, (x + 1) * T - hp, y * T, (x + 1) * T - hp, (y + 1) * T);
        if (isFloor(x, y + 1)) line(c, x * T, (y + 1) * T - hp, (x + 1) * T, (y + 1) * T - hp);
      }
    }
    c.strokeStyle = P('floor-grid');
    c.lineWidth = 1;
    c.stroke();

    // tables (merged rounded blocks)
    function isTable(x, y) { return cell(x, y) === 'o'; }
    var ti = T * 0.1, trr = T * 0.16;
    function tablePath(dy) {
      c.beginPath();
      for (y = 0; y < L.h; y++) {
        for (x = 0; x < L.w; x++) {
          if (!isTable(x, y)) continue;
          var l = isTable(x - 1, y) ? 0 : ti, r = isTable(x + 1, y) ? 0 : ti;
          var t = isTable(x, y - 1) ? 0 : ti, b = isTable(x, y + 1) ? 0 : ti;
          rr(c, x * T + l, y * T + t + dy, T - l - r, T - t - b, [
            !isTable(x, y - 1) && !isTable(x - 1, y) ? trr : 0,
            !isTable(x, y - 1) && !isTable(x + 1, y) ? trr : 0,
            !isTable(x, y + 1) && !isTable(x + 1, y) ? trr : 0,
            !isTable(x, y + 1) && !isTable(x - 1, y) ? trr : 0
          ]);
        }
      }
    }
    tablePath(T * 0.05);
    c.fillStyle = P('table-edge');
    c.fill();
    tablePath(0);
    c.fillStyle = P('table');
    c.fill();
    c.save();
    tablePath(0);
    c.clip();
    c.beginPath();
    for (y = 0; y < L.h; y++) {
      for (x = 0; x < L.w; x++) {
        if (!isTable(x, y)) continue;
        line(c, x * T, y * T + T * 0.38, (x + 1) * T, y * T + T * 0.38);
        line(c, x * T, y * T + T * 0.66, (x + 1) * T, y * T + T * 0.66);
      }
    }
    c.strokeStyle = alpha(P('table-edge'), 0.35);
    c.lineWidth = Math.max(1, T * 0.025);
    c.stroke();
    c.restore();

    // walls
    var wr = T * 0.2, fr = T * 0.13;
    function wallPath(pred, path) {
      for (y = 0; y < L.h; y++) {
        for (x = 0; x < L.w; x++) {
          if (!pred(x, y)) continue;
          rr(path, x * T, y * T, T, T, [
            !isWall(x, y - 1) && !isWall(x - 1, y) ? wr : 0,
            !isWall(x, y - 1) && !isWall(x + 1, y) ? wr : 0,
            !isWall(x, y + 1) && !isWall(x + 1, y) ? wr : 0,
            !isWall(x, y + 1) && !isWall(x - 1, y) ? wr : 0
          ]);
        }
      }
      return path;
    }
    var wp = wallPath(isWall, new Path2D());
    for (y = 0; y < L.h; y++) {
      for (x = 0; x < L.w; x++) {
        if (!isFloor(x, y)) continue;
        var X0 = x * T, Y0 = y * T, X1 = X0 + T, Y1 = Y0 + T;
        if (isWall(x, y - 1) && isWall(x - 1, y) && isWall(x - 1, y - 1)) {
          wp.moveTo(X0, Y0); wp.lineTo(X0, Y0 + fr); wp.arc(X0 + fr, Y0 + fr, fr, Math.PI, Math.PI * 1.5); wp.closePath();
        }
        if (isWall(x, y - 1) && isWall(x + 1, y) && isWall(x + 1, y - 1)) {
          wp.moveTo(X1, Y0); wp.lineTo(X1 - fr, Y0); wp.arc(X1 - fr, Y0 + fr, fr, -Math.PI / 2, 0); wp.closePath();
        }
        if (isWall(x, y + 1) && isWall(x + 1, y) && isWall(x + 1, y + 1)) {
          wp.moveTo(X1, Y1); wp.lineTo(X1, Y1 - fr); wp.arc(X1 - fr, Y1 - fr, fr, 0, Math.PI / 2); wp.closePath();
        }
        if (isWall(x, y + 1) && isWall(x - 1, y) && isWall(x - 1, y + 1)) {
          wp.moveTo(X0, Y1); wp.lineTo(X0 + fr, Y1); wp.arc(X0 + fr, Y1 - fr, fr, Math.PI / 2, Math.PI); wp.closePath();
        }
      }
    }
    // soft contact shadow of the walls on the floor (light from above)
    var fp = new Path2D();
    for (y = 0; y < L.h; y++) for (x = 0; x < L.w; x++) if (isFloor(x, y)) fp.rect(x * T, y * T, T, T);
    c.save();
    c.clip(fp);
    c.shadowColor = P('house-shadow');
    c.shadowBlur = T * 0.28 * dpr;
    c.shadowOffsetY = T * 0.07 * dpr;
    c.fillStyle = P('wall');
    c.fill(wp);
    c.restore();
    // walls as soft raised forms: light top edge, darker bottom edge
    var e = Math.max(1, T * 0.045);
    c.fillStyle = P('wall');
    c.fill(wp);
    c.fillStyle = P('wall-lo');
    c.fill(wp);
    c.save();
    c.clip(wp);
    c.translate(0, -e);
    c.fillStyle = P('wall');
    c.fill(wp);
    c.fillStyle = P('wall-hi');
    c.fill(wp);
    c.clip(wp); // (still shifted up) excludes the bottom band
    c.translate(0, 2 * e);
    c.fillStyle = P('wall');
    c.fill(wp);
    c.restore();

    tex = texturePattern(c, 'wall', T, dpr);
    if (tex) { c.save(); c.globalAlpha = tex.alpha; c.fillStyle = tex.pattern; c.fill(wp); c.restore(); }

    // solid walls: slightly different shade + hatch
    if (L.cells.indexOf('%') >= 0) {
      c.save();
      var sp = wallPath(function (x, y) { return cell(x, y) === '%'; }, new Path2D());
      c.clip(wp);
      c.fillStyle = P('wall-solid');
      c.fill(sp);
      c.clip(sp);
      c.beginPath();
      var step = Math.max(4, T * 0.2);
      var tot = (L.w + L.h) * T;
      for (var k = -L.h * T; k < tot; k += step) line(c, k, 0, k + L.h * T, L.h * T);
      c.strokeStyle = P('wall-hatch');
      c.lineWidth = Math.max(1, T * 0.05);
      c.stroke();
      c.restore();
    }
    this.staticReady = true;
  };

  // A texture from the art manifest (js/sprites.js) as a fill: the image is
  // rasterised at its on-screen size and repeats every `tiles` tiles, from the
  // house's top-left corner (the garden's from the canvas corner).
  function texturePattern(ctx, name, T, dpr) {
    var tx = SPR.texture(name);
    if (!tx) return null;
    var iw = tx.img.naturalWidth || tx.img.width, ih = tx.img.naturalHeight || tx.img.height;
    var w = T * tx.tiles, h = w * ih / iw;
    var pw = Math.max(2, Math.min(2048, Math.round(w * dpr))), ph = Math.max(2, Math.min(2048, Math.round(h * dpr)));
    var cv = document.createElement('canvas');
    cv.width = pw; cv.height = ph;
    var cc = cv.getContext('2d');
    cc.imageSmoothingQuality = 'high';
    cc.drawImage(tx.img, 0, 0, pw, ph);
    var pat = ctx.createPattern(cv, 'repeat');
    if (!pat) return null;
    if (pat.setTransform && root.DOMMatrix) pat.setTransform(new root.DOMMatrix([w / pw, 0, 0, h / ph, 0, 0]));
    return { pattern: pat, alpha: tx.alpha };
  }

  // --------------------------------------------- wind streaks / calm motes

  Board.prototype.stepStreaks = function (dt, motion) {
    var L = this.L, T = this.T, W = this.cssW, H = this.cssH;
    var s = L.wind.strength;
    var calm = s <= 0;
    var area = (W * H) / (T * T);
    var target = calm ? Math.round(area * 0.045) : Math.round(area * (0.035 + 0.015 * s));
    var list = this.streaks;
    var dir = L.wind.dir;
    var self = this;
    function spawn(initial) {
      var life = calm ? 5 + RAND() * 5 : 1.5 + RAND() * 1.5;
      var x = RAND() * W, y = RAND() * H;
      // favour the band just upwind of the house, where the breeze meets the wall
      if (!calm && RAND() < 0.35) {
        var depth = T * (0.4 + RAND() * 1.6);
        if (dir === 1) { x = self.ox - depth; y = self.oy + RAND() * L.h * T; }
        else if (dir === 3) { x = self.ox + L.w * T + depth; y = self.oy + RAND() * L.h * T; }
        else if (dir === 2) { y = self.oy - depth; x = self.ox + RAND() * L.w * T; }
        else { y = self.oy + L.h * T + depth; x = self.ox + RAND() * L.w * T; }
      }
      list.push({
        x: x, y: y,
        len: T * (0.4 + RAND() * 0.5),
        life: life, age: initial ? RAND() * life : 0,
        sp: 0.8 + RAND() * 0.45, ph: RAND() * TAU,
        vx: (RAND() - 0.5), vy: (RAND() - 0.5), r: 0.7 + RAND() * 0.8
      });
    }
    if (!this.streakSeeded) {
      for (var i = 0; i < target; i++) spawn(true);
      this.streakSeeded = true;
    }
    if (!motion) return;
    var speed = (calm ? T * 0.1 : (0.9 + 0.7 * s) * T) * N('wind-speed');
    for (var j = list.length - 1; j >= 0; j--) {
      var st = list[j];
      st.age += dt;
      if (calm) {
        st.x += st.vx * speed * dt; st.y += st.vy * speed * dt;
      } else {
        st.x += DX[dir] * speed * st.sp * dt; st.y += DY[dir] * speed * st.sp * dt;
      }
      if (st.age >= st.life) { list[j] = list[list.length - 1]; list.pop(); }
    }
    while (list.length < target) spawn(false);
  };

  var STREAK_PARTS = [[0, 0.34, 1, 1], [0.34, 0.68, 0.55, 0.8], [0.68, 1, 0.22, 0.6]];
  Board.prototype.drawStreaks = function (ctx, t) {
    var L = this.L, T = this.T;
    var s = L.wind.strength;
    var list = this.streaks;
    var col = mix(P('streak'), P('air'), 0.5);
    ctx.save();
    ctx.lineCap = 'round';
    if (s <= 0) {
      ctx.fillStyle = mix(P('streak'), P('air'), 0.6);
      var r0 = Math.max(2, T * 0.06);
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        ctx.globalAlpha = Math.sin(Math.PI * m.age / m.life) * 0.8;
        var bob = Math.sin(t * 0.8 + m.ph) * T * 0.08;
        ctx.beginPath(); circle(ctx, m.x, m.y + bob, r0 * m.r); ctx.fill();
      }
    } else {
      var dir = L.wind.dir, dx = DX[dir], dy = DY[dir], px = -dy, py = dx;
      var lw = Math.max(1.5, T * (0.04 + 0.008 * s));
      ctx.strokeStyle = col;
      // comet streaks: bright head, fading tail (three passes)
      var parts = STREAK_PARTS;
      for (var p = 0; p < 3; p++) {
        var a0 = parts[p][0], a1 = parts[p][1];
        ctx.lineWidth = lw * parts[p][3];
        ctx.globalAlpha = 1;
        for (var k = 0; k < list.length; k++) {
          var st = list[k];
          var al = Math.sin(Math.PI * st.age / st.life) * parts[p][2] * 0.9;
          if (al < 0.02) continue;
          var wob = Math.sin(t * 1.7 + st.ph) * T * 0.07;
          var w0 = wob * (1 - a0) , w1 = wob * (1 - a1);
          ctx.globalAlpha = al;
          ctx.beginPath();
          ctx.moveTo(st.x - dx * st.len * a0 + px * w0 * 0.3, st.y - dy * st.len * a0 + py * w0 * 0.3);
          ctx.lineTo(st.x - dx * st.len * a1 + px * w1, st.y - dy * st.len * a1 + py * w1);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  };

  // --------------------------------------------- animation state per object/piece

  Board.prototype.animFor = function (key, initFn, arg) {
    var a = this.anim[key];
    if (!a) a = this.anim[key] = initFn ? initFn(arg) : {};
    return a;
  };

  function newPieceAnim() { return { angle: RAND() * TAU, sway: 0 }; }
  function newObjAnim(gl) {
    var f = gl.flow;
    return {
      angle: RAND() * TAU, spd: 0, lit: f > 0 ? 0 : 1, dry: f >= 2 ? 1 : 0,
      scatter: f >= 2 ? 1 : 0, flutter: f === 1 ? 1 : 0, bend: f >= 2 ? 1 : 0, sway: f === 1 ? 1 : 0,
      state: gl.state, stateT: -1e9, flow: f, haze: gl.state !== 'happy' ? 1 : 0, soot: gl.smoky ? 1 : 0,
      dirx: 0, diry: 0, small: false, px: 0
    };
  }
  var NO_GOAL = { flow: 0, state: 'idle', ok: false };
  var GLYPH_OPT = {}, PIP_OPT = {}, STALL_OPT = {};

  // ------------------------------------------------------------------ draw

  /*
   * S = {
   *   pieces: [{type,x,y,d,fixed}],   // everything to draw (lifted piece excluded)
   *   sim: Result,                    // simulation to visualise
   *   valid: [{x,y}] | null,          // placement cells; validWall: true for wall mounts
   *   ghost: {type,x,y,d,ok,ring} | null,  // preview under the pointer (ring: dragged by a finger)
   *   hint: {type,x,y,d,from?:{x,y}} | null,  // from: a hinted move, drawn with an arrow
   *   conflicts: [{x,y,soft?}] | null,         // soft: it helps right now (no ×)
   *   hover: {x,y} | null, cursor: {x,y} | null, focus: {type|cell,t0} | null, spot: {x,y,t0} | null,
   *   pops: {key: t0}, shake: {x,y,t0} | null, flash: {x,y,t0} | null, pulse: t0 | null,
   *   win: t0 | null, reduced: bool
   * }
   */
  Board.prototype.draw = function (S, now) {
    var L = this.L;
    if (!L || !this.cssW) return;
    SETTLE = typeof root.__wbFreezeTime === 'number';
    RAND = Math.random;
    if (SETTLE) {
      now = root.__wbFreezeTime;
      this.lastNow = now;
      this.anim = {}; this.streaks = []; this.streakSeeded = false;
      RAND = rng(this.seed * 7919 + 17);
    }
    var ctx = this.ctx, T = this.T, dpr = this.dpr;
    var t = now / 1000;
    var dt = this.lastNow ? clamp((now - this.lastNow) / 1000, 0, 0.1) : 0.016;
    this.lastNow = now;
    var motion = !S.reduced;
    var sim = S.sim;
    var A = analyze(sim, L);
    var self = this;
    var small = T < 34;
    var winAge = S.win != null ? (now - S.win) / 1000 : -1;
    var boostK = motion && winAge >= 0 && winAge < 1.3 ? Math.sin(Math.PI * clamp(winAge / 1.3, 0, 1)) : 0;
    var winBoost = N('win-boost'), idleT = t * N('idle-speed');

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.gardenLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.stepStreaks(dt, motion);
    this.drawStreaks(ctx, motion ? t * N('wind-speed') : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.houseLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.ox, this.oy);

    var flowT = motion ? t * N('flow-speed') : 0;
    var i, p;

    // ---------------- placement highlights
    if (S.valid && S.valid.length) {
      var pulse = S.pulse != null && motion ? clamp(1 - (now - S.pulse) / 900, 0, 1) : 0;
      var pk = pulse ? 0.5 + 0.5 * Math.sin((now - S.pulse) / 900 * Math.PI * 4 - Math.PI / 2) : 0;
      ctx.save();
      if (S.validWall) {
        ctx.beginPath();
        for (i = 0; i < S.valid.length; i++) rr(ctx, S.valid[i].x * T + T * 0.13, S.valid[i].y * T + T * 0.13, T * 0.74, T * 0.74, T * 0.2);
        ctx.fillStyle = P('hl-wall');
        ctx.globalAlpha = 0.85 + 0.15 * pk;
        ctx.fill();
        ctx.lineWidth = Math.max(1.1, T * 0.03) * (1 + pk);
        ctx.strokeStyle = P('hl-edge');
        ctx.stroke();
      }
      ctx.globalAlpha = S.validWall ? 1 : 0.85 + 0.15 * pk;
      ctx.beginPath();
      var dr = Math.max(2, T * 0.06) * (1 + 0.6 * pk);
      for (i = 0; i < S.valid.length; i++) circle(ctx, (S.valid[i].x + 0.5) * T, (S.valid[i].y + 0.5) * T, dr);
      ctx.fillStyle = S.validWall ? P('surface') : P('hl-edge');
      ctx.fill();
      ctx.restore();
    }
    // filled tile under the ghost; dragged by a finger, also a clear ring a
    // little wider than the cell, so it shows around the fingertip
    if (S.ghost && S.ghost.ok) {
      ctx.beginPath(); rr(ctx, S.ghost.x * T + T * 0.06, S.ghost.y * T + T * 0.06, T * 0.88, T * 0.88, T * 0.22);
      ctx.fillStyle = P('hl');
      ctx.fill();
      if (S.ghost.ring) {
        var ro = T * 0.14;
        ctx.save();
        ctx.beginPath(); rr(ctx, S.ghost.x * T - ro, S.ghost.y * T - ro, T + 2 * ro, T + 2 * ro, T * 0.32);
        ctx.strokeStyle = P('accent');
        ctx.lineWidth = Math.max(2.5, T * 0.07);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---------------- piece bases (floor tools)
    var pieces = S.pieces || [];
    var unitPx = 1 / T;

    function pieceTransform(p) {
      var cx = (p.x + 0.5) * T, cy = (p.y + 0.5) * T;
      var sc = 1, ox = 0;
      if (motion) {
        var pt = S.pops && S.pops[p.x + ',' + p.y];
        if (pt != null) {
          var age = (now - pt) / 240;
          if (age < 1) sc = 0.85 + 0.15 * easeOutBack(age);
        }
        if (S.shake && S.shake.x === p.x && S.shake.y === p.y) {
          var sa = (now - S.shake.t0) / 420;
          if (sa < 1) ox = Math.sin(sa * Math.PI * 7) * T * 0.07 * (1 - sa);
        }
      }
      ctx.translate(cx + ox, cy);
      ctx.scale(T * sc, T * sc);
    }

    var baseOpt = GLYPH_OPT;
    baseOpt.px = unitPx;
    for (i = 0; i < pieces.length; i++) {
      p = pieces[i];
      if (isWallTool(p.type)) continue;
      baseOpt.fixed = p.fixed;
      ctx.save(); pieceTransform(p); SPR.draw('piece.base', ctx, baseOpt); ctx.restore();
    }

    // ---------------- airflow
    this.drawFlows(ctx, A, T, flowT, motion, t, boostK);
    // smoke collecting where smoky air hits a wall: under pieces and objects,
    // so an object next to that wall stays readable
    this.drawSmokeEnds(ctx, A, T, flowT);

    // ---------------- pieces
    for (i = 0; i < pieces.length; i++) {
      p = pieces[i];
      var a = this.animFor('p' + p.type + p.x + ',' + p.y, newPieceAnim);
      var ci = p.y * L.w + p.x;
      var f = WB.isFloorish(WB.cellAt(L, p.x, p.y)) ? sim.flow[ci] : 0;
      if (motion) {
        var spin = 1 + 1.5 * boostK * winBoost;
        if (p.type === 'fan') a.angle += dt * (3 + 3.5 * f) * N('spin-fan') * spin;
        else if (p.type === 'extractor') a.angle += dt * 4.5 * N('spin-extractor') * spin;
        else if (p.type === 'ceilingfan') a.angle += dt * 1.4 * N('spin-ceilingfan') * spin;
      }
      var di = ci * 2;
      if (p.type === 'curtain') {
        var dvx = clamp(A.dir[di] + A.dir[di + 1] * 0.5, -1, 1);
        var target = motion ? (0.02 + 0.045 * Math.min(f, 3)) * Math.sin(idleT * (1.6 + f * 1.4) + p.x) + dvx * 0.05 * Math.min(f, 3) : 0;
        a.sway = approach(a.sway, target, 6, dt);
      }
      var o = GLYPH_OPT;
      o.px = unitPx; o.fixed = p.fixed; o.d = p.d | 0; o.angle = a.angle; o.sway = a.sway; o.icon = false;
      o.outward = (p.type === 'window' || p.type === 'extractor') ? WB.outwardDir(L, p.x, p.y) : -1;
      o.role = p.type === 'window' ? WB.windowRole(L, p) : null;
      o.horiz = p.type === 'vent' ? WB.isFloorish(WB.cellAt(L, p.x - 1, p.y)) && WB.isFloorish(WB.cellAt(L, p.x + 1, p.y)) : true;
      o.inDir = null;
      if (p.type === 'splitter') {
        var vx = A.dir[di], vy = A.dir[di + 1];
        if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) o.inDir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : (vy > 0 ? 2 : 0);
      }
      ctx.save(); pieceTransform(p); SPR.draw(TOOL_SPRITE[p.type], ctx, o); ctx.restore();
    }

    this.drawBumps(ctx, A, T, pieces, t, motion);
    this.drawStallMarkers(ctx, A, T, sim.solved, S.valid);

    // ---------------- objects
    var goals = sim.goals || [];
    var objScale = (small ? 1.16 : 1.06) * N('object-scale');
    for (i = 0; i < L.objects.length; i++) {
      var ob = L.objects[i];
      var gl = goals[i] || NO_GOAL;
      var fo = gl.flow;
      var an = this.animFor('o' + ob.x + ',' + ob.y, newObjAnim, gl);
      if (an.state !== gl.state) { an.state = gl.state; an.stateT = now; }
      an.flow = fo;
      an.small = small;
      an.px = 1 / (T * objScale);
      var odi = (ob.y * L.w + ob.x) * 2;
      var ovx = A.dir[odi], ovy = A.dir[odi + 1], vl = Math.hypot(ovx, ovy);
      an.dirx = vl ? ovx / vl : 0; an.diry = vl ? ovy / vl : 0;
      an.spd = approach(an.spd, fo * 3.2 * N('spin-pinwheel') * (1 + 1.5 * boostK * winBoost), 2.2, dt);
      if (motion) an.angle += an.spd * dt;
      an.lit = approach(an.lit, fo > 0 ? 0 : 1, 5, dt);
      an.dry = approach(an.dry, fo >= 2 ? 1 : 0, 2.5, dt);
      an.scatter = approach(an.scatter, fo >= 2 ? 1 : 0, 3, dt);
      an.flutter = approach(an.flutter, fo >= 1 ? 1 : 0, 4, dt);
      an.bend = approach(an.bend, fo >= 2 ? 1 : 0, 3, dt);
      an.sway = approach(an.sway, fo >= 1 ? 1 : 0, 3, dt);
      an.soot = approach(an.soot || 0, gl.smoky ? 1 : 0, 3, dt);

      var cx = (ob.x + 0.5) * T, cy = (ob.y + 0.5) * T;
      var hop = 0;
      if (winAge >= 0 && winAge < 1.6 && motion) {
        var ha = winAge - i * 0.08;
        if (ha > 0 && ha < 0.9) hop = -Math.abs(Math.sin(ha / 0.45 * Math.PI)) * T * 0.16 * (1 - ha / 0.9);
        // a soft bloom behind each happy object
        var ba = winAge - i * 0.08;
        if (ba > 0 && ba < 1.2) {
          var bk = Math.sin(Math.PI * ba / 1.2);
          var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, T * 0.95);
          bg.addColorStop(0, alpha(P('accent'), 0.28 * bk));
          bg.addColorStop(1, alpha(P('accent'), 0));
          ctx.fillStyle = bg;
          ctx.beginPath(); circle(ctx, cx, cy, T * 0.95); ctx.fill();
        }
      }
      var ot = motion ? idleT : 0.4;
      if (ob.type === 'stove') this.drawStoveSmoke(ctx, ob, gl, an, T, ot, motion, dt);
      var lift = METER[ob.type] ? (small ? 0.07 : 0.05) : 0;
      ctx.save();
      ctx.translate(cx, cy + hop - lift * T);
      ctx.scale(T * objScale, T * objScale);
      SPR.draw(OBJ_SPRITE[ob.type], ctx, an, ot);
      ctx.restore();
    }

    // goal focus rings (tapping a goal in the strip)
    if (S.focus) {
      var fa = (now - S.focus.t0) / 1800;
      if (fa < 1) {
        ctx.save();
        ctx.lineWidth = Math.max(2, T * 0.06);
        ctx.strokeStyle = P('accent');
        ctx.globalAlpha = Math.min(1, (1 - fa) * 2.5);
        var grow = motion ? 0.06 * Math.sin(fa * Math.PI * 4) : 0;
        ctx.beginPath();
        // a kind of object (a goal chip, a hint about it), or one cell (where a hint points)
        var fc = S.focus.cell ? [S.focus.cell] : L.objects.filter(function (o) { return o.type === S.focus.type; });
        for (i = 0; i < fc.length; i++) {
          rr(ctx, (fc[i].x - grow) * T + T * 0.02, (fc[i].y - grow) * T + T * 0.02, T * (0.96 + 2 * grow), T * (0.96 + 2 * grow), T * 0.26);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // status pips and requirement meters
    for (i = 0; i < L.objects.length; i++) {
      var obj = L.objects[i];
      var g2 = goals[i] || NO_GOAL;
      var a2 = this.anim['o' + obj.x + ',' + obj.y];
      var wa = winAge >= 0 && motion ? winAge - i * 0.08 : -1;
      // on tiny tiles a happy object's meter would spill onto the next tile;
      // its green tick already says enough
      if (!(small && g2.state === 'happy')) this.drawMeter(ctx, obj, g2, T);
      this.drawPip(ctx, obj, g2.smoky && g2.state === 'bad' ? 'dirty' : g2.state, a2 && motion ? (now - a2.stateT) / 1000 : 9, T, small, wa);
    }

    // ---------------- guide spot: a soft ring breathing where a coach bubble points
    if (S.spot) {
      var sp = S.spot;
      // (a frozen moment, for the visual check, draws it at rest)
      var sk = motion && !SETTLE ? 0.5 + 0.5 * Math.sin((now - (sp.t0 || 0)) / 1000 * Math.PI * 1.4) : 0.6;
      var sg = T * 0.05 * sk;
      ctx.save();
      ctx.beginPath(); rr(ctx, sp.x * T - sg, sp.y * T - sg, T + 2 * sg, T + 2 * sg, T * 0.26);
      ctx.strokeStyle = P('accent');
      ctx.globalAlpha = 0.5 + 0.45 * sk;
      ctx.lineWidth = Math.max(2, T * 0.06);
      ctx.stroke();
      ctx.restore();
    }

    // ---------------- conflicting pieces (hint): a dashed outline and a small ×;
    // a piece that makes something happy right now (soft) gets a quiet outline only
    if (S.conflicts && S.conflicts.length) {
      ctx.save();
      ctx.lineWidth = Math.max(1.6, T * 0.05);
      ctx.setLineDash([T * 0.12, T * 0.08]);
      ctx.lineDashOffset = motion ? -t * T * 0.25 : 0;
      for (var soft = 0; soft < 2; soft++) {
        ctx.beginPath();
        for (i = 0; i < S.conflicts.length; i++) {
          if (!!S.conflicts[i].soft !== !!soft) continue;
          rr(ctx, S.conflicts[i].x * T + T * 0.02, S.conflicts[i].y * T + T * 0.02, T * 0.96, T * 0.96, T * 0.22);
        }
        ctx.strokeStyle = soft ? alpha(P('ink'), 0.4) : P('accent-2');
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (i = 0; i < S.conflicts.length; i++) {
        if (S.conflicts[i].soft) continue;
        var kx = (S.conflicts[i].x + 0.92) * T, ky = (S.conflicts[i].y + 0.08) * T, kr = Math.max(5, T * 0.13);
        ctx.beginPath(); circle(ctx, kx, ky, kr);
        ctx.fillStyle = P('accent-2'); ctx.fill();
        ctx.beginPath();
        line(ctx, kx - kr * 0.4, ky - kr * 0.4, kx + kr * 0.4, ky + kr * 0.4);
        line(ctx, kx + kr * 0.4, ky - kr * 0.4, kx - kr * 0.4, ky + kr * 0.4);
        ctx.strokeStyle = P('mark');
        ctx.lineWidth = Math.max(1.3, kr * 0.28);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---------------- hint ghost (a hinted move: with a soft arrow from where the piece is)
    if (S.hint) {
      var hp = motion ? 0.5 + 0.5 * Math.sin(t * 4) : 0.6;
      var hx = S.hint.x, hy = S.hint.y;
      if (S.hint.from) this.drawMoveArrow(ctx, S.hint.from, S.hint, T, motion ? t : 0);
      ctx.save();
      ctx.beginPath(); rr(ctx, hx * T + T * 0.03, hy * T + T * 0.03, T * 0.94, T * 0.94, T * 0.2);
      ctx.lineWidth = Math.max(1.5, T * 0.05);
      ctx.strokeStyle = P('accent');
      ctx.setLineDash([T * 0.14, T * 0.1]);
      ctx.lineDashOffset = motion ? -t * T * 0.3 : 0;
      ctx.globalAlpha = 0.6 + 0.4 * hp;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.35 + 0.35 * hp;
      this.drawPieceAt(ctx, S.hint, T, t);
      ctx.restore();
    }

    // ---------------- ghost preview
    if (S.ghost) {
      var gh = S.ghost;
      ctx.save();
      if (gh.ok) {
        ctx.globalAlpha = 0.7;
        this.drawPieceAt(ctx, gh, T, t);
      } else if (gh.x >= 0 && gh.y >= 0 && gh.x < L.w && gh.y < L.h) {
        ctx.beginPath(); rr(ctx, gh.x * T + T * 0.08, gh.y * T + T * 0.08, T * 0.84, T * 0.84, T * 0.18);
        ctx.strokeStyle = alpha(P('bad'), 0.7);
        ctx.lineWidth = Math.max(1.5, T * 0.045);
        ctx.stroke();
        ctx.globalAlpha = 0.3;
        this.drawPieceAt(ctx, gh, T, t);
      }
      ctx.restore();
    }

    // ---------------- invalid tap / drop: a red ring that shakes and fades
    if (S.flash) {
      var fl = S.flash;
      var fa2 = (now - fl.t0) / 450;
      if (fa2 < 1 && fl.x >= 0 && fl.y >= 0 && fl.x < L.w && fl.y < L.h) {
        var fo2 = motion ? Math.sin(fa2 * Math.PI * 6) * T * 0.07 * (1 - fa2) : 0;
        ctx.save();
        ctx.translate(fo2, 0);
        ctx.globalAlpha = 1 - fa2;
        ctx.beginPath(); rr(ctx, fl.x * T + T * 0.08, fl.y * T + T * 0.08, T * 0.84, T * 0.84, T * 0.18);
        ctx.strokeStyle = P('bad');
        ctx.lineWidth = Math.max(1.5, T * 0.045);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---------------- hover / keyboard cursor
    if (S.hover && !S.ghost) {
      var hv = S.hover;
      if (hv.x >= 0 && hv.y >= 0 && hv.x < L.w && hv.y < L.h) {
        var onWall = WB.isWall(WB.cellAt(L, hv.x, hv.y));
        ctx.beginPath(); rr(ctx, hv.x * T + T * 0.05, hv.y * T + T * 0.05, T * 0.9, T * 0.9, T * 0.2);
        ctx.strokeStyle = onWall ? alpha(P('mark'), 0.45) : alpha(P('ink'), 0.22);
        ctx.lineWidth = Math.max(1.2, T * 0.035);
        ctx.stroke();
      }
    }
    if (S.cursor) {
      var cu = S.cursor;
      ctx.beginPath(); rr(ctx, cu.x * T + T * 0.03, cu.y * T + T * 0.03, T * 0.94, T * 0.94, T * 0.2);
      ctx.strokeStyle = P('accent');
      ctx.lineWidth = Math.max(2, T * 0.06);
      ctx.stroke();
    }

    // ---------------- win sparkles
    if (winAge >= 0 && winAge < 1.6 && motion) {
      for (i = 0; i < L.objects.length; i++) {
        var so = L.objects[i];
        var r2 = rng(i * 97 + 13);
        for (var k = 0; k < 4; k++) {
          var sa2 = winAge - i * 0.08 - k * 0.11;
          if (sa2 < 0 || sa2 > 0.8) continue;
          var ang = r2() * TAU, ds = 0.5 + r2() * 0.25 + sa2 * 0.25;
          var sx = (so.x + 0.5 + Math.cos(ang) * ds) * T, sy = (so.y + 0.5 + Math.sin(ang) * ds) * T;
          var sz = Math.max(4, T * 0.18) * Math.sin(sa2 / 0.8 * Math.PI);
          ctx.beginPath();
          ctx.moveTo(sx, sy - sz); ctx.quadraticCurveTo(sx, sy, sx + sz, sy);
          ctx.quadraticCurveTo(sx, sy, sx, sy + sz); ctx.quadraticCurveTo(sx, sy, sx - sz, sy);
          ctx.quadraticCurveTo(sx, sy, sx, sy - sz);
          ctx.fillStyle = k % 2 ? P('o-sun') : P('accent');
          ctx.fill();
        }
      }
    }
  };

  // A dashed arrow from one cell to another (a hinted move), stopping at the
  // edges of both so the pieces stay clear.
  Board.prototype.drawMoveArrow = function (ctx, a, b, T, t) {
    var ax = (a.x + 0.5) * T, ay = (a.y + 0.5) * T, bx = (b.x + 0.5) * T, by = (b.y + 0.5) * T;
    var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < T * 1.2) return;
    var ux = dx / len, uy = dy / len, px = -uy, py = ux;
    // a gentle bow, so an arrow along a wall does not sit on the wall line
    var bow = Math.min(len * 0.18, T * 0.9);
    var sx = ax + ux * T * 0.5, sy = ay + uy * T * 0.5, ex = bx - ux * T * 0.56, ey = by - uy * T * 0.56;
    var cx = (sx + ex) / 2 + px * bow, cy = (sy + ey) / 2 + py * bow;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = P('accent');
    ctx.lineWidth = Math.max(2, T * 0.06);
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([T * 0.14, T * 0.12]);
    ctx.lineDashOffset = -t * T * 0.4;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    // the head, along the curve's last stretch
    var hx = ex - cx, hy = ey - cy, hl = Math.hypot(hx, hy) || 1;
    hx /= hl; hy /= hl;
    var hs = Math.max(6, T * 0.2);
    ctx.beginPath();
    ctx.moveTo(ex - hx * hs - hy * hs * 0.7, ey - hy * hs + hx * hs * 0.7);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - hx * hs + hy * hs * 0.7, ey - hy * hs - hx * hs * 0.7);
    ctx.stroke();
    ctx.restore();
  };

  Board.prototype.drawPieceAt = function (ctx, p, T, t) {
    var L = this.L;
    ctx.save();
    ctx.translate((p.x + 0.5) * T, (p.y + 0.5) * T);
    ctx.scale(T, T);
    var o = { px: 1 / T, fixed: false };
    if (!isWallTool(p.type)) SPR.draw('piece.base', ctx, o);
    var out = (p.type === 'window' || p.type === 'extractor') ? WB.outwardDir(L, p.x, p.y) : -1;
    o.d = p.d | 0; o.angle = t * 1.5; o.sway = 0; o.outward = out;
    o.role = p.type === 'window' ? (out >= 0 ? WB.windowRole(L, p) : 'outlet') : null;
    o.horiz = p.type === 'vent' ? WB.isFloorish(WB.cellAt(L, p.x - 1, p.y)) && WB.isFloorish(WB.cellAt(L, p.x + 1, p.y)) : true;
    SPR.draw(TOOL_SPRITE[p.type], ctx, o);
    ctx.restore();
  };

  // --------------------------------------------- airflow drawing
  //
  // A stream of strength s is drawn as s parallel lanes (up to 4) of soft
  // comet-like streaks on a pale bed, so "gentle / strong / gale" can be counted.

  function speedFor(s) { return 0.7 + 0.5 * Math.min(s, 4); }
  var PERIOD = 0.62, STREAK = 0.36;

  Board.prototype.drawFlows = function (ctx, A, T, t, motion, realT, boostK) {
    var i, j, sg, run;
    var lw = Math.max(1.7, T * 0.062) * N('stream-width') * (1 + 0.35 * boostK);
    var gap = Math.max(lw + 1.8, T * 0.14);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // stalled inlets: a faint static dashed line and a "no way out" marker.
    // The line stops short of every object, so it never looks like air reaches it.
    if (A.stalled.length) {
      var objs = this.L.objects;
      ctx.save();
      ctx.beginPath();
      ctx.rect(-T, -T, (this.L.w + 2) * T, (this.L.h + 2) * T);
      for (i = 0; i < objs.length; i++) circle(ctx, (objs[i].x + 0.5) * T, (objs[i].y + 0.5) * T, T * 0.4);
      ctx.clip('evenodd');
      ctx.beginPath();
      for (i = 0; i < A.stalled.length; i++) {
        sg = A.stalled[i];
        line(ctx, sg.hx / 2 * T, sg.hy / 2 * T, (sg.hx + DX[sg.d]) / 2 * T, (sg.hy + DY[sg.d]) / 2 * T);
      }
      ctx.setLineDash([T * 0.07, T * 0.18]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = alpha(P('air'), 0.6);
      ctx.lineWidth = Math.max(1.3, T * 0.05);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    var runs = A.runs;
    if (runs.length) {
      // soft beds
      var beds = {};
      for (i = 0; i < runs.length; i++) {
        run = runs[i];
        var nl = Math.min(run.s, 4);
        var bk = (run.smoke ? 's' : 'a') + nl;
        var bp = beds[bk] || (beds[bk] = { path: new Path2D(), n: nl, smoke: run.smoke });
        bp.path.moveTo(run.ax * T, run.ay * T);
        bp.path.lineTo(run.bx * T, run.by * T);
      }
      var bedA = 0.2 + 0.15 * boostK;
      for (var key in beds) {
        var b = beds[key];
        ctx.strokeStyle = alpha(b.smoke ? P('smoke') : P('air'), b.smoke ? bedA + 0.05 : bedA);
        ctx.lineWidth = (b.n - 1) * gap + lw + T * 0.16;
        ctx.stroke(b.path);
      }

      if (motion) {
        // moving comet streaks, phase-aligned with the path distance
        var heads = [new Path2D(), new Path2D()], tails = [new Path2D(), new Path2D()];
        var vb = 1 + 0.6 * boostK * N('win-boost');
        for (i = 0; i < runs.length; i++) {
          run = runs[i];
          var n = Math.min(run.s, 4), v = speedFor(run.s) * vb;
          var px = -run.dy, py = run.dx, ci = run.smoke ? 1 : 0;
          for (j = 0; j < n; j++) {
            var off = (j - (n - 1) / 2) * gap;
            var ox = run.ax * T + px * off, oy = run.ay * T + py * off;
            var stag = n > 1 ? (j * 0.37) * PERIOD : 0;
            var first = mod(v * t - run.dist - stag, PERIOD);
            for (var u = first; u < run.len + STREAK; u += PERIOD) {
              var gid = Math.round((run.dist + u - v * t + stag) / PERIOD) + j * 17;
              var sl = STREAK * (0.8 + 0.4 * hash01(gid));
              var hd = Math.min(u, run.len), md = clamp(u - sl * 0.45, 0, run.len), tl = clamp(u - sl, 0, run.len);
              if (hd > md) {
                heads[ci].moveTo(ox + run.dx * md * T, oy + run.dy * md * T);
                heads[ci].lineTo(ox + run.dx * hd * T, oy + run.dy * hd * T);
              }
              if (md > tl) {
                tails[ci].moveTo(ox + run.dx * tl * T, oy + run.dy * tl * T);
                tails[ci].lineTo(ox + run.dx * md * T, oy + run.dy * md * T);
              }
            }
          }
        }
        for (var c2 = 0; c2 < 2; c2++) {
          var colr = c2 ? P('smoke') : P('air');
          ctx.strokeStyle = alpha(colr, 0.42);
          ctx.lineWidth = lw * 0.8;
          ctx.stroke(tails[c2]);
          ctx.strokeStyle = colr;
          ctx.lineWidth = lw;
          ctx.stroke(heads[c2]);
        }
      } else {
        // reduced motion: solid lanes and direction chevrons (a dashed line
        // only ever means a breeze that is stuck)
        for (var c3 = 0; c3 < 2; c3++) {
          var lanes = new Path2D(), chev = new Path2D();
          for (i = 0; i < runs.length; i++) {
            run = runs[i];
            if ((run.smoke ? 1 : 0) !== c3) continue;
            var n2 = Math.min(run.s, 4), qx = -run.dy, qy = run.dx;
            for (j = 0; j < n2; j++) {
              var o2 = (j - (n2 - 1) / 2) * gap;
              lanes.moveTo(run.ax * T + qx * o2, run.ay * T + qy * o2);
              lanes.lineTo(run.bx * T + qx * o2, run.by * T + qy * o2);
            }
            if (run.len >= 0.9) {
              var mx = (run.ax + run.bx) / 2 * T, my = (run.ay + run.by) / 2 * T, cs = T * 0.1 + (n2 - 1) * gap * 0.5;
              chev.moveTo(mx - run.dx * cs * 0.7 - run.dy * cs, my - run.dy * cs * 0.7 + run.dx * cs);
              chev.lineTo(mx + run.dx * cs * 0.3, my + run.dy * cs * 0.3);
              chev.lineTo(mx - run.dx * cs * 0.7 + run.dy * cs, my - run.dy * cs * 0.7 - run.dx * cs);
            }
          }
          var col3 = c3 ? P('smoke') : P('air');
          ctx.strokeStyle = col3;
          ctx.lineWidth = lw;
          ctx.stroke(lanes);
          ctx.strokeStyle = c3 ? darker(col3, 0.2) : P('air-deep');
          ctx.lineWidth = Math.max(1.4, T * 0.045);
          ctx.stroke(chev);
        }
      }

      // smoke puffs travelling along smoky runs
      ctx.fillStyle = alpha(P('smoke'), 0.42);
      for (i = 0; i < runs.length; i++) {
        run = runs[i];
        if (!run.smoke) continue;
        var per = 0.7;
        var ph = (run.dist - speedFor(run.s) * t * 0.85);
        var f0 = Math.ceil(ph / per) * per - ph;
        for (var uu = f0; uu < run.len; uu += per) {
          var ppx = run.ax + run.dx * uu, ppy = run.ay + run.dy * uu;
          var kk = Math.floor((uu + ph) / per);
          var wob = Math.sin(kk * 1.7 + realT * 2) * 0.06;
          ctx.beginPath();
          circle(ctx, (ppx - run.dy * wob) * T, (ppy + run.dx * wob) * T, T * (0.1 + 0.03 * Math.sin(kk * 2.3)));
          ctx.fill();
        }
      }
    }

    // outlet ends: air fading out into the garden (or up through a skylight)
    for (i = 0; i < A.outEnds.length; i++) {
      var oe = A.outEnds[i];
      var col = oe.smoke ? P('smoke') : P('air');
      if (oe.sky) {
        for (var k = 0; k < 2; k++) {
          var pr = motion ? ((t * 0.7 + k * 0.5) % 1) : 0.35 + k * 0.3;
          ctx.beginPath(); circle(ctx, oe.x * T, oe.y * T, T * (0.08 + 0.3 * pr));
          ctx.strokeStyle = alpha(col, 0.65 * (1 - pr));
          ctx.lineWidth = Math.max(1.2, T * 0.04);
          ctx.stroke();
        }
        continue;
      }
      if (oe.d < 0) continue;
      var no = Math.min(oe.s, 4), opx = -oe.dy, opy = oe.dx;
      var len = 0.8;
      for (j = 0; j < no; j++) {
        var oo = (j - (no - 1) / 2) * gap;
        for (var q = 0; q < 2; q++) {
          var pp = motion ? ((t * speedFor(oe.s) / len * 0.45 + q / 2 + j * 0.23) % 1) : 0.25 + q * 0.4;
          var a0 = pp * len, a1 = Math.min(len, a0 + 0.24);
          ctx.beginPath();
          line(ctx, oe.x * T + oe.dx * a0 * T + opx * oo, oe.y * T + oe.dy * a0 * T + opy * oo,
            oe.x * T + oe.dx * a1 * T + opx * oo, oe.y * T + oe.dy * a1 * T + opy * oo);
          ctx.strokeStyle = alpha(col, 0.85 * (1 - pp));
          ctx.lineWidth = lw * (1 - pp * 0.4);
          ctx.stroke();
        }
      }
    }

    // blocked ends of active flows: soft ripples bumping against the wall face
    for (i = 0; i < A.blockEnds.length; i++) {
      var be = A.blockEnds[i];
      if (be.d < 0) continue;
      var bx = be.x * T, by = be.y * T;
      var nb = Math.min(be.s, 4);
      var br = Math.max(5, T * 0.16) + (nb - 1) * gap * 0.5;
      var base = Math.atan2(-be.dy, -be.dx);
      var ph = motion ? (realT * 0.9 + i * 0.37) % 1 : 0.5;
      var bcol = be.smoke ? darker(P('smoke'), 0.1) : P('air-deep');
      for (var rp = 0; rp < 2; rp++) {
        var q2 = (ph + rp * 0.5) % 1;
        var rad = br * (0.45 + 0.75 * q2);
        ctx.beginPath();
        ctx.arc(bx, by, rad, base - 1.05, base + 1.05);
        ctx.strokeStyle = alpha(bcol, 0.75 * Math.sin(Math.PI * q2));
        ctx.lineWidth = Math.max(1.3, T * 0.04);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  // A stream stopped by a wall right where a piece stands (a fan pointed
  // straight into the wall next to it): its last half tile is hidden under the
  // piece, so it would look as if nothing happens. Its bump is drawn on top:
  // soft ripples against the wall face and a quiet × on the wall.
  Board.prototype.drawBumps = function (ctx, A, T, pieces, realT, motion) {
    if (!A.blockEnds.length || !pieces.length) return;
    var L = this.L, at = {}, i;
    for (i = 0; i < pieces.length; i++) at[pieces[i].x + ',' + pieces[i].y] = true;
    for (i = 0; i < A.blockEnds.length; i++) {
      var be = A.blockEnds[i];
      if (be.d < 0 || !at[Math.floor(be.x - be.dx * 0.25) + ',' + Math.floor(be.y - be.dy * 0.25)]) continue;
      if (!WB.isWall(WB.cellAt(L, Math.floor(be.x + be.dx * 0.25), Math.floor(be.y + be.dy * 0.25)))) continue; // a wall face, not a curtain
      var bx = be.x * T, by = be.y * T, base = Math.atan2(-be.dy, -be.dx);
      var br = Math.max(5, T * 0.17);
      var ph = motion ? (realT * 0.9 + i * 0.37) % 1 : 0.5;
      ctx.save();
      ctx.lineCap = 'round';
      for (var rp = 0; rp < 2; rp++) {
        var q = (ph + rp * 0.5) % 1;
        ctx.beginPath();
        ctx.arc(bx, by, br * (0.5 + 0.8 * q), base - 1.05, base + 1.05);
        ctx.strokeStyle = alpha(be.smoke ? darker(P('smoke'), 0.1) : P('air-deep'), 0.85 * Math.sin(Math.PI * q));
        ctx.lineWidth = Math.max(1.5, T * 0.045);
        ctx.stroke();
      }
      ctx.restore();
      STALL_OPT.x = (be.x + be.dx * 0.3) * T; STALL_OPT.y = (be.y + be.dy * 0.3) * T; STALL_OPT.r = Math.max(4.5, T * 0.11); STALL_OPT.quiet = true;
      SPR.draw('ui.stall', ctx, STALL_OPT);
    }
  };

  // "No way out" markers of stalled inlets: inside the wall (or window) that
  // stops the stream, drawn over pieces but under objects and their pips.
  // On a solved board an inlet left stalled is fine: the mark turns a quiet
  // grey. Over a highlighted placement slot it fades, so the slot shows.
  Board.prototype.drawStallMarkers = function (ctx, A, T, solved, valid) {
    for (var i = 0; i < A.stallEnds.length; i++) {
      var e = A.stallEnds[i];
      var mx = e.x + e.dx * 0.32, my = e.y + e.dy * 0.32;
      var onSlot = false;
      if (valid) {
        for (var k = 0; k < valid.length; k++) if (valid[k].x === Math.floor(mx) && valid[k].y === Math.floor(my)) { onSlot = true; break; }
      }
      ctx.save();
      if (onSlot) ctx.globalAlpha = 0.35;
      STALL_OPT.x = mx * T; STALL_OPT.y = my * T; STALL_OPT.r = Math.max(5.5, T * 0.13); STALL_OPT.quiet = !!solved;
      SPR.draw('ui.stall', ctx, STALL_OPT);
      ctx.restore();
    }
  };

  // A soft cloud made of overlapping puffs.
  function puffCluster(ctx, cx, cy, T, amt, t, seed, spread) {
    ctx.fillStyle = alpha(P('smoke'), 0.24 * amt);
    for (var k = 0; k < 6; k++) {
      var ang = seed + k * 1.047 + t * 0.15 * (k % 2 ? 1 : -1);
      var rad = spread * T * (0.35 + 0.3 * Math.sin(t * 0.45 + k * 1.7 + seed));
      var r = T * (0.24 + 0.06 * Math.sin(t * 0.7 + k * 2.1)) * (0.55 + 0.45 * amt);
      ctx.beginPath(); circle(ctx, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.8, r); ctx.fill();
    }
  }

  Board.prototype.drawSmokeEnds = function (ctx, A, T, t) {
    for (var i = 0; i < A.blockEnds.length; i++) {
      var be = A.blockEnds[i];
      if (!be.smoke) continue;
      puffCluster(ctx, (be.x - be.dx * 0.32) * T, (be.y - be.dy * 0.32) * T, T, 1, t, i * 2.3 + 1, 0.45);
    }
  };

  Board.prototype.drawStoveSmoke = function (ctx, ob, gl, a, T, t, motion, dt) {
    var cx = (ob.x + 0.5) * T, cy = (ob.y + 0.5) * T;
    var trapped = gl.state !== 'happy';
    var stuck = trapped && !(gl.flow > 0);
    a.haze = approach(a.haze, stuck ? 1 : 0, 1.2, dt);
    if (a.haze > 0.03) puffCluster(ctx, cx, cy - T * 0.12, T, a.haze, t, ob.x * 1.3 + ob.y * 0.7, 0.5);
    // rising puffs above the burner, carried along when air passes
    var dx = a.dirx || 0, dy = a.diry || 0;
    var carried = gl.flow > 0 && (dx || dy);
    var col = mix(P('smoke'), P('wall-light'), 0.15);
    for (var k = 0; k < 4; k++) {
      var ph = ((t * 0.42 + k / 4) % 1);
      var px, py;
      if (carried) {
        px = cx + dx * ph * T * 0.75; py = cy - T * 0.05 + dy * ph * T * 0.75 - ph * T * 0.08;
      } else {
        px = cx + Math.sin(ph * 5 + k) * T * 0.08; py = cy - T * 0.15 - ph * T * 0.7;
      }
      ctx.beginPath(); circle(ctx, px, py, T * (0.07 + 0.12 * ph));
      ctx.fillStyle = alpha(col, 0.55 * (1 - ph));
      ctx.fill();
    }
  };

  Board.prototype.drawPip = function (ctx, ob, state, age, T, small, winAge) {
    var cx = (ob.x + 0.5) * T, cy = (ob.y + 0.5) * T;
    var r = Math.max(4.5, T * 0.11) * N('pip-size');
    var px, py;
    if (small) { px = cx + T * 0.5 - r * 0.8; py = cy - T * 0.5 + r * 0.8; }
    else { px = cx + T * 0.4 - r * 0.25; py = cy - T * 0.4 + r * 0.25; }
    var pop = age < 0.35 ? 1 + 0.35 * Math.sin(age / 0.35 * Math.PI) : 1;
    if (winAge > 0 && winAge < 0.5) pop = Math.max(pop, 1 + 0.5 * Math.sin(winAge / 0.5 * Math.PI));
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(pop, pop);
    PIP_OPT.state = state; PIP_OPT.r = r;
    SPR.draw('ui.pip', ctx, PIP_OPT);
    ctx.restore();
  };

  Board.prototype.drawMeter = function (ctx, ob, gl, T) {
    if (!METER[ob.type]) return;
    ctx.save();
    ctx.translate((ob.x + 0.5) * T, (ob.y + 1) * T - Math.max(2, T * 0.06));
    meterShape(ctx, ob.type, gl.flow, gl.state, T);
    ctx.restore();
  };

  root.WBRender = {
    Board: Board,
    icon: icon,
    analyze: analyze
  };
})(typeof self !== 'undefined' ? self : this);
