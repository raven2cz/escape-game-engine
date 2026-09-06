# EI-010: codex SOL review, second pass (of the revised design)

**Reviewer: codex gpt-5.6-sol, 2026-09-06, read-only.** Reviewing the revision in
[EI-010-DESIGN-API.md](EI-010-DESIGN-API.md). Verdict: the architecture is
confirmed sound and the big findings from the first pass are resolved (storage
no-leak policy, deep serialization, render-thread wording, schema version,
milestones in principle). A bounded list of load-bearing details remains, plus
three new ones the code exposed (eager loading can poison the catalogue, run
ordering across restarts, and the interaction-id dedup). "I would not hand this
text to an implementer yet." The engine-side points are folded into a third
revision of the design; several remaining points are server-side (active-run
lease, authenticated identity binding, server idempotency) and belong to the
hosted runtime, which the owner put out of scope for this engine work.

---

## Verdict

**The revised architecture is still sound, but the revised design is still not sound to implement as written.** It fixes several important findings, but some are only restated as future decisions, and the code exposes three new load-bearing problems: eager puzzle loading can poison the catalogue, `(run, revision)` does not order different runs, and the proposed interaction ID does not solve double-tap deduplication.

### Storage and the no-leak boundary

The storage finding is resolved at the architectural-policy level. The revision now declares storage local-only, makes `ReportTransport` the sole sanctioned network exit, and scopes the guarantee honestly around trusted embedding code. That is the remedy the first review requested.

The implementation must also remove the current promises that hosted storage is remote: [engine.js:69](/home/box/git/github/escape-game-engine/engine/engine.js:69) explicitly describes an authoritative Durable Object, and [boot.js:119](/home/box/git/github/escape-game-engine/escape-game-engine/engine/boot.js:119) calls injected storage “the runtime’s, when hosted.” Otherwise the supported API still advertises the forbidden second exit. The underlying fact remains exactly as reported: arbitrary injected storage receives the raw live object at [engine.js:2051](/home/box/git/github/escape-game-engine/engine/engine.js:2051).

Deep allow-listed wire serialization is genuinely resolved in the revision. Requiring a fresh recursive DTO and testing the actual serialized request body closes the shallow-freeze/back-reference problem. The implementation should additionally filter restored progress against catalogue IDs or impose hard collection bounds: `_normalizeState()` currently accepts maps shallowly at [engine.js:2122](/home/box/git/github/escape-game-engine/engine/engine.js:2122), so edited or injected saved state could otherwise create an oversized but type-valid public report.

### Held answers and reload persistence

Classification is only partly resolved. The code confirms eight leaf kinds plus the list container at [index.js:20](/home/box/git/github/escape-game-engine/engine/puzzles/index.js:20). Every held wrong leaf currently returns only `{hold:true}`: for example quiz at [quiz.js:181](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/quiz.js:181), code at [code.js:99](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/code.js:99), and match at [match.js:850](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/match.js:850). Quiz and code also use that shape for the locked path at [quiz.js:142](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/quiz.js:142) and [code.js:87](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/code.js:87). The revision correctly requires distinct explicit results.

However, “wrong is `{ok:false}` (held or not)” must not literally replace a held result with `{ok:false}`: the wrapper would resolve and close it at [index.js:89](/home/box/git/github/escape-game-engine/engine/puzzles/index.js:89). Use an unambiguous result contract—such as `status: correct|wrong|incomplete|locked` plus `hold`—and have the runner signal only actual evaluations.

That is also necessary for the newly declared rule that empty submissions are not mistakes. Empty phrase and code submissions currently evaluate normally at [phrase.js:83](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/phrase.js:83) and [code.js:89](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/code.js:89); an untouched quiz similarly computes `ok:false` at [quiz.js:144](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/quiz.js:144). Merely declaring empty submissions non-mistakes does not implement that distinction.

Reload persistence is also only partly resolved. “Emit before an existing save; schedule a save where none exists” is the right rule. But the revision contradicts itself by describing `item:used` as emitted after its save while giving the general before-save rule. The correct site is after the successful splice at [engine.js:529](/home/box/git/github/escape-game-engine/engine/engine.js:529) and before `_saveState()` at [engine.js:544](/home/box/git/github/escape-game-engine/engine/engine.js:544). No second deferred save is needed there.

A deferred save for a held mistake or plain dialog end gives eventual, best-effort reload persistence; it does not guarantee that an immediate reload occurring before the timer fires sees the mutation. The revision acknowledges best effort but then says “the next reload” sees it. That promise and its test need to be expressed as “after the scheduled commit has run, without requiring another game transition.”

