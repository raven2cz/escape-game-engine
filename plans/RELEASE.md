# Versioning, release and local development

Plan. Nothing here is implemented yet; `HANDOVER.md` says what is.

This exists because the games moved to their own private repository (EI-025) and
nothing yet says how an engine version and a set of games are put together, how a
fix reaches a classroom, or how anyone runs a game locally now that the games are
somewhere else. The last of those is needed today, not eventually: the games have
just been migrated and nobody has opened one since.

Written after advice from Fable 5.1 on the versioning shape, which is where the
`meta.saveVersion` split and the release-manifest idea come from.

---

## 1. Four versions, four reasons

They are separate because they move for different reasons. Conflating any two of
them means one of the two moves when it should not.

| version | where | changes when | who cares |
|---|---|---|---|
| `ENGINE_VERSION` | `package.json`, `engine/version.js`, git tag `v1.2.3` | the engine code changes | the runtime, when it pins a release |
| `meta.version` | a game's `scenes.json` | the game's content changes | people, in release notes |
| `meta.saveVersion` | a game's `scenes.json`, integer | a content change makes old saves **unplayable** | every team currently mid-lesson |
| `ENGINE_API_VERSION` | `engine/version.js`, integer | the engine changes what it reports to the runtime and the dashboard | the dashboard |

`STATE_SCHEMA_VERSION` already exists in `engine/engine.js` and stays as it is:
the shape of the saved state, handled by `_normalizeState()` and `_migrateState()`.

### Why `meta.saveVersion` is the important one

`_signature()` today is `meta.id|meta.version`, and `_restoreState()` throws away
a saved state whose signature does not match. So **bumping `meta.version` wipes
the progress of every team playing that game, at their next reload, with no
warning.** It is wired to the one field people bump out of habit when they fix a
typo.

Verified, and worth stating because it is the opposite of what one assumes:

- **An engine release never wipes anything.** The engine version is not in the
  signature. Moving all six games onto a fixed engine costs teams nothing.
- **A game content fix need not wipe anything either**, as long as
  `saveVersion` is untouched. `_normalizeState()` tolerates what a content change
  leaves behind: an unknown scene id falls back to the start scene, an unknown
  inventory item is skipped by `_renderInventory()`, unknown flags and puzzle ids
  are inert.

So:

    _signature() → `${meta.id}|${meta.saveVersion ?? meta.version}`

A game that sets `saveVersion` can then bump `meta.version` freely. Bumping
`saveVersion` stays what it always was - everyone starts over - but now it is a
deliberate act with a name that says so.

**This has to ship before the first paid lesson.** Changing the signature format
is itself a wipe, so it must happen while nobody is mid-lesson. The same is true
of EI-002 step two, which changes the storage key, so both belong in one
pre-launch engine release.

### `ENGINE_API_VERSION`, for the dashboard

The dashboard does not exist and EI-010 has not been designed. What can be
decided now, cheaply, is that the engine will **advertise** the shape of what it
reports, so that a dashboard written against version 1 can tell it is talking to
an engine that speaks 2 and say so, rather than silently mis-reading events.

    export const ENGINE_API_VERSION = 1;

It goes in the state and in whatever the runtime sees, and it moves only when the
reported shape changes - not when the engine is fixed. One integer now saves a
guessing game later. Nothing else about EI-010 is decided here.

---

## 2. Local development

The thing needed today. Two repositories, side by side:

    ~/git/github/escape-game-engine
    ~/git/github/escape-games

