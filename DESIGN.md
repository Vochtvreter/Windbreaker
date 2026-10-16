# Windbreaker — Design Spec

A calm, minimalist browser puzzle game about airflow. Each level is a top‑down
floor plan of a house. The player places a limited set of tools (windows, fans,
deflectors, …) to create, redirect and reduce airflow so that every object in
the house is happy: pinwheels spin, laundry dries, candles stay lit, smoke gets
out.

This document is the single source of truth for the rules, the level format,
the engine API, and the project layout. `js/engine.js` implements it exactly.

---------------------------------------------------------------------------

## 1. Coordinates and directions

* Grid of cells, `x` to the right, `y` down. Cell `(x, y)` covers the unit
  square `[x, x+1] × [y, y+1]`; its centre is `(x+0.5, y+0.5)`.
* Directions are integers: `0 = N (up)`, `1 = E (right)`, `2 = S (down)`,
  `3 = W (left)`. `DX = [0,1,0,-1]`, `DY = [-1,0,1,0]`. Opposite of `d` is
  `(d+2)%4`.

## 2. Map characters

A level map is an array of equal‑length strings.

| char | meaning |
|------|---------|
| `#`  | wall (tools may be mounted on it, see placement) |
| `%`  | solid wall — like `#`, but nothing can ever be mounted on it |
| `.`  | floor |
| `o`  | table — floor that air passes over, but nothing can be placed on it |
| `~`  | outside (garden). Everything beyond the map edge is outside too |
| `p`  | floor + **pinwheel** |
| `l`  | floor + **laundry** |
| `c`  | floor + **candle** |
| `n`  | floor + **papers** |
| `f`  | floor + **fern** |
| `s`  | floor + **stove** (a smoke source) |

"Floor‑ish" = `.`, `o`, or any object character. Air moves freely through
floor‑ish cells. Objects never block air.

A valid map is **sealed**: no floor‑ish cell may be 4‑adjacent to outside
(a `~` cell or the map edge). Maps contain only the house's bounding box; the
renderer draws the garden margin around it.

Size limits: width ≤ 13, height ≤ 10 (including walls).

## 3. Wind

`wind: { from: "N"|"E"|"S"|"W", strength: 0..3 }`. The wind *blows toward* the
opposite side: wind from the west travels east (`windDir = (from+2)%4`).
`strength: 0` means a calm day — no wind enters anywhere.

## 4. Tools (pieces)

A piece is `{ type, x, y, d }`. `d` is the rotation (0 when unused).
Pieces are either **fixed** (part of the level, cannot be moved) or placed by
the player from the level's **inventory**.

