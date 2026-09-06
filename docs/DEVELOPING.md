# Developing

Read this first. [`RELEASING.md`](RELEASING.md) covers versions and releases;
this covers getting a game on screen and changing it.

One thing from there is worth knowing before you edit any game: **`meta.version`
is a label, `meta.saveVersion` is the switch that restarts every lesson in
progress.** Adding content is safe; renaming or removing an id a save can hold is
not. `RELEASING.md` has the rule.

## Two repositories, side by side

    ~/git/github/escape-game-engine     public, MIT — the engine and one demo game
    ~/git/github/escape-games           private — the six commercial games

Clone both into the same directory. Nothing links them: the dev server finds the
games repository beside the engine, and the hosted runtime will put a released
engine and a released set of games together itself.

    git clone git@github.com:raven2cz/escape-game-engine.git
    git clone git@github.com:raven2cz/escape-games.git

Node 20 or newer. The engine has no build step and no runtime dependencies; the
only packages are vitest and jsdom, for the tests.

## Running a game

    cd escape-game-engine
    npm install
    npm run dev

It prints what it found and where from:

    /home/box/git/github/escape-game-engine/games
      demo
    /home/box/git/github/escape-games
      heat-escape, leeuwenhoek, reactor, stop-train, time-factory, warp-engine

      http://127.0.0.1:5500/?game=demo

Then `?game=warp-engine`, `?game=reactor`, and so on. Edit a `scenes.json` in
either repository and reload the page; nothing is cached and nothing is copied.

Useful query parameters:

| parameter | what it does |
|---|---|
| `?game=<id>` | which game to open. Without it, the `DEFAULT_GAME` in `index.html` |
| `&lang=cs` | which `i18n/<lang>.json` to load |
| `&debug=1` | the engine's `_dbg` output in the console, and the puzzle layout logs |
| `&reset=1` | start this game over. Consumed once and removed from the URL |
| `&hero=eva` | pick a hero, in a game that defines more than one |

### On a tablet

The product runs on iPads and several things only fail there, so test on one.

    npm run dev -- --host 0.0.0.0

It prints the address to type into the tablet, which has to be on the same
network. `127.0.0.1` is not reachable from another device, which is why the
default is not enough.

### Options

    npm run dev -- --port 8080
    npm run dev -- --games ../escape-games --games ../another-content-repo
    npm run dev -- --host 0.0.0.0 --port 8080

**The `--` matters.** Without it npm eats the options and the server never sees
them.

If a game id exists in both roots, the engine's own copy wins and the server says
so at startup. That is how `demo` and `leeuwenhoek` coexist: they are the same
content under two names, one public and one sold.

### What the dev server is not

No licence check, no caching, no compression, no HTTPS. It says so when it
starts. It exists so that a game can be opened and edited; the hosted runtime is
a different thing entirely and is what decides who may play.

It does do three things a plain static server does not, all of them because of
tablets:

- **Range requests.** iOS Safari asks for `bytes=0-1` before it will play a video
  and refuses a server that answers `200`. `python -m http.server` does not do
  this, which is why videos worked on a desktop and not on an iPad.
- **A fixed MIME table.** A module script served as anything but
  `text/javascript` is refused outright, and an `.svg` served as text is
  invisible.
- **`Cache-Control: no-store` on everything**, so that editing a file and
  reloading really is the whole loop.

## Tests

    npm test                          # in the engine repository, 275 tests
    cd ../escape-games && npm test    # 15 tests, needs no engine

CI runs both on every push and pull request.

The engine's suite lives in `games/tests/`. Two things to know before adding to
it:

- **`helpers/reload.js`** simulates a page reload: `boot()` builds a fresh `Game`
  on a fresh DOM that reads nothing but what was persisted, and `bootDetached()`
  does the same without awaiting `init()`, which is how a run is stopped at a
  point where the engine is blocked on the player. Everything about what survives
  a reload goes through it.
- **Data tests** (`games.data.test.js`, `readme.contract.test.js`,
  `engine.neutrality.test.js`) check the games, this documentation and the engine
  rather than a unit of code. They catch the class of defect where nothing is
  wrong with the code: a game that cannot signal it was finished, a documented
  field the engine ignores, an asset that is not there.

The rule on this project: **a fix has a test that fails without it.** Check that
by reverting the fix and watching the test fail, not by assuming. Four tests on
this branch were found passing whatever the code did, and reverting is what found
them. `git stash` only works while the fix is uncommitted; after that, revert it
in a throwaway copy.

## Adding a game

A game is a directory of data. There is no code in a game.

    <game-id>/
      scenes.json      scenes, hotspots, items, events, content panels
      puzzles.json     puzzle configurations
      dialogs.json     characters and dialog trees (optional)
      i18n/cs.json     translations
      game.css         per-game theme overrides (optional)
      assets/          images, video, backgrounds

Put it in the games repository, or in the engine's `games/` only if it is meant
to be public. The data tests then cover it automatically, because they walk
directories rather than a list.

The checklist they enforce, which is also the checklist for a new game:

1. `meta.id` equals the directory name.
2. `meta.version`, and `meta.saveVersion` — see `RELEASING.md` for which is
   which and when each moves.
3. Exactly one scene has `end: true`. Completion is detected from it, and
   `reactor` once shipped without it.
4. Every `puzzle` hotspot has a `puzzleRef`. Without it the engine logs an error
   and opens nothing, which is how the old demo became unplayable unnoticed.
5. Every asset path a game references exists, and is **relative** — `assets/…`,
   never `./assets/…` or `/games/…`. An absolute path works locally and 404s
   under the runtime's versioned prefix.
6. No game carries another game's identity.

The authoring reference — every field the engine reads, and what it ignores — is
in the engine's README. It is checked against the code by
`readme.contract.test.js`, so it does not drift.
