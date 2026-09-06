# EI-010: the system state, designed

**Author: Fable 5.1, 2026-09-06.** Commissioned against
[EI-010-EVIDENCE.md](EI-010-EVIDENCE.md), which it corrects in five places - all
five re-verified against the code and the data before this file was committed;
see the note at the end of the evidence document.

> ## Owner's decisions, 2026-09-06 — these amend what follows
>
> The owner reviewed the design and approved the direction. Four decisions
> change it, and where they conflict with the text below, these win. Recorded
> here so they are the first thing the next implementer reads.
>
> 1. **One release, not three.** Build it in steps if that helps, but cut a
>    single engine version at the end. Do not spend a version number per phase.
>
> 2. **The teacher watches live, during the lesson.** So the state is sent
>    continuously, and the sending must be **simple, fast, and must never slow
>    the game** — fire-and-forget, off the critical path, `localStorage` first.
>    This settles the open question at the end of the document.
>
> 3. **Error stats stay simple.** A mistake counter per puzzle plus "solved",
>    nothing more. No per-evaluation event rows, no captured answer payloads.
>    "Stuck" needs no separate computation: the engine is a state machine, so it
>    already knows the current scene and the open puzzle, and reporting those
>    plus a timestamp is enough for a teacher to see who is stuck.
>
> 4. **Do not ship the internal state. Declare an API and fill it.** This
>    **overrides the design's central recommendation** ("the dashboard document
>    is the saved state, unchanged"). The engine must define an explicit,
>    versioned public contract — a domain model of what a dashboard is told — and
>    a projection that fills it from the internal state. Only that contract goes
>    on the wire. The internal state stays private and can be refactored without
>    touching the dashboard.
>
> **Why 4 is right, and how it keeps what the design got right.** Shipping the
> saved state couples the wire to the persistence format: every internal
> refactor risks the dashboard, internal shapes leak (solution keys, hero
> internals, schema bookkeeping), and the API version tangles with the save
> version. A declared DTO is an anti-corruption layer. It keeps the design's two
> virtues anyway, because the internal state remains the single source: reload
> safety is untouched (the projection only *reads* state), and a lost minute
> loses nothing (each report is a complete current snapshot, idempotent — the
> server keeps the sequence, so history lives server-side rather than embedded in
> the save). The projection is `internal state → DashboardReport`; the contract
> and its `ENGINE_API_VERSION` are what the next design step must pin down, with
> a real domain model. This part is not to be botched.

Not yet implemented; below is the design as Fable submitted it, now read through
the four decisions above. **The dashboard-facing layer — the public API, the
projection, the services and the async transport — is designed authoritatively in
[EI-010-DESIGN-API.md](EI-010-DESIGN-API.md), which supersedes the "ship the saved
state" recommendation here.** What remains useful below is the evidence-derived
choke-point analysis and the entity discussion.

Design only. Nothing is implemented; every step in section 4 is a separate,
reviewable change. Verified against `escape-game-engine@main` (fd36dd3) and
`escape-games@804ed1d`, by reading `engine/engine.js` in full, the runner, the
kinds, the dialog and content writers, and by re-measuring the six games with
`jq`. The draft was then attacked by a second pass; what it broke is fixed
below and marked "(review)".

## Context

The teacher dashboard needs one source of truth for "what is each team doing".
Every game signals progress its own way, nothing records time, failure or
attempts, and the per-step results of list puzzles are lost.
`plans/EI-010-EVIDENCE.md` measured that ground. This is the design that stands
on it: a verdict on the owner's "one system state" thesis, the entity model,
the dashboard contract, a shippable order, and answers to the seven questions.

## Corrections to the evidence

The audit asked to be checked. Most of it holds: 71 puzzles, 28 list-only
steps, 36 top-level, 7 orphans, the kind distribution, one `end` scene per
game, the flag vocabularies, `game_completed` in three games via dialog
`onEnd`, six message-only `onFail` blocks, zero `openPuzzle`. What does not:

