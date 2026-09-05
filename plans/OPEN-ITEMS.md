# Open items

Registry of known defects and open decisions. One line per item in the table,
detail below. Rules: numbers are never reused or renumbered; a resolved item is
marked `DONE` and stays in the registry. New items go at the end with the next
free number.

Source: audit on 2026-09-05 by three independent passes (Claude Opus 5, Fable 5.1,
codex SOL). Every item below was then verified by hand in the code, so no entry
here is second-hand.

| #      | prio | status | topic                                                          |
|--------|------|--------|----------------------------------------------------------------|
| EI-001 | P1   | DONE   | Once-events can be marked done before their effects apply       |
| EI-002 | P1   | OPEN   | One saved state for every game and every team                   |
| EI-003 | P1   | OPEN   | goto() hangs on a missing image and persists the broken scene   |
| EI-004 | P1   | OPEN   | MIT licence also covers `games/`                                |
| EI-005 | P2   | DONE   | `reset=1` stays in the URL and wipes progress on every reload   |
| EI-006 | P2   | DONE   | `setSceneImage` is not persisted                                |
| EI-007 | P2   | OPEN   | Service worker precache is broken, and cache-first is unsafe    |
| EI-008 | P2   | DONE   | Inventory items cannot be activated from the keyboard           |
| EI-009 | P2   | DONE   | `runPuzzleList` is called but never defined                     |
| EI-010 | P2   | OPEN   | Progress signal differs per game, no single source for a dashboard |
| EI-011 | P3   | OPEN   | Consumed item removal is not saved                              |
| EI-012 | P3   | OPEN   | Saved state has no schema, validation or migration              |
| EI-013 | P3   | OPEN   | A double tap can open two dialogs or two puzzles                |
| EI-014 | P3   | DONE   | `reactor` is missing the `end` flag on its final scene          |
| EI-015 | P3   | PART   | Leftovers from the first game hardcoded as if they were generic |
| EI-016 | P4   | DONE   | 5 of 113 tests fail on main and CI never runs them              |
| EI-017 | P4   | OPEN   | 318 MB of material tracked in git that does not belong there    |
| EI-018 | P4   | OPEN   | Dead code, and a README documenting an API the engine lacks     |
| EI-019 | P3   | DONE   | Inspecting a second item showed the first item's name           |
| EI-020 | P3   | OPEN   | `games/demo` is not playable and is excluded from the data tests |

Where the fix lands is decided in [STABILIZATION.md](STABILIZATION.md).

---

## EI-001: Once-events can be marked done before their effects apply

**Priority:** P1. This is the only defect in the list that can end a lesson.

**Where:** `engine/engine.js:1384` (mark and save), `:1400` (setSceneImage, awaits),
`:1417` (openDialog, blocks), `:1441` (playVideo, blocks), `:1487` (setFlags, last).

**What happens.** When an event matches, `eventsFired[ev.id]` is written and
persisted immediately, before any action runs. The comment above it says this is
deliberate, to stop a blocking action from re-triggering the same event while it
is still awaiting. But the durable consequence of the event, `setFlags`, is the
very last thing executed, after the dialog and the video have been awaited.

So there is a window, as long as the pupil takes to click through a dialog, in
which the event counts as done but its flags are not set. If the tablet reloads,
sleeps, or the tab is killed in that window, the flags are lost permanently: the
event is in `eventsFired` and will never run again.

**Why it matters.** In `warp-engine` this is unrecoverable. Verified chain:

    games/warp-engine/scenes.json  event "warp-ready", once, fires when all six
                                   slots are filled
      then: setSceneImage -> openDialog "warp-core.victory" -> setFlags
                                                               ["warp_engine_active"]
    games/warp-engine/scenes.json  scene "warp-core", hotspot goTo "exit"
                                   requireFlags ["warp_engine_active"]

A team that reloads during the victory dialog can never leave. The only way out
is a full restart, which throws away the whole lesson. Milder version of the same
bug: intro dialogs and the heat-escape intro video are skipped forever after an
interrupted first load.

