# Handover: finish the stabilization

Written for the agent session that picks this up in this repository. Read this
first, then `OPEN-ITEMS.md` for the findings and `STABILIZATION.md` for why the
order is what it is.

## Where things stand

    branch    fix/stabilization-audit
    base      main @ 5dbca85
    suite     123 passing, CI runs it on push and pull request

Done already:

| commit | what |
|---|---|
| `3db129a` | audit registry and stabilization plan |
| `967b385` | S0: green suite, CI, EI-008, EI-019 |
| `36c6e95` | S4 partial: EI-005, EI-009, EI-014, EI-015 partial, data tests |

Left for you, in this order: the reload harness, then **EI-001**, **EI-006**,
**EI-003**, **EI-013**, **EI-002**, **EI-011**, **EI-012**.

The reason these were not done in the previous session is that they interlock:
five of the seven are about what survives a page reload, and none of them can be
tested at all until the harness exists. Doing them piecemeal across sessions
would mean deciding the same thing twice.

## How to work here

- **Every fix needs a test that fails without it.** Verify that by stashing the
  fix, running the test, and restoring. This is not ceremony: two of the defects
  already fixed were found only because a test was written first, and one audit
  claim turned out to be wrong when checked.
- **Verify before you assert.** Three independent audits were run and each got
  something wrong. Read the code and confirm.
- **Comments and commit messages in English.** The user writes Czech, the
  repository is English. Do not mix.
- **Do not restructure beyond the item.** These are correctness fixes on a
  codebase nobody has touched since February. A large diff cannot be reviewed
  against a game that has to work in a classroom.
- Watch out for backticks in `git commit -m` inside a double-quoted shell string.
  They expand. Use `-F` with a file.

## Step 0: the reload harness

Everything below depends on it. Add it to `games/tests/` as a helper, not inside
one test file.

It has to:

1. mount the DOM skeleton (currently duplicated in five test files, this is the
   place to own it),
2. build a `Game` and run it to some point,
3. throw away everything in memory,
4. build a fresh `Game` that reads **only** what `_saveState()` persisted.

Step 3 is the part that matters. If any object survives, the harness will pass
tests that a real reload would fail, which is exactly the bug class being fixed.

## EI-001: once-events lose their effects on reload

**The bug.** `engine/engine.js` marks `eventsFired[ev.id]` and saves it before
running any action, while `setFlags` is the last action, after the awaited dialog
and video. A reload in between leaves the flag unset forever.

**Recommended fix, and it is small.** Move the `setFlags` block so it runs
**before** the event is marked as fired. Keep everything else in place.

This is safe because `setFlags` inside `_processEvents` only writes state and
calls `_saveState()`; unlike `_applyActions`, it does not re-enter
`_processEvents`, so moving it earlier cannot cause the recursion that the
marking was introduced to prevent.

**The alternative, and why it was not chosen.** Marking the event fired only
after all actions complete would also replay the dialog after an interrupted
run, which is arguably more correct. It was rejected because the action list
includes things that are not idempotent, and replaying a video or a puzzle after
every interrupted load is a worse failure than missing a dialog. If you take this
route anyway, you need an in-memory `_runningEvents` set for re-entrancy, and you
must audit every action for idempotency first.

**Tests.**

1. A once-event whose `then` has both `setFlags` and `openDialog`, interrupted
   while the dialog is open, still has its flags after the reload.
2. `warp-engine` end to end: reload during the victory dialog, then the exit
   hotspot is still reachable. This is the regression test for the worst defect
   found in the audit and it should name the game explicitly.

## EI-006: `setSceneImage` is not persisted

**The bug.** The handler mutates `sc.image` on the in-memory `this.data` only.
The event that made the change is `once`, so it never runs again.

**Two ways to fix it.** Persist `state.sceneImages[sceneId]` and prefer it in
`goto()`, or express the variant declaratively with `requireFlags` the way
hotspot `states` already work.

The declarative route is better and it is more work. It keeps the truth in the
flags, so it survives any state loss, and it removes a whole category of "the
world contradicts itself" bugs rather than one instance. Take it if the game data
can be changed too; otherwise the state field is acceptable.

**Test.** Trigger the event, reload through the harness, assert the scene renders
the changed image. Do it in `leeuwenhoek` where the chest is the real case.

## EI-003: `goto()` hangs and persists a broken scene

**Three separate problems in six lines**, and all three need fixing together:

1. `_saveState()` runs before the image is known to load, so an unusable scene is
   recorded as current and the player returns to it after a reload.
2. No `onerror` and no timeout, so a 404 or a stalled request never resolves.
3. `this.sceneImage.onload = ...` assigns rather than adds, so a second
   navigation steals the first one's handler and the first never settles.

