# Open items

Registry of known defects and open decisions. One line per item in the table,
detail below. Rules: numbers are never reused or renumbered; a resolved item is
marked `DONE` and stays in the registry. New items go at the end with the next
free number.

Source: audit on 2026-09-05 by three independent passes (Claude Opus 5, Fable 5.1,
codex SOL). Every item below was then verified by hand in the code, so no entry
here is second-hand.

The fixes in S1 to S3 were reviewed the same way, by Fable 5.1 and codex SOL
independently. Both found the same two P1 defects in the new code, and SOL found
a third that neither the audit nor the first review had. A second round over the
corrections found three more, all P3, and two assertions that were passing
whatever the code did. A closing round over the whole branch found no P1 or P2
and four more things worth fixing, one of which - EI-024 - was a defect the
rewritten README exposed rather than caused. What they turned up is recorded in the item it belongs to,
under "Corrected after review", and as EI-022 and EI-023 where it was a
pre-existing defect rather than a new one.

| #      | prio | status | topic                                                          |
|--------|------|--------|----------------------------------------------------------------|
| EI-001 | P1   | DONE   | Once-events can be marked done before their effects apply       |
| EI-002 | P1   | PART   | One saved state for every game and every team                   |
| EI-003 | P1   | DONE   | goto() hangs on a missing image and persists the broken scene   |
| EI-004 | P1   | DONE   | MIT licence also covers `games/`                                |
| EI-005 | P2   | DONE   | `reset=1` stays in the URL and wipes progress on every reload   |
| EI-006 | P2   | DONE   | `setSceneImage` is not persisted                                |
| EI-007 | P2   | DONE   | Service worker precache is broken, and cache-first is unsafe    |
| EI-008 | P2   | DONE   | Inventory items cannot be activated from the keyboard           |
| EI-009 | P2   | DONE   | `runPuzzleList` is called but never defined                     |
| EI-010 | P2   | OPEN   | Progress signal differs per game, no single source for a dashboard |
| EI-011 | P3   | DONE   | Consumed item removal is not saved                              |
| EI-012 | P3   | DONE   | Saved state has no schema, validation or migration              |
| EI-013 | P3   | DONE   | A double tap can open two dialogs or two puzzles                |
| EI-014 | P3   | DONE   | `reactor` is missing the `end` flag on its final scene          |
| EI-015 | P3   | DONE   | Leftovers from the first game hardcoded as if they were generic |
| EI-016 | P4   | DONE   | 5 of 113 tests fail on main and CI never runs them              |
| EI-017 | P4   | PART   | 318 MB of material tracked in git that does not belong there    |
| EI-018 | P4   | DONE   | Dead code, and a README documenting an API the engine lacks     |
| EI-019 | P3   | DONE   | Inspecting a second item showed the first item's name           |
| EI-020 | P3   | DONE   | `games/demo` is not playable and is excluded from the data tests |
| EI-021 | P3   | DONE   | A dialog opened from another dialog's ending cannot be advanced   |
| EI-022 | P2   | DONE   | An unskippable video that never plays blocks the run forever     |
| EI-023 | P3   | DONE   | Re-rendering hotspots can destroy a mounted puzzle or panel      |
| EI-024 | P2   | DONE   | A single flag name set one flag per character instead           |

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

**Status:** step one DONE in S3. Step two is not this repository's to decide yet.

**Step one, as applied.**

- The key is `state:<gameId>`, from `_storageKey()`. Two games on one tablet no
  longer overwrite each other.
- `_loadState` and `_saveState` go through `opts.storage`, an object with
  `load()`, `save(state)` and `clear()`. The default is localStorage behind that
  same interface. This is the seam the hosted runtime needs for a Durable Object
  copy, and the one EI-010 will emit progress through.
- `lang` is out of the signature. `version` stays: a state from an older build
  can name scenes and items that no longer exist.