The measured synchronous budget must cover this deferred `_saveState()` as well as report projection. Default persistence performs both `JSON.stringify(state)` and synchronous `localStorage.setItem()` at [engine.js:2025](/home/box/git/github/escape-game-engine/engine/engine.js:2025). Moving that work into a timer removes it from the transition stack, not from Safari’s main thread.

### `puzzle:settled` and nested lists

This finding is not resolved. The revision agrees that runner identity/stack discipline and list activity semantics “must” be defined, but never defines them.

The current runner has four relevant routes: direct `resolveOk` and `resolveFail` at [index.js:71](/home/box/git/github/escape-game-engine/engine/puzzles/index.js:71) and [index.js:77](/home/box/git/github/escape-game-engine/engine/puzzles/index.js:77), non-held wrapper completion at [index.js:87](/home/box/git/github/escape-game-engine/engine/puzzles/index.js:87), and close at [index.js:154](/home/box/git/github/escape-game-engine/engine/puzzles/index.js:154). The outer list invokes direct resolution at [list.js:229](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/list.js:229) and [list.js:231](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/list.js:231), not at line 223 as shorthand in the reviews suggests.

There are two unresolved consequences:

First, `puzzle:opened` cannot remain solely in `_openPuzzleByRef`. Child list runners are created directly at [list.js:87](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/list.js:87), so that site never sees them. Open and settled lifecycle must live at the shared runner/mount boundary if activity is intended to show the current leaf.

Second, blindly wrapping `resolveOk` to emit `puzzle:solved` would mark the outer list as solved, contradicting the revision’s rule that a list container is not a task. The design must explicitly suppress task evaluated/solved signals for the container while still settling its UI lifecycle.

Canonical inline identity also remains undefined. The runner currently collapses an unnamed inline puzzle to `"inline"` at [index.js:61](/home/box/git/github/escape-game-engine/engine/puzzles/index.js:61), while the list’s private result fallback is merely `#<index>` at [list.js:99](/home/box/git/github/escape-game-engine/engine/puzzles/kinds/list.js:99). A public identity should include the parent, for example `parentRef#stepIndex`, so two lists’ inline step zero cannot collide. Until the document defines that and states whether list summary activity is the container or `null`, the activity API is not implementable consistently.

### Corrected engine choke points

The revised inventory and scene assertions are correct.

The only two inventory additions are pickup at [engine.js:811](/home/box/git/github/escape-game-engine/engine/engine.js:811) and the `actions.giveItem` loop at [engine.js:1006](/home/box/git/github/escape-game-engine/engine/engine.js:1006). Signals must fire only for IDs actually added and before `_stateChanged()` saves at [engine.js:814](/home/box/git/github/escape-game-engine/engine/engine.js:814) or [engine.js:1036](/home/box/git/github/escape-game-engine/engine/engine.js:1036).

The only two successful scene commits are the immediate branch at [engine.js:323](/home/box/git/github/escape-game-engine/engine/engine.js:323) and the timeout’s late-load handler at [engine.js:344](/home/box/git/github/escape-game-engine/engine/engine.js:344). Both must emit `scene:entered`, and an end scene must also emit `run:completed`, after updating `state.scene` and before their respective saves. The warning about [engine.js:378](/home/box/git/github/escape-game-engine/engine/engine.js:378) is correct: that congratulatory message can execute after error or timeout without a scene commit.

The dialog diagnosis is correct but the decision remains unmade. `_end()` begins at [dialogs.js:652](/home/box/git/github/escape-game-engine/engine/dialogs.js:652); the actual clear is now [dialogs.js:658](/home/box/git/github/escape-game-engine/engine/dialogs.js:658). The requested alias is stored as `active.id` at [dialogs.js:301](/home/box/git/github/escape-game-engine/engine/dialogs.js:301), while the canonical ID is `active.dlg.id`. The contract should choose `dlg.id`, capture it before line 658, and emit before `onEnd` actions so their existing saves include it.

### Render-thread narrowing

The main correction is resolved: the revision now says deferred timer task and measured main-thread budget, not “off thread.” Avoiding microtasks as a paint yield is also correct.

The budget is not complete yet. It must measure the whole synchronous task on the floor iPad: projection, deep DTO construction, JSON serialization, deferred state persistence, and the synchronous portion of `transport.send()`. An injected transport can itself block before returning a promise, so the transport contract needs a synchronous-call budget as well. The old body wording at lines 27–28 and 72 is overridden, but the final public contract should remove it rather than leave two incompatible promises for implementers to merge.

### Run identity, revision, and transport lifecycle

