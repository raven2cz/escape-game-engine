// engine/version.js
//
// What the engine is, in a form the browser can read. `package.json` is not
// importable at runtime without a build step, and this project deliberately has
// none, so the version is written here too. `scripts/version-sync.mjs` rewrites
// this file during `npm version` and a test keeps the two equal, so nobody edits
// it by hand.

/**
 * The engine's own version, matching `package.json` and the git tag.
 *
 * Not part of the saved-state signature, and that is deliberate: releasing a new
 * engine must never end a lesson. A team reloads onto the new code and their
 * progress is still there. See docs/RELEASING.md.
 */
export const ENGINE_VERSION = '1.1.1';

/**
 * What the engine promises to whatever is reading it from outside: the hosted
 * runtime, and the teacher's dashboard that will come after it.
 *
 * It moves when the *shape* of what the engine reports changes - a field
 * renamed, a meaning changed - and not when the engine is merely fixed. So a
 * dashboard written against 1 can look at an engine reporting 2 and say "I do
 * not understand this" instead of quietly mis-reading it.
 *
 * Version 2 is the first that promises anything: the DashboardReport contract
 * in engine/dashboard/report.js, documented in docs/DASHBOARD-API.md. Adding an
 * optional field does not move it; removing a field or changing what one means
 * does. It is not the save format, which the engine never exposes.
 */
export const ENGINE_API_VERSION = 2;
