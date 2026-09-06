# Releasing

How a change gets from this repository into a classroom, and which version to
move when. `DEVELOPING.md` covers getting a game on screen; this covers shipping
one.

Read the first section before touching a version number. One of them ends every
lesson in progress, and it is not the one people expect.

---

## The four versions

They are separate because they move for different reasons. Conflating any two of
them makes one move when it should not.

| version | where | what it means |
|---|---|---|
| `ENGINE_VERSION` | `package.json`, `engine/version.js`, git tag `v1.2.3` | which engine this is |
| `STATE_SCHEMA_VERSION` | `engine/engine.js` | the *shape* of the saved state |
| `meta.version` | a game's `scenes.json` | a label for people, in release notes |
| `meta.saveVersion` | a game's `scenes.json`, integer | **whether an old save still applies** |
| `ENGINE_API_VERSION` | `engine/version.js`, integer | what the engine promises the dashboard |

### What to bump

| you changed | bump |
|---|---|
| any engine code | `ENGINE_VERSION`, with `npm version` |
| a field in the saved state, or how one is read | `STATE_SCHEMA_VERSION` as well |
| what the engine reports to the runtime or the dashboard | `ENGINE_API_VERSION` as well |
| a game's text, images, positions, hints; anything **added** | `meta.version` |
| **renamed or removed** any id a save can hold | `meta.saveVersion` as well, and schedule it |

### The one that ends lessons

`_signature()` is `meta.id | meta.saveVersion ?? meta.version`. A saved state
whose signature no longer matches is thrown away, at the team's next reload, with
nothing on screen to say so.

So:

- **Changing `ENGINE_VERSION` alone never loses anything.** The engine version is
  not in the signature. A team reloads onto the new code and their progress is
  still there, which is what makes an engine fix safe to ship during a school day
  - and useful, because reloading is exactly what somebody does when a game looks
  stuck.

  Note the "alone". It is the *version number* that is harmless, not every engine
  change: `_restoreState()` runs `_migrateState()` and `_normalizeState()` on
  load, and `init()` saves the result immediately. A release that makes
  normalisation stricter can therefore drop fields and write the smaller state
  back, without touching either function named below. Treat a change to those two
  as a change to the save format.
- **A content fix loses nothing either**, as long as `saveVersion` is untouched.
- **Bumping `saveVersion` restarts every team of that game.** Schedule it outside
  school hours and write it in the games repository's `CHANGELOG.md`;
  `release:check` refuses the release otherwise.

Two functions decide all of this: `_signature()` and `_storageKey()` in
`engine/engine.js`. **An engine release must not change either of them** except
as a deliberate, scheduled reset. If a change touches them, it is not a patch
release, whatever it does to the code.

### What actually makes an old save unplayable

The engine cannot detect this and the failure is silent, so it is a rule rather
than a check.

**Safe, no `saveVersion` bump:** adding scenes, items, flags, puzzles, events;
changing any text, translation, rect, hint or theme; replacing an image **at the
same path**.

**Needs a `saveVersion` bump:** renaming or removing any id a save can hold - a
scene, item, flag, puzzle ref, event id or content id - or changing what an
existing id *means*.

Why: `_normalizeState()` tolerates a stale id rather than crashing, and **inert
is the failure mode**. Rename a flag whose `once` event is already in
`eventsFired` and that event never runs again, so the gate it opened stays shut.
Rename an item id behind `requireItems` and the door never opens. Nothing throws;
the team is simply stuck, and no test will find it.

Three more that surprise people:

- `state.hero` is a **copy** of the hero profile taken at first load. Fixing a
  hero's name or `assetsBase` never reaches a team already playing.
- `state.sceneImages` stores the **raw path** given to `setSceneImage`. Renaming
  or moving that asset gives those teams an eight second timeout on every visit
  to the scene rather than the new picture, and if the `once` event that set it
  has already fired the new path is never installed at all. That is why "changing
  an image" is only safe when the path stays.
- An unknown scene id falls back to the **start scene**. Not a wipe - inventory
  and flags survive - but in a 22-scene game it will be reported as one.

---

## Releasing the engine

    npm version patch      # or minor / major
    git push && git push --tags

That is the whole procedure. The checks are in npm's lifecycle, so they run
**before** the commit and the tag rather than after:

- `preversion` runs the suite and checks `CHANGELOG.md` has an `## Unreleased`
  section with something under it. npm already refuses a dirty tree. **Nothing
  has been changed at this point**, so a failure here leaves the repository
  exactly as it was.
- `version` renames `## Unreleased` to `## <version>`, writes `engine/version.js`
  from `package.json`, and stages both. npm folds them into the version commit.

A non-zero exit from either aborts before the commit and the tag.

Write the changelog entry **first, under `## Unreleased`, and commit it.** npm
refuses a dirty tree, so an uncommitted entry stops the release before it starts;
`preversion` then checks the section exists and has something under it. The
`version` hook renames the heading to the number being cut, so nobody has to
predict what npm will call it.

**If the `version` hook does reject something**, npm has already rewritten
`package.json` and `package-lock.json`, and there is no commit and no tag. The
tree is left dirty. Undo it with:

    git checkout package.json package-lock.json

