# Versioning, release and local development

**Status: implemented.** Steps 0 to 7 are done; see `HANDOVER.md` for the
commits. What is left of this document is the reasoning behind the shape, which
is worth keeping: `docs/RELEASING.md` says what to do, this says why. Section 4
(what a deployment consumes) and section 10 (what is deliberately not here) are
the parts the runtime design still has to honour.

This exists because the games moved to their own private repository (EI-025) and
nothing yet says how an engine version and a set of games are put together, how a
fix reaches a classroom, or how anyone runs a game locally now that the games are
somewhere else. The last of those is needed today: the games have just been
migrated and nobody has opened one since.

Reviewed by Fable 5.1 twice, once for the versioning shape and once for this
document. Where a claim below was wrong the first time, the correction is marked,
because the wrong version was plausible and somebody will re-derive it.

---

## 1. Four versions, four reasons

They are separate because they move for different reasons. Conflating any two of
them means one moves when it should not.

| version | where | changes when | who notices |
|---|---|---|---|
| `ENGINE_VERSION` | `package.json`, `engine/version.js`, git tag `v1.2.3` | the engine code changes | the runtime, when it pins a release |
| `STATE_SCHEMA_VERSION` | `engine/engine.js`, integer | the *shape* of the saved state changes | `_migrateState()`, nobody else |
| `meta.version` | a game's `scenes.json` | the game's content changes | people, in release notes |
| `meta.saveVersion` | a game's `scenes.json`, integer | a content change makes old saves **unplayable** | every team mid-lesson, immediately |
| `ENGINE_API_VERSION` | `engine/version.js`, integer | the engine changes what it reports outwards | the dashboard |

Bump table, for the next person:

| you changed | bump |
|---|---|
| any engine code | `ENGINE_VERSION` (`npm version`) |
| a field in the saved state, or how one is read | `STATE_SCHEMA_VERSION` too |
| what the engine reports to the runtime or dashboard | `ENGINE_API_VERSION` too |
| a game's text, images, positions, hints; anything *added* | `meta.version` |
| renamed or removed a scene, item, flag, puzzle, event or content id | `meta.saveVersion` too, and schedule it |

### `meta.saveVersion`, and the correction that matters

`_signature()` is `meta.id|meta.version`, and `_restoreState()` discards a saved
state whose signature does not match. So **bumping `meta.version` wipes the
progress of every team playing that game at their next reload, silently.** It is
wired to the one field people bump out of habit when they fix a typo.

    _signature() → `${meta.id}|${meta.saveVersion ?? meta.version}`

**Corrected after review.** The first draft said "changing the signature format
is itself a wipe, so it must ship before anyone is mid-lesson". That is wrong,
and the truth is more useful. Verified:

    today                      demo|1.0.0
    engine change, no saveVersion   demo|1.0.0     ← identical, wipes nothing
    after adding saveVersion: 1     demo|1         ← this is the wipe

So the **engine change is a no-op** and can ship whenever. **Adding `saveVersion`
to a game is the scheduled event**, once per game, outside school hours. A game
written later gets it for free.

That also breaks a false coupling: the first draft tied this to EI-002 step two,
the storage key change, "because both must precede the first lesson". They are
two independent wipes, each scheduled on its own.

One consequence to record rather than discover: `_readLegacyState()` matches on
`signature + '|'`, so once a game sets `saveVersion` the old
`leeuwenhoek_escape_state` entry stops matching and legacy adoption becomes dead
code for it. Retire that path with EI-002 step two.

### What actually makes old saves unplayable

The rule a content author needs, because the engine cannot detect this and the
failure is silent.

**Safe without a `saveVersion` bump:** adding scenes, items, flags, puzzles,
events; changing any text, translation, image, rect, hint or theme.

**Needs a `saveVersion` bump:** renaming or removing any id a save can hold - a
scene, item, flag, puzzle ref, event id or content id - or changing what an
existing id *means*.

Why: `_normalizeState()` tolerates a stale id rather than crashing, and *inert is
the failure mode*. Rename a flag whose `once` event is already in `eventsFired`
and that event never runs again, so the gate it opened stays shut for every team
mid-lesson. Rename an item id behind `requireItems` and the door never opens.
Nothing throws; the team is simply stuck.

Two snapshots that surprise people:

- `state.hero` is a **copy** of the hero profile taken at first load. Fixing a
  hero's name or `assetsBase` never reaches a team already playing.
- `state.sceneImages` stores the **raw path** given to `setSceneImage`. Renaming
  that asset gives those teams the EI-003 timeout on every visit to the scene,
  not the new picture.

