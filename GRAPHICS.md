# Windbreaker graphics

How the game looks, where each part of that lives, and how to change it
without breaking anything. Everything here is plain static files, like the
rest of the game: no build step, no dependencies.

```
js/theme.js     tokens: every colour, light and dark  ──► CSS custom properties (the page)
                                                      └─► WBTheme.color()     (the canvas)
js/sprites.js   the sprite registry + the built-in art (tools, objects, icons, marks)
js/render.js    the board: garden, house, airflow, highlights; draws sprites
art/art.js      the art manifest: theme tweaks, sprite overrides, textures (empty = built-in)
studio.html     every sprite, state, token and a live board, light and dark side by side
tools/visual.js pixel-for-pixel visual regression check + drawing-time benchmark
```

Load order (index.html and studio.html): `js/theme.js` in `<head>` (so the page
never paints without its colours), then `js/engine.js`, `js/levels.js`,
`js/sprites.js`, `js/render.js`, `art/art.js`, `js/game.js`.

## 1. The theme: one table for the page and the canvas

`js/theme.js` holds every colour (and the font stack and shadows) as named
tokens, each with a light and a dark value and a note on what it is for:

| group | tokens | used by |
|---|---|---|
| Page and controls | `bg` `surface` `ink` `accent` `good` `bad` `scrim` `shadow` … | CSS; a few also mark the board |
| Garden and house | `garden` `floor` `wall` `wall-hi` `table` `house-shadow` … | the board's cached layers |
| Air and smoke | `air` `air-deep` `smoke` | streams, ripples, puffs |
| Tools | `piece-base` `glass` `t-fan` … `t-ceilingfan` | `tool.*` sprites |
| Objects | `o-coral` `o-flame` `o-leaf` `o-burner` … | `object.*` sprites |
| Board marks | `hl` `hl-edge` `hl-wall` `pip-idle` `mark` | highlights, pips, white marks |

The studio's Tokens section lists all of them with their notes.

**How the DOM and the canvas share it.** On load, theme.js writes the tokens
as CSS custom properties into `<style id="wb-theme">`: light values on `:root`,
dark values under `@media (prefers-color-scheme: dark)`, and either set when
`<html data-theme="light|dark">` forces a mode. `css/style.css` defines no
colours of its own. It only uses `var(--token)`, and it has no dark-mode
blocks. The canvas code reads the very same table with `WBTheme.color(name)`
(`P(name)` in the drawing code) for the mode the page is in. When the OS
switches mode, `data-theme` changes, or a token is set, theme.js rewrites the
CSS and tells its listeners, and the game repaints its board layers and icons.
A unit test fails if the stylesheet uses a token the theme lacks, or if any
sprite asks for one.

```js
WBTheme.color('wall')                      // current mode's value (the canvas hot path)
WBTheme.palette('dark')                    // { token: value } for a mode
WBTheme.set({ light: { wall: '#6b7380' } })  // or { wall: ... } for both modes; null removes
WBTheme.reset() / WBTheme.overrides()
WBTheme.setMode('dark' | 'light' | null)   // force the page's mode (null: follow the OS)
WBTheme.use('dark')                        // canvas only, until use(null): paint another mode
WBTheme.onChange(fn)                       // 'mode' or 'tokens'
WBTheme.mix(a, b, t), alpha(c, a), darker(c, t), lighter(c, t), parse(c), hex(c)
```

To change a colour for good, edit its row in `js/theme.js`. To try one out,
use the studio's token editor, then copy its output into `art/art.js`.

## 2. Sprites: the registry

Every tool, object, tray icon and status mark is a **sprite**: a named
drawing in the registry in `js/sprites.js`. The renderer composes the board
and asks the registry for each sprite. The tray, goal strip and help icons use
the same sprites, so one change shows up everywhere.

**Unit space.** Tool and object sprites draw around the origin, the centre of
their cell, with 1 unit = 1 tile (the renderer has already translated and
scaled). `o.px` is one CSS pixel in units, for minimum stroke widths. UI
sprites (`ui.*`) draw in CSS pixels.