That is why the substantive check lives in `preversion`, where a failure changes
nothing at all.

**`git push && git push --tags` is two operations.** If the second fails, the
version commit is on the remote without its tag: push the tag again. If the
release workflow fails, the tag is there with no GitHub Release; fix the cause
and re-run the workflow rather than moving the tag.

Pushing the tag runs `.github/workflows/release.yml`, which re-runs the suite as
a guard against a hand-made tag, refuses a tag that disagrees with
`package.json`, and attaches to a GitHub Release:

    escape-game-engine-<version>.tar.gz
    escape-game-engine-<version>.tar.gz.sha256

The tarball contains `engine/ styles/ index.html LICENSE README.md` and **no
games**. Its file list comes from `package.json#files`, so there is one list
rather than two to keep in step. (It is not byte-identical to `npm pack`, which
always adds `package.json` whatever the list says. Nothing consumes an npm pack
of this project; the tarball is what a deployment takes.)

### The first tag is different

`v1.0.0` cannot be cut with `npm version`: `package.json` already says 1.0.0 and
npm refuses "Version not changed". Merge the branch to `main`, then once:

    git tag -a v1.0.0 -m "First tagged release"
    git push --tags

Every release after that is `npm version`.

---

## Releasing the games

In the games repository, which is versioned **as one unit**: one tag covering all
six games, named `games-<year>.<month>.<counter>`.

    npm test
    npm run release:check games-2026.09.1     # the previous tag
    git tag -a games-2026.09.2 -m "..."
    git push --tags

`release:check` refuses a dirty tree, a game with no `meta.saveVersion`, and a
`saveVersion` that moved since the last release without `CHANGELOG.md` announcing
it **by game and by number** - "leeuwenhoek … saveVersion 2 …". The id alone is
not enough, because every game is already named in the entry that introduced it.

Without an argument it finds the last `games-*` tag itself and says which one it
used. A ref that does not resolve is refused rather than passed over: it would
make every game look new, and a new game has no lessons to restart, so the check
would pass by saying nothing.

One tag for six games because the alternative is six version streams, six
conventions and six chances to miss one - the same argument as pinning one engine
rather than one per game. A content fix in one game redeploys all six and changes
the bytes of one. Nobody loses progress, because saves depend on `saveVersion`
and not on the tag.

---

## What a release promises about browsers

**iPadOS 15 / Safari 15, and equivalents.** Written down here because it is a
promise a release makes, and because the engine cannot check it: an unsupported
browser fails on syntax before any of this code runs.

Two consequences for anyone changing things:

- **Anything the engine uses must be in Safari 15.** There is no build step and
  no polyfill layer, so a newer API or CSS property is shipped raw. The failure
  is silent and total - a blank page - and no test in this repository can see it,
  because jsdom is not Safari.
- **Every HTML shell must carry the ES5 fallback block** from `index.html`: a
  `#boot-status` element and a classic script that replaces its text after ten
  seconds. It is what turns a blank tablet into a sentence a teacher can act on.
  When the hosted runtime generates its own HTML, this goes in it too.

Raising the minimum later is a product decision, not a technical one. Lowering it
is not available without a build subsystem; see the README and EI-027.

---

## Deploying

The hosted runtime does this and does not exist yet. What is fixed is the
contract:

- one **engine version** and one **games version**, recorded in a manifest the
  runtime keeps in git. That file is the record of what is in production.
- versioned, immutable paths: `/e/<engineVersion>/` and `/g/<gamesTag>/<gameId>/`
  may be cached forever; the generated `index.html` is `no-store`.
- the engine is **prefix-relocatable** - every import is relative, the
  stylesheets contain no `url()`, every asset URL goes through `_resolveAsset()`
  - so it runs from any path with no build step. A data test in both repositories
  keeps game asset paths relative, because an absolute one works on a dev server
  and 404s under a versioned prefix.

**Never patch a vendored engine in place.** A patched copy is a version that
exists in no tag and cannot be reproduced. Every fix is a tag, then one line in
the manifest.

---

## Fixing something in production

**An engine bug.** Write the changelog entry, `npm version patch`, push the tag,
bump `engine` in the manifest, deploy. A tablet already running is untouched: its
module graph is in memory. On the next reload it gets the new engine **and keeps
its state**. Safe during a lesson.

**A content bug.** Fix it, leave `saveVersion` alone, tag the games repository,
bump `games` in the manifest, deploy. Teams keep their progress.

**A content change that makes old saves unplayable.** Bump that game's
`saveVersion`, write in the games `CHANGELOG.md` which game it restarts and when,
and deploy outside school hours.

**Rolling back is the one lossy direction.** `_normalizeState()` is a whitelist,
so an engine rolled back past a release that added a state field drops that
field. Fix forward. If a rollback cannot be avoided, do it when nobody is
playing.

---

## Checklist for the next person

Before cutting an engine release:

1. `npm test` is green here and in the games repository.
2. `CHANGELOG.md` has a section for the version, written in terms of what a
   person would notice, not item numbers.
3. Nothing in the diff touches `_signature()` or `_storageKey()` unless a reset
   is intended and scheduled.
4. `npm version <patch|minor|major>`, then push with `--tags`.
5. The GitHub Release has both the tarball and its `.sha256`.
