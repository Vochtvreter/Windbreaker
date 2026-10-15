# Windbreaker level tools

Node CLIs for designing, checking and building the 100 levels. Node 18+ (tested
on 22), no dependencies. Every tool uses `js/engine.js` (`WB.simulate` /
`WB.isSolved`) as the only rules oracle, so the tools always agree with the game.

```
npm run show  -- 12            # draw level 12 with its reference solution
npm run solve -- 12            # find all solutions
npm run check                  # all section-6 checks + stats table for every level
npm run build                  # levels/src/ch*.json -> js/levels.js
npm test                       # node --test tests/*.test.js
```

Level sources live in `levels/src/chNN.json` (format: DESIGN.md section 6). Level
number = `(chapter - 1) * 5 + index + 1`, where `index` is the 0-based position
in the chapter's `levels` array. Chapters may be partial while authoring (warning
only); more than 5 levels is an error.

Every CLI that takes a level accepts either a **level number** (looked up in
`levels/src`, or `--src dir`) or a **file**: a chapter file plus `--index k`
(0-based, default 0), or a file holding a single bare level object (give its
number with `--n N` if intro checks matter).

## Design loop

1. Edit `levels/src/chNN.json`.
2. `node tools/show.js 23 --fixed-only` - starting position; `node tools/show.js 23` - with the reference solution.
3. `node tools/solve.js 23` - is the reference the only / shortest solution? Too many solutions = too easy.
4. Try ideas without editing the file: `node tools/show.js 23 --pieces '[{"type":"fan","x":3,"y":2,"d":"E"}]'`.
5. `node tools/check-levels.js --chapter 5` - all checks for the chapter; fix every FAIL.
6. `npm run build` once the chapter is clean.

## show.js - ASCII visualiser

```
node tools/show.js <level | file.json [--index k]> [--fixed-only] [--pieces '<JSON>'] [--solution] [--no-tip]
```

* default: fixed pieces + reference solution
* `--fixed-only`: the starting position
* `--pieces '<JSON array>'`: fixed + these pieces (instead of the solution; add
  `--solution` to keep it). `d` may be `0..3`, `"N" "E" "S" "W"` (fans) or
  `"/" "\\"` (deflectors). Invalid placements and inventory overuse are
  reported as `! ...` lines.

```
#1 "First Breeze"  ch1[0]  9x5 rooms 1  wind from W, strength 1
inv: window 1
   map            flow
   012345678      012345678
 0 #########    0 #########
 1 #.......#    1 #.......#
 2 W...p...w    2 W1111111w
 3 #.......#    3 #.......#
 4 #########    4 #########
fixed: W 0,2   placed: w 8,2
objects 1/1:
  p pinwheel 4,2   flow 1  ok
trees 1:
  inlet      W 0,2   active  max 1  ends: out 8,2
SOLVED
legend: W inlet window, w outlet window; flow , = stalled path
```

Left grid: the map with pieces. Right grid: **total flow** per floor cell
(`.` = 0, `,` = no flow but a stalled inlet's would-be path passes here,
digits = flow, `a`+ for 10+); walls and wall pieces are repeated for
orientation. Then pieces (fixed / placed), every object with its flow and
state (`ok`, `IDLE` = needs more air, `BAD` = harmed; stoves add
`smoke cleared` / `smoke TRAPPED` / `no air`), every airflow tree (kind,
source glyph and cell, `active` / `STALLED`, max strength, where its branches
end: `out x,y` = outlet cell, `blk x,y` = wall / inlet / curtain cell where it
is blocked, `x2` = two branches), and `SOLVED` / `not solved (k/n happy)`.

### Glyph legend

Piece glyphs never collide with map characters (`# % . o ~ p l c n f s`).

| glyph | piece | | glyph | piece |
|---|---|---|---|---|
| `W` | window, **inlet** (faces the wind) | | `Y` | splitter |
| `w` | window, outlet | | `X` | extractor |
| `^ > v <` | fan blowing N / E / S / W | | `@` | skylight |
| `/` `\` | deflector (`d` = 0 / 1) | | `+` | air filter |
| `:` | curtain | | `*` | ceiling fan |
| `=` | wall vent | | | |

Map characters: `#` wall, `%` solid wall, `.` floor, `o` table, `~` outside,
`p` pinwheel, `l` laundry, `c` candle, `n` papers, `f` fern, `s` stove.

## solve.js - solver

```
node tools/solve.js <level | file.json [--index k]> [--time ms] [--max N] [--exclude a,b]
                    [--max-pieces k] [--list N] [--show] [--json]
```

| option | meaning |
|---|---|
| `--time ms` | time limit, default 5000 |
| `--max N` | stop after N solutions (status `capped`), default 1000 |
| `--exclude fan,vent` | solve as if those tools were not in the inventory |
| `--max-pieces k` | only solutions with at most k pieces |
| `--list N` | print the first N solutions (default 5) |
| `--show` | draw each printed solution |
| `--json` | the full result object as JSON |