| sprite | states | turns | options (`o`) |
|---|---|---|---|
| `piece.base` | `fixed` | — | the plinth under every floor tool; a house-owned one is part of the floor |
| `tool.window` | `inlet` `outlet` `inlet-fixed` `outlet-fixed` `fixed` | yes | `role`: inlet (faces the wind) or outlet; `outward`: the garden side. Art faces north (garden at the top). |
| `tool.fan` | `fixed` | yes | `d`: the way it blows (0 N, 1 E, 2 S, 3 W); `angle`: blade spin. Art blows north. |
| `tool.deflector` | — | yes | `d`: 0 = `/`, 1 = `\`. Art is drawn as `/`. |
| `tool.curtain` | — | — | `sway`: how far the hem swings (about -0.2..0.2) |
| `tool.vent` | `fixed` | yes | `horiz`: air passes left-right (false: up-down). Art lets air pass left-right. |
| `tool.splitter` | — | yes | `inDir`: the way the incoming air travels (null: none). Art: air travelling north, in at the bottom. |
| `tool.extractor` | `fixed` | yes | `angle`: rotor spin; `outward`: the garden side. Art faces north. |
| `tool.skylight` | — | — | |
| `tool.filter` | — | — | |
| `tool.ceilingfan` | `fixed` | — | `angle`: paddle spin |
| `object.pinwheel` | `still` `spinning` | — | `angle`: spin |
| `object.candle` | `lit` `out` | — | `lit`: 1 burning .. 0 blown out |
| `object.laundry` | `damp` `dry` `dirty` | — | `dry`, `soot` (smoky air reached it); `flow` swings it |
| `object.papers` | `calm` `flutter` `scattered` | — | `flutter`, `scatter` (blown away) |
| `object.fern` | `still` `swaying` `battered` | — | `sway`, `bend` (battered) |
| `object.stove` | `clear` `smoky` | — | the rising smoke is drawn by the board, not the sprite |
| `icon.<tool>` | — | — | tray and help icons, one per tool; drawn from `tool.<tool>`, except `icon.window`, a front view of its own |
| `ui.pip` | `happy` `bad` `dirty` `idle` | — | the status pip on each object; `r`: radius in px |
| `ui.stall` | `stalled` `quiet` | — | "no way out" mark where a stalled stream meets a wall; `r` in px |

Every object also gets `flow` (air reaching it), `dirx`/`diry` (unit vector
of that air), `small` (simpler shapes on small tiles) and `t`, the time in
seconds, for idle motion (flame flicker, laundry swing). Each sprite's
`samples` in sprites.js are the poses the studio shows and the tests draw.

```js
WBSprites.draw(name, ctx, o, t)     // the override if one is ready, else the built-in art
WBSprites.drawBuiltin(name, ctx, o, t)
WBSprites.define(name, spec)        // add or replace a built-in sprite (see the comment in sprites.js)
WBSprites.list(group) / get(name) / has(name) / status()
WBSprites.override(name, spec | null)
WBSprites.kit                       // P, mix, alpha, darker, lighter, rr, fillRR, circle, line, chevron, ...
WBSprites.onChange(fn)              // art changed or finished loading
```

**Not sprites.** These are drawn by `js/render.js` from tokens: the garden,
walls, floor and tables (add images with textures, below), the airflow streams,
wind streaks, smoke puffs, placement highlights, requirement meters, hint and
win effects.

## 3. The art manifest: `art/art.js`

`art/art.js` is loaded by the game and the studio. It calls `WBArt({...})`
with up to four sections. Left empty, the game uses the built-in art.
Paths are relative to the page, e.g. `'art/fan.svg'`. A worked example of
every kind of override is in `art/examples/art.js`: open
`index.html?art=examples` or `studio.html?art=examples` to see it. Any folder
`art/<name>/art.js` loads with `?art=<name>`.

```js
WBArt({
  note: 'Autumn set',
  theme: { light: { 't-curtain': '#c98bb9' }, dark: { 't-curtain': '#d7a0cb' } },
  sprites: { ... },
  textures: { ... }
});
```

### theme

Token values per mode. A flat `{ token: value }` sets both modes. Unknown
tokens are reported in the console and in the studio.

### sprites

Each entry overrides one sprite by name. The forms, from simplest up:

```js
'tool.skylight': 'art/skylight.svg',                    // one image filling the tile

'object.candle': {                                      // per-state images
  src: 'art/candle.svg',
  states: { out: 'art/candle-out.svg' }
},

'tool.fan': {                                           // layers, drawn in order
  layers: [
    { src: 'art/fan-body.svg' },
    { src: 'art/fan-blades.svg', spin: true, box: [-0.21, -0.19, 0.42, 0.42] }
  ]
},

