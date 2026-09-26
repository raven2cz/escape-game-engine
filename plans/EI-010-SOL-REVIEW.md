# EI-010: codex SOL review of the API design

**Reviewer: codex gpt-5.6-sol, 2026-09-06, read-only.** Reviewing
[EI-010-DESIGN-API.md](EI-010-DESIGN-API.md) against the code. Verdict: sound
architecture, not sound to implement as written - a list of load-bearing gaps to
fix first. The three sharpest were re-verified here against the code and all held
(held branches return `{hold:true}` with no `ok`; there is no `giveItem` method;
`_saveState()` hands the raw internal state to the injected `storage`). The
design's answer to every point is in [EI-010-DESIGN-API.md](EI-010-DESIGN-API.md),
section "Revision after SOL review".

---

## Verdict

**Sound with specific changes, but not sound to implement as written.**

The central architecture is right: persist a private `RunProgress`, project it into a declared `DashboardReport`, and expose only that report to dashboard transport. Synchronous state mutation followed by a deferred/coalesced report is also the right general split.

Several load-bearing details are nevertheless wrong or missing. In particular, the current design does not actually guarantee reload-safe mistakes, accurate puzzle activity, ordered/idempotent reports, non-blocking execution, or that internal state cannot reach a network.

## What the code confirms

The save-version claim is correct. `_signature()` contains only game id and `saveVersion`/legacy version ([engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:173)); `_restoreState()` rejects only a mismatched signature ([engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:2085)). `STATE_SCHEMA_VERSION` is merely stamped during saving ([engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:2040)) and normalized fields are whitelisted on load. Adding `state.progress`, without touching `saveVersion`, ends no lesson.

Bumping `STATE_SCHEMA_VERSION` “for cleanliness” is harmless but contrary to the source’s stated convention: the comment at [engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:18) says an additive field does not need a schema bump; bumps are for changed meanings requiring migration. Either leave it at 1 or give the bump a defined migration meaning.

The shared runner does cover submissions from all eight leaf kinds. It invokes the original `onOk` at [index.js](/home/box/git/github/escape-game-engine/engine/puzzles/index.js:84), then inspects its result before the hold return. List steps do use that runner at [list.js](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/list.js:87). Quiz, cloze, code, choice, group, order, phrase, and match all evaluate through `onOk`; none of those leaf kinds bypasses it by calling `resolveOk` directly.

There are two qualifications. First, the wrapper continuation runs in `Promise.resolve(...).then(...)` at line 87, so that portion is a microtask, not synchronous signal publication. Second, every held wrong branch currently returns only `{hold:true}`, not `{hold:true, ok:false}`. Thus the hook observes that something held, but does not receive the `{ref, ok}` result promised by the design. Treating every hold as wrong is unsafe: quiz and code also return a hold when locked. The design must either change all eight wrong branches to return an explicit result or define a separate evaluation result passed to the wrapper.

The outer list is another distinct path: it completes by calling `resolveOk`/`resolveFail` directly at [list.js](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/list.js:223). That does not invalidate leaf mistake coverage, but it means lifecycle and solved hooks must wrap `resolveOk` and `resolveFail`, not only `onOk`.

## Reload safety is currently false for some signals

Putting `progress` in the normalized saved shape makes it capable of surviving reload; it does not cause each mutation to be persisted.

A held wrong answer does not resolve the puzzle and causes no current `_saveState()`. A dialog that ends without flags or navigation also causes no save. Consequently, `ProgressModel` can increment a mistake or mark a dialog seen in memory, but an immediate reload loses it. The same ordering problem exists if `item:used` is emitted after `_removeItemFromInventory()` performs its save at [engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:526).

The design recognizes that signals must precede existing saves, but it never specifies that ordering at every site or what happens on paths with no existing save. It must state:

- Every progress mutation that has an existing transition save is emitted before that save.
- Held evaluations, plain dialog endings, and any other no-save transitions schedule or perform a persistence commit.
- The reload test reloads immediately after each such transition, without relying on a later solve or navigation.

