'use strict';
// Tests for the friendly parts of the UI that do not need a browser: the
// markup is there, player-facing words are plain, and every text size can
// grow with Settings → Text size. The browser side is in tools/e2e.js
// (section "friendly"). Run: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = require('../js/levels.js');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');

const COMPASS = /\b(north|east|south|west|inlet|outlet)s?\b/i;

test('ui: the friendly controls are in index.html', () => {
  for (const id of ['settings', 'set-sound', 'set-motion', 'set-guides', 'btn-reset-progress', 'btn-settings-home', 'btn-settings-foot',
    'btn-settings', 'help-settings', 'btn-howto', 'btn-undo', 'btn-redo', 'btn-reset', 'btn-hint', 'pmenu', 'pmenu-remove', 'goals-say']) {
    assert.match(html, new RegExp('id="' + id + '"'), '#' + id + ' is in index.html');
  }
  // Undo, Redo, Clear and Hint carry their words
  for (const [id, label] of [['btn-undo', 'Undo'], ['btn-redo', 'Redo'], ['btn-reset', 'Clear'], ['btn-hint', 'Hint']]) {
    const at = html.indexOf('id="' + id + '"');
    const end = html.indexOf('</button>', at);
    assert.match(html.slice(at, end), new RegExp('<span class="btn-label">' + label + '</span>'), id + ' is labelled "' + label + '"');
  }
  // reset progress lives in Settings, last, not on the home screen
  const settings = html.slice(html.indexOf('id="settings"'), html.indexOf('id="confirm"'));
  assert.match(settings, /id="btn-reset-progress"/, 'reset progress is in Settings');
  const home = html.slice(html.indexOf('id="home"'), html.indexOf('id="game"'));
  assert.doesNotMatch(home, /reset-progress|btn-sound/, 'no reset progress or bare sound button on the home screen');
  assert.ok(settings.lastIndexOf('set-row') < settings.indexOf('btn-reset-progress'), 'reset progress is the last setting');
});

test('ui: player-facing sentences in game.js use plain words (no compass words, no inlet/outlet)', () => {
  const sentences = [...game.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]).filter((t) => / /.test(t));
  assert.ok(sentences.length > 100, 'found the game\'s sentences (' + sentences.length + ')');
  const bad = sentences.filter((t) => COMPASS.test(t));
  assert.deepEqual(bad, [], 'sentences with compass words or inlet/outlet');
  // the same for Help, Settings and the rest of the page
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, COMPASS, 'index.html text');
});

test('ui: level tips are shown in screen words', () => {
  // the game's own plainTip(), taken from js/game.js
  const start = game.indexOf('  var SCREEN_SIDE = ');
  const end = game.indexOf('\n  }\n', game.indexOf('function plainTip', start)) + 4;
  assert.ok(start > 0 && end > start, 'plainTip() is in js/game.js');
  const plainTip = new Function(game.slice(start, end) + '\nreturn plainTip;')();
  assert.equal(plainTip('Wind blows from the west. Open a window on the far side.'), 'Wind blows from the left. Open a window on the other side.');
  for (const lv of DATA.levels) {
    if (!lv.tip) continue;
    assert.doesNotMatch(plainTip(lv.tip), /\b(north|east|south|west)(ern)?\b|far side/i, 'level ' + lv.id + ' tip as shown: "' + plainTip(lv.tip) + '"');
  }
});

test('ui: every text size is in rem, so Settings → Large text grows all of it', () => {
  const px = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => /^\d+(\.\d+)?px$/.test(v));
  assert.deepEqual(px, [], 'font sizes in px');
  assert.match(css, /html\.is-large-text\s*\{\s*font-size:\s*1\d\d%/, 'large text scales the root size');
  // less motion from Settings switches off CSS animation like the device setting does
  assert.match(css, /html\.motion-calm \*/, 'html.motion-calm calms every animation');
  assert.match(css, /html:not\(\.motion-full\)/, 'Settings can turn the device\'s reduced motion off again');
});