- A state left under the old shared key is adopted once if its signature names
  this game, and the old entry is then removed. It is left alone otherwise,
  because another game may still be entitled to it. Somebody may be mid-lesson
  when this ships.

**Corrected after review, and this one was serious.** Adoption deleted the old
entry and wrote nothing in its place: `init()` saves only as a side effect of
hero initialisation, and a real legacy state already has a hero, because the old
`init()` always set one. So the adopted lesson lived in memory alone, and the
second reload - which is exactly what a pupil does when a tablet looks stuck -
started fresh. The adopted state is now written immediately. The test had passed
for the wrong reason: its fixture had `hero: null`, which triggered the
incidental save.

Two smaller holes from the same review: `reset=1` skipped adoption but left the
old entry in place, and `restart()` cleared only the new key, so a restart after
a reset would find the old entry and resurrect the lesson the teacher had just
reset away; and adoption read device-wide localStorage even when a caller had
supplied its own storage, which would have handed a hosted per-team store
whatever happened to be on the tablet. Both fixed, both tested.

A second review round caught the mirror image of the first hole: discarding the
old entry did not check whose it was, so a teacher opening game B with a reset
link, or a team restarting game B, took game A's lesson with it. Reading and
discarding now share one ownership test, `_readLegacyState()`.

**Step two: left for the hosted runtime, and the owner has agreed to leave the
call here.** Run and team identity,
`state:<sessionId>:<gameId>:<teamId>`. The identity has to come from the hosted
runtime, which does not exist yet; inventing one now would mean the runtime
contradicting it later. Until then, two teams on one tablet still share a slot.
The key is shaped so that the run and team can be added without moving anything
else.

**Tests.** `games/tests/engine.state-identity.test.js`: two games stay apart, the
key is per game, changing language preserves progress, a republished version
still starts fresh, the legacy key is adopted once and only for its own game, and
a caller can substitute its own storage. `engine.assets.persistence.test.js` was
updated: it asserted the old behaviour, that changing language produces a fresh
state, and now asserts the version case instead.

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

**Status:** DONE in S2.

**Fix as applied.** A `_loadSceneImage(src)` helper that adds one-shot `load` and
`error` listeners, races them against a timeout that resolves rather than
rejects, and returns `'ok' | 'error' | 'timeout'` without ever rejecting.
`goto()` takes a navigation token before it starts and drops everything if a
newer navigation has begun by the time the image settles; the token is what makes
two navigations safe, because there is one `<img>` for the whole game and
therefore only one `load` event to go round. The scene is persisted only on
`'ok'`, and on anything else the pupil gets a toast instead of a blank screen.
The timeout defaults to 8 s and is injectable as `opts.sceneImageTimeoutMs`, so a
test does not have to wait for it.

The same loader is now used by the `setSceneImage` event action, which had an
identical copy of the original three-line hang.

**Corrected after review, twice.** The first attempt only made the direct
`_saveState()` conditional, and left `state.scene` moving before the image
loaded. That was not
enough and the claim in this file was wrong: the enter events run a few lines
later and a `once` event saves the whole state as it marks itself, so the failed
scene was persisted anyway. Almost every scene in the shipped games has such an
event, `reactor`'s `main-room` among them. `state.scene` now moves only on a
successful load; it is the resume point, and where the pupil actually is, is
`currentScene`. The two places that read `state.scene` as a stand-in for "here"
were changed to `_hereId()`, which prefers `currentScene`.

The second round then pointed out that a timeout is not a failure: an eight
second timeout on a 700 KB scene over congested school Wi-Fi is an ordinary
Tuesday, and treating it as "never" left the team playing on in a scene that was
never recorded. If the image does turn up, the scene is recorded then, still
guarded by the navigation token.

**Tests.** `games/tests/engine.goto.image.test.js`: a 404 still finishes and
renders hotspots, a request that never answers finishes within the timeout, a
failed scene is not recorded, and two navigations in a row both settle with the
later one winning. All four verified to fail before the fix.