**Status:** DONE in S1.

**Fix as applied.** The `setFlags` block in `_processEvents` was moved so that it
runs *before* the event is marked as fired, and nothing else changed. Flags are
the durable consequence of an event; everything else in `then` is presentation
and most of it blocks on the pupil. Verified safe: unlike `_applyActions`, this
block only writes state and calls `_saveState()`. It never calls
`_stateChanged()`, so it cannot re-enter `_processEvents`, which is the only
thing the early marking was there to prevent.

**The alternative, and why it was not taken.** Persisting `eventsFired` only
after all actions complete, with an in-memory `_runningEvents` guard, would also
replay the dialog after an interrupted run. That is arguably more correct, and it
was rejected because the action list contains things that are not idempotent:
`playVideo` and `openPuzzle` would run again on every interrupted load. Losing a
line of dialogue is a smaller failure in a classroom than replaying a video. The
consequence is recorded as a test of its own, so the trade-off is deliberate
rather than accidental.

**Tests.** `games/tests/engine.events.reload.test.js` (flags survive; the event
does not replay; the hotspot the flag gates is still usable) and
`games/tests/warp-engine.reload.test.js`, which runs the real chain above against
the real game data and walks to the exit. Both verified to fail before the fix.

---

## EI-002: One saved state for every game and every team

**Priority:** P1.

**Where:** `engine/engine.js:174` (remove), `:1640` (save), `:1645` (load). The key
is the literal string `leeuwenhoek_escape_state`, the name of the first game.

**What happens.** There is exactly one localStorage entry per origin. The saved
object carries a `signature` of `meta.id | version | lang`; on mismatch the engine
builds a fresh state and, through hero initialisation, writes it straight back
into the same slot.

**Why it matters.** Three separate failures, all of them realistic in a classroom:

- Two teams on one tablet: the second team resumes the first team's inventory,
  flags, solved puzzles and scene. Intro content is skipped because it is already
  in `eventsFired`.
- Two games on one tablet: opening game B destroys the saved progress of game A,
  even if the pupil switches back immediately.
- Two tabs of the same game: each holds its own copy of the object and the last
  `_saveState()` wins.

**Fix.** Namespace the key. Short term `state:<gameId>` already removes the
cross-game destruction. For classroom use the key needs a run identity, at minimum
`state:<sessionId>:<gameId>:<teamId>`, where the identity comes from the runtime
rather than from the page.

Pull `_loadState` and `_saveState` behind an injectable storage interface
(`{load(), save(state)}`) so the hosted runtime can put the authoritative copy in
a Durable Object and keep localStorage as a local cache only. That seam is also
what EI-010 needs.

Drop `lang` from the signature. Language does not change progress, and today
switching it behaves like switching to a different game.

**Test.** Two Game instances with different game ids write and read independent
state. Switching language preserves progress. A saved state from game A is still
intact after game B has been played and closed.

---

## EI-003: goto() hangs on a missing image and persists the broken scene

**Priority:** P1.

**Where:** `engine/engine.js:185` (save happens first), `:187-191` (load without
`onerror`, handler assigned rather than added).

**What happens.** Three problems in six lines:

1. `_saveState()` runs before the scene image is known to load, so a scene that
   cannot be displayed is still recorded as the current one.
2. The promise resolves only on `onload`. There is no `onerror` and no timeout, so
   a 404 or a stalled request never resolves and `goto()` never returns. Hotspots
   are not rendered, scene events do not run, nothing further is saved.
3. `this.sceneImage.onload = ...` assigns rather than adds. Two fast taps on two
   navigation hotspots mean the second call overwrites the first handler and the
   first promise is never settled.

**Why it matters.** School networks lose requests. The pupil sees a frozen game,
reloads, and lands back in the same broken scene. Note the contrast with
`engine/dialogs.js:256`, where the portrait preload does have
`img.onerror = resolve` and a comment explaining exactly this risk. The scene
loader never got the same treatment.

