# Changelog

Every release is merged to `main` with a version bump; work in progress lives
on the `dev` branch. The version is shown at the bottom of the level-select
screen.

## v0.1 — playable proof of concept

* Airflow engine with all 10 tools and 6 objects (`js/engine.js`), specified
  in `DESIGN.md`.
* Canvas UI: level select, animated airflow, tool tray, hints, undo/reset,
  win card; works with mouse and touch, light and dark mode.
* Level tooling: build, check, solve and ASCII show CLIs; engine and tooling
  test suites.
* Three placeholder levels while the full 100-level set is being designed.