And one that is not a wipe but looks like one: an unknown scene id falls back to
the **start scene**. In a 22-scene game that is most of the way back to the
beginning, with inventory and flags intact. Expect it to be reported as data
loss.

### `ENGINE_API_VERSION`

The dashboard does not exist and EI-010 is not designed. What can be settled now,
for one integer, is that the engine **advertises** the shape of what it reports,
so a dashboard written for version 1 can tell it is talking to an engine speaking
2 and say so instead of mis-reading events.

```js
export const ENGINE_VERSION = '1.0.0';
export const ENGINE_API_VERSION = 1;
```

It is **stamped in `_saveState()`** beside `stateSchemaVersion` and never read
back - `_normalizeState()` is a whitelist and would drop it otherwise. Stamp
`engineVersion` with it: the first support call about a state blob will ask which
engine wrote it.

---

## 2. Local development

The piece needed today, and the one used every day after.

    ~/git/github/escape-game-engine
    ~/git/github/escape-games        ← clone it; it is not on this machine yet

`npm run dev` serves the engine from the working tree and games from both places:

    /                     index.html
    /engine/*  /styles/*  the working tree
    /games/demo/*         ./games/demo
    /games/<id>/*         ../escape-games/<id>, when present

    npm run dev
    npm run dev -- --games ../escape-games --games ../other-games
    npm run dev -- --host 0.0.0.0 --port 8080

`scripts/dev-server.mjs`, `node:http` and `node:fs`, no dependencies. It prints
each root's absolute path and the game ids found there at startup, so "why is my
game not there" is answered before it is asked.

The specification, because most of these are things that fail only on the device
that matters:

1. **Range requests.** The engine plays `<video>`. **iOS Safari sends
   `Range: bytes=0-1` first and refuses to play from a server that answers 200.**
   Handle `bytes=start-end` with 206, `Content-Range` and `Accept-Ranges`. Stream
   with `fs.createReadStream`; the videos are tens of megabytes. Python's
   `http.server` has the same gap, which is why desktop never showed it.
2. **MIME types, from a fixed table.** A module script served as anything but
   `text/javascript` is refused outright. `.svg` must be `image/svg+xml` or the
   demo's artwork is invisible. `charset=utf-8` on text types. Unknown →
   `application/octet-stream`.
3. **Path handling.** `new URL(req.url, 'http://x')` to drop the query;
   `decodeURIComponent` in a try/catch with 400 on `URIError`, because Czech
   filenames arrive percent-encoded; reject `..` and NUL **after** decoding;
   `path.resolve` and require the result to be the root or under it. Roots
   resolve relative to the script, not `process.cwd()`, so `../escape-games`
   means "beside the engine" from anywhere.
4. **Whitelist the mounts, do not serve the tree.** Exactly `/`, `/engine/`,
   `/styles/`, `/games/<id>/`. Everything else 404, including `/plans/`,
   `/package.json` and `/.git/`. `<id>` must match `^[a-z0-9-]+$`, which also
   keeps `/games/tests/` out, and a directory is a game only if it has
   `scenes.json`. Engine tree first, then external roots; warn when an id is in
   both.
5. **`Cache-Control: no-store` on everything.** The engine fetches JSON with
   `cache: 'no-cache'`, but modules, CSS and images fall under heuristic caching
   when no validators are sent. "Edit and reload" is only true with `no-store`.
   No ETag, no Last-Modified.
6. **Edges.** `stat` before open; a directory is 404 with no listing;
   `GET`/`HEAD` only, else 405; `HEAD` sends the length and no body;
   `/favicon.ico` → 204 to keep the console quiet; `EADDRINUSE` → one line and
   exit 1, not a stack trace.
7. **Testable by construction.** Export `resolveRequest(pathname, mounts)`
   returning `{file}` or `{status}` as a pure function and test traversal there.
   One integration test boots on port 0 and fetches the engine, the demo, an
   external game from a temp directory, `/..%2f`, and a `Range` request.

`--host 0.0.0.0` prints the LAN URL, which is how a real iPad opens it. That is
not decoration: the whole product runs on tablets, and EI-023 is waiting for
somebody to look at a puzzle on one.

**Not a production server.** No licence check, no caching, no compression. It
says so when it starts.

---

## 3. Cutting an engine release

    npm version patch      # or minor / major — this is the whole procedure
    git push && git push --tags

**Corrected after review.** The first draft ran a separate `release:check` after
`npm version`, which is too late: `npm version` commits and tags first, so a
failed check leaves a tag to delete by hand and `engine/version.js` is stale in
the tagged commit. The checks belong in npm's own lifecycle:

- **`preversion`** runs the suite. npm already refuses a dirty tree.
- **`version`** writes `engine/version.js` from `package.json`, verifies
  `CHANGELOG.md` has a section for the new version, and `git add`s both. npm
  folds them into the version commit. A non-zero exit aborts before the commit.

So the equality test between `engine/version.js` and `package.json` becomes a
guard against hand edits rather than a step somebody performs.

Pushing the tag runs `.github/workflows/release.yml` (`on: push: tags: ['v*']`,
`permissions: contents: write`), which re-runs the suite, `git archive`s the
files listed in `package.json#files` into `escape-game-engine-<version>.tar.gz`
with a `.sha256`, and attaches both to a GitHub Release. One list, in one place.

`.github/workflows/hello.yml` goes in the same commit; it echoes a line and
nothing reads it.

**`v1.0.0` is the one release that does not follow this.** `package.json` already
says 1.0.0, so `npm version` refuses, and the branch is not merged. Merge to
`main`, then `git tag -a v1.0.0` once, by hand. The docs must say so, or somebody
will fight npm for an afternoon.

---

## 4. What a deployment consumes

The runtime is out of scope (section 10). What is fixed here is only what the
engine promises, so the runtime can be written against it.

- A release is a **tarball plus a sha256**, attached to a GitHub Release, named
  for the tag. It contains `engine/ styles/ index.html LICENSE README.md` and no
  games.
- The engine is **prefix-relocatable**: every import under `engine/` is relative,
  the stylesheets contain no `url()`, `@import` or `@font-face`, and every
  runtime asset URL goes through `_resolveAsset()`. Verified. It runs from
  `/e/1.0.1/` with no build step.
- **Game asset paths must be relative.** `_resolveAsset()` passes through
  anything starting with `./` or `/`, so `/games/x/assets/y.png` in a game would
  work locally and 404 under a versioned prefix. A data test in both repositories
  forbids it. Cheap now, a breaking change later.
- A deployment records **one engine version and one games version** in a manifest
  it keeps in git. That file is the record of what is in production.
- Versioned paths are **immutable**: `/e/<engineVersion>/` and
  `/g/<gamesVersion>/<gameId>/` may be cached forever; the generated `index.html`
  is `no-store`.

One engine for all games. The defects worth fixing are engine defects and
concern every game at once, and six pins would be six chances to miss one. The
version is in the path, so two engines can be served side by side the day that is
actually needed.

**Never patch a vendored engine in place.** A patched copy is a version that
exists in no tag and cannot be reproduced. Every fix is a tag, then one line in
the manifest.

---

## 5. Releasing the games

**Corrected after review: the first draft implied a tag per game and never said
how.** Six version streams in one repository is the same mistake as six engine
pins, and `raven2cz/escape-games` has no tags at all today.

The games repository is versioned **as one unit**: one tag, `games-2026.09.1`
(year, month, counter). A content fix in one game re-tags the repository and
redeploys all six; the bytes of the other five do not change, and no team loses
anything, because saves depend on `meta.saveVersion`, not on the tag.

`meta.version` stays what it is: a human label for release notes, per game.

The games repository gets its own `release:check`: the tree is clean, the data
tests pass, and no game's `meta.saveVersion` was changed without a line in that
repository's `CHANGELOG.md` saying which game it wipes and when it is scheduled.

The deployment path is keyed by the **tag**, not by `meta.version`. Otherwise an
immutable URL is keyed by a string somebody is explicitly allowed to leave alone
while changing content, and the cache would serve stale bytes.

---

## 6. Fixes, and the teacher mid-lesson

**An engine fix.** Tag, bump `engine` in the manifest, deploy. A tablet already
running is untouched: its module graph is in memory. On the next reload it gets
fresh HTML, the new engine path, and **its state is restored**, because the
engine version is not in the signature. Reloading is what a person does when a
game looks stuck, so the fix lands exactly when it is wanted.

**A content fix.** Tag the games repository, bump `games` in the manifest,
deploy. Teams keep their progress as long as no `saveVersion` moved.

**A change that makes old saves unplayable.** Bump that game's `saveVersion`.
Every team of that game starts over at their next reload. Never a hotfix;
schedule it outside school hours and put it in the changelog.

**Rolling back is the one lossy direction.** `_normalizeState()` is a whitelist,
so an engine rolled back past a release that added a state field drops that
field. Fix forward. If a rollback cannot be avoided, do it when nobody is
playing.

---

## 7. Documentation

- **`docs/DEVELOPING.md`** - the two-repository layout, `npm run dev`, testing on
  a real iPad, running the tests in both repositories, the expected node version.
  Written first: it is the next session's first read.
- **`docs/RELEASING.md`** - the four versions and when each moves, the bump
  table, the rule from section 1 about what makes saves unplayable, `npm version`
  as the whole procedure, what CI does, releasing the games, how a fix reaches a
  classroom, rolling back. It must name `_signature()` and `_storageKey()` as the
  two functions an engine release may not touch outside a scheduled wipe.
- **`CHANGELOG.md`** in both repositories. The `version` hook requires an entry,
  so it cannot be forgotten.
- **README** - a short section pointing at both.

Written for the next agent session as much as for a person, and each says *why*,
because the reason is what stops somebody undoing it.

---

## 8. Tests

| what | where |
|---|---|
| `engine/version.js` matches `package.json`; `ENGINE_API_VERSION` is an integer | `engine.version.test.js` |
| `_signature()` uses `saveVersion` when present, and is unchanged without it | `engine.state-identity.test.js` |
| bumping `meta.version` alone keeps progress; bumping `saveVersion` starts over | same |
| `_saveState()` stamps `engineVersion` and `ENGINE_API_VERSION` | `engine.state-schema.test.js` |
| no game asset path starts with `./` or `/` | `games.data.test.js`, both repositories |
| every shipped game declares `saveVersion` | same, once each game has one |
| `resolveRequest()` refuses traversal, serves both roots, rejects non-game ids | `scripts.dev-server.test.js` |
| the server answers a Range request with 206 and the right MIME types | same, integration |
| `release-check` fails on a dirty tree, a version mismatch, a missing changelog | `scripts.release-check.test.js` |

`vitest.config.js` includes only `games/tests/**/*.test.js` with jsdom, so script
tests go there with `// @vitest-environment node`. Write `release-check` as an
exported function taking `{ root, runTests }` so its test can drive a temporary
git repository and does not run vitest inside vitest.

