# The dashboard API

The contract between a tablet running a game and whatever shows the teacher what
the players are doing: the hosted runtime, the teacher's board in the shop, and the
reference board in `board/`. It is the prose of `engine/dashboard/report.js`,
which declares the same thing as a schema; where they disagree, the schema is
the one the tests check, and this file is the bug.

Design and history: `plans/EI-010-DESIGN-API.md` (Revision 2 is authoritative).

---

## 1. The one rule

**The engine's internal state never leaves the tablet.** What leaves is a
`DashboardReport`, a declared, versioned value built from the internal state by a
projection. Nothing else.

```
engine transitions ──signals──► ProgressModel ──► state.progress   (private, saved, reload-safe)
                                                        │
                    DashboardReporter, one deferred flush per burst
                                                        ▼
                    project(state, progress, catalogue) ──► toWire() ──► transport.send(report)
```

Two walls, each tested on its own:

1. `project()` names every field it produces. There is no spread of internal
   state anywhere in it.
2. `toWire()` copies the result into a fresh plain object field by declared
   field, coercing each to its type. Anything the schema does not name cannot
   reach a transport, whatever the projector did.

### What never leaves the tablet

The saved state: solution keys (`solved:pz:*`), flags, fired events, the hero,
content and scene-image bookkeeping, `state.progress` itself, the signature and
versions. The injected `storage` (`boot({storage})`) is a **local** seam for
reloads: it may cache the state on the device and must never transmit it.

The guarantee covers the engine's supported paths. It is not protection against
JavaScript on the host page, which can read `game.state` through `onGame`; that
page is the embedder's trust boundary.

---

## 2. `DashboardReport`

One report is the complete current picture of one run of one player. Reports are
snapshots, not events: the newest supersedes every earlier one, so a lost report
costs nothing once the next arrives.

| field | type | meaning |
|---|---|---|
| `api` | int | this contract's version, `ENGINE_API_VERSION` (now **2**) |
| `game` | string | `meta.id` of the game |
| `gameVersion` | string \| null | `meta.version`, for matching a catalogue |
| `session` | string \| null | the lesson, as the tablet was given it. A hint, see §6 |
| `player` | string \| null | the player's name, from "Kdo hraje?" or the link. A hint, see §6 |
| `avatar` | string \| null | the picture the player picked: an id from `engine/dashboard/avatars.js`, or null |
| `run` | string | this run. Kept across reloads, new after a reset |
| `revision` | int | increases with every report of a run; never reused, even across a reload |
| `startedAt` | epoch ms | when the run began (for an upgraded save: when it was upgraded) |
| `updatedAt` | epoch ms | when this report was built, tablet clock |
| `completedAt` | epoch ms \| null | first successful entry to the `end` scene |
| `completed` | bool | `completedAt != null` |
| `position` | `{scene, label, since}` | where the player is, the scene's label, and since when |
| `activity` | `{ref, label, since}` \| null | the puzzle open right now, or null |
| `progress` | `{scenesVisited, scenesTotal, puzzlesSolved, puzzlesTotal}` | counts |
| `inventory` | string[] | item ids held now, in the order they were got |
| `itemsUsed` | string[] | item ids consumed, first use first |
| `dialogsSeen` | string[] | dialog ids that ran to their end, first first |
| `puzzles` | `{ref, attempts, mistakes, solved}[]` | every task the player has touched, first touch first |
| `milestones` | string[] | ids of the game's declared milestones that are reached, in declaration order |
| `truncated` | bool | true only if per-puzzle detail was shed to fit the size ceiling |

### What the fields mean, exactly

- **Tasks.** A task is a leaf puzzle a player can reach: from a puzzle hotspot,
  from an event's `openPuzzle`, or as a step of a reachable `list`. A list is a
  container, never a task. Its identity is its `ref`; an inline list step with
  no ref is `<list>#<index>` (e.g. `series#1`), which cannot collide between two
  lists. A step that names a puzzle which is also a hotspot counts once.
  Puzzles defined but reachable from nothing are not tasks.
- **`puzzlesTotal` / `scenesTotal`** come from the game files, not from the player.
  `puzzlesTotal` is **`null` until the puzzle catalogue has loaded, never 0**; a
  zero would read as "no puzzles" and make every player look finished. The engine
  prefetches the catalogue right after the first scene is on screen.