**Fix.** One-shot `load` and `error` listeners, a timeout (8 s is a reasonable
first guess) that resolves rather than rejects, a navigation token so a stale
load cannot resolve a newer navigation, and persistence of the scene only after
the transition succeeds. A visible message when an asset is missing beats a
silent freeze.

**Test.** A scene whose image 404s still finishes `goto()` and renders hotspots.
Two navigations in a row both settle and the last one wins. Note this also fixes
the test-environment hang described in EI-016.

---

## EI-004: MIT licence also covers `games/`

**Priority:** P1, but it is a decision, not a code change.

**Where:** `LICENSE`, plain MIT, `Copyright (c) 2025 Antonin Fischer`. Verified:
the file contains no exception for `games/` or for assets.

**What happens.** MIT grants the right to use, copy, modify, merge, publish,
distribute, sublicense and sell. As written it applies to everything in the
repository, including the games that are about to be sold to schools.

**Why it matters.** Anyone holding a copy of the repository as it stands has a
written licence that is broader than the per-school licence being sold. Moving the
games into a private repository does not undo it, because the licence text travels
with the content that was published under it.

**Fix.** A decision for the owner. The usual shape is: engine stays MIT, games and
their assets get their own proprietary licence, with the split stated in both
repositories and in the file headers. This should be settled before the games are
separated, not after.

**Test.** None. This is reviewed, not tested.

---

## EI-005: `reset=1` stays in the URL and wipes progress on every reload

**Priority:** P2.

**Where:** `engine/engine.js:135` reads the parameter on every `init()`. Verified:
`history.replaceState` appears nowhere in the engine.

**What happens.** `?reset=1` is evaluated at every start, not once. Every demo
link in the README carries it.

**Why it matters.** If a teacher hands out a QR code containing `reset=1` so that
teams start clean, then any pupil who reloads mid-game silently loses everything.

**Fix.** Consume the parameter once and strip it with `history.replaceState`. In
hosted mode a new run should come from a runtime endpoint returning a fresh run
id, not from a query parameter the pupil can edit.

**Test.** After `init()` with `reset=1`, the parameter is gone from the URL and a
second `init()` loads the saved state.

---

## EI-006: `setSceneImage` is not persisted

**Priority:** P2.

**Where:** `engine/engine.js:1400-1413`. Verified: the handler mutates
`sc.image` on the in-memory `this.data` only, and no `sceneImages` or
`sceneOverrides` field exists anywhere in the engine.

**What happens.** The change lives only until the page is reloaded. Because the
event that made the change is usually `once`, it does not run again.

**Why it matters.** The world contradicts itself. In `leeuwenhoek` the chest is
closed again after a reload even though `chest_opened` is set and the key is in
the inventory. In `warp-engine` the core is dark again although the engine is
active.

**Status:** DONE in S1.

**Fix as applied.** `state.sceneImages[sceneId]` is written and saved by the
handler, and `goto()` reads it through a new `_sceneImageSrc(scene)`. The
mutation of `this.data` was dropped: `this.data` is rebuilt from the game files
on every load, so it was never the right place for it. Nothing else in the engine
reads `scene.image`, verified.

**The declarative route, and why it was not taken.** Expressing the variant with
`requireFlags`, the way hotspot `states` do, keeps the truth in the flags and
would be preferable in isolation. It was not taken here because scenes have no
state mechanism today, so it would mean adding one to the engine, editing two
games' data, and keeping `setSceneImage` alive anyway for compatibility: two
mechanisms for one thing, in a batch whose diff has to stay reviewable against a
game that must work in a classroom. With EI-001 fixed the state field is as
durable as a flag. Worth revisiting when scene states are wanted for their own
sake, not as a fix for this.

**Tests.** `games/tests/engine.scene-image.reload.test.js`, against leeuwenhoek's
real data, where the chest is the actual case. Verified to fail before the fix.

---

## EI-007: Service worker precache is broken, and cache-first is unsafe

**Priority:** P2.

**Where:** `service-worker.js:3-9` (precache list), `:12` (fetch handler),
`manifest.webmanifest`.

