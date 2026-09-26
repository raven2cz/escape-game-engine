# EI-010: evidence for the system-state design

**This is not a design.** It is the measured ground a design has to stand on, so
that whoever does the modelling spends their effort on the model rather than on
re-auditing six games and an engine. Every number here was extracted from the
shipped data or the shipped code, and where an earlier claim in
`OPEN-ITEMS.md` turned out to be wrong it is corrected below and marked.

Audited 2026-09-06 against `escape-games@804ed1d` (tag `games-2026.09.1`) and
`escape-game-engine@main`.

---

## 1. The owner's position

Stated here as the thesis to accept, sharpen or challenge - not as a settled
requirement:

> One **system state**: a single representation carrying the state of the system,
> defined as a domain/entity model with explicit attributes. Cybernetics is the
> basis. The engine sets those attributes and can extend them. Every game
> provides the system state through one agreed dashboard API. The dashboard only
> displays it.

The owner is explicitly open to a different structure if there is a reason for
one, and wants to hear the reason.

---

## 2. The six games, measured

| game | scenes | hotspots | puzzles | of those top-level | inside a list | items | events | dialogs |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| heat-escape | 7 | 11 | 14 | 5 | 9 | 0 | 7 | 0 |
| leeuwenhoek | 22 | 48 | 17 | 10 | 0 | 4 | 7 | 2 |
| reactor | 10 | 14 | 21 | 4 | 17 | 3 | 4 | 2 |
| stop-train | 7 | 15 | 5 | 5 | 0 | 5 | 11 | 1 |
| time-factory | 10 | 17 | 8 | 6 | 2 | 6 | 11 | 2 |
| warp-engine | 10 | 27 | 6 | 6 | 0 | 6 | 17 | 16 |
| **total** | **66** | **132** | **71** | **36** | **28** | **24** | **57** | **23** |

Seven further puzzles are defined in `leeuwenhoek` and reachable from nothing:
`cloze-capital`, `cloze-cell-structure`, `cloze-chemistry`, `cloze-custom-theme`,
`cloze-long-text`, `cloze-math-quiz`, `cloze-with-background`. They are showcase
fixtures from when that game was the demo. 36 + 28 + 7 = 71.

Puzzle kinds across all six: quiz 22, cloze 12, list 9, choice 9, group 5,
match 5, order 4, phrase 4, code 1.

Every game has exactly one scene with `end: true`.

### The scale that matters for a dashboard

**28 of the 71 puzzles - 40% - are steps inside a `list` puzzle**, and a `list` is
where the teaching actually is: `reactor`'s `puzzle-quiz-list-1` is nine physics
questions in a row, `heat-escape` has four lists of three. The per-step result is
built (`list.js:97`, `{ref, ok, ...}` per step) and resolved to the caller, and
then discarded.

**Corrected by Fable 5.1, and the correction is worse than the original claim.**
A wrong answer is not computed and thrown away - it is mostly never computed. A
kind with `blockUntilSolved` returns a hold, and `puzzles/index.js:87` returns
early on a hold without ever calling `onResolve`, so the puzzle stays open and
nothing downstream learns anything. Re-measured: **47 of the 62 leaf puzzles
block**, including all nine steps of `reactor`'s quiz list. Only 7 of the 28 list
steps can ever resolve a wrong answer to their list. The one place that does see
every evaluation is the `onOk` wrapper, one line above the hold check.

---

## 3. Every game signals progress differently

Measured by flag vocabulary: a flag that is both set and required is a gate, one
that is only ever set is a marker nothing depends on.

| game | flags set | gates | shape |
|---|--:|--:|---|
| heat-escape | 5 | 5 | `solved_room1..5`, one per room, strictly linear |
| warp-engine | 17 | 14 | `solved_<scientist>` × 6, `slot_*_ok` × 6, plus `warp_engine_active` |
| leeuwenhoek | 8 | 1 | narrative markers (`met_leeuwenhoek`, `intro_seen`); only `chest_opened` gates |
| reactor | 2 | 0 | no gating at all; progress is `solved:pz:*` and scene |
| time-factory | 2 | 0 | as reactor |
| stop-train | 1 | 0 | as reactor |

So there is no shared vocabulary to generalise *from*. Two games have a rich flag
model that a dashboard could read almost directly; three have essentially none.
Any scheme that asks games to declare progress in their own data would work well
for `heat-escape` and `warp-engine` and produce nothing for half the catalogue.

**Completion is signalled three different ways.** All six have an `end` scene,
which the engine displays (`engine.js:378`) and never records. Three of six -
`reactor`, `time-factory`, `warp-engine` - additionally set a `game_completed`
flag from a dialog or an event. The other three signal completion only by being
on the last scene.

---

## 4. What the engine records today, exactly

