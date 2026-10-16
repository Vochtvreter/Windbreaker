/*
 * Windbreaker art manifest — the game's art overrides. See GRAPHICS.md.
 *
 * Empty means the built-in art: every sprite is drawn in code (js/sprites.js)
 * with the colours of js/theme.js. Fill in any of the sections below to
 * change that; open studio.html to see every sprite, state and token while
 * you work, and `node tools/visual.js --compare` to see what changed.
 * A worked example lives in art/examples/art.js (try it: index.html?art=examples).
 *
 * Paths are relative to index.html, e.g. 'art/fan.svg'.
 */
WBArt({
  // note: 'what this art set is',

  // Colour tokens, per mode (a flat { token: value } sets both modes):
  // theme: {
  //   light: { 't-curtain': '#d97a86' },
  //   dark: { 't-curtain': '#e48d97' }
  // },

  // Sprites by name ('tool.fan', 'object.candle', 'ui.pip', ...): an image,
  // images per state, layers that spin, or a draw function.
  // sprites: {
  //   'object.candle': { src: 'art/candle.svg', states: { out: 'art/candle-out.svg' } },
  //   'tool.fan': { layers: [{ src: 'art/fan.svg' }, { src: 'art/fan-blades.svg', spin: true, box: [-0.3, -0.3, 0.6, 0.6] }] }
  // },

  // Repeating images over the garden, the floor or the walls:
  // textures: {
  //   floor: { src: 'art/floorboards.svg', tiles: 2, alpha: 0.6 }
  // }
});
