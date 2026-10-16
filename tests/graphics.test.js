'use strict';
// Tests for the graphics system: js/theme.js (tokens), js/sprites.js (registry,
// overrides, manifests) and tools/gallery.js. The pixels themselves are checked
// by tools/visual.js in a browser. Run: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const Theme = require('../js/theme.js');
const SPR = require('../js/sprites.js');
const GALLERY = require('../tools/gallery.js');
const { WB } = require('../tools/lib');

const NOT_COLOURS = ['font', 'shadow', 'shadow-lg'];

// A 2D context that draws nothing but checks every colour it is given.
function mockContext(bad) {
  const target = {
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createRadialGradient: () => ({ addColorStop: (o, c) => check('gradient stop', c) }),
    createLinearGradient: () => ({ addColorStop: (o, c) => check('gradient stop', c) }),
    measureText: () => ({ width: 10 }),
  };
  function check(what, v) {
    if (typeof v === 'object' && v && v.addColorStop) return;
    if (typeof v !== 'string' || !Theme.isColor(v)) bad.push(what + ' = ' + JSON.stringify(v));
  }
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      if (k === 'fillStyle' || k === 'strokeStyle') check(k, v);
      if ((k === 'lineWidth' || k === 'globalAlpha') && !(typeof v === 'number' && isFinite(v))) bad.push(k + ' = ' + v);
      t[k] = v;
      return true;
    },
  });
}

function quietly(fn) {
  const warn = console.warn;
  const said = [];
  console.warn = (m) => said.push(String(m));
  try { return { value: fn(), said }; } finally { console.warn = warn; }
}

// ------------------------------------------------------------------ theme

test('theme: every token has a light and a dark value, names are unique', () => {
  assert.equal(new Set(Theme.names).size, Theme.names.length);
  const grouped = Theme.groups.flatMap((g) => g.tokens.map((t) => t.name));
  assert.deepEqual(grouped, Theme.names);
  for (const name of Theme.names) {
    const t = Theme.info(name);
    assert.ok(t.light && t.dark, name + ' has both values');
    assert.ok(t.note, name + ' says what it is for');
    if (!NOT_COLOURS.includes(name)) {
      assert.ok(Theme.isColor(t.light), name + ' light is a colour: ' + t.light);
      assert.ok(Theme.isColor(t.dark), name + ' dark is a colour: ' + t.dark);
    }
  }
});

test('theme: CSS declares every token for light, dark and data-theme', () => {
  const css = Theme.css();
  for (const name of Theme.names) {
    const n = css.split('--' + name + ': ').length - 1;
    assert.equal(n, 3, '--' + name + ' appears in :root, the dark media query and [data-theme="dark"]');
  }
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme="light"\]\)/);
  assert.match(css, /--wall: #66707e;/);
  assert.match(css, /--wall: #181c21;/);
});

test('theme: set, overrides, palette, reset', () => {
  try {
    Theme.set({ light: { wall: '#123456' } }, true);
    assert.equal(Theme.palette('light').wall, '#123456');
    assert.equal(Theme.palette('dark').wall, Theme.defaults.dark.wall);
    Theme.set({ 't-fan': '#010203' }, true); // flat: both modes
    assert.equal(Theme.palette('dark')['t-fan'], '#010203');
    assert.deepEqual(Theme.overrides(), { light: { wall: '#123456', 't-fan': '#010203' }, dark: { 't-fan': '#010203' } });
    assert.match(Theme.css(), /--wall: #123456;/);
    Theme.set({ light: { wall: null } }, true);
    assert.equal(Theme.palette('light').wall, Theme.defaults.light.wall);
    const r = quietly(() => Theme.set({ 'no-such-token': '#fff' }, true));
    assert.ok(r.said.some((m) => m.includes('no-such-token')), 'unknown tokens are reported');
    assert.equal(Theme.palette('light')['no-such-token'], undefined);
  } finally {
    Theme.reset(true);
  }
  assert.deepEqual(Theme.overrides(), { light: {}, dark: {} });
});

test('theme: use() switches the canvas palette; colour helpers', () => {
  const prev = Theme.use('dark');
  try {
    assert.equal(Theme.color('floor'), Theme.defaults.dark.floor);
  } finally {
    Theme.use(prev);
  }
  assert.equal(Theme.color('floor'), Theme.defaults.light.floor);
  assert.equal(Theme.mix('#000000', '#ffffff', 0.5), 'rgba(128,128,128,1.000)');
  assert.equal(Theme.alpha('#ff0000', 0.25), 'rgba(255,0,0,0.250)');
  assert.equal(Theme.hex('rgba(58, 65, 76, 0.12)'), '#3a414c');
  assert.deepEqual(Theme.parse('#abc'), [170, 187, 204, 1]);
});

test('the stylesheets only use theme tokens, and keep no colours of their own per mode', () => {
  const style = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const studio = fs.readFileSync(path.join(ROOT, 'studio.html'), 'utf8');
  for (const [file, src] of [['css/style.css', style], ['studio.html', studio]]) {
    const used = [...new Set([...src.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]))];
    const unknown = used.filter((n) => !Theme.names.includes(n));
    assert.deepEqual(unknown, [], file + ' uses tokens js/theme.js does not define');
  }
  assert.doesNotMatch(style, /^\s*--[a-z0-9-]+\s*:/m, 'css/style.css defines no custom properties (js/theme.js does)');
  assert.doesNotMatch(style, /prefers-color-scheme/, 'light/dark differences live in js/theme.js');
});