The whole persisted state (`_freshState()`, `engine.js:2059`):

```
stateSchemaVersion, signature, scene, hero, useItemId,
inventory[]         item ids held
solved{}            'solved:pz:<ref>' -> true
flags{}             game-defined
visited{}            scene id -> true
eventsFired{}       event id -> true
contentShown{}      content id -> true
sceneImages{}       scene id -> path
puzzleResults[]     {ref, ok, detail}
```

Four properties of this that a design has to work around:

- **There is no time anywhere.** `Date.now()` appears four times in `engine.js`
  and every one is pointer-gesture handling (`:1090`, `:1106`, `:1209`, `:1221`).
  *An earlier draft said five, from a combined grep; corrected.*
  No run start, no per-scene time, no timestamp on any recorded fact. So "which
  team is stuck" cannot be derived from the current state at all - not
  imprecisely, not at all.
- **Failure is never recorded.** A solved puzzle writes `solved[key] = true`
  (`:853`). A failed one writes nothing and runs `onFail`. Across all six games
  there are six `onFail` blocks and every one only shows a message - so a wrong
  answer leaves no trace in any game, by data or by engine.
- **There are no attempt counts.** `solved` is a boolean. Solving at the first
  try and solving at the ninth are the same recorded fact.
- **`state.puzzleResults` is dead in practice.** It is written from exactly two
  places, both requiring `options.aggregateOnly`: the hotspot path (`:845`) and
  the `openPuzzle` action (`:1761`). **No hotspot in any of the six games sets
  `aggregateOnly`, and the string `openPuzzle` does not occur in any game's JSON
  at all.** The bucket exists, is migrated, is capped at 500 entries, and is
  always empty.

  *Corrects `OPEN-ITEMS.md` EI-010*, which described `openPuzzle` as an event path
  that writes no `solved`. It is an action rather than an event, and no game uses
  it.

  *And corrected in turn by Fable 5.1: `aggregateOnly` is not rare.* An earlier
  draft of this document reported zero, having looked one level too high. It
  occurs 56 times across five of the six games and is true at puzzle level on 16
  puzzles. The conclusion survives intact, because the two write sites read the
  **hotspot's** options (`engine.js:830`) and no hotspot in any game sets it.
  Puzzle-level options do reach the kind - `base.js:26` spreads `config.options`
  last, so they win - but not the append.

---

## 5. The choke points that already exist

This is the good news, and the reason the emission side is not a rewrite. Every
kind of progress already funnels through one function:

| what happened | single choke point |
|---|---|
| the team moved | `Game.goto()` — `engine.js:305` |
| a puzzle resolved | the runner wrapper, `engine/puzzles/index.js:65-95` |
| a puzzle step resolved | `list.js:97`, already collecting `{ref, ok}` per step |
| a flag changed | `_applyActions` → `setFlags` |
| an item moved | `giveItem` / `_removeItemFromInventory` |
| a dialog ended | `dialogs.js` `_end()` |
| the state persisted | `opts.storage` — `{load, save, clear}`, injectable since EI-002 |

Navigation is worth one note: it is written two ways in the data - a hotspot of
`type: "goTo"` with a `target`, and an action `goTo: "<scene>"` - and both call
the same `goto()`. Counted properly across the six games - *an earlier draft gave
104 `goTo`, which was a raw string count conflating the two uses; caught by
Fable 5.1* - there are **85 hotspots of `type: "goTo"`** with a `target`, and
**19 `goTo` actions**. So the *data* has no single spelling for "the team moved",
but the *engine* has exactly one place where it happens. That asymmetry is the argument for emitting from the
engine rather than deriving from game data.

---

## 6. What a teacher plausibly needs

**Proposal, not evidence** - offered so the design has something concrete to
reject. Derived from what the games contain rather than from asking a teacher,
which nobody has done yet and which is the biggest gap in this document.

1. **Where is each team now** - scene, and how far that is through the game.
2. **Who is stuck** - the single most valuable signal, and the one that needs
   time. Stuck means "on the same scene or the same puzzle for much longer than
   the rest of the class", which cannot be computed from anything recorded today.
3. **Which question the class got wrong** - per-step results from the lists,
   aggregated across teams. This is the one that turns a game into a lesson: 22
   of the 71 puzzles are quizzes, and 28 are list steps.
4. **Who has finished.** *An earlier draft wanted this distinguished from
   navigating to the exit scene. Fable 5.1 checked all six games: every exit is
   behind that game's last gate, so reaching it is a legitimate finish and there
   is nothing to distinguish.* The `game_completed` flag turns out to be
   redundant - set once in three games' dialogs, required as a condition zero
   times, read by nothing.
5. **Attempts and mistakes per puzzle**, as the input to 2 and 3.