Two older test files carried their own image stub that called `this.onload`
directly. Those stubs were deleted rather than repaired; image loading is
simulated once, in `games/tests/setup.localstorage.js`.

**Same defect, one file over.** `DialogUI.open()` preloads portraits and handled
`onerror` but had no timeout, so a dropped request hung it in the same way. Since
EI-013 that also held the dialog claim and the hotspot lock, which turned one
stuck dialog into a game where no tap does anything. `DialogUI._preload()` now
has the same bound. Tested in `games/tests/engine.dialog.preload.test.js`.

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

**Status:** DONE. Decided by the owner: split the licence.

**As applied.** `LICENSE` keeps the MIT text unchanged and gains a scope
paragraph above it saying it covers everything except `games/`. `games/LICENSE`
is a proprietary licence covering every game's data and assets: no copying,
publishing, distribution, sublicensing or resale, and use only to the extent a
purchased licence sets out, for the school or class it names. `games/tests/` is
called out as engine test code and stays MIT. The README's licence section now
states the split first and the MIT text second.

**What this does not do.** It applies from here on. Copies already taken while
the repository was wholly MIT keep the licence they were taken under; nothing in
a repository can retract that. It does stop the set of such copies growing, which
is why it was worth doing before the games are separated rather than after.

**Not legal advice.** The wording is the usual shape for this split and is
written to be clear, not to be authoritative. Worth a lawyer's eye before the
first sale.

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

**Status:** DONE. Decided by the owner: remove it. "PWA never worked, and now
that we want to run this online, I would drop it entirely."

**As applied.** `service-worker.js` and `manifest.webmanifest` are deleted, the
`<link rel="manifest">` and the `?pwa=1` registration are out of `index.html`,
and `pages.yml` no longer copies either file or rewrites `__CACHE_VERSION__`.
The README section says there is no offline mode, why, and what a real one would
need.

**Nothing has to be unregistered on any device.** `register()` did run, but the
`install` handler's `addAll` always rejected, so no worker ever reached the
installed or activated state and none is controlling a page anywhere.

**Test.** None needed now. If offline is ever built, the test that was suggested
here still applies: an install test that fails when a precache path does not
resolve, so it cannot silently rot again.

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

**Owner's position, recorded so it is not rediscovered.** This is part of the
dashboard project, not of the engine stabilization, and it is a day's work of its
own. The engine and every game will have to report state, and some games will
want something custom on top of whatever is generalised. Nothing is to be built
for it now; the seam that already exists - `opts.storage`, plus the puzzle runner
wrapper every kind goes through - is enough preparation until that day.

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

**Status:** DONE in S3.

**Fix as applied.** `_removeItemFromInventory()` calls `_saveState()`, which now
goes through the storage seam introduced by EI-002. One line, done in this batch
rather than earlier because the call site is what EI-002 moved.

**Corrected after review.** Saving the removal alone created a worse bug than the
one it fixed. The save happened while the item was still the one held for use, so
the persisted state had an empty inventory and a `useItemId` naming the consumed
item; `_activateHotspot()` checks the held item against `acceptItems` without
looking in the inventory, so after a reload the same item could be spent a second
time. Removal now clears use mode when it takes the item that is held, and
`_normalizeState()` refuses a `useItemId` that is not in the inventory, which also
closes the devtools version of it.

**Test.** `games/tests/engine.consume.reload.test.js`, with its own fixture: a
hotspot that consumes an item and has no `onApply` at all, so nothing else can
trigger the save. The second test in the file is the shape every shipped game
uses, kept so that the accidental save is not what the first one is measuring.
Verified to fail before the fix.

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

**Status:** DONE in S3.

