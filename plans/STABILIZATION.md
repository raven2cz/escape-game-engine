# Stabilization plan

Companion to [OPEN-ITEMS.md](OPEN-ITEMS.md). That file says what is wrong; this
one says in what order it gets fixed and how each fix is proved.

## Why stabilize before extending

The framework has not been touched since 2026-02-22 and `npm test` has been red on
main for an unknown length of time, because no workflow runs it. The next step for
this project is a hosted runtime on Cloudflare with several teams playing at once
and a live dashboard for the teacher. Every one of those additions depends on
state and events being trustworthy, and right now they are not: one shipped game
can be locked permanently by a page reload.

Building the hosted layer first would mean designing against behaviour nobody has
verified. So: green suite, then correctness, then extension.

## What done means

- `npm test` green, run by CI on every push and pull request.
- No reload during a lesson can lose progress or lock a team out.
- Two teams and two games on one tablet do not overwrite each other.
- Nothing in the engine is named after one particular game.
- Every fix has a test that fails without it.

Explicitly **not** in this scope: licence enforcement, server-side answer checking,
per-team identity from the runtime, progress events, the dashboard. Those belong to
the hosted runtime design and are tracked as EI-010.

## The one piece of test infrastructure to build first

Most of the serious defects only appear across a reload, and there is no way to
express that today. Before S1, add a helper to `games/tests/` that:

1. runs a game to some point,
2. reads back exactly what was persisted,
3. builds a fresh `Game` from that persisted state, nothing else carried over.

Without it, EI-001, EI-002, EI-006, EI-011 and EI-012 cannot be tested at all, and
all five are defects whose whole nature is "survives the reload or does not".

## Batches

Each batch is one commit or a small series, and the suite is green at the end of
each. Batches are ordered so that no batch depends on a later one.

### S0: green baseline and CI

Items: **EI-016**, **EI-008**.

Goes first because everything after it is judged by the suite. `ResizeObserver`
gets a stub in `games/tests/setup.localstorage.js`. The hero-dialog test drives
the image preload instead of waiting 10 ms. EI-008 is fixed here rather than later
because its test already exists and already asserts the correct behaviour: move
inventory activation back to `click`, keep pointer events for drag detection only.

Then a workflow that runs `npm test` on push and pull request. Without it this
whole exercise repeats in six months.

Tests: the existing 113 pass, plus keyboard activation of an inventory item.

### S1: durable effects survive a reload

Items: **EI-001**, **EI-006**.

Grouped because both are the same mistake: a change the player can see is not a
change the game remembers. EI-001 is the highest-value fix in the plan, since it
is the only defect that can end a lesson with no recovery.

Order inside the batch: reload harness, then EI-001, then EI-006, because EI-006's
test needs the harness and reads more clearly once events are reliable.

Tests:
- A once-event with `setFlags` plus `openDialog`, interrupted mid-dialog, still has
  its flags after the reload.
- `warp-engine` specifically: reload during the victory dialog, then the exit is
  still reachable. This is the regression test for the worst bug found.
- A scene image changed by an event is still changed after a reload.

### S2: transitions cannot hang or overlap

Items: **EI-003**, **EI-013**.

Grouped because both are about a transition that never settles: one from a request
that never answers, one from a second activation stealing the first one's resolver.

Tests:
- A scene whose image 404s still completes `goto()` and renders hotspots.
- A scene whose image never answers completes within the timeout.
- Two navigations in a row both settle, and the later one wins.
- Two synchronous hotspot activations create one runner, not two.
- An awaited dialog always settles, even if a second `open()` arrives.

### S3: state has an identity and a shape

Items: **EI-002**, **EI-011**, **EI-012**.

Grouped because they all change how state is written and read, and doing them
separately would mean touching the same code three times.

EI-002 is done in two steps. Step one, in this batch: namespace the key per game
and pull persistence behind an injectable storage interface. Step two, run and team
identity, belongs to the hosted runtime, because the identity has to come from
there. Doing step one now already fixes cross-game destruction and creates the seam
the runtime will need.

Tests:
- Two games keep independent state; playing one does not destroy the other.
- Changing language preserves progress.
- An item consumed with no follow-up action is still gone after a reload.
- A state missing each field in turn still starts the game.
- An unknown scene id falls back to the start scene rather than freezing.

### S4: cleanup, no behaviour change intended

Items: **EI-005**, **EI-009**, **EI-014**, **EI-015**, **EI-018**.

Deliberately last among the code batches. These are small and safe individually,
and putting them earlier would mix noise into the diffs of the batches that matter.

Tests:
- After `init()` with `reset=1`, the parameter is gone and a second `init()` loads
  the saved state.
- Every game has exactly one scene flagged `end`. This is what catches EI-014 and
  prevents the next game from shipping without it.
- No file outside `games/leeuwenhoek/` mentions leeuwenhoek.

### S5: decisions, not code

Items: **EI-004**, **EI-007**, **EI-017**.

These need the owner, and two of them should be settled before the games are split
into their own repository, because both get harder afterwards.

- **EI-004, licence.** Recommendation: engine stays MIT, games and assets get their
  own proprietary licence, stated in both repositories.
- **EI-007, service worker and PWA.** Recommendation: remove from the hosted
  runtime. Offline play and a per-lesson licence pull in opposite directions, and
  the file is dead today anyway.
- **EI-017, repository hygiene.** Needs a decision per directory: move, delete, or
  rewrite history. Excluding `resource/` from the Pages deploy is worth doing
  immediately either way.

One further question that is not an item because it is not a defect: **the oldest
iPad model that has to work.** It decides whether `ResizeObserver` needs a runtime
fallback as well as a test stub, and it will come up again for every browser API
the hosted runtime uses.

## After stabilization

The hosted runtime design, with EI-010 as its starting point, plus the questions
that only make sense once the engine is trustworthy: where game data comes from
when it must not be publicly fetchable, how a team is identified, what the engine
emits, and what the teacher's dashboard reads.
