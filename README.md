# Windbreaker

A calm, minimalist browser puzzle game about airflow.

Each level is the floor plan of a little house. Open windows, place fans,
deflectors, curtains and more to steer the breeze: make the pinwheels spin and
the laundry dry, keep the candles lit and get the kitchen smoke outside.

* 100 levels, from very easy to properly tricky
* a new tool every 5 levels until all 10 are unlocked
* plays with mouse or touch, on phones and desktops, in light or dark mode
* no build step, no dependencies — just static files

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
* `tools/` — level checker, solver and ASCII viewer used to design levels.

## Development

```sh
npm test             # engine + tooling unit tests
npm run check        # validate every level and verify it is solvable
npm run build        # regenerate js/levels.js from levels/src
```

No packages need to be installed; everything uses Node's standard library.