`npm run dev` in the engine repository starts a static server that serves the
engine from the working tree and games from **both** places:

    /                     -> index.html
    /engine/*, /styles/*  -> the working tree
    /games/demo/*         -> ./games/demo
    /games/<id>/*         -> ../escape-games/<id>, when it is there

so `http://localhost:5500/?game=warp-engine` works with no copying, no symlink
and no build, while `?game=demo` still works with the games repository absent.

    npm run dev                      # ../escape-games if present
    npm run dev -- --games <path>    # somewhere else
    npm run dev -- --port 8080

Written as `scripts/dev-server.mjs` with `node:http` and `node:fs` and no
dependencies. It prints, at startup, which games it found and where from, so
"why is my game not there" is answered before it is asked. Editing a JSON file
and reloading the page is the whole loop.

**Not a production server.** No caching, no compression, no licence check. It
says so when it starts.

---

## 3. Cutting an engine release

    npm version patch          # or minor / major
    npm run release:check
    git push && git push --tags

`npm version` updates `package.json` and makes the tag. `release:check`
(`scripts/release-check.mjs`) refuses to let a broken release out:

1. the working tree is clean
2. `engine/version.js` matches `package.json`
3. the whole suite passes
4. `CHANGELOG.md` has a section for this version

Pushing the tag runs `.github/workflows/release.yml`, which re-runs the suite,
then `git archive`s `engine/ styles/ index.html LICENSE README.md` into
`escape-game-engine-<version>.tar.gz`, writes a `.sha256` beside it, and attaches
both to a GitHub Release.

The tarball is the unit a deployment consumes. It deliberately contains no games.

**`engine/version.js`** exists so the running engine can say what it is:

```js
export const ENGINE_VERSION = '1.0.0';
export const ENGINE_API_VERSION = 1;
```

Duplicating the version in two files is a small price for a value that is
importable in the browser without reading `package.json`; a test keeps them
equal.

---

## 4. Assembling a deployment

This is the runtime's job and the runtime does not exist. What is fixed here is
the contract, so that the runtime can be written against it.

A third repository, `escape-runtime`, private: wrangler config, the Worker, and
one file that records what is deployed.

```json
{
  "engine": "1.0.1",
  "games": {
    "leeuwenhoek": "1.2.0",
    "warp-engine": "1.1.0"
  }
}
```

`scripts/vendor.sh` there downloads the engine tarball for `engine`, checks the
sha256, unpacks it to `public/e/1.0.1/`, and copies each game from a checkout of
the games repository at its tag into `public/g/<id>/<ver>/`. `public/` is not
committed; **`release.json` in git is the record of what is in production.**

URL layout:

    /e/<engineVersion>/engine/engine.js     immutable, public
    /g/<gameId>/<gameVersion>/scenes.json   immutable, session-gated
    /                                       generated per request, no-store

The engine's imports are all relative and its CSS contains no `url()`, so it runs
from any prefix with no build step. Verified.

Because the version is in the path, two engine versions can be served side by
side. The manifest pins **one** engine for all games. A per-game override is a
field that can be added the day it is needed and should not be added before then:
the defects worth fixing are engine defects, so they concern every game at once,
and six pins are six chances to miss one.

**The rule that makes this safe: never patch a vendored engine in place.** A
patched copy is a version that exists in no tag and cannot be reproduced. Every
fix is a tag, then one line in the manifest.

---

## 5. Fixes, and the teacher mid-lesson

**An engine fix.** Tag the engine, bump `engine` in the manifest, deploy. A
tablet already running is untouched - its module graph is in memory. On the next
reload it gets fresh HTML, therefore the new engine path, and **its state is
restored**, because the engine version is not in the signature. Reloading is
exactly what a person does when a game looks stuck, so the fix lands at the
moment it is wanted.

**A content fix.** New game tag, bump that game in the manifest, deploy. Teams
keep their progress as long as `saveVersion` is untouched.

**A change that makes old saves unplayable.** Bump `saveVersion`. Every team of
that game starts over on their next reload. Never a hotfix; schedule it outside
school hours.

**Rolling back is the one lossy direction.** `_normalizeState()` is a whitelist,
so an engine rolled back past a release that added a state field drops that
field. Fix forward. If a rollback cannot be avoided, do it when nobody is
playing.

---

## 6. Adding a game

    npm run new-game -- <id>

`scripts/new-game.mjs` writes the smallest game that passes every data test:
`meta` with `id`, `version`, `saveVersion`, one scene with `end: true`, an empty
`events`, an `i18n/cs.json`, and an `assets/` with a placeholder. It refuses an
id that already exists or is not a safe directory name.

The scaffold exists so that the checklist is executable rather than remembered.
The data tests then apply to the new game automatically, because they walk
directories rather than a list. Registering it in the runtime manifest is the one
manual step, and it is the step that should be manual.

---

## 7. Documentation

- **`docs/RELEASING.md`** - cutting an engine release, the four versions and when
  each moves, the git operations, what CI does, how a fix reaches a classroom,
  how to roll back. Written for somebody who has not read this plan.
- **`docs/DEVELOPING.md`** - running locally with `npm run dev`, the two-repository
  layout, adding a game, running the tests in both repositories.
- **README** - a short section pointing at both, replacing the current "Running a
  game".
- **`CHANGELOG.md`** - started at the current version, one section per release.
  `release:check` requires an entry, so it cannot be forgotten.

The audience is the next agent session as much as a person. Every one of these
says *why*, not only *how*, because the reason is what stops somebody undoing it.

---

## 8. Tests

Every item here gets one; the rule on this branch is that a fix has a test that
fails without it.

| what | test |
|---|---|
| `engine/version.js` matches `package.json` | `engine.version.test.js` |
| `_signature()` uses `saveVersion` when present | `engine.state-identity.test.js` |
| bumping `meta.version` alone keeps progress | same |
| bumping `saveVersion` starts over | same |
| every shipped game declares `saveVersion` | `games.data.test.js`, both repositories |
| `ENGINE_API_VERSION` is exported and an integer | `engine.version.test.js` |
| the dev server serves engine, demo and external games, and refuses to escape its roots | `scripts.dev-server.test.js` |
| `new-game` produces a game that passes the data tests | `scripts.new-game.test.js` |
| `release:check` fails on a dirty tree, a version mismatch, a missing changelog entry | `scripts.release-check.test.js` |

The dev server's path handling is worth a test of its own: it takes a URL and
maps it onto two different directories, and `..` in a request must not reach
either of them.

---

## 9. Order of work

1. `meta.saveVersion` and the signature change, with its tests. First, because it
   has to be in before anyone is mid-lesson, and everything else can wait.
2. `engine/version.js`, `ENGINE_API_VERSION`, the equality test.
3. `npm run dev`. Needed today for the migration.
4. `CHANGELOG.md`, `release:check`, `release.yml`, tag `v1.0.0`.
5. `new-game`.
6. `docs/RELEASING.md`, `docs/DEVELOPING.md`, README.

---

## 10. Not in this plan

- The Worker itself, `release.json`, `vendor.sh`. They live in `escape-runtime`
  and belong to the runtime design.
- EI-010, the progress events and the dashboard. Only the version field that
  will describe them is decided here.
- EI-002 step two, the run and team identity in the storage key. It has to ship
  in the same pre-launch release as the signature change, because both change
  what a returning tablet finds, but its design comes from the runtime.
- Publishing to npm. Nothing can `npm install` at serve time, and a registry is a
  second artefact to keep in step with the tags.

---

## 11. One thing that will bite, and is cheap now

`index.html` carries the whole boot sequence inline: reading the query
parameters, fetching the game's i18n, constructing `Game`, wiring the buttons,
the aspect watcher. Roughly a hundred lines.

The Worker has to generate its own HTML, because it injects the session, the team
and the game id. So it will copy that block - and from that moment, an engine
release that changes boot silently never reaches production, because the
production copy is in another repository.

Moving it to `engine/boot.js`, exporting `boot({ gameId, lang, baseUrl, storage,
root })`, makes `index.html` and the Worker's HTML the same five-line shell with
different arguments. Then the engine tarball actually contains the engine. It is
an hour now and a confusing afternoon later.
