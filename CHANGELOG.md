# Changelog

Every release is merged to `main` with a version bump; work in progress lives
on the `dev` branch. The version is shown at the bottom of the level-select
screen.

## Unreleased — friendlier guides

* "Meet the …" cards (js/guides.js, 22 of them): every tool, object and twist
  gets a card the first time it turns up, with a looping mini demo drawn by
  the real board renderer (before and after, side by side and still with
  reduced motion), two or three plain points and how to use it. "Let's try
  it" folds the card into the guidance line above the board; "Show me"
  lights up where the new tool can go. A bottom sheet on phones, a panel
  beside the board on wide screens and landscape phones: never over the house.
* One voice: on a level that brings something new, the card (then its line)
  is the only guidance; practice levels keep just their tip. Tips say "from
  the left", not "from the west".
* The first level teaches itself in three soft steps pinned to the board
  (the wind comes in here, it stops at the red ×: put a window here, done),
  with a gentle word for a window placed off the breeze's path. The first
  fan says "Tap it to turn it". The "no way out" mark explains itself.
* Cards open again any time: press and hold (or right-click) a tool, the (i)
  on a selected tool, tap an object (with how it is doing right now), the (i)
  on the guidance line, or the new Field guide in Help.
* Level select: each chapter shows what it brings ("New: Fan", with its own
  icon, never a tool that has not arrived yet) or its challenge theme.
  Finishing a chapter gets a small "Chapter complete" moment and says what
  is next ("Next: meet the candle").
* Players coming back from v1.0 (solved levels here and there after the
  reorder) find every level up to their furthest solved one open.
* Gentle hints: the first press gives an idea in words about what is wrong
  ("The breeze needs a way out", "Try your fan: …"), never the answer;
  "Show me" (or a second press) shows one piece, picked so that following it
  rarely makes anything unhappy (and says so when it must). "That one isn't
  needed here. Put it back?" replaces the old wording. After a minute or 8
  moves without anything new becoming happy, the Hint button glows, and once
  a visit "Stuck? A hint is free" appears. Never automatic.
* Plain words everywhere: "blowing up ↑", "from the left", "lets air out";
  tips say "the other side" instead of "the far side". The wind badge reads
  "Wind → gentle" on every screen, its arrow made of one, two or three lines.
