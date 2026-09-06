# Handover: where the stabilization stands

Written for whoever picks this up next, agent or human. Read this first, then
`OPEN-ITEMS.md` for the findings and `STABILIZATION.md` for why the order is
what it is. This file is kept current rather than archived: it always describes
where the work is and what comes next.

## Where things stand

    branch    fix/stabilization-audit
    base      main @ 5dbca85
    games     moved to raven2cz/escape-games (private); this repo keeps games/demo
    suite     213 here, 7 in the games repository; CI runs both on push and PR

| commit | what |
|---|---|
| `3db129a` | audit registry and stabilization plan |
| `967b385` | S0: green suite, CI, EI-008, EI-019 |
| `36c6e95` | S4 partial: EI-005, EI-009, EI-014, EI-015 partial, data tests |
| `5235db0` | S1: the reload harness, EI-001, EI-006 |
| `21d8fb4` | S2: EI-003, EI-013 |
| `7222b09` | S3: EI-002 step one, EI-011, EI-012 |
| `076e654` | what the reviews of S1 to S3 found, three of them P1 |
| `2f6ce6b` | what a second review round found, and two vacuous assertions |
| `22c473a` | EI-021, EI-022, EI-023, the three the reviews turned up |
| `e095696` | EI-018 and EI-015: dead code, README, the last borrowed names |
| `cbf860f` | closing review: EI-024, and corrections to EI-015/021/022 |
| `699b0a3` | S5: licence split, PWA removed, transcripts and demo deleted |
| `c055410` | GitHub Pages closed |
| `2ac0ba7` | EI-025: games moved to the private repository |
| `6f12df0` | EI-026: every asset a game references must exist |

Twenty-six items are on the registry and twenty-four are closed. Every code batch
in the plan is done, so are the defects the three review rounds turned up, so is
the cleanup, the owner has taken all the S5 decisions, and the games have moved to
their own private repository. What is left is EI-026, which needs artwork, and
EI-010 with EI-002 step two, which were always meant to wait for the hosted
runtime design.

## The reload harness

`games/tests/helpers/reload.js`. Everything about what survives a reload is
tested through it, so it is worth knowing before writing a test here.

`boot()` gives a fresh Game on a fresh DOM, reading nothing but what
`_saveState()` persisted. `bootDetached()` does the same without awaiting
`init()`, which is how a run is stopped at a point where the engine is blocked
on the player - an interrupted run's `init()` never resolves, so it cannot be
awaited. `reload()` is `boot()` with a name that says what is being tested.

Three things could carry over from one run to the next and all three are cut:
the game data is deep-copied on every fetch, because `setSceneImage` mutates it
in place; the DOM skeleton is rebuilt, so nothing rendered by the first run
answers for the second; the Game is new. What is *not* torn down is listeners the
engine attaches to `document` and `window`; the engine has no teardown API and
adding one was out of scope. `reload.harness.test.js` holds those claims down.

`loadGameFixtures('demo')` reads the demo game's real data, for regression tests
that are worth running against a real game rather than a fixture. The commercial
games are no longer here, so a test that needs one of those belongs in the games
repository.

## What is left

**Decisions the owner has taken.** All of S5, plus EI-020:

- **EI-004**: split the licence. Engine MIT, `games/` proprietary. Done.
- **EI-007**: remove the service worker and the manifest rather than repair
  them. Done.
- **EI-017**: delete `plans/sessions/`, keep
  `games/warp-engine/assets/resource/`, and close GitHub Pages rather than merely
  excluding `resource/` from it. Done. History is deliberately not rewritten; the
  transcripts were scanned for credentials first and are clean.
- **EI-020**: delete `games/demo`. A demo of the framework is wanted eventually,
  but as a deliberate separate thing, not as this leftover. Done.
- **EI-002 step two** and **EI-010**: left where they were. EI-010 belongs to the
  dashboard project, which is a day's work of its own.

