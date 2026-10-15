# Windbreaker

A calm, minimalist browser puzzle game about airflow.

Each level is the floor plan of a little house. Open windows, place fans,
deflectors, curtains and more to steer the breeze: make the pinwheels spin and
the laundry dry, keep the candles lit and get the kitchen smoke outside.

* 100 levels, from very easy to properly tricky
* a new tool every 5 levels until all 10 are unlocked
* plays with mouse or touch, on phones and desktops, in light or dark mode
* no build step, no dependencies — just static files

## How to play

* The wind blows in from one side of the garden. A **window facing the wind**
  lets a breeze in; every other window lets air out.
* **A breeze only flows if it has a way out.** An inlet with no outlet stays
  still (you see its path as a faint dashed line).
* Strength is the number of lines in a stream: 1 is a gentle breeze, 2 is
  strong, 3 is a gale. Breezes from different sources add up where they meet.
* Make every object happy at the same time:

  | object | wants |
  |---|---|
  | Pinwheel | any breeze |
  | Candle | no air at all |
  | Stove | its smoke blown outside or through a filter, never into a wall |
  | Laundry | a strong breeze (2+) of clean air — smoke makes it dirty |
  | Papers | at most a gentle breeze (1) |
  | Fern | exactly a gentle breeze (1) |

* Tools, one new every 5 levels: window, fan, deflector, curtain, wall vent,
  splitter, extractor, skylight, air filter and ceiling fan.

**Controls:** tap a tool, then a highlighted cell (or drag it onto the board).
Tap a placed piece to turn it, drag it to move it, drag it off the board,
right-click or long-press to remove it. Undo (Ctrl/Cmd+Z), redo
(Ctrl/Cmd+Shift+Z), reset and a hint button are always there; `?` opens the
rules. Progress is saved in your browser.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
npm run serve        # http://localhost:8080
```

### Publish on GitHub Pages

1. Push this repository to GitHub.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick
   `main` and `/ (root)`, and save.
4. After a minute the game is live at
   `https://<your-user>.github.io/<repository>/`.

All paths are relative, so it works from any sub-path.

## How it works

* `DESIGN.md` — the rules, level format and engine API (the source of truth).
* `js/engine.js` — the airflow simulation (shared by the game and the tools).
* `js/render.js`, `js/game.js`, `css/style.css`, `index.html` — the game.
* `levels/src/chNN.json` — level sources, one file per chapter of 5 levels.
* `js/levels.js` — generated from the sources with `npm run build`.
* `tools/` — level checker, solver, ASCII viewer and end-to-end test
  (see `tools/README.md`).
* `CHANGELOG.md` — what changed in each release.

## Development

```sh
npm test             # engine + tooling unit tests
npm run check        # validate every level and verify it is solvable
npm run build        # regenerate js/levels.js from levels/src
node tools/e2e.js    # play every level through the real UI (needs Playwright)
```

No packages need to be installed; everything uses Node's standard library.