* Forgiving taps: tapping a window (or any piece that can't turn) shows what
  it does with a "Put back" button instead of silently removing it; tapping
  the selected tool again keeps it (with a little bounce and where it goes);
  a drop that misses says where the piece fits and keeps those spots lit;
  tapping an empty spot with nothing picked up says which tool to pick.
* Labelled Undo, Redo (new on screen), Clear (new eraser icon) and Hint on
  every screen size; tool names under the icons on phones; counts read "×2";
  the new tool has a small "New" label until it is first used.
* Settings (gear on the home screen, in the game's top bar on wide screens,
  and in Help): sound, Normal / Large text, less motion, show the guide cards
  again, and reset progress (moved off the home screen, last and quiet).
* Larger, darker teaching text (tips, cards, tooltips, chip names); tooltips
  stay at least 6 s on touch and close with the next tap.
* Help in layers: the goal in three pictures, the field guide, then folded
  "How air moves" (only rules for things met so far), controls for this
  device, and the keyboard. "How to play" under Play on the home screen.
* The goals bar says it in words: "Make the pinwheel spin", "2 of 3 happy",
  "Almost! One more to go", "Everyone is happy!"; a new thing's goal chip
  says hello once; an unhappy goal gets a red ring.
* A fan blowing straight into the wall next to it shows its bump (ripples and
  a quiet × on the wall) and says "straight into the wall, so no breeze". With
  less motion, flowing air is a solid line with arrowheads; a dashed line only
  ever means a breeze with no way out.
* Big houses on phones: a slimmer garden strip around the house (bigger
  tiles), more forgiving taps on small tiles, slightly bigger meters.

## v1.1 — One new thing at a time, and graphics you can restyle

* Gentler progression: chapters 1-15 each introduce exactly one new tool
  or object on their first level (a simple tutorial with a tip that
  explains it), followed by four practice levels that add nothing new.
  Tools: window 1, fan 11, deflector 21, curtain 31, wall vent 41,
  splitter 51, extractor 56, skylight 61, air filter 66, ceiling fan 71.
  Objects: candle 6, stove 16, laundry 26, papers 36, fern 46.
* Smaller twists (courtyards, calm days, hatched walls, tables, strong
  wind, gales) now each first appear alone, on the third level of a
  chapter, with a tip. tools/check-levels.js enforces all of this.
* 20 new gentle levels for the early chapters, levels re-slotted and
  reviewed; mastery chapters 16-20 (Still Air, Kitchen Rush, Storm Season,
  Crosswinds, Fresh Air). Levels that no longer fit are kept in
  levels/unused.json. Saved progress from v1.0 is carried over by level
  (js/migrate.js); unfinished boards are reset once.
* Graphics you can restyle without touching game code: js/theme.js holds
  every colour (light and dark), art/art.js swaps in your own SVG/PNG
  drawings and tunes speeds and sizes, studio.html previews everything
  live and exports ready-to-save files, and GRAPHICS.md walks you through
  it. The refactor is pixel-identical (58 reference pictures).
* Checks: 234 unit tests, every level rule on all 100 levels, visual
  regression and the 159-check end-to-end suite all pass.

## v1.0 — Windbreaker 1.0

* Release-candidate review fixes: progress is no longer lost when the game
  is open in two tabs; a board saved for an older version of a level is not
  restored onto the new design (boards saved before v1.0 are dropped once,
  solved levels are kept); the hint spots a wrongly turned piece anywhere in
  the solution; undo, redo and R are safe in the middle of a press or drag
  (R turns the piece being dragged); dirty laundry has its own grey smoke
  badge and a one-time note; a stove's tooltip says why its smoke is
  trapped; smoke clouds no longer cover objects; the "no way out" mark turns
  grey on a solved board; focus stays on the board after "Next level"; the
  keyboard cursor is announced to screen readers.
* Level 48 Backdraft gets a tip: a window facing the wind pushes air back.
* Docs brought in line with the code: README controls (tap turns fans and
  deflectors, other pieces go back to the tray; keyboard shortcuts), the
  project layout, the full engine API and the level checks.
* Final verification: 211 unit tests, every level check on all 100 levels,
  levels 96-100 proven to have exactly one solution, and the end-to-end
  suite (159 checks across mouse, touch, keyboard, phone to desktop sizes,
  storage disabled and file://) all green.

## v0.8 — Clean laundry, level redesigns, final UI polish

* New rule (from playtest feedback on levels 48 and 51): laundry needs
  clean air. Smoky air passing through it makes it dirty, shown as sooty
  grey washing with a red mark. Help, tooltips and the laundry card say so.
* The 17 levels whose solutions blew smoke through laundry were fixed: 15
  were repaired and independently reviewed (among them 48 Backdraft and
  51 Tailwind, where the playtest found it), and 66 and 93 were replaced by
  the redesigns below. In 15 Crossroads, 34 Wash House, 68 Round Trip and
  80 Chandelier the rule is now part of the puzzle: without it they would
  have extra or shorter solutions.
* Three levels that repeated earlier ideas were redesigned: 56 Eddy,
  66 Back to Back, 93 Broadside.
* 31 UI fixes from a new-player playthrough and a device audit: tooltips
  no longer cover the result of a turn, fans describe their own breeze,
  stream-end markers stay off objects, hint ghosts place the hinted piece,
  intro cards for new objects and tables, mute button in help, bigger
  board on large screens, locked levels explain how to unlock them.
* All 100 levels pass every check; levels 96-100 proven unique by
  exhaustive search; full end-to-end suite green (159 checks).

## v0.7 — Curated level progression

* Game-wide curation: levels reordered within chapters so difficulty
  rises, all 100 names unique (level 100 is now Spring Cleaning).
* Levels 86-100 proven to have exactly one solution each (exhaustive
  solver runs up to 2 minutes per level).
* Fresh-eyes playtest of the onboarding and every chapter boundary:
  levels 76 (Locked Study) and 86 (Gale Warning) rebuilt with new ideas,
  80 opened up, clearer tips on 8, 17, 61 and 96.
* Help text now explains exactly how breezes add up.
* Full end-to-end suite green: 159 checks across mouse, touch, keyboard,
  phone/tablet/desktop sizes, storage disabled and file://.

## v0.6 — Polished levels

* Applied the chapter reviewers' remaining notes across all 20 chapters
  (each verified with the solver first): clearer, shorter tips, tidier
  maps, fewer pointless tables, reworked levels that repeated an earlier
  idea or scored low on fun.
* All 100 levels still pass every check and are played through the real
  UI by the end-to-end test.
* Next: game-wide curation of names, order and difficulty curve.

## v0.5 — All 100 levels

* The full game: 100 levels in 20 chapters. Chapters 1-10 introduce a
  new tool every 5 levels (window, fan, deflector, curtain, wall vent,
  splitter, extractor, skylight, air filter, ceiling fan); chapters 11-20
  are themed mastery chapters (Drafts, Greenhouse, Library, Kitchen Rush,
  Laundry Day, Old Manor, Still Air, Storm Season, Crosswinds, Fresh Air).
* Every chapter designed, independently reviewed and revised.
* All 100 pass every level check; 96 are proven exhaustively by the
  solver (almost all with a single solution); the 4 hardest are proven to
  have no shorter solution up to 5 pieces.
* End-to-end test plays all 100 through the real UI; added redo
  (Ctrl/Cmd+Shift+Z, Ctrl+Y) and fixed Next skipping across gaps.
* Next: game-wide curation of names, order and difficulty curve.

## v0.4 — First 60 levels

* 60 real levels in 12 chapters replace the placeholders: all 10 tools
  are introduced (one every 5 levels) and the first two mastery chapters
  (Drafts, Greenhouse) mix them.
* Every chapter was designed, independently reviewed (shortcut hunt +
  first-time-player playthrough) and revised.
* All 60 pass every level check; the solver proves each one exhaustively,
  most have a single solution, and the fewest pieces always equals the
  intended solution. Difficulty rises from 4.5 to ~26.
* All 60 are solved through the real UI by the end-to-end test
  (tools/e2e.js), served under a sub-path like GitHub Pages.

## v0.3 — Refined UI after design review

* Three independent reviews (visual design, gameplay UX, robustness)
  applied: airflow strength drawn as parallel lanes, clearer inlet vs
  outlet windows, strength meters under laundry/papers/ferns, simpler
  glyphs on small tiles, darker walls in dark mode, AA button contrast.
* Win card is a bottom sheet with chapter progress; new-tool cards no
  longer move the board; landscape phones get a two-column layout.
* Better touch handling: drag anchoring, tap tolerance, snapping,
  long-press remove; tray scrolls the selected tool into view.
* Flat memory use, ~0.6 ms per frame; no console errors at 5 viewports in
  both themes, with reduced motion and from file://.

## v0.2 — Audited engine and level tools

* Engine is 4-10x faster (typed-array tracing); 208 rule tests, two
  independent audits and ~190k fuzzed configurations against a reference
  model with zero differences.
* Rule fix: smoke going round a loop is only trapped when the loop stays
  smoky; a loop through an air filter is fine (matches the in-game help).
* Level tools: exhaustive solver (verified against brute force on ~7,650
  random levels), checker for every level rule with difficulty scores,
  ASCII viewer, and the build step for js/levels.js.
* UI polish snapshots from the ongoing design review.

## v0.1 — playable proof of concept

* Airflow engine with all 10 tools and 6 objects (`js/engine.js`), specified
  in `DESIGN.md`.
* Canvas UI: level select, animated airflow, tool tray, hints, undo/reset,
  win card; works with mouse and touch, light and dark mode.
* Level tooling: build, check, solve and ASCII show CLIs; engine and tooling
  test suites.
* Three placeholder levels while the full 100-level set is being designed.