---

## 9. Order of work

0. **Clone the games repository** to `~/git/github/escape-games`. It is not here.
1. **`npm run dev`, and `docs/DEVELOPING.md` with it.** First, because it is what
   the owner needs now, because step 2 cannot be checked without it, and because
   EI-023 has been waiting for somebody to open a puzzle on a screen.
2. **`meta.saveVersion` and the signature change**, in the engine, with tests.
   Then, per game and separately, adding `saveVersion` to each `scenes.json` in
   the games repository - six files plus its test copy, and that is the wipe, so
   it is scheduled.
3. **`engine/version.js`**, `ENGINE_API_VERSION`, the stamping in `_saveState()`,
   the equality test.
4. **`CHANGELOG.md`**, the `preversion` and `version` hooks, `release.yml`,
   delete `hello.yml`. Then merge to `main` and tag `v1.0.0` by hand.
5. **The games repository's own `release:check` and `CHANGELOG.md`**, and its
   first tag.
6. **`docs/RELEASING.md`**, README.
7. **`engine/boot.js`** (section 11), if it is not folded into step 1.

---

## 10. Not in this plan

- The Worker, the manifest file, the vendoring script. They belong to
  `escape-runtime` and to the runtime design.
- EI-010, the progress events and the dashboard. Only the integer that will
  describe them is decided here.