**Fix as applied.** `STATE_SCHEMA_VERSION`, independent of the game version and
stamped on everything written. `_freshState()` is the single list of every field
the engine reads. `_restoreState()` decides whether a stored object belongs to
this game at all; `_normalizeState()` fills defaults for what is missing and
drops what is the wrong type; `_migrateState()` is the place a real migration
step goes and is empty on purpose, because v1 is the first numbered schema and
anything older differs only by fields that were not there yet. A scene id that
no longer exists falls back to the start scene, which on a tablet is the
difference between a game and a crash.

**Test.** `games/tests/engine.state-schema.test.js`: every field deleted in turn,
a state that predates `puzzleResults` taking one, a removed scene, wrong types,
a stored value that is not an object, a truncated entry, a partial state keeping
what it can, and the version being stamped. Three of these failed before the fix
outright. The type-checking ones could not, because before namespacing the engine
was reading a different key entirely and never saw the state at all; they were
verified separately by disabling `_normalizeState()` in the fixed engine, which
fails five of the eight.

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

**Status:** DONE in S2.

**Fix as applied.** Three changes, all small:

- `Game._hotspotBusy` is claimed in the hotspot click handler **and in
  `_handleItemDropOnHotspot()`**, and released when the activation finishes. The
  flag lives on the Game, not the element, because `_renderHotspots()` replaces
  those elements while an activation is still running. It holds for exactly as
  long as the activation does, which for a dialog or a puzzle means until it is
  closed, so a second tap during it is dropped and a deliberate second tap
  afterwards is not.
- `DialogUI.open()` refuses a second call instead of taking over. The claim is
  made synchronously, because `open()` awaits a portrait preload before it
  installs the resolver and a second call could otherwise slip past the check
  during that await. It is dropped again the moment the resolver is installed,
  not when the dialog closes, so a dialog opened from another dialog's ending is
  still allowed.
- `_end()` takes the resolver before it runs the `onEnd` logic and calls it
  afterwards. That logic can set a flag or navigate, either of which can open
  another dialog, and while this one still owned `_closeResolver` that dialog
  would have stolen it.

**Also fixed here, same defect from the other end.** The resolver is now
installed before the first step is rendered. A dialog with an empty sequence ends
inside `_renderStep()`, which used to happen while there was no resolver to call,
so the promise handed back was never settled and the event that opened the dialog
stopped there for good.

**Tests.** `games/tests/engine.double-tap.test.js`: one puzzle rather than two,
one activation rather than two, an awaited dialog settles despite a second
`open()`, an empty dialog settles, a dialog opened from another dialog's ending is
not refused, and the locks release afterwards. Five of the seven verified to fail
before the fix; the other two guard the release.

One existing test in `engine.use.test.js` fired two hotspot activations in a
single turn of the event loop, which is now correctly refused. It was given a
tick between the two taps rather than weakened: two deliberate taps by a pupil are
never in the same turn.

**Corrected after review: the drop path had no lock, and EI-001 made that
matter.** Dragging an item onto a target is what the inventory tooltip tells the
pupil to do, and the six warp-engine module slots can only be filled that way.
The drop went straight into `_applyActions` with nothing held. Combined with
EI-001 setting `warp_engine_active` before the victory event presents itself,
there was a window - the replacement scene image and the dialog's portraits both
have to load - in which the flag was set, the exit hotspot was gated on it, and
nothing covered the screen. A team that dropped the last module and tapped the
exit would leave mid-event, `exit-sequence` would mark itself fired, its
`exit.victory` dialog would be refused because the victory dialog was already
claiming, and the `game_completed` flag that dialog sets would be gone for good.
Reproduced against the real warp-engine data;
`games/tests/warp-engine.reload.test.js` holds it down.

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

**Status:** DONE.

**Fix as applied.** The storage key went with EI-002 and stop-train's borrowed
dialogs meta went in S4. What was left:

