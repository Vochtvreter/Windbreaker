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
| `fan`        | Fan          | floor         | 4 (`d` = direction it blows) | 6  |
| `deflector`  | Deflector    | floor         | 2 (`0` = `/`, `1` = `\`) | 11 |
| `curtain`    | Curtain      | floor         | 1 | 16 |
| `vent`       | Wall vent    | interior wall | 1 | 21 |
| `splitter`   | Splitter     | floor         | 1 | 26 |
| `extractor`  | Extractor    | exterior wall | 1 | 31 |
| `skylight`   | Skylight     | floor         | 1 | 36 |
| `filter`     | Air filter   | floor         | 1 | 41 |
| `ceilingfan` | Ceiling fan  | floor         | 1 | 46 |

A new tool is introduced every 5 levels; from level 46 on, all tools exist.

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
**strength** `s ≥ 1` (1 = gentle breeze, 2 = wind, 3+ = strong wind).

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
| Candle   | `c` | `f = 0` | 3  |
| Stove    | `s` | its smoke is cleared | 8 |
| Laundry  | `l` | `f ≥ 2` | 13 |
| Papers   | `n` | `f ≤ 1` | 18 |
| Fern     | `f` | `f = 1` | 23 |

The level is solved when **every** object is happy at the same time. The flow
is recomputed instantly after every move, so the player gets live feedback; the
level completes as soon as all objects are happy.

Calm days (`strength: 0`) can appear from level 6 (when fans arrive).
Wind strength 2 can appear from level 13, strength 3 from level 26.

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

1. Map is rectangular, uses only known characters, is sealed, ≤ 13×10.
2. Fixed and solution pieces are on valid cells, don't overlap, and the
   solution fits the inventory.
3. Only tools and objects already introduced by that level number appear.
4. The level is **not** solved before the player places anything.
5. The reference solution solves it.
6. On a tool's intro level, that tool is in the inventory and the level is
   **not** solvable without it.

## 7. Chapters and difficulty curve

100 levels in 20 chapters of 5.

| ch | levels | new tool | chapter title |
|----|--------|----------|---------------|
| 1  | 1–5    | window     | Open Windows |
| 2  | 6–10   | fan        | Fans |
| 3  | 11–15  | deflector  | Deflectors |
| 4  | 16–20  | curtain    | Curtains |
| 5  | 21–25  | vent       | Wall Vents |
| 6  | 26–30  | splitter   | Splitters |
| 7  | 31–35  | extractor  | Extractors |
| 8  | 36–40  | skylight   | Skylights |
| 9  | 41–45  | filter     | Filters |
| 10 | 46–50  | ceilingfan | Ceiling Fans |
| 11–20 | 51–100 | — (all tools) | mastery chapters |

Rough targets (player pieces in the inventory / objects / rooms):

* 1–5: 1–2 pieces, 1–2 objects, 1 room. Very easy.
* 6–20: 1–4 pieces, 1–3 objects, 1–2 rooms.
* 21–50: 2–5 pieces, 2–4 objects, 1–3 rooms.
* 51–75: 3–6 pieces, 3–5 objects, 2–3 rooms, mixing tools.
* 76–100: 4–8 pieces, 3–7 objects, 2–4 rooms, decoy pieces allowed.

Each tool chapter starts with a gentle, focused tutorial for the new tool and
ends with a puzzle that combines it with earlier tools.

## 8. Engine API (`js/engine.js`)

UMD: in the browser it defines `window.WB`; in Node, `require('./js/engine.js')`
returns the same object. No dependencies, no DOM.

```js
WB.DX, WB.DY, WB.DIR_NAMES            // ['N','E','S','W']
WB.TOOLS        // { [id]: { id, name, desc, mount: 'floor'|'exterior'|'interior', rotations, intro } }
WB.TOOL_ORDER   // ['window','fan',...]
WB.OBJECTS      // { [id]: { id, char, name, desc, intro } }
WB.OBJECT_ORDER // ['pinwheel','candle','stove','laundry','papers','fern']

WB.parseLevel(def) -> Level
//   Level = { def, w, h, cells: string[] (one char per cell, row-major),
//             objects: [{ id, type, x, y }], fixed: Piece[], wind: { from, dir, strength },
//             inventory: {type: n}, name, tip }
WB.validateLevel(def) -> string[]                 // structural errors (empty = OK)
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
  goals:  [{ type, x, y, flow, ok, state }],
  //  state: 'idle' | 'happy' | 'bad'
  //  idle = needs more air; happy = ok; bad = harmed (candle blown out,
  //  papers scattered, fern battered, smoke trapped)
  solved: boolean
}
```

## 9. Project layout

```
index.html            entry point (GitHub Pages serves the repo root)
css/style.css
js/engine.js          rules + simulation (UMD, shared with Node tools)
js/levels.js          generated from levels/src by tools/build-levels.js
js/render.js          canvas drawing
js/game.js            UI, input, progress, screens
levels/src/chNN.json  level sources
tools/                build, check, solve, show (Node, no deps)
tests/                node:test unit tests
```

Plain classic `<script>` tags (no modules, no build step at runtime), so the
game also opens straight from the file system. Everything is relative‑path so
it works under `https://<user>.github.io/<repo>/`.

## 10. Look and feel

Minimalist and calm. Soft warm floor (`#f6f1e7`‑ish), slate walls, a pale
sage garden with drifting wind lines outside that show the wind direction,
airflow drawn as soft sky‑blue moving dashes whose thickness and speed grow
with strength; smoke as grey puffs. Rounded shapes, gentle animations
(pinwheels spin, candle flames flicker, laundry sways). System font stack.
Works with mouse and touch, scales from phone to desktop, supports dark mode.
