/*
 * Windbreaker — theme: every colour (and the few other design tokens) the game
 * uses, for light and dark mode, in one table. See GRAPHICS.md.
 *
 * The page and the canvas share it:
 *   - DOM: on load, theme.js writes the tokens as CSS custom properties
 *     (--bg, --wall, --t-fan, ...) into <style id="wb-theme">: light on :root,
 *     dark under prefers-color-scheme: dark, and either one when <html> has
 *     data-theme="light" | "dark". css/style.css only ever uses var(--token).
 *   - canvas: js/sprites.js and js/render.js read the same table directly with
 *     WBTheme.color(name), for the mode the page is in.
 * Art manifests (art/art.js) and the studio change tokens with WBTheme.set();
 * the CSS is rewritten and listeners (the game) repaint the canvas.
 *
 * Exposes window.WBTheme. It is loaded first, in <head>, so the page never
 * paints without its colours. Also loads in Node (no CSS is written there) for
 * the unit tests.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WBTheme = api;
})(typeof self !== 'undefined' ? self : null, function (root) {
  'use strict';

  var FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  // [token, light, dark, what it is for]
  var GROUPS = [
    {
      id: 'page', title: 'Page and controls', note: 'Screens, cards, buttons and text. A few also mark the board.',
      tokens: [
        ['font', FONT, FONT, 'font stack'],
        ['bg', '#f4f0e8', '#1a1e24', 'page background'],
        ['bg-2', '#ece6da', '#222830', 'sunken background: chips, tracks, icon pairs'],
        ['surface', '#fffcf6', '#272c34', 'cards and tray; ring around status pips; meter pill'],
        ['surface-2', '#f3eee4', '#2e343d', 'secondary surface'],
        ['ink', '#3a414c', '#e7e3db', 'text; candle wick'],
        ['ink-soft', '#646b76', '#b1b6bd', 'secondary text; curtain rod, washing line, meter rings'],
        ['muted', '#686e76', '#9ba2ab', 'small print (4.5:1 on bg)'],
        ['line', 'rgba(58, 65, 76, 0.12)', 'rgba(231, 227, 219, 0.1)', 'hairlines'],
        ['line-strong', 'rgba(58, 65, 76, 0.22)', 'rgba(231, 227, 219, 0.2)', 'stronger hairlines'],
        ['accent', '#379a8f', '#5cc1b4', 'brand teal: hint outline, keyboard cursor, goal focus, win bloom'],
        ['accent-text', '#24716a', '#5cc1b4', 'accent-coloured text (4.8:1+ on bg, surface and accent-soft)'],
        ['accent-fill', '#2b8278', '#5cc1b4', 'primary button background (4.6:1 with white)'],
        ['accent-ink', '#ffffff', '#0f2220', 'text on accent-fill'],
        ['accent-soft', 'rgba(55, 154, 143, 0.14)', 'rgba(92, 193, 180, 0.16)', 'selected tool, soft accent wash'],
        ['accent-2', '#e8866d', '#f0957c', 'second accent: pieces in the way of a hint'],
        ['good', '#4daa6c', '#66c285', 'happy status pip, met requirement meter'],
        ['bad', '#df7366', '#ec8577', 'unhappy pip, "no way out" mark, too much air'],
        ['bad-text', '#b5473c', '#ec8577', 'warning text'],
        ['danger-fill', '#b8504a', '#ec8577', 'destructive button background'],
        ['danger-ink', '#ffffff', '#2a1512', 'text on danger-fill'],
        ['focus', '#379a8f', '#5cc1b4', 'keyboard focus ring'],
        ['scrim', 'rgba(40, 44, 40, 0.24)', 'rgba(0, 0, 0, 0.45)', 'behind dialogs'],
        ['scrim-light', 'rgba(40, 44, 40, 0.08)', 'rgba(0, 0, 0, 0.18)', 'behind the win sheet (the house stays visible)'],
        ['shadow', '0 1px 2px rgba(50, 45, 35, 0.06), 0 6px 20px rgba(50, 45, 35, 0.08)', '0 1px 2px rgba(0, 0, 0, 0.25), 0 6px 20px rgba(0, 0, 0, 0.25)', 'card shadow (a box-shadow)'],
        ['shadow-lg', '0 2px 6px rgba(50, 45, 35, 0.08), 0 18px 48px rgba(50, 45, 35, 0.16)', '0 2px 6px rgba(0, 0, 0, 0.3), 0 18px 48px rgba(0, 0, 0, 0.45)', 'dialog shadow (a box-shadow)']
      ]
    },
    {
      id: 'house', title: 'Garden and house', note: 'The board: drawn once per level into cached layers.',
      tokens: [
        ['garden', '#dde7d5', '#28332b', 'lawn around the house'],
        ['garden-2', '#d2dfca', '#222c25', 'lawn vignette towards the edges'],
        ['garden-mark', 'rgba(110, 140, 100, 0.16)', 'rgba(150, 190, 140, 0.1)', 'grass tufts'],
        ['streak', 'rgba(255, 255, 255, 0.92)', 'rgba(205, 228, 236, 0.5)', 'wind streaks and calm motes in the garden (mixed with air)'],
        ['floor', '#f7f2e8', '#424852', 'floor tiles'],
        ['floor-grid', 'rgba(91, 100, 114, 0.07)', 'rgba(255, 255, 255, 0.05)', 'grid lines between floor tiles'],
        ['wall', '#66707e', '#181c21', 'walls; fixed plinths and vent slats are tinted with it'],
        ['wall-solid', '#575f6c', '#14171c', 'solid walls (no windows)'],
        ['wall-hatch', 'rgba(255, 255, 255, 0.13)', 'rgba(255, 255, 255, 0.06)', 'hatching on solid walls'],
        ['wall-hi', 'rgba(255, 255, 255, 0.16)', 'rgba(255, 255, 255, 0.12)', 'lit top edge of walls'],
        ['wall-lo', 'rgba(20, 24, 30, 0.16)', 'rgba(0, 0, 0, 0.35)', 'shaded bottom edge of walls'],
        ['wall-light', '#8d96a3', '#444c58', 'frames of house-owned windows, extractors, skylights; candle dish'],
        ['icon-wall', '#66707e', '#4d5562', 'the bit of wall drawn in tray and help icons'],
        ['house-shadow', 'rgba(48, 62, 44, 0.22)', 'rgba(0, 0, 0, 0.5)', 'shadow of the house on the lawn, of walls on the floor'],
        ['table', '#e7d0ad', '#7d6850', 'table top'],
        ['table-edge', '#cfae82', '#957b5c', 'table edge; pinwheel stick, laundry poles and pegs']
      ]
    },
    {
      id: 'air', title: 'Air and smoke', note: 'Streams, ripples and puffs.',
      tokens: [
        ['air', '#6aaee0', '#79bdeb', 'airflow streams'],
        ['air-deep', '#3f8bc6', '#a6d6f7', 'blocked-stream ripples, window wind-mouths, water drops, meter dots'],
        ['smoke', '#9a8f83', '#8d867e', 'smoky streams, puffs and soot']
      ]
    },
    {
      id: 'tools', title: 'Tools', note: 'The ten pieces the player places (js/sprites.js tool.*).',
      tokens: [
        ['piece-base', '#fffdf8', '#59616d', 'plinth under placed floor tools; window frame; fan cage'],
        ['piece-shadow', 'rgba(30, 35, 30, 0.12)', 'rgba(30, 35, 30, 0.12)', 'drop shadow under placed floor tools'],
        ['glass', '#dcebf5', '#5b7a90', 'outlet window pane'],
        ['glass-in', '#8fc6ec', '#8cc4e8', 'inlet window pane (faces the wind)'],
        ['window-mark', '#2f6f9f', '#173a55', 'chevrons on window panes'],
        ['t-fan', '#3a9d92', '#54bdb0', 'fan'],
        ['t-deflector', '#e2a24f', '#e9b062', 'deflector'],
        ['t-curtain', '#e2898b', '#e79b9c', 'curtain'],
        ['t-vent', '#c9ced5', '#6b7482', 'wall vent'],
        ['t-splitter', '#9686cf', '#a99ade', 'splitter'],
        ['t-extractor', '#4b95c4', '#66acd8', 'extractor'],
        ['t-skylight', '#9fd0ef', '#7fb7da', 'skylight glass'],
        ['t-filter', '#78ad84', '#8cc097', 'air filter'],
        ['t-ceilingfan', '#b48a62', '#c49c74', 'ceiling fan']
      ]
    },
    {
      id: 'objects', title: 'Objects', note: 'The six things that want air (js/sprites.js object.*).',
      tokens: [
        ['o-coral', '#ef8a72', '#f0957c', 'pinwheel blade; towel'],
        ['o-sun', '#f2c14e', '#f2c45a', 'pinwheel blade; win sparkles'],
        ['o-teal', '#4fb3a6', '#5cc1b4', 'pinwheel blade'],
        ['o-sky', '#6aaee0', '#79bdeb', 'pinwheel blade; shirt'],
        ['o-cream', '#f4e7c8', '#efe2c2', 'candle'],
        ['o-flame', '#f5a03a', '#f7a845', 'candle flame and glow; stove burner ring'],
        ['o-flame-core', 'rgba(255, 240, 190, 0.95)', 'rgba(255, 240, 190, 0.95)', 'bright core of the candle flame'],
        ['o-leaf', '#5aa564', '#6dba77', 'healthy fern'],
        ['o-leaf-sad', '#b5a456', '#b9a95e', 'battered fern'],
        ['o-pot', '#d9845e', '#d38a66', 'fern pot'],
        ['o-paper', '#ffffff', '#f4f1ea', 'papers'],
        ['o-stove', '#ece6db', '#d9d3c8', 'stove body'],
        ['o-stove-edge', '#8d8478', '#8d8478', 'stove outline and knobs'],
        ['o-burner', '#3b4049', '#3b4049', 'stove hob'],
        ['o-grate', '#2a2e35', '#2a2e35', 'pan supports over the hob']
      ]
    },
    {
      id: 'marks', title: 'Board marks', note: 'Placement highlights, status pips and other marks drawn over the board.',
      tokens: [
        ['hl', 'rgba(55, 154, 143, 0.16)', 'rgba(92, 193, 180, 0.16)', 'tile under a valid drop'],
        ['hl-edge', 'rgba(55, 154, 143, 0.6)', 'rgba(92, 193, 180, 0.7)', 'placement dots and wall-slot outlines'],
        ['hl-wall', 'rgba(150, 228, 216, 0.3)', 'rgba(92, 193, 180, 0.3)', 'wall placement slots'],
        ['pip-idle', '#9aa1aa', '#8b929b', 'waiting status pip; a stalled inlet on a solved board'],
        ['mark', '#ffffff', '#ffffff', 'white marks on coloured shapes: ticks, arrows, glints']
      ]
    }
  ];

  var NAMES = [], DEFAULTS = { light: {}, dark: {} }, INFO = {};
  GROUPS.forEach(function (g) {
    g.tokens = g.tokens.map(function (t) {
      var tok = { name: t[0], light: t[1], dark: t[2], note: t[3], group: g.id };
      NAMES.push(tok.name);
      DEFAULTS.light[tok.name] = tok.light;
      DEFAULTS.dark[tok.name] = tok.dark;
      INFO[tok.name] = tok;
      return tok;
    });
  });
  var MODES = ['light', 'dark'];

  // ------------------------------------------------------------------ state

  var over = { light: {}, dark: {} };     // overrides (art manifest, studio)
  var resolved = { light: null, dark: null };
  var forced = null;                      // WBTheme.use(): canvas mode regardless of the page
  var active = palette('light');          // what color() reads
  var listeners = [];
  var missing = {};

  function palette(mode) {
    mode = mode === 'dark' ? 'dark' : 'light';
    if (!resolved[mode]) {
      var p = {};
      for (var i = 0; i < NAMES.length; i++) {
        var n = NAMES[i];
        p[n] = over[mode][n] != null ? over[mode][n] : DEFAULTS[mode][n];
      }
      resolved[mode] = p;
    }
    return resolved[mode];
  }

  // The mode the page is in: <html data-theme> wins, else the OS setting.
  var doc = root && root.document;
  var darkMQ = null;
  try { darkMQ = root && root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null; } catch (e) { darkMQ = null; }
  function pageMode() {
    var a = doc && doc.documentElement && doc.documentElement.getAttribute('data-theme');
    if (a === 'dark' || a === 'light') return a;
    return darkMQ && darkMQ.matches ? 'dark' : 'light';
  }
  function refresh() { active = palette(forced || pageMode()); }

  // Hot path: every colour the canvas draws comes through here.
  function color(name) {
    var v = active[name];
    return v !== undefined ? v : unknown(name);
  }
  function unknown(name) {
    if (!missing[name]) {
      missing[name] = true;
      if (typeof console !== 'undefined') console.warn('WBTheme: unknown token "' + name + '"');
    }
    return '#888888';
  }

  // ------------------------------------------------------------------ CSS

  function block(mode, indent) {
    var p = palette(mode), out = '';
    for (var i = 0; i < NAMES.length; i++) out += indent + '--' + NAMES[i] + ': ' + p[NAMES[i]] + ';\n';
    return out;
  }
  function css() {
    return ':root {\n' + block('light', '  ') + '}\n' +
      '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n' + block('dark', '    ') + '  }\n}\n' +
      ':root[data-theme="dark"] {\n  color-scheme: dark;\n' + block('dark', '  ') + '}\n' +
      ':root[data-theme="light"] { color-scheme: light; }\n';
  }
  var styleEl = null;
  function writeCss() {
    if (!doc || !doc.createElement) return;
    if (!styleEl) {
      styleEl = doc.getElementById('wb-theme');
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.id = 'wb-theme';
        (doc.head || doc.documentElement).appendChild(styleEl);
      }
    }
    styleEl.textContent = css();
  }

  // ------------------------------------------------------------------ changes

  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function emit(why) {
    clearColorCache();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](why); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
    }
  }

  // set({ light: {tok: value}, dark: {...} }) or set({ tok: value }) for both
  // modes. A null value removes that override. Unknown tokens are skipped.
  function set(o, quiet) {
    if (!o) return;
    var split = o.light || o.dark;
    MODES.forEach(function (mode) {
      var src = split ? o[mode] || {} : o;
      Object.keys(src).forEach(function (k) {
        if (!INFO[k]) { if (typeof console !== 'undefined') console.warn('WBTheme: no token "' + k + '" (see GRAPHICS.md)'); return; }
        if (src[k] == null || src[k] === '') delete over[mode][k];
        else over[mode][k] = String(src[k]).trim();
      });
    });
    resolved = { light: null, dark: null };
    refresh();
    writeCss();
    if (!quiet) emit('tokens');
  }
  function reset(quiet) {
    over = { light: {}, dark: {} };
    resolved = { light: null, dark: null };
    refresh();
    writeCss();
    if (!quiet) emit('tokens');
  }
  function overrides() {
    return { light: Object.assign({}, over.light), dark: Object.assign({}, over.dark) };
  }
  // Canvas only: draw in this mode until use(null). The studio uses it to
  // paint light and dark side by side; nothing else should need it.
  function use(mode) {
    var prev = forced;
    forced = mode === 'light' || mode === 'dark' ? mode : null;
    refresh();
    return prev;
  }
  // Forces the whole page (CSS and canvas) into a mode; null follows the OS.
  function setMode(mode) {
    var de = doc && doc.documentElement;
    if (!de) return;
    if (mode === 'light' || mode === 'dark') de.setAttribute('data-theme', mode);
    else de.removeAttribute('data-theme');
  }

  // ------------------------------------------------------------------ colour helpers
  // Results are cached, but every input is quantised first so the caches stay
  // small even for per-frame values.

  function parse(c) {
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
  function isColor(c) { return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(c).trim()) || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(String(c).trim()); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  var rgbCache = {}, strCache = {}, strCacheN = 0;
  function clearColorCache() { rgbCache = {}; strCache = {}; strCacheN = 0; }
  function rgbOf(c) {
    var v = rgbCache[c];
    if (!v) v = rgbCache[c] = parse(c);
    return v;
  }
  function remember(key, v) {
    if (++strCacheN > 3000) { strCache = {}; rgbCache = {}; strCacheN = 0; }
    strCache[key] = v;
    return v;
  }
  function mix(a, b, t) {
    t = Math.round(clamp01(t) * 64) / 64;
    var key = a + '|' + b + '|' + t;
    var r = strCache[key];
    if (r) return r;
    var A = rgbOf(a), B = rgbOf(b);
    return remember(key, 'rgba(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ',' +
      Math.round(A[2] + (B[2] - A[2]) * t) + ',' + (A[3] + (B[3] - A[3]) * t).toFixed(3) + ')');
  }
  function alpha(c, a) {
    a = Math.round(clamp01(a) * 100) / 100;
    var key = c + '|a|' + a;
    var r = strCache[key];
    if (r) return r;
    var A = rgbOf(c);
    return remember(key, 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + (A[3] * a).toFixed(3) + ')');
  }
  function darker(c, t) { return mix(c, '#000000', t); }
  function lighter(c, t) { return mix(c, '#ffffff', t); }
  function hex(c) {
    var A = parse(c);
    return '#' + [A[0], A[1], A[2]].map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }

  // ------------------------------------------------------------------ boot

  refresh();
  writeCss();
  // The OS setting or <html data-theme> changed: repaint if the mode did.
  var lastMode = pageMode();
  function modeCheck() {
    refresh();
    var m = pageMode();
    if (m === lastMode) return;
    lastMode = m;
    emit('mode');
  }
  if (darkMQ) {
    if (darkMQ.addEventListener) darkMQ.addEventListener('change', modeCheck);
    else if (darkMQ.addListener) darkMQ.addListener(modeCheck);
  }
  if (doc && root.MutationObserver && doc.documentElement) {
    new root.MutationObserver(modeCheck).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  return {
    groups: GROUPS,
    names: NAMES.slice(),
    info: function (name) { return INFO[name] || null; },
    defaults: { light: Object.assign({}, DEFAULTS.light), dark: Object.assign({}, DEFAULTS.dark) },
    mode: function () { return forced || pageMode(); },
    pageMode: pageMode,
    palette: palette,
    color: color,
    set: set,
    reset: reset,
    overrides: overrides,
    use: use,
    setMode: setMode,
    css: css,
    onChange: onChange,
    missing: function () { return Object.keys(missing); },
    // colour helpers (shared by sprites.js, render.js and art manifests)
    parse: parse,
    isColor: isColor,
    mix: mix,
    alpha: alpha,
    darker: darker,
    lighter: lighter,
    hex: hex
  };
});