**Still open, and it needs the owner:**

- **How the games repository depends on the engine.** Deliberately unbound: a git
  dependency does not install on npm 12, and a submodule would pull 430 MB of
  history. The hosted runtime is what will put an engine version and a set of
  games together. Until then the two repositories are cloned side by side.
- **Whether `games/demo` should stay content-identical to a game that is sold.**
  It is the old `leeuwenhoek`, renamed. As a fixture it is worth more than
  anything purpose-built - 22 scenes, 7 events, 2 heroes, all nine puzzle kinds -
  and it was always the public demo. But a school can play it for free, and the
  demo licence forbidding that is a sentence, not a lock. Trimming it to a few
  scenes, or writing a demo for the purpose, is the alternative. See EI-025.

**Wants a look on a real screen, not a test:** EI-023 moved the puzzle and the
content panel out of the hotspot layer and onto the scene container. The geometry
should be identical - the layer fills that container exactly - but "should be" is
not the same as "was looked at". Open `games/demo` and check a puzzle and a
content panel.

**Waiting on the hosted runtime, deliberately:**

- **EI-002 step two.** Run and team identity, `state:<sessionId>:<gameId>:<teamId>`.
  Step one namespaced the key per game and put persistence behind
  `opts.storage`; two teams on one tablet still share a slot, because the
  identity has to come from the runtime rather than be invented here.
- **EI-010**, one progress signal instead of per-game conventions. The seam it
  needs now exists: `opts.storage`, plus the puzzle runner wrapper in
  `engine/puzzles/index.js` that every kind already goes through.

## How to work here

- **Every fix needs a test that fails without it.** Verify that by stashing the
  fix, running the test, and restoring. This is not ceremony: two of the defects
  fixed so far were found only because a test was written first, and one audit
  claim turned out to be wrong when checked.
- **Verify before you assert.** Three independent audits were run and each got
  something wrong.
- **Review the documentation against the code the same way.** The README rewrite
  was itself reviewed, and reading it back against the engine turned up EI-024:
  a `setFlags` form the document promised and the engine mangled into twelve
  flags named after string indices. Documentation is a claim about behaviour and
  deserves the same check as a fix.
- **Have the work reviewed by something that is not you.** Fable 5.1 and codex
  SOL reviewed S1 to S3 independently and both found the same two P1 defects in
  the new code; SOL found a third that neither the audit nor the other reviewer
  had. A second round over the corrections found three more. Four of the tests
  that were supposed to prove a fix were passing whatever the code did. A green
  suite written by the same session that wrote the fix is not enough on its own.
  The technique that found those four: revert the fix in a throwaway copy and
  check the test actually fails. Stashing only catches it while the fix is still
  uncommitted.
- **Comments and commit messages in English.** The user writes Czech, the
  repository is English. Do not mix.
- **Do not restructure beyond the item.** A large diff cannot be reviewed
  against a game that has to work in a classroom.
- Watch out for backticks in `git commit -m` inside a double-quoted shell string.
  They expand. Use `-F` with a file.

## Context beyond these documents

The audit and the first fixes were done in an agent session anchored to the
Kabinet nápadů repository, which is the shop that sells these games. Its
transcript is at:

    ~/.claude/projects/-home-box-git-gitea-kabinet-napadu/e9cb649b-6472-4057-80bf-5f4ed09982c6.jsonl

It is about 7 MB, so read it selectively if at all. Everything needed to do the
work is in these three documents; the transcript is there for the reasoning
behind a decision, not as the brief.

What matters from the wider context: the games are sold as a licence to a school,
partly through the Učitelnice marketplace, which cannot identify a buyer or issue
a per-copy code, and partly directly through kabinet-napadu.cz, which can. A
lesson is started from the shop and played on a Cloudflare Worker runtime that
does not exist yet, and several teams play at once on shared tablets. That is why
"survives a reload" and "two teams on one device" are the acceptance criteria for
this work rather than anything about features.