// ------------------------------------------------------------------ sprites

test('sprites: every tool, object and icon has a sprite', () => {
  for (const t of WB.TOOL_ORDER) {
    assert.ok(SPR.has('tool.' + t), 'tool.' + t);
    assert.ok(SPR.has('icon.' + t), 'icon.' + t);
  }
  for (const o of WB.OBJECT_ORDER) assert.ok(SPR.has('object.' + o), 'object.' + o);
  for (const n of ['piece.base', 'ui.pip', 'ui.stall']) assert.ok(SPR.has(n), n);
  for (const n of SPR.list()) {
    const s = SPR.get(n);
    assert.ok(['tool', 'object', 'icon', 'ui'].includes(s.group), n + ' group');
    assert.equal(typeof s.draw, 'function', n + ' draws');
    assert.ok(s.samples.length >= 1, n + ' has samples');
    for (const st of s.samples) {
      if (s.state) {
        const keys = s.state(st.o);
        assert.ok(Array.isArray(keys), n + ' state() returns a list');
        keys.forEach((k) => assert.ok(s.states.includes(k), n + ': state "' + k + '" is listed'));
      }
    }
  }
});

test('sprites: every pose draws in both modes with valid colours from known tokens', () => {
  const bad = [];
  const before = Theme.missing().length;
  for (const mode of ['light', 'dark']) {
    const prev = Theme.use(mode);
    try {
      for (const n of SPR.list()) {
        for (const st of SPR.get(n).samples) {
          for (const small of [false, true]) {
            const o = Object.assign({ px: 1 / 48, r: 6 }, st.o, SPR.get(n).group === 'object' ? { small } : {});
            const mark = bad.length;
            SPR.draw(n, mockContext(bad), o, 0.7);
            for (let i = mark; i < bad.length; i++) bad[i] = n + ' ' + (st.label || '') + ' (' + mode + '): ' + bad[i];
          }
        }
      }
    } finally {
      Theme.use(prev);
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(Theme.missing().length, before, 'no sprite asked for an unknown token: ' + Theme.missing().join(', '));
});

test('sprites: a draw-function override replaces the art and can call the built-in', () => {
  let calls = 0, baseCalled = false;
  try {
    assert.ok(SPR.override('object.fern', {
      draw(ctx, o, t, api) {
        calls++;
        assert.equal(typeof api.kit.P, 'function');
        assert.equal(typeof api.kit.rr, 'function');
        api.base(ctx, o, t);
        baseCalled = true;
      },
    }));
    const bad = [];
    SPR.draw('object.fern', mockContext(bad), { flow: 1, sway: 1, px: 0.02 }, 0.3);
    assert.equal(calls, 1);
    assert.ok(baseCalled);
    assert.deepEqual(bad, []);
    assert.equal(SPR.status().find((s) => s.name === 'object.fern').art, 'code');
  } finally {
    SPR.override('object.fern', null);
  }
  assert.equal(SPR.status().find((s) => s.name === 'object.fern').art, 'built-in');
});

test('sprites: bad overrides are refused, and images that cannot load keep the built-in art', () => {
  try {
    let r = quietly(() => SPR.override('object.nope', 'a.svg'));
    assert.equal(r.value, false);
    assert.ok(r.said.some((m) => m.includes('object.nope')));
    r = quietly(() => SPR.override('tool.fan', { src: 'a.svg', box: [0, 0, 1] }));
    assert.equal(r.value, false);
    assert.ok(r.said.some((m) => m.includes('box')));
    r = quietly(() => SPR.override('object.candle', { layers: [{ src: 'c.svg', states: { lit: 'c.svg', glowing: 'g.svg' } }] }));
    assert.ok(r.said.some((m) => m.includes('unknown state "glowing"')), 'unknown state names are reported');
    // there are no images in Node: the override reports the error and the built-in is drawn
    const st = SPR.status().find((s) => s.name === 'object.candle');
    assert.equal(st.state, 'error');
    assert.deepEqual(st.files, ['c.svg', 'c.svg', 'g.svg']);
    let drew = 0;
    const ctx = mockContext([]);
    const real = SPR.get('object.candle').draw;
    SPR.get('object.candle').draw = function () { drew++; return real.apply(this, arguments); };
    try { SPR.draw('object.candle', ctx, { lit: 1 }, 0); } finally { SPR.get('object.candle').draw = real; }
    assert.equal(drew, 1);
  } finally {
    quietly(() => { SPR.override('tool.fan', null); SPR.override('object.candle', null); });
  }
});

test('manifests: theme, sprites and textures, replaced by the next manifest', () => {
  try {
    quietly(() => SPR.manifest({
      note: 'test',
      theme: { light: { 't-curtain': '#aa00aa' } },
      sprites: { 'tool.curtain': { draw() {} } },
      textures: { floor: { src: 'f.svg', tiles: 2, alpha: 0.5 } },
    }));
    assert.equal(SPR.current().note, 'test');
    assert.equal(Theme.palette('light')['t-curtain'], '#aa00aa');
    assert.equal(SPR.status().find((s) => s.name === 'tool.curtain').art, 'code');
    const tx = SPR.textureInfo('floor');
    assert.equal(tx.src, 'f.svg');
    assert.equal(tx.tiles, 2);
    assert.equal(tx.alpha, 0.5);
    assert.equal(SPR.texture('floor'), null, 'not loaded (no images in Node)');
    SPR.manifest({});
    assert.equal(Theme.palette('light')['t-curtain'], Theme.defaults.light['t-curtain']);
    assert.equal(SPR.status().find((s) => s.name === 'tool.curtain').art, 'built-in');
    assert.equal(SPR.textureInfo('floor'), null);
  } finally {
    SPR.manifest({});
  }
});

test('art/art.js and art/examples/art.js are valid manifests', () => {
  for (const file of ['art/art.js', 'art/examples/art.js']) {
    let got = null;
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    new Function('WBArt', src)((m) => { got = m; });
    assert.ok(got && typeof got === 'object', file + ' calls WBArt({...})');
    for (const k of Object.keys(got)) assert.ok(['note', 'theme', 'sprites', 'textures'].includes(k), file + ': unknown section ' + k);
    for (const n of Object.keys(got.sprites || {})) assert.ok(SPR.has(n), file + ': no sprite ' + n);
    for (const n of Object.keys(got.textures || {})) assert.ok(SPR.textureNames.includes(n), file + ': no texture ' + n);
    const files = JSON.stringify(got).match(/art\/[\w/.-]+\.(svg|png|webp|jpg)/g) || [];
    for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), file + ': missing ' + f);
    const theme = got.theme || {};
    for (const mode of ['light', 'dark']) for (const k of Object.keys(theme[mode] || {})) assert.ok(Theme.names.includes(k), file + ': no token ' + k);
  }
});

// ------------------------------------------------------------------ gallery + visual tool

test('gallery rooms show every tool and every object', () => {
  const tools = new Set(), objects = new Set();
  for (const def of GALLERY) {
    const L = WB.parseLevel(def);
    L.objects.forEach((o) => objects.add(o.type));
    (def.fixed || []).concat(def.solution || []).forEach((p) => tools.add(p.type));
    assert.ok(Array.isArray(WB.simulate(L, L.fixed.concat(def.solution || [])).goals), def.name + ' simulates');
  }
  assert.deepEqual([...tools].sort(), WB.TOOL_ORDER.slice().sort());
  assert.deepEqual([...objects].sort(), WB.OBJECT_ORDER.slice().sort());
});

test('tools/visual.js lists its scenes without a browser', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/visual.js'), '--list'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const files = r.stdout.trim().split('\n');
  assert.ok(files.length >= 40);
  assert.ok(files.includes('gallery-tools.dark.phone.png'));
  assert.ok(files.every((f) => /^[a-z0-9-]+\.(light|dark)\.(phone|desktop)\.png$/.test(f)));
});