- The hero fallback. A game that defines no `heroes` now gets no hero at all,
  and `getHero()` returns `NEUTRAL_HERO`, which exists so the getter never
  returns null rather than to stand in for a character. An id the game does not
  know keeps its own name and gets no asset path, instead of quietly becoming
  Adam pointing into leeuwenhoek's portraits. Five of the six shipped games were
  storing that phantom.
- One consequence worth knowing: `_setHeroInternal()` was the only thing that
  wrote a fresh state to storage at startup, so removing it for those five games
  meant nothing was persisted until the first interaction. Nothing was lost by
  that, but `init()` now saves explicitly. Persistence should not depend on which
  unrelated thing happened to save first, and the hosted runtime will want a run
  to exist from the moment it starts.
- `manifest.webmanifest` is "Úniková hra" rather than "Leeuwenhoek Escape", and
  the service worker's cache name is `escape-game-engine-v3`. The **precache
  list is deliberately untouched**: repairing it would decide EI-007, which is
  the owner's. A comment at the top of the file says so.
- `index.html` still names a game, and legitimately: it has to open something
  when the address bar does not say. It is now a named `DEFAULT_GAME` constant
  with a comment saying it is a convenience for local use and that the hosted
  runtime always supplies the id.

**Corrected after review.** `NEUTRAL_HERO.id` is `hero`, which is also the id
of the character template that `characterId: "hero"` expands. `_findCharacter()`
looks the hero up by id before falling back to the template, so it found the
template itself and returned it unexpanded: a game with no heroes showed the
literal `{heroBase}neutral.png` as a portrait source. The lookup now skips itself
for the neutral hero.

Also recorded rather than left implicit: the explicit `_saveState()` in `init()`
is what makes `?reset=1` durable for those same five games, because `init()` does
not clear storage - it ignores what is there and builds a fresh state. Without
the save, a reset link followed by a reload with nothing tapped handed the team
back the lesson they had just left. `games/tests/engine.reset.test.js` now says
so.

**Test.** `games/tests/engine.hero.neutral.test.js`,
`games/tests/engine.dialog.choice.test.js` and
`games/tests/engine.neutrality.test.js`. The second walks every file under
`engine/` and fails on any mention of a shipped game's id outside a comment,
with one allowed line: `LEGACY_STATE_KEY`, which has to name the old key in
order to migrate it. Scope is the engine, because the engine is what has to
stand alone once the games move; `index.html` is the shell and
`service-worker.js` is EI-007.

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

**Status:** PART. Two of the three directories decided.

**Done.**

- `plans/sessions/` deleted, 68 files and 171 MB. Owner's decision: not needed.
  Also `.gitignore`d, so it cannot come back by accident.
- `.idea/` untracked and `.gitignore`d. `workspace.xml` is per-user and
  per-machine state; nobody else can use it and it changes on every IDE action.

**Kept, by the owner's decision:** `games/warp-engine/assets/resource/`, 147 MB.

**With a correction to the premise it was decided on.** The decision was made on
the understanding that the directory holds the game's films. Verified: it holds
29 PNG, 6 JPG, 5 WEBP and one design document, no video at all. Individual PNGs
are 6-7 MB. The films are in `games/warp-engine/assets/video/` and come to 13 MB
between them. Nothing in the game references the path `resource/`; the same file
names exist directly in `assets/` at a fraction of the size, so these are the
source originals the shipped assets were exported from. All of warp-engine's
assets excluding `resource/` come to 23 MB.

**Still open.** `pages.yml` does `cp -R games out/`, so those 147 MB are
published to GitHub Pages on every deploy even though no game asks for them.
Excluding `resource/` from the deploy is independent of whether it stays in git
and is worth doing either way, but it was not done without the owner's word.

**Also still open, and the reason this is PART.** Deleting files in a commit does
not remove them from history. `.git` is still 430 MB. Getting that back means a
history rewrite on a repository that is public and pushed, which is destructive
and needs coordinating rather than doing quietly.

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

**Status:** DONE.

