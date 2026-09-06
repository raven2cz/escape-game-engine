# EI-010: the dashboard API and services, designed

**Author: Claude (Opus 4.8), 2026-09-06. Status: reviewed by codex SOL; revised.**
Not implemented. Fable does the implementation review later, once this is built.

> **Read the [Revision after SOL review](#revision-after-sol-review) at the end
> first.** SOL ([EI-010-SOL-REVIEW.md](EI-010-SOL-REVIEW.md)) endorsed the
> architecture — private `RunProgress`, projected into a public `DashboardReport`,
> synchronous cheap mutation with a deferred report — but found load-bearing gaps
> that make the body below wrong or incomplete in specific places. The revision
> is authoritative where it and the body disagree. The most important corrections:
> the internal state has a *second* exit (the injected `storage`) that the no-leak
> guarantee missed; held wrong answers neither carry `ok` nor trigger a save;
> `openPuzzle` is never closed; and "off the render thread" was overclaimed.

This is the implementation design for the dashboard-facing part of EI-010. It
**supersedes the projection/transport recommendation** in
[EI-010-DESIGN.md](EI-010-DESIGN.md) — the "ship the saved state unchanged" call,
which the owner rejected — and stands on the measured ground in
[EI-010-EVIDENCE.md](EI-010-EVIDENCE.md) and the four owner decisions recorded at
the top of the Fable design. Where this document and Fable's disagree, this one
wins; where it is silent, Fable's evidence and choke-point analysis still hold.

The owner's decisions, which are the frame for everything here:

1. One final release.
2. The teacher watches **live during the lesson**; sending is continuous, simple,
   fast, and must never block the render thread.
3. Error stats are a **mistake counter plus solved**, nothing more.
4. **The internal state is never shipped.** A declared, versioned public API is
   filled from the internal state by a projection; only that goes on the wire.

Everything below is in service of not botching (4), and of (2)'s hard rule: the
game's frame is sacred.

---

## 1. The boundary, which is the whole point

There are two representations and a wall between them.

**Private — `RunProgress`.** What the engine records internally so that it is
*able* to answer "what is this team doing". It lives inside the saved state,
survives a reload, and is nobody's business but the engine's. It may be
refactored at will.

**Public — `DashboardReport`.** A declared, versioned value object: the domain
model of *what a dashboard is told*. It is the only thing that crosses the wire.
It contains no storage keys, no solution data, no hero internals, no schema
bookkeeping — only fields this document names.

**The wall — `DashboardProjector`.** A pure function `RunProgress (+ catalogue) →
DashboardReport`. It reads the private model and fills the public contract. This
is the anti-corruption layer. Because the projector only *reads*, the private
model stays the single source of truth, so reload-safety and gap-resilience — the
two things Fable's design got right — are kept for free.

If you take one rule from this document: **nothing reaches a transport except a
`DashboardReport` built by the projector.** A test asserts exactly that (§10).

```
  engine state machine
        │  emits cheap signals (observer)
        ▼
  ProgressModel ──(serialized)──► saved state.progress   ← private, reload-safe
        │
        │  DashboardReporter, on a coalesced async flush
        ▼
  DashboardProjector ── builds ──► DashboardReport        ← public, versioned
        │
        ▼
  ReportTransport.send(report)   ← async, fire-and-forget, off the render thread
```

---

## 2. The public domain model: `DashboardReport`

An immutable snapshot value object. One report is the complete current picture of
one run; the server keeps the sequence it receives, so history lives server-side
and every report is idempotent — a lost minute of network costs nothing, the next
report is again complete.

```
DashboardReport {
  api:        integer        // ENGINE_API_VERSION; the contract's version
  game:       string         // meta.id
  session:    string | null  // from EI-002
  team:       string | null
  startedAt:  epoch ms
  updatedAt:  epoch ms       // when this report was built
  completedAt:epoch ms | null

  position:   ScenePosition          // where the team is
  activity:   PuzzleActivity | null  // what it is doing right now
  progress:   Progress               // how far, as counts

  inventory:  string[]       // item ids currently held
  itemsUsed:  string[]       // item ids consumed
  dialogsSeen:string[]       // dialog ids that have ended
  puzzles:    PuzzleOutcome[] // one per puzzle the team has touched

  completed:  boolean
}

ScenePosition { scene: string, label: string|null, since: epoch ms }
PuzzleActivity { ref: string, since: epoch ms }         // the open puzzle, if any
Progress { scenesVisited, scenesTotal, puzzlesSolved, puzzlesTotal: integer }
PuzzleOutcome { ref: string, mistakes: integer, solved: boolean }
```

Design notes, each defensible on its own:

- **`activity` + `position.since` are the whole "stuck" signal.** The engine is a
  state machine; it already knows the current scene and the open puzzle. The
  dashboard compares `since` against the rest of the class. No "stuck" flag is
  computed engine-side — that is a dashboard judgement, and keeping it there means
  the engine ships facts, not opinions. (Owner decision 3.)
- **`puzzles` is a flat list, `mistakes` a plain counter.** No per-attempt rows,
  no captured answers, no timings per puzzle. `mistakes` counts wrong
  evaluations; `solved` is the terminal fact. That is the entire error model.
  (Owner decision 3.)
- **`label` fields are optional and static.** A game *may* declare human labels
  for scenes (`meta.dashboard`, §8); absent that, the dashboard shows the id. No
  game is re-authored to make the board work.
- **`api` is `ENGINE_API_VERSION`.** It versions the *contract*, not the engine
  and not the save format. Adding an optional field is not a bump; removing or
  re-meaning one is. A dashboard shows what it understands and ignores unknown
  fields; a report whose `api` is newer than the board is shown as position-only
  with a banner.

The value objects exist as real objects (frozen, with a `toJSON`), not loose
dictionaries, so that "a report is well-formed" is enforced in one place and the
no-leak guarantee is structural rather than a matter of discipline.

---

## 3. The private model: `RunProgress`

Additive fields on the saved state. **This does not change the state signature, so
no `saveVersion` moves and no lesson ends** (`_restoreState` compares only the
signature; the schema version is stamped, never compared — EVIDENCE §10, item 2).
`STATE_SCHEMA_VERSION` is bumped for cleanliness; that alone loses nothing.

```
state.progress = {
  startedAt, sceneEnteredAt, completedAt : epoch ms | null
  sceneTime  : { [sceneId]: accumulated ms }
  openPuzzle : { ref, since } | null
  puzzles    : { [ref]: { attempts, mistakes, solved } }
  itemsUsed  : { [id]: true }
  dialogsSeen: { [id]: true }
}
```

`inventory`, `scene`, `visited` are already in the state; the projector reads them
directly and they are not duplicated here.

- **Reload-safe by construction:** it is part of the persisted state, defaulted in
  `_freshState()` and whitelisted in `_normalizeState()` exactly like every other
  field, so a reload rehydrates it and an older engine drops it cleanly.
- **Time is honest about its limits.** Durations use a `Clock` (an injectable
  service wrapping `Date.now()`, so tests are deterministic and the engine's ban
  on ad-hoc time stays honoured). A tablet that sleeps across a break inflates the
  current scene's `since`; the dashboard caps a single stay at the lesson length.
  This is a live-teaching hint, not a graded stopwatch — stated so nobody reads it
  as one. (Matches Fable's honesty on the same point.)

---

## 4. The services

Five objects, each with one responsibility, none reaching into another's data.
Four are new files under `engine/dashboard/`. Only the first touches the engine,
and it touches it in the smallest possible way.

### 4.1 `GameSignals` — the observation seam (the only engine change of substance)

A tiny synchronous publish/subscribe emitter owned by the `Game`. The engine
*publishes* named signals at the transitions it already funnels through; it knows
nothing about who listens. This is the cross-cutting seam, kept deliberately dumb.

Signals, and the existing choke point each is emitted from:

| signal | payload | emitted at |
|---|---|---|
| `run:started` | — | `init()`, after state is restored |
| `scene:entered` | `{ scene }` | `goto()` success branch (engine.js:305) |
| `puzzle:opened` | `{ ref }` | `_openPuzzleByRef`, on mount |
| `puzzle:evaluated` | `{ ref, ok }` | **the runner wrapper's `onOk`, before the hold return** (index.js:88) |
| `puzzle:solved` | `{ ref }` | the wrapper, on a resolving success |
| `item:given` | `{ id }` | `giveItem` |
| `item:used` | `{ id }` | `_removeItemFromInventory` (engine.js:526) |
| `dialog:ended` | `{ id }` | `dialogs.js` `_end()` |
| `run:completed` | — | first entry to an `end` scene |

The one that matters: **`puzzle:evaluated` fires from the shared runner wrapper,
one line above the `hold` early-return, so it sees every wrong answer — including
the 47 of 62 leaf puzzles that hold instead of resolving, and every list step,
because list steps run through the same wrapper** (verified: list.js:87 →
createPuzzleRunner; index.js:86 `onOk`). One hook, total coverage. This is the
finding that makes the error counter cheap; without it the counter would need a
change in all eight kinds.

Publishing is **synchronous and O(1)** by design (see §5 for why this is not a
render-thread cost). The engine's footprint is: construct the emitter, add
`state.progress`, and ~9 one-line `emit()` calls. Nothing else in the core moves.

### 4.2 `ProgressModel` — owns `RunProgress`

Subscribes to the signals; translates each into an O(1) mutation of
`state.progress`. All the counting and stamping lives here, out of the engine's
methods. It is the only writer of `state.progress`, and it serialises to / rehydrates
from that field. Pure and synchronous: no I/O, no projection, no network.

- `puzzle:evaluated {ok:false}` → `puzzles[ref].mistakes++`, `attempts++`.
  Deduped within ~1s so a double-tap on OK (two evaluations) counts once.
- `puzzle:solved` → `puzzles[ref].solved = true`.
- `scene:entered` → close out the previous scene's `sceneTime`, stamp
  `sceneEnteredAt`, clear `openPuzzle`.
- `item:used` / `dialog:ended` → set the flag. `run:completed` → `completedAt`.

### 4.3 `DashboardProjector` — the wall

A pure object: `project(progress, gameState, catalogue) → DashboardReport`. Reads
the private model and the already-public parts of the state (`inventory`, `scene`,
`visited`) and the static catalogue (§8), and constructs a frozen `DashboardReport`
of value objects. **It is the only code that constructs a report, and it names
every field explicitly** — there is no spread of internal state into the output,
so nothing can leak by accident. Stateless, trivially unit-tested.

### 4.4 `DashboardReporter` — coalesce and schedule (the non-blocking heart)

Subscribes to the signals too, but does **no work synchronously**. On any signal
it marks itself dirty and, if no flush is pending, schedules one (see §5). A flush
projects once and hands the report to the transport. This is what collapses a
burst — a nine-question quiz list answered quickly — into a single projection and
a single send, and what guarantees the projection and the stringify never run on
the engine's synchronous path.

### 4.5 `ReportTransport` — the injectable exit

An interface: `send(report): void`. Implementations:

- `NullTransport` — **the default. The engine sends nothing anywhere on its own.**
  A per-lesson-licensed product must not beacon pupil data without the runtime
  explicitly wiring a destination. Local dev and tests get this unless they opt in.
- `LocalCacheTransport` — writes the latest report to `localStorage` (synchronous,
  tiny, coalesced to latest-only) and POSTs it fire-and-forget with `keepalive`.
  For a dev dashboard.
- The hosted runtime injects its own, via `boot({ report })` → `Game` opt, the
  same seam pattern as `storage` and `sessionId` (EI-002).

---

## 5. Async and non-blocking, precisely

The rule is decision 2: never block the frame. The mechanism, and the reasoning
for each choice, because this is where "async notifications" has to be pinned down
rather than waved at.

**Signals are published synchronously; only their cheap subscribers run then.**
Making the *notification itself* async (dispatch on a microtask) was considered
and rejected: it reorders against the engine's own `_saveState()` and risks losing
the final update when the page unloads. Instead, the two synchronous subscribers —
`ProgressModel` and the dirty-flag set in `DashboardReporter` — are both O(1). No
projection, no serialisation, no network happens synchronously. So "synchronous"
here costs a few integer writes per transition, which is not a render cost. The
*asynchrony* lives where the *work* is, which is the correct place for it.

**The flush is asynchronous and coalesced.** When marked dirty, the Reporter
schedules a flush on a short timer (a ~250 ms trailing window) so a burst becomes
one send, and additionally throttles to a minimum interval between network sends.
The projection + `JSON` + `transport.send` all run inside that deferred flush,
after the engine has finished its synchronous work and yielded — never mid-render.

- **Not `requestIdleCallback`:** it does not exist on Safari, including iPadOS 15,
  our floor. A `setTimeout` window plus `queueMicrotask` for the immediate-yield
  case is what is available and portable. (Called out because a design that
  assumed rIC would fail silently on exactly our target device.)

**Sending is async and fire-and-forget.** The transport's network call is never
awaited on any game path; failures are swallowed with a `.catch()` and retried on
the next flush, because the next report supersedes the lost one anyway.

**Unload is the one synchronous exception, and it is designed for it.** On
`visibilitychange → hidden` and `pagehide`, the Reporter does a final flush via
`navigator.sendBeacon(url, json)` — which is asynchronous to the page, survives
unload, and exists on Safari 15. This is what makes "did the team finish" and the
last mistake actually arrive when the pupil closes the tab or the tablet sleeps.
Without it, the most interesting moment of the lesson is the one most likely to be
lost.

---

## 6. Minimal intrusion: the complete list of engine changes

So the cross-cutting concern stays a seam, not a rewrite. The entire footprint on
existing files:

- `engine/engine.js`: construct `GameSignals`; add `state.progress` to
  `_freshState()` and `_normalizeState()`; ~9 one-line `emit()` calls at the choke
  points in §4.1; bump `STATE_SCHEMA_VERSION`.
- `engine/puzzles/index.js`: one `emit('puzzle:evaluated', …)` in the wrapper's
  `onOk`, before the hold return, and one `puzzle:solved` on success.
- `engine/puzzles/kinds/list.js`: pass `parentRef`/`index` when it builds a step
  runner, so a step's mistakes attribute to it. (One argument; the emit still
  comes from the shared wrapper.)
- `engine/dialogs.js`: one `emit('dialog:ended', …)` in `_end()`.
- `engine/boot.js`: construct `ProgressModel`, `DashboardProjector`,
  `DashboardReporter`; wire `opts.report` transport (default `NullTransport`).
- `engine/version.js`: `ENGINE_API_VERSION` 1 → 2.

Everything else — the model, projector, reporter, transports, the domain value
objects — is new files under `engine/dashboard/`. The engine core neither imports
a dashboard type nor knows a report exists; it only publishes signals.

---

## 7. What is derived, not stored

`scenesTotal` and `puzzlesTotal` come from the game data once at boot, not from the
state: total scenes, and total *reachable leaf* puzzles (a list counts as its
steps, not as one; a hotspot puzzle counts once). leeuwenhoek's seven unreachable
showcase puzzles are excluded, and its five list steps that are also hotspots
count once, not twice — 10 tasks, not 15 (EVIDENCE §2, §9). Getting this wrong
makes every team's "solved of total" read low forever, so it has its own test.

---

## 8. Extension, concretely

Two channels, both static, both optional — no free-form runtime attributes (a
dashboard cannot render what it cannot type, and an unknown per-game attribute is
a seventh convention, which is the thing EI-010 exists to end):

- **Flags** already in the state, surfaced in a details drawer, never on the main
  board unless declared.
- **`meta.dashboard`** in a game's `scenes.json`: optional human labels for scenes
  and optional milestone declarations ("this dialog is a milestone, call it
  *Met Leeuwenhoek*"). Absent, the board runs on ids and derived counts. This is
  the only way a game influences the board, and it changes labels, never the model.

An attribute the dashboard has never seen is ignored; a game that declares nothing
still gets a full board from what the engine derives. This is what makes the
seventh game work on day one.

---

## 9. Versioning and release

- **One release** (owner decision 1). Built in the order in §11 but shipped as a
  single engine version.
- `ENGINE_API_VERSION` → 2, the first version that means anything: it now promises
  the `DashboardReport` contract.
- `STATE_SCHEMA_VERSION` bumps (additive). **No `saveVersion` moves; no lesson
  ends.** This is the load-bearing claim and it has a reload test.
- `docs/DASHBOARD-API.md` is written as the contract of record for whoever builds
  the runtime and the board.

---

## 10. Test plan, per component

The services are testable in isolation precisely because they do not reach into
each other. Every one of these fails before its code exists.

- **`ProgressModel`** — each signal updates the right field and nothing else; a
  wrong-answer increments `mistakes`; a double-evaluation within 1 s counts once; a
  `solved` is terminal; `sceneTime` accumulates across `scene:entered`. Reload
  round-trip: serialise → rehydrate → identical.
- **`DashboardProjector` — the no-leak test, the crown jewel of this whole saga.**
  Given a `RunProgress` and a state carrying `solved:pz:*` keys, flags, a hero and
  schema bookkeeping, assert the produced `DashboardReport` has **exactly** the
  declared keys and none of the internal ones. This is the test that would have
  caught the design we are replacing. Plus: derived counts correct; orphan and
  double-count cases from §7; `api === ENGINE_API_VERSION`.
- **`DashboardReporter` — non-blocking** — emitting N signals performs zero
  projections and zero sends synchronously (a spy transport sees nothing until the
  scheduled flush); a burst of N signals coalesces to one send; a transport that
  throws does not propagate into the emitter; `pagehide` triggers exactly one final
  send.
- **`GameSignals`** — publish reaches every subscriber; unsubscribe stops it; a
  throwing subscriber does not stop the others or the engine.
- **Engine integration, on the reload harness** — playing a short run produces a
  report whose counts and position match; a wrong-then-right answer on a *held*
  puzzle records exactly one mistake and then solved (the held-answer path that
  nothing records today); a reload preserves `state.progress`; and — the release's
  load-bearing claim — a `saveVersion`-unchanged reload does **not** wipe.
- **`ReportTransport`** — `NullTransport` sends nothing; `LocalCacheTransport`
  writes localStorage first and never awaits the network on the caller's path.

Every fix in this repository ships with a test that fails without it and is
mutation-checked by reverting the code in a throwaway copy; this design continues
that, and the no-leak and non-blocking tests are the two that must be mutation-proven.

---

## 11. Build order (one release, separately testable steps)

1. `GameSignals` + the emit calls + `state.progress` in `_freshState`/`_normalizeState`, with the reload round-trip test. Nothing observes yet.
2. `ProgressModel` subscribing to the signals; its unit tests. The engine now records time, mistakes, items-used, dialogs-seen — none shipped anywhere.
3. `DashboardProjector` + the domain value objects; the no-leak and derived-count tests.
4. `DashboardReporter` + `ReportTransport` interface + `NullTransport`; the non-blocking and coalescing tests; `pagehide` beacon.
5. `ENGINE_API_VERSION` → 2, `docs/DASHBOARD-API.md`, changelog. Cut the release.

The server, the board and the hosted runtime are a separate repository and are not
in this engine release; step 5 delivers the contract they consume.

---

## 12. For codex SOL to attack

- Is the sync-signal / async-flush split correct, or does "async notifications"
  require the dispatch itself to be deferred? What breaks on unload if it is?
- Is `sendBeacon` on `pagehide` enough on iPadOS 15 Safari, or does it need the
  `visibilitychange` path as the primary and `pagehide` as backup? Both are wired;
  confirm the order.
- The `puzzle:evaluated` hook in the shared wrapper: does any kind resolve without
  passing through `onOk` (e.g. a kind that calls `resolveOk` directly), so a solve
  or a mistake could be missed? Enumerate the kinds against the wrapper.
- `state.progress` growth: `puzzles` and `sceneTime` are bounded by the game's own
  size, but confirm no unbounded set (e.g. per-attempt) sneaks in and that the
  report stays within a sane size for a beacon.
- The no-leak guarantee is structural (the projector names fields) — is there any
  path where a value object carries a back-reference to internal state?

## Open, still the owner's

1. Delete leeuwenhoek's seven unreachable puzzles? (Affects `puzzlesTotal`; nothing
   restarts — unreachable puzzles are in no saved state.)
2. Class size / tablets / lesson length — sizes the server, not this engine work.
3. Who and when builds the hosted runtime — without it the board does not run, and
   it is not in this repository.

---

## Revision after SOL review

codex SOL reviewed the design above against the code and returned "sound
architecture, not sound to implement as written". Its full text is
[EI-010-SOL-REVIEW.md](EI-010-SOL-REVIEW.md). Every finding below was checked
against the code before being accepted; the three sharpest were re-verified and
held. This section is authoritative where it disagrees with the body above.

What survives unchanged: the boundary (private `RunProgress` → pure projector →
public `DashboardReport`), the report as the only thing a transport ever sees,
and synchronous O(1) progress mutation followed by a deferred, coalesced report.
SOL endorsed all of that. The rest is corrections.

### 1. The internal state has a second exit — the injected `storage` (the important one)

The no-leak guarantee was not structural. `_saveState()` hands the **raw live
internal state** to the injected storage (`engine.js:2051`,
`this.storage.save(this.state)`), and the storage is caller-supplied
(`engine.js:69`), envisaged for a hosted/remote backend. Such an implementation
could POST the private object to a server without ever touching
`ReportTransport`. Verified.

Correction, and it is a **product rule, not just a code one**:

- `storage` is **local-only** — `localStorage` on the tablet, a cache. It is the
  reload seam, not a network seam. The hosted runtime **must not** inject a
  storage that transmits `this.state`.
- The **only** sanctioned server exit is `ReportTransport`, which receives a
  `DashboardReport`, never `this.state`.
- The guarantee is scoped honestly: structural within the engine's supported
  persistence and reporting paths. It is **not** protection against arbitrary
  host-page JavaScript, which can still read `game.state` via the `onGame`
  handle. That is the embedder's trust boundary, and `docs/DASHBOARD-API.md` will
  say so.

### 2. Held wrong answers carry no `ok`, and are not saved

Two verified facts break the mistake counter as designed:

- Every kind's held branch returns `{hold: true}` with **no `ok`** — and returns
  the same shape when the puzzle is *locked* (`quiz.js:142` locked, `:181` wrong;
  `code.js:87` locked, `:99` wrong). So a `{ref, ok}` hook cannot tell a wrong
  answer from a lock. Treating every hold as wrong is unsafe.
- A held wrong answer does not resolve the puzzle, so **no `_saveState()` runs**.
  A plain dialog end with no flags or navigation is the same. The increment would
  live in memory and a reload would lose it — so "reload-safe mistakes" was false.

Corrections:

- The eight kinds' evaluation must return an **explicit result**: wrong is
  `{ok: false}` (held or not), locked is a distinct non-answer the hook ignores.
  This is a small change in each kind's `evaluate`/`onOk`, so the honest cost is
  **one hook plus a one-line result change in eight kinds** — not "one hook, no
  other intrusion" as the body claimed. Still surgical, but say it plainly.
- Split the two guarantees the body ran together:
  - **Lesson continuity** — verified and safe, and untouched by all of this.
  - **Telemetry continuity** — best-effort. A no-save transition (held wrong,
    plain dialog end, `item:used` emitted after its own save at `engine.js:526`)
    must schedule a **deferred persistence commit** so the next flush and the next
    reload both see it. This is not absolute crash-durability, and the doc must
    not pretend it is. The rule: **emit before any existing transition save; for
    transitions with no save, schedule a commit.** The reload test reloads
    immediately after each such transition, not after a later solve.

### 3. `openPuzzle` is never closed → activity lies

There is `puzzle:opened` but no close. `openPuzzle` clears only on scene entry, so
`activity` claims a solved/failed/cancelled puzzle is still open until the team
moves. Add a runner-level **`puzzle:settled`** covering all four completion
routes — `resolveOk`, `resolveFail`, a non-held `onOk`, and `onRequestClose` — and
clear `openPuzzle` on it. It needs runner identity/stack discipline because list
containers nest their child runners, and the contract must define whether
`activity` during a list means the current step, the container during its summary,
or null. Lifecycle and `solved` hooks wrap `resolveOk`/`resolveFail`
(`list.js:223`), not only `onOk`.

### 4. The choke points, corrected against the code

- **No `giveItem()` method.** Items enter at `engine.js:811` (pickup) and
  `engine.js:1006`/`:1011` (`actions.giveItem`). Both sites emit.
- **Scene commit is two sites** — the immediate image-success branch
  (`engine.js:323`) and the late-load handler after a timeout (`:344`).
  `scene:entered` emits before the save in both.
- **Do not emit completion from the `scene.end` message** (`engine.js:378`): that
  line also runs after an image error or timeout when `state.scene` has not moved.
  `run:completed` fires from the successful entry to an `end` scene, once.
- **Dialog id before the clear.** `_end()` clears `active` before running end
  actions (`dialogs.js:652`); capture the canonical id first, and decide
  explicitly whether it is `dlg.id` or the requested alias.

### 5. "Off the render thread" was overclaimed

`setTimeout` still runs on Safari's main thread, and `queueMicrotask` drains
**before** the browser paints, so neither yields to rendering. The honest,
testable claim:

- Signal mutation is O(1) and bounded.
- Projection and serialization do **not** run in the engine's transition stack —
  they run in a deferred **timer task** (not a microtask).
- The flush has a **measured maximum synchronous budget on the floor iPad**
  (iPadOS 15), and report size is bounded and tested against it.
- A literal "never blocks the render thread" is only achievable by moving
  projection/serialization to a Worker, which itself has hand-off cost. We are
  **not** doing that; we are committing to a small measured budget instead. The
  body's wording is replaced by this.

### 6. Identity and ordering: `run` + `revision`

`updatedAt` is a tablet clock and cannot order concurrent sends, retries and a
terminal beacon, nor tell a restart that reused `session/game/team`. Add:

- a public **`run`** id (minted at run start, re-minted on restart) and a
  persisted **monotonic `revision`** (incremented per report);
- the idempotency/order key `(session, game, team, run, revision)`, which the
  server uses to keep the latest and drop stale arrivals;
- a transport that **retains and retries the latest unsent report even if no
  later signal occurs** — "retry on the next flush" is not enough for a failed
  final report.

### 7. Transport owns URL/auth/lifecycle; server does not trust the tablet

`send(report)` with the reporter calling `sendBeacon(url, json)` itself was split
wrong. Instead:

- `ReportTransport.send(report, { terminal }) → void | Promise<void>`. URL, auth
  and the beacon-vs-fetch choice live **inside** the transport; `terminal: true`
  is the unload path.
- The reporter catches both a synchronous throw and a rejected promise.
- **The server binds `session`/`team` from authenticated runtime context**, not
  from fields the tablet supplied. The report's `session`/`team` are hints for
  correlation, not trust.

### 8. Lifecycle beaconing is best-effort, not a guarantee

Remove the body's claim that the handlers make the final mistake or completion
"actually arrive". `visibilitychange → hidden` is primary, `pagehide` a backup,
and **neither is guaranteed** on iOS — WebKit documents cases where no unload
event fires before the process is killed, and `sendBeacon` can return `false` and
shares a ~64 KiB queue. So: continuous sending is what limits loss; the beacon is
a best-effort last flush that dedupes on `revision`, checks its return value,
handles bfcache restore, and is never the only retry. (`requestIdleCallback` is
indeed absent on iPadOS 15 Safari — SOL confirmed — so avoiding it stands.)

### 9. Deep, allow-listed serialization

`Object.freeze` is shallow and a value object could retain a reference into
internal state. The wire boundary serializes a **fresh, deeply independent plain
object whose nested keys and primitive types are explicitly allow-listed**. The
no-leak test inspects the **actual serialized request body recursively**, not the
report's top-level keys.

### 10. Catalogue is not available at boot

`init()` loads only `scenes.json`; puzzles load lazily via
`_ensurePuzzlesLoaded()` (`engine.js:880`) — the same loader EI-030 just fixed.
So `puzzlesTotal` is not known at first render. The design:

- starts the puzzle fetch **without delaying first render**;
- defines a **catalogue-ready** signal; until it fires, `scenesTotal`/
  `puzzlesTotal` are **`null` (unknown)**, never `0` — a zero would read as "no
  puzzles" and make every team look finished;
- after a load failure the totals stay `null` (explicit unknown), and EI-030's
  retry eventually fills them.

### 11. The flags/milestone contradiction

The body promised flags "in a details drawer", but a `DashboardReport` with no
flags field and a ban on shipping internal state cannot supply that drawer.
Resolved: the report gains an optional, **declared** `milestones: string[]` — ids
a game names in `meta.dashboard` as milestones (e.g. `met_leeuwenhoek`), projected
as reached/not. The internal flags map is **never** shipped. If a game declares no
milestones, the field is empty and the board shows none.

### 12. Smaller specifics to pin before coding

- `STATE_SCHEMA_VERSION` stays **1**: the repo's own convention (`engine.js:18`)
  is that additive fields do not bump it; a bump means a migration. The body's
  "bump for cleanliness" is dropped.
- Dedup: `{ref, ok}` cannot tell a double-tap from two genuine rapid wrong
  answers. The `puzzle:evaluated` signal carries an **interaction id** (one per
  distinct submit gesture); the model dedupes on that, not on a 1 s window.
- Define exactly: what "touched" means (a puzzle appears in `puzzles` once it has
  a first evaluation); that a list container is not itself a task, its steps are;
  that an empty submission is not a mistake; whether `attempts` counts a solve;
  array ordering (stable, by first-touch); and a maximum UTF-8 wire size with the
  beacon's ~64 KiB in mind.

### Net effect on the plan

Architecture and build order (§4, §11) stand. The additions are: `run`/`revision`
and a settled-puzzle lifecycle in step 1; explicit evaluation results across the
eight kinds and deferred-commit persistence in step 2; deep allow-listed
serialization and the no-leak-on-the-wire test in step 3; the transport lifecycle
API, retry-latest, and best-effort beacon in step 4; catalogue-ready and the
`storage` local-only rule documented in step 5. No `saveVersion` still moves, and
it is still one release. SOL should see this revision before any code is written.