- EI-002 step two, run and team identity in the storage key. Its design comes
  from the runtime, and it is no longer coupled to this work.
- Publishing to npm. Nothing can `npm install` at serve time, and a registry is a
  second artefact to keep in step with the tags.
- A `new-game` scaffold. It was not asked for and it needs a target repository.
  A checklist in `DEVELOPING.md` is enough until a seventh game is actually
  written.

---

## 11. `index.html` will fork, and it is cheap to prevent now

`index.html` carries the whole boot sequence inline, 110 lines: the query
parameters, the i18n fetch, constructing `Game`, wiring the buttons, the aspect
watcher. The Worker must generate its own HTML, because it injects the session,
the team and the game id. So it will copy that block, and from then on an engine
release that changes boot silently never reaches production.

**And the boot script is not all of it.** Above it sit 35 lines of DOM skeleton
whose nine element ids the engine takes by reference, and three `<link>` tags. A
`boot()` that takes those as given leaves two thirds of the fork in place.

So `engine/boot.js` exports `boot({ gameId, lang, baseUrl, storage, root })` and
**owns the skeleton and its stylesheets**, injecting them with
`new URL('../styles/style.css', import.meta.url)`. Then `index.html` and the
Worker's HTML are the same five-line shell with different arguments, and the
tarball really does contain the engine.

Two things worth doing while in there: make `Editor` a dynamic `import()` so a
tablet never fetches 53 KB of editor code or sees an Edit button, and take the
hardcoded Czech button labels from `ENGINE_I18N`.
