# Changelog

One section per release. `npm version` refuses to cut a release that has no
section here, so this is written before the tag, not after it.

Versions are the engine's own. Games are versioned separately, in their own
repository; see `docs/RELEASING.md` for which version means what.

## 1.0.0

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
