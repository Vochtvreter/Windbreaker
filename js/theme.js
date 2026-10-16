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
 * Besides colours there are "tuning" numbers: animation speeds and a few sizes
 * (WBTheme.num(name), set by the manifest's tuning section). And a list of
 * art problems (WBTheme.problems()): typos and bad values found while an art
 * manifest is applied, shown by the studio's "Art in use".
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
        ['bg', '#f4f0e8', '#1a1e24', 'page background; the browser bar on phones'],
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
        ['accent-glow', 'rgba(43, 130, 120, 0.26)', 'rgba(43, 130, 120, 0.26)', 'soft glow under primary buttons (Play, Next)'],
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
        ['shadow-lg', '0 2px 6px rgba(50, 45, 35, 0.08), 0 18px 48px rgba(50, 45, 35, 0.16)', '0 2px 6px rgba(0, 0, 0, 0.3), 0 18px 48px rgba(0, 0, 0, 0.45)', 'dialog shadow (a box-shadow)'],
        ['tooltip-shadow', '0 4px 14px rgba(0, 0, 0, 0.18)', '0 4px 14px rgba(0, 0, 0, 0.18)', 'tooltip shadow (a box-shadow)']
      ]
    },
    {
      id: 'house', title: 'Garden and house', note: 'The board: drawn once per level into cached layers.',
      tokens: [
        ['garden', '#dde7d5', '#28332b', 'lawn around the house'],
        ['garden-2', '#d2dfca', '#222c25', 'lawn vignette towards the edges'],
        ['garden-mark', 'rgba(110, 140, 100, 0.16)', 'rgba(150, 190, 140, 0.1)', 'grass tufts'],
        ['streak', 'rgba(255, 255, 255, 0.92)', 'rgba(205, 228, 236, 0.5)', 'wind streaks and calm motes in the garden (mixed half and half with air: recolour the two together)'],
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
      id: 'air', title: 'Air and smoke', note: 'Streams, ripples and puffs. To recolour the air, change air, air-deep and streak together.',
      tokens: [
        ['air', '#6aaee0', '#79bdeb', 'airflow streams; also the wind streaks in the garden (with streak), the title logo, the win swirl, "no way out" lines and the wind icon in help'],
        ['air-deep', '#3f8bc6', '#a6d6f7', 'blocked-stream ripples, window wind-mouths, water drops, meter dots, reduced-motion chevrons, the wind\'s chevrons in the garden and on window spots; the wind badge at the top'],
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
        ['mark', '#ffffff', '#ffffff', 'white marks on coloured shapes: ticks, arrows, glints; the cross on pieces in the way of a hint; the hover ring on walls']
      ]
    }
  ];

  // Tokens that are not colours; every other token must be a colour.
  var KINDS = { font: 'font', shadow: 'shadow', 'shadow-lg': 'shadow', 'tooltip-shadow': 'shadow' };

  var NAMES = [], DEFAULTS = { light: {}, dark: {} }, INFO = {};
  GROUPS.forEach(function (g) {
    g.tokens = g.tokens.map(function (t) {
      var tok = { name: t[0], light: t[1], dark: t[2], note: t[3], group: g.id, kind: KINDS[t[0]] || 'color' };
      NAMES.push(tok.name);
      DEFAULTS.light[tok.name] = tok.light;
      DEFAULTS.dark[tok.name] = tok.dark;
      INFO[tok.name] = tok;
      return tok;
    });
  });
  var MODES = ['light', 'dark'];

  // ------------------------------------------------------------------ tuning
  // Numbers, the same in light and dark mode: animation speeds (1 = as
  // designed, 0.5 = half as fast, 0 = still) and a few sizes. js/render.js and
  // the studio read them with num(name); an art manifest sets them in its
  // tuning section, e.g. tuning: { 'spin-fan': 0.5 }.

  // [name, default, min, max, step, what it changes]
  var TUNING_GROUPS = [
    {
      id: 'motion', title: 'Speeds', note: '1 is the speed the game was designed with: 0.5 is half as fast, 2 twice as fast, 0 stops it.',
      tunings: [
        ['spin-fan', 1, 0, 4, 0.05, 'fan blades (they also turn faster the more air goes through)'],
        ['spin-extractor', 1, 0, 4, 0.05, 'extractor rotors'],
        ['spin-ceilingfan', 1, 0, 4, 0.05, 'ceiling fan paddles'],
        ['spin-pinwheel', 1, 0, 4, 0.05, 'pinwheels (and a pinwheel image layer with spin)'],
        ['flow-speed', 1, 0, 4, 0.05, 'the streaks travelling along the airflow streams, and the smoke puffs on smoky streams'],
        ['wind-speed', 1, 0, 4, 0.05, 'the wind streaks drifting across the garden (and the calm motes bobbing)'],
        ['idle-speed', 1, 0, 4, 0.05, 'small idle motion: flame flicker, laundry and fern swing, curtain sway, fluttering papers, stove glow and smoke'],
        ['win-boost', 1, 0, 3, 0.05, 'the burst of extra spin and flow when a level is solved (0: none)']
      ]
    },
    {
      id: 'size', title: 'Sizes', note: 'Multipliers (1 = as designed), except the largest tile, which is in CSS pixels.',
      tunings: [
        ['object-scale', 1, 0.5, 1.5, 0.01, 'objects (pinwheel, candle, laundry, ...) on their tile'],
        ['stream-width', 1, 0.3, 2.5, 0.05, 'how thick the airflow streams are'],
        ['pip-size', 1, 0.5, 2, 0.05, 'the status pip on each object'],
        ['max-tile', 84, 40, 160, 1, 'the largest a tile gets on big screens, in CSS pixels']
      ]
    }
  ];
  var TNAMES = [], TINFO = {}, TDEF = {};
  TUNING_GROUPS.forEach(function (g) {
    g.tunings = g.tunings.map(function (t) {
      var x = { name: t[0], value: t[1], min: t[2], max: t[3], step: t[4], note: t[5], group: g.id };
      TNAMES.push(x.name);
      TINFO[x.name] = x;
      TDEF[x.name] = x.value;
      return x;
    });
  });

  // ------------------------------------------------------------------ state

  var over = { light: {}, dark: {} };     // overrides (art manifest, studio)
  var resolved = { light: null, dark: null };
  var forced = null;                      // WBTheme.use(): canvas mode regardless of the page
  var activeMode = 'light';
  var active = palette('light');          // what color() reads
  var tune = {};                          // tuning overrides
  var tuned = Object.assign({}, TDEF);    // what num() reads
  var listeners = [];
  var missing = {};
  var tracing = null;                     // trace(): token names asked for

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
  function refresh() { activeMode = forced || pageMode(); active = palette(activeMode); }

  // Hot path: every colour the canvas draws comes through here.
  function color(name) {
    if (tracing !== null) tracing[name] = true;
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
  // Runs fn and returns the token names it asked for (the studio's "used by").
  function trace(fn) {
    var prev = tracing, mine = {};
    tracing = mine;
    try { fn(); } finally {
      tracing = prev;
      if (prev) for (var k in mine) prev[k] = true;
    }
    return Object.keys(mine);
  }

  // Tuning numbers: hot path too (a few per piece per frame).
  function num(name) {
    var v = tuned[name];
    if (v !== undefined) return v;
    if (!missing['#' + name]) {
      missing['#' + name] = true;
      if (typeof console !== 'undefined') console.warn('WBTheme: unknown tuning "' + name + '"');
    }
    return 1;
  }

  // ------------------------------------------------------------------ problems
  // Mistakes found while art is applied: unknown names, values that are not
  // colours, files that do not load, a draw function that fails, an art.js
  // with a typo. Each is said once in the console and listed by the studio.
  //   level: 'error' (something is not shown) | 'warn' (something was ignored) | 'note'
  //   more:  { hint, scope, token, mode, sprite, file, line }; scope 'manifest' (the
  //          default) is cleared whenever a manifest is applied

  var PROBLEMS = [];
  function report(level, text, more) {
    var key = level + '|' + text;
    for (var i = 0; i < PROBLEMS.length; i++) if (PROBLEMS[i].key === key) return PROBLEMS[i];
    var p = { level: level, text: text, key: key, scope: 'manifest' };
    if (more) for (var k in more) if (more[k] != null) p[k] = more[k];
    PROBLEMS.push(p);
    if (typeof console !== 'undefined') {
      var msg = 'Windbreaker art: ' + text + (p.hint ? '\n  ' + p.hint : '');
      if (level === 'error') console.error(msg); else if (level === 'note') (console.info || console.log)(msg); else console.warn(msg);
    }
    return p;
  }
  function problems() { return PROBLEMS.map(function (p) { return Object.assign({}, p); }); }
  // clearProblems() clears all; clearProblems(fn) the ones fn(problem) says yes to
  function clearProblems(fn) { PROBLEMS = fn ? PROBLEMS.filter(function (p) { return !fn(p); }) : []; }

  // "did you mean": the closest name in list, if it is close enough
  function distance(a, b) {
    var m = a.length, n = b.length, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function suggest(word, list) {
    var w = String(word).toLowerCase().trim(), best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = distance(w, String(list[i]).toLowerCase());
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best !== null && best !== word && bd <= Math.max(2, Math.floor(w.length / 3)) ? best : null;
  }
  function meant(word, list) {
    var s = suggest(word, list);
    return s ? ' (did you mean "' + s + '"?)' : '';
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
    // the browser bar on phones (<meta name="theme-color" media="(prefers-color-scheme: ...)">)
    var metas = doc.querySelectorAll ? doc.querySelectorAll('meta[name="theme-color"]') : [];
    for (var i = 0; i < metas.length; i++) {
      var bg = palette(/dark/.test(metas[i].getAttribute('media') || '') ? 'dark' : 'light').bg;
      if (metas[i].getAttribute('content') !== bg) metas[i].setAttribute('content', bg);
    }
  }

  // ------------------------------------------------------------------ changes

  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function emit(why) {
    clearColorCache();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](why); } catch (e) { if (typeof console !== 'undefined') console.error(e); }
    }
  }

  // check(token, value) -> the value to keep, or null when it is not a colour
  // (or a font list / box-shadow) at all. Colour names and other CSS colour
  // forms need a browser: the canvas checks them (and parse() reads them).
  function check(name, v) {
    var tok = INFO[name];
    if (!tok || v == null) return null;
    v = String(v).trim();
    if (!v) return null;
    if (tok.kind === 'color') return isColor(v) || canvasColor(v) ? v : null;
    return cssOk(tok.kind === 'font' ? 'font-family' : 'box-shadow', v) ? v : null;
  }
  var COLOUR_HELP = 'Colours can be #rgb, #rrggbb, #rrggbbaa, rgb(r, g, b), rgba(r, g, b, a), hsl(h, s%, l%) or a CSS colour name such as tomato (names need a browser).';

  // set({ light: {tok: value}, dark: {...} }) or set({ tok: value }) for both
  // modes; both at once also works (the flat values first, then the per-mode
  // ones). A null value removes that override. Unknown tokens and values that
  // are not colours are reported and skipped.
  function set(o, quiet) {
    if (!o) return;
    if (typeof o !== 'object') { report('warn', 'theme must look like { light: { token: value }, dark: { token: value } }'); return; }
    var split = o.light != null || o.dark != null;
    var flat = {}, unknownSaid = {};
    Object.keys(o).forEach(function (k) { if (!split || (k !== 'light' && k !== 'dark')) flat[k] = o[k]; });
    function apply(mode, src) {
      Object.keys(src).forEach(function (k) {
        if (!INFO[k]) {
          if (!unknownSaid[k]) {
            unknownSaid[k] = true;
            report('warn', 'theme: there is no token "' + k + '"' + meant(k, NAMES), { hint: 'The studio\'s Tokens section (and js/theme.js) lists every token.', token: k });
          }
          return;
        }
        var v = src[k];
        if (v == null || v === '') { delete over[mode][k]; return; }
        var ok = check(k, v);
        if (ok == null) {
          var kind = INFO[k].kind === 'color' ? 'a colour' : INFO[k].kind === 'font' ? 'a font list' : 'a box-shadow';
          report('warn', 'theme: "' + String(v).trim() + '" is not ' + kind + ', so ' + k + ' (' + mode + ') keeps ' + palette(mode)[k],
            { hint: INFO[k].kind === 'color' ? COLOUR_HELP : null, token: k, mode: mode, value: String(v) });
          return;
        }
        over[mode][k] = ok;
      });
    }
    MODES.forEach(function (mode) {
      apply(mode, flat);
      if (!split || o[mode] == null) return;
      if (typeof o[mode] !== 'object') { report('warn', 'theme: ' + mode + ' must be { token: value, ... }'); return; }
      apply(mode, o[mode]);
    });
    resolved = { light: null, dark: null };
    refresh();
    writeCss();
    if (!quiet) emit('tokens');
  }
  // setTuning({ name: number }): null removes an override. Unknown names,
  // values that are not numbers and numbers out of range are reported.
  function setTuning(o, quiet) {
    if (!o) return;
    if (typeof o !== 'object') { report('warn', 'tuning must look like { \'spin-fan\': 0.5 }'); return; }
    Object.keys(o).forEach(function (k) {
      var info = TINFO[k];
      if (!info) { report('warn', 'tuning: there is no "' + k + '"' + meant(k, TNAMES), { hint: 'The studio\'s Speeds and sizes section lists them: ' + TNAMES.join(', ') + '.' }); return; }
      var v = o[k];
      if (v == null || v === '') { delete tune[k]; return; }
      var n = typeof v === 'number' ? v : /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(String(v)) ? parseFloat(v) : NaN;
      if (!isFinite(n)) { report('warn', 'tuning: ' + k + ' must be a number, not "' + v + '" (keeping ' + num(k) + ')', { tuning: k }); return; }
      if (n < info.min || n > info.max) {
        var c = n < info.min ? info.min : info.max;
        report('warn', 'tuning: ' + k + ' goes from ' + info.min + ' to ' + info.max + ', so ' + n + ' becomes ' + c, { tuning: k });
        n = c;
      }
      tune[k] = n;
    });
    tuned = Object.assign({}, TDEF, tune);
    if (!quiet) emit('tuning');
  }
  function reset(quiet) {
    over = { light: {}, dark: {} };
    tune = {};
    tuned = Object.assign({}, TDEF);
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
  // small even for per-frame values. parse() reads #rgb, #rgba, #rrggbb,
  // #rrggbbaa, rgb()/rgba() and hsl()/hsla(); in a browser anything else the
  // canvas understands (colour names, ...) goes through the canvas first.

  var HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var RGB_RE = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i;
  var HSL_RE = /^hsla?\(\s*-?[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+\s*)?\)$/i;

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s = clamp01(s); l = clamp01(l);
    function f(n) {
      var k = (n + h * 12) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    }
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
  function parse(c) {
    c = String(c).trim();
    var m;
    if (c.charAt(0) === '#') {
      var h = c.slice(1);
      if (h.length === 3 || h.length === 4) h = h.replace(/./g, function (x) { return x + x; });
      var n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(',').map(function (s) { return parseFloat(s); });
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = c.match(/^hsla?\(([^)]+)\)$/i);
    if (m) {
      var q = m[1].split(',').map(function (s) { return parseFloat(s); });
      var rgb = hslToRgb(q[0], q[1] / 100, q[2] / 100);
      return [rgb[0], rgb[1], rgb[2], q.length > 3 ? q[3] : 1];
    }
    var viaCanvas = canvasColor(c);
    if (viaCanvas && viaCanvas !== c) return parse(viaCanvas);
    return [136, 136, 136, 1];
  }
  function isColor(c) {
    c = String(c).trim();
    return HEX_RE.test(c) || RGB_RE.test(c) || HSL_RE.test(c);
  }
  // In a browser: what the canvas makes of a colour ('#rrggbb' or 'rgba(...)'),
  // false when it is not a colour; null without a canvas (Node).
  var probe = null;
  function canvasColor(v) {
    if (probe === null) {
      probe = false;
      try { if (doc && doc.createElement) probe = doc.createElement('canvas').getContext('2d') || false; } catch (e) { probe = false; }
    }
    if (!probe) return null;
    probe.fillStyle = '#010203';
    probe.fillStyle = v;
    var a = probe.fillStyle;
    if (a === '#010203') {
      probe.fillStyle = '#040506';
      probe.fillStyle = v;
      if (probe.fillStyle === '#040506') return false;
    }
    return a;
  }
  function cssOk(prop, v) {
    try { return root && root.CSS && root.CSS.supports ? root.CSS.supports(prop, v) : true; } catch (e) { return true; }
  }
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
    // the mode the canvas is drawing in right now (cheap; for per-frame use)
    drawMode: function () { return activeMode; },
    pageMode: pageMode,
    palette: palette,
    color: color,
    check: check,
    set: set,
    reset: reset,
    overrides: overrides,
    use: use,
    setMode: setMode,
    css: css,
    onChange: onChange,
    missing: function () { return Object.keys(missing).filter(function (k) { return k.charAt(0) !== '#'; }); },
    trace: trace,
    // tuning: speeds and sizes
    tuningGroups: TUNING_GROUPS,
    tuningNames: TNAMES.slice(),
    tuningInfo: function (name) { return TINFO[name] || null; },
    tuningDefaults: Object.assign({}, TDEF),
    num: num,
    setTuning: setTuning,
    tuningOverrides: function () { return Object.assign({}, tune); },
    // art problems (see report above)
    report: report,
    problems: problems,
    clearProblems: clearProblems,
    suggest: suggest,
    colourHelp: COLOUR_HELP,
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