1. **Wrong answers mostly never reach the runner, so they are not "computed and
   thrown away"; they are never computed.** All eight leaf kinds return
   `{hold: true}` on a wrong answer when `blockUntilSolved` is set (quiz.js:181,
   cloze.js:414, code.js:99, choice.js:281, group.js:310, order.js:196,
   phrase.js:101, match.js:850). The puzzle stays open and `onResolve` fires
   only for the eventual success or a cancel. 47 of the 62 leaf puzzles have
   `blockUntilSolved: true` at puzzle level, and puzzle-level options win over
   hotspot and list options (`BasePuzzle` merges `{...instanceOptions,
   ...config.options}`). Of the 28 list-only steps, 21 block, including all
   nine of reactor's `puzzle-quiz-list-1`, the evidence's flagship example. Only
   reactor's light list (5) and time-factory's book (2) resolve a wrong answer
   to the list. Consequence: the attempt signal has to come from the kinds'
   `onOk`, which the runner already wraps (index.js:85-94), not from
   `onResolve`.
2. **"Changing the saved shape ends every lesson" is too strong.**
   `_restoreState()` (engine.js:2087) compares only `signature`, which is
   `meta.id|saveVersion`. `STATE_SCHEMA_VERSION` is stamped and never compared;
   `_migrateState()` is a no-op. Adding whitelisted fields ends nothing.
   `docs/RELEASING.md` has this right; section 7 of the evidence and the
   request compress it. This design is additive: **zero resets**.