**What happens.** Verified by resolving every path in the precache list: **15 of 19
do not exist.** Missing are `style.css` (it is `styles/style.css`),
`engine/puzzles.js` (it is `engine/puzzles/index.js`), `game/scenes.json` (games
live in `games/<id>/`), and twelve `assets/*.jpg` files from the original
single-game layout. `cache.addAll()` is atomic, so install always rejects and
`?pwa=1` is a silent no-op today.

**Why it matters.** Two ways, in opposite directions. Right now offline mode does
not work at all and nobody notices. And if the list were simply repaired, the
fetch handler is cache-first with no scope limit, so `index.html` and any game
files would be pinned until `CACHE_NAME` changes. A licence check performed by the
Worker would stop applying after the first load, and a later group on the same
tablet could still be served content after the licence ended.

**Fix.** Decision needed. Recommendation: drop the service worker and the manifest
from the hosted runtime entirely. Offline play and a per-lesson licence are close
to contradictory, and the current file is dead weight. If offline is wanted later,
it needs a per-release asset manifest, a cache partitioned per session, and
network-first for anything the licence gates.

**Test.** If removed: none needed. If kept: an install test that fails when a
precache path does not resolve, so this cannot silently rot again.

---

## EI-008: Inventory items cannot be activated from the keyboard

**Priority:** P2.

**Where:** `engine/engine.js:851-861` (activation on `pointerup`), `:864` (the
`click` listener, which only calls `preventDefault`).

**What happens.** Activation moved to pointer events so that a tap could be told
apart from a drag. The `click` handler that remains does nothing but cancel the
default. The element is a real `<button type="button">`, so Enter and Space
produce a `click` and no `pointerup`, and therefore do nothing at all.

**Why it matters.** On a tablet nobody notices. On a laptop, and for anyone using
the keyboard, inventory is unusable. It is also the cause of one of the two
non-environmental test failures in EI-016.

**Fix.** Put the activation logic back on `click` and keep pointer events only for
distinguishing a drag. Then the existing test passes unchanged, which is the point.

**Test.** Already exists: `games/tests/engine.use.test.js:180`. Add keyboard
activation via a dispatched `click` from `KeyboardEvent`.

---

## EI-009: `runPuzzleList` is called but never defined

**Priority:** P2.

**Where:** `engine/puzzles/index.js:192`. Verified: one call site, zero
definitions, zero imports.

**What happens.** A `ReferenceError` for anything reaching that path, namely the
`puzzleList` hotspot type (`engine/engine.js:581`) and the `openPuzzleList` event
action (`:1469`).

**Why it matters.** No shipped game uses it, so it is invisible today. But the
README documents it, so the first author writing a game in the new private
repository will hit it. Dead and broken at the same time is the worst combination,
because it looks supported.

**Fix.** Delete `openListModal`, both call sites and the README section. Sequences
already work through `kind: list` with `puzzleRef`, which is what heat-escape uses.
Reimplementing is possible but there is no demand for it.

**Test.** A test asserting the hotspot type is rejected with a clear message rather
than a `ReferenceError`, if the type is kept at all.

---

## EI-010: Progress signal differs per game, no single source for a dashboard

**Priority:** P2, and it is design input rather than a defect to patch.

**Where:** `engine/engine.js:548` and `:571` (`solved['solved:pz:' + ref]`, only
for hotspot puzzles that are not `aggregateOnly`), `:683` (`puzzleResults`, only
for `aggregateOnly`), `:1448` (the `openPuzzle` event path writes no `solved` at
all), `engine/puzzles/kinds/list.js` (per-step results live in memory and are
discarded).

**What happens.** Every game signals progress differently. heat-escape and
warp-engine track custom flags such as `solved_room1`; the others rely on
`solved:pz:*` and the inventory. Completion is either `scene.end`, which is
displayed but never stored, or a `game_completed` flag set by a dialog, which
EI-001 can lose.

**Why it matters.** The teacher dashboard cannot show anything comparable across
games, and nothing distinguishes a legitimate finish from someone navigating to
the exit scene. Attempts, mistakes and timings are not recorded anywhere.