'object.fern': {                                        // a draw function
  draw: function (ctx, o, t, api) {
    api.base(ctx, o, t);                                // the built-in art
    ctx.fillStyle = api.kit.P('bad');                   // theme colours, any mode
    // ... unit space, see section 2
  },
  images: ['art/ladybug.svg']                           // optional: preload, then api.image(ctx, src, x, y, w, h)
}
```

* **box** `[x, y, w, h]` is where an image goes, in tile units around the
  cell centre. The default is the whole tile, `[-0.5, -0.5, 1, 1]`. For
  `ui.pip` the unit is the pip radius (default box `[-1.3, -1.3, 2.6, 2.6]`),
  for `ui.stall` its size (`[-1, -1, 2, 2]`). It can be set per sprite or per
  layer.
* **states** maps state names (table above) to files. The most specific state
  that applies wins: a house-owned inlet window tries `inlet-fixed`, then
  `inlet`, then `fixed`, then `src`. A state mapped to `null` hides that layer.
* **turning**: draw directional art facing north (a window in the top wall, a
  fan blowing up, a deflector as `/`). The game turns it to the piece's
  direction. `rotate: false` keeps it upright.
* **spin: true** turns a layer around the centre of its box with the sprite's
  `angle` (fan blades, rotors, the pinwheel head), at the speed the air gives.
* **base: true** draws the built-in art underneath the images.
* Images are SVG or PNG. Give an SVG `width`, `height` and `viewBox`. Images
  are rasterised once at their on-screen size and cached. They look the same
  in light and dark mode; for mode-aware art, use a draw function with
  `api.kit.P(token)`.
* Until an image has loaded, and if it fails to load, the built-in art is
  drawn. The console and the studio's "Art in use" say why.
* The floor plinth under floor tools is its own sprite (`piece.base`). Tray
  icons follow `tool.*` overrides, except the window's front view
  (`icon.window`).

### textures

Repeating images laid over the `garden`, the `floor` or the walls (`wall`),
on top of their token colour:

```js
textures: {
  floor: { src: 'art/floorboards.svg', tiles: 2, alpha: 0.8 }   // the file covers 2 x 2 tiles
}
```

The floor and walls repeat from the house's top-left corner, the garden from
the canvas corner. Semi-transparent drawings over the token colour work in both
modes.

## 4. The studio: `studio.html`

Open `studio.html` next to `index.html` (from a file or any static server).
It uses the game's own theme, sprites, renderer and manifest:

* **Sprites**: every sprite in every sample pose, light and dark side by side
  (or one mode), at any tile size, animated. Badges show overrides and load
  errors.
* **Boards**: live boards of the gallery rooms (`tools/gallery.js`, every
  tool and object at once) or any level, with or without its solution.
* **Tokens**: every token with its note; edit any value and everything
  repaints. "Copy theme for art/art.js" gives the `theme` section to paste.
* **Art in use**: the manifest's overrides and textures, their files and
  whether they loaded.

`studio.html?art=<name>` previews `art/<name>/art.js`.

## 5. Checking a change: `tools/visual.js`

A graphics change should change exactly what you meant it to. The visual
check renders 58 pictures (light and dark, phone and desktop) of the home
screen, levels, the gallery rooms, a hint, the help sheet, a win, reduced
motion and the example art. Then it compares them pixel by pixel with a
baseline. It needs Playwright with Chromium (like `npm run e2e`).

```sh
node tools/visual.js --baseline --from HEAD   # reference: the last commit, rules and levels included
node tools/visual.js --compare                # the working tree vs the reference (npm run visual)
node tools/visual.js --perf                   # board drawing time on the busiest scenes
```

* Every picture is drawn at a frozen moment (`window.__wbFreezeTime`, a test
  hook in render.js). Eased values are settled and the wind streaks and spin
  angles come from a fixed seed. CSS transitions are off and CSS animations
  finished, so the same code gives the same pixels on every run.
* The baseline pins its own copy of `js/engine.js` and `js/levels.js`, so
  level and rule edits never show up as graphics changes (`--live` uses
  today's).
* `screenshots/gfx/diff/` shows changed pixels in magenta over a faded copy.
  The run fails when a picture changes more than `--tolerance` (0.05% by
  default), when there is no baseline, or when the page logs an error. A scene
  added since the baseline is listed as new.
* `--only gallery,calm` picks scenes, `--threshold 8` ignores tiny colour
  shifts, `--headed` shows the browser, `--list` lists the pictures.

When this graphics system was introduced, the refactor was checked this way:
all 54 pictures of the game before it were pixel-identical after it, and
drawing time was unchanged (about 1.1 ms per frame on the busiest level).

## 6. Recipes

* **Recolour a tool**: change its `t-*` token in `js/theme.js` (or in the
  manifest's `theme`), then `node tools/visual.js --compare` and look at
  `screenshots/gfx/diff/`.
* **Hand-drawn objects**: draw each object at 100 × 100 in its states, list
  them under `sprites` with `states`, and check them in the studio at small
  and large tile sizes.
* **A new sprite** (e.g. for a new tool): `WBSprites.define('tool.x', { group:
  'tool', draw, states, state, turn, samples, note })` in `js/sprites.js`. The
  renderer draws `tool.<type>` for every piece, and the studio and the tests
  pick it up from the registry.
* **A new colour**: add a row to its group in `js/theme.js` (light, dark,
  note). It becomes `var(--name)` in CSS and `P('name')` on the canvas.
