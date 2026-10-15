/*
 * Windbreaker — canvas renderer.
 * Draws a board from (level, pieces, simulation result, UI state, time).
 * Keeps only cosmetic animation state (spin angles, eased values, wind streaks).
 * Exposes window.WBRender = { readPalette, Board, icon }.
 */
(function (root) {
  'use strict';

  var WB = root.WB;
  var DX = [0, 1, 0, -1];
  var DY = [-1, 0, 1, 0];
  var TAU = Math.PI * 2;

  // ------------------------------------------------------------------ palette

  var PAL_KEYS = [
    'bg', 'bg-2', 'surface', 'surface-2', 'ink', 'ink-soft', 'muted', 'accent', 'accent-2', 'good', 'bad',
    'garden', 'garden-2', 'garden-mark', 'streak', 'floor', 'floor-grid', 'wall', 'wall-solid', 'wall-hatch',
    'wall-light', 'house-shadow', 'table', 'table-edge', 'air', 'air-deep', 'smoke', 'glass', 'glass-in',
    'piece-base', 'piece-fixed', 't-fan', 't-deflector', 't-curtain', 't-vent', 't-splitter', 't-extractor',
    't-skylight', 't-filter', 't-ceilingfan', 'o-coral', 'o-sun', 'o-teal', 'o-sky', 'o-cream', 'o-flame',
    'o-leaf', 'o-leaf-sad', 'o-pot', 'o-paper', 'o-stove', 'o-stove-edge', 'pip-idle', 'hl', 'hl-edge', 'shimmer'
  ];
  var FALLBACK = {
    bg: '#f4f0e8', surface: '#fffcf6', ink: '#3a414c', 'ink-soft': '#6b727d', accent: '#379a8f',
    garden: '#dde7d5', floor: '#f7f2e8', wall: '#5b6472', air: '#6aaee0', smoke: '#a09588'
  };
  var PAL = {};
  var FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    PAL_KEYS.forEach(function (k) {
      var v = cs.getPropertyValue('--' + k).trim();
      PAL[k] = v || FALLBACK[k] || '#888888';
    });
    var f = cs.getPropertyValue('--font').trim();
    if (f) FONT = f;
    mixCache = {};
  }
  function P(k) { return PAL[k]; }

  // colour helpers (hex / rgb / rgba)
  function parseColor(c) {
    c = String(c).trim();
    var m;
    if (c.charAt(0) === '#') {
      var h = c.slice(1);
      if (h.length === 3) h = h.replace(/./g, function (x) { return x + x; });
      var n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(',').map(function (s) { return parseFloat(s); });
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    return [136, 136, 136, 1];
  }
  var mixCache = {};
  function mix(a, b, t) {
    var key = a + '|' + b + '|' + t;
    if (mixCache[key]) return mixCache[key];
    var A = parseColor(a), B = parseColor(b);
    var r = 'rgba(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ',' +
      Math.round(A[2] + (B[2] - A[2]) * t) + ',' + (A[3] + (B[3] - A[3]) * t).toFixed(3) + ')';
    mixCache[key] = r;
    return r;
  }
  function alpha(c, a) {
    var key = c + '|a|' + a;
    if (mixCache[key]) return mixCache[key];
    var A = parseColor(c);
    var r = 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + (A[3] * a).toFixed(3) + ')';
    mixCache[key] = r;
    return r;
  }
  function darker(c, t) { return mix(c, '#000000', t); }
  function lighter(c, t) { return mix(c, '#ffffff', t); }

  // ------------------------------------------------------------------ utils

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    t = clamp(t, 0, 1);
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function approach(cur, target, rate, dt) {
    return cur + (target - cur) * (1 - Math.exp(-rate * dt));
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // rounded rect path; r is a number or [tl, tr, br, bl]
  function rr(ctx, x, y, w, h, r) {
    var tl, tr, br, bl;
    if (typeof r === 'number') { tl = tr = br = bl = r; } else { tl = r[0]; tr = r[1]; br = r[2]; bl = r[3]; }
    var m = Math.min(w, h) / 2;
    tl = Math.min(tl, m); tr = Math.min(tr, m); br = Math.min(br, m); bl = Math.min(bl, m);
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    if (tr) ctx.arc(x + w - tr, y + tr, tr, -Math.PI / 2, 0); else ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - br);
    if (br) ctx.arc(x + w - br, y + h - br, br, 0, Math.PI / 2); else ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + bl, y + h);
    if (bl) ctx.arc(x + bl, y + h - bl, bl, Math.PI / 2, Math.PI); else ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + tl);
    if (tl) ctx.arc(x + tl, y + tl, tl, Math.PI, Math.PI * 1.5); else ctx.lineTo(x, y);
    ctx.closePath();
  }
  function fillRR(ctx, x, y, w, h, r, col) {
    ctx.beginPath(); rr(ctx, x, y, w, h, r); ctx.fillStyle = col; ctx.fill();
  }
  function circle(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  function line(ctx, ax, ay, bx, by) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }

  // A chevron (V) pointing in direction d, centred at x,y, size s (unit space)
  function chevron(ctx, x, y, d, s) {
    var dx = DX[d], dy = DY[d], px = -dy, py = dx;
    ctx.moveTo(x - dx * s * 0.5 + px * s, y - dy * s * 0.5 + py * s);
    ctx.lineTo(x + dx * s * 0.5, y + dy * s * 0.5);
    ctx.lineTo(x - dx * s * 0.5 - px * s, y - dy * s * 0.5 - py * s);
  }

  // ------------------------------------------------------------------ tool glyphs
  // All glyphs draw in unit space: origin = cell centre, 1 = one tile.
  // o = { T, t, fixed, d, angle, role, outward, flow, sway, dirx, diry, horiz, alpha }

  function pieceBase(ctx, o) {
    if (o.fixed) {
      fillRR(ctx, -0.44, -0.44, 0.88, 0.88, 0.17, P('piece-fixed'));
      ctx.beginPath();
      circle(ctx, -0.31, -0.31, 0.04);
      circle(ctx, 0.31, 0.31, 0.04);
      ctx.fillStyle = alpha(P('wall'), 0.55);
      ctx.fill();
    } else {
      fillRR(ctx, -0.43, -0.41, 0.86, 0.86, 0.17, 'rgba(30,35,30,0.10)');
      fillRR(ctx, -0.43, -0.44, 0.86, 0.86, 0.17, P('piece-base'));
    }
  }

  function glyphWindow(ctx, o) {
    var out = o.outward < 0 ? 0 : o.outward;
    var horiz = out === 0 || out === 2;
    var W = horiz ? 0.9 : 0.4, H = horiz ? 0.4 : 0.9;
    var inlet = o.role === 'inlet';
    // frame
    fillRR(ctx, -W / 2, -H / 2, W, H, 0.1, o.fixed ? P('wall-light') : P('piece-base'));
    // glass
    var ins = 0.07;
    fillRR(ctx, -W / 2 + ins, -H / 2 + ins, W - 2 * ins, H - 2 * ins, 0.05, inlet ? P('glass-in') : P('glass'));
    // glint
    ctx.save();
    ctx.beginPath(); rr(ctx, -W / 2 + ins, -H / 2 + ins, W - 2 * ins, H - 2 * ins, 0.05); ctx.clip();
    ctx.beginPath();
    if (horiz) { line(ctx, -0.36, 0.12, -0.24, -0.12); line(ctx, -0.27, 0.12, -0.17, -0.08); }
    else { line(ctx, -0.12, -0.24, 0.12, -0.36); line(ctx, -0.12, -0.15, 0.08, -0.25); }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.035;
    ctx.stroke();
    ctx.restore();
    if (o.icon) {
      ctx.beginPath();
      if (horiz) line(ctx, 0, -H / 2 + ins, 0, H / 2 - ins); else line(ctx, -W / 2 + ins, 0, W / 2 - ins, 0);
      ctx.strokeStyle = o.fixed ? P('wall-light') : P('piece-base');
      ctx.lineWidth = 0.06;
      ctx.stroke();
      return;
    }
    // chevrons: inlet points into the house, outlet points out
    var cd = inlet ? (out + 2) % 4 : out;
    ctx.beginPath();
    var off = 0.17;
    if (horiz) { chevron(ctx, -off, 0, cd, 0.085); chevron(ctx, off, 0, cd, 0.085); }
    else { chevron(ctx, 0, -off, cd, 0.085); chevron(ctx, 0, off, cd, 0.085); }
    ctx.strokeStyle = inlet ? P('air-deep') : alpha(P('ink-soft'), 0.85);
    ctx.lineWidth = 0.05;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function glyphFan(ctx, o) {
    var col = P('t-fan');
    var d = o.d | 0;
    var dx = DX[d], dy = DY[d], px = -dy, py = dx;
    // direction marker
    ctx.beginPath();
    ctx.moveTo(dx * 0.475, dy * 0.475);
    ctx.lineTo(dx * 0.335 + px * 0.13, dy * 0.335 + py * 0.13);
    ctx.quadraticCurveTo(dx * 0.37, dy * 0.37, dx * 0.335 - px * 0.13, dy * 0.335 - py * 0.13);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    // cage
    ctx.beginPath(); circle(ctx, 0, 0, 0.3);
    ctx.fillStyle = o.fixed ? mix(P('piece-base'), P('wall-light'), 0.35) : P('piece-base');
    ctx.fill();
    ctx.lineWidth = 0.055;
    ctx.strokeStyle = col;
    ctx.stroke();
    // blades
    ctx.save();
    ctx.rotate(o.angle || 0);
    ctx.fillStyle = alpha(col, 0.8);
    for (var k = 0; k < 3; k++) {
      ctx.rotate(TAU / 3);
      ctx.beginPath();
      ctx.ellipse(0.02, -0.13, 0.07, 0.125, 0.35, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath(); circle(ctx, 0, 0, 0.055);
    ctx.fillStyle = darker(col, 0.2);
    ctx.fill();
  }

  function glyphDeflector(ctx, o) {
    var col = P('t-deflector');
    var s = 0.3;
    var ax = -s, ay = s, bx = s, by = -s;
    if ((o.d | 0) === 1) { ay = -s; by = s; }
    ctx.lineCap = 'round';
    ctx.beginPath(); line(ctx, ax, ay + 0.025, bx, by + 0.025);
    ctx.strokeStyle = darker(col, 0.25);
    ctx.lineWidth = 0.17;
    ctx.stroke();
    ctx.beginPath(); line(ctx, ax, ay, bx, by);
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.16;
    ctx.stroke();
    ctx.beginPath(); line(ctx, ax * 0.78, ay * 0.78 - 0.03, bx * 0.78, by * 0.78 - 0.03);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 0.035;
    ctx.stroke();
    // pivot
    ctx.beginPath(); circle(ctx, 0, 0, 0.035);
    ctx.fillStyle = darker(col, 0.35);
    ctx.fill();
  }

  function glyphCurtain(ctx, o) {
    var col = P('t-curtain');
    var sw = o.sway || 0;
    var top = -0.29, bot = 0.33, L = -0.31, R = 0.31;
    // rod
    ctx.lineCap = 'round';
    ctx.beginPath(); line(ctx, -0.39, -0.33, 0.39, -0.33);
    ctx.strokeStyle = P('ink-soft');
    ctx.lineWidth = 0.045;
    ctx.stroke();
    ctx.beginPath(); circle(ctx, -0.39, -0.33, 0.04); circle(ctx, 0.39, -0.33, 0.04);
    ctx.fillStyle = P('ink-soft');
    ctx.fill();
    // fabric
    ctx.beginPath();
    ctx.moveTo(L, top);
    ctx.lineTo(R, top);
    ctx.quadraticCurveTo(R + sw * 0.3, 0.05, R + sw, bot);
    var n = 4, wv = (R - L) / n;
    for (var i = 0; i < n; i++) {
      var x0 = R + sw - wv * i, x1 = x0 - wv;
      ctx.quadraticCurveTo((x0 + x1) / 2, bot + 0.06, x1, bot);
    }
    ctx.quadraticCurveTo(L + sw * 0.3, 0.05, L, top);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    // folds
    ctx.beginPath();
    for (var j = 1; j < n; j++) {
      var fx = L + wv * j;
      ctx.moveTo(fx, top + 0.04);
      ctx.quadraticCurveTo(fx + sw * 0.3, 0.05, fx + sw, bot - 0.01);
    }
    ctx.strokeStyle = darker(col, 0.18);
    ctx.lineWidth = 0.03;
    ctx.stroke();
    // tie-back highlight
    ctx.beginPath(); line(ctx, L + 0.03, top + 0.02, R - 0.03, top + 0.02);
    ctx.strokeStyle = lighter(col, 0.35);
    ctx.lineWidth = 0.035;
    ctx.stroke();
  }

  function glyphVent(ctx, o) {
    var horiz = o.horiz !== false; // air passes left-right
    var W = horiz ? 0.74 : 0.5, H = horiz ? 0.5 : 0.74;
    fillRR(ctx, -W / 2, -H / 2, W, H, 0.1, o.fixed ? mix(P('t-vent'), P('wall'), 0.3) : P('t-vent'));
    ctx.beginPath();
    var i;
    if (horiz) { for (i = -1; i <= 1; i++) line(ctx, -0.25, i * 0.12, 0.25, i * 0.12); }
    else { for (i = -1; i <= 1; i++) line(ctx, i * 0.12, -0.25, i * 0.12, 0.25); }
    ctx.strokeStyle = alpha(P('wall'), 0.9);
    ctx.lineWidth = 0.05;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function glyphSplitter(ctx) {
    var col = P('t-splitter');
    var r = 0.34;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
    ctx.fillStyle = col;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = col;
    ctx.fill();
    ctx.stroke();
    var q = 0.15;
    ctx.beginPath();
    ctx.moveTo(0, -q); ctx.lineTo(q, 0); ctx.lineTo(0, q); ctx.lineTo(-q, 0); ctx.closePath();
    ctx.fillStyle = lighter(col, 0.5);
    ctx.fill();
    ctx.beginPath(); line(ctx, -r * 0.55, -r * 0.45, -r * 0.1, -r * 0.9);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.035;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function glyphExtractor(ctx, o) {
    var col = P('t-extractor');
    ctx.beginPath(); circle(ctx, 0, 0, 0.38);
    ctx.fillStyle = o.fixed ? P('wall-light') : P('piece-base');
    ctx.fill();
    ctx.beginPath(); circle(ctx, 0, 0, 0.3);
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.save();
    ctx.rotate(o.angle || 0);
    ctx.fillStyle = alpha(col, 0.85);
    for (var k = 0; k < 4; k++) {
      ctx.rotate(TAU / 4);
      ctx.beginPath();
      ctx.ellipse(0.03, -0.13, 0.06, 0.12, 0.45, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath(); circle(ctx, 0, 0, 0.05);
    ctx.fillStyle = darker(col, 0.25);
    ctx.fill();
  }

  function glyphSkylight(ctx, o) {
    var frame = o.fixed ? P('wall') : P('wall-light');
    fillRR(ctx, -0.36, -0.36, 0.72, 0.72, 0.09, frame);
    fillRR(ctx, -0.3, -0.3, 0.6, 0.6, 0.05, P('t-skylight'));
    ctx.beginPath();
    line(ctx, 0, -0.3, 0, 0.3); line(ctx, -0.3, 0, 0.3, 0);
    ctx.strokeStyle = frame;
    ctx.lineWidth = 0.05;
    ctx.stroke();
    ctx.beginPath();
    line(ctx, -0.22, -0.08, -0.08, -0.22);
    line(ctx, 0.08, 0.22, 0.22, 0.08);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 0.035;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function glyphFilter(ctx, o) {
    var col = P('t-filter');
    fillRR(ctx, -0.34, -0.34, 0.68, 0.68, 0.11, mix(col, P('piece-base'), 0.62));
    ctx.save();
    ctx.beginPath(); rr(ctx, -0.29, -0.29, 0.58, 0.58, 0.07); ctx.clip();
    ctx.beginPath();
    var r = 0.075, hw = r * Math.sqrt(3) / 2;
    for (var row = -3; row <= 3; row++) {
      for (var c = -3; c <= 3; c++) {
        var cx = c * hw * 2 + (row & 1 ? hw : 0), cy = row * r * 1.5;
        for (var k = 0; k < 6; k++) {
          var a = Math.PI / 6 + k * Math.PI / 3;
          var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    }
    ctx.strokeStyle = alpha(col, 0.85);
    ctx.lineWidth = 0.022;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath(); rr(ctx, -0.34, -0.34, 0.68, 0.68, 0.11);
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.055;
    ctx.stroke();
  }

  function glyphCeilingFan(ctx, o) {
    var col = P('t-ceilingfan');
    ctx.save();
    ctx.rotate(o.angle || 0);
    for (var k = 0; k < 4; k++) {
      ctx.rotate(TAU / 4);
      ctx.beginPath();
      rr(ctx, 0.06, -0.075, 0.41, 0.15, 0.075);
      ctx.fillStyle = alpha(col, 0.92);
      ctx.fill();
      ctx.beginPath(); line(ctx, 0.13, -0.02, 0.4, -0.02);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 0.025;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath(); circle(ctx, 0, 0, 0.12);
    ctx.fillStyle = darker(col, 0.22);
    ctx.fill();
    ctx.beginPath(); circle(ctx, 0, 0, 0.045);
    ctx.fillStyle = o.fixed ? P('wall') : P('piece-base');
    ctx.fill();
  }

  var GLYPHS = {
    window: glyphWindow, fan: glyphFan, deflector: glyphDeflector, curtain: glyphCurtain,
    vent: glyphVent, splitter: glyphSplitter, extractor: glyphExtractor, skylight: glyphSkylight,
    filter: glyphFilter, ceilingfan: glyphCeilingFan
  };
  function isWallTool(type) { return WB.TOOLS[type] && WB.TOOLS[type].mount !== 'floor'; }

  // ------------------------------------------------------------------ objects
  // a = animation state { angle, flow, lit, dry, scatter, flutter, bend, sway... }

  function objPinwheel(ctx, a, t) {
    ctx.lineCap = 'round';
    ctx.beginPath(); line(ctx, 0, 0, 0.02, 0.44);
    ctx.strokeStyle = P('table-edge');
    ctx.lineWidth = 0.05;
    ctx.stroke();
    var cols = [P('o-coral'), P('o-sun'), P('o-teal'), P('o-sky')];
    ctx.save();
    ctx.translate(0, -0.03);
    ctx.rotate(a.angle || 0);
    for (var k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -0.31);
      ctx.quadraticCurveTo(0.2, -0.3, 0.2, -0.04);
      ctx.closePath();
      ctx.fillStyle = cols[k];
      ctx.fill();
      ctx.beginPath(); line(ctx, 0, 0, 0.012, -0.29);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 0.02;
      ctx.stroke();
      ctx.rotate(TAU / 4);
    }
    ctx.restore();
    ctx.beginPath(); circle(ctx, 0, -0.03, 0.045);
    ctx.fillStyle = P('piece-base');
    ctx.fill();
  }

  function objCandle(ctx, a, t) {
    var lit = a.lit == null ? 1 : a.lit;
    if (lit > 0.02) {
      var g = ctx.createRadialGradient(0, -0.22, 0, 0, -0.22, 0.46);
      g.addColorStop(0, alpha(P('o-flame'), 0.32 * lit));
      g.addColorStop(1, alpha(P('o-flame'), 0));
      ctx.fillStyle = g;
      ctx.beginPath(); circle(ctx, 0, -0.22, 0.46); ctx.fill();
    }
    // dish
    ctx.beginPath(); ctx.ellipse(0, 0.33, 0.25, 0.075, 0, 0, TAU);
    ctx.fillStyle = P('wall-light');
    ctx.fill();
    // stick
    ctx.beginPath(); rr(ctx, -0.085, -0.12, 0.17, 0.45, 0.045);
    ctx.fillStyle = P('o-cream');
    ctx.fill();
    ctx.strokeStyle = alpha(P('ink'), 0.18);
    ctx.lineWidth = 0.025;
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0.045, -0.06, 0.022, 0.05, 0, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    // wick
    ctx.beginPath(); line(ctx, 0, -0.12, 0, -0.17);
    ctx.strokeStyle = P('ink');
    ctx.lineWidth = 0.025;
    ctx.lineCap = 'round';
    ctx.stroke();
    // flame
    if (lit > 0.02) {
      var fl = 1 + 0.07 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 21.7 + 1);
      var h = 0.21 * lit * fl, w = 0.075 * lit;
      var lean = 0.02 * Math.sin(t * 7.3);
      ctx.beginPath();
      ctx.moveTo(lean, -0.17 - h);
      ctx.bezierCurveTo(w * 1.3, -0.17 - h * 0.45, w, -0.15, 0, -0.145);
      ctx.bezierCurveTo(-w, -0.15, -w * 1.3, -0.17 - h * 0.45, lean, -0.17 - h);
      ctx.fillStyle = P('o-flame');
      ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -0.19, w * 0.45, h * 0.28, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,240,190,0.95)';
      ctx.fill();
    }
    // smoke wisp when blown out
    if (lit < 0.98) {
      var al = (1 - lit) * 0.7;
      ctx.beginPath();
      for (var i = 0; i <= 12; i++) {
        var u = i / 12;
        var x = Math.sin(u * 7 - t * 3.2) * 0.05 * (0.3 + u) + (a.dirx || 0) * u * 0.12;
        var y = -0.17 - u * 0.33;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = alpha(P('smoke'), al);
      ctx.lineWidth = 0.035;
      ctx.stroke();
    }
  }

  function tshirt(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.05, 0);
    ctx.quadraticCurveTo(0, 0.04, 0.05, 0);
    ctx.lineTo(0.15, 0.03);
    ctx.lineTo(0.18, 0.11);
    ctx.lineTo(0.11, 0.13);
    ctx.lineTo(0.105, 0.31);
    ctx.lineTo(-0.105, 0.31);
    ctx.lineTo(-0.11, 0.13);
    ctx.lineTo(-0.18, 0.11);
    ctx.lineTo(-0.15, 0.03);
    ctx.closePath();
  }

  function objLaundry(ctx, a, t) {
    var f = a.flow || 0;
    var dry = a.dry || 0;
    ctx.lineCap = 'round';
    // posts
    ctx.beginPath(); line(ctx, -0.41, -0.32, -0.41, 0.4); line(ctx, 0.41, -0.32, 0.41, 0.4);
    ctx.strokeStyle = P('table-edge');
    ctx.lineWidth = 0.045;
    ctx.stroke();
    // line
    ctx.beginPath(); ctx.moveTo(-0.41, -0.28); ctx.quadraticCurveTo(0, -0.18, 0.41, -0.28);
    ctx.strokeStyle = P('ink-soft');
    ctx.lineWidth = 0.02;
    ctx.stroke();
    var amp = 0.05 + 0.11 * Math.min(f, 3);
    var lean = clamp(a.dirx || 0, -1, 1) * 0.16 * Math.min(f, 3);
    var sw1 = lean + amp * Math.sin(t * (2.1 + f * 1.4));
    var sw2 = lean + amp * 1.15 * Math.sin(t * (2.4 + f * 1.5) + 1.3);
    var damp = 1 - dry;
    var shirtCol = mix(P('o-sky'), mix(P('o-sky'), P('smoke'), 0.55), damp);
    var towelCol = mix(P('o-coral'), mix(P('o-coral'), P('smoke'), 0.55), damp);
    // shirt
    ctx.save();
    ctx.translate(-0.17, -0.235);
    ctx.rotate(sw1);
    tshirt(ctx);
    ctx.fillStyle = shirtCol;
    ctx.fill();
    ctx.restore();
    // towel
    ctx.save();
    ctx.translate(0.18, -0.225);
    ctx.rotate(sw2);
    ctx.beginPath(); rr(ctx, -0.085, 0, 0.17, 0.3, 0.03);
    ctx.fillStyle = towelCol;
    ctx.fill();
    ctx.beginPath(); line(ctx, -0.085, 0.235, 0.085, 0.235);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    ctx.restore();
    // pegs
    ctx.beginPath(); circle(ctx, -0.17, -0.235, 0.025); circle(ctx, 0.18, -0.225, 0.025);
    ctx.fillStyle = P('table-edge');
    ctx.fill();
    // drips while damp
    if (damp > 0.05) {
      ctx.fillStyle = alpha(P('air-deep'), 0.7 * damp);
      for (var i = 0; i < 2; i++) {
        var ph = (t * 0.9 + i * 0.5) % 1;
        var x = i === 0 ? -0.17 + Math.sin(sw1) * -0.3 : 0.18 + Math.sin(sw2) * -0.3;
        var y = 0.1 + ph * 0.3;
        ctx.globalAlpha = (1 - ph);
        ctx.beginPath(); ctx.ellipse(x, y, 0.018, 0.026, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function paperSheet(ctx, w, h, lines, corner) {
    ctx.beginPath();
    if (corner > 0.001) {
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2, -h / 2);
      ctx.lineTo(w / 2, h / 2 - corner);
      ctx.lineTo(w / 2 - corner, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
    } else {
      rr(ctx, -w / 2, -h / 2, w, h, 0.02);
    }
    ctx.fillStyle = P('o-paper');
    ctx.fill();
    ctx.strokeStyle = alpha(P('ink'), 0.16);
    ctx.lineWidth = 0.02;
    ctx.stroke();
    if (lines) {
      ctx.beginPath();
      for (var i = 0; i < lines; i++) {
        var y = -h / 2 + 0.085 + i * 0.075;
        line(ctx, -w / 2 + 0.06, y, w / 2 - (i === lines - 1 ? 0.14 : 0.06), y);
      }
      ctx.strokeStyle = alpha(P('ink-soft'), 0.45);
      ctx.lineWidth = 0.022;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    if (corner > 0.001) {
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2 - corner);
      ctx.lineTo(w / 2 - corner * 0.9, h / 2 - corner * 0.9);
      ctx.lineTo(w / 2 - corner, h / 2);
      ctx.closePath();
      ctx.fillStyle = mix(P('o-paper'), P('ink-soft'), 0.22);
      ctx.fill();
    }
  }

  function objPapers(ctx, a, t) {
    var sc = a.scatter || 0;
    var fl = a.flutter || 0;
    ctx.save(); ctx.rotate(-0.12); ctx.translate(-0.02, 0.03); paperSheet(ctx, 0.44, 0.54, 0, 0); ctx.restore();
    if (sc < 0.9) {
      ctx.save(); ctx.rotate(0.07); ctx.translate(0.02, 0.0); paperSheet(ctx, 0.44, 0.54, 0, 0); ctx.restore();
    }
    var corner = 0.04 + fl * (0.08 + 0.05 * Math.sin(t * 9)) ;
    ctx.save();
    ctx.globalAlpha = 1 - sc;
    ctx.rotate(-0.02 + fl * 0.03 * Math.sin(t * 7));
    paperSheet(ctx, 0.44, 0.54, 5, corner);
    ctx.restore();
    if (sc > 0.01) {
      var dx = a.dirx || 0, dy = a.diry || 0;
      if (!dx && !dy) dx = 1;
      var px = -dy, py = dx;
      for (var i = 0; i < 3; i++) {
        var ph = (t * 0.35 + i / 3) % 1;
        var dist = (0.12 + 0.42 * ph) * sc;
        var wob = Math.sin(t * 3 + i * 2.1) * 0.16 * sc;
        ctx.save();
        ctx.translate(dx * dist + px * (wob + (i - 1) * 0.18 * sc), dy * dist + py * (wob + (i - 1) * 0.18 * sc));
        ctx.rotate(t * (1.4 + i * 0.5) + i * 2);
        ctx.globalAlpha = sc * (1 - Math.pow(ph, 3));
        paperSheet(ctx, 0.27, 0.33, 3, 0);
        ctx.restore();
      }
    }
  }

  function objFern(ctx, a, t) {
    var f = a.flow || 0;
    var bend = a.bend || 0;
    var swayAmp = (a.sway || 0) * 0.13 + 0.015;
    var dirx = a.dirx || 0;
    var side = dirx < -0.1 ? -1 : 1;
    var leaf = mix(P('o-leaf'), P('o-leaf-sad'), bend);
    var dark = darker(leaf, 0.18);
    var base = [-1.05, -0.52, 0, 0.52, 1.05];
    var lens = [0.3, 0.38, 0.42, 0.38, 0.3];
    for (var i = 0; i < 5; i++) {
      var ang = base[i] + swayAmp * Math.sin(t * (2.2 + f * 0.6) + i * 0.9);
      ang = ang * (1 - bend * 0.45) + side * bend * (0.75 + 0.15 * Math.sin(t * 6 + i));
      var len = lens[i] * (1 - bend * 0.15);
      var curl = (0.22 + bend * 0.5) * (ang >= 0 ? 1 : -1);
      var sx = 0, sy = 0.16;
      var tx = sx + Math.sin(ang) * len, ty = sy - Math.cos(ang) * len;
      var cx = sx + Math.sin(ang - curl * 0.5) * len * 0.55, cy = sy - Math.cos(ang - curl * 0.5) * len * 0.55;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, tx, ty + bend * 0.08);
      ctx.strokeStyle = dark;
      ctx.lineWidth = 0.025;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.fillStyle = leaf;
      for (var j = 1; j <= 5; j++) {
        var u = j / 6;
        var qx = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * tx;
        var qy = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * (ty + bend * 0.08);
        var tgx = 2 * (1 - u) * (cx - sx) + 2 * u * (tx - cx);
        var tgy = 2 * (1 - u) * (cy - sy) + 2 * u * (ty - cy);
        var ta = Math.atan2(tgy, tgx);
        var sz = 0.055 * (1.15 - u * 0.75);
        ctx.beginPath();
        ctx.ellipse(qx + Math.cos(ta - 1.1) * sz, qy + Math.sin(ta - 1.1) * sz, sz, sz * 0.42, ta - 1.1, 0, TAU);
        ctx.ellipse(qx + Math.cos(ta + 1.1) * sz, qy + Math.sin(ta + 1.1) * sz, sz, sz * 0.42, ta + 1.1, 0, TAU);
        ctx.fill();
      }
    }
    // pot
    ctx.beginPath();
    ctx.moveTo(-0.16, 0.19); ctx.lineTo(0.16, 0.19); ctx.lineTo(0.125, 0.42); ctx.lineTo(-0.125, 0.42); ctx.closePath();
    ctx.fillStyle = P('o-pot');
    ctx.fill();
    fillRR(ctx, -0.185, 0.14, 0.37, 0.075, 0.03, darker(P('o-pot'), 0.12));
  }

  function objStove(ctx, a, t) {
    fillRR(ctx, -0.38, -0.38, 0.76, 0.76, 0.13, P('o-stove'));
    ctx.beginPath(); rr(ctx, -0.38, -0.38, 0.76, 0.76, 0.13);
    ctx.strokeStyle = P('o-stove-edge');
    ctx.lineWidth = 0.035;
    ctx.stroke();
    // burner
    ctx.beginPath(); circle(ctx, 0, -0.05, 0.21);
    ctx.fillStyle = '#3b4049';
    ctx.fill();
    var glow = 0.75 + 0.25 * Math.sin(t * 2.3);
    ctx.beginPath(); circle(ctx, 0, -0.05, 0.12);
    ctx.strokeStyle = alpha(P('o-flame'), 0.85 * glow);
    ctx.lineWidth = 0.05;
    ctx.stroke();
    ctx.beginPath();
    for (var k = 0; k < 4; k++) {
      var an = k * Math.PI / 2 + Math.PI / 4;
      line(ctx, Math.cos(an) * 0.15, -0.05 + Math.sin(an) * 0.15, Math.cos(an) * 0.22, -0.05 + Math.sin(an) * 0.22);
    }
    ctx.strokeStyle = '#2a2e35';
    ctx.lineWidth = 0.04;
    ctx.stroke();
    // knobs
    ctx.beginPath(); circle(ctx, -0.14, 0.27, 0.038); circle(ctx, 0.14, 0.27, 0.038);
    ctx.fillStyle = P('o-stove-edge');
    ctx.fill();
  }

  var OBJ_DRAW = {
    pinwheel: objPinwheel, candle: objCandle, laundry: objLaundry,
    papers: objPapers, fern: objFern, stove: objStove
  };
  var REQ_BADGE = { laundry: '2+', papers: '≤1', fern: '=1' };

  // ------------------------------------------------------------------ icons

  function setupCanvas(canvas, w, h) {
    var dpr = Math.min(root.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // icon(canvas, 'tool'|'object'|'swirl', id, cssSize)
  function icon(canvas, kind, id, size) {
    if (!PAL.wall) readPalette();
    var ctx = setupCanvas(canvas, size, size);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    if (kind === 'tool') {
      var s = size * 0.86;
      ctx.scale(s, s);
      if (id === 'window') {
        ctx.fillStyle = P('wall');
        ctx.fillRect(-0.5, -0.21, 1, 0.42);
        ctx.scale(0.72, 1.12);
        glyphWindow(ctx, { outward: 0, role: 'outlet', icon: true });
      } else if (id === 'vent') {
        fillRR(ctx, -0.5, -0.42, 1, 0.84, 0.16, P('wall'));
        glyphVent(ctx, { horiz: true });
      } else if (id === 'extractor') {
        fillRR(ctx, -0.46, -0.46, 0.92, 0.92, 0.2, P('wall'));
        glyphExtractor(ctx, { angle: 0.3 });
      } else if (id === 'fan') {
        glyphFan(ctx, { d: 1, angle: 0.4 });
      } else {
        GLYPHS[id](ctx, { d: 0, angle: 0.4, sway: 0 });
      }
    } else if (kind === 'object') {
      var so = size * 0.92;
      ctx.scale(so, so);
      var st = { angle: 0.5, lit: 1, dry: 1, flow: 0, scatter: 0, flutter: 0, bend: 0, sway: 0 };
      if (id === 'laundry') st.flow = 0;
      OBJ_DRAW[id](ctx, st, 0.2);
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

  // ------------------------------------------------------------------ simulation analysis (cached on the result)

  function analyze(sim, L) {
    if (sim._wbr) return sim._wbr;
    var A = { active: [], stalled: [], outEnds: [], blockEnds: [], stallEnds: [], dir: new Float32Array(L.w * L.h * 2) };
    function addDir(cx, cy, dx, dy, s) {
      if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return;
      var i = (cy * L.w + cx) * 2;
      A.dir[i] += dx * s; A.dir[i + 1] += dy * s;
    }
    sim.trees.forEach(function (tr) {
      var seen = {}, list = [];
      tr.segments.forEach(function (sg) {
        var k = sg.ax + ',' + sg.ay + ',' + sg.bx + ',' + sg.by;
        var ex = seen[k];
        if (ex) {
          if (sg.s > ex.s) ex.s = sg.s;
          if (sg.smoke) ex.smoke = true;
          return;
        }
        var dx = Math.sign(sg.bx - sg.ax), dy = Math.sign(sg.by - sg.ay);
        var len = Math.abs(sg.bx - sg.ax) + Math.abs(sg.by - sg.ay);
        if (len < 1e-6) return;
        var o = { ax: sg.ax, ay: sg.ay, bx: sg.bx, by: sg.by, s: sg.s, smoke: sg.smoke, dist: sg.dist, len: len, dx: dx, dy: dy };
        seen[k] = o;
        list.push(o);
      });
      tr.ends.forEach(function (e) {
        var seg = null;
        for (var i = 0; i < list.length; i++) {
          if (Math.abs(list[i].bx - e.x) < 1e-6 && Math.abs(list[i].by - e.y) < 1e-6) { seg = list[i]; break; }
        }
        var it = {
          x: e.x, y: e.y, dx: seg ? seg.dx : 0, dy: seg ? seg.dy : 0, s: seg ? seg.s : 1,
          smoke: seg ? seg.smoke : false, dist: seg ? seg.dist + seg.len : 0, sky: false
        };
        if (!tr.active) A.stallEnds.push(it);
        else if (e.type === 'outlet') {
          // skylight: the end is a cell centre
          it.sky = Math.abs((e.x % 1) - 0.5) < 1e-6 && Math.abs((e.y % 1) - 0.5) < 1e-6;
          A.outEnds.push(it);
        } else A.blockEnds.push(it);
      });
      if (tr.active) {
        list.forEach(function (o) {
          A.active.push(o);
          addDir(Math.floor(o.ax + o.dx * 0.01), Math.floor(o.ay + o.dy * 0.01), o.dx, o.dy, o.s);
          addDir(Math.floor(o.bx - o.dx * 0.01), Math.floor(o.by - o.dy * 0.01), o.dx, o.dy, o.s);
        });
      } else {
        list.forEach(function (o) { A.stalled.push(o); });
      }
    });
    // thinner strokes first so stronger flows sit on top
    A.active.sort(function (a, b) { return a.s - b.s; });
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
    if (!PAL.wall) readPalette();
  }

  Board.prototype.setLevel = function (L, seed) {
    this.L = L;
    this.seed = seed || 1;
    this.anim = {};
    this.streaks = [];
    this.streakSeeded = false;
  };

  // Fit the board into availW x availH CSS pixels. Returns the CSS size used.
  Board.prototype.layout = function (availW, availH) {
    var L = this.L;
    if (!L) return null;
    availW = Math.max(60, availW); availH = Math.max(60, availH);
    var m = 1;
    var T = Math.min(availW / (L.w + 2 * m), availH / (L.h + 2 * m));
    if (T < 40) {
      m = 0.78;
      T = Math.min(availW / (L.w + 2 * m), availH / (L.h + 2 * m));
    }
    T = T >= 20 ? Math.floor(T) : Math.max(10, T);
    T = Math.min(T, 58);
    this.T = T;
    this.m = m;
    // let the garden breathe a little when there is room
    var ex = clamp((availW / T - (L.w + 2 * m)) / 2, 0, 1.5);
    var ey = clamp((availH / T - (L.h + 2 * m)) / 2, 0, 2.5);
    this.cssW = Math.floor((L.w + 2 * (m + ex)) * T);
    this.cssH = Math.floor((L.h + 2 * (m + ey)) * T);
    this.ox = Math.round((this.cssW - L.w * T) / 2);
    this.oy = Math.round((this.cssH - L.h * T) / 2);
    this.dpr = Math.min(root.devicePixelRatio || 1, 3);
    var c = this.canvas;
    c.style.width = this.cssW + 'px';
    c.style.height = this.cssH + 'px';
    c.width = Math.round(this.cssW * this.dpr);
    c.height = Math.round(this.cssH * this.dpr);
    this.renderStatic();
    this.streaks = [];
    this.streakSeeded = false;
    return { w: this.cssW, h: this.cssH, T: T };
  };

  Board.prototype.refreshPalette = function () {
    readPalette();
    if (this.L && this.cssW) this.renderStatic();
  };

  // client coords -> cell (x,y may be outside the map)
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
    var self = this;
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
    var grad = gc.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    grad.addColorStop(0, alpha(P('garden-2'), 0));
    grad.addColorStop(1, P('garden-2'));
    gc.fillStyle = grad;
    gc.fillRect(0, 0, W, H);
    // grass tufts
    var rand = rng(this.seed * 7919 + L.w * 31 + L.h);
    gc.strokeStyle = P('garden-mark');
    gc.lineWidth = Math.max(1, T * 0.045);
    gc.lineCap = 'round';
    var tufts = Math.round((W * H) / (T * T) * 0.5);
    gc.beginPath();
    for (var i = 0; i < tufts; i++) {
      var gx = rand() * W, gy = rand() * H;
      var cx = Math.floor((gx - this.ox) / T), cy = Math.floor((gy - this.oy) / T);
      // keep tufts off the house (with a small gap)
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
    // floor grid
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
    // wood grain
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
    // fillets in room corners
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
    c.fillStyle = P('wall');
    c.fill(wp);

    // solid walls: slightly different shade + hatch
    var hasSolid = L.cells.indexOf('%') >= 0;
    if (hasSolid) {
      c.save();
      var sp = wallPath(function (x, y) { return cell(x, y) === '%'; }, new Path2D());
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

  // --------------------------------------------- wind streaks / calm motes

  Board.prototype.stepStreaks = function (dt, motion) {
    var L = this.L, T = this.T, W = this.cssW, H = this.cssH;
    var s = L.wind.strength;
    var calm = s <= 0;
    var area = (W * H) / (T * T);
    var target = calm ? Math.round(area * 0.05) : Math.round(area * (0.035 + 0.025 * s));
    var list = this.streaks;
    var self = this;
    function spawn(initial) {
      var life = calm ? 4 + Math.random() * 4 : 1.4 + Math.random() * 1.6;
      list.push({
        x: Math.random() * W, y: Math.random() * H,
        len: T * (0.6 + Math.random() * 1.1),
        life: life, age: initial ? Math.random() * life : 0,
        sp: 0.8 + Math.random() * 0.45, ph: Math.random() * TAU,
        vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), r: 0.6 + Math.random() * 1.2
      });
    }
    if (!this.streakSeeded) {
      for (var i = 0; i < target; i++) spawn(true);
      this.streakSeeded = true;
    }
    if (!motion) return;
    var dir = L.wind.dir;
    var speed = calm ? T * 0.12 : (0.9 + 0.8 * s) * T;
    for (var j = list.length - 1; j >= 0; j--) {
      var st = list[j];
      st.age += dt;
      if (calm) {
        st.x += st.vx * speed * dt; st.y += st.vy * speed * dt;
      } else {
        st.x += DX[dir] * speed * st.sp * dt; st.y += DY[dir] * speed * st.sp * dt;
      }
      if (st.age >= st.life) list.splice(j, 1);
    }
    while (list.length < target) spawn(false);
  };

  Board.prototype.drawStreaks = function (ctx, t) {
    var L = this.L, T = this.T;
    var s = L.wind.strength;
    var list = this.streaks;
    ctx.save();
    ctx.lineCap = 'round';
    if (s <= 0) {
      ctx.fillStyle = P('streak');
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        var a = Math.sin(Math.PI * m.age / m.life);
        ctx.globalAlpha = a * 0.7;
        ctx.beginPath(); circle(ctx, m.x, m.y, Math.max(1, T * 0.03 * m.r)); ctx.fill();
      }
    } else {
      var dir = L.wind.dir, dx = DX[dir], dy = DY[dir], px = -dy, py = dx;
      ctx.strokeStyle = P('streak');
      ctx.lineWidth = Math.max(1, T * (0.03 + 0.008 * s));
      for (var k = 0; k < list.length; k++) {
        var st = list[k];
        var al = Math.sin(Math.PI * st.age / st.life);
        ctx.globalAlpha = al * 0.9;
        var wob = Math.sin(t * 1.7 + st.ph) * T * 0.08;
        var hx = st.x, hy = st.y;
        var tx = hx - dx * st.len, ty = hy - dy * st.len;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo((hx + tx) / 2 + px * wob, (hy + ty) / 2 + py * wob, hx, hy);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  // --------------------------------------------- animation state per object/piece

  Board.prototype.animFor = function (key, init) {
    var a = this.anim[key];
    if (!a) { a = this.anim[key] = init || {}; a.fresh = true; }
    return a;
  };

  // ------------------------------------------------------------------ draw

  /*
   * S = {
   *   pieces: [{type,x,y,d,fixed}],   // everything to draw (lifted piece excluded)
   *   sim: Result,                    // simulation to visualise
   *   valid: [{x,y}] | null,          // placement highlights
   *   ghost: {type,x,y,d,ok} | null,  // preview under the pointer
   *   hint: {type,x,y,d} | null,
   *   hover: {x,y} | null, cursor: {x,y} | null,
   *   pops: {key: t0}, shake: {x,y,t0} | null,
   *   win: t0 | null, reduced: bool
   * }
   */
  Board.prototype.draw = function (S, now) {
    var L = this.L;
    if (!L || !this.cssW) return;
    var ctx = this.ctx, T = this.T, dpr = this.dpr;
    var t = now / 1000;
    var dt = this.lastNow ? clamp((now - this.lastNow) / 1000, 0, 0.05) : 0.016;
    this.lastNow = now;
    var motion = !S.reduced;
    var sim = S.sim;
    var A = analyze(sim, L);
    var self = this;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.gardenLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.stepStreaks(dt, motion);
    this.drawStreaks(ctx, motion ? t : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.houseLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.ox, this.oy);

    var flowT = motion ? t : 0;

    // ---------------- placement highlights
    if (S.valid && S.valid.length) {
      var br = 0.85 + 0.15 * Math.sin(t * 3);
      ctx.save();
      ctx.globalAlpha = motion ? br : 1;
      ctx.beginPath();
      S.valid.forEach(function (c) { rr(ctx, c.x * T + T * 0.1, c.y * T + T * 0.1, T * 0.8, T * 0.8, T * 0.22); });
      ctx.fillStyle = P('hl');
      ctx.fill();
      ctx.beginPath();
      S.valid.forEach(function (c) { circle(ctx, (c.x + 0.5) * T, (c.y + 0.5) * T, Math.max(2, T * 0.07)); });
      ctx.fillStyle = P('hl-edge');
      ctx.fill();
      ctx.restore();
    }

    // ---------------- piece bases (floor tools)
    var pieces = S.pieces || [];
    var pieceAt = {};
    pieces.forEach(function (p) { pieceAt[p.x + ',' + p.y] = p; });

    function pieceTransform(p) {
      var cx = (p.x + 0.5) * T, cy = (p.y + 0.5) * T;
      var sc = 1, ox = 0;
      var key = p.x + ',' + p.y;
      if (S.pops && S.pops[key] != null) {
        var age = (now - S.pops[key]) / 240;
        if (age < 1) sc = 0.85 + 0.15 * easeOutBack(age);
      }
      if (S.shake && S.shake.x === p.x && S.shake.y === p.y) {
        var sa = (now - S.shake.t0) / 420;
        if (sa < 1) ox = Math.sin(sa * Math.PI * 7) * T * 0.07 * (1 - sa);
      }
      ctx.translate(cx + ox, cy);
      ctx.scale(T * sc, T * sc);
    }

    pieces.forEach(function (p) {
      if (isWallTool(p.type) || p.type === 'ceilingfan') return;
      ctx.save(); pieceTransform(p); pieceBase(ctx, { fixed: p.fixed }); ctx.restore();
    });
    // ceiling fan bases too (under the airflow)
    pieces.forEach(function (p) {
      if (p.type !== 'ceilingfan') return;
      ctx.save(); pieceTransform(p); pieceBase(ctx, { fixed: p.fixed }); ctx.restore();
    });

    // ---------------- airflow
    this.drawFlows(ctx, A, T, flowT, motion, t);

    // ---------------- pieces
    pieces.forEach(function (p) {
      var key = 'p' + p.type + p.x + ',' + p.y;
      var a = self.animFor(key, { angle: Math.random() * TAU, sway: 0 });
      var f = WB.isFloorish(WB.cellAt(L, p.x, p.y)) ? sim.flow[p.y * L.w + p.x] : 0;
      var spin = motion ? 1 : 0.25;
      if (p.type === 'fan') a.angle += dt * (3 + 3.5 * f) * spin;
      else if (p.type === 'extractor') a.angle += dt * 4.5 * spin;
      else if (p.type === 'ceilingfan') a.angle += dt * 1.4 * spin;
      var dvx = 0;
      if (p.type === 'curtain') {
        var di = (p.y * L.w + p.x) * 2;
        dvx = clamp(A.dir[di] + A.dir[di + 1] * 0.5, -1, 1);
        var target = motion ? (0.02 + 0.045 * Math.min(f, 3)) * Math.sin(t * (1.6 + f * 1.4) + p.x) + dvx * 0.05 * Math.min(f, 3) : 0;
        a.sway = approach(a.sway, target, 6, dt);
      }
      var o = {
        T: T, t: t, fixed: p.fixed, d: p.d | 0, angle: a.angle, sway: a.sway,
        outward: (p.type === 'window' || p.type === 'extractor') ? WB.outwardDir(L, p.x, p.y) : -1,
        role: p.type === 'window' ? WB.windowRole(L, p) : null,
        horiz: p.type === 'vent' ? WB.isFloorish(WB.cellAt(L, p.x - 1, p.y)) && WB.isFloorish(WB.cellAt(L, p.x + 1, p.y)) : true
      };
      ctx.save(); pieceTransform(p); GLYPHS[p.type](ctx, o); ctx.restore();
    });

    // ---------------- objects
    var winAge = S.win != null ? (now - S.win) / 1000 : -1;
    var goals = sim.goals || [];
    L.objects.forEach(function (ob, idx) {
      var gl = goals[idx] || { flow: 0, state: 'idle', ok: false };
      var f = gl.flow;
      var a = self.animFor('o' + ob.x + ',' + ob.y, {
        angle: Math.random() * TAU, spd: 0, lit: f > 0 ? 0 : 1, dry: f >= 2 ? 1 : 0,
        scatter: f >= 2 ? 1 : 0, flutter: f === 1 ? 1 : 0, bend: f >= 2 ? 1 : 0, sway: f === 1 ? 1 : 0,
        state: gl.state, stateT: -1e9, flow: f
      });
      if (a.state !== gl.state) { a.state = gl.state; a.stateT = now; }
      a.flow = f;
      var di = (ob.y * L.w + ob.x) * 2;
      var vx = A.dir[di], vy = A.dir[di + 1], vl = Math.hypot(vx, vy);
      a.dirx = vl ? vx / vl : 0; a.diry = vl ? vy / vl : 0;
      a.spd = approach(a.spd, f * 3.2, 2.2, dt);
      a.angle += a.spd * dt * (motion ? 1 : 0.3);
      a.lit = approach(a.lit, f > 0 ? 0 : 1, 5, dt);
      a.dry = approach(a.dry, f >= 2 ? 1 : 0, 2.5, dt);
      a.scatter = approach(a.scatter, f >= 2 ? 1 : 0, 3, dt);
      a.flutter = approach(a.flutter, f >= 1 ? 1 : 0, 4, dt);
      a.bend = approach(a.bend, f >= 2 ? 1 : 0, 3, dt);
      a.sway = approach(a.sway, f >= 1 ? 1 : 0, 3, dt);

      var cx = (ob.x + 0.5) * T, cy = (ob.y + 0.5) * T;
      var hop = 0;
      if (winAge >= 0 && winAge < 1.3 && motion) {
        var ha = winAge - idx * 0.07;
        if (ha > 0 && ha < 0.9) hop = -Math.abs(Math.sin(ha / 0.45 * Math.PI)) * T * 0.13 * (1 - ha / 0.9);
      }
      var ot = motion ? t : 0.4;
      if (ob.type === 'stove') self.drawStoveSmoke(ctx, ob, gl, a, T, ot, motion);
      ctx.save();
      ctx.translate(cx, cy + hop);
      ctx.scale(T * 1.06, T * 1.06);
      OBJ_DRAW[ob.type](ctx, a, ot);
      ctx.restore();
    });

    // smoke haze at smoky blocked ends (bad stoves)
    this.drawSmokeEnds(ctx, A, T, flowT);

    // status pips and requirement badges
    L.objects.forEach(function (ob, idx) {
      var gl = goals[idx] || { state: 'idle' };
      var a = self.anim['o' + ob.x + ',' + ob.y];
      self.drawPip(ctx, ob, gl.state, a ? (now - a.stateT) / 1000 : 9, T);
    });

    // ---------------- hint ghost
    if (S.hint) {
      var hp = 0.5 + 0.5 * Math.sin(t * 4);
      var hx = S.hint.x, hy = S.hint.y;
      ctx.save();
      ctx.beginPath(); rr(ctx, hx * T + T * 0.03, hy * T + T * 0.03, T * 0.94, T * 0.94, T * 0.2);
      ctx.lineWidth = Math.max(1.5, T * 0.05);
      ctx.strokeStyle = P('accent');
      ctx.setLineDash([T * 0.14, T * 0.1]);
      ctx.lineDashOffset = -t * T * 0.3;
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
        ctx.globalAlpha = 0.62;
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

    // ---------------- invalid-drop flash
    if (S.flash) {
      var fa = (now - S.flash.t0) / 450;
      var fl = S.flash;
      if (fa < 1 && fl.x >= 0 && fl.y >= 0 && fl.x < L.w && fl.y < L.h) {
        var fo = Math.sin(fa * Math.PI * 6) * T * 0.07 * (1 - fa);
        ctx.save();
        ctx.translate(fo, 0);
        ctx.globalAlpha = 1 - fa;
        ctx.beginPath(); rr(ctx, fl.x * T + T * 0.08, fl.y * T + T * 0.08, T * 0.84, T * 0.84, T * 0.18);
        ctx.strokeStyle = P('bad');
        ctx.lineWidth = Math.max(1.5, T * 0.045);
        ctx.stroke();
        if (fl.type) {
          ctx.globalAlpha = 0.45 * (1 - fa);
          this.drawPieceAt(ctx, fl, T, t);
        }
        ctx.restore();
      }
    }

    // ---------------- hover / keyboard cursor
    if (S.hover && !S.ghost) {
      var hv = S.hover;
      if (hv.x >= 0 && hv.y >= 0 && hv.x < L.w && hv.y < L.h) {
        ctx.beginPath(); rr(ctx, hv.x * T + T * 0.05, hv.y * T + T * 0.05, T * 0.9, T * 0.9, T * 0.2);
        ctx.strokeStyle = alpha(P('ink'), 0.22);
        ctx.lineWidth = Math.max(1, T * 0.035);
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

    // ---------------- win shimmer
    if (winAge >= 0 && winAge < 1.4 && motion) {
      var p = winAge / 1.2;
      var Wd = L.w * T, Hd = L.h * T;
      var x0 = lerp(-0.4, 1.4, p) * (Wd + Hd) - Hd;
      ctx.save();
      ctx.beginPath(); rr(ctx, 0, 0, Wd, Hd, T * 0.22); ctx.clip();
      var gr = ctx.createLinearGradient(x0, 0, x0 + Hd, Hd);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      var mid = 0.5;
      gr.addColorStop(clamp(mid - 0.12, 0, 1), 'rgba(255,255,255,0)');
      gr.addColorStop(mid, P('shimmer'));
      gr.addColorStop(clamp(mid + 0.12, 0, 1), 'rgba(255,255,255,0)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr;
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillRect(0, 0, Wd, Hd);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, 0, Wd, Hd);
      ctx.restore();
      // sparkles around objects
      L.objects.forEach(function (ob, idx) {
        var r2 = rng(idx * 97 + 13);
        for (var k = 0; k < 3; k++) {
          var sa = winAge - idx * 0.07 - k * 0.12;
          if (sa < 0 || sa > 0.7) continue;
          var an = r2() * TAU, ds = 0.45 + r2() * 0.2;
          var sx = (ob.x + 0.5 + Math.cos(an) * ds) * T, sy = (ob.y + 0.5 + Math.sin(an) * ds) * T;
          var sz = T * 0.11 * Math.sin(sa / 0.7 * Math.PI);
          ctx.beginPath();
          ctx.moveTo(sx, sy - sz); ctx.quadraticCurveTo(sx, sy, sx + sz, sy);
          ctx.quadraticCurveTo(sx, sy, sx, sy + sz); ctx.quadraticCurveTo(sx, sy, sx - sz, sy);
          ctx.quadraticCurveTo(sx, sy, sx, sy - sz);
          ctx.fillStyle = k === 1 ? P('o-sun') : P('accent');
          ctx.fill();
        }
      });
    }
  };

  Board.prototype.drawPieceAt = function (ctx, p, T, t) {
    var L = this.L;
    ctx.save();
    ctx.translate((p.x + 0.5) * T, (p.y + 0.5) * T);
    ctx.scale(T, T);
    if (!isWallTool(p.type)) pieceBase(ctx, { fixed: false });
    var out = (p.type === 'window' || p.type === 'extractor') ? WB.outwardDir(L, p.x, p.y) : -1;
    GLYPHS[p.type](ctx, {
      T: T, t: t, d: p.d | 0, angle: t * 1.5, sway: 0, outward: out,
      role: p.type === 'window' ? (out >= 0 ? WB.windowRole(L, p) : 'outlet') : null,
      horiz: p.type === 'vent' ? WB.isFloorish(WB.cellAt(L, p.x - 1, p.y)) && WB.isFloorish(WB.cellAt(L, p.x + 1, p.y)) : true
    });
    ctx.restore();
  };

  // --------------------------------------------- airflow drawing

  function strokeWidthFor(s) { return 0.05 + 0.032 * Math.min(s, 4); }
  function speedFor(s) { return 0.75 + 0.55 * Math.min(s, 4); }

  Board.prototype.drawFlows = function (ctx, A, T, t, motion, realT) {
    var i, sg;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // stalled inlets: faint static dashes
    if (A.stalled.length) {
      ctx.beginPath();
      for (i = 0; i < A.stalled.length; i++) {
        sg = A.stalled[i];
        line(ctx, sg.ax * T, sg.ay * T, sg.bx * T, sg.by * T);
      }
      ctx.setLineDash([T * 0.07, T * 0.18]);
      ctx.strokeStyle = alpha(P('air'), 0.75);
      ctx.lineWidth = Math.max(1.2, T * 0.05);
      ctx.stroke();
      ctx.setLineDash([]);
      for (i = 0; i < A.stallEnds.length; i++) {
        var e = A.stallEnds[i];
        var mx = (e.x - e.dx * 0.12) * T, my = (e.y - e.dy * 0.12) * T, r = Math.max(5, T * 0.13);
        ctx.beginPath(); circle(ctx, mx, my, r);
        ctx.fillStyle = P('surface');
        ctx.fill();
        ctx.lineWidth = Math.max(1.3, T * 0.04);
        ctx.strokeStyle = P('bad');
        ctx.stroke();
        ctx.beginPath();
        line(ctx, mx - r * 0.5, my - r * 0.5, mx + r * 0.5, my + r * 0.5);
        line(ctx, mx + r * 0.5, my - r * 0.5, mx - r * 0.5, my + r * 0.5);
        ctx.stroke();
      }
    }

    if (A.active.length) {
      // soft beds, grouped so overlapping joints don't double up
      var groups = {};
      for (i = 0; i < A.active.length; i++) {
        sg = A.active[i];
        var gk = (sg.smoke ? 's' : 'a') + Math.min(sg.s, 4);
        (groups[gk] || (groups[gk] = [])).push(sg);
      }
      Object.keys(groups).sort().forEach(function (gk) {
        var list = groups[gk];
        ctx.beginPath();
        for (var j = 0; j < list.length; j++) line(ctx, list[j].ax * T, list[j].ay * T, list[j].bx * T, list[j].by * T);
        var smoky = gk.charAt(0) === 's', st = +gk.charAt(1);
        ctx.strokeStyle = alpha(smoky ? P('smoke') : P('air'), smoky ? 0.2 : 0.15);
        ctx.lineWidth = T * (0.13 + 0.07 * st);
        ctx.stroke();
      });
      // moving dashes, phase-aligned with path distance
      for (i = 0; i < A.active.length; i++) {
        sg = A.active[i];
        var dash = T * (0.2 + 0.07 * Math.min(sg.s, 4)), gap = T * 0.22;
        var period = dash + gap;
        var off = ((sg.dist - speedFor(sg.s) * t) * T) % period;
        if (off < 0) off += period;
        ctx.setLineDash([dash, gap]);
        ctx.lineDashOffset = off;
        ctx.beginPath();
        line(ctx, sg.ax * T, sg.ay * T, sg.bx * T, sg.by * T);
        ctx.strokeStyle = sg.smoke ? P('smoke') : P('air');
        ctx.lineWidth = Math.max(1.2, T * strokeWidthFor(sg.s));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // reduced motion: small static chevrons show the direction instead
      if (!motion) {
        ctx.beginPath();
        for (i = 0; i < A.active.length; i++) {
          sg = A.active[i];
          if (sg.len < 0.9) continue;
          var mx = (sg.ax + sg.bx) / 2 * T, my = (sg.ay + sg.by) / 2 * T, cs = T * 0.09;
          var ddx = sg.dx, ddy = sg.dy;
          ctx.moveTo(mx - ddx * cs - ddy * cs, my - ddy * cs + ddx * cs);
          ctx.lineTo(mx + ddx * cs * 0.4, my + ddy * cs * 0.4);
          ctx.lineTo(mx - ddx * cs + ddy * cs, my - ddy * cs - ddx * cs);
        }
        ctx.strokeStyle = P('air-deep');
        ctx.lineWidth = Math.max(1.3, T * 0.04);
        ctx.stroke();
      }
      // smoke puffs travelling along smoky segments
      ctx.fillStyle = alpha(P('smoke'), 0.38);
      for (i = 0; i < A.active.length; i++) {
        sg = A.active[i];
        if (!sg.smoke) continue;
        var per = 0.7;
        var ph = (sg.dist - speedFor(sg.s) * t * 0.85);
        var first = Math.ceil(ph / per) * per - ph; // distance into segment of first puff
        for (var u = first; u < sg.len; u += per) {
          var px = sg.ax + sg.dx * u, py = sg.ay + sg.dy * u;
          var kk = Math.floor((u + ph) / per);
          var wob = Math.sin(kk * 1.7 + realT * 2) * 0.06;
          ctx.beginPath();
          circle(ctx, (px - sg.dy * wob) * T, (py + sg.dx * wob) * T, T * (0.09 + 0.03 * Math.sin(kk * 2.3)));
          ctx.fill();
        }
      }
    }

    // outlet ends: air fading out
    for (i = 0; i < A.outEnds.length; i++) {
      var oe = A.outEnds[i];
      var col = oe.smoke ? P('smoke') : P('air');
      if (oe.sky) {
        for (var k = 0; k < 2; k++) {
          var pr = ((t * 0.7 + k * 0.5) % 1);
          ctx.beginPath(); circle(ctx, oe.x * T, oe.y * T, T * (0.08 + 0.3 * pr));
          ctx.strokeStyle = alpha(col, 0.6 * (1 - pr));
          ctx.lineWidth = Math.max(1, T * 0.04);
          ctx.stroke();
        }
        continue;
      }
      var lw = Math.max(1.2, T * strokeWidthFor(oe.s));
      var len = 0.75;
      for (var q = 0; q < 3; q++) {
        var pp = ((t * speedFor(oe.s) / len * 0.5 + q / 3) % 1);
        var a0 = pp * len, a1 = Math.min(len, a0 + 0.22);
        ctx.beginPath();
        line(ctx, (oe.x + oe.dx * a0) * T, (oe.y + oe.dy * a0) * T, (oe.x + oe.dx * a1) * T, (oe.y + oe.dy * a1) * T);
        ctx.strokeStyle = alpha(col, 0.85 * (1 - pp));
        ctx.lineWidth = lw * (1 - pp * 0.4);
        ctx.stroke();
      }
    }

    // blocked ends of active flows: a small soft swirl
    for (i = 0; i < A.blockEnds.length; i++) {
      var be = A.blockEnds[i];
      var sx = (be.x - be.dx * 0.16) * T, sy = (be.y - be.dy * 0.16) * T;
      ctx.beginPath();
      for (var j = 0; j <= 18; j++) {
        var an = j / 18 * Math.PI * 2.6 + realT * (motion ? 3 : 0);
        var rad = T * (0.03 + 0.1 * j / 18);
        var X = sx + Math.cos(an) * rad, Y = sy + Math.sin(an) * rad;
        if (j === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.strokeStyle = alpha(be.smoke ? P('smoke') : P('air-deep'), 0.75);
      ctx.lineWidth = Math.max(1, T * 0.035);
      ctx.stroke();
    }
    ctx.restore();
  };

  Board.prototype.drawSmokeEnds = function (ctx, A, T, t) {
    for (var i = 0; i < A.blockEnds.length; i++) {
      var be = A.blockEnds[i];
      if (!be.smoke) continue;
      var cx = (be.x - be.dx * 0.3) * T, cy = (be.y - be.dy * 0.3) * T;
      var r = T * (0.7 + 0.08 * Math.sin(t * 1.3 + i));
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, alpha(P('smoke'), 0.42));
      g.addColorStop(1, alpha(P('smoke'), 0));
      ctx.fillStyle = g;
      ctx.beginPath(); circle(ctx, cx, cy, r); ctx.fill();
    }
  };

  Board.prototype.drawStoveSmoke = function (ctx, ob, gl, a, T, t, motion) {
    var cx = (ob.x + 0.5) * T, cy = (ob.y + 0.5) * T;
    var trapped = gl.state !== 'happy';
    a.haze = approach(a.haze == null ? (trapped ? 1 : 0) : a.haze, trapped ? 1 : 0, 1.2, 0.016);
    if (a.haze > 0.02) {
      var r = T * (1.05 + 0.1 * Math.sin(t * 0.9)) * (0.6 + 0.4 * a.haze);
      var g = ctx.createRadialGradient(cx, cy - T * 0.15, 0, cx, cy - T * 0.15, r);
      g.addColorStop(0, alpha(P('smoke'), 0.42 * a.haze));
      g.addColorStop(0.6, alpha(P('smoke'), 0.2 * a.haze));
      g.addColorStop(1, alpha(P('smoke'), 0));
      ctx.fillStyle = g;
      ctx.beginPath(); circle(ctx, cx, cy - T * 0.15, r); ctx.fill();
    }
    // rising puffs (drawn after the stove body by caller order? no: under) — they rise above the burner
    var dx = a.dirx || 0, dy = a.diry || 0;
    var carried = !trapped || (gl.flow > 0);
    for (var k = 0; k < 3; k++) {
      var ph = ((t * 0.45 + k / 3) % 1);
      var px, py;
      if (carried && (dx || dy)) {
        px = cx + dx * ph * T * 0.7; py = cy - T * 0.05 + dy * ph * T * 0.7 - ph * T * 0.1;
      } else {
        px = cx + Math.sin(ph * 5 + k) * T * 0.08; py = cy - T * 0.15 - ph * T * 0.65;
      }
      ctx.beginPath(); circle(ctx, px, py, T * (0.07 + 0.11 * ph));
      ctx.fillStyle = alpha(P('smoke'), 0.42 * (1 - ph));
      ctx.fill();
    }
  };

  Board.prototype.drawPip = function (ctx, ob, state, age, T) {
    var cx = (ob.x + 0.5) * T, cy = (ob.y + 0.5) * T;
    var r = Math.max(3.8, T * 0.11);
    var px = cx + T * 0.4 - r * 0.25, py = cy - T * 0.4 + r * 0.25;
    var pop = age < 0.35 ? 1 + 0.35 * Math.sin(age / 0.35 * Math.PI) : 1;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(pop, pop);
    ctx.beginPath(); circle(ctx, 0, 0, r + Math.max(1.5, T * 0.03));
    ctx.fillStyle = P('surface');
    ctx.fill();
    ctx.beginPath(); circle(ctx, 0, 0, r);
    ctx.lineWidth = Math.max(1.4, r * 0.3);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (state === 'happy') {
      ctx.fillStyle = P('good'); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, 0.02 * r); ctx.lineTo(-r * 0.1, r * 0.36); ctx.lineTo(r * 0.48, -r * 0.34);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.3, r * 0.28);
      ctx.stroke();
    } else if (state === 'bad') {
      ctx.fillStyle = P('bad'); ctx.fill();
      ctx.beginPath();
      line(ctx, -r * 0.36, -r * 0.36, r * 0.36, r * 0.36);
      line(ctx, r * 0.36, -r * 0.36, -r * 0.36, r * 0.36);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.3, r * 0.26);
      ctx.stroke();
    } else {
      ctx.fillStyle = P('surface'); ctx.fill();
      ctx.strokeStyle = P('pip-idle');
      ctx.lineWidth = Math.max(1.4, r * 0.28);
      ctx.beginPath(); circle(ctx, 0, 0, r * 0.82); ctx.stroke();
    }
    ctx.restore();

    var badge = REQ_BADGE[ob.type];
    if (badge) {
      var fs = Math.max(7.5, Math.round(T * 0.19));
      ctx.save();
      ctx.font = '700 ' + fs + 'px ' + FONT;
      var tw = ctx.measureText(badge).width;
      var bh = fs + 3, bw = tw + fs * 0.6;
      var bx = cx - T * 0.5 + 1, by = cy + T * 0.5 - bh - 1;
      ctx.beginPath(); rr(ctx, bx, by, bw, bh, bh / 2);
      ctx.fillStyle = P('surface');
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = alpha(P('ink'), 0.14);
      ctx.stroke();
      ctx.fillStyle = state === 'happy' ? P('good') : state === 'bad' ? P('bad') : P('ink-soft');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge, bx + bw / 2, by + bh / 2 + 0.5);
      ctx.restore();
    }
  };

  root.WBRender = {
    readPalette: readPalette,
    Board: Board,
    icon: icon,
    palette: PAL
  };
})(typeof self !== 'undefined' ? self : this);
