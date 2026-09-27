# Changelog

Write what changed under `## Unreleased`, and commit it. `npm version` refuses to
start without it, and renames that heading to the version it is cutting - so the
entry is written while the change is fresh, and nobody has to predict a number.

Versions are the engine's own. Games are versioned separately, in their own
repository; see `docs/RELEASING.md` for which version means what.

## Unreleased
- **The name on "Kdo hraje?" is always readable.** A game's stylesheet loads
  while the screen is open, and Reaktor styles every text input light with
  `!important`: now and then the typed name turned light on white. The screen
  pins its own input and button colours.
- **The pupil sees who is playing.** After "Kdo hraje?" the picture and
  nickname stay in the top bar, on the right, in every game. Until now they
  were only on the teacher's board.
- **A host can hand out the player.** `boot({join: {register}})` asks "Kdo
  hraje?" and passes the answer to `register({name, avatar})`, which returns
  `{playerId}` or `{error}`. A refusal, a network failure or no answer within
  15 s shows the message on the same screen and keeps the name and picture, so
  the pupil only presses Hrát again. A reload reuses the stored player; one in
  the middle of a registration sends the same random `key`, so the host can
  hand back the player it already made instead of taking a second place.
- **A browser that refuses to hand out `localStorage` no longer stops the
  game.** The engine treats it as "nothing remembered".
- **`webStorage`** chooses where the tablet remembers the player and the run
  (default `localStorage`). A hosted lesson passes `sessionStorage`, so a
  closed tab forgets both, and the old pre-1.0 entry in `localStorage` is left
  alone.
- **`restart: false`** leaves out the Restart button.
- **"Kdo hraje?" recommends a nickname** ("např. Modrý tygr") and says what the
  teacher sees and that it is deleted after the lesson. `isPlayerId` is
  exported from `join.js`.

## 1.1.1
- **"Stuck" means no progress, not a long stay.** The report carries
  `position.progressAt`, the last progress in the scene (entered, a task solved,
  an item gained or used, the end), and the board measures stuck from it. A
  room with many tasks, such as the nine-question quiz at the start of Reaktor,
  no longer turns a whole class red after ten minutes of steady work: in a
  simulated class of 28 the board went from 21 "possibly stuck" to the 2 who had
  really stopped. The attention card says "bez posunu". A tablet on 1.1.0 sends
  no `progressAt` and is judged as before. Saves from 1.1.0 carry on; no
  `saveVersion` moves.
- **A board no longer drops a report for carrying a field it does not know.**
  `docs/DASHBOARD-API.md` always said a board ignores such fields; `ReportStore`
  refused the whole report instead, which would have made every added optional
  field lose the players of an older board. It now drops the field (it is never
  stored or handed on) and keeps the player. The schema gains `{optional}` for
  fields added after their api version. `api` stays 2: the field is optional and
  additive, which is what §3 says does not move it. The one board that would
  refuse a 1.1.1 tablet is the 1.1.0 reference board, which ships in the same
  package as the engine and runs nowhere yet (no runtime, no board in the shop):
  update board and engine together, as the package does.
- **Sorting puzzles (group) start with the tokens spread out**, one under
  another on the line between the groups (or across it, when the groups are
  stacked), instead of all on one spot in the centre where only the top label
  could be read. A `manual` layout keeps the centre: only its author knows where
  the free space is. No shipped game uses one.
- The lesson simulator keeps the last progress too, so the board it feeds shows
  what a real class would.

## 1.1.0
- **The teacher can see the lesson.** The engine now keeps a private record of
  each team's run (where it is and since when, attempts and mistakes per task,
  items used, dialogs seen, when it finished) and reports it as a declared,
  versioned `DashboardReport`, never as its internal state. Reports are built off
  the game's transition path, one per burst of activity, and survive a reload.
  Nothing is sent anywhere unless the host passes a transport (`boot({report})`).
  `ENGINE_API_VERSION` is now 2, the first version that promises a contract; see
  `docs/DASHBOARD-API.md`. No `saveVersion` moves and no lesson ends. (EI-010)
- **A teacher's board**, in `board/`, built only on that contract: a row per
  team, a task by team grid, items, and who may be stuck. With the dev server,
  tablets on the network report to it with `&report=http`. Built for a class of
  thirty playing one per tablet: one row per player with a task strip, who needs
  attention on top, and the per-task picture underneath. (EI-010)
- **Games can name things for the board** with `meta.dashboard` in scenes.json:
  labels for scenes, tasks and items, and milestones (a flag, a scene, a task or
  a dialog). It changes names, never what is measured. (EI-010)
- **An unfinished answer is no longer a wrong one.** Pressing OK before every
  part of a puzzle is answered (a gap left empty, a token not sorted, a pair not
  made, nothing typed) keeps the puzzle open with the hint "Nejdřív dokonči
  všechny odpovědi." instead of marking it wrong or failing it. (EI-010)