- **`attempts`** counts every real evaluation, the solving one included.
  **`mistakes`** counts wrong ones. That is the whole error model: no captured
  answers, no per-attempt rows.
- **What is not an attempt:** an unfinished submission. That is nothing typed
  or selected, or, in choice, cloze, group, match and order, anything that has
  an answer left unanswered. The puzzle stays open with no right/wrong marks,
  only the neutral hint "Nejdřív dokonči všechny odpovědi." Also not an
  attempt: a press refused by a cooldown, and a wrong answer submitted again
  **unchanged** (a double tap, or OK pressed twice while the feedback shows).
  The pupil still sees the feedback every time; it is just not a second
  mistake. A different answer is a new attempt, compared with the last wrong
  one (so A, B, A is three). This is decided by the answer itself, not by a
  timer or by where the pupil tapped, so a quick correction is never lost and
  tapping around changes nothing.
- **`activity`** is the innermost open leaf. During a list it is the current
  step; on the list's summary screen it is `null`. A reload closes every puzzle,
  so after a reload it is `null` until a puzzle is opened again.
- **`position.since`** keeps running across a reload into the same scene.
  Together with `activity.since` it is the whole "stuck" signal. The engine does
  not decide who is stuck; the board does, against the rest of the class.
- **Times are the tablet's clock.** A tablet that sleeps through a break counts
  the break; show times as a teaching hint, cap one stay at the lesson length.
- **`completed`** is set by the first successful entry to the game's `end`
  scene, never by a failed image load of it, and never unset.

### Size

Bounded by the game's own size: a finished run of any shipped game is a few
kilobytes. Target 32 KiB, hard ceiling 48 KiB (under the ~64 KiB `sendBeacon`
queue). Over the ceiling, which only an edited save can reach, `puzzles` is
shed first, then the other lists, and `truncated` is set; the counts in
`progress` still hold.

---

## 3. Versioning

`api` moves when a field is **removed or changes meaning**. Adding an optional
field does not move it. A board:

- shows what it understands and ignores fields it does not know;
- given a report whose `api` is newer than its own, shows position-only with a
  note rather than dropping the player, and keeps only the fields it knows
  (rebuilt through `toWire()`, counts and lists emptied): a newer report is
  never stored or handed on verbatim.

`api` is not the save format. The engine never exposes the save format, so it
can change without any board noticing.

---

## 4. The static catalogue

A board needs to know what a game contains: scenes, tasks, items, milestones and
what to call them. That is not in the reports. It is derived from the game files
by `buildCatalogue(scenesJson, puzzlesJson, {dialogsDoc})` in
`engine/dashboard/catalogue.js`, a pure function with no DOM and no engine
import, usable in a browser, in Node and in a Worker:

```js
import {buildCatalogue} from 'escape-game-engine/engine/dashboard/catalogue.js';
const catalogue = buildCatalogue(scenes, puzzles, {dialogsDoc: dialogs});
// {game, version, ready, scenes[], tasks[] | null, items[], milestones[], show, totals, errors[]}
```

---

## 5. Per-game customisation: `meta.dashboard`

A game can rename things on the board and declare milestones. It **cannot
change what is measured**: every game gets a full board from what the engine
derives, and a game that declares nothing works on day one.

```json
"meta": {
  "id": "warp-engine",
  "dashboard": {
    "labels": {
      "scenes": {"main-room": "Řeka času"},
      "tasks":  {"newton-match": "Newton: tři zákony v obrazech"},
      "items":  {"grav-key": "Gravitační klíč"}
    },
    "milestones": [
      {"id": "newton", "label": "Newton", "flag": "solved_newton"},
      {"id": "warp",   "label": "Warp motor spuštěn", "flag": "warp_engine_active"}
    ],
    "show": {"items": true, "milestones": true}
  }
}
```

- **`labels`**: `scenes`, `tasks`, `items`, each a map from id to a label of at
  most 120 characters. Without one, a scene uses its `title`, a task its `title`
  (or `prompt`), an item its `label`, and failing that the id.
