/*
 * Windbreaker — sprites: what every tool, object and board mark looks like.
 * See GRAPHICS.md.
 *
 * A sprite is a named drawing ("tool.fan", "object.candle", "ui.pip", ...)
 * kept in a registry. js/render.js composes the board (garden, house, airflow)
 * and asks the registry to draw each sprite; the tray, goal strip and help
 * icons use the same sprites. Every built-in sprite is canvas code reading its
 * colours from js/theme.js, so it is sharp at any size and follows light/dark.
 *
 * Any sprite can be overridden by the art manifest (art/art.js) with images
 * (SVG or PNG, per state, in layers that turn with the piece or spin) or with
 * a draw function; the manifest can also retheme tokens and add textures to
 * the floor, walls and garden. Without a manifest nothing changes.
 *
 * Unit space: tool and object sprites draw around the origin (the centre of
 * their cell), 1 unit = 1 tile; o.px is one CSS pixel in units. UI sprites
 * ("ui.*") draw in CSS pixels.
 *
 * Exposes window.WBSprites (registry, kit, overrides) and window.WBArt (the
 * function an art manifest calls). Depends on window.WBTheme. Also loads in
 * Node (no images there) for the unit tests.
 */
(function (root, factory) {
  var Theme = root && root.WBTheme ? root.WBTheme : typeof require === 'function' ? require('./theme.js') : null;
  var api = factory(root, Theme);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.WBSprites = api;
    root.WBArt = api.manifest;
  }
})(typeof self !== 'undefined' ? self : null, function (root, Theme) {
  'use strict';

  var DX = [0, 1, 0, -1];
  var DY = [-1, 0, 1, 0];
  var TAU = Math.PI * 2;
  var doc = root && root.document;

  // ------------------------------------------------------------------ kit
  // Colours come from the theme; shapes are small path helpers. All of it is
  // handed to draw-function overrides as `api.kit`.

  var P = Theme.color;
  var mix = Theme.mix, alpha = Theme.alpha, darker = Theme.darker, lighter = Theme.lighter;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

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
  // o = { px, fixed, d, angle, role, outward, flow, sway, horiz, inDir, icon }
  // px = the size of one CSS pixel in unit space (for minimum stroke widths).

  function minW(o, w, pxs) { return Math.max(w, (o.px || 0) * pxs); }

  function pieceBase(ctx, o) {
    if (o.fixed) {
      // a plinth that belongs to the house
      fillRR(ctx, -0.44, -0.44, 0.88, 0.88, 0.16, mix(P('floor'), P('wall'), 0.2));
      ctx.beginPath(); rr(ctx, -0.44, -0.44, 0.88, 0.88, 0.16);
      ctx.lineWidth = minW(o, 0.03, 1.5);
      ctx.strokeStyle = alpha(P('wall'), 0.45);
      ctx.stroke();
      var rv = minW(o, 0.032, 0.9);
      ctx.beginPath();
      circle(ctx, -0.32, -0.32, rv); circle(ctx, 0.32, -0.32, rv);
      circle(ctx, 0.32, 0.32, rv); circle(ctx, -0.32, 0.32, rv);
      ctx.fillStyle = alpha(P('wall'), 0.55);
      ctx.fill();
    } else {
      fillRR(ctx, -0.43, -0.4, 0.86, 0.86, 0.17, P('piece-shadow'));
      fillRR(ctx, -0.43, -0.44, 0.86, 0.86, 0.17, P('piece-base'));
    }
  }

  function glyphWindow(ctx, o) {
    var out = o.outward < 0 ? 0 : o.outward;
    var ox = DX[out], oy = DY[out], ax = -oy, ay = ox; // outward and along-the-wall units
    var horiz = out === 0 || out === 2;
    var W = horiz ? 0.9 : 0.4, H = horiz ? 0.4 : 0.9;
    var inlet = o.role === 'inlet';
    // frame: fixed windows are part of the house, player windows are bright
    fillRR(ctx, -W / 2, -H / 2, W, H, 0.1, o.fixed ? P('wall-light') : P('piece-base'));
    var ins = 0.07;
    fillRR(ctx, -W / 2 + ins, -H / 2 + ins, W - 2 * ins, H - 2 * ins, 0.05, inlet ? P('glass-in') : P('glass'));
    // glint
    ctx.save();
    ctx.beginPath(); rr(ctx, -W / 2 + ins, -H / 2 + ins, W - 2 * ins, H - 2 * ins, 0.05); ctx.clip();
    ctx.beginPath();
    if (horiz) { line(ctx, -0.37, 0.12, -0.27, -0.12); } else { line(ctx, -0.12, -0.27, 0.12, -0.37); }
    ctx.strokeStyle = alpha(P('mark'), 0.3);
    ctx.lineWidth = 0.04;
    ctx.stroke();
    ctx.restore();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (o.icon) {
      ctx.beginPath();
      if (horiz) line(ctx, 0, -H / 2 + ins, 0, H / 2 - ins); else line(ctx, -W / 2 + ins, 0, W / 2 - ins, 0);
      ctx.strokeStyle = o.fixed ? P('wall-light') : P('piece-base');
      ctx.lineWidth = 0.06;
      ctx.stroke();
      return;
    }
    var mk = P('window-mark');
    if (inlet) {
      // two strong chevrons pointing into the house
      var cd = (out + 2) % 4;
      ctx.beginPath();
      chevron(ctx, ax * -0.17, ay * -0.17, cd, 0.095);
      chevron(ctx, ax * 0.17, ay * 0.17, cd, 0.095);
      ctx.strokeStyle = mk;
      ctx.lineWidth = minW(o, 0.06, 1.4);
      ctx.stroke();
      // a little wind-mouth on the garden side, catching the breeze
      ctx.beginPath();
      line(ctx, ox * 0.82 + ax * 0.3, oy * 0.82 + ay * 0.3, ox * 0.58 + ax * 0.13, oy * 0.58 + ay * 0.13);
      line(ctx, ox * 0.82 - ax * 0.3, oy * 0.82 - ay * 0.3, ox * 0.58 - ax * 0.13, oy * 0.58 - ay * 0.13);
      ctx.strokeStyle = alpha(P('air-deep'), 0.85);
      ctx.lineWidth = minW(o, 0.05, 1.3);
      ctx.stroke();
    } else {
      // pale pane, one soft chevron and an arrow poking out into the garden
      ctx.beginPath();
      chevron(ctx, 0, 0, out, 0.09);
      ctx.strokeStyle = alpha(mk, 0.55);
      ctx.lineWidth = minW(o, 0.05, 1.2);
      ctx.stroke();
      ctx.beginPath();
      line(ctx, ox * 0.54, oy * 0.54, ox * 0.8, oy * 0.8);
      chevron(ctx, ox * 0.76, oy * 0.76, out, 0.1);
      ctx.strokeStyle = alpha(P('air-deep'), 0.7);
      ctx.lineWidth = minW(o, 0.05, 1.3);
      ctx.stroke();
    }
  }

  function glyphFan(ctx, o) {
    var col = P('t-fan');
    var d = o.d | 0;
    var dx = DX[d], dy = DY[d], px = -dy, py = dx;
    // bold nozzle arrow on the blowing side
    ctx.beginPath();
    ctx.moveTo(dx * 0.53, dy * 0.53);
    ctx.lineTo(dx * 0.24 + px * 0.22, dy * 0.24 + py * 0.22);
    ctx.lineTo(dx * 0.24 - px * 0.22, dy * 0.24 - py * 0.22);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = col;
    ctx.fill();
    ctx.stroke();
    // cage
    ctx.beginPath(); circle(ctx, 0, 0, 0.29);
    ctx.fillStyle = o.fixed ? mix(P('piece-base'), P('wall-light'), 0.35) : P('piece-base');
    ctx.fill();
    ctx.lineWidth = minW(o, 0.06, 1.5);
    ctx.strokeStyle = col;
    ctx.stroke();
    // blades
    ctx.save();
    ctx.rotate(o.angle || 0);
    ctx.fillStyle = alpha(col, 0.85);
    for (var k = 0; k < 3; k++) {
      ctx.rotate(TAU / 3);
      ctx.beginPath();
      ctx.ellipse(0.02, -0.125, 0.068, 0.12, 0.35, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath(); circle(ctx, 0, 0, 0.05);
    ctx.fillStyle = darker(col, 0.2);
    ctx.fill();
  }

  function glyphDeflector(ctx, o) {
    var col = P('t-deflector');
    ctx.save();
    ctx.rotate((o.d | 0) === 1 ? Math.PI / 4 : -Math.PI / 4);
    var hl = 0.42, w = 0.1;
    function vane(dy) {
      ctx.beginPath();
      ctx.moveTo(-hl, dy);
      ctx.quadraticCurveTo(0, dy - w * 1.9, hl, dy);
      ctx.quadraticCurveTo(0, dy + w * 1.5, -hl, dy);
      ctx.closePath();
    }
    vane(0.035);
    ctx.fillStyle = darker(col, 0.25);
    ctx.fill();
    vane(0);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = minW(o, 0.03, 1);
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-hl * 0.62, -0.03); ctx.quadraticCurveTo(0, -0.115, hl * 0.62, -0.03);
    ctx.strokeStyle = alpha(P('mark'), 0.45);
    ctx.lineWidth = 0.03;
    ctx.lineCap = 'round';
    ctx.stroke();
    // pivot
    ctx.beginPath(); circle(ctx, 0, -0.005, 0.055);
    ctx.fillStyle = P('piece-base');
    ctx.fill();
    ctx.lineWidth = minW(o, 0.03, 1);
    ctx.strokeStyle = darker(col, 0.35);
    ctx.stroke();
    ctx.restore();
  }

  function glyphCurtain(ctx, o) {
    var col = P('t-curtain');
    var sw = o.sway || 0;
    var top = -0.29, bot = 0.33, L = -0.31, R = 0.31;
    ctx.lineCap = 'round';
    ctx.beginPath(); line(ctx, -0.39, -0.33, 0.39, -0.33);
    ctx.strokeStyle = P('ink-soft');
    ctx.lineWidth = minW(o, 0.045, 1.2);
    ctx.stroke();
    ctx.beginPath(); circle(ctx, -0.39, -0.33, 0.04); circle(ctx, 0.39, -0.33, 0.04);
    ctx.fillStyle = P('ink-soft');
    ctx.fill();
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
    ctx.beginPath();
    for (var j = 1; j < n; j++) {
      var fx = L + wv * j;
      ctx.moveTo(fx, top + 0.04);
      ctx.quadraticCurveTo(fx + sw * 0.3, 0.05, fx + sw, bot - 0.01);
    }
    ctx.strokeStyle = darker(col, 0.18);
    ctx.lineWidth = minW(o, 0.03, 1);
    ctx.stroke();
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
    ctx.lineWidth = minW(o, 0.05, 1.2);
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // A wedge body with a white T-arrow: air in from one side, out to left and right.
  function glyphSplitter(ctx, o) {
    var col = P('t-splitter');
    var r = 0.37;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
    ctx.fillStyle = col;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.09;
    ctx.strokeStyle = col;
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.rotate((o.inDir == null ? 0 : o.inDir) * Math.PI / 2);
    ctx.beginPath();
    line(ctx, 0, 0.24, 0, 0.0);
    line(ctx, -0.2, 0.0, 0.2, 0.0);
    ctx.moveTo(-0.11, -0.085); ctx.lineTo(-0.205, 0); ctx.lineTo(-0.11, 0.085);
    ctx.moveTo(0.11, -0.085); ctx.lineTo(0.205, 0); ctx.lineTo(0.11, 0.085);
    ctx.strokeStyle = P('mark');
    ctx.lineWidth = minW(o, 0.06, 1.4);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function glyphExtractor(ctx, o) {
    var col = P('t-extractor');
    ctx.beginPath(); circle(ctx, 0, 0, 0.38);
    ctx.fillStyle = o.fixed ? P('wall-light') : P('piece-base');
    ctx.fill();
    ctx.beginPath(); circle(ctx, 0, 0, 0.3);
    ctx.lineWidth = minW(o, 0.06, 1.4);
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

  // A roof window seen from below: tapered glass and an arrow going up and out.
  function glyphSkylight(ctx, o) {
    var frame = P('wall-light');
    fillRR(ctx, -0.37, -0.37, 0.74, 0.74, 0.1, frame);
    ctx.beginPath();
    ctx.moveTo(-0.21, -0.29); ctx.lineTo(0.21, -0.29); ctx.lineTo(0.29, 0.29); ctx.lineTo(-0.29, 0.29); ctx.closePath();
    ctx.fillStyle = P('t-skylight');
    ctx.fill();
    ctx.beginPath();
    line(ctx, 0, 0.18, 0, -0.14);
    chevron(ctx, 0, -0.1, 0, 0.13);
    ctx.strokeStyle = P('mark');
    ctx.lineWidth = minW(o, 0.065, 1.5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function glyphFilter(ctx, o) {
    var col = P('t-filter');
    fillRR(ctx, -0.34, -0.34, 0.68, 0.68, 0.11, mix(col, P('piece-base'), 0.62));
    ctx.save();
    ctx.beginPath(); rr(ctx, -0.29, -0.29, 0.58, 0.58, 0.07); ctx.clip();
    ctx.beginPath();
    var r = 0.085, hw = r * Math.sqrt(3) / 2;
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
    ctx.strokeStyle = alpha(col, 0.9);
    ctx.lineWidth = minW(o, 0.025, 0.8);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath(); rr(ctx, -0.34, -0.34, 0.68, 0.68, 0.11);
    ctx.strokeStyle = col;
    ctx.lineWidth = minW(o, 0.055, 1.4);
    ctx.stroke();
  }

  function glyphCeilingFan(ctx, o) {
    var col = P('t-ceilingfan');
    ctx.save();
    ctx.rotate(o.angle || 0);
    ctx.fillStyle = alpha(col, 0.95);
    for (var k = 0; k < 4; k++) {
      ctx.rotate(TAU / 4);
      // a swept paddle with a rounded tip
      ctx.beginPath();
      ctx.moveTo(0.1, -0.045);
      ctx.quadraticCurveTo(0.27, -0.085, 0.4, -0.115);
      ctx.arc(0.41, -0.035, 0.08, -Math.PI * 0.55, Math.PI * 0.5);
      ctx.quadraticCurveTo(0.26, 0.06, 0.1, 0.045);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // motor housing
    ctx.beginPath(); circle(ctx, 0, 0, 0.16);
    ctx.fillStyle = darker(col, 0.22);
    ctx.fill();
    ctx.beginPath(); circle(ctx, 0, 0, 0.11);
    ctx.lineWidth = minW(o, 0.03, 1);
    ctx.strokeStyle = lighter(col, 0.35);
    ctx.stroke();
    ctx.beginPath(); circle(ctx, 0, 0, 0.045);
    ctx.fillStyle = o.fixed ? P('wall') : P('piece-base');
    ctx.fill();
  }

  var TOOL_IDS = ['window', 'fan', 'deflector', 'curtain', 'vent', 'splitter', 'extractor', 'skylight', 'filter', 'ceilingfan'];

  // ------------------------------------------------------------------ objects
  // a = animation state { angle, flow, lit, dry, scatter, flutter, bend, sway, small, px... }
  // a.small switches to chunkier, simpler shapes for small tiles.

  function objPinwheel(ctx, a) {
    ctx.lineCap = 'round';
    ctx.beginPath(); line(ctx, 0, 0, 0.02, 0.44);
    ctx.strokeStyle = P('table-edge');
    ctx.lineWidth = Math.max(0.05, (a.px || 0) * 1.4);
    ctx.stroke();
    var cols = [P('o-coral'), P('o-sun'), P('o-teal'), P('o-sky')];
    var R = a.small ? 0.34 : 0.31;
    ctx.save();
    ctx.translate(0, -0.03);
    ctx.rotate(a.angle || 0);
    for (var k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -R);
      ctx.quadraticCurveTo(R * 0.65, -R * 0.97, R * 0.65, -0.04);
      ctx.closePath();
      ctx.fillStyle = cols[k];
      ctx.fill();
      ctx.rotate(TAU / 4);
    }
    ctx.restore();
    ctx.beginPath(); circle(ctx, 0, -0.03, 0.05);
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
    var sw = a.small ? 1.25 : 1;
    ctx.beginPath(); ctx.ellipse(0, 0.33, 0.25, 0.075, 0, 0, TAU);
    ctx.fillStyle = P('wall-light');
    ctx.fill();
    ctx.beginPath(); rr(ctx, -0.085 * sw, -0.12, 0.17 * sw, 0.45, 0.045);
    ctx.fillStyle = P('o-cream');
    ctx.fill();
    ctx.strokeStyle = alpha(P('ink'), 0.22);
    ctx.lineWidth = Math.max(0.025, (a.px || 0) * 0.9);
    ctx.stroke();
    ctx.beginPath(); line(ctx, 0, -0.12, 0, -0.17);
    ctx.strokeStyle = P('ink');
    ctx.lineWidth = 0.025;
    ctx.lineCap = 'round';
    ctx.stroke();
    if (lit > 0.02) {
      var fl = 1 + 0.07 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 21.7 + 1);
      var h = 0.21 * lit * fl * sw, w = 0.075 * lit * sw;
      var lean = 0.02 * Math.sin(t * 7.3);
      ctx.beginPath();
      ctx.moveTo(lean, -0.17 - h);
      ctx.bezierCurveTo(w * 1.3, -0.17 - h * 0.45, w, -0.15, 0, -0.145);
      ctx.bezierCurveTo(-w, -0.15, -w * 1.3, -0.17 - h * 0.45, lean, -0.17 - h);
      ctx.fillStyle = P('o-flame');
      ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -0.19, w * 0.45, h * 0.28, 0, 0, TAU);
      ctx.fillStyle = P('o-flame-core');
      ctx.fill();
    }
    if (lit < 0.98) {
      var al = (1 - lit) * 0.75;
      ctx.beginPath();
      for (var i = 0; i <= 12; i++) {
        var u = i / 12;
        var x = Math.sin(u * 7 - t * 3.2) * 0.05 * (0.3 + u) + (a.dirx || 0) * u * 0.12;
        var y = -0.17 - u * 0.33;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = alpha(P('smoke'), al);
      ctx.lineWidth = Math.max(0.035, (a.px || 0) * 1.2);
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
    var small = !!a.small;
    ctx.lineCap = 'round';
    var lineY = small ? -0.3 : -0.28;
    if (!small) {
      ctx.beginPath(); line(ctx, -0.41, -0.32, -0.41, 0.4); line(ctx, 0.41, -0.32, 0.41, 0.4);
      ctx.strokeStyle = P('table-edge');
      ctx.lineWidth = 0.045;
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(small ? -0.47 : -0.41, lineY); ctx.quadraticCurveTo(0, lineY + 0.1, small ? 0.47 : 0.41, lineY);
    ctx.strokeStyle = P('ink-soft');
    ctx.lineWidth = Math.max(small ? 0.04 : 0.02, (a.px || 0) * 1.5);
    ctx.stroke();
    var amp = 0.05 + 0.11 * Math.min(f, 3);
    var lean = clamp(a.dirx || 0, -1, 1) * 0.16 * Math.min(f, 3);
    var sw1 = lean + amp * Math.sin(t * (2.1 + f * 1.4));
    var sw2 = lean + amp * 1.15 * Math.sin(t * (2.4 + f * 1.5) + 1.3);
    var damp = 1 - dry;
    var soot = a.soot || 0; // smoky air has reached it: grey, smudged garments
    var sootCol = darker(P('smoke'), 0.18);
    var shirtCol = mix(mix(P('o-sky'), mix(P('o-sky'), P('smoke'), 0.55), damp), sootCol, 0.62 * soot);
    var towelCol = mix(mix(P('o-coral'), mix(P('o-coral'), P('smoke'), 0.55), damp), sootCol, 0.62 * soot);
    var smudge = alpha(darker(P('smoke'), 0.45), 0.85 * soot);
    var sx = small ? -0.2 : -0.17, tx = small ? 0.21 : 0.18;
    var py = lineY + (small ? 0.05 : 0.055);
    ctx.save();
    ctx.translate(sx, py);
    ctx.rotate(sw1);
    if (small) ctx.scale(1.35, 1.3);
    tshirt(ctx);
    ctx.fillStyle = shirtCol;
    ctx.fill();
    if (soot > 0.02) {
      ctx.beginPath(); ctx.ellipse(0.035, 0.17, 0.045, 0.032, 0.4, 0, TAU); circle(ctx, -0.05, 0.24, 0.022);
      ctx.fillStyle = smudge;
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(tx, py + 0.01);
    ctx.rotate(sw2);
    var tw = small ? 0.12 : 0.085, th = small ? 0.38 : 0.3;
    ctx.beginPath(); rr(ctx, -tw, 0, tw * 2, th, 0.03);
    ctx.fillStyle = towelCol;
    ctx.fill();
    ctx.beginPath(); line(ctx, -tw, th * 0.78, tw, th * 0.78);
    ctx.strokeStyle = alpha(P('mark'), 0.6 - 0.35 * soot);
    ctx.lineWidth = small ? 0.045 : 0.03;
    ctx.stroke();
    if (soot > 0.02) {
      ctx.beginPath(); ctx.ellipse(-tw * 0.15, th * 0.4, tw * 0.55, th * 0.1, -0.3, 0, TAU);
      ctx.fillStyle = smudge;
      ctx.fill();
    }
    ctx.restore();
    if (!small) {
      ctx.beginPath(); circle(ctx, sx, py, 0.025); circle(ctx, tx, py + 0.01, 0.025);
      ctx.fillStyle = P('table-edge');
      ctx.fill();
    }
    // a small grey wisp curling off the line
    if (soot > 0.02 && !small) {
      for (var k = 0; k < 2; k++) {
        var wp = (t * 0.5 + k * 0.5) % 1;
        ctx.beginPath(); circle(ctx, 0.02 + Math.sin(wp * 4 + k) * 0.04, lineY - 0.04 - wp * 0.16, 0.035 + 0.04 * wp);
        ctx.fillStyle = alpha(P('smoke'), 0.5 * soot * (1 - wp));
        ctx.fill();
      }
    }
    if (damp > 0.05) {
      ctx.fillStyle = alpha(P('air-deep'), 0.75 * damp);
      var dr = small ? 0.03 : 0.02;
      for (var i = 0; i < 2; i++) {
        var ph = (t * 0.9 + i * 0.5) % 1;
        var x = i === 0 ? sx + Math.sin(sw1) * -0.3 : tx + Math.sin(sw2) * -0.3;
        var y = 0.1 + ph * 0.3;
        ctx.globalAlpha = (1 - ph);
        ctx.beginPath(); ctx.ellipse(x, y, dr, dr * 1.4, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function paperSheet(ctx, w, h, lines, corner, lw) {
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
    ctx.strokeStyle = alpha(P('ink'), 0.22);
    ctx.lineWidth = lw ? lw * 0.6 : 0.02;
    ctx.stroke();
    if (lines) {
      ctx.beginPath();
      var step = (h - 0.16) / Math.max(1, lines - 0.4);
      for (var i = 0; i < lines; i++) {
        var y = -h / 2 + 0.09 + i * step;
        line(ctx, -w / 2 + 0.07, y, w / 2 - (i === lines - 1 ? 0.15 : 0.07), y);
      }
      ctx.strokeStyle = alpha(P('ink-soft'), 0.55);
      ctx.lineWidth = lw || 0.022;
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
    var small = !!a.small;
    var W = small ? 0.52 : 0.44, H = small ? 0.62 : 0.54;
    var lw = small ? Math.max(0.045, (a.px || 0) * 1.3) : 0.022;
    ctx.save(); ctx.rotate(-0.14); ctx.translate(-0.03, 0.03); paperSheet(ctx, W, H, 0, 0, small ? lw : 0); ctx.restore();
    if (!small && sc < 0.9) {
      ctx.save(); ctx.rotate(0.07); ctx.translate(0.02, 0.0); paperSheet(ctx, W, H, 0, 0); ctx.restore();
    }
    var corner = 0.04 + fl * (0.08 + 0.05 * Math.sin(t * 9));
    ctx.save();
    ctx.globalAlpha = 1 - sc;
    ctx.rotate(0.03 + fl * 0.03 * Math.sin(t * 7));
    paperSheet(ctx, W, H, small ? 3 : 5, corner, small ? lw : 0);
    ctx.restore();
    if (sc > 0.01) {
      var dx = a.dirx || 0, dy = a.diry || 0;
      if (!dx && !dy) dx = 1;
      var px = -dy, py = dx;
      var n = small ? 2 : 3;
      for (var i = 0; i < n; i++) {
        var ph = (t * 0.35 + i / n) % 1;
        var dist = (0.12 + 0.42 * ph) * sc;
        var wob = Math.sin(t * 3 + i * 2.1) * 0.16 * sc;
        var side = (i - (n - 1) / 2) * 0.2 * sc;
        ctx.save();
        ctx.translate(dx * dist + px * (wob + side), dy * dist + py * (wob + side));
        ctx.rotate(t * (1.4 + i * 0.5) + i * 2);
        ctx.globalAlpha = sc * (1 - Math.pow(ph, 3));
        paperSheet(ctx, small ? 0.32 : 0.27, small ? 0.38 : 0.33, small ? 2 : 3, 0, small ? lw : 0);
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
    var dark = darker(leaf, 0.2);
    var i, ang;
    if (a.small) {
      // three fat fronds
      var angs = [-0.78, 0, 0.78], ls = [0.36, 0.44, 0.36];
      for (i = 0; i < 3; i++) {
        ang = angs[i] + swayAmp * Math.sin(t * (2.2 + f * 0.6) + i * 0.9);
        ang = ang * (1 - bend * 0.45) + side * bend * (0.75 + 0.15 * Math.sin(t * 6 + i));
        var L = ls[i] * (1 - bend * 0.12);
        var bx = 0, by = 0.15;
        var tx = bx + Math.sin(ang) * L, ty = by - Math.cos(ang) * L + bend * 0.06;
        var nx = Math.cos(ang), ny = Math.sin(ang), wd = 0.12;
        var mx = (bx + tx) / 2, my = (by + ty) / 2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(mx + nx * wd, my + ny * wd, tx, ty);
        ctx.quadraticCurveTo(mx - nx * wd, my - ny * wd, bx, by);
        ctx.fillStyle = leaf;
        ctx.fill();
        ctx.beginPath(); line(ctx, bx, by, mx + (tx - mx) * 0.6, my + (ty - my) * 0.6);
        ctx.strokeStyle = dark;
        ctx.lineWidth = Math.max(0.03, (a.px || 0) * 1);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-0.19, 0.17); ctx.lineTo(0.19, 0.17); ctx.lineTo(0.15, 0.44); ctx.lineTo(-0.15, 0.44); ctx.closePath();
      ctx.fillStyle = P('o-pot');
      ctx.fill();
      fillRR(ctx, -0.215, 0.12, 0.43, 0.09, 0.035, darker(P('o-pot'), 0.12));
      return;
    }
    var base = [-1.05, -0.52, 0, 0.52, 1.05];
    var lens = [0.3, 0.38, 0.42, 0.38, 0.3];
    for (i = 0; i < 5; i++) {
      ang = base[i] + swayAmp * Math.sin(t * (2.2 + f * 0.6) + i * 0.9);
      ang = ang * (1 - bend * 0.45) + side * bend * (0.75 + 0.15 * Math.sin(t * 6 + i));
      var len = lens[i] * (1 - bend * 0.15);
      var curl = (0.22 + bend * 0.5) * (ang >= 0 ? 1 : -1);
      var sx = 0, sy = 0.16;
      var ex = sx + Math.sin(ang) * len, ey = sy - Math.cos(ang) * len;
      var cx = sx + Math.sin(ang - curl * 0.5) * len * 0.55, cy = sy - Math.cos(ang - curl * 0.5) * len * 0.55;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, ex, ey + bend * 0.08);
      ctx.strokeStyle = dark;
      ctx.lineWidth = 0.025;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.fillStyle = leaf;
      for (var j = 1; j <= 5; j++) {
        var u = j / 6;
        var qx = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * ex;
        var qy = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * (ey + bend * 0.08);
        var tgx = 2 * (1 - u) * (cx - sx) + 2 * u * (ex - cx);
        var tgy = 2 * (1 - u) * (cy - sy) + 2 * u * (ey - cy);
        var ta = Math.atan2(tgy, tgx);
        var sz = 0.055 * (1.15 - u * 0.75);
        ctx.beginPath();
        ctx.ellipse(qx + Math.cos(ta - 1.1) * sz, qy + Math.sin(ta - 1.1) * sz, sz, sz * 0.42, ta - 1.1, 0, TAU);
        ctx.ellipse(qx + Math.cos(ta + 1.1) * sz, qy + Math.sin(ta + 1.1) * sz, sz, sz * 0.42, ta + 1.1, 0, TAU);
        ctx.fill();
      }
    }
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
    ctx.lineWidth = Math.max(0.035, (a.px || 0) * 1.1);
    ctx.stroke();
    ctx.beginPath(); circle(ctx, 0, -0.05, 0.21);
    ctx.fillStyle = P('o-burner');
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
    ctx.strokeStyle = P('o-grate');
    ctx.lineWidth = 0.04;
    ctx.stroke();
    ctx.beginPath(); circle(ctx, -0.14, 0.27, 0.038); circle(ctx, 0.14, 0.27, 0.038);
    ctx.fillStyle = P('o-stove-edge');
    ctx.fill();
  }


  // ------------------------------------------------------------------ status pip and "no way out" mark (CSS px)

  function pipShape(ctx, state, r) {
    ctx.beginPath(); circle(ctx, 0, 0, r + Math.max(1.5, r * 0.28));
    ctx.fillStyle = P('surface');
    ctx.fill();
    ctx.beginPath(); circle(ctx, 0, 0, r);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (state === 'happy') {
      ctx.fillStyle = P('good'); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, 0.02 * r); ctx.lineTo(-r * 0.1, r * 0.36); ctx.lineTo(r * 0.48, -r * 0.34);
      ctx.strokeStyle = P('mark');
      ctx.lineWidth = Math.max(1.3, r * 0.3);
      ctx.stroke();
    } else if (state === 'dirty') {
      // laundry reached by smoky air: a soot-grey badge with a little puff
      ctx.fillStyle = darker(P('smoke'), 0.3); ctx.fill();
      ctx.beginPath();
      circle(ctx, -r * 0.3, r * 0.1, r * 0.27);
      circle(ctx, r * 0.02, -r * 0.14, r * 0.33);
      circle(ctx, r * 0.33, r * 0.12, r * 0.25);
      ctx.fillStyle = P('mark');
      ctx.fill();
      ctx.beginPath(); rr(ctx, -r * 0.55, r * 0.08, r * 1.1, r * 0.3, r * 0.15);
      ctx.fill();
    } else if (state === 'bad') {
      ctx.fillStyle = P('bad'); ctx.fill();
      ctx.beginPath();
      line(ctx, -r * 0.36, -r * 0.36, r * 0.36, r * 0.36);
      line(ctx, r * 0.36, -r * 0.36, -r * 0.36, r * 0.36);
      ctx.strokeStyle = P('mark');
      ctx.lineWidth = Math.max(1.3, r * 0.28);
      ctx.stroke();
    } else {
      ctx.fillStyle = P('surface'); ctx.fill();
      ctx.strokeStyle = P('pip-idle');
      ctx.lineWidth = Math.max(1.4, r * 0.3);
      ctx.beginPath(); circle(ctx, 0, 0, r * 0.8); ctx.stroke();
    }
  }

  // "No way out": a bare red x (no ring, so it never reads as an unhappy
  // status pip), drawn inside the wall the stalled stream runs into.
  function stallMarker(ctx, x, y, r, col) {
    var k = r * 0.62;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    line(ctx, x - k, y - k, x + k, y + k);
    line(ctx, x + k, y - k, x - k, y + k);
    ctx.strokeStyle = P('surface');
    ctx.lineWidth = Math.max(3.6, r * 0.8);
    ctx.stroke();
    ctx.strokeStyle = col || P('bad');
    ctx.lineWidth = Math.max(1.9, r * 0.4);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ tray icons
  // id: a tool. Drawn in unit space scaled to the icon (see WBRender.icon).

  function toolIcon(ctx, id) {
    if (id === 'window') {
      // a window seen from the front: frame, two panes, a sill
      fillRR(ctx, -0.33, -0.38, 0.66, 0.68, 0.09, P('piece-base'));
      ctx.beginPath(); rr(ctx, -0.33, -0.38, 0.66, 0.68, 0.09);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = P('icon-wall');
      ctx.stroke();
      fillRR(ctx, -0.25, -0.3, 0.215, 0.52, 0.04, P('glass-in'));
      fillRR(ctx, 0.035, -0.3, 0.215, 0.52, 0.04, P('glass-in'));
      ctx.beginPath(); line(ctx, -0.2, -0.12, -0.1, -0.24); line(ctx, 0.08, -0.12, 0.18, -0.24);
      ctx.strokeStyle = alpha(P('mark'), 0.55);
      ctx.lineWidth = 0.04;
      ctx.lineCap = 'round';
      ctx.stroke();
      fillRR(ctx, -0.43, 0.27, 0.86, 0.12, 0.06, P('icon-wall'));
    } else if (id === 'vent') {
      fillRR(ctx, -0.5, -0.42, 1, 0.84, 0.16, P('icon-wall'));
      draw('tool.vent', ctx, { horiz: true });
    } else if (id === 'extractor') {
      fillRR(ctx, -0.46, -0.46, 0.92, 0.92, 0.2, P('icon-wall'));
      draw('tool.extractor', ctx, { angle: 0.3 });
    } else if (id === 'fan') {
      ctx.translate(-0.04, 0);
      draw('tool.fan', ctx, { d: 1, angle: 0.4 });
    } else if (id === 'splitter') {
      draw('tool.splitter', ctx, { inDir: 0 });
    } else {
      draw('tool.' + id, ctx, { d: 0, angle: 0.4, sway: 0 });
    }
  }

  // ------------------------------------------------------------------ registry

  var REG = {}, ORDER = [];
  var TILE = [-0.5, -0.5, 1, 1];
  var NONE = [];
  var listeners = [];

  /*
   * define(name, spec) registers (or replaces) a built-in sprite.
   *   draw(ctx, o, t)   the built-in drawing; t = seconds, for idle motion
   *   group             'tool' | 'object' | 'icon' | 'ui'
   *   note              one line for the studio and GRAPHICS.md
   *   states            state names an image override may give (see state)
   *   state(o)          -> state names that apply to o, most specific first
   *   turn(o)           -> radians: how far an image override turns (art faces north)
   *   box               [x, y, w, h] an image fills by default (units; default the tile)
   *   unit(o)           ui sprites: CSS px per box unit
   *   at                ui sprites: images are placed at (o.x, o.y)
   *   samples           [{ label, o, t }] poses the studio shows (and the unit tests draw)
   */
  function define(name, spec) {
    if (!REG[name]) ORDER.push(name);
    spec.name = name;
    spec.box = spec.box || TILE;
    spec.states = spec.states || NONE;
    spec.samples = spec.samples || [{ label: '', o: {} }];
    spec.ov = REG[name] ? REG[name].ov : null;
    REG[name] = spec;
    return spec;
  }

  // Draws a sprite: its override when one is ready, else the built-in art.
  function draw(name, ctx, o, t) {
    var s = REG[name];
    if (!s) return false;
    var ov = s.ov;
    if (ov !== null && ov.ready) drawOverride(s, ov, ctx, o || {}, t || 0);
    else s.draw(ctx, o || {}, t || 0);
    return true;
  }
  function drawBuiltin(name, ctx, o, t) {
    var s = REG[name];
    if (!s) return false;
    s.draw(ctx, o || {}, t || 0);
    return true;
  }

  // ------------------------------------------------------------------ images

  var IMG = {};          // src -> { src, img, ok, err }
  var RASTER = {}, rasterN = 0;
  var loading = 0;       // images on their way

  function loadImage(src, done) {
    var im = IMG[src];
    if (im) {
      if (im.ok || im.err) done(im); else im.waiters.push(done);
      return im;
    }
    im = IMG[src] = { src: src, img: null, ok: false, err: null, waiters: [done] };
    loading++;
    function settle() {
      loading--;
      var w = im.waiters; im.waiters = [];
      w.forEach(function (f) { f(im); });
    }
    if (!root || !root.Image) { im.err = 'images need a browser'; settle(); return im; }
    var img = new root.Image();
    img.onload = function () {
      if (!(img.naturalWidth > 0)) im.err = 'the image has no size (give an SVG width, height and viewBox)';
      else { im.ok = true; im.img = img; }
      settle();
    };
    img.onerror = function () { im.err = 'could not load ' + src; settle(); };
    img.src = src;
    return im;
  }

  // Draws a loaded image into the box, through a bitmap cached at the size it
  // lands on screen (so an SVG is rasterised once, not every frame).
  function blit(ctx, im, x, y, w, h) {
    var m = ctx.getTransform ? ctx.getTransform() : null;
    var sx = m ? Math.hypot(m.a, m.b) : 1, sy = m ? Math.hypot(m.c, m.d) : 1;
    var pw = Math.min(1024, Math.max(4, Math.ceil(w * sx / 4) * 4));
    var ph = Math.min(1024, Math.max(4, Math.ceil(h * sy / 4) * 4));
    var key = im.src + '|' + pw + 'x' + ph;
    var r = RASTER[key];
    if (!r) {
      if (++rasterN > 400) { RASTER = {}; rasterN = 1; }
      r = doc.createElement('canvas');
      r.width = pw; r.height = ph;
      var rc = r.getContext('2d');
      rc.imageSmoothingQuality = 'high';
      rc.drawImage(im.img, 0, 0, pw, ph);
      RASTER[key] = r;
    }
    ctx.drawImage(r, x, y, w, h);
  }

  // ------------------------------------------------------------------ overrides

  function warn(msg) { if (typeof console !== 'undefined') console.warn('Windbreaker art: ' + msg); }

  function pickSrc(layer, keys) {
    if (layer.states) {
      for (var i = 0; i < keys.length; i++) {
        if (Object.prototype.hasOwnProperty.call(layer.states, keys[i])) return layer.states[keys[i]];
      }
    }
    return layer.src;
  }

  function drawOverride(s, ov, ctx, o, t) {
    if (ov.draw) { ov.draw(ctx, o, t, ov.api); return; }
    if (ov.base) s.draw(ctx, o, t);
    var keys = s.state ? s.state(o) : NONE;
    var u = s.unit ? s.unit(o) : 1;
    var turn = ov.rotate && s.turn ? s.turn(o) : 0;
    ctx.save();
    if (s.at) ctx.translate(o.x || 0, o.y || 0);
    if (u !== 1) ctx.scale(u, u);
    if (turn) ctx.rotate(turn);
    for (var i = 0; i < ov.layers.length; i++) {
      var L = ov.layers[i];
      var src = pickSrc(L, keys);
      if (!src) continue;
      var im = IMG[src];
      if (!im || !im.ok) continue;
      var b = L.box || ov.box || s.box;
      if (L.spin) {
        var cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(o.angle || 0);
        blit(ctx, im, -b[2] / 2, -b[3] / 2, b[2], b[3]);
        ctx.restore();
      } else {
        blit(ctx, im, b[0], b[1], b[2], b[3]);
      }
    }
    ctx.restore();
  }

  function isBox(b) { return Array.isArray(b) && b.length === 4 && b.every(function (v) { return typeof v === 'number' && isFinite(v); }); }

  // A manifest entry -> { layers, rotate, base, box, draw, files, ready, error }
  function normalize(name, spec) {
    if (typeof spec === 'string') spec = { src: spec };
    if (typeof spec === 'function') spec = { draw: spec };
    if (!spec || typeof spec !== 'object') throw new Error('expected a file name, an object or a function');
    var ov = {
      name: name, layers: [], rotate: spec.rotate !== false, base: !!spec.base, box: null, draw: null,
      files: [], ready: false, error: null, kind: 'image'
    };
    if (spec.box != null) { if (!isBox(spec.box)) throw new Error('box must be [x, y, w, h]'); ov.box = spec.box; }
    if (typeof spec.draw === 'function') {
      ov.kind = 'code';
      ov.draw = spec.draw;
      ov.api = {
        name: name, kit: KIT,
        base: REG[name].draw,
        image: function (ctx, src, x, y, w, h) {
          var im = IMG[src];
          if (im && im.ok) { blit(ctx, im, x, y, w, h); return true; }
          return false;
        }
      };
      (spec.images || []).forEach(function (f) { ov.files.push(String(f)); });
      return ov;
    }
    var layers = spec.layers || [{ src: spec.src, states: spec.states, spin: spec.spin }];
    if (!Array.isArray(layers) || !layers.length) throw new Error('layers must be a list');
    layers.forEach(function (l, i) {
      if (typeof l === 'string') l = { src: l };
      var L = { src: l.src || null, states: null, box: null, spin: !!l.spin };
      if (l.box != null) { if (!isBox(l.box)) throw new Error('layer ' + i + ': box must be [x, y, w, h]'); L.box = l.box; }
      if (l.states) {
        if (typeof l.states !== 'object') throw new Error('layer ' + i + ': states must map state names to files');
        L.states = {};
        Object.keys(l.states).forEach(function (k) {
          if (REG[name].states.indexOf(k) < 0) warn(name + ': unknown state "' + k + '" (it has: ' + (REG[name].states.join(', ') || 'none') + ')');
          L.states[k] = l.states[k] ? String(l.states[k]) : null;
        });
      }
      if (!L.src && !L.states) throw new Error('layer ' + i + ' has no src');
      if (L.src) ov.files.push(L.src);
      if (L.states) Object.keys(L.states).forEach(function (k) { if (L.states[k]) ov.files.push(L.states[k]); });
      ov.layers.push(L);
    });
    return ov;
  }

  function loadFiles(ov, onDone) {
    var files = ov.files.filter(function (f, i, a) { return a.indexOf(f) === i; });
    var left = files.length;
    if (!left) { onDone(); return; }
    files.forEach(function (f) {
      loadImage(f, function (im) {
        if (im.err && !ov.error) ov.error = im.err;
        if (--left === 0) onDone();
      });
    });
  }

  // override(name, spec | null): replace a sprite's art (null restores the built-in).
  function override(name, spec) {
    var s = REG[name];
    if (!s) { warn('there is no sprite "' + name + '" (see GRAPHICS.md or the studio for the list)'); return false; }
    if (spec == null) { s.ov = null; changed('sprites'); return true; }
    var ov;
    try { ov = normalize(name, spec); } catch (e) { warn(name + ': ' + e.message); return false; }
    s.ov = ov;
    loadFiles(ov, function () {
      if (s.ov !== ov) return;
      if (ov.error) warn(name + ': ' + ov.error + ' (keeping the built-in art)');
      ov.ready = !ov.error;
      changed('sprites');
    });
    return true;
  }

  // ------------------------------------------------------------------ textures
  // Repeating images laid over the floor, the walls or the garden (drawn by
  // js/render.js when the level's static layers are built).

  var TEXTURE_NAMES = ['garden', 'floor', 'wall'];
  var TEX = {};
  function setTexture(name, spec) {
    if (TEXTURE_NAMES.indexOf(name) < 0) { warn('no texture "' + name + '" (use ' + TEXTURE_NAMES.join(', ') + ')'); return false; }
    if (spec == null) { delete TEX[name]; changed('textures'); return true; }
    if (typeof spec === 'string') spec = { src: spec };
    var tx = { src: String(spec.src), tiles: +spec.tiles > 0 ? +spec.tiles : 1, alpha: spec.alpha == null ? 1 : clamp(+spec.alpha, 0, 1), img: null, error: null };
    TEX[name] = tx;
    loadImage(tx.src, function (im) {
      if (TEX[name] !== tx) return;
      if (im.err) { tx.error = im.err; warn('texture ' + name + ': ' + im.err); } else tx.img = im.img;
      changed('textures');
    });
    return true;
  }
  // -> { img, tiles, alpha } once loaded, else null
  function texture(name) {
    var tx = TEX[name];
    return tx && tx.img ? tx : null;
  }
  // -> { src, tiles, alpha, loaded, error } for any texture the manifest set, else null
  function textureInfo(name) {
    var tx = TEX[name];
    return tx ? { src: tx.src, tiles: tx.tiles, alpha: tx.alpha, loaded: !!tx.img, error: tx.error } : null;
  }

  // ------------------------------------------------------------------ manifests

  var want = null;       // manifest file asked for (?art=name or loadManifest)
  var current = null;    // { file, note }

  function clearArt() {
    ORDER.forEach(function (n) { REG[n].ov = null; });
    TEX = {};
  }
  function hasArt() {
    var o = Theme.overrides();
    return Object.keys(TEX).length > 0 || Object.keys(o.light).length > 0 || Object.keys(o.dark).length > 0 ||
      ORDER.some(function (n) { return REG[n].ov !== null; });
  }

  /*
   * manifest({ note, theme, sprites, textures }) — what art/art.js calls (as WBArt).
   * Replaces whatever art was set before. See GRAPHICS.md for the format.
   */
  function manifest(m) {
    var cs = doc && doc.currentScript;
    var file = cs && cs.getAttribute('src');
    if (want && file && file !== want) return false; // another manifest was asked for
    m = m || {};
    var had = hasArt();
    clearArt();
    Theme.reset(true);
    current = { file: file || '(inline)', note: m.note ? String(m.note) : '', theme: m.theme || null };
    if (m.theme) Theme.set(m.theme, true);
    if (m.sprites) Object.keys(m.sprites).forEach(function (n) { override(n, m.sprites[n]); });
    if (m.textures) Object.keys(m.textures).forEach(function (n) { setTexture(n, m.textures[n]); });
    // an empty manifest over no art changes nothing: no repaint
    if (had || hasArt()) changed('manifest');
    return true;
  }

  // Loads art/<name>/art.js (or art/art.js without a name) instead of the
  // current manifest. The game does this for ?art=<name>.
  function loadManifest(name) {
    if (!doc) return false;
    if (name && !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) { warn('bad manifest name "' + name + '"'); return false; }
    want = name ? 'art/' + name + '/art.js' : 'art/art.js';
    var el = doc.createElement('script');
    el.src = want;
    el.onerror = function () { warn('could not load ' + el.src); changed('manifest'); };
    (doc.head || doc.documentElement).appendChild(el);
    return true;
  }
  if (root && root.location) {
    var q = /[?&]art=([^&#]*)/.exec(root.location.search || '');
    if (q) loadManifest(decodeURIComponent(q[1]));
  }

  // ------------------------------------------------------------------ changes

  var pendingWhy = null;
  function changed(why) {
    if (pendingWhy) return;
    pendingWhy = why;
    var fire = function () {
      var w = pendingWhy; pendingWhy = null;
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](w); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
      }
    };
    if (typeof setTimeout === 'function') setTimeout(fire, 0); else fire();
  }
  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }

  function status() {
    return ORDER.map(function (n) {
      var s = REG[n], ov = s.ov;
      return {
        name: n, group: s.group,
        art: !ov ? 'built-in' : ov.kind,
        state: !ov ? 'ready' : ov.error ? 'error' : ov.ready ? 'ready' : 'loading',
        error: ov && ov.error, files: ov ? ov.files.slice() : []
      };
    });
  }

  // ------------------------------------------------------------------ built-in sprites

  function st(list) { return function () { return list; }; }
  var K_FIXED = ['fixed'];
  var QUARTER = Math.PI / 2;
  var DIRS = ['N', 'E', 'S', 'W'];

  define('piece.base', {
    group: 'tool', draw: pieceBase,
    note: 'the plinth under every floor tool; a house-owned one is part of the floor',
    states: ['fixed'], state: function (o) { return o.fixed ? K_FIXED : NONE; },
    samples: [{ label: 'placed', o: {} }, { label: 'house', o: { fixed: true } }]
  });

  var WIN_KEYS = { inlet: ['inlet'], outlet: ['outlet'], inletF: ['inlet-fixed', 'inlet', 'fixed'], outletF: ['outlet-fixed', 'outlet', 'fixed'] };
  define('tool.window', {
    group: 'tool', draw: glyphWindow,
    note: 'o.role: inlet (faces the wind) or outlet; o.outward: the side the garden is on. Art faces north (garden at the top).',
    states: ['inlet', 'outlet', 'inlet-fixed', 'outlet-fixed', 'fixed'],
    state: function (o) { return WIN_KEYS[(o.role === 'inlet' ? 'inlet' : 'outlet') + (o.fixed ? 'F' : '')]; },
    turn: function (o) { return (o.outward < 0 ? 0 : o.outward || 0) * QUARTER; },
    samples: [
      { label: 'inlet', o: { role: 'inlet', outward: 0 } }, { label: 'outlet', o: { role: 'outlet', outward: 0 } },
      { label: 'inlet, house', o: { role: 'inlet', outward: 3, fixed: true } }, { label: 'outlet, house', o: { role: 'outlet', outward: 1, fixed: true } }
    ]
  });

  define('tool.fan', {
    group: 'tool', draw: glyphFan,
    note: 'o.d: the way it blows (0 N, 1 E, 2 S, 3 W); o.angle: blade spin. Art blows north.',
    states: ['fixed'], state: function (o) { return o.fixed ? K_FIXED : NONE; },
    turn: function (o) { return (o.d | 0) * QUARTER; },
    samples: [0, 1, 2, 3].map(function (d) { return { label: DIRS[d], o: { d: d, angle: 0.4 } }; })
      .concat([{ label: 'house', o: { d: 1, angle: 0.4, fixed: true } }])
  });

  define('tool.deflector', {
    group: 'tool', draw: glyphDeflector,
    note: 'o.d: 0 = "/", 1 = "\\". Art is drawn as "/".',
    turn: function (o) { return (o.d | 0) === 1 ? QUARTER : 0; },
    samples: [{ label: '/', o: { d: 0 } }, { label: '\\', o: { d: 1 } }]
  });

  define('tool.curtain', {
    group: 'tool', draw: glyphCurtain,
    note: 'o.sway: how far the hem swings (about -0.2..0.2).',
    samples: [{ label: 'still', o: { sway: 0 } }, { label: 'in a breeze', o: { sway: 0.12 } }]
  });

  define('tool.vent', {
    group: 'tool', draw: glyphVent,
    note: 'o.horiz: air passes left-right (false: up-down). Art lets air pass left-right.',
    states: ['fixed'], state: function (o) { return o.fixed ? K_FIXED : NONE; },
    turn: function (o) { return o.horiz === false ? QUARTER : 0; },
    samples: [{ label: 'left-right', o: { horiz: true } }, { label: 'up-down', o: { horiz: false } }, { label: 'house', o: { horiz: true, fixed: true } }]
  });

  define('tool.splitter', {
    group: 'tool', draw: glyphSplitter,
    note: 'o.inDir: the way the incoming air travels (null: no air). Art: air travelling north, in at the bottom.',
    turn: function (o) { return (o.inDir == null ? 0 : o.inDir) * QUARTER; },
    samples: [{ label: 'air going N', o: { inDir: 0 } }, { label: 'air going E', o: { inDir: 1 } }]
  });

  define('tool.extractor', {
    group: 'tool', draw: glyphExtractor,
    note: 'o.angle: rotor spin; o.outward: the garden side. Art faces north.',
    states: ['fixed'], state: function (o) { return o.fixed ? K_FIXED : NONE; },
    turn: function (o) { return (o.outward < 0 ? 0 : o.outward || 0) * QUARTER; },
    samples: [{ label: 'placed', o: { angle: 0.3, outward: 0 } }, { label: 'house', o: { angle: 0.3, outward: 1, fixed: true } }]
  });

  define('tool.skylight', { group: 'tool', draw: glyphSkylight, note: 'a roof window seen from below' });
  define('tool.filter', { group: 'tool', draw: glyphFilter, note: 'air filter' });

  define('tool.ceilingfan', {
    group: 'tool', draw: glyphCeilingFan,
    note: 'o.angle: paddle spin.',
    states: ['fixed'], state: function (o) { return o.fixed ? K_FIXED : NONE; },
    samples: [{ label: 'placed', o: { angle: 0.4 } }, { label: 'house', o: { angle: 0.4, fixed: true } }]
  });

  // Objects get their animation state: flow (air reaching them), and eased
  // 0..1 values: lit, dry, soot, scatter, flutter, bend, sway; angle (spin);
  // dirx/diry (unit vector of the air); small (simpler shapes on small tiles).
  var OBJ_BASE = { angle: 0.5, flow: 0, lit: 1, dry: 0, soot: 0, scatter: 0, flutter: 0, bend: 0, sway: 0, dirx: 0, diry: 0, small: false };
  function pose(over) { return Object.assign({}, OBJ_BASE, over); }
  // state name -> [state name], so state() never allocates
  function keyed(names) { var m = {}; names.forEach(function (n) { m[n] = [n]; }); return m; }

  var PIN = keyed(['still', 'spinning']);
  define('object.pinwheel', {
    group: 'object', draw: objPinwheel, note: 'wants any breeze. o.angle: spin.',
    states: ['still', 'spinning'], state: function (o) { return o.flow > 0 ? PIN.spinning : PIN.still; },
    samples: [{ label: 'still', o: pose({}) }, { label: 'spinning', o: pose({ flow: 1, angle: 1.2 }) }]
  });

  var CAN = keyed(['lit', 'out']);
  define('object.candle', {
    group: 'object', draw: objCandle, note: 'wants no air. o.lit: 1 burning .. 0 blown out.',
    states: ['lit', 'out'], state: function (o) { return (o.lit == null ? 1 : o.lit) >= 0.5 ? CAN.lit : CAN.out; },
    samples: [{ label: 'lit', o: pose({}) }, { label: 'blown out', o: pose({ flow: 1, lit: 0, dirx: 1 }) }]
  });

  var LAU = keyed(['damp', 'dry', 'dirty']);
  define('object.laundry', {
    group: 'object', draw: objLaundry, note: 'wants a clean breeze of 2+. o.dry, o.soot (smoky air), o.flow swings it.',
    states: ['damp', 'dry', 'dirty'], state: function (o) { return o.soot >= 0.5 ? LAU.dirty : o.dry >= 0.5 ? LAU.dry : LAU.damp; },
    samples: [
      { label: 'damp', o: pose({}) }, { label: 'drying', o: pose({ flow: 2, dry: 1, dirx: 1 }) },
      { label: 'sooty', o: pose({ flow: 2, dry: 1, soot: 1, dirx: 1 }) }
    ]
  });

  var PAP = keyed(['calm', 'flutter', 'scattered']);
  define('object.papers', {
    group: 'object', draw: objPapers, note: 'want a breeze of 1 at most. o.flutter, o.scatter (blown away).',
    states: ['calm', 'flutter', 'scattered'], state: function (o) { return o.scatter >= 0.5 ? PAP.scattered : o.flutter >= 0.5 ? PAP.flutter : PAP.calm; },
    samples: [
      { label: 'calm', o: pose({}) }, { label: 'fluttering', o: pose({ flow: 1, flutter: 1 }) },
      { label: 'blown away', o: pose({ flow: 2, flutter: 1, scatter: 1, dirx: 1 }), t: 0.9 }
    ]
  });

  var FERN = keyed(['still', 'swaying', 'battered']);
  define('object.fern', {
    group: 'object', draw: objFern, note: 'wants a breeze of exactly 1. o.sway, o.bend (battered).',
    states: ['still', 'swaying', 'battered'], state: function (o) { return o.bend >= 0.5 ? FERN.battered : o.sway >= 0.5 ? FERN.swaying : FERN.still; },
    samples: [
      { label: 'still', o: pose({}) }, { label: 'swaying', o: pose({ flow: 1, sway: 1 }) },
      { label: 'battered', o: pose({ flow: 2, sway: 1, bend: 1, dirx: 1 }) }
    ]
  });

  var STO = keyed(['clear', 'smoky']);
  define('object.stove', {
    group: 'object', draw: objStove,
    note: 'its smoke must be blown outside. The rising smoke is drawn by the board, not the sprite.',
    states: ['clear', 'smoky'], state: function (o) { return o.state === 'happy' ? STO.clear : STO.smoky; },
    samples: [{ label: 'cooking', o: pose({ state: 'idle' }) }]
  });

  TOOL_IDS.forEach(function (id) {
    define('icon.' + id, {
      group: 'icon', draw: function (ctx) { toolIcon(ctx, id); },
      note: id === 'window' ? 'tray and help icon (a front view of its own)' : 'tray and help icon (drawn from tool.' + id + ')'
    });
  });

  var PIP_KEYS = keyed(['happy', 'bad', 'dirty', 'idle']);
  define('ui.pip', {
    group: 'ui', draw: function (ctx, o) { pipShape(ctx, o.state, o.r || 6); },
    note: 'status pip on each object, in CSS px; o.r: radius. Image box is in radii.',
    states: ['happy', 'bad', 'dirty', 'idle'], state: function (o) { return PIP_KEYS[o.state] || PIP_KEYS.idle; },
    unit: function (o) { return o.r || 6; }, box: [-1.3, -1.3, 2.6, 2.6],
    samples: ['happy', 'bad', 'dirty', 'idle'].map(function (s) { return { label: s, o: { state: s } }; })
  });

  var STALL_KEYS = keyed(['stalled', 'quiet']);
  define('ui.stall', {
    group: 'ui', draw: function (ctx, o) { stallMarker(ctx, o.x || 0, o.y || 0, o.r || 6, o.quiet ? P('pip-idle') : null); },
    note: '"no way out" mark where a stalled stream meets a wall, in CSS px; quiet once the level is solved.',
    states: ['stalled', 'quiet'], state: function (o) { return o.quiet ? STALL_KEYS.quiet : STALL_KEYS.stalled; },
    unit: function (o) { return o.r || 6; }, box: [-1, -1, 2, 2], at: true,
    samples: [{ label: 'stalled', o: {} }, { label: 'solved', o: { quiet: true } }]
  });

  var KIT = {
    TAU: TAU, DX: DX, DY: DY, P: P, color: P, mix: mix, alpha: alpha, darker: darker, lighter: lighter,
    clamp: clamp, rr: rr, fillRR: fillRR, circle: circle, line: line, chevron: chevron, minW: minW,
    draw: draw, drawBuiltin: drawBuiltin
  };

  return {
    kit: KIT,
    define: define,
    draw: draw,
    drawBuiltin: drawBuiltin,
    has: function (name) { return !!REG[name]; },
    get: function (name) { return REG[name] || null; },
    list: function (group) { return ORDER.filter(function (n) { return !group || REG[n].group === group; }); },
    override: override,
    texture: texture,
    textureInfo: textureInfo,
    setTexture: setTexture,
    textureNames: TEXTURE_NAMES.slice(),
    manifest: manifest,
    loadManifest: loadManifest,
    current: function () { return current; },
    // true once the manifest asked for has run and its images have loaded (or failed)
    ready: function () { return loading === 0 && (!want || !!current && current.file === want); },
    status: status,
    onChange: onChange
  };
});