3. **`aggregateOnly` is in five games, not one.** 58 occurrences; 16 puzzles
   set it `true` at puzzle level (reactor's nine quiz steps and five light
   steps, time-factory's two book steps). The conclusion survives: no hotspot
   sets it, so `_appendPuzzleResult()` never runs and the bucket is empty.
4. **`goTo` as an action key occurs 19 times, not 104.** 104 is the raw string
   count and includes the 85 hotspot type values. The argument (both spellings
   reach `goto()`) is unchanged.
5. **Reaching the end scene is a legitimate finish in all six games.** The
   evidence says nothing distinguishes finishing from navigating to the exit.
   Measured: heat-escape gates it on `solved_room5`, warp-engine on
   `warp_engine_active`, stop-train on five items, time-factory on six, and
   leeuwenhoek and reactor reach `exit` only through an action fired by a
   success. The only way round is devtools, which iPad Safari does not have.
   `game_completed` is redundant and is read by nothing.
6. Minor: `Date.now()` appears four times, not five, all pointer handling.
   `helpers/reload.js` lives in the engine repository, as the evidence says.

**Found while designing, not in the evidence.** `_ensurePuzzlesLoaded()`
(engine.js:880-913) has no timeout and on any failure caches `{}`, after which
line 882 returns early forever: one dropped request for `puzzles.json` makes
every puzzle in the game unopenable until the tablet reloads. Same class as
EI-003. It belongs in the registry as EI-030 and is fixed in step 3, because
step 3 touches that function anyway.

## 1. Verdict

Accept "one system state". It is right, and it is right for a reason the
thesis does not state: **it already exists.** Every durable change in the
engine ends in `_saveState()` (verified: `goto`, the puzzle path, `_stateChanged`,
`_processEvents`, `_removeItemFromInventory`, dialog `_applyFlags`, content
`contentShown`, the hero). That function is the only writer, and
`opts.storage.save(state)` is the only exit. The system state is the persisted
state, and the dashboard API is that object leaving through that seam. The
clever thing is to build no second representation: no event bus, no per-game
reporter, no dashboard schema that has to be kept in step with the save
format. Complete the object with what it lacks (time, sequence, outcome,
attempts, completion) and let the seam carry it.

Three sharpenings change what gets built:

**Games declare, they do not provide.** The games are JSON with no code; they
cannot populate anything at runtime, and three of six have nothing they could
declare. So "every game provides the system state" has to mean: the engine
derives the state from what happened, uniformly, and a game may optionally
declare labels and milestones on top. Correspondingly "the engine sets those
attributes and can extend them" becomes: the engine owns every attribute;
games extend through exactly two channels, `flags` (already free-form, already
persisted, already in the document) and a static declaration block. No
free-form runtime attributes, because a dashboard cannot render what it cannot
type, the whitelist drops what it does not know, and a per-game attribute is a
seventh convention, which is the disease EI-010 records.

**Cybernetics applied, not invoked.** The run is the system, the saved state
is the observation, the dashboard is an observer with no feedback path in v1
(the teacher acts in the room). Two consequences follow. The observation
channel is lossy (school Wi-Fi), so each observation must be complete on its
own: a snapshot with its history inside it, not a stream that needs every
message. And requisite variety cuts both ways: the observation carries what
the teacher's decisions need, section 6's five things, and no more, because
every extra field is whitelist to maintain and bytes on a tablet.

**What holds as games multiply.** The shape is game-agnostic, so a seventh game
has a full board on day one with nothing declared. Declarations are optional
refinement. The API version moves with the engine, never per game. A game's
`saveVersion` stays the only lesson-ending switch, untouched by any of this.

**What is rejected.** The registry's earlier proposal, an append-only event log
with sequence numbers and the runtime holding the authoritative snapshot.
Reasons under question 1. One piece of it survives in a different place: the
*runtime* stores every received document rather than only the latest (review).

## 2. Entity model

Three entities plus one static catalogue. Types are JSON types; timestamps are
milliseconds since the epoch on the tablet's clock.

### Run (aggregate root; one per session, game, team)

| attribute | type | persisted or stamped | status |
|---|---|---|---|
| `signature` (`gameId\|saveVersion`) | string | persisted, compared | exists |
| `sessionId`, `teamId` | string or null | **stamped**, write-only | new |
| `stateSchemaVersion`, `engineVersion`, `engineApiVersion` | int, string, int | stamped | exist |
| `runId` | 16 hex chars from `crypto.getRandomValues`, minted in `_freshState()` and whenever absent on load | **persisted** | new (review) |
| `seq` | non-negative int, +1 per save | **persisted** | new |
| `startedAt` | int or null | persisted, set in `_freshState()` | new |
| `updatedAt` | int | stamped in `_saveState()` | new |
| `completedAt` | int or null | persisted, set on entering the `end` scene | new |
| `scene` | scene id | persisted | exists |
| `sceneEnteredAt` | int | persisted, moves with `scene` | new |
| `sceneTime` | map scene id → ms accumulated, updated when a scene is left | persisted | new (review) |
| `open` | `{ref, parent?, index?, since}` or null: the puzzle on screen | stamped | new (review) |
| `visited` | map scene id → true | persisted | exists |
| `inventory` | list of item id | persisted | exists |
| `flags` | map name → bool; values game-defined, container engine-owned | persisted | exists |
| `solved` | map `solved:pz:<ref>` → true | persisted | exists |
| `eventsFired`, `contentShown`, `sceneImages`, `hero`, `useItemId` | as today | persisted | exist |
| `puzzleResults` | list of Outcome, append-only, cap 2000 | persisted | exists, always empty today |
| `progress` | Progress or null | stamped, recomputed every save | new |

"Stamped" follows the pattern `_saveState()` already uses for `engineVersion`:
written on every save, dropped by the whitelist on load, never trusted from
storage. "Persisted" means whitelisted in `_normalizeState()` with a type
check and a default.

`runId` is the epoch of this attempt at the run. `restart()` and `reset=1`
produce a fresh state with a new `runId` and `seq 0`; a state whose `runId` is
missing (written by a 1.0.x engine, or rolled back through one) gets a new one
on load. It is not a lesson or team identity, which the engine still never
invents (EI-002); it identifies "this sequence of saves", which is what the
server needs to order documents and what a timestamp cannot do once an iPad
corrects its clock. `seq` must be persisted, not in-memory: after a reload it
has to continue, or the server would fence every post-reload document as stale.

`sceneTime` is what "stuck relative to the class" actually needs: the
comparison is this team's time on its current scene against what other teams
spent there, and those teams have left. `visited` is unordered and untimed and
cannot answer it. A map keyed by scene is bounded by the scene count (66
across the catalogue) and needs no cap. `open` is the other half of "stuck":
on the same puzzle for how long, and at which step of a list. It is stamped,
not persisted, so a reload clears it, which is true.

### Outcome (one row per evaluation of a puzzle by the team)

| attribute | type | notes |
|---|---|---|
| `at` | int | |
| `ref` | puzzle id | inline steps get `#<index>`, as list.js already names them; none shipped |
| `kind` | `quiz`, `cloze`, `list`, … | |
| `ok` | bool | |
| `held` | bool, optional | true when the kind kept the puzzle open (`blockUntilSolved`); absent otherwise |
| `reason` | string, optional | `cancel` and `incomplete` from `resolveFail`; `incomplete` also from a kind when OK was tapped with blanks or nothing selected (review). Neither is a wrong answer |
| `parent` | list puzzle id, optional | present for a step |
| `index` | int, optional | position in the list |
| `answer` | compact object, optional | quiz `selectedIds`; choice `values`; phrase and code `value`; cloze `placements`; order `ordered`; group `groups`; match `pairs`. Never any `solution*` key, never a nested `results`. Bounded to 1 KB of JSON; larger is dropped with `answerTruncated: true` |

Cardinality: Run 1 to 0..N Outcome. Derived, not stored: **wrong attempts** =
count of rows with `ok: false` and no `reason`, per `ref`; **done** = any row
with `ok: true` per `ref`, or a `solved` entry. Counting all rows would be
wrong, because a reload mid-list restarts the list at step 0 (list.js keeps
`_currentIdx` in memory) and re-answering appends rows (review). Two
consecutive held-wrong rows for the same `ref` with the same `answer` within
one second are one attempt: a double tap on OK evaluates twice (base.js binds
`click` with no guard) (review). The cap goes from 500 to 2000; a full run of
any shipped game is under 300 rows and the cap bounds a runaway.

### Progress (derived, stamped, never read back)

`{scenes: {visited, total}, tasks: {done, total}, finished}`, or `null` until
the catalogue exists. A task is a **unique** leaf puzzle reachable from a
hotspot `puzzleRef` (or the `puzzle: {ref}` spelling engine.js:822 accepts),
an `openPuzzle` action, or a step of a reachable list; a list container is
not a task. Keyed by puzzle id, not by `(parent, ref)`: leeuwenhoek's five
`list-lab-demo` steps are also direct hotspots in `puzzle-lab`, and a team
that solves one from the hotspot has done that task (review). Leeuwenhoek
therefore has 10 tasks, not 15. `finished` is `completedAt != null`.

### Game catalogue (static; not in the state)

Tasks with kind, parent, index, title and prompt; scenes with title and `end`;
declared milestones. The dashboard reads it from the game files the runtime
serves, or from an index the runtime derives from them. The dashboard is a
pure function of (documents per team, catalogue).

### Engine-owned versus game-extensible, concretely

Every attribute above is engine-owned: the engine writes it, the whitelist
admits it, the dashboard can rely on it in every game.

Game-extensible means two channels and nothing else:

1. `flags`. Any game can set any flag; it is already persisted and already in
   the document. No new mechanism.
2. `meta.dashboard` in `scenes.json`, optional: `milestones`, an ordered list
   of `{flag | scene | task: <id>, label}`, and optional `labels` for tasks.
   Typed by construction, because a milestone can only be one of three things
   the engine already knows. A games-repo data test refuses an id that does
   not exist.

What the dashboard does with what it has never seen:

- A document field it does not know: ignored, silently. This is what lets the
  engine add fields without bumping the API.
- A flag not declared as a milestone: shown in a "details" drawer as
  `name: true`, never on the board.
- An `answer` for a kind it does not know: shown as JSON in the drawer, never
  interpreted.
- An `engineApiVersion` higher than its own: a banner ("this tablet reports in
  a newer format") and position-only display (scene, visited, solved, flags,
  inventory, which every engine since 1.0.0 writes).

## 3. Dashboard contract

**Shape.** The document is exactly what `_saveState()` hands to
`storage.save()`. No transformation on the tablet. The runtime wraps it:
`{key: {session, game, team}, receivedAt, state}`.

**Size budget.** Under 64 KB for a complete run of any shipped game, measured
by a test that plays reactor to the end with a wrong answer per step. That is
the `fetch` keepalive and `sendBeacon` limit, and it is also what makes a PUT
per `goto()` tolerable on school Wi-Fi. The 1 KB bound on `answer` and the
compaction rules exist for this (review).

**Transport.** Owned by the runtime; the reference adapter lives in the engine
repository (`engine/storage/remote.js`, opt-in through `boot({storage})`) so it
can be tested with the reload harness against the guarantee it must honour.

- `save(state)`: write localStorage first, synchronously, every time. That is
  the reload guarantee and it is never skipped. Then mark dirty and schedule a
  coalesced send after about 250 ms, because one `goto()` saves two or three
  times (flags, `eventsFired`, scene). Send `PUT /runs/{session}/{game}/{team}`
  with the document. On failure: backoff from 1 s to 30 s, keep only the
  latest document, never throw, never block the engine. If the engine's
  `runId` changes (restart), the pending document is dropped. On `pagehide`
  and `visibilitychange: hidden`: `sendBeacon` the latest if it fits, and
  otherwise nothing, because `init()` saves unconditionally at boot
  (engine.js:293) and the next boot resends anyway; the beacon is an
  optimisation, not a guarantee (review).
- `load()`: localStorage. Then, if the network answers, GET the server's
  `(runId, seq)` for the key: if it is the same `runId` with a higher `seq`
  (a second tab wrote after this one), return the local state with `seq`
  raised to the server's, so the board does not freeze on documents the server
  fences (review). If localStorage is empty, return the server copy: the
  tablet-swap case.
- Server: **store every received document**, keyed by `(key, runId, seq)`, and
  render the latest (review). Storage is cheap, nothing is overwritten, and a
  wrong "latest" is visible and correctable rather than silent. "Latest" is:
  the highest `seq` within the most recently *received* `runId`. A document
  with a `seq` at or below one already stored for its `runId` is an idempotent
  retry and gets 200 without effect. Stamp `receivedAt`. Fan out to dashboard
  subscribers (SSE from the Durable Object); the dashboard polls on reconnect.
- Two writers of one run (a tablet swap while the first tablet's adapter still
  holds an unsent document, or two tabs of one run): the runtime issues a
  writer lease on the tablet-swap GET and refuses the old writer's late PUT.
  Named here, designed with the runtime. The append-only store means the
  failure mode until then is a visible branch, not a silent overwrite.
- Auth: the runtime mints a per-run token into the boot HTML; the adapter
  sends it. A pupil must not be able to PUT another team's key. Outside this
  design, flagged.
- Presence: an optional 30 s heartbeat `{runId, seq, at}` from the adapter, so
  "no progress for eight minutes" and "tablet asleep" are distinguishable. Not
  in the state.

**A school network dropping for a minute.** Nothing is lost. The tablet plays
on against its local copy; the adapter holds the latest document; the first
successful send after the outage carries the whole history because the
history is inside the document. The board shows the team as "last seen 1 min
ago" from `receivedAt`, then current. A tablet that reloads during the outage
resumes from localStorage as today, and `seq` continues from the persisted
value, so the server never mistakes the post-reload documents for stale ones.

**Clocks.** Durations inside a run (`sceneTime`, `sceneEnteredAt` to
`updatedAt`, spacing between attempts) are on the tablet's clock and
consistent with themselves. "Stuck" and "last seen" use `receivedAt`, the
server's clock. The dashboard never subtracts a tablet timestamp from a server
one. A tablet asleep over a break inflates `sceneTime` for that scene; the
board caps a single visit at the lesson length when comparing.

**Versioning.** `ENGINE_API_VERSION` goes to 2 with the first release that
carries Outcomes and time. From then: adding a field is not a bump, since the
dashboard ignores unknowns; renaming a field or changing the meaning of one
the dashboard reads is. It will usually move together with
`STATE_SCHEMA_VERSION`, because the document is the state, and that is fine:
they answer different questions (can this engine read it; can this dashboard
read it). A dashboard treats `engineApiVersion` absent or 1 as position-only.

## 4. Implementation order

Each step is one PR with its own tests, separately mergeable and testable.
Steps 1 to 4 ship as **one engine minor release, 1.1.0**, so
`stateSchemaVersion: 2` and `engineApiVersion: 2` each mean one thing. No step
touches `_signature()` or `_storageKey()`; nothing ends a lesson.

**Step 1: clock, epoch and sequence.** `engine/engine.js` only.
`_freshState()` gains `runId, seq: 0, startedAt: now, sceneEnteredAt: now,
completedAt: null, sceneTime: {}`. `_saveState()` increments `seq` and stamps
`updatedAt`. In `goto()`, where `state.scene` is recorded (the `ok` branch and
the late-load listener, both token-guarded): if the scene changed, add `now -
sceneEnteredAt` to `sceneTime[previous]` and set `sceneEnteredAt = now`; if
`scene.end` and `completedAt` is null, `completedAt = now`.
`_normalizeState()` whitelists the six with type checks and mints `runId`
when absent. `opts.now` is injectable, default `Date.now`, because the suite
uses no fake timers. Tests, all on the reload harness: the fields survive a
reload; `seq` strictly increases across one; `runId` is stable across a reload
and new after `restart()` and after `reset=1`; a state without `runId` gets
one; `completedAt` is set once and kept on revisit; `sceneTime` accumulates
across two visits and across a reload; a scene that fails to display moves
neither `scene` nor `sceneEnteredAt` (the EI-003 rule); a state that predates
the fields normalises to `seq 0` and `startedAt null`.

**Step 2: every evaluation is an Outcome.** `BasePuzzle.holdWrong(detail,
reason)` returns `{hold: true, ok: false, detail, reason}`; the eight kinds use
it in their wrong-and-block branch, passing `reason: 'incomplete'` when the
submission is empty or has blanks (cloze already distinguishes unfilled gaps at
cloze.js:399; quiz is `sel.size === 0`; phrase and code an empty value; order,
group and match not everything placed). In the runner's `onOk` wrapper
(index.js:85-94), after the `__resolved` check and before the hold check: when
`r.hold && r.ok === false`, call `args.engine?._recordOutcome?.(…, {held:
true})` and hold as before. The runner wraps `args.onResolve` once so every
resolution path (`resolveOk`, `resolveFail`, `onOk`, `onRequestClose`) records
an Outcome before the caller sees it; `parent` and `index` come from new
`args.parent`/`args.index`, which list.js passes. The runner also tells the
engine when a puzzle mounts and when it settles, which is what stamps `open`.
`_recordOutcome()` in engine.js is the single writer, through the existing
`_appendPuzzleResult()` with the cap at 2000, `answer` compacted (drop
`solution*` keys and nested `results`, bound to 1 KB), and the one-second
duplicate rule. It calls `_saveState()`, not `_stateChanged()`, so no
`stateChange` event fires mid-puzzle; `_saveState()` touches no DOM and does
not interact with `_hotspotBusy` or `_renderHotspots()` (checked against
EI-013 and EI-023). The two `aggregateOnly` appends at engine.js:845 and :1761
are deleted; they would double-record. Their other effect, no `solved` entry
for an `aggregateOnly` hotspot, is kept. `STATE_SCHEMA_VERSION = 2`;
`_migrateState()` gets its first real step: drop any `puzzleResults` row
without a numeric `at`, because a v1 row never has one and a v2 row always
does (review). That is honest to the engine's own rule at engine.js:18-21, and
it is why the field is reused rather than renamed: the v1 whitelist keeps
`puzzleResults` as an opaque list, so Outcomes survive a rollback and come
back on roll-forward, where a new name would be dropped. Tests: a solved
top-level puzzle gives one Outcome plus `solved`; a three-step list gives
three step Outcomes with `parent` and `index` plus one list Outcome; a cancel
gives `reason: 'cancel'` without `held`; `blockUntilSolved` wrong then right
gives two Outcomes; OK tapped with nothing selected gives `reason:
'incomplete'`; two evaluations of the same wrong answer inside a second give
one row; each of the eight kinds reports a held wrong answer, looped over the
real `games/demo` puzzles; Outcomes survive a reload; the cap holds; an
`aggregateOnly` hotspot records once and is not marked solved;
`_normalizeState()` drops a row that is not an object with a string `ref`; a
v1 row is dropped by the migration.

**Step 3: derived progress, and EI-030.** `_catalogue()` walks hotspots
(`puzzleRef` and `puzzle.ref`), events (`openPuzzle.ref`) and lists (`steps ||
items`), de-duplicates by puzzle id, and is cached on the Game once the puzzle
map exists. `init()` **starts** `_ensurePuzzlesLoaded()` and does not await it
(review): awaiting a fetch with no timeout before the first scene is the EI-003
hang in a new place, and the ES5 fallback would then blame the browser.
`_ensurePuzzlesLoaded()` stops caching a failed load as `{}`, so the next
puzzle tap retries instead of failing for the rest of the lesson; that is
EI-030, tested on its own with a `fetch` that fails once. `_saveState()`
stamps `progress`, or `null` until the catalogue exists. Tests: a synthetic
game with a list, an orphan puzzle, an inline step and a puzzle that is both a
step and a hotspot gives the right totals, `done` moves on solving from either
place, the orphan is excluded, `progress` is `null` before the puzzle map
arrives and populated after. Games repo: a data test that every puzzle is
reachable, which fails today on leeuwenhoek's seven showcase fixtures.
Recommend deleting them there: unreachable means no save can hold them, so no
`saveVersion` bump; they stay in `games/demo`.

**Step 4: the contract, written down.** `_saveState()` stamps `sessionId` and
`teamId`. `ENGINE_API_VERSION = 2`. New `docs/DASHBOARD-API.md`: the document
field by field, the tolerance rules, the version rule, the fence, the size
budget. CHANGELOG under Unreleased, and EI-030 in the registry. The size test
from section 3. `engine.state-schema.test.js` extended for the stamps.
Release 1.1.0.

**Step 5: remote storage adapter.** `engine/storage/remote.js` as in section
3. Tests with a stubbed `fetch`: the local write precedes any network call; a
failed send retries and sends only the latest; a `runId` change drops the
pending document; `load()` raises `seq` when the server is ahead on the same
`runId`, returns the server copy when local is empty, and returns local when
the network is silent; `sendBeacon` on `pagehide` only when the document fits;
the engine never sees a rejection. Shippable as 1.2.0 on its own; nothing in
the state changes.

**Step 6: runtime and dashboard v0.** In the runtime repository, not this one.
One Durable Object per session, append-only documents with the fence, SSE out.
Dashboard v0 is one table (team, scene, time on scene against the class,
tasks done of total, last seen, finished) and one grid (task by team: ok,
wrong, held, untouched) from Outcomes and the catalogue. Put it in front of
one teacher before step 7.

**Step 7: declarations.** Games repository, only after a teacher has asked for
something the derived board does not show: `meta.dashboard.milestones`, task
labels, and the data test that every referenced id exists.

**A follow-up this design enables but does not include.** With Outcomes
persisted, a list could resume after a reload from its first step without an
`ok` row instead of restarting at step 0. It changes what a pupil sees, so it
is the owner's call, and it is one small change in list.js once step 2 exists.

## 5. The seven questions

1. **Snapshots**, carrying their own history and a sequence number. The engine
   already produces one on every change through one function; a snapshot is
   complete on its own, so a dropped request costs nothing once the next one
   lands; the reload guarantee is free because the snapshot is the persisted
   state; and the dashboard renders state anyway. An event log needs its own
   persistence across reloads, its own cursor and its own replay, three new
   things to get wrong for the same picture. A minute without network changes
   nothing: the adapter keeps the latest, sends it when it can, the server
   fences by `(runId, seq)` and stores every document it accepts. Events would
   need every message buffered in order across a reload to give the same
   result. The one thing a log does better, the shape of the whole lesson
   after the fact, the runtime gets by keeping every document rather than the
   latest.
2. **One model in the engine, populated by the engine.** Games declare,
   optionally; three of six will declare nothing and still fill a board. A
   per-game descriptor the engine interprets is a seventh convention.
3. **Derived.** Tasks done of total and scenes visited of total, stamped on
   every save; time per scene for the class comparison; finished is
   `completedAt`. No spine is needed. A declared milestone list is a later
   refinement, not a prerequisite.
4. **Flags plus a static declaration block.** Runtime extension is `flags`,
   already there. Static extension is `meta.dashboard`, typed by construction.
   Unknown document fields are ignored; undeclared flags go to the drawer; a
   newer API version gives a banner and position-only display.
5. **Yes, the persisted state changes, and no, nothing resets.** Six new
   persisted fields, widened Outcome rows, unconditional recording,
   `STATE_SCHEMA_VERSION` 2 with a real one-line migration. The signature is
   untouched, everything is additive, `_normalizeState()` fills defaults for
   runs that predate the release. One engine release carries all of it, so the
   schema moves once. The lossy direction is a rollback past 1.1.0 during a
   lesson: the v1 whitelist drops the six scalar fields (Outcomes survive
   inside `puzzleResults`), and on roll-forward the run gets a new `runId`,
   `seq 0` and an empty `sceneTime`, which the server treats as a new epoch.
   The board loses that team's timings, not its progress. Fix forward, as
   RELEASING.md already says.
6. **The saved state object, wrapped by the runtime with key and
   `receivedAt`.** `ENGINE_API_VERSION` 2 in 1.1.0; bump on rename or meaning
   change of a read field, not on addition.
7. **Per team.** One tablet is one team, the key is per team, nothing in the
   engine identifies a pupil. The board says "team" everywhere and never
   "pupil", so nobody reads a wrong answer as one child's.

## What is still uncertain, and what would settle it

- No teacher has been asked. Step 6's v0 board in front of one teacher settles
  what step 7 should declare, if anything.
- Class size, tablets per class and lesson length decide the Durable Object
  fan-out and whether SSE suffices. Unknown; irrelevant before step 6.
- The 64 KB budget is a spec limit and a guess about school Wi-Fi; the size
  test gives the number, and Safari 15 on a real iPad gives the truth about
  `sendBeacon`.
- `answer` for `phrase` and `code` is free text a pupil typed. It goes only to
  that team's teacher. Keep, and say so in the contract.
- Two tabs of one run on one tablet is last-writer-wins locally today, before
  any of this. The boot resync keeps the board live; the append-only store
  makes it visible; nothing here makes it correct, and EI-002 already judged
  the simultaneous case unrealistic.
- A pupil can edit `seq` in devtools on a desktop. The server can cap a jump;
  on an iPad the question does not arise.

## Verification

- `npm test` green after every step; each new test verified to fail before
  its change, the repository's standing rule.
- The reload harness for every persisted field.
- The size test: a scripted full run of reactor with one wrong answer per
  step, document under 64 KB.
- Games repository: `npm test` with the reachability data test;
  `npm run release:check` unchanged, since no `saveVersion` moves.
- By hand: `npm run dev`, open reactor with `?session=x&team=y`, play the
  nine-question quiz getting some wrong, reload mid-list, then read
  `localStorage['state:x:reactor:y']`: Outcomes with `held: true` are there,
  `seq` has kept increasing across the reload, `runId` is unchanged,
  `sceneTime` has the scenes left behind, `progress.tasks.done` moved.