- **`milestones`**: an ordered list. Each has a plain `id` (letters, digits,
  `_ . -`, up to 64), a `label`, and **exactly one** source:
  - `flag`: reached while that flag is set,
  - `scene`: reached once the player has visited that scene,
  - `task`: reached once that task is solved,
  - `dialog`: reached once that dialog has run to its end.

  The internal flags map is never shipped; only the declared milestone ids are.
- **`show`**: `items`, `milestones`, each a boolean. Absent, a section is shown
  when the game has something to put in it.

An invalid entry is dropped with a warning at runtime, and the rest still works.
The games repository refuses one at build time: its data tests fail on any
reference to an id that does not exist, on a task without a readable name, and
on a dash in a label.

---

## 6. Transport, and what the server must do

The engine sends nothing by default. Whoever hosts the game passes a transport:

```js
boot({gameId, sessionId, teamId, report: transport});

transport = {
  enabled: true,
  send(report, {terminal}) { ... }   // return a promise, or throw / reject on failure
};
```

Provided: `NullTransport` (the default), `HttpTransport({url, headers})`
(`fetch` with `keepalive`; a terminal send uses `sendBeacon` when there are no
custom headers, and a refused beacon is a failure), and `LocalBoardTransport`
(for a board in another tab of the same browser).

What the engine guarantees:

- Projection, serialisation and sending never run inside an engine transition.
  A signal costs a few integer writes; a burst of them costs one deferred flush
  (a timer task, so still Safari's main thread, but not the game's stack).
- One request in flight at a time; reports cannot overtake each other.
- The latest unsent report is kept and retried with backoff (2, 5, 10, 30 s)
  even if the game goes quiet.
- On `visibilitychange` to hidden (primary on iOS) and `pagehide` (backup) a
  terminal send is attempted, re-sending an unsent snapshot under the **same**
  revision. Best effort: iOS does not guarantee either event. Continuous sending
  is what limits loss, not the last beacon.
- The revision is reserved and persisted **before** a report is sent, so a
  reload never reuses a revision for different content. If the save fails
  (storage full), the revision is given back and nothing is sent until a save
  succeeds.
- `restart()` stops the reporter before it clears storage, so the flush on the
  way out cannot write the old run back.
- An idle game writes nothing after it has started. The flush saves only when
  the progress record holds something storage does not have yet: any save the
  engine makes stores it, and the first scene of a fresh run is stored while
  starting.
- A run whose saved revision is not a safe integer below 2^31 starts a new run.
- A progress change that the engine would not have saved by itself (a held wrong
  answer, a dialog that sets nothing) reaches storage when that flush runs, so a
  reload after it keeps it, with no later move needed. Lesson continuity never
  depended on any of this.

What the server (hosted runtime) must do, because the tablet cannot:

- **Bind `session` and `player` from its own authenticated context.** The report's
  fields are hints for correlation, not trust. URL and credentials live inside
  the transport, never in the engine.
- **Order and deduplicate on `(session, game, player, run, revision)`**: keep the
  highest revision of a run; a repeated or late report is not an error.
- **Decide which run is current** when two share `session/game/player` (a reset,
  or two tabs): the engine cannot, since the storage key does not include the run.
- Keep the sequence it receives if history is wanted: reports carry the current
  picture only.

---

## 7. The reference board

`board/` is a teacher's board built only on this API (`board-model.js` is pure
and unit-tested, `board-view.js` draws it). With the dev server:

```
npm run dev -- --host 0.0.0.0
tablet:  http://<laptop>:5500/?game=warp-engine&session=7A&team=modri&report=http
board:   http://<laptop>:5500/board/?game=warp-engine&session=7A&source=http
```

`report=local` and `source=local` do the same between tabs of one browser. The
dev server's `/api/report` and `/api/reports` are in memory and unauthenticated:
a development convenience, not the runtime.

What it shows, built for a class of up to thirty or so pupils playing one per
tablet who needs attention on top (possibly stuck, longest first, then disconnected),
then one compact row per player (initials avatar, room, time there, tasks solved
of total, a strip with one cell per task, mistakes, the task open right now,
milestones as dots, played or finished at), then the class per task (solved by,
tried by, with mistakes, the hard ones marked) and items (has, used, never had).
A player is shown as possibly stuck when they have been in one place at least
4 minutes and at least twice the class's median, or at least 10 minutes
whatever the class is doing; a disconnected player is shown as that instead.