```
$ node tools/solve.js 1
#1 "First Breeze"  wind from W, strength 1  inv: window 1  ref: 1 piece
exhaustive: SOLVABLE, 1 solution, min 1 piece | 6 nodes, 3 ms, depth 1/1
  1. window 8,2   = ref
```

Status line: `exhaustive` (complete answer), `timeout` (partial; `depth a/b`
means every configuration of up to `a` pieces was searched, of at most `b`) or
`capped` (hit `--max`). `= ref` marks the reference solution; if an exhaustive
search does not list the reference, a note says why (does not solve / not
minimal: a subset also solves).

Module API:

```js
const { solve } = require('./tools/solve');
solve(def, { timeMs: 5000, maxSolutions: 1000, maxPieces, excludeTools: [], inventory, pruneIdle: true })
// -> { status: 'exhaustive'|'timeout'|'capped', solvable: true|false|null, count,
//      solutions: [[{type,x,y,d?}, ...] sorted], minPieces, nodes, ms,
//      space, completedDepth, maxDepth }
```

### How it searches (and why it is complete)

The full argument is in the header of `solve.js`; in short:

* **Sources** (fan with 4 rotations, ceiling fan, extractor, and windows on
  wall cells where a window would be an *inlet*) create airflow by
  themselves, so they are enumerated on **all** valid cells, as combinations in
  a canonical order.
* **Passives** (deflector x2 rotations, curtain, splitter, skylight, filter,
  vent, and windows on cells where they are *outlets*) only matter where air
  reaches them, so they are only tried on cells some traced stream passes
  through, **including stalled inlets and extractor pull streams** (filters:
  only where smoke passes or on a pull stream; vents / outlet windows: only on
  wall cells where a stream ends blocked). Relevance is recomputed after every
  placement and passives are placed in any order (placing A can make B's cell
  relevant), with a visited set of canonical configuration keys.
* A solved configuration is never extended; a configuration where a placed
  passive has become idle (no stream touches it, not at a stream end, not on
  an extractor's pull ray) is not extended either.
* Iterative deepening on the number of pieces: **minPieces is exact even on
  timeout** once a solution is found.
* Counted solutions are **irredundant**: removing any one piece breaks them.
  Every minimal solution is counted.

Verified against brute force (every placement of every inventory subset, no
pruning) on the hand-made levels in `tests/fixtures/tiny-levels.json`, 40
deterministic random levels in the test suite, and ~13,000 random levels
during development.

### Performance (4-core container, Node 22, optimised engine)

| level | inventory | result |
|---|---|---|
| 1 First Breeze | 1 | exhaustive, 6 nodes, 4 ms |
| 9x6 calm room: fan + window | 2 | exhaustive, 9 solutions, 315 nodes, 7 ms |
| 11x6 two rooms: window 2 + vent + deflector | 4 | exhaustive (unsolvable), 1.3k nodes, 34 ms |
| 11x7 calm: fan 2 + window + deflector | 4 | capped at 1000 solutions, 650k nodes, 1.1 s |
| 13x9 two rooms: window 2 + deflector 2 + vent + filter | 6 | exhaustive (unsolvable), 107k nodes, 0.4 s |
| 11x8: window + fan + deflector + splitter + skylight | 5 | exhaustive, 720 solutions, 3.5M nodes, 8.4 s |
| 13x9: window 2 + fan + deflector 2 + curtain + filter | 7 | timeout at 10 s (4.4M nodes), exhaustive up to 4 pieces |

Throughput is about 300k-570k configurations/s (most nodes are leaves checked
with the cheap `WB.isSolved`; about 75% of the time is spent in the engine).
Each fan in the inventory multiplies the work by roughly 4 x (floor cells);
levels with 6+ pieces including fans usually time out - the verdict is then
`unknown`, but `minPieces` (if found) and "no solution with <= depth pieces"
are still exact. Use `--time 60000` for important checks.

## check-levels.js - all checks + stats

```
node tools/check-levels.js [--file chNN.json | --level 7,12-15 | --chapter 3] [--src dir]
                           [--fast] [--time ms] [--jobs N] [--targets] [--json]
```

A bare positional argument works too: `check-levels.js 6-10` or `check-levels.js levels/src/ch02.json`.

**Hard failures** (exit code 1):

* chapter files: invalid JSON (with line/col), more than 5 levels, `chapter` not matching the file name, duplicate chapters
* `WB.validateLevel` errors (map, sealing, size, placements, overlaps, solution fits inventory)
* `WB.introErrors` with the real level number (tools, objects, wind strengths not yet introduced)
* level already solved before anything is placed
* reference solution missing or does not solve
* tool intro levels (1, 6, 11, ..., 46): the new tool is missing from the inventory, or the level **is solvable without it** (solver with that tool excluded)
* the solver exhaustively proves the level unsolvable although the reference solves it (engine/solver bug)

**Warnings**: partial chapters, unknown level keys (typos), intro level without
a `tip`, intro check `unknown` (solver timeout), solvable with fewer pieces
than the reference, reference uses fewer pieces than the inventory (decoys)
before level 76, solver timeout, difficulty much lower than the previous
level's (more than max(5, 25%) lower; not reported on tool intro levels, which
are meant to be gentle), and with `--targets` the rough DESIGN.md section 7
targets (inventory / objects / rooms per level range).