| id | name | mount | rotations | intro level |
|----|------|-------|-----------|-------------|
| `window`     | Window       | exterior wall | 1 | 1  |
| `fan`        | Fan          | floor         | 4 (`d` = direction it blows) | 11 |
| `deflector`  | Deflector    | floor         | 2 (`0` = `/`, `1` = `\`) | 21 |
| `curtain`    | Curtain      | floor         | 1 | 31 |
| `vent`       | Wall vent    | interior wall | 1 | 41 |
| `splitter`   | Splitter     | floor         | 1 | 51 |
| `extractor`  | Extractor    | exterior wall | 1 | 56 |
| `skylight`   | Skylight     | floor         | 1 | 61 |
| `filter`     | Air filter   | floor         | 1 | 66 |
| `ceilingfan` | Ceiling fan  | floor         | 1 | 71 |

Tools and objects arrive one at a time, each opening its own chapter (section 7);
from level 71 on, everything exists.

### Placement

* **floor** tools: cell is `.` (plain floor — not a table, not an object) and
  holds no other piece.
* **exterior wall** tools (`window`, `extractor`): cell is `#` (not `%`), holds
  no piece, and there is a direction `o` (the *outward* direction) such that
  the neighbour in direction `o` is outside and the neighbour in direction
  `(o+2)%4` is floor‑ish. (Corners never qualify.) If several directions
  qualify, the first in N,E,S,W order is used.
* **interior wall** tools (`vent`): cell is `#`, holds no piece, has **no**
  4‑neighbour that is outside, and either both W and E neighbours are
  floor‑ish, or both N and S neighbours are floor‑ish.

### Behaviour

Airflow is made of **streams**. A stream has a direction and an integer
**strength** `s ≥ 1` (1 = gentle breeze, 2 = strong, 3+ = gale — the words the game uses).

* **Window** — its role depends on the wind:
  * *Inlet* if `strength > 0` and the window's outward direction faces the wind
    (`o === from`). An inlet emits a stream of strength `wind.strength` into
    the house, moving in `windDir`. **Cross‑ventilation rule:** the inlet's
    stream only flows if at least one branch of it reaches an outlet. Otherwise
    the inlet is *stalled* and contributes no airflow at all (the UI shows its
    would‑be path as a faint dashed line).
  * *Outlet* otherwise. Any stream that reaches it leaves the house.
  * A stream that reaches an *inlet* window from inside is blocked (the wind
    pushes back).
* **Fan** — emits a stream of strength 1 in direction `d`. Any stream that
  enters the fan's cell, from any side, leaves it moving in direction `d`
  with unchanged strength (fans draw air in and push it on). Because the fan's
  own stream also runs along that path, a fan effectively adds +1.
* **Deflector** — turns any stream 90°. `/`: N→E, E→N, S→W, W→S.
  `\`: N→W, W→N, S→E, E→S. Strength unchanged.
* **Curtain** — a stream passing through loses 1 strength. A stream that
  drops to 0 stops there (counts as *blocked*).
* **Wall vent** — the wall cell becomes passable: streams go straight
  through it.
* **Splitter** — a stream entering moving in direction `d` is replaced by two
  streams moving in `(d+1)%4` and `(d+3)%4`, each with strength
  `max(1, floor(s/2))`.
* **Extractor** — an outlet that works on any exterior wall, even one facing
  the wind. It also *pulls*: starting at the floor cell just inside it, walk
  inward in a straight line over floor‑ish cells that hold no piece; the last
  such cell is the start of a strength‑1 stream that moves back toward the
  extractor and exits through it. (If the cell just inside holds a piece, there
  is no pull stream.)
* **Skylight** — an outlet in the floor. A stream that enters it leaves the
  house through the roof.
* **Air filter** — removes smoke from streams passing through. Strength
  unchanged.
* **Ceiling fan** — emits four strength‑1 streams, one in each direction.
  Streams entering its cell pass straight through, unchanged.

**Outlets** are: outlet windows, extractors, skylights (and, defensively,
leaving the map — cannot happen in a sealed map).

**Blocked** means: hitting a wall (without a vent), hitting an inlet window,
or being reduced to 0 by a curtain.

### Tracing (exact)

Each source is traced independently as a **tree** of states. A state means
"air arrives in cell `(x, y)` moving in direction `d` with strength `s` and
smoke set `m`". Start states:

* inlet window at `(wx, wy)`: arrives in `(wx, wy) + windDir`, dir `windDir`,
  `s = wind.strength`;
* fan: arrives in the neighbour in direction `d`, `s = 1`;
* ceiling fan: one start state per direction, `s = 1`;
* extractor pull: arrives in the far‑end cell `cK`, moving outward, `s = 1`.

Processing a state at cell `C` (moving `d`, strength `s`, smoke `m`):

1. If `C` is outside → terminal **outlet**.
2. If `C` is a wall: vent → continue to `C + d` (same `d, s, m`); outlet
   window or extractor → terminal **outlet**; inlet window or bare wall →
   terminal **blocked**.
3. Otherwise `C` is floor‑ish. Record flow `s` at `C` for this tree. If `C`
   is a stove, add that stove to `m` and mark it *reached* by this tree.
   Then by the piece at `C`:
   * none / object / table / ceiling fan → continue to `C + d`;
   * fan → continue in the fan's direction;
   * deflector → continue in the reflected direction;
   * curtain → `s − 1`; if 0 → terminal **blocked**, else continue;
   * splitter → two successors as above;
   * skylight → terminal **outlet**;
   * filter → `m = ∅`, continue.

A state that has already been visited in the same tree (same `x, y, d, s, m`)
is not processed again (the branch merges into existing flow; it is not a
terminal).

Per tree, the flow at a cell is the **maximum** strength among the tree's
states in that cell. A tree is **active** if it is not a stalled inlet.
The **total flow** at a cell is the **sum** over active trees.

### Smoke

A stove is **cleared** when both hold:

1. at least one active tree reaches the stove's cell, and
2. in every active tree, no state carrying that stove's smoke leads to a
   **blocked** terminal, and the states carrying it contain no cycle among
   themselves (smoke going round in circles never leaves — unless the loop
   passes a filter, which cleans it every lap).

In words: *blow the smoke outside (window, extractor, skylight) or through a
filter, and don't let smoky air hit a wall.*

## 5. Objects and the goal

| object | char | happy when total flow `f` at its cell … | intro level |
|--------|------|------------------------------------------|-------------|
| Pinwheel | `p` | `f ≥ 1` | 1  |
| Candle   | `c` | `f = 0` | 6  |
| Stove    | `s` | its smoke is cleared | 16 |
| Laundry  | `l` | `f ≥ 2` **and** no smoky air at its cell | 26 |
| Papers   | `n` | `f ≤ 1` | 36 |
| Fern     | `f` | `f = 1` | 46 |

Laundry needs **clean** air: if any active tree crosses the laundry's cell
while carrying smoke (smoke that has not been through a filter), the laundry
is dirty — state `bad`, whatever its flow. Smoke carried only by a stalled
inlet does not count.

The level is solved when **every** object is happy at the same time. The flow
is recomputed instantly after every move, so the player gets live feedback; the
level completes as soon as all objects are happy.

Calm days, strong wind, gales and some map features are *twists* with their
own first levels (section 7).

## 6. Level format

Source files live in `levels/src/chNN.json` (one per chapter of 5 levels):

```json
{
  "chapter": 1,
  "title": "Open Windows",
  "levels": [
    {
      "name": "First Breeze",
      "tip": "Optional one‑sentence tutorial hint shown on the level.",
      "wind": { "from": "W", "strength": 1 },
      "map": [
        "#########",
        "#.......#",
        "#...p...#",
        "#.......#",
        "#########"
      ],
      "fixed": [ { "type": "window", "x": 0, "y": 2 } ],
      "inventory": { "window": 1 },
      "solution": [ { "type": "window", "x": 8, "y": 2 } ]
    }
  ]
}
```

* `fixed` pieces are pre‑placed and immovable. `d` defaults to 0.
* `inventory` lists how many of each tool the player gets.
* `solution` is a reference solution (player pieces only). It must fit within
  the inventory and, together with `fixed`, solve the level. It powers the
  in‑game hint button.
* `tools/build-levels.js` concatenates all chapters into `js/levels.js`.

### Level checks (enforced by `tools/check-levels.js`)

1. Map is rectangular, uses only known characters, is sealed, ≤ 13×10, and
   holds at least one object.
2. Fixed and solution pieces are on valid cells, don't overlap, and the
   solution fits the inventory.
3. Only tools, objects and twists already introduced by that level number
   appear (sections 4, 5, 7).
4. The level is **not** solved before the player places anything.
5. The reference solution solves it.
6. On a tool's intro level, that tool is in the inventory and the level is
   **not** solvable without it; an object's intro level has that object.
7. Pacing (section 7), checked over the whole sequence: an intro level brings
   exactly its one new thing and nothing else new, and has a tip; practice
   levels bring no new tool or object; a twist first appears alone, on the
   3rd–5th level of a chapter, with a tip.

## 7. Chapters and pacing

100 levels in 20 chapters of 5. **One new thing at a time:** each of chapters
1–15 introduces exactly one tool or object on its first level — a gentle,
focused tutorial with a tip — followed by four practice levels that add nothing
new. So the player always gets at least four puzzles with what they know
before anything else arrives. Chapters 16–20 are mastery chapters.

| ch | levels | introduces | kind |
|----|--------|------------|------|
| 1  | 1–5    | window (and the pinwheel) | tool |
| 2  | 6–10   | candle     | object |
| 3  | 11–15  | fan        | tool |
| 4  | 16–20  | stove      | object |
| 5  | 21–25  | deflector  | tool |
| 6  | 26–30  | laundry    | object |
| 7  | 31–35  | curtain    | tool |
| 8  | 36–40  | papers     | object |
| 9  | 41–45  | wall vent  | tool |
| 10 | 46–50  | fern       | object |
| 11 | 51–55  | splitter   | tool |
| 12 | 56–60  | extractor  | tool |
| 13 | 61–65  | skylight   | tool |
| 14 | 66–70  | air filter | tool |
| 15 | 71–75  | ceiling fan | tool |
| 16–20 | 76–100 | — (mastery) | |

**Twists** are smaller variations. Each may first appear from its level on —
always on the 3rd–5th level of a chapter, never on or right after an intro
level, one twist per level, with a tip that explains it:

| twist | first allowed | what it is |
|-------|---------------|------------|
| courtyard (`~` inside the map) | 8  | courtyard walls are outside walls too |
| calm day (strength 0) | 13 | no wind; windows only let air out |
| hatched wall (`%`) | 18 | nothing can be fitted into it |
| table (`o`) | 23 | air passes over, nothing can be placed |
| strong wind (strength 2) | 28 | the wind blows in at 2 |
| gale (strength 3) | 53 | the wind blows in at 3 |

The schedule lives in the engine (`WB.INTRO_ORDER`, `WB.CONDITIONS`,
`WB.introAt(n)`, `WB.levelConditions(def)`); `tools/check-levels.js` enforces
it. Each built level also gets a stable `key` (from its unique name) so saved
progress survives reordering.

Rough targets: early chapters stay small (1–3 pieces, 1–3 objects, one or two
rooms); practice levels in chapters 1–15 rise gently and use the newest thing;
mastery chapters 16–20 bring 4–8 pieces, several rooms and decoy pieces.

## 8. Engine API (`js/engine.js`)

UMD: in the browser it defines `window.WB`; in Node, `require('./js/engine.js')`
returns the same object. No dependencies, no DOM.

```js
WB.DX, WB.DY, WB.DIR_NAMES            // ['N','E','S','W']
WB.TOOLS        // { [id]: { id, name, desc, mount: 'floor'|'exterior'|'interior', rotations, intro } }
WB.TOOL_ORDER   // ['window','fan',...]
WB.OBJECTS      // { [id]: { id, char, name, desc, intro } }
WB.OBJECT_ORDER // ['pinwheel','candle','stove','laundry','papers','fern']
WB.OBJECT_BY_CHAR      // { p: 'pinwheel', ... }
WB.MAX_W, WB.MAX_H     // 13, 10
WB.CALM_INTRO, WB.WIND2_INTRO, WB.WIND3_INTRO   // 6, 13, 26
WB.VERSION             // set by js/version.js (browser)

WB.parseLevel(def) -> Level
//   Level = { def, w, h, cells: string[] (one char per cell, row-major),
//             objects: [{ id, type, x, y }], stoves: (the stove objects), fixed: Piece[],
//             wind: { from: 0..3, dir: 0..3, strength }, inventory: {type: n}, name, tip }
WB.validateLevel(def) -> string[]                 // structural errors (empty = OK)
WB.introErrors(def, n) -> string[]                // tools/objects/wind strengths used before level n introduces them
WB.cellAt(L, x, y) -> char                        // '~' when out of bounds
WB.isFloorish(ch), WB.isWall(ch), WB.isOutside(ch)
WB.outwardDir(L, x, y) -> 0..3 | -1               // exterior mount direction
WB.canPlace(L, pieces, type, x, y) -> boolean     // pieces = all current pieces
WB.placementCells(L, pieces, type) -> [{x,y}]
WB.windowRole(L, piece) -> 'inlet' | 'outlet'
WB.rotate(type, d) -> next d
WB.simulate(L, pieces) -> Result                  // pieces = fixed + player pieces
WB.isSolved(L, pieces) -> boolean
```

`Result`:

```js
{
  flow: Int32Array(w*h),         // total flow per cell (active trees)
  trees: [{
    source: Piece,               // the piece that emits it
    kind: 'inlet'|'fan'|'ceilingfan'|'pull',
    active: boolean,
    segments: [{ ax, ay, bx, by, s, smoke, dist }], // in cell units (centres at +0.5);
                                 // dist = path length from the source to (ax,ay)
    ends: [{ x, y, type: 'outlet'|'blocked' }],     // terminal points (cell units)
  }],
  stoves: [{ x, y, reached, cleared }],
  goals:  [{ type, x, y, flow, ok, state, smoky? }],   // smoky: laundry only
  //  state: 'idle' | 'happy' | 'bad'
  //  idle = needs more air; happy = ok; bad = harmed (candle blown out,
  //  papers scattered, fern battered, smoke trapped, laundry dirtied by smoke)
  solved: boolean
}
```

## 9. Project layout

```
index.html            entry point (GitHub Pages serves the repo root)
.nojekyll             serve the files as they are on GitHub Pages
css/style.css         layout; colours come from js/theme.js as CSS variables
js/theme.js           every colour (light + dark), size and speed: the visual tokens
js/version.js         version shown on the level-select screen (bumped per release)
js/engine.js          rules + simulation (UMD, shared with Node tools)
js/levels.js          generated from levels/src by tools/build-levels.js
js/migrate.js         translates saved progress when the level order changes
js/sprites.js         sprite registry: every tool, object and mark drawing
js/render.js          board composition (garden, house, airflow) using sprites
js/game.js            UI, input, progress, screens
art/art.js            image overrides for sprites (ships empty; see GRAPHICS.md)
art/examples/         example override art
studio.html           graphics workbench: preview and tweak sprites, tokens, art
levels/src/chNN.json  level sources
levels/unused.json    good levels that are not in the game (kept for reuse)
tools/                build, check, solve, show + shared lib.js (Node, no deps)
tools/e2e.js          browser end-to-end test (needs Playwright + Chromium)
tools/visual.js       visual regression: screenshots compared pixel by pixel
tests/                node:test unit tests (fixtures in tests/fixtures/)
package.json          npm scripts only, no dependencies
README.md, CHANGELOG.md, GRAPHICS.md, tools/README.md
```

Plain classic `<script>` tags (no modules, no build step at runtime), so the
game also opens straight from the file system. Everything is relative‑path so
it works under `https://<user>.github.io/<repo>/`.

## 10. Look and feel

Minimalist and calm. Soft warm floor (`#f6f1e7`‑ish), slate walls, a pale
sage garden with drifting wind lines outside that show the wind direction,
airflow drawn as soft sky‑blue moving streaks, one parallel lane per point of
strength (up to 4) so strength can be counted, moving faster when stronger; a
stalled inlet's path as a faint dashed line ending in a red × (grey once the
level is solved); smoke as grey puffs, and laundry reached by smoky air turns
sooty grey with a grey smoke badge. Rounded shapes, gentle animations
(pinwheels spin, candle flames flicker, laundry sways). System font stack.
Works with mouse and touch, scales from phone to desktop, supports dark mode.
All of it is tunable without touching game code — see GRAPHICS.md.