This creates a real tension with “no synchronous serialization”: current persistence uses synchronous `JSON.stringify` and `localStorage.setItem()` ([engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:2025)). The design must choose and document the guarantee. It cannot simultaneously promise immediate durable mistakes and claim that no serialization occurs on that path. A short deferred persistence task plus a lifecycle save may be acceptable, but it is not absolute crash/kill durability.

Lesson continuity and telemetry continuity must therefore be stated separately: the former is verified and safe; the latter is not yet designed correctly.

## Puzzle activity cannot be correct with the listed signals

There is `puzzle:opened`, but no settled/closed/cancelled signal. As written, `openPuzzle` is cleared only on scene entry. After a puzzle is solved, failed without holding, or cancelled, `activity` can continue claiming that puzzle is open until the team changes scene.

Add a runner-level `puzzle:settled` signal covering all four completion routes: `resolveOk`, `resolveFail`, non-held `onOk`, and `onRequestClose`. It needs a runner identity or stack discipline because list containers and their child runners nest. The contract must define whether activity means the leaf step, the list container during its summary, or null.

Canonical references also need definition. Inline list steps may have no `step.ref`; `puzzle.id` currently falls back through config id to `"inline"`. `parent/index` alone does not say what public `ref` should be, and multiple inline steps must not collapse into one outcome.

## Several cited choke points are incomplete or nonexistent

There is no `giveItem()` method. Items enter inventory through at least the pickup branch at [engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:809) and the `actions.giveItem` branch at [engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:1006). Both need coverage.

Successful scene commitment also occurs in two places: the immediate image-success branch at [engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:323) and the late-load handler after a timeout at line 344. `scene:entered` and completion must be applied before the save in both places. Completion should not be emitted merely from the `scene.end` message at line 378, because that line also runs after an image error or timeout when `state.scene` has not moved.

`DialogUI._end()` clears `active` before applying end actions ([dialogs.js](/home/box/git/github/escape-game-engine/engine/dialogs.js:652)). Its canonical dialog id must be captured before that assignment; using the requested alias rather than `dlg.id` also needs an explicit decision.

## “Off the render thread” is incorrect

`setTimeout` defers work to another task, but the callback still executes on Safari’s main/UI thread. Projection, `JSON.stringify`, synchronous localStorage, and invocation of `sendBeacon` or `fetch` can all delay rendering. “Fire-and-forget” means the engine does not await completion; it does not mean off-thread.

The synchronous signal/deferred flush split is nevertheless sensible if the claim is narrowed:

- Signal mutation is small and bounded.
- Projection and serialization do not run in the engine transition stack.
- Report size and flush duration have tested budgets on the minimum iPad.
- No extra dashboard `localStorage` write is performed unless its measured cost is accepted.

Do not use `queueMicrotask` as an “immediate yield” mechanism. Microtasks are drained before the browser gets its rendering opportunity, so they do not yield to paint. Use a timer/task for the flush.

If “must never block the render thread” is literal, this design cannot satisfy it without moving projection/serialization to a Worker—and even passing data to a Worker has main-thread cost. A realistic requirement should instead be a measured maximum synchronous budget.

## Safari lifecycle findings