**Dead code, removed.** `_applyOnSuccess` (no callers), `DialogUI.refresh()` (no
callers), `engine/puzzles/i18n.js` (imported nowhere), and
`overrideContainerRect` in the puzzle runner (no game used it and nothing
documented it). The three unconditional `console.log` calls are gone: two became
`_dbg`, the third duplicated a `debug=1` guarded log two lines below it.

**CSS was left alone.** The audit mentions classes the JS never sets. Deciding
that safely means also reading every game's `game.css`, and a wrongly deleted
class is a silent visual regression that no test here would catch. Not worth it
for the size of the win.

**README, rewritten against the implementation.** Every item in the drift list
was wrong in the way the audit described, and each is now right: action bundles
are objects rather than arrays; `onEnter`/`onExit` and `delay` are gone, with a
pointer to events and `playVideo.delay`; `goTo` takes `target`; a `puzzle`
hotspot takes `puzzleRef` while the `openPuzzle` *action* really does take `ref`,
which the audit had lumped together; items are `label`/`icon`/`meta`; dialogs use
`sequence`/`speaker`, and choices `onChoose`; `setHero` takes an id. Four
capabilities the README advertised and the engine does not have - voice lines,
auto-advance, conditions on dialog choices, scene enter/exit hooks - were removed
rather than glossed. The PWA section now says plainly that it does not work, and
points at EI-007.

**Corrected after review.** The rewrite got four things wrong of its own, all
found by reading it back against the engine: it claimed `setFlags` takes a single
name, which was true of `giveItem` and not of `setFlags` (that became EI-024); it
paired the hero character template with a game that defines no heroes, so its own
example rendered a placeholder on screen; it sent the puzzle window rect to
`options.rect` where the runner reads the top-level `rect`; and it still
advertised PWA support in two places that the rest of the document contradicts.
Three nits with it: the new-puzzle-kind path, three demo links passing
`hero=adam` to games that have no heroes, and a sentence implying a step with
choices waits for one, when tapping anywhere advances past it.

**Test.** `games/tests/readme.contract.test.js`: every JSON example parses, no
example uses a field the engine ignores, every `goTo` has a `target` and every
`puzzle` hotspot a `puzzleRef`, the documented hotspot types are read out of
`engine.js` rather than repeated, `setHero` is never shown taking an object, and
every file named in the project tree exists. All five fail against the old
README.

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

**Status:** DONE. Decided by the owner: delete it. A demo of the framework would
be worth having, but as a deliberate separate thing later, not as this leftover.

**As applied.** `games/demo/` is deleted. `KNOWN_BROKEN` is gone from
`games/tests/games.data.test.js` along with the filter that used it, so every
directory under `games/` is now measured by the data tests with no exceptions.
The comment that replaced it says what to do if a game ever has to be skipped
again: name it with a reason rather than quietly loosening an assertion.

**Test.** The data tests, which now cover every shipped game.

---

## EI-021: A dialog opened from another dialog's ending cannot be advanced

**Priority:** P3. Found while fixing EI-013, not by an audit pass.

**Where:** `engine/dialogs.js`, `next()` and `_handleInput()`.

**What happens.** `next()` sets `this._busy` and clears it in a `finally`, and
what it awaits in between is `_end()`, which runs the dialog's `onEnd`. If that
sets a flag, `_stateChanged()` runs the events, and an event whose `then` opens a
dialog will open one. The second dialog appears while `_busy` is still held by
the advance that started it, and `_handleInput()` returns early whenever `_busy`
is set. So every tap on the second dialog is ignored and it can never be closed.
The engine is then blocked on it for good.

**Why it is not urgent.** Verified against all six shipped games: none has a
`stateChange` event with a blocking action gated on a flag that a dialog sets in
`onEnd` or `onNext`, so no game can reach it today. The chain is supported by the
engine and a new game could use it without doing anything unusual.

**Status:** DONE, on the owner's instruction to fix it rather than leave it
recorded.