**Fix.** One emission point rather than per-game conventions. The natural seam is
the puzzle runner wrapper in `engine/puzzles/index.js:71-94`, which every kind
including list steps already goes through, plus explicit emissions for run start,
scene entered, item taken and run completed. Events carry a sequence number, a
timestamp and a run id; the runtime keeps the authoritative snapshot.

Do this together with the hosted runtime design, not before. The shape of the
event has to match what the Durable Object stores and what the dashboard reads.

**Test.** Deferred with the design.

---

## EI-011: Consumed item removal is not saved

**Priority:** P3.

**Where:** `engine/engine.js:278` (`_removeItemFromInventory`, verified: it
splices the array and re-renders, and never calls `_saveState`), used from `:500`
and `:1091`.

**What happens.** The item disappears from the screen but not from storage. It is
saved only by accident, when a following `onApply` action changes a flag or the
scene and triggers a save for its own reasons.

**Why it matters.** Every current use in the shipped games happens to be followed
by such an action, so nothing is visibly wrong today. The first game that uses
`consume: true` with only a message will have the item back after a reload, and
the puzzle it was consumed by will already be solved.

**Fix.** Make item removal part of one atomic state mutation that always persists.
The same applies to anything else that edits `this.state` directly.

**Test.** Consume an item with no `onApply`, reconstruct from persisted state,
assert the item is gone.

---

## EI-012: Saved state has no schema, validation or migration

**Priority:** P3.

**Where:** `engine/engine.js:140-156` (accept), `:1643` (persist).

**What happens.** Any JSON whose `signature` matches is adopted wholesale as the
state. There is no check that the expected fields exist or have the right type.

**Why it matters.** A state written by an older engine is missing whatever fields
were added since. `puzzleResults` is the concrete case: `_appendPuzzleResult`
would fail on `undefined.push`. A missing `flags`, `visited` or `solved` fails on
first navigation. A tampered or truncated entry does the same. Because the state
is also the thing a pupil can edit in devtools, this doubles as an input
validation gap.

**Fix.** A separate `stateSchemaVersion` independent of the game version, defaults
filled in for every field, type checks, and an explicit migration path. An
unknown scene id should fall back to the start scene rather than freeze.

**Test.** Load a state missing each field in turn and assert the game still starts.

---

## EI-013: A double tap can open two dialogs or two puzzles

**Priority:** P3.

**Where:** `engine/engine.js:400` and `:452` (no transition lock on the hotspot
layer), `engine/dialogs.js:295` (a single `_closeResolver` that a second `open()`
overwrites).

**What happens.** Nothing prevents a second activation while the first is still
opening. For dialogs the second `open()` replaces the resolver of the first, so
whoever was awaiting the first dialog waits forever.

**Why it matters.** Double taps happen constantly on a tablet. An action awaiting
a dialog that never resolves is the same class of failure as EI-001: the run
continues but a step is silently skipped.

**Fix.** A single modal operation at a time. Disable the hotspot layer while a
transition is in flight, and make `DialogUI.open()` either settle the previous
operation properly or refuse the new one.

**Test.** Two synchronous activations produce one runner. An awaited dialog always
settles.

---

## EI-014: `reactor` is missing the `end` flag on its final scene

**Priority:** P3, trivial.

**Where:** `games/reactor/scenes.json`, scene `exit`.

**What happens.** The game is complete and finishable: the `exit` scene exists and
the closing dialog `exit.einstein` plays. It is only the `end: true` flag that is
missing, which every other game has on its final scene.

**Why it matters.** `engine/engine.js:213` keys the congratulation message off
`scene.end`, and any completion detection built the same way misses this game
entirely.

**Fix.** Add the flag. One line of data.

**Test.** A data test asserting every game has exactly one scene with `end: true`,
so no future game ships without it.

---

## EI-015: Leftovers from the first game hardcoded as if they were generic

**Priority:** P3.