The `requestIdleCallback` claim is correct. MDN’s current compatibility data still records Safari support only in preview behind a preference, so it was certainly absent from iPadOS 15 Safari. Avoiding it is right. [MDN browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json#L5053-L5089)

`navigator.sendBeacon` is available: Safari/iOS support begins at 11.1. [MDN browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json#L4989-L5027)

The reliability claim is wrong, however. `visibilitychange` to hidden should be primary and `pagehide` a backup, but neither is a delivery guarantee on mobile. MDN explicitly warns that `pagehide` may not fire when the user switches apps and the browser is later killed. It also documents a shared queued-data limit of roughly 64 KiB and that `sendBeacon` can return `false`. [MDN sendBeacon documentation](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)

WebKit has an open iOS/iPad report documenting cases where none of `visibilitychange`, `pagehide`, `beforeunload`, or `unload` fires on tab/app closure; WebKit also states that no script can run after process death or memory eviction. [WebKit bug 199854](https://bugs.webkit.org/show_bug.cgi?id=199854)

Therefore the sentence saying the handlers make the final mistake or completion “actually arrive” must be removed. Continuous sending limits the loss window; lifecycle beaconing is best-effort. Both handlers should deduplicate the same revision, check the beacon return value, handle bfcache restoration, and never be the only retry mechanism.

## The no-leak guarantee is not structural yet

The projector boundary is a good start, but the current engine has another official exit: injected `storage`. `Game` accepts arbitrary storage at [engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:69), and `_saveState()` hands it the raw live internal state at line 2051. Existing comments explicitly envisage hosted/remote storage. Such an implementation can POST the internal state without ever touching `ReportTransport`.

The revised design must declare `storage` local-only and remove any remote-storage role from the hosted architecture, or otherwise replace that seam so network-capable code never receives the private object. Trusted embedding code can still obtain `game.state` through `onGame`, so the guarantee must be scoped honestly: structural inside the engine’s supported reporting and persistence paths, not protection against arbitrary host-page JavaScript.

Frozen value objects and `toJSON` are also insufficient by themselves. `Object.freeze` is shallow, and constructors could retain arrays, nested objects, or back-references from state. The wire boundary should serialize a fresh, deeply independent plain DTO whose nested keys and primitive types are explicitly allow-listed. The test must inspect the actual serialized request body recursively, not merely the report’s top-level keys.

## The public protocol is missing necessary state

The report lacks a run identifier and monotonic revision. `updatedAt` is a tablet clock, not an ordering mechanism. Concurrent fetches, retries, and a terminal beacon can arrive out of order; a restart can reuse the same session/game/team. “The server keeps the sequence it receives” cannot distinguish stale arrival from current state, and repeated POST snapshots are not idempotent if the server stores every receipt.

Add public `run` and persisted monotonic `revision` fields, define `(session, game, team, run, revision)` as the idempotency/order key, and require the transport to retain and retry the latest unsent report even if no later signal occurs. “Retry on the next flush” is insufficient for a failed completion followed by no further activity.

The transport abstraction is also split incorrectly. `ReportTransport.send(report)` has no URL, authentication, lifecycle mode, or result, while the Reporter is later said to call `sendBeacon(url,json)` itself. Keep URL/auth/beacon knowledge in the transport and define something such as `send(report, {terminal})`, returning `void | Promise<void>`. The reporter must catch both synchronous throws and asynchronous rejection. For per-lesson data, the server must bind session/team from authenticated runtime context rather than trusting report fields supplied by the tablet.

## Other contract gaps

The extension section says flags appear in a details drawer, but `DashboardReport` contains no flags or milestones. With the internal state forbidden on the wire, that UI is impossible. Either remove that promise or add an explicit public projection such as declared milestone statuses; do not smuggle the internal flags map through.

The catalogue is not available “once at boot” today. `init()` loads only `scenes.json`; puzzles are loaded lazily by `_ensurePuzzlesLoaded()` when a puzzle opens ([engine.js](/home/box/git/github/escape-game-engine/engine/engine.js:880)). The design must start that fetch without delaying first render, define a catalogue-ready signal, and specify whether reports wait, expose nullable totals, or report an explicit unknown state after failure. Reporting zero would be wrong.

Finally, define the exact semantics of “touched,” successful list containers versus leaf tasks, empty submissions, attempt increments on success, the one-second deduplication rule, timestamp defaults when upgrading an existing run, array ordering, maximum UTF-8 wire size, and `sendBeacon(false)` behavior. The current one-second dedupe cannot distinguish a double tap from two legitimate rapid wrong evaluations because the signal contains only `{ref,ok}`.

## Acceptance recommendation

Keep the projector/public-report architecture and synchronous progress mutation. Revise EI-010 before implementation to add durable transition ordering, a settled puzzle lifecycle, explicit held evaluation results, run/revision identity, retry semantics, a transport-owned lifecycle API, asynchronous catalogue readiness, recursive wire serialization, and a local-only definition of the storage seam.

With those changes, the design is sound and still minimally invasive. Without them, the implementation could pass the proposed happy-path tests while losing mistakes on reload, showing closed puzzles as active, accepting stale reports as current, blocking the main thread during “async” flushes, and shipping private state through the existing storage exit.