This finding is only partly resolved. A persisted monotonic revision orders reports within one run, but the design does not say that the run ID itself is persisted. Because `run:started` occurs during every `init()`, an implementation could accidentally mint a new run on every reload. `run` must be created only in `_freshState()`, retained by `_normalizeState()`, and generated for an older save only when absent. Restart/reset then obtains a new value by obtaining a fresh state.

Revision allocation also needs ordering: reserve the next revision, persist it, then send that exact snapshot. If a report is sent before the increment is durable, a reload can reuse the same revision for different content and the server may discard real progress as an idempotent duplicate. The normal and terminal flushes must share one serialization gate and reuse the same revision when resending the same snapshot.

More importantly, `(session, game, team, run, revision)` cannot determine which of two different runs is current. Suppose old run A has an unsent revision 20, restart creates run B revision 1, and A’s retry arrives last. The tuple distinguishes them but does not make A stale relative to B. The server needs a server-bound active-run generation or writer lease established at boot/restart. This is especially important because the current engine permits multiple pages to share a storage key derived only from session/game/team at [engine.js:1995](/home/box/git/github/escape-game-engine/engine/engine.js:1995).

Transport ownership of URL, authentication, and terminal mode is otherwise the right correction, and binding session/team from authenticated runtime context resolves the tablet-trust issue. Retrying the latest report without requiring a later signal also resolves the prior conceptual gap, but it needs an explicit retry timer/backoff and an acceptance test for “failed final report, no more signals.”

The beacon correction is substantively resolved: hidden first, pagehide backup, same revision, bfcache-aware, best effort only. There is one API mismatch left. `sendBeacon(false)` must be converted by the transport into a failed send—by throwing, returning a failure result, or falling back—because `send(report, {terminal}) → void | Promise<void>` does not otherwise expose the boolean the revision says must be checked.

### Catalogue and null totals

Nullable totals correctly resolve the false-zero problem. The new code assertion about retry does not hold, however.

`_ensurePuzzlesLoaded()` currently treats failure as `{}` and stores that empty map at [engine.js:911](/home/box/git/github/escape-game-engine/engine/engine.js:911). Every later call returns immediately because any object map counts as loaded at [engine.js:881](/home/box/git/github/escape-game-engine/engine/engine.js:881). Therefore “EI-030’s retry eventually fills them” is false in this checkout.

This becomes a new gameplay regression under the proposed eager prefetch: a transient background failure before first render would permanently install an empty catalogue, and the first real puzzle tap would fail instead of retrying. The loader must distinguish “not loaded,” “loading,” “loaded successfully, including legitimately empty,” and “failed/retryable,” coalesce concurrent requests, and emit catalogue-ready only after a successful parse. That change must precede the eager fetch.

### Milestones and remaining specifics

Replacing raw flags with declared milestones fixes the privacy contradiction in principle. The wire meaning still needs one sentence: `milestones` should be the stable declaration-order list of reached milestone IDs, with absent IDs meaning not reached. The `meta.dashboard.milestones` declaration schema and whether the field is always present or optional must also be fixed; the revision currently calls it optional but also says games with none report an empty array.

`STATE_SCHEMA_VERSION = 1` is correctly resolved and matches [engine.js:18](/home/box/git/github/escape-game-engine/engine/engine.js:18). No `saveVersion` change is needed: the signature remains only game plus save version at [engine.js:173](/home/box/git/github/escape-game-engine/engine/engine.js:173), and restore rejects only signature mismatch at [engine.js:2085](/home/box/git/github/escape-game-engine/engine/engine.js:2085).

“Touched on first actual evaluation” and “list containers are not tasks” are now stated. The other smaller specifics are not actually pinned: whether a successful evaluation increments `attempts`, defaults for `startedAt` and `sceneEnteredAt` when upgrading an existing save, exact ordering for every output array, and a concrete maximum UTF-8 body size remain open. “Under the beacon limit” is not a maximum.

Finally, the interaction-ID replacement does not solve deduplication as written. The base OK button calls `onOk()` once per click with no guard at [base.js:168](/home/box/git/github/escape-game-engine/engine/puzzles/base.js:168). Two taps are two submit gestures, so “one interaction ID per distinct submit gesture” generates two IDs and counts twice. Either prevent a second evaluation while the first gesture is in flight, or define one evaluation transaction whose ID remains stable across duplicate delivery. The model cannot infer user intent from two unique IDs.

In short: the revision made real progress and corrected most factual choke points, no-leak serialization, lifecycle reliability claims, and the main-thread terminology. But puzzle lifecycle/identity, telemetry persistence, cross-run ordering, eager catalogue failure, deduplication, and several public contract details are still load-bearing. I would not hand this text to an implementer yet. No files were modified.