**Fix as applied.** `_end()` releases `_busy` as soon as it has taken the
resolver and set `active` to null, rather than leaving it to `next()`'s
`finally`, which does not run until everything the ending set in motion has
finished. One line. Advancing the finished dialog again is impossible regardless,
because `next()` returns early when `active` is null, so the lock has nothing
left to protect by then.

**Corrected after review.** Releasing the lock earlier widened a window that
was already there: `_applyChoice()` checked the lock but never that the step it
was made for was still the one on screen. `_flashChoice` disables the button that
was tapped for 220 ms but not its siblings, so two *different* choices could be
tapped in that time and the second would run against a dialog that had already
ended - setting its flags and running its `onEnd`. It now checks the step, which
is what was missing underneath the lock all along. No shipped game can reach it;
leeuwenhoek's four choices are all `jump`.

**Test.** `games/tests/engine.double-tap.test.js`, "still lets a dialog open one
from its own onEnd, and lets the pupil click through it", and
`games/tests/engine.dialog.choice.test.js`, "runs one choice, not two". It used to close the
second dialog through `close()` because clicking did not work; it now closes it
by tapping, the way a pupil does. Verified to fail before the fix.

---

## EI-022: An unskippable video that never plays blocks the run forever

**Priority:** P2. Found in review of S1-S3, not by an audit pass.

**Where:** `engine/engine.js`, `_playVideo()`. `games/warp-engine/scenes.json`,
the `intro` hotspot and the `dlg-hertz-outro` event.

**What happens.** `_playVideo()` resolves on `ended` or `error` and on nothing
else. `video.play()` returning a rejected promise is caught and logged, and then
the engine waits for an `ended` that is never coming. Both warp-engine videos are
`allowSkip: false`, so there is no skip button either, and the overlay covers the
screen.

**Why it matters.** Autoplay is refused for a video with sound until the page has
been interacted with, and iOS refuses it outright in Low Power Mode. The
warp-engine intro video plays on the first tap of the game, which is the least
likely moment for a browser to allow it. The result is a black screen that the
lesson cannot get past. heat-escape's two videos are `allowSkip: true` and
therefore recoverable.

**Status:** DONE, on the owner's instruction, with tablets as the case to get
right.

**Fix as applied.** Nothing in `_playVideo()` assumes the video plays.

- A refused `play()` puts a **play button** on screen rather than skipping the
  video. Tapping it retries from inside a real touch handler, which is the only
  kind iOS accepts for a video with sound, so one tap gets the pupil the video
  as the author intended rather than losing it. Falling back to muted playback
  was considered and rejected: silent narration is worse than one extra tap.
- The skip control is always in the DOM and hidden with the `hidden` attribute.
  `allowSkip: false` hides it, and it is revealed when the video has not started
  by `videoStartTimeoutMs` (6 s, injectable), when `stalled` fires part way
  through, or when `play()` was refused. Once revealed it stays: taking a control
  away from somebody who has just seen it is its own kind of stuck.
- `allowSkip: false` still means something during normal playback, which is
  what stops this being a way of quietly deleting the setting.
- Tapping the backdrop still skips only when `allowSkip` is true, so an
  accidental tap cannot eat an intro the author wanted watched.
- `styles/style.css` needed `.video-skip[hidden], .video-play[hidden] { display:
  none }`: `.video-skip` sets `display: flex`, which beats the browser's default
  styling for the attribute.

**Hardened again in the closing review.** Two interruptions were not covered.
A pupil switching apps is the most ordinary one there is on a tablet: iOS pauses
the video and does not resume it, and neither `ended` nor `stalled` follows, so a
`pause` that is not the engine shutting down now offers the play button and the
way out. And rather than trusting `stalled` alone - Safari has been unreliable
about firing it, Chrome has fired it spuriously - `waiting` and `stalled` both
re-arm the same clock that watches for a video that never starts, so a normal
buffer stays invisible and one that does not recover ends up offering a way out.

