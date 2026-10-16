/*
 * Windbreaker art manifest: your changes to how the game looks. See GRAPHICS.md
 * ("Quick start for artists").
 *
 * Keep your changes here, not in js/: this one file survives game updates.
 * Empty sections mean the built-in art. Open studio.html to see every sprite,
 * state, colour and speed while you work: its "Download art.js" button writes
 * a complete copy of this file with your edits in it, to save over this one.
 *
 * Paths starting with art/ start from the game folder ('art/fan.svg'); any
 * other path is next to this file. After a change, reload the page. If nothing
 * seems to happen, look at the studio's "Art in use": it lists every mistake.
 *
 * A worked example of everything lives in art/examples/art.js (try it:
 * index.html?art=examples or studio.html?art=examples).
 */
WBArt({
  note: '',

  // Colours, per mode. Token names are in the studio's Tokens section.
  //   light: { 't-curtain': '#d97a86', floor: '#f3eadb' },
  //   dark: { 't-curtain': '#e48d97' }
  theme: {
    light: {},
    dark: {}
  },

  // Speeds and sizes (1 = as designed; 0.5 = half as fast or big):
  //   'spin-fan': 0.5, 'idle-speed': 0.8, 'object-scale': 1.1
  tuning: {},

  // Sprites by name ('tool.fan', 'object.candle', 'ui.pip', ...): an image,
  // images per state, layers that spin, or a draw function. For example:
  //   'object.candle': { src: 'art/candle.svg', states: { out: 'art/candle-out.svg' } },
  //   'tool.fan': { layers: [{ src: 'art/fan.svg' }, { src: 'art/fan-blades.svg', pivot: [50, 50] }] }
  sprites: {},

  // Repeating images over the garden, the floor or the walls:
  //   floor: { src: 'art/floorboards.svg', tiles: 2, alpha: 0.6 }
  textures: {}
});