```
   #  name                   map   rm inv ref obj hz wind  w/o  solver sols min    space     ms  diff
   1  First Breeze           9x5    1   1   1   1  0 W1    ok   exh       1   1        4      1   4.5
   2  Two Pinwheels          9x5    1   2   2   2  0 W1    -    exh       1   2        8      4   8.0
warn  ch01.json: partial chapter (2/5 levels)
OK: 2 levels, 0 failures, 1 warning (0.1 s, solver 3000 ms/search)
```

Columns: `rm` rooms (connected floor areas), `inv` inventory pieces, `ref`
reference-solution pieces, `obj` objects, `hz` hazards (candles, papers,
ferns), `wind` (`W2` = from west, strength 2), `w/o` intro check (`ok` = not
solvable without the new tool, `FAIL`, `?` = timeout, `-` = not an intro
level), `solver` (`exh`austive / `TIME`out / `cap`ped), `sols` counted
solutions, `min` fewest pieces, `space` configurations evaluated in the final
search pass, `ms` solver time, `diff` difficulty (`~` = estimate after a
timeout). Failing rows end in `FAIL`; the issue list follows the table.

`--fast` skips the solver (no intro-exclusion check, no difficulty). `--time`
is per search (intro levels run two searches), default 3000. Levels are
checked in parallel worker threads (`--jobs`, default min(4, cores - 1)).
`--json` prints `{summary, fileErrors, fileWarnings, levels: [...]}`, one level
per line.

### Difficulty score

```
D = log2(space)             configurations the pruned solver search had to evaluate
  + 2.0 * minPieces         pieces the player must place
  + 1.0 * decoys            inventory pieces not needed (inventory - minPieces)
  - 1.5 * log2(solutions)   many different solutions make a level easier
  + 1.0 * hazards           candles, papers, ferns
  + 0.5 * objects           goals that must hold at the same time
  + 1.0 * (rooms - 1)       extra rooms to route air through
```

Clamped at 0, one decimal. Level 1 scores 4.5; a 2-piece chapter-1 level about
8; expect roughly 25-40 for the hardest levels. After a timeout `space` and
`solutions` are lower bounds and `minPieces` falls back to the reference
length (shown as `~`). It is a heuristic for ordering levels, not a law:
compare levels within a chapter and look for big drops.

## build-levels.js - build js/levels.js

```
node tools/build-levels.js [--src dir] [--out file] [--check] [--quiet]
```

Validates every level with `WB.validateLevel` and writes nothing if anything
fails. Output is the UMD file the game loads (browser: `WB.CHAPTERS`,
`WB.LEVELS`; Node: `{ chapters, levels }`), one map row per line, with
`chapters: [{n, title, tool, first, last}]` (`tool` = `WB.TOOL_ORDER[n-1]`
for chapters 1-10, else `null`) and
`levels: [{id, chapter, name, tip?, wind, map, fixed, inventory, solution}]`.
Pieces are normalised (`d` only for fans / deflectors), zero inventory entries
dropped, unknown keys dropped. Output is deterministic; `--check` exits 1 if
the file is out of date. Missing chapters before the last one are a warning
(level ids would have a gap).

## lib.js

Shared helpers: `loadChapters(dir)`, `flatten(chapters)`,
`loadAllLevels(dir)`, `findLevel(n, dir)`, `levelNumber(chapter, index)`,
`resolveLevelArg(arg, flags)`, `countRooms(def)` (4-connected floor-ish
components; walls separate, doorways join), `levelFacts(def)`,
`jsonErrorOffset(text)`, `parseArgs`, and formatting helpers
(`pieceShort`, `piecesShort`, `inventoryString`, `windLong`, ...).

## Tests

`tests/tools.test.js` (fixtures in `tests/fixtures/`): lib (numbering,
rooms, chapter problems, JSON error positions, arguments), solver (exact
counts on tiny hand-made levels, brute-force comparison in both pruning modes,
random levels, options, timeouts), show (glyphs, rendering, CLI), build
(round trip through a temp file in Node and a browser-like VM, normalisation,
refusal on errors) and check (good and deliberately broken chapters, warnings,
difficulty). Run `npm test`.