**Where, verified:**

    engine/engine.js:174,1640,1645   localStorage key 'leeuwenhoek_escape_state'
    engine/engine.js:160,225,228,    hero fallback hardcoded to 'adam' and
                    234,245,248      'assets/npc/adam/'
    service-worker.js:2              CACHE_NAME 'leeuwenhoek-escape-v3'
    service-worker.js:4-9            asset list from the original prototype
    index.html:57                    default game 'leeuwenhoek'
    manifest.webmanifest:2           name "Leeuwenhoek Escape"
    games/stop-train/dialogs.json:2  meta.id "leeuwenhoek"
    games/stop-train/dialogs.json:7  "@character.leeuwenhoek.name@Průvodčí"

**What happens.** The first game's names sit in places that present themselves as
engine-wide. Games without a `heroes` block, which is all of them except
leeuwenhoek, end up storing a phantom hero Adam pointing at leeuwenhoek's assets.
The stop-train conductor takes his display name from a translation key belonging
to another game; it works only because stop-train has no i18n directory and the
literal after the marker is used.

**Why it matters.** Mostly it is confusion rather than breakage, and it will get
worse once games move to their own repository and the engine is supposed to stand
alone. The storage key is the exception and is tracked separately as EI-002.

**Fix.** Neutral defaults in the engine, per-game values in the game. The hero
fallback should be defined by the game or absent, not `adam`.

Explicitly **not** in scope: the incomplete English translations. Only Czech is
shipped and only Czech is sold, so an unused `en` branch is not a defect. Checked
and dismissed: the Czech completion message resolves from `engine/i18n.js:12`, so
the typo in the unused fallback at `engine.js:213` is never displayed, and the
nested `ui` key in `games/leeuwenhoek/i18n/cs.json` is an empty object that breaks
nothing.

**Test.** A data test that no file outside `games/leeuwenhoek/` mentions
leeuwenhoek.

---

## EI-016: 5 of 113 tests fail on main and CI never runs them

**Priority:** P4 by consequence, but it goes first in the plan, because the rest
of the work needs a green baseline.

**Where:** `.github/workflows/hello.yml` and `pages.yml`. Verified: neither runs
`npm test`.

**The five failures:**

- Three `ReferenceError: ResizeObserver is not defined`, from
  `engine/puzzles/kinds/match.js`. jsdom does not implement it and
  `games/tests/setup.localstorage.js` stubs `PointerEvent` but not this. A test
  environment gap, not a product defect. Whether a runtime fallback is also needed
  depends on the oldest iPad to be supported, which is an open question for the
  owner.
- `expected 'golden_key' to be null` in `engine.use.test.js:180`. A real product
  defect, see EI-008. The test is correct and should stay as written.
- `expected null to be truthy` in `engine.hero.dialogs.test.js:99`. A test defect:
  `DialogUI.open()` awaits an image preload before building the DOM, and jsdom
  fires neither `onload` nor `onerror`, so after the 10 ms wait the overlay does
  not exist yet. The preload itself is correct and does handle errors. The related
  production risk, a request that hangs rather than fails, is EI-003.

**Fix.** Stub `ResizeObserver` in the test setup, fix EI-008 so its test passes as
written, make the hero test drive the image load, and add a CI workflow that runs
the suite on push and on pull requests.

**Test.** The suite is the test. The point is that it runs.

---

## EI-017: 318 MB of material tracked in git that does not belong there

**Priority:** P4, but it blocks the repository split.

**Where, verified as tracked:**

    plans/sessions/                  68 files, 171 MB, agent transcripts,
                                     including ones from unrelated projects
    games/warp-engine/assets/resource/  41 files, 147 MB, source images the
                                     game does not reference
    .idea/                           5 files, including workspace.xml

**Why it matters.** The transcripts contain working context from other projects.
`resource/` is raw source material that is nonetheless published to GitHub Pages
by `pages.yml`. Removing files in a new commit does not remove them from history,
so this has to be decided before the games are split out, not after.

**Fix.** Decide per directory whether it moves elsewhere, is deleted, or requires
a history rewrite. Add the right `.gitignore` entries. Exclude `resource/` from the
Pages deployment regardless.

**Test.** None.

---