- **"Kdo hraje?" before a game in a lesson.** A pupil writes a name or nickname
  and picks one of 32 pictures (16 Fluent 3D animals, 16 Big Smile kids). The
  name is the player: the slot the run is saved under and the name on the
  teacher's board, where the picture replaces the initials. Remembered for the
  lesson on the tablet, so a reload does not ask again; Restart forgets it for
  the next child. Shown when the link has a `session` but no player; local play
  is unchanged. The player gets a stable id, never shown; the name is only a
  label, so two pupils called Anička stay two players. The report's `team`
  field is now `playerId` (the identity) plus `player` (the name), and gains an
  optional `avatar` id (API still 2, unreleased). Picture credits in
  `engine/avatars/CREDITS.md` and on the screen. (EI-010)
- `scripts/simulate-lesson.mjs` plays a lesson with simulated teams against the
  dev server, to see the board working without tablets. (EI-010)

- **A dropped puzzle file no longer breaks every puzzle for the rest of the
  run.** When the network dropped the request for a game's puzzle definitions,
  the engine cached the empty result as if it had loaded, so every puzzle became
  unopenable - a tap did nothing, with no message - until a reload. It now
  retries on the next puzzle instead. A school network drops requests and a drop
  is not an error anyone sees, which is why this went unnoticed. (EI-030)
- **A tablet too old to run the game now says so.** Below iPadOS 15 the engine
  fails on syntax before any of its own code runs, so the page simply stayed
  blank. `index.html` now shows "Načítám hru…" immediately and, if the engine has
  not taken over within ten seconds, replaces it with what to do about it. The
  supported minimum is written down in the README and in `docs/RELEASING.md`.
  (EI-027)
- **A lesson can now have a slot of its own.** One tablet had one saved game per
  game, so the class in the second period resumed the class from the first, intro
  already spent. Put `session=` in the link a class is given - any string that
  differs between lessons - and each gets its own. `team=` too, if one lesson runs
  on more than one tablet. Without either, nothing changes and a lesson already
  running is untouched. `docs/RELEASING.md` has the shape of the link. (EI-002)
- Removed the `ResizeObserver` fallback in the match puzzle. It could never run:
  the engine's own syntax has a higher floor than the observer does. (EI-027)

## 1.0.0 - 2026-09-06

The first tagged release, cut after the stabilization audit of September 2026.
`plans/OPEN-ITEMS.md` has the full registry with the reasoning for each fix;
what follows is what a person needs to know.

### Fixed, in the order of how badly they could end a lesson

- **A reload during a once-event lost its effects permanently.** The event was
  marked done before its flags were set, so a tablet that reloaded while a dialog
  was on screen kept the mark and lost the flag. In warp-engine that locked a
  team in the warp core with no way out but a full restart. (EI-001)
- **Redrawing the match puzzle's connection lines never terminated** once a pair
  was connected: it walked a Map while putting the same keys back into it. The
  loop is synchronous inside an animation frame, so it took the main thread and
  the tablet stopped responding. Connect a pair, rotate the tablet. (EI-028)
- **A video that would not start blocked the run forever.** A refused `play()`
  was logged and then waited on, and both warp-engine videos allow no skipping.
  There is now a play button when the browser refuses to autoplay - which retries
  from inside a real touch handler, the only kind iOS accepts - and a way past
  when nothing starts, stalls, or the pupil switches apps. (EI-022)
- **`goto()` hung on a missing image** and recorded a scene it could not show, so
  a pupil reloaded straight back into the same dead end. Now bounded, with a
  message instead of a blank screen. (EI-003)
- **A double tap opened two dialogs or two puzzles**, and the second stole the
  first one's resolver so whoever awaited it waited forever. Both taps and drops
  are now one operation at a time. (EI-013)
- **Every game shared one saved state**, so two games on a tablet destroyed each
  other's progress and changing language wiped the lesson. State is now per game,
  behind an injectable storage interface. (EI-002, step one)
- **A saved state was trusted on sight.** It now has a schema, defaults, type
  checks and a migration path, and an unknown scene falls back to the start
  rather than freezing. (EI-012)
- Scene images changed by an event, and items consumed with no follow-up action,
  did not survive a reload. (EI-006, EI-011)
- A single flag name written without a list set one flag per character. (EI-024)
- Dialogs opened from another dialog's ending could not be advanced; re-rendering
  hotspots destroyed an open puzzle; a list puzzle did not close the step it
  started. (EI-021, EI-023, EI-029)

### Changed

- The engine is no longer named after any one game: the storage key, the hero
  fallback and the service worker's cache name are gone or neutral. (EI-015)
- The service worker and the web app manifest were removed. Neither had ever
  worked - 15 of 19 precache paths did not exist - and offline play and a
  per-lesson licence pull in opposite directions. (EI-007)
- The six commercial games moved to a private repository. `games/demo` stays as
  the demo and as the test fixture. (EI-025)
- The licence is split: the engine is MIT, `games/demo` is not. (EI-004)
- `meta.saveVersion` decides whether a saved game still applies, so `meta.version`
  can be bumped without ending every lesson in progress.
- The README was rewritten against the implementation. It had documented an API
  the engine does not have. (EI-018)

### Added

- `npm run dev`, a development server that serves games from this repository and
  from the private games repository beside it, with the Range support iOS Safari
  needs to play a video.
- `engine/version.js`, exporting `ENGINE_VERSION` and `ENGINE_API_VERSION`.
- A test suite that runs in CI, from 113 tests of which 5 failed to 256 passing.
