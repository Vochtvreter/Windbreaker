# Changelog

Every release is merged to `main` with a version bump; work in progress lives
on the `dev` branch. The version is shown at the bottom of the level-select
screen.

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
