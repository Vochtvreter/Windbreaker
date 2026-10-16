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
  const saved = { warn: console.warn, error: console.error, info: console.info };
  const said = [];
  console.warn = console.error = console.info = (m) => said.push(String(m));
  try { return { value: fn(), said }; } finally { Object.assign(console, saved); }
}

// A 2D context that records what is drawn: images (by src), transforms, alpha.
function recorder() {
  const log = { images: [], translates: [], depth: 0, maxDepth: 0, alphas: [] };
  const ctx = {
    globalAlpha: 1,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    save() { log.depth++; log.maxDepth = Math.max(log.maxDepth, log.depth); },
    restore() { log.depth--; },
    translate(x, y) { log.translates.push([x, y]); },
    drawImage(img, x, y, w, h) { log.images.push({ src: img.src, x, y, w, h, alpha: ctx.globalAlpha }); },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 }),
  };
  return { ctx: new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => {}) }), log };
}
// fake loaded images (Node has none): src -> an image the recorder can name
function fake(...srcs) { srcs.forEach((src) => SPR.fakeImage(src, 100, 100)); }
// an override's files settle synchronously in Node (fake images, or "no images here")
function settle() { return new Promise((ok) => setTimeout(ok, 5)); }


// ------------------------------------------------------------------ theme

