# Changelog

Every release is merged to `main` with a version bump; work in progress lives
on the `dev` branch. The version is shown at the bottom of the level-select
screen.

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
