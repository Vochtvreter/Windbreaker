# Windbreaker graphics

How the game looks, and how to change it: colours, speeds and sizes, and your
own drawings for any tool or object. No programming needed for most of it,
and no build step: everything is plain files.

* **Artists**: start with the quick start below. You need a text editor and a
  browser.
* **Programmers**: the [appendix](#for-programmers) explains how the theme,
  the sprite registry and the visual check work.

## Quick start for artists

**Your work goes in one file: `art/art.js`.** It starts out empty, which
means "the built-in art". Everything you change (colours, speeds, drawings)
goes there, so it survives game updates. You never need to edit anything in
`js/`.

**Your workbench is `studio.html`.** Open it in a browser, next to
`index.html`. Double-clicking it works. A few extra checks, such as which page
elements use a colour and whether your SVGs have a size, need it served instead:
`npm run serve`, then open <http://localhost:8080/studio.html>. The studio
shows every sprite in every state, live boards, every colour and every speed,
in light and dark mode side by side. Its **Art in use** section lists every
mistake it finds in your `art.js`, with a hint.

### 1. Recolour things

1. In the studio, go to **Colours**. Type in the search box what you want to
   change ("fan", "wall", "air"). Each colour says what it is used for.
2. Click a swatch to pick a colour, or type one into the box next to it. The
   sprites, the boards and the preview repaint as you go. The light and dark
   columns are separate: check both.
3. Click **Download art.js** and save it over `art/art.js` (the file name it
   shows). The download is a complete `art.js`: it keeps everything already in
   yours, including drawings and textures. (While your `art.js` has a typo,
   the studio cannot read it and will not download; fix the typo first.)
4. Reload the game.

Your edits are kept in that browser until you save them. If you close the
studio first, it offers them back the next time.

To recolour the airflow, change `air`, `air-deep` and `streak` together: the
garden's wind streaks mix `streak` with `air`.

Colours can be written `#e2898b`, `#e2898b80` (with transparency), `#f00`,
`rgb(226, 137, 139)`, `rgba(0, 0, 0, 0.2)`, `hsl(0, 60%, 70%)` or a CSS colour
name like `tomato`. A value that is not a colour is ignored and listed under
**Art in use**.

### 2. Replace an object or a tool with your own drawings

1. Draw it. A square of 100 × 100 is the tile; leave a little margin, like the
   built-in art. Use SVG (with `width="100" height="100" viewBox="0 0 100 100"`
   on the `<svg>` line) or PNG (at least 200 × 200 for sharp phones).
2. Make one file per **state** you want to change. The [sprite table](#sprites-and-their-states)
   lists the states. For example, a candle is `lit` (happy) or `out` (blown out,
   unhappy). In the studio, the state name is shown under each picture after
   the dot: "blown out · `out`".
3. Put the files in a folder of your own, such as `art/mine/`.
4. List them in the `sprites` section of `art/art.js`:

   ```js
   sprites: {
     'object.candle': {
       src: 'art/mine/candle.svg',                  // every state without its own picture
       states: { out: 'art/mine/candle-out.svg' }   // the blown-out candle
     },
     'tool.skylight': 'art/mine/skylight.svg'       // one picture for everything
   },
   ```

5. Reload the studio and look at the sprite's card. A state you did not draw,
   with no `src` either, keeps the built-in art.

Things to know:

* **Directional tools face north.** Draw a window in the top wall, a fan
  blowing up, a deflector as `/`. The game turns them. Add `rotate: false` to
  keep a drawing upright.
* **The goal strip and the help sheet** show each object in its `icon` state.
  If you do not draw one, they use the happy state (a spinning pinwheel, a lit
  candle).
* **States switch at the halfway point.** A candle shows `out` once it is more
  than half blown out. Add `fade: true` to crossfade between your pictures
  instead.
* **Dark mode**: a picture can have a dark-mode twin: `{ src:
  'art/mine/candle.svg', dark: 'art/mine/candle-dark.svg' }`. This works anywhere a
  file name goes.
* **The plinth** under floor tools is its own sprite, `piece.base`. To keep
  the built-in art under your picture, add `base: true`.

### 3. Parts that spin

A fan's blades, an extractor's rotor and a pinwheel's head can turn. Draw
them as their own picture on the same 100 × 100 tile as the body, then make
it a spinning layer with its **pivot**: the point it turns around, in the
drawing's own pixels:

```js
'object.pinwheel': {
  layers: [
    { src: 'art/mine/pinwheel-stick.svg' },
    { src: 'art/mine/pinwheel-head.svg', pivot: [50, 40] }   // turns around (50, 40)
  ]
}
```

`spin: 0.5` turns that layer at half the speed, and `spin: -1` turns it the
other way. In the studio, tick **Tile and boxes**. It draws the tile edge,
its centre, each layer's box and the pivot as a cross, so you can check that
the head turns where you meant.

### 4. Change speeds and sizes

Everything that moves and a few sizes are numbers in the `tuning` section.
1 is the speed the game was designed with, 0.5 half as fast and 0 stopped.
The studio's **Speeds and sizes** section has a slider for each one.

```js
tuning: {
  'spin-fan': 0.5,        // fans turn at half speed
  'idle-speed': 0.7,      // calmer flames, laundry and ferns
  'object-scale': 1.1     // objects 10% bigger
}
```

The [tuning table](#tuning) lists them all.

### 5. See it in the game

Levels open one by one, so add `?unlock` to open every level, and `#` with a
level number to go straight to it:

* `index.html?unlock#100`: level 100, with every kind of object.
* `index.html?unlock&art=mine#12`: level 12 with the art set in
  `art/mine/art.js` (see [art sets](#art-sets-artnameartjs)).

`?unlock` keeps its own progress, so your real game is not touched. In the
studio's **Boards**, pick any level; the link next to it opens that level in
the game, with the art set you are looking at. The list also shows which
objects each level has. This is where each thing first appears:

| first level | objects | tools |
|---|---|---|
| 1 | pinwheel | window |
| 6 | candle | |
| 11 | | fan |
| 16 | stove | |
| 21 | | deflector |
| 26 | laundry | |
| 31 | | curtain |
| 36 | papers | |
| 41 | | vent |
| 46 | fern | |
| 51, 56, 61, 66, 71 | | splitter, extractor, skylight, filter, ceiling fan |

### 6. Check that nothing else changed (optional)

`tools/visual.js` takes pictures of the game and compares them pixel by pixel.
It needs Node and Playwright with Chromium, like `npm run e2e`. The loop is:

1. **Before you change anything**: `node tools/visual.js --baseline`. This is
   the "before" set of pictures.
2. Make your changes.
3. `node tools/visual.js --compare`. It lists every picture that changed.
4. Open `screenshots/gfx/review.html`. It shows every picture before | after |
   with the changed pixels in magenta.
5. If every change is one you meant, accept them as the new "before":
   `node tools/visual.js --baseline`.

The [appendix](#the-visual-check-toolsvisualjs) has the options.

### When something doesn't show up

Look at **Art in use** in the studio first. It lists every problem with a
hint, and a red box at the top of the studio means something is not shown.
The game's browser console (F12) says the same. The usual causes:

* **A typo in `art.js`** ("has a mistake on line 4"). Usually there is a missing
  comma at the end of the line before: every entry but the last ends with `,`.
  Or a quote or a bracket is not closed. Quotes must be straight (`'` or `"`),
  not the curly ones a word processor makes. While `art.js` has a typo, the
  whole file is skipped and the game uses the built-in art.
* **A file that does not load.** Check the folder, the name and the capitals:
  `Candle.svg` is not `candle.svg`. A path that starts with `art/` starts from
  the game folder. Any other path is next to the `art.js` it is in.
* **A misspelt name** (a token, a sprite, a state, a section). The studio
  suggests the closest real one ("did you mean object.pinwheel?").
* **A state name from the studio's label** instead of the state:
  `'blown out'` instead of `out`.
* **Nothing changed at all.** Reload the page. A browser can keep an old
  `art.js` for a while: reload with Shift held down.

## Reference: `art/art.js`

`art/art.js` calls `WBArt({ ... })` with up to five sections:

```js
WBArt({
  note: 'Autumn set',                       // shown in the studio
  theme: { light: { ... }, dark: { ... } }, // colours
  tuning: { ... },                          // speeds and sizes
  sprites: { ... },                         // drawings
  textures: { ... }                         // repeating images over floor, walls, garden
});
```

Empty sections mean the built-in art. A worked example of everything is in
`art/examples/art.js`. See it with `index.html?art=examples` or
`studio.html?art=examples`.

### theme

```js
theme: {
  light: { 't-curtain': '#c98bb9', floor: '#f3eadb' },
  dark: { 't-curtain': '#d7a0cb' }
}
```

A flat `{ token: value }` (outside `light`/`dark`) sets both modes; values
under `light`/`dark` then win for their mode. The studio's Colours section
lists every token, what it colours and where it is used (`js/theme.js` has the
same table). Colour formats: see [Recolour things](#1-recolour-things).

### tuning

| name | default | what it changes |
|---|---|---|
| `spin-fan` | 1 | fan blades (they also turn faster the more air goes through) |
| `spin-extractor` | 1 | extractor rotors |
| `spin-ceilingfan` | 1 | ceiling fan paddles |
| `spin-pinwheel` | 1 | pinwheels |
| `flow-speed` | 1 | the streaks travelling along the airflow, and smoke puffs |
| `wind-speed` | 1 | the wind streaks drifting across the garden |
| `idle-speed` | 1 | flame flicker, laundry and fern swing, curtain sway, fluttering papers, stove glow |
| `win-boost` | 1 | the burst of extra spin and flow when a level is solved (0: none) |
| `object-scale` | 1 | the size of objects on their tile (0.5 to 1.5) |
| `stream-width` | 1 | how thick the airflow streams are |
| `pip-size` | 1 | the status pip on each object |
| `max-tile` | 84 | the largest a tile gets on big screens, in CSS pixels |

Speeds go from 0 to 4 (`win-boost` to 3). A number outside a range is moved
into it, and the studio lists it as a problem.

### sprites

Each entry replaces one sprite, by name. The forms, from simplest up:

```js
'tool.skylight': 'art/mine/skylight.svg',            // one picture

'object.candle': {                                   // a picture per state
  src: 'art/mine/candle.svg',
  states: { out: 'art/mine/candle-out.svg' },
  fade: true
},

'tool.fan': {                                        // layers, drawn in order
  layers: [
    { src: 'art/mine/fan-body.svg' },
    { src: 'art/mine/fan-blades.svg', pivot: [50, 50] }
  ]
},

'object.fern': {                                     // a draw function (JavaScript)
  draw: function (ctx, o, t, api) {
    api.base(ctx, o, t);                             // the built-in fern
    ctx.fillStyle = api.kit.P('bad');                // a theme colour, light or dark
    // ... unit space: see the appendix
  },
  images: ['art/mine/ladybug.svg']                   // preload; then api.image(ctx, src, x, y, w, h)
}
```

| option | where | what it does |
|---|---|---|
| `src` | sprite, layer | the picture for every state without its own |
| `dark` | sprite, layer, or `{ src, dark }` anywhere a file goes | the picture used in dark mode |
| `states` | sprite, layer | `{ state: file }`. A state mapped to `null` hides that layer. The most specific state wins: a house-owned inlet window tries `inlet-fixed`, then `inlet`, then `fixed`, then `src`. |
| `layers` | sprite | pictures drawn on top of each other, each with its own options |
| `box` | sprite, layer | `[x, y, w, h]`: where the picture goes, in tiles around the cell's centre. The default is the whole tile, `[-0.5, -0.5, 1, 1]`. For `ui.pip` the unit is the pip's radius (default `[-1.3, -1.3, 2.6, 2.6]`), for `ui.stall` its size (`[-1, -1, 2, 2]`). |
| `pivot` | layer | `[x, y]` in the picture's own pixels: the layer spins around that point |
| `spin` | layer | `true` spins around the box's centre (or the pivot) as fast as the air turns it. A number is a speed: `0.5`, `-1`. |
| `rotate` | sprite | `false` keeps directional art upright instead of turning it with the piece |
| `base` | sprite | `true` draws the built-in art under the pictures |
| `fade` | sprite | `true` crossfades between states instead of switching at the halfway point |
| `draw` | sprite | a function that draws the sprite itself (see the appendix) |
| `images` | sprite | files a draw function uses, loaded first |

Until a picture has loaded, and if it cannot load, the built-in art is drawn
in its place. If some files of a sprite load and others do not, the ones that
loaded are shown. A draw function that fails is switched off, and the
built-in art is shown. Pictures are drawn once at their on-screen size and
cached, so big SVGs cost nothing per frame.

### Sprites and their states

| sprite | states (happy / unhappy) | turns | notes |
|---|---|---|---|
| `piece.base` | `fixed` | — | the plinth under every floor tool; a house-owned one is part of the floor |
| `tool.window` | `inlet` `outlet` `inlet-fixed` `outlet-fixed` `fixed` | yes | inlet: faces the wind. Faces north (garden at the top). |
| `tool.fan` | `fixed` | yes | blows north |
| `tool.deflector` | — | yes | drawn as `/` |
| `tool.curtain` | — | — | the hem sways in a breeze (built-in art only) |
| `tool.vent` | `fixed` | yes | lets air pass left-right |
| `tool.splitter` | — | yes | air travelling north, in at the bottom |
| `tool.extractor` | `fixed` | yes | faces north |
| `tool.skylight` | — | — | a roof window seen from below |
| `tool.filter` | — | — | |
| `tool.ceilingfan` | `fixed` | — | the paddles spin |
| `object.pinwheel` | `still` (waiting) / `spinning` (happy) · `icon` | — | the head spins |
| `object.candle` | `lit` (happy) / `out` (unhappy) · `icon` | — | |
| `object.laundry` | `damp` (waiting) / `dry` (happy) / `dirty` (smoky air: unhappy) · `icon` | — | |
| `object.papers` | `calm`, `flutter` (both happy) / `scattered` (unhappy) · `icon` | — | |
| `object.fern` | `still` (waiting) / `swaying` (happy) / `battered` (unhappy) · `icon` | — | |
| `object.stove` | `clear` (happy) / `smoky` (unhappy) · `icon` | — | its rising smoke is drawn by the board |
| `icon.<tool>` | — | — | tray and help icons. They follow your `tool.*` pictures, except `icon.window`, a front view of its own. |
| `ui.pip` | `happy` `bad` `dirty` `idle` | — | the status pip on each object |
| `ui.stall` | `stalled` `quiet` | — | the "no way out" cross where a stalled stream meets a wall |

`icon` is what the goal strip and the help sheet show. Without a picture for
it, the happy state is used: `spinning`, `lit`, `dry`, `calm`, `swaying`, `clear`.

Not sprites: the garden, walls, floor and tables (colours, plus textures), the
airflow, the wind streaks, smoke, highlights, requirement meters, the hint
and win effects, the ring under a coach bubble, and the field guide's icons
for courtyards, hatched walls and calm days. Colours and `tuning` change those.

The little houses on the "Meet the …" cards (js/guides.js) are drawn by the
same board renderer, so your sprites, colours and textures show there too.

### textures

Repeating pictures laid over the `garden`, the `floor` or the walls (`wall`),
on top of their colour:

```js
textures: {
  floor: { src: 'art/mine/floorboards.svg', tiles: 2, alpha: 0.8 }   // one picture covers 2 x 2 tiles
}
```

The floor and walls repeat from the house's top-left corner, the garden from
the canvas corner. Semi-transparent drawings over the colour work in both
modes.

### Art sets: `art/<name>/art.js`

Keep several looks side by side: `art/autumn/art.js` opens with
`index.html?art=autumn` (and `studio.html?art=autumn`, or type `autumn`
in the studio's Art box). Inside it, a path without `art/` in front is next to
that `art.js`, so `'candle.svg'` means `art/autumn/candle.svg`. To make a set
the game's look, copy its contents into `art/art.js`, and write its paths in
full: `art/autumn/candle.svg`.

## For programmers

```
js/theme.js     tokens: every colour, light and dark, and the tuning numbers
                ──► CSS custom properties (the page) and WBTheme.color() / num() (the canvas)
js/sprites.js   the sprite registry, the built-in art, art overrides, the problem list
js/render.js    the board: garden, house, airflow, highlights; draws sprites
art/art.js      the art manifest (empty = built-in)
studio.html     every sprite, state, token and tuning number, live boards, art problems, exports
tools/visual.js pixel-for-pixel visual regression check + drawing-time benchmark
```

Load order (index.html and studio.html): `js/theme.js` in `<head>` (so the
page never paints without its colours), then `js/engine.js`, `js/levels.js`,
`js/sprites.js`, `js/render.js`, `art/art.js`, `js/game.js`.

### The theme

`js/theme.js` holds every colour (and the font stack and shadows) as named
tokens, each with a light and a dark value and a note. On load it writes them
as CSS custom properties into `<style id="wb-theme">`: light values on
`:root`, dark values under `@media (prefers-color-scheme: dark)`, and either
set when `<html data-theme="light|dark">` forces a mode. It also keeps the
phone browser bar (`<meta name="theme-color">`) on `bg`. `css/style.css` has
no colours of its own: it only uses `var(--token)`, and a unit test fails on
a colour literal in it. The canvas reads the same table with
`WBTheme.color(name)` (`P(name)` in the drawing code). When the OS switches
mode, `data-theme` changes or a token is set, theme.js rewrites the CSS and
tells its listeners, and the game repaints its cached layers and icons.

```js
WBTheme.color('wall')                      // current mode's value (the canvas hot path)
WBTheme.palette('dark')                    // { token: value } for a mode
WBTheme.set({ light: { wall: '#6b7380' } })  // or { wall: ... } for both; null removes
WBTheme.check('wall', 'tomato')            // the value if usable, else null
WBTheme.num('spin-fan')                    // a tuning number; setTuning({ ... }) sets them
WBTheme.reset() / overrides() / tuningOverrides()
WBTheme.setMode('dark' | 'light' | null)   // force the page's mode (null: follow the OS)
WBTheme.use('dark')                        // canvas only, until use(null): paint another mode
WBTheme.onChange(fn)                       // 'mode', 'tokens' or 'tuning'
WBTheme.trace(fn)                          // the token names fn asked for (the studio's "used by")
WBTheme.mix(a, b, t), alpha(c, a), darker(c, t), lighter(c, t), parse(c), hex(c)
```

`parse()` reads `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` and
`hsl()`/`hsla()`. In a browser, anything else the canvas accepts (colour
names, ...) goes through a canvas first. In Node only those forms count as
colours.

### The sprite registry

Every tool, object, tray icon and status mark is a sprite: a named drawing in
the registry in `js/sprites.js`. The renderer composes the board and asks the
registry for each sprite, and the tray, goal strip and help icons use the
same sprites.

**Unit space.** Tool and object sprites draw around the origin, the centre of
their cell, with 1 unit = 1 tile (the renderer has already translated and
scaled). `o.px` is one CSS pixel in units, for minimum stroke widths. UI
sprites (`ui.*`) draw in CSS pixels. Objects get `flow` (air reaching them),
`dirx`/`diry` (unit vector of that air), `small` (simpler shapes on small
tiles), eased 0..1 values (`lit`, `dry`, `soot`, `scatter`, `flutter`,
`bend`, `sway`), `angle` (spin) and `icon` (drawn as an icon). `t` is the
time in seconds, for idle motion.

```js
WBSprites.draw(name, ctx, o, t)     // the override if one is ready, else the built-in art
WBSprites.drawBuiltin(name, ctx, o, t)
WBSprites.define(name, spec)        // add or replace a built-in sprite (see the comment in sprites.js)
WBSprites.list(group) / get(name) / has(name) / status()
WBSprites.override(name, spec | null)
WBSprites.problems()                // mistakes found in the art: { level, text, hint, sprite, token, file, line }
WBSprites.kit                       // P, num, mix, alpha, darker, lighter, rr, fillRR, circle, line, chevron, ...
WBSprites.onChange(fn)              // 'manifest', 'sprites' or 'textures'
```

A sprite's spec has `states`, `state(o)` (the state names that apply, most
specific first), an optional `blend(o)` (for `fade: true`), `turn(o)`,
`stateNotes` and `samples` (the poses the studio shows and the tests draw).

**Problems.** Everything the manifest does wrong is reported once, through
`WBTheme.report(level, text, { hint, ... })`: in the console, and in the
studio's Art in use. That covers unknown names (with a "did you mean"),
values that are not colours or numbers, files that do not load, SVGs without
a size, a draw function that throws, and an `art.js` that has a syntax error
or never calls `WBArt`. The last one is caught with a window `error`
listener and a check at `load`.

### The visual check: `tools/visual.js`

A graphics change should change exactly what you meant it to. The visual
check renders 76 pictures (light and dark, phone and desktop) of the home
screen, levels, the gallery rooms, a hint, the help sheet, a win, reduced
motion, the example art and the field guide (a "Meet the …" card with its
demo, the guidance line, the first level's coach, a card in Help), and
compares them pixel by pixel with a baseline.

```sh
node tools/visual.js --baseline               # the reference: the game as it is now
node tools/visual.js --baseline --from HEAD   # ... or as of a git revision (needs a git checkout)
node tools/visual.js --baseline --root ../wb-before   # ... or from another copy of the game
node tools/visual.js --compare                # the working tree vs the reference (npm run visual)
node tools/visual.js --perf                   # board drawing time on the busiest scenes
```

* Every picture is drawn at a frozen moment (`window.__wbFreezeTime`, a test
  hook in render.js). Eased values are settled, and the wind streaks and spin
  angles come from a fixed seed. CSS transitions are off and CSS animations
  finished, so the same code gives the same pixels on every run.
* `--from` renders a revision's whole game in a temporary folder, also when
  the game sits in a sub-folder of a bigger repository. A revision older
  than the freeze hook (v1.0, `de0d5e4`, and the commits just before it) gets
  `tools/visual-freeze.patch`. A revision the patch does not fit is refused,
  because its pictures would not be reproducible. Without git, take the
  baseline before you change anything, or use `--root`.
* The baseline pins its own copy of `js/engine.js` and `js/levels.js`, so
  level and rule edits never show up as graphics changes (`--live` uses
  today's).
* `--compare` writes `screenshots/gfx/review.html` (before | after | diff),
  and `screenshots/gfx/diff/` has the changed pixels in magenta over a faded
  copy. The run fails when a picture changes more than `--tolerance` (0.05% by
  default), when there is no baseline at all, or when the page logs an error.
  A scene added since the baseline is listed as not checked; `--strict`
  fails on it.
* `--only gallery,calm` picks scenes, `--threshold 8` ignores tiny colour
  shifts, `--headed` shows the browser, `--list` lists the pictures.

When this graphics system was introduced, the refactor was checked this way:
all 54 pictures of v1.0 (`--baseline --from de0d5e4`) were pixel-identical after
it, and drawing time was unchanged (about 1.1 ms per frame on the busiest
level).

### Code recipes

* **A new sprite** (e.g. for a new tool): `WBSprites.define('tool.x', { group:
  'tool', draw, states, state, turn, samples, note })` in `js/sprites.js`. The
  renderer draws `tool.<type>` for every piece. The studio and the tests pick
  it up from the registry.
* **A new colour**: add a row to its group in `js/theme.js` (light, dark,
  note). It becomes `var(--name)` in CSS and `P('name')` on the canvas.
* **A new tuning number**: add a row to `TUNING_GROUPS` in `js/theme.js` and
  read it with `N('name')` in render.js. Keep the default at "as before", so
  the visual check stays identical.
* **Changing the built-in defaults**: edit `js/theme.js` itself, then
  `node tools/visual.js --compare` and look at `screenshots/gfx/review.html`.