test('theme: every token has a light and a dark value, names are unique', () => {
  assert.equal(new Set(Theme.names).size, Theme.names.length);
  const grouped = Theme.groups.flatMap((g) => g.tokens.map((t) => t.name));
  assert.deepEqual(grouped, Theme.names);
  for (const name of Theme.names) {
    const t = Theme.info(name);
    assert.ok(t.light && t.dark, name + ' has both values');
    assert.ok(t.note, name + ' says what it is for');
    assert.ok(['color', 'font', 'shadow'].includes(t.kind), name + ' has a kind');
    if (t.kind === 'color') {
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
  // no colour literals either (mask gradients only use black as "opaque")
  const literals = [...style.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/gi)]
    .map((m) => m[0]).filter((c) => c !== '#000');
  assert.deepEqual(literals, [], 'css/style.css uses theme tokens for every colour');
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
    for (const k of Object.keys(got)) assert.ok(['note', 'theme', 'tuning', 'sprites', 'textures'].includes(k), file + ': unknown section ' + k);
    for (const k of Object.keys(got.tuning || {})) assert.ok(Theme.tuningNames.includes(k), file + ': no tuning ' + k);
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
  assert.ok(files.every((f) => /^[a-z0-9-]+\.(light|dark)\.(phone|desktop|laptop|laptop-short)\.png$/.test(f)));
  // the short wide screens of a zoomed-in laptop are covered too
  assert.ok(files.includes('guide-card.light.laptop.png') && files.includes('first-steps.light.laptop-short.png'));
});

// ------------------------------------------------------------------ art mistakes (the studio's "Art in use")

test('theme: values that are not colours are reported and skipped; #rgba and hsl() parse', () => {
  try {
    const r = quietly(() => Theme.set({ 't-fan': 'reddish', wall: '#12345', light: { floor: 'hsl(0, 100%, 45%)', 't-vent': '#f00a' } }, true));
    assert.equal(Theme.palette('light')['t-fan'], Theme.defaults.light['t-fan'], 'reddish is ignored');
    assert.equal(Theme.palette('dark').wall, Theme.defaults.dark.wall, '#12345 is ignored');
    assert.equal(Theme.palette('light').floor, 'hsl(0, 100%, 45%)');
    assert.ok(r.said.some((m) => m.includes('"reddish" is not a colour')));
    assert.ok(Theme.problems().some((p) => p.token === 't-fan' && p.value === 'reddish'));
    assert.deepEqual(Theme.parse('#f00a').map((v) => +v.toFixed(3)), [255, 0, 0, 0.667]);
    assert.deepEqual(Theme.parse('hsl(0, 100%, 45%)'), [230, 0, 0, 1]);
    assert.equal(Theme.alpha('#f00a', 0.5), 'rgba(255,0,0,0.333)');
    assert.ok(Theme.isColor('#f00a') && Theme.isColor('hsla(120, 50%, 50%, 0.5)') && !Theme.isColor('reddish'));
    assert.equal(Theme.check('font', "'Comic Sans MS', cursive"), "'Comic Sans MS', cursive");
  } finally {
    Theme.reset(true);
    Theme.clearProblems();
  }
});

test('theme: flat values set both modes, per-mode ones win; an unknown token is said once', () => {
  try {
    const r = quietly(() => Theme.set({ 't-fan': '#ff0000', dark: { 't-fan': '#00ff00', flor: '#000' }, light: { flor: '#fff' } }, true));
    assert.equal(Theme.palette('light')['t-fan'], '#ff0000');
    assert.equal(Theme.palette('dark')['t-fan'], '#00ff00');
    assert.equal(r.said.filter((m) => m.includes('"flor"')).length, 1);
    assert.ok(r.said.some((m) => m.includes('did you mean "floor"?')));
  } finally {
    Theme.reset(true);
    Theme.clearProblems();
  }
});

test('tuning: defaults, setTuning, ranges, unknown names, manifests', () => {
  try {
    for (const n of Theme.tuningNames) assert.equal(Theme.num(n), Theme.tuningInfo(n).value, n + ' starts at its default');
    assert.equal(Theme.num('spin-fan'), 1);
    assert.equal(Theme.num('max-tile'), 84);
    const r = quietly(() => Theme.setTuning({ 'spin-fan': 0.5, 'object-scale': 9, 'idle-speed': 'fast', 'spin-fna': 2 }, true));
    assert.equal(Theme.num('spin-fan'), 0.5);
    assert.equal(Theme.num('object-scale'), 1.5, 'clamped to its range');
    assert.equal(Theme.num('idle-speed'), 1, 'not a number: ignored');
    assert.ok(r.said.some((m) => m.includes('did you mean "spin-fan"?')));
    quietly(() => SPR.manifest({ tuning: { 'pip-size': 1.5 } }));
    assert.deepEqual(Theme.tuningOverrides(), { 'pip-size': 1.5 }, 'a manifest replaces the tuning');
  } finally {
    quietly(() => SPR.manifest({}));
    Theme.clearProblems();
  }
  assert.deepEqual(Theme.tuningOverrides(), {});
});

test('sprites: a draw function that throws is switched off and the built-in art is drawn', async () => {
  try {
    let calls = 0;
    SPR.override('object.pinwheel', { draw(ctx) { calls++; ctx.save(); return undefinedVariable; } }); // eslint-disable-line no-undef
    await settle();
    const { ctx, log } = recorder();
    const real = SPR.get('object.pinwheel').draw;
    let builtin = 0;
    SPR.get('object.pinwheel').draw = function () { builtin++; return real.apply(this, arguments); };
    let r;
    try {
      r = quietly(() => {
        assert.doesNotThrow(() => SPR.draw('object.pinwheel', ctx, { flow: 1, px: 0.02 }, 0));
        SPR.draw('object.pinwheel', ctx, { flow: 1, px: 0.02 }, 0);
      });
    } finally { SPR.get('object.pinwheel').draw = real; }
    assert.equal(calls, 1, 'not called again after it failed');
    assert.equal(builtin, 2, 'the built-in art is drawn instead, both times');
    assert.equal(log.depth, 1, 'only the save() the failed function made itself is left over');
    const st = SPR.status().find((s) => s.name === 'object.pinwheel');
    assert.equal(st.state, 'error');
    assert.match(st.error, /undefinedVariable/);
    assert.ok(r.said.some((m) => m.includes('object.pinwheel') && m.includes('undefinedVariable')));
    assert.ok(SPR.problems().some((p) => p.level === 'error' && p.sprite === 'object.pinwheel'));
  } finally {
    quietly(() => SPR.manifest({}));
  }
});

test('sprites: states without a picture (and no src) keep the built-in art', async () => {
  try {
    fake('t/out.svg');
    const r = quietly(() => SPR.override('object.candle', { states: { out: 't/out.svg' } }));
    assert.ok(r.said.some((m) => m.includes('no src, so lit keeps the built-in art')));
    await settle();
    assert.equal(SPR.status().find((s) => s.name === 'object.candle').state, 'ready');
    const lit = recorder(), out = recorder();
    SPR.draw('object.candle', mockContext([]), { lit: 1, px: 0.02 }, 0); // the built-in draws (valid colours)
    SPR.draw('object.candle', lit.ctx, { lit: 1, px: 0.02 }, 0);
    SPR.draw('object.candle', out.ctx, { lit: 0, px: 0.02 }, 0);
    assert.equal(lit.log.images.length, 0, 'lit: no picture, so the built-in art');
    assert.ok(lit.log.maxDepth > 1, 'lit: the built-in art drew');
    assert.deepEqual(out.log.images.map((i) => i.src), ['t/out.svg']);
  } finally {
    quietly(() => SPR.manifest({}));
  }
});

test('sprites: a missing file only loses its own state; dark twins; icon state; pivot; fade', async () => {
  try {
    fake('t/candle.svg', 't/candle-dark.svg', 't/head.svg', 't/stick.svg', 't/lit.svg', 't/out2.svg', 't/icon.svg');
    quietly(() => {
      SPR.override('object.candle', { src: { src: 't/candle.svg', dark: 't/candle-dark.svg' }, states: { out: 't/no-such-file.svg', icon: 't/icon.svg' } });
      SPR.override('object.pinwheel', { layers: [{ src: 't/stick.svg' }, { src: 't/head.svg', pivot: [50, 40], box: [-0.5, -0.5, 1, 1] }] });
      SPR.override('object.fern', { src: 't/lit.svg', states: { battered: 't/out2.svg' }, fade: true });
    });
    await settle();
    const st = SPR.status().find((s) => s.name === 'object.candle');
    assert.equal(st.state, 'partial');
    assert.match(st.error, /1 of 4 files missing: could not load t\/no-such-file.svg/);
    let rec = recorder();
    SPR.draw('object.candle', rec.ctx, { lit: 1 }, 0);
    assert.deepEqual(rec.log.images.map((i) => i.src), ['t/candle.svg'], 'the picture that loaded is drawn');
    rec = recorder();
    SPR.draw('object.candle', rec.ctx, { lit: 0 }, 0);
    assert.deepEqual(rec.log.images.map((i) => i.src), [], 'its missing state: the built-in art');
    const prev = Theme.use('dark');
    try {
      rec = recorder();
      SPR.draw('object.candle', rec.ctx, { lit: 1 }, 0);
      assert.deepEqual(rec.log.images.map((i) => i.src), ['t/candle-dark.svg'], 'dark mode uses the dark twin');
    } finally { Theme.use(prev); }
    rec = recorder();
    SPR.draw('object.candle', rec.ctx, { lit: 0, icon: true }, 0);
    assert.deepEqual(rec.log.images.map((i) => i.src), ['t/icon.svg'], 'icons use the icon state');
    // the pinwheel head turns around its pivot: (50, 40) of a 100 x 100 picture in the tile
    rec = recorder();
    SPR.draw('object.pinwheel', rec.ctx, { flow: 1, angle: 1 }, 0);
    assert.deepEqual(rec.log.translates.map((p) => p.map((v) => +v.toFixed(6))), [[0, -0.1]]);
    assert.deepEqual(rec.log.images.map((i) => [i.src, +i.x.toFixed(6), +i.y.toFixed(6)]), [['t/stick.svg', -0.5, -0.5], ['t/head.svg', -0.5, -0.4]]);
    // fade: halfway from swaying to battered, both pictures are drawn
    rec = recorder();
    SPR.draw('object.fern', rec.ctx, { sway: 1, bend: 0.5 }, 0);
    assert.deepEqual(rec.log.images.map((i) => [i.src, i.alpha]), [['t/lit.svg', 1], ['t/out2.svg', 1]]);
    rec = recorder();
    SPR.draw('object.fern', rec.ctx, { sway: 1, bend: 0.25 }, 0);
    assert.deepEqual(rec.log.images.map((i) => [i.src, i.alpha]), [['t/lit.svg', 1], ['t/out2.svg', 0.5]]);
  } finally {
    quietly(() => SPR.manifest({}));
  }
});

test('every object has an icon state, and icons fall back to the happy state', () => {
  const happy = { pinwheel: 'spinning', candle: 'lit', laundry: 'dry', papers: 'calm', fern: 'swaying', stove: 'clear' };
  for (const o of WB.OBJECT_ORDER) {
    const s = SPR.get('object.' + o);
    assert.ok(s.states.includes('icon'), o + ' has an icon state');
    assert.deepEqual(s.state({ icon: true }), ['icon', happy[o]], o);
    assert.ok(s.states.every((k) => s.stateNotes && s.stateNotes[k]), o + ': every state is explained');
  }
});

test('manifests: misspelt names are reported with a suggestion', () => {
  try {
    quietly(() => SPR.manifest({ sprite: {}, sprites: { 'object.pinwhel': 'x.svg', fan: 'x.svg', 'object.candle': { src: 'c.svg', states: { 'blown out': 'o.svg' } } }, textures: { flor: 'f.svg' } }));
    const texts = SPR.problems().map((p) => p.text);
    for (const want of ['no section "sprite"', 'did you mean "sprites"?', 'did you mean "object.pinwheel"?', 'did you mean "tool.fan"?',
      'unknown state "blown out" (did you mean "out"?)', 'no texture "flor" (did you mean "floor"?)']) {
      assert.ok(texts.some((t) => t.includes(want)), want + ' in ' + JSON.stringify(texts));
    }
    quietly(() => SPR.manifest({}));
    assert.deepEqual(SPR.problems(), [], 'the next manifest starts with a clean list');
  } finally {
    quietly(() => SPR.manifest({}));
  }
});