**Test.** `games/tests/engine.video.stuck.test.js`: a refused `play()` offers the
play button and the retry works, a video that never starts can be got past even
with `allowSkip: false`, a stall part way through does the same, the control
stays hidden while the video really is playing, and the activation lock is
released either way. Four verified to fail before the fix; the fifth was
mutation-checked, because it guards the setting rather than the defect.

---

## EI-023: Re-rendering hotspots can destroy a mounted puzzle or panel

**Priority:** P3, latent.

**Where:** `engine/engine.js`, `_renderHotspots()` clears `hotspotLayer.innerHTML`.
`engine/puzzles/index.js` mounts the puzzle container into that same layer, and
`engine/content.js` mounts the panel there too.

**What happens.** A puzzle and a content panel both live inside the hotspot
layer. Anything that re-renders hotspots while one is open removes it from the
DOM without calling `onResolve`, so `_openPuzzleByRef()` never settles. Since
EI-013 that also means the activation lock is never released, and no tap does
anything afterwards.

**Why it is not urgent.** Reaching it needs a state change while a puzzle is
mounted, and since EI-013 both ways into `_applyActions` from a hotspot, the tap
and the drop, hold the activation lock. Checked all six shipped games as well:
only leeuwenhoek's treasure room has a puzzle and an item-accepting hotspot in
the same scene, and the item it accepts is the reward for solving that puzzle, so
it cannot be held while the puzzle is open.

**Status:** DONE, on the owner's instruction to fix it rather than leave it
recorded.

**Fix as applied.** `_renderHotspots()` removes only what it and the highlight
helper put there, `:scope > .hotspot` and `:scope > .hs-glow`, instead of
clearing the layer. Verified that nothing else appends to it: the editor only
restyles existing `.hotspot` children.

Moving the modal surfaces out of the hotspot layer would be the better shape -
the layer is a hit-testing surface and should not also be a modal host - but
both are positioned in percentages of it, so moving them is a visual change that
cannot be checked from a test. Worth doing when somebody can look at the result.

**Test.** `games/tests/engine.modal-surfaces.test.js`: a re-render leaves an open
puzzle mounted and still able to settle, leaves a content panel mounted, leaves
the activation lock releasable, and still clears the hotspots it drew last time.
Three verified to fail before the fix; the fourth guards the renderer still
owning its own output.

---

## EI-024: A single flag name set one flag per character instead

**Priority:** P2. Found in the closing review, by reading the rewritten README
back against the engine.

**Where:** `engine/engine.js`, `_applyActions()` and `_processEvents()`;
`engine/dialogs.js`, `_applyFlags()`.

**What happened.** `setFlags` handled an array and an object, and everything else
fell through to `Object.entries()`, which walks a string one character at a time.
So `"setFlags": "lab_unlocked"` set twelve flags called `"0"` to `"11"`, left
`lab_unlocked` unset, and - because something had changed - saved the state and
fired the `stateChange` events. `clearFlags` took an array only and ignored a
string silently. In `dialogs.js` a string was ignored silently too.

**Why it mattered.** Nothing threw and nothing was logged. The door the flag
gates simply never opens, and the author has no way to find out why. `giveItem`
has always accepted a single value, which is what makes this a trap rather than a
limitation: the two look interchangeable and are not.

**Fix as applied.** `flagEntries()` in `engine/utils.js` reads all three forms -
a name, a list of names, a map of name to boolean - into `[name, value]` pairs,
and all three call sites go through it. It lives in `utils.js` rather than in the
engine because `dialogs.js` needs it too and importing back from `engine.js`
would be a cycle.

**Test.** `games/tests/engine.flags.spec.test.js`, for an event, an action bundle,
a dialog ending and `clearFlags`, plus a guard that lists and maps still work.
Four of the five fail before the fix.