**Fix.** A helper that takes a src and a navigation token, uses
`addEventListener(..., { once: true })` for both `load` and `error`, races
against a timeout that **resolves** rather than rejects, and ignores its result
if the token is stale. Persist the scene only after the transition succeeds. Show
the player something when an asset is missing; a silent freeze is the worst
possible outcome on a school network.

Compare with `engine/dialogs.js`, where the portrait preload already handles
`onerror` with a comment explaining this exact risk. The scene loader never got
the same treatment.

**Careful with the tests.** `games/tests/setup.localstorage.js` now stubs
`HTMLImageElement.prototype.src` so that assigning it fires `load` on the next
tick, otherwise jsdom never fires anything. A test for a failing or hanging image
has to override that descriptor. The stub is `configurable: true` for this reason.

**Tests.** An image that 404s still completes `goto()` and renders hotspots. An
image that never answers completes within the timeout. Two navigations in a row
both settle and the later one wins.

## EI-013: a double tap opens two dialogs or two puzzles

**The bug.** No transition lock on the hotspot layer, and `DialogUI` keeps a
single `_closeResolver` that a second `open()` overwrites, so whoever awaited the
first dialog waits forever. On a tablet this is a normal input, not an edge case.

**Fix.** One modal operation at a time. Disable the hotspot layer while a
transition is in flight, and make `open()` either settle the previous operation
or refuse the new one. Refusing is simpler and easier to reason about.

**Tests.** Two synchronous activations produce one runner. An awaited dialog
always settles, even when a second `open()` arrives.

## EI-002: state has no identity

**The bug.** One localStorage key, `leeuwenhoek_escape_state`, for every game and
every team on the device. The signature is `meta.id | version | lang`, so
switching language behaves like switching to a different game and destroys the
saved progress.

**Do this in two steps and only the first one here.**

Step one, now: namespace the key per game, and pull `_loadState` and `_saveState`
behind an injectable `opts.storage` with `load()` and `save(state)`, defaulting to
localStorage. Drop `lang` from the signature. This alone stops games destroying
each other, and it creates the seam the hosted runtime needs.

Step two, not here: run and team identity, `state:<sessionId>:<gameId>:<teamId>`.
The identity has to come from the runtime, which does not exist yet. Doing it now
would mean inventing an identity scheme that the runtime then contradicts.

**Worth including:** a one-time migration. If the old key exists and its signature
matches the game being loaded, adopt it and delete it. Somebody may be mid-game.

**Tests.** Two games keep independent state. Changing language preserves progress.
A state saved under the old key is adopted once and then gone.

## EI-011: consumed items are not saved

**The bug.** `_removeItemFromInventory()` splices the array and re-renders. It
never calls `_saveState()`. It is saved only by accident, when a following
`onApply` happens to change a flag or the scene.

**Fix.** One line, but do it as part of EI-002 rather than before it, because the
persistence call site is what EI-002 moves.

**Test.** Consume an item with no `onApply`, reload, assert it is gone. The
existing games all mask this, so the test needs its own fixture.

## EI-012: saved state has no schema

**The bug.** Any JSON whose signature matches is adopted as the state, with no
check that the expected fields exist. A state written by an older engine is
missing whatever was added since; `puzzleResults` is the concrete case and fails
on `undefined.push`.

**Fix.** A `stateSchemaVersion` independent of the game version, defaults filled
for every field, type checks, and an explicit migration path. An unknown scene id
should fall back to the start scene rather than freeze.

**Test.** Load a state missing each field in turn and assert the game still
starts. Load a state naming a scene that does not exist.

## Decisions that are not yours

These need the owner and are tracked as S5 in `STABILIZATION.md`. Do not decide
them, and do not work around them:

- **EI-004**, the repository is MIT and the licence covers `games/`, which are
  about to be sold.
- **EI-007**, whether the service worker and PWA are removed from the hosted
  runtime or repaired.
- **EI-017**, 318 MB tracked in git that has to be dealt with before the games are
  split into their own repository.
- **EI-020**, whether `games/demo` is deleted or ported.
- The oldest iPad that has to work, which decides whether `ResizeObserver` needs a
  runtime fallback and not just a test stub.

## Context beyond these documents

The audit and the fixes so far were done in an agent session anchored to the
Kabinet nápadů repository, which is the shop that sells these games. Its
transcript is at:

    ~/.claude/projects/-home-box-git-gitea-kabinet-napadu/e9cb649b-6472-4057-80bf-5f4ed09982c6.jsonl

It is about 7 MB, so read it selectively if at all. Everything needed to do the
work is in these three documents; the transcript is there for the reasoning
behind a decision, not as the brief.

What matters from the wider context: these games are sold as a licence to a
school, a lesson is started from the shop and played on a Cloudflare Worker
runtime that does not exist yet, and several teams play at once on shared
tablets. That is why "survives a reload" and "two teams on one device" are the
acceptance criteria for this work, rather than anything about features.