## EI-018: Dead code, and a README documenting an API the engine lacks

**Priority:** P4.

**Dead code:** `engine/engine.js:796` `_applyOnSuccess`, `engine/dialogs.js:314`
`refresh()`, the whole of `engine/puzzles/i18n.js` (a duplicate of
`i18n-helpers.js` plus `utils.js`, imported nowhere), `overrideContainerRect` in
the puzzle runner, and several CSS classes the JS never sets. Also unconditional
`console.log` of the whole hotspot object on every click, at `engine.js:453` and
`:514`.

**README drift:** documents `onEnter` and `onExit`, actions as arrays, `delay`,
`consumeItem`, `missingMessage`, hotspot types `inspect` and `onUse`,
`goTo.scene` (the engine reads `target`), `puzzle.ref` (the engine reads
`puzzleRef`), item `name`/`image`/`description` (the engine reads
`label`/`icon`/`meta.description`), and `setHero({...})` (the engine takes an id).

**Why it matters.** Whoever authors a game in the new private repository will
follow the README and produce content the engine ignores, with no error message.

**Fix.** Delete the dead code. Rewrite the README sections against the actual
implementation, ideally by generating the field list from the code or by testing
the documented examples.

**Test.** Load every documented example and assert it parses into something the
engine acts on.

---

## EI-019: Inspecting a second item showed the first item's name

**Status:** DONE in S0, commit `967b385`.

**Where:** `engine/engine.js`, `_inspectItem()` and `_closeModal()`.

**What happened.** `_inspectItem()` opens the modal and then, on the next tick,
rewrites its DOM: it builds a `.modal-header` with the item name and a close
button, and **removes the shell's `#modalTitle` element** to avoid showing the
title twice. `_closeModal()` only adds the `hidden` class; it never resets the
content. So the header survives.

On the second inspection, `openModal()` writes the new title into
`this.modalTitle`, which is now a detached node nobody can see, and the header
block is skipped because a header already exists. The modal then displays the
name of the previously inspected item.

**Why it mattered.** Every game has more than one inventory item, so every game
was affected from the second item onwards. It was never reported, presumably
because a wrong name looks like a misclick rather than a bug.

**How it was found.** Not by reading the code. The regression test for EI-008
asserted on `#modalTitle` and failed with `TypeError: Cannot read properties of
null`, which is what exposed the removal, and the rest followed.

**Fix.** The header title is now assigned on every `tune()` run, outside the
creation guard.

**Test.** `games/tests/engine.use.test.js`, "shows the right name when a second
item is inspected". Verified to fail before the fix.

**Remaining, not fixed here:** the whole rewrite-the-modal-after-mount approach is
fragile, as is the regex over footer text used to hide buttons. `openModal()`
should take a `hideFooter` option and the engine should not delete elements the
shell owns. Kept with EI-018.

---

## EI-020: `games/demo` is not playable

**Priority:** P3, and it is a decision as much as a defect.

**Where:** `games/demo/`.

**What it is.** The original leeuwenhoek prototype, kept as a demo and never
ported. Verified:

- All three `puzzle` hotspots use the old inline `puzzle: {...}` form with no
  `puzzleRef`. `engine/engine.js` logs "Puzzle hotspot missing puzzleRef" and
  opens nothing, so none of them can be solved.
- There is no `meta` block at all, so the state signature is `unknown|0|cs`.
- `games/demo/i18n/en.json` is a zero-byte file, which is not valid JSON.
- 14 PNG files duplicate assets that exist elsewhere.

**Why it matters.** It is reachable through `?game=demo` and it is what the data
tests would measure the other games against. It is excluded from
`games/tests/games.data.test.js` by name so the exclusion is visible rather than
implicit.

**Fix.** A decision: delete it, or port it to the current format. Porting is only
worth it if a demo game is actually wanted once the games move to a private
repository, which is an open question in itself, because a public demo of a paid
product is a different thing from a leftover prototype.

**Test.** The data tests already skip it. Removing it from `KNOWN_BROKEN` is the
acceptance criterion for whichever decision is taken.
