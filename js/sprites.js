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

  // The wind's own mark: soft chevrons pointing the way it blows, the same
  // mark as on a window that lets the wind in. kind 'cue': in the garden along
  // the windy side; 'in': on a window spot that would let the wind in (while a
  // window is picked up); 'out': a small arrow on a spot that would let air
  // out. Unit space (1 = a tile), o.d: the direction (0 N, 1 E, 2 S, 3 W).
  function windMark(ctx, o) {
    var d = o.d | 0, kind = o.kind || 'cue';
    var ux = DX[d], uy = DY[d];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (kind === 'out') {
      line(ctx, -ux * 0.11, -uy * 0.11, ux * 0.1, uy * 0.1);
      chevron(ctx, ux * 0.08, uy * 0.08, d, 0.08);
      ctx.strokeStyle = alpha(P('air-deep'), 0.55);
      ctx.lineWidth = minW(o, 0.045, 1.2);
    } else {
      var k = kind === 'in' ? 1.15 : 1;
      chevron(ctx, -ux * 0.1 * k, -uy * 0.1 * k, d, 0.12 * k);
      chevron(ctx, ux * 0.1 * k, uy * 0.1 * k, d, 0.12 * k);
      ctx.strokeStyle = kind === 'in' ? P('air-deep') : alpha(P('air-deep'), 0.7);
      ctx.lineWidth = minW(o, kind === 'in' ? 0.075 : 0.06, 1.6);
    }
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
  var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  /*
   * define(name, spec) registers (or replaces) a built-in sprite.
   *   draw(ctx, o, t)   the built-in drawing; t = seconds, for idle motion
   *   group             'tool' | 'object' | 'icon' | 'ui'
   *   note              one line for the studio and GRAPHICS.md
   *   states            state names an image override may give (see state)
   *   stateNotes        { state: 'what it means' } for the studio
   *   state(o)          -> state names that apply to o, most specific first
   *   blend(o)          -> { a: states, b: states, k: 0..1 }: how far o is from a
   *                     to b, for images with fade: true (optional)
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
  // An override that throws (a mistake in a draw function) is switched off,
  // reported, and the built-in art is drawn instead, this frame and after.
  function draw(name, ctx, o, t) {
    var s = REG[name];
    if (!s) return false;
    var ov = s.ov;
    o = o || {}; t = t || 0;
    if (ov !== null && ov.ready) {
      ctx.save();
      try {
        drawOverride(s, ov, ctx, o, t);
      } catch (e) {
        ctx.restore();
        ctx.save();
        failed(s, ov, e);
        s.draw(ctx, o, t);
      } finally {
        ctx.restore();
      }
    } else s.draw(ctx, o, t);
    return true;
  }
  function drawBuiltin(name, ctx, o, t) {
    var s = REG[name];
    if (!s) return false;
    s.draw(ctx, o || {}, t || 0);
    return true;
  }
  function failed(s, ov, e) {
    ov.ready = false;
    ov.error = (ov.kind === 'code' ? 'its draw function failed: ' : 'drawing failed: ') + (e && e.message ? e.message : String(e));
    var where = lineOf(e);
    report('error', s.name + ': ' + ov.error + (where ? ' (' + where + ')' : '') + ', so the built-in art is shown', {
      sprite: s.name,
      hint: ov.kind === 'code' ? 'Fix that line of the draw function in your art.js and reload. A word like a colour or a name usually needs quotes; api.kit.P(\'token\') gives a theme colour.' : null
    });
    changed('sprites');
  }
  // "art/x/art.js line 12" from an error's stack, if the mistake is in a manifest
  function lineOf(e) {
    var m = e && e.stack && /(art\/(?:[\w-]+\/)?art\.js)(?:\?[^:]*)?:(\d+)/.exec(String(e.stack));
    return m ? m[1] + ' line ' + m[2] : '';
  }

  // ------------------------------------------------------------------ images

  var IMG = {};          // src -> { src, img, w, h, ok, err }
  var RASTER = {}, rasterN = 0;
  var loading = 0;       // images on their way

  function loadImage(src, done) {
    var im = IMG[src];
    if (im) {
      if (im.ok || im.err) done(im); else im.waiters.push(done);
      return im;
    }
    im = IMG[src] = { src: src, img: null, w: 0, h: 0, ok: false, err: null, waiters: [done] };
    loading++;
    function settle() {
      loading--;
      var w = im.waiters; im.waiters = [];
      w.forEach(function (f) { f(im); });
    }
    if (!root || !root.Image) { im.err = 'could not load ' + src + ' (images need a browser)'; settle(); return im; }
    var img = new root.Image();
    img.onload = function () {
      if (!(img.naturalWidth > 0)) im.err = src + ' has no size (give the SVG width, height and viewBox)';
      else { im.ok = true; im.img = img; im.w = img.naturalWidth; im.h = img.naturalHeight; checkSvgSize(src); }
      settle();
    };
    img.onerror = function () { im.err = 'could not load ' + src; settle(); };
    img.src = src;
    return im;
  }
  // An SVG without width and height draws in Chrome but may not in Firefox
  // or Safari. Only checkable over http(s) (a file:// page cannot read files).
  function checkSvgSize(src) {
    if (!/\.svg(?:[?#]|$)/i.test(src) || !root.fetch || !root.location || !/^https?:$/.test(root.location.protocol)) return;
    root.fetch(src).then(function (r) { return r.ok ? r.text() : ''; }).then(function (text) {
      var tag = /<svg\b[^>]*>/i.exec(text || '');
      if (!tag) return;
      var w = /\swidth\s*=\s*["']\s*([\d.]+)\s*(px)?\s*["']/i.test(tag[0]), h = /\sheight\s*=\s*["']\s*([\d.]+)\s*(px)?\s*["']/i.test(tag[0]);
      if (w && h) return;
      report('warn', src + ' has no width and height in pixels on its <svg> tag: Firefox and Safari may not draw it', {
        file: src, hint: 'Add width="100" height="100" (plain numbers, the same as its viewBox) to the <svg ...> line.'
      });
      changed('sprites');
    }).catch(function () { /* nothing to say */ });
  }
  // a fake loaded image (unit tests in Node; nothing else should need it)
  function fakeImage(src, w, h) {
    IMG[src] = { src: src, img: { src: src, naturalWidth: w || 100, naturalHeight: h || 100, fake: true }, w: w || 100, h: h || 100, ok: true, err: null, waiters: [] };
  }

  // Draws a loaded image into the box, through a bitmap cached at the size it
  // lands on screen (so an SVG is rasterised once, not every frame).
  function blit(ctx, im, x, y, w, h) {
    if (!doc || im.img.fake) { ctx.drawImage(im.img, x, y, w, h); return; }
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

  var report = Theme.report;
  function warn(msg, more) { report('warn', msg, more); }
  var PATH_HINT = 'Check the file name, its folder and its capitals (Candle.svg is not candle.svg). ' +
    'A path that starts with art/ starts from the game folder; any other path is next to the art.js it is in.';

  // Paths in a manifest: 'art/...', '/...', './...', '../...' and URLs are
  // relative to the page; any other path is relative to the manifest's own
  // folder (so art/autumn/art.js can just say 'candle.svg').
  var base = '';
  function path(p) {
    p = String(p).trim();
    if (!base || /^(art\/|\/|\.\.?\/|[a-z][a-z0-9+.-]*:)/i.test(p)) return p;
    return base + p;
  }
  function folder(file) { var i = file.lastIndexOf('/'); return i >= 0 ? file.slice(0, i + 1) : ''; }

  // A file in a manifest: 'file.svg' or { src: 'file.svg', dark: 'file-dark.svg' } -> { src, dark }
  function fileRef(v, where) {
    if (v == null || v === false) return null;
    if (typeof v === 'string') { if (!v.trim()) throw new Error(where + ' is an empty file name'); return { src: path(v), dark: null }; }
    if (typeof v === 'object' && typeof v.src === 'string' && v.src.trim()) {
      return { src: path(v.src), dark: typeof v.dark === 'string' && v.dark.trim() ? path(v.dark) : null };
    }
    throw new Error(where + ' must be a file name in quotes, such as \'art/candle.svg\' (or { src: \'...\', dark: \'...\' })');
  }

  // For one set of state names: the layer's file, null (hidden on purpose) or
  // undefined (nothing: no src and no image for these states).
  function pickRef(layer, keys) {
    if (layer.states) {
      for (var i = 0; i < keys.length; i++) {
        if (hasOwn(layer.states, keys[i])) return layer.states[keys[i]];
      }
    }
    return layer.src || undefined;
  }

  function drawOverride(s, ov, ctx, o, t) {
    if (ov.draw) { ov.draw(ctx, o, t, ov.api); return; }
    if (ov.base) s.draw(ctx, o, t);
    var dark = ov.dark && Theme.drawMode() === 'dark';
    var fade = ov.fade && s.blend && !o.icon ? s.blend(o) : null;
    if (fade && fade.k > 0 && fade.k < 1) {
      // crossfade without a see-through middle: b fades in over a, then a fades out
      var ga = ctx.globalAlpha, k = fade.k;
      ctx.globalAlpha = ga * (k < 0.5 ? 1 : (1 - k) * 2);
      layersFor(s, ov, ctx, o, t, fade.a, dark);
      ctx.globalAlpha = ga * (k < 0.5 ? k * 2 : 1);
      layersFor(s, ov, ctx, o, t, fade.b, dark);
      ctx.globalAlpha = ga;
      return;
    }
    layersFor(s, ov, ctx, o, t, s.state ? s.state(o) : NONE, dark);
  }

  // Draws the layers for one set of state names. When no layer has anything
  // to show for them (no src, no image for the state, or its file did not
  // load) the built-in art is drawn, so a state you did not draw keeps it.
  function layersFor(s, ov, ctx, o, t, keys, dark) {
    var u = s.unit ? s.unit(o) : 1;
    var turn = ov.rotate && s.turn ? s.turn(o) : 0;
    var shown = false;
    ctx.save();
    if (s.at) ctx.translate(o.x || 0, o.y || 0);
    if (u !== 1) ctx.scale(u, u);
    if (turn) ctx.rotate(turn);
    for (var i = 0; i < ov.layers.length; i++) {
      var L = ov.layers[i];
      var ref = pickRef(L, keys);
      if (ref === null) { shown = true; continue; }
      if (ref === undefined) continue;
      var im = IMG[dark && ref.dark ? ref.dark : ref.src];
      if (dark && ref.dark && !(im && im.ok)) im = IMG[ref.src];
      if (!im || !im.ok) continue;
      shown = true;
      var b = L.box || ov.box || s.box;
      if (L.spin) {
        var a = L.spin === 1 ? o.angle || 0 : (o.angle || 0) * L.spin;
        ctx.save();
        if (L.pivot) {
          // the pivot is a point of the drawing, in the image's own pixels
          var px = b[0] + L.pivot[0] / im.w * b[2], py = b[1] + L.pivot[1] / im.h * b[3];
          ctx.translate(px, py);
          ctx.rotate(a);
          blit(ctx, im, b[0] - px, b[1] - py, b[2], b[3]);
        } else {
          ctx.translate(b[0] + b[2] / 2, b[1] + b[3] / 2);
          ctx.rotate(a);
          blit(ctx, im, -b[2] / 2, -b[3] / 2, b[2], b[3]);
        }
        ctx.restore();
      } else {
        blit(ctx, im, b[0], b[1], b[2], b[3]);
      }
    }
    ctx.restore();
    if (!shown && !ov.base) s.draw(ctx, o, t);
  }

  function isBox(b) { return Array.isArray(b) && b.length === 4 && b.every(function (v) { return typeof v === 'number' && isFinite(v); }); }
  function isPair(b) { return Array.isArray(b) && b.length === 2 && b.every(function (v) { return typeof v === 'number' && isFinite(v); }); }
  function spinOf(v, where) {
    if (v == null || v === false) return 0;
    if (v === true) return 1;
    if (typeof v === 'number' && isFinite(v)) return v;
    throw new Error(where + 'spin must be true or a number (a speed: 0.5 is half as fast, -1 turns the other way)');
  }
  var SPEC_KEYS = ['src', 'dark', 'states', 'layers', 'box', 'rotate', 'base', 'spin', 'pivot', 'fade', 'draw', 'images'];
  var LAYER_KEYS = ['src', 'dark', 'states', 'box', 'spin', 'pivot'];
  function unknownKeys(name, obj, allowed, where) {
    Object.keys(obj).forEach(function (k) {
      if (allowed.indexOf(k) >= 0) return;
      var g = Theme.suggest(k, allowed);
      warn(name + ': ' + where + '"' + k + '" is not an option, so it is ignored' + (g ? ' (did you mean "' + g + '"?)' : ''), {
        sprite: name, hint: 'The options are: ' + allowed.join(', ') + ' (see GRAPHICS.md).'
      });
    });
  }
  // a sample label used as a state name ('blown out' for 'out')
  function stateOfLabel(spec, k) {
    var low = String(k).toLowerCase();
    for (var i = 0; i < spec.samples.length; i++) {
      var sm = spec.samples[i];
      if (sm.label && sm.label.toLowerCase() === low && spec.state) {
        var keys = spec.state(sm.o);
        if (keys.length) return keys[0];
      }
    }
    return null;
  }
  function unknownState(name, k) {
    var spec = REG[name];
    var g = stateOfLabel(spec, k) || Theme.suggest(k, spec.states);
    warn(name + ': unknown state "' + k + '"' + (g ? ' (did you mean "' + g + '"?)' : '') + ', so its image is never used', {
      sprite: name, hint: spec.states.length ? 'The states of ' + name + ' are: ' + spec.states.join(', ') + '.' : name + ' has no states: give it just a src.'
    });
  }

  // A manifest entry -> { layers, rotate, base, box, fade, dark, draw, files, ready, error }
  function normalize(name, spec) {
    var S = REG[name];
    if (typeof spec === 'string') spec = { src: spec };
    if (typeof spec === 'function') spec = { draw: spec };
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('expected a file name, { ... } or a draw function');
    unknownKeys(name, spec, SPEC_KEYS, '');
    var ov = {
      name: name, layers: [], rotate: spec.rotate !== false, base: !!spec.base, box: null, draw: null,
      fade: !!spec.fade, dark: false, files: [], failed: [], ready: false, partial: false, error: null, kind: 'image'
    };
    if (spec.box != null) { if (!isBox(spec.box)) throw new Error('box must be [x, y, w, h], four numbers'); ov.box = spec.box; }
    if (typeof spec.draw === 'function') {
      ov.kind = 'code';
      ov.draw = spec.draw;
      var where = {}; // the names the draw function uses -> the files (next to an art set's art.js)
      ov.api = {
        name: name, kit: KIT,
        base: S.draw,
        image: function (ctx, src, x, y, w, h) {
          var im = IMG[where[src] || src];
          if (im && im.ok) { blit(ctx, im, x, y, w, h); return true; }
          return false;
        }
      };
      if (spec.images != null && !Array.isArray(spec.images)) throw new Error('images must be a list of file names');
      (spec.images || []).forEach(function (f) { var r = path(f); where[f] = r; ov.files.push(r); });
      return ov;
    }
    if (spec.draw != null) throw new Error('draw must be a function (ctx, o, t, api) { ... }');
    var single = !spec.layers;
    var layers = spec.layers || [{ src: spec.src, dark: spec.dark, states: spec.states, spin: spec.spin, pivot: spec.pivot }];
    if (!Array.isArray(layers) || !layers.length) throw new Error('layers must be a list: [{ src: ... }, { src: ... }]');
    layers.forEach(function (l, i) {
      var where = single ? '' : 'layer ' + (i + 1) + ': ';
      if (typeof l === 'string') l = { src: l };
      if (!l || typeof l !== 'object') throw new Error(where + 'expected { src: ... }');
      if (!single) unknownKeys(name, l, LAYER_KEYS, where);
      var L = { src: fileRef(l.src, where + 'src'), states: null, box: null, spin: spinOf(l.spin, where), pivot: null };
      if (L.src && typeof l.dark === 'string' && l.dark.trim()) L.src.dark = path(l.dark);
      if (l.box != null) { if (!isBox(l.box)) throw new Error(where + 'box must be [x, y, w, h], four numbers'); L.box = l.box; }
      if (l.pivot != null) {
        if (!isPair(l.pivot)) throw new Error(where + 'pivot must be [x, y]: a point of the drawing, in its own pixels');
        L.pivot = l.pivot;
        if (l.spin == null) L.spin = 1;
      }
      if (l.states) {
        if (typeof l.states !== 'object' || Array.isArray(l.states)) throw new Error(where + 'states must map state names to files: { out: \'art/candle-out.svg\' }');
        L.states = {};
        Object.keys(l.states).forEach(function (k) {
          if (S.states.indexOf(k) < 0) unknownState(name, k);
          L.states[k] = fileRef(l.states[k], where + 'states.' + k);
        });
      }
      if (!L.src && !L.states) throw new Error(where + 'has no src (the file to draw)');
      [L.src].concat(L.states ? Object.keys(L.states).map(function (k) { return L.states[k]; }) : []).forEach(function (r) {
        if (!r) return;
        ov.files.push(r.src);
        if (r.dark) { ov.files.push(r.dark); ov.dark = true; }
      });
      ov.layers.push(L);
    });
    if (ov.fade && !S.blend) report('note', name + ': fade does nothing here (its states switch at once, there is nothing in between)', { sprite: name });
    // poses no layer has an image for keep the built-in art: say which
    if (!ov.base && S.state) {
      var bare = [];
      S.samples.forEach(function (sm) {
        var keys = S.state(sm.o);
        if (ov.layers.some(function (L) { return pickRef(L, keys) !== undefined; })) return;
        var label = keys.length ? keys[0] : sm.label || 'the default look';
        if (bare.indexOf(label) < 0) bare.push(label);
      });
      if (bare.length) {
        report('note', name + ': no src, so ' + bare.join(', ') + (bare.length === 1 ? ' keeps' : ' keep') + ' the built-in art', {
          sprite: name, hint: 'That is fine if you meant it. To replace those too, add src: \'...\' (used for every state without its own image) or list them under states.'
        });
      }
    }
    return ov;
  }

  function loadFiles(ov, onDone) {
    var files = ov.files.filter(function (f, i, a) { return a.indexOf(f) === i; });
    var left = files.length;
    ov.nFiles = left;
    if (!left) { onDone(); return; }
    files.forEach(function (f) {
      loadImage(f, function (im) {
        if (im.err) ov.failed.push(im.err);
        if (--left === 0) onDone();
      });
    });
  }

  // override(name, spec | null): replace a sprite's art (null restores the built-in).
  function override(name, spec) {
    var s = REG[name];
    if (!s) {
      var g = REG['tool.' + name] ? 'tool.' + name : REG['object.' + name] ? 'object.' + name : Theme.suggest(name, ORDER);
      warn('there is no sprite "' + name + '"' + (g ? ' (did you mean "' + g + '"?)' : ''), {
        hint: 'Sprite names look like tool.fan, object.candle or ui.pip: the studio lists them all (see GRAPHICS.md).'
      });
      return false;
    }
    if (spec == null) { s.ov = null; changed('sprites'); return true; }
    var ov;
    try { ov = normalize(name, spec); } catch (e) {
      warn(name + ': ' + e.message + ', so it keeps the built-in art', { sprite: name });
      return false;
    }
    s.ov = ov;
    loadFiles(ov, function () {
      if (s.ov !== ov) return;
      var bad = ov.failed.length;
      if (!bad) ov.ready = true;
      else if (bad === ov.nFiles || ov.kind === 'code') {
        ov.error = ov.failed.join('; ');
        report('error', name + ': ' + ov.error + ', so the built-in art is shown', { sprite: name, hint: PATH_HINT });
      } else {
        ov.ready = true;
        ov.partial = true;
        ov.error = bad + ' of ' + ov.nFiles + ' files missing: ' + ov.failed.join('; ');
        report('warn', name + ': ' + ov.error + ' (the rest is shown; where nothing is left to draw, the built-in art)', { sprite: name, hint: PATH_HINT });
      }
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
    if (TEXTURE_NAMES.indexOf(name) < 0) {
      var g = Theme.suggest(name, TEXTURE_NAMES);
      warn('there is no texture "' + name + '"' + (g ? ' (did you mean "' + g + '"?)' : ''), { hint: 'Textures can go over: ' + TEXTURE_NAMES.join(', ') + '.' });
      return false;
    }
    if (spec == null) { delete TEX[name]; changed('textures'); return true; }
    if (typeof spec === 'string') spec = { src: spec };
    if (typeof spec !== 'object' || typeof spec.src !== 'string' || !spec.src.trim()) {
      warn('texture ' + name + ': expected { src: \'art/floor.svg\', tiles: 2, alpha: 0.6 }');
      return false;
    }
    unknownKeys('texture ' + name, spec, ['src', 'tiles', 'alpha'], '');
    var tx = { src: path(spec.src), tiles: +spec.tiles > 0 ? +spec.tiles : 1, alpha: spec.alpha == null ? 1 : clamp(+spec.alpha, 0, 1), img: null, error: null };
    TEX[name] = tx;
    loadImage(tx.src, function (im) {
      if (TEX[name] !== tx) return;
      if (im.err) { tx.error = im.err; report('error', 'texture ' + name + ': ' + im.err + ', so there is none', { hint: PATH_HINT }); } else tx.img = im.img;
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
  var current = null;    // { file, note, theme, tuning, raw }
  var ran = {};          // manifest files that called WBArt
  var SECTIONS = ['note', 'theme', 'tuning', 'sprites', 'textures'];

  function clearArt() {
    ORDER.forEach(function (n) { REG[n].ov = null; });
    TEX = {};
  }
  function hasArt() {
    var o = Theme.overrides();
    return Object.keys(TEX).length > 0 || Object.keys(o.light).length > 0 || Object.keys(o.dark).length > 0 ||
      Object.keys(Theme.tuningOverrides()).length > 0 || ORDER.some(function (n) { return REG[n].ov !== null; });
  }

  /*
   * manifest({ note, theme, tuning, sprites, textures }) — what art/art.js calls (as WBArt).
   * Replaces whatever art was set before. See GRAPHICS.md for the format.
   */
  function manifest(m) {
    var cs = doc && doc.currentScript;
    var file = cs && cs.getAttribute('src');
    if (want && file && file !== want) return false; // another manifest was asked for
    if (file) ran[file] = true;
    if (m == null || typeof m !== 'object' || Array.isArray(m)) {
      if (m != null) warn('WBArt needs { ... }: WBArt({ theme: { ... }, sprites: { ... } })');
      m = {};
    }
    var had = hasArt();
    clearArt();
    Theme.reset(true);
    Theme.clearProblems(function (p) { return p.scope === 'manifest' || (file && p.file === file); });
    current = { file: file || '(inline)', note: m.note ? String(m.note) : '', theme: m.theme || null, tuning: m.tuning || null, raw: m };
    Object.keys(m).forEach(function (k) {
      if (SECTIONS.indexOf(k) >= 0) return;
      var g = Theme.suggest(k, SECTIONS);
      warn('WBArt: there is no section "' + k + '", so it is ignored' + (g ? ' (did you mean "' + g + '"?)' : ''), { hint: 'The sections are: ' + SECTIONS.join(', ') + '.' });
    });
    base = file ? folder(file) : '';
    try {
      if (m.theme) Theme.set(m.theme, true);
      if (m.tuning) Theme.setTuning(m.tuning, true);
      if (m.sprites) {
        if (typeof m.sprites !== 'object') warn('sprites must be { \'object.candle\': ..., \'tool.fan\': ... }');
        else Object.keys(m.sprites).forEach(function (n) { override(n, m.sprites[n]); });
      }
      if (m.textures) {
        if (typeof m.textures !== 'object') warn('textures must be { floor: { src: ... } }');
        else Object.keys(m.textures).forEach(function (n) { setTexture(n, m.textures[n]); });
      }
    } finally {
      base = '';
    }
    // an empty manifest over no art changes nothing: no repaint. One that was
    // asked for (?art=) or has problems is announced anyway (the studio lists them).
    if (had || hasArt() || want || Theme.problems().length) changed('manifest');
    return true;
  }

  // Loads art/<name>/art.js (or art/art.js without a name) instead of the
  // current manifest. The game does this for ?art=<name>.
  function loadManifest(name) {
    if (!doc) return false;
    if (name && !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
      report('error', 'bad art set name "' + name + '"', { scope: 'script', hint: '?art=<name> loads art/<name>/art.js; a name is letters, digits, - and _.' });
      return false;
    }
    want = name ? 'art/' + name + '/art.js' : 'art/art.js';
    var el = doc.createElement('script');
    el.src = want;
    el.onerror = function () {
      report('error', 'could not load ' + want + ', so the built-in art is shown', { scope: 'script', file: want, hint: '?art=' + name + ' loads art/' + name + '/art.js: check the folder name and that art.js is in it.' });
      changed('manifest');
    };
    (doc.head || doc.documentElement).appendChild(el);
    return true;
  }
  if (root && root.location) {
    var q = /[?&]art=([^&#]*)/.exec(root.location.search || '');
    if (q) loadManifest(decodeURIComponent(q[1]));
  }

  // A manifest with a typo never calls WBArt: say so (in the console, and in
  // the studio's "Art in use"), with the line and a likely cause.
  function manifestFile(url) {
    var m = /(art\/(?:[\w-]+\/)?art\.js)(?:[?#].*)?$/.exec(String(url || ''));
    return m ? m[1] : null;
  }
  function typoHint(msg) {
    if (/Unexpected end of input/i.test(msg)) return 'A bracket is not closed: every { needs a }, every [ a ], every ( a ). The file should end with });';
    if (/Invalid or unexpected token|Unterminated|unterminated/i.test(msg)) return 'A quote is not closed, or there is a curly quote from a word processor: use straight quotes \' or ".';
    if (/is not defined/i.test(msg)) return 'A word without quotes: file names, colours and sprite names need quotes, like \'art/fan.svg\' or \'#ff8800\'.';
    if (/Unexpected (identifier|string|number)|Unexpected token '\{'|missing \) after/i.test(msg)) return 'Usually a missing comma at the end of the line before (every entry but the last ends with a comma), or a missing quote.';
    if (/Unexpected token/i.test(msg)) return 'An extra or missing bracket or comma near there.';
    return 'Look at that line and the one before it.';
  }
  function staticManifest() {
    var els = doc && doc.querySelectorAll ? doc.querySelectorAll('script[src]') : [];
    for (var i = 0; i < els.length; i++) {
      var f = manifestFile(els[i].getAttribute('src'));
      if (f && f === els[i].getAttribute('src')) return f;
    }
    return null;
  }
  if (root && root.addEventListener && doc) {
    root.addEventListener('error', function (e) {
      if (e && e.target && e.target !== root && e.target.tagName === 'SCRIPT') {
        var sf = manifestFile(e.target.getAttribute('src'));
        if (sf && sf !== want) report('warn', 'could not load ' + sf + ', so the built-in art is shown', { scope: 'script', file: sf });
        return;
      }
      var f = manifestFile(e && e.filename);
      if (!f) return;
      var msg = String(e.message || 'error').replace(/^(Uncaught\s+)?([A-Z]\w*Error:\s*)?/, '');
      report('error', f + ' has a mistake on line ' + e.lineno + ': ' + msg, { scope: 'script', file: f, line: e.lineno, hint: typoHint(msg) });
      changed('manifest');
    }, true);
    root.addEventListener('load', function () {
      var f = want || staticManifest();
      if (!f || ran[f]) return;
      if (Theme.problems().some(function (p) { return p.file === f && p.scope === 'script'; })) return;
      report('error', f + ' was loaded but did not call WBArt({ ... }), so the built-in art is shown', {
        scope: 'script', file: f,
        hint: 'It probably has a mistake: check commas, quotes and brackets. The browser console (F12) shows the line' +
          (root.location && root.location.protocol === 'file:' ? ' (a page opened as a file cannot see it; through a web server, such as npm run serve, it is shown here too).' : '.')
      });
      changed('manifest');
    });
  }

  // ------------------------------------------------------------------ changes

  // Listeners get one call per burst of changes, with the biggest reason:
  // 'manifest' (everything may have changed) > 'sprites' > 'textures'.
  var pendingWhy = null, RANK = { textures: 1, sprites: 2, manifest: 3 };
  function changed(why) {
    if (pendingWhy) {
      if ((RANK[why] || 0) > (RANK[pendingWhy] || 0)) pendingWhy = why;
      return;
    }
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

  // state: 'ready' | 'loading' | 'partial' (some files missing, the rest shown)
  //      | 'error' (the built-in art is shown)
  function status() {
    return ORDER.map(function (n) {
      var s = REG[n], ov = s.ov;
      return {
        name: n, group: s.group,
        art: !ov ? 'built-in' : ov.kind,
        state: !ov ? 'ready' : ov.ready ? (ov.partial ? 'partial' : 'ready') : ov.error ? 'error' : 'loading',
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

  // Every object also has an 'icon' state: the goal strip and the help sheet
  // draw objects with o.icon set, so an image for 'icon' (else the happy
  // state) is what they show. The built-in icons are the poses below.
  // Image states switch at the halfway point of the eased value (o.lit >= 0.5
  // is 'lit'); with fade: true they crossfade (blend).
  function iconKeys(happy) { return ['icon', happy]; }
  function iconNote(happy) { return 'goal strip and help icon (without an image for it: ' + happy + ')'; }

  var PIN = keyed(['still', 'spinning']);
  PIN.icon = iconKeys('spinning');
  define('object.pinwheel', {
    group: 'object', draw: objPinwheel, note: 'wants any breeze. o.angle: spin.',
    states: ['still', 'spinning', 'icon'], state: function (o) { return o.icon ? PIN.icon : o.flow > 0 ? PIN.spinning : PIN.still; },
    stateNotes: { still: 'no air yet: waiting', spinning: 'any air: happy', icon: iconNote('spinning') },
    samples: [{ label: 'still', o: pose({}) }, { label: 'spinning', o: pose({ flow: 1, angle: 1.2 }) }]
  });

  var CAN = keyed(['lit', 'out']);
  CAN.icon = iconKeys('lit');
  define('object.candle', {
    group: 'object', draw: objCandle, note: 'wants no air. o.lit: 1 burning .. 0 blown out.',
    states: ['lit', 'out', 'icon'], state: function (o) { return o.icon ? CAN.icon : (o.lit == null ? 1 : o.lit) >= 0.5 ? CAN.lit : CAN.out; },
    blend: function (o) { return { a: CAN.out, b: CAN.lit, k: o.lit == null ? 1 : o.lit }; },
    stateNotes: { lit: 'no air: happy', out: 'blown out by air: unhappy', icon: iconNote('lit') },
    samples: [{ label: 'lit', o: pose({}) }, { label: 'blown out', o: pose({ flow: 1, lit: 0, dirx: 1 }) }]
  });

  var LAU = keyed(['damp', 'dry', 'dirty']);
  LAU.icon = iconKeys('dry');
  define('object.laundry', {
    group: 'object', draw: objLaundry, note: 'wants a clean breeze of 2+. o.dry, o.soot (smoky air), o.flow swings it.',
    states: ['damp', 'dry', 'dirty', 'icon'], state: function (o) { return o.icon ? LAU.icon : o.soot >= 0.5 ? LAU.dirty : o.dry >= 0.5 ? LAU.dry : LAU.damp; },
    blend: function (o) {
      if (o.soot > 0) return { a: o.dry >= 0.5 ? LAU.dry : LAU.damp, b: LAU.dirty, k: o.soot };
      return { a: LAU.damp, b: LAU.dry, k: o.dry || 0 };
    },
    stateNotes: { damp: 'too little air: waiting', dry: 'a clean breeze of 2+: happy', dirty: 'smoky air reached it: unhappy', icon: iconNote('dry') },
    samples: [
      { label: 'damp', o: pose({}) }, { label: 'drying', o: pose({ flow: 2, dry: 1, dirx: 1 }) },
      { label: 'sooty', o: pose({ flow: 2, dry: 1, soot: 1, dirx: 1 }) }
    ]
  });

  var PAP = keyed(['calm', 'flutter', 'scattered']);
  PAP.icon = iconKeys('calm');
  define('object.papers', {
    group: 'object', draw: objPapers, note: 'want a breeze of 1 at most. o.flutter, o.scatter (blown away).',
    states: ['calm', 'flutter', 'scattered', 'icon'], state: function (o) { return o.icon ? PAP.icon : o.scatter >= 0.5 ? PAP.scattered : o.flutter >= 0.5 ? PAP.flutter : PAP.calm; },
    blend: function (o) {
      if (o.scatter > 0) return { a: o.flutter >= 0.5 ? PAP.flutter : PAP.calm, b: PAP.scattered, k: o.scatter };
      return { a: PAP.calm, b: PAP.flutter, k: o.flutter || 0 };
    },
    stateNotes: { calm: 'no air: happy', flutter: 'a breeze of 1: still happy', scattered: 'a breeze of 2+: blown away, unhappy', icon: iconNote('calm') },
    samples: [
      { label: 'calm', o: pose({}) }, { label: 'fluttering', o: pose({ flow: 1, flutter: 1 }) },
      { label: 'blown away', o: pose({ flow: 2, flutter: 1, scatter: 1, dirx: 1 }), t: 0.9 }
    ]
  });

  var FERN = keyed(['still', 'swaying', 'battered']);
  FERN.icon = iconKeys('swaying');
  define('object.fern', {
    group: 'object', draw: objFern, note: 'wants a breeze of exactly 1. o.sway, o.bend (battered).',
    states: ['still', 'swaying', 'battered', 'icon'], state: function (o) { return o.icon ? FERN.icon : o.bend >= 0.5 ? FERN.battered : o.sway >= 0.5 ? FERN.swaying : FERN.still; },
    blend: function (o) {
      if (o.bend > 0) return { a: o.sway >= 0.5 ? FERN.swaying : FERN.still, b: FERN.battered, k: o.bend };
      return { a: FERN.still, b: FERN.swaying, k: o.sway || 0 };
    },
    stateNotes: { still: 'no air: waiting', swaying: 'a breeze of exactly 1: happy', battered: 'a breeze of 2+: unhappy', icon: iconNote('swaying') },
    samples: [
      { label: 'still', o: pose({}) }, { label: 'swaying', o: pose({ flow: 1, sway: 1 }) },
      { label: 'battered', o: pose({ flow: 2, sway: 1, bend: 1, dirx: 1 }) }
    ]
  });

  var STO = keyed(['clear', 'smoky']);
  STO.icon = iconKeys('clear');
  define('object.stove', {
    group: 'object', draw: objStove,
    note: 'its smoke must be blown outside. The rising smoke is drawn by the board, not the sprite.',
    states: ['clear', 'smoky', 'icon'], state: function (o) { return o.icon ? STO.icon : o.state === 'happy' ? STO.clear : STO.smoky; },
    stateNotes: { clear: 'its smoke is blown outside: happy', smoky: 'smoke stays in the house: unhappy', icon: iconNote('clear') },
    samples: [{ label: 'cooking', o: pose({ state: 'idle' }) }, { label: 'clear', o: pose({ state: 'happy' }) }]
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
    stateNotes: { happy: 'the object is happy', bad: 'unhappy', dirty: 'unhappy: smoky air reached it', idle: 'waiting' },
    unit: function (o) { return o.r || 6; }, box: [-1.3, -1.3, 2.6, 2.6],
    samples: ['happy', 'bad', 'dirty', 'idle'].map(function (s) { return { label: s, o: { state: s } }; })
  });

  var WIND_KEYS = keyed(['cue', 'in', 'out']);
  define('ui.wind', {
    group: 'ui', draw: windMark,
    note: 'the wind\'s mark: chevrons in the garden on the windy side (cue), and on window spots while a window is picked up (in: lets the wind in; out: lets air out). o.d: the way it points. Art points north.',
    states: ['cue', 'in', 'out'], state: function (o) { return WIND_KEYS[o.kind] || WIND_KEYS.cue; },
    stateNotes: { cue: 'in the garden, on the windy side', in: 'a window here lets the wind in', out: 'a window here lets air out' },
    turn: function (o) { return (o.d | 0) * QUARTER; },
    samples: [{ label: 'cue', o: { kind: 'cue', d: 1 } }, { label: 'in', o: { kind: 'in', d: 2 } }, { label: 'out', o: { kind: 'out', d: 0 } }]
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
    num: Theme.num, draw: draw, drawBuiltin: drawBuiltin
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
    // mistakes found in the art (see WBTheme.report): [{ level, text, hint, sprite, token, file, line }]
    problems: Theme.problems,
    image: function (src) { var im = IMG[src]; return im ? { src: im.src, ok: im.ok, error: im.err, w: im.w, h: im.h } : null; },
    fakeImage: fakeImage,
    onChange: onChange
  };
});