None of 2, 3, 4 or 5 is derivable from the current state.

---

## 7. Constraints any design has to respect

Established by the audit that this repository just finished; each cost real
defects to learn.

- **The state survives a reload or it does not exist.** A tablet reloads mid
  lesson routinely - it is the first thing anyone does when a game looks stuck.
  Anything held only in memory is lost, which is exactly how the list steps are
  lost today. `games/tests/helpers/reload.js` is the harness for testing this.
- **Only the signature ends a lesson**, not the shape. *Corrected by Fable 5.1:
  an earlier draft of this document said any change to the saved shape forces a
  `saveVersion` bump. It does not. `_restoreState()` compares `saved.signature`
  and nothing else; `stateSchemaVersion` is stamped and never compared. Adding
  whitelisted fields ends nothing.* `_signature()` and `_storageKey()` remain the
  wipe switch, and `docs/RELEASING.md` had this right.
- **`_normalizeState()` is a whitelist**, so a field it does not know is dropped
  on the next load - including by an older engine. Rolling back past a release
  that added a field loses that field.
- **No build step.** Plain ES modules, minimum iPadOS 15 / Safari 15 (EI-027).
- **The games are data.** 71 puzzles across six games are already authored; a
  scheme requiring every game to be re-authored has a cost of six games plus every
  future one, and three of the six have no progress vocabulary to build on.
- **Storage is already injectable** (`opts.storage`) and identity already exists
  (`sessionId`, `teamId`, EI-002). The runtime supplies both. A dashboard feed has
  a seam to attach to without inventing one.
- **Per-lesson licence, played online.** There is no service worker and offline
  is explicitly not supported (EI-007), so a feed may assume a network - but a
  school network drops requests, which is why the engine already treats a dropped
  request as a normal case rather than an error.

---

## 8. The questions the design has to answer

1. **Events or snapshots?** An append-only event log with sequence numbers is
   what the registry currently proposes; a periodically-published snapshot is
   simpler, survives gaps and is what a dashboard actually renders. Which, and
   does the answer change if the network drops for a minute?
2. **Where does the model live?** One entity model in the engine that games
   populate, versus a per-game descriptor the engine interprets. Section 3 says
   three of six games have nothing to declare, which bears on this.
3. **How is "how far along" defined** for a game whose progress is a flag
   vocabulary of size zero? Scene count, puzzle count, a declared spine, or
   something the engine derives?
4. **What does extension mean concretely?** The owner wants games able to add
   their own attributes. Typed and declared, or free-form? What does the
   dashboard do with an attribute it has never seen?
5. **Does this change the persisted state, and therefore `saveVersion`?** If the
   answer is yes, it must be one deliberate reset rather than several.
6. **What is the API's shape and version?** `ENGINE_API_VERSION` exists
   (`engine/version.js`) and is currently 1, declared for exactly this purpose
   and so far promising nothing.
7. **Is a wrong answer recorded per team or per pupil?** One tablet is one team,
   so per-pupil is not available. That bounds what the dashboard can ever show.

---

## 9. What is not known

Stated so nobody mistakes an assumption for a finding.

- **No teacher has been asked.** Section 6 is inference from the game data.
- **No dashboard exists**, so its rendering needs are unconstrained.
- **The hosted runtime does not exist.** It is the thing that would carry the
  feed, and its storage model - a Durable Object per session was the intent - is
  not designed either.
- **Class size, lesson length and number of tablets** are not recorded anywhere in
  this repository, and they determine how much data a dashboard is aggregating.


---

## 10. Corrections after the design pass

Fable 5.1 re-measured this document while designing against it and found five
errors. All five were re-verified here against the code and the data before being
folded in above, and all five held:

| # | what this document said | what is true |
|---|---|---|
| 1 | wrong answers computed and discarded | mostly never computed - 47 of 62 leaf puzzles hold instead of resolving |
| 2 | any saved-shape change ends every lesson | only the signature does; the schema version is never compared |
| 3 | `aggregateOnly` used by one game | 56 occurrences in five games, 16 puzzles - conclusion survives, no hotspot sets it |
| 4 | 104 `goTo` | 85 hotspots of that type plus 19 actions; 104 was a raw string count |
| 5 | finishing must be told apart from reaching the exit | every exit is behind the last gate, so it cannot be faked |

One defect was found that this document missed and that is not about dashboards
at all: **EI-030**, a dropped `puzzles.json` request poisons the cache for the
rest of the run.

A sixth was found afterwards and is corrected above: `Date.now()` occurs four
times, not five.

The design itself is [EI-010-DESIGN.md](EI-010-DESIGN.md), and
[EI-010-MYSLENKA.md](EI-010-MYSLENKA.md) is the same design written for the owner
in Czech, in terms of what a teacher does with it.
