/*
 * An example art manifest: one of each kind of override. See GRAPHICS.md.
 *
 * Try it in the game with index.html?art=examples (any art/<name>/art.js loads
 * with ?art=<name>), or in studio.html?art=examples. To use it for real, copy
 * what you like into art/art.js.
 */
WBArt({
  note: 'Examples: layered and spinning images, per-state images, a draw function, a texture and theme tweaks.',

  // Colour tokens (js/theme.js). Per mode; a flat { token: value } sets both.
  theme: {
    light: { 't-curtain': '#c98bb9', garden: '#e1e8d0' },
    dark: { 't-curtain': '#d7a0cb' }
  },

  sprites: {
    // Two layers in one tile: the stick stays put, the head spins (around the
    // centre of its own box) as fast as the breeze turns it.
    'object.pinwheel': {
      layers: [
        { src: 'art/examples/pinwheel-stick.svg' },
        { src: 'art/examples/pinwheel-head.svg', spin: true, box: [-0.33, -0.36, 0.66, 0.66] }
      ]
    },

    // States: the flame layer becomes a curl of smoke once the candle is
    // blown out ("lit" / "out"; the studio lists every sprite's states).
    'object.candle': {
      layers: [
        { src: 'art/examples/candle.svg' },
        { src: 'art/examples/candle-flame.svg', states: { out: 'art/examples/candle-smoke.svg' } }
      ]
    },

    // Art faces north; the game turns it the way the fan blows (rotate: false
    // would keep it upright). The blades spin around their box's centre.
    'tool.fan': {
      layers: [
        { src: 'art/examples/fan-body.svg' },
        { src: 'art/examples/fan-blades.svg', spin: true, box: [-0.21, -0.19, 0.42, 0.42] }
      ]
    },

    // A draw function: the built-in fern (api.base) plus a ladybug that
    // flies off in a gale. Colours come from the theme through api.kit.P.
    'object.fern': {
      draw: function (ctx, o, t, api) {
        api.base(ctx, o, t);
        if (o.bend > 0.5) return;
        var k = api.kit, x = 0.13, y = -0.07 + Math.sin(t * 1.3) * 0.008;
        ctx.beginPath(); k.circle(ctx, x, y, 0.048);
        ctx.fillStyle = k.P('bad'); ctx.fill();
        ctx.beginPath(); k.line(ctx, x, y - 0.048, x, y + 0.048);
        k.circle(ctx, x - 0.02, y - 0.006, 0.01); k.circle(ctx, x + 0.022, y + 0.016, 0.01);
        ctx.strokeStyle = ctx.fillStyle = k.P('o-grate');
        ctx.lineWidth = 0.008; ctx.stroke(); ctx.fill();
      }
    }
  },

  // A repeating image over the floor: the file covers 2 x 2 tiles.
  textures: {
    floor: { src: 'art/examples/floorboards.svg', tiles: 2 }
  }
});
