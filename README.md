# Windbreaker

A calm, minimalist browser puzzle game about airflow.

Each level is the floor plan of a little house. Open windows, place fans,
deflectors, curtains and more to steer the breeze: make the pinwheels spin and
the laundry dry, keep the candles lit and get the kitchen smoke outside.

* 100 levels, from very easy to properly tricky
* new things arrive one at a time: each chapter introduces a single tool or
  object with a friendly "Meet the …" card and a little animated demo, then
  gives you four more puzzles with what you know
* friendly for every player: plain words (no compass directions), gentle
  step-by-step hints, labelled buttons, and settings for larger text and less
  motion
* restyle it yourself: colours, sizes, speeds and your own drawings (see
  `GRAPHICS.md` and `studio.html`)
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

* Tools, introduced one at a time with objects in between: window, fan,
  deflector, curtain, wall vent, splitter, extractor, skylight, air filter and
  ceiling fan.

**Controls:** tap a tool, then a glowing spot (or drag it onto the board).
Tapping the tool again keeps it picked up; tap the garden (or press Esc) to
put it down. Press and hold a tool (right-click with a mouse), or tap a thing
in the house, to see its card again; Help has a Field guide of everything you
have met. Tap a placed fan or deflector to turn it; tapping any other piece
says what it does, with a **Put back** button. Drag a piece to move it; drag it
off the board, right-click or long-press to put it back. The labelled Undo,
Redo, Clear and Hint buttons are always there (undo is also Ctrl/Cmd+Z; redo
is Ctrl/Cmd+Shift+Z or Ctrl+Y). Hints are free and gentle: the first press
gives an idea in words, the second ("Show me") shows one piece; after a while
without progress the Hint button glows softly. The **?** button opens How to
play, and the gear opens **Settings**: sound, larger text, less motion, the
guide cards again, and reset progress. With a keyboard: 1–9 and 0 pick a tool,
R turns the piece under the pointer, H shows a hint, I opens the card of the
selected tool (or of what the level brings), the arrow keys and Enter move
around the board and place or turn pieces, Delete puts one back, Esc puts the
tool down. Progress and settings are saved in your browser.

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
* `js/version.js` — the version shown on the level-select screen, bumped with
  every release.
* `js/render.js`, `js/game.js`, `css/style.css`, `index.html` — the game.
* `js/guides.js` — the "Meet the …" cards: what each tool, object and twist
  does, in plain words, and its little demo house. Edit the text right there
  (the comment at the top says how); `npm test` checks every demo.
* `GRAPHICS.md` — how the game looks and how to change it. It starts with a
  quick start for artists: colours, speeds and sizes, and your own drawings,
  all in one file (`art/art.js`), with the art studio (`studio.html`) as the
  workbench. Then the theme (`js/theme.js`, every colour for light and dark,
  shared by CSS and canvas), the sprite registry (`js/sprites.js`) and the
  visual regression check (`tools/visual.js`).
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
npm run e2e          # play every level through the real UI (needs Playwright + Chromium)
npm run visual       # compare the graphics with a baseline, pixel by pixel (see GRAPHICS.md)
```

The game, the unit tests and the level tools need nothing installed (Node's
standard library only). `npm run serve` fetches `http-server` through `npx`
(any static file server works), and the end-to-end test needs Playwright with
Chromium.
