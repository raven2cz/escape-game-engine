// Data tests over the shipped games.
//
// These catch the class of defect that unit tests never will, because nothing
// is wrong with the code: a game that cannot signal it was finished, or a game
// that still carries another game's identity after being copied from it. Both
// happened, see EI-014 and EI-015.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GAMES_DIR = join(process.cwd(), 'games');

// Every directory here is a shipped game and every one of them is measured.
// `demo` used to be excluded by name - the original leeuwenhoek prototype in the
// pre-puzzleRef format, with no meta and three puzzle hotspots that could not
// open. It was deleted rather than ported (EI-020), so there is nothing to
// exclude any more. If a game ever has to be skipped again, name it here with
// the reason rather than quietly loosening an assertion.

const GAME_IDS = readdirSync(GAMES_DIR)
    .filter(name => name !== 'tests')
    .filter(name => statSync(join(GAMES_DIR, name)).isDirectory());

const readJson = (gameId, file) =>
    JSON.parse(readFileSync(join(GAMES_DIR, gameId, file), 'utf8'));

// scenes is a list in every shipped game, but the engine also accepts a map.
const sceneList = (scenes) => (Array.isArray(scenes) ? scenes : Object.values(scenes ?? {}));

describe('shipped games', () => {
    it('every game ships at least one scene', () => {
        for (const id of GAME_IDS) {
            expect(sceneList(readJson(id, 'scenes.json').scenes).length, id).toBeGreaterThan(0);
        }
    });

    it('every game has exactly one scene flagged as the end', () => {
        // Completion is detected from `scene.end`, so a game without it can be
        // played to the finish and still never count as finished. reactor
        // shipped that way. More than one end scene would be ambiguous for the
        // same reason.
        for (const id of GAME_IDS) {
            const ends = sceneList(readJson(id, 'scenes.json').scenes)
                .filter(sc => sc.end)
                .map(sc => sc.id);
            expect(ends, `${id} end scenes`).toHaveLength(1);
        }
    });

    it('no game other than leeuwenhoek carries leeuwenhoek identity', () => {
        // stop-train was copied from leeuwenhoek and kept its dialogs meta.id
        // and a translation key belonging to its characters.
        //
        // Scope is games/ only. The engine itself still names the first game in
        // several places (storage key, service worker, default game); that is
        // EI-002, EI-007 and EI-015 and is not fixed here.
        for (const id of GAME_IDS) {
            if (id === 'leeuwenhoek') continue;
            for (const file of ['scenes.json', 'dialogs.json', 'puzzles.json']) {
                let raw;
                try {
                    raw = readFileSync(join(GAMES_DIR, id, file), 'utf8');
                } catch {
                    continue; // not every game has every file
                }
                expect(raw.toLowerCase(), `${id}/${file}`).not.toContain('leeuwenhoek');
            }
        }
    });

    it('meta.id matches the directory name where meta exists', () => {
        for (const id of GAME_IDS) {
            for (const file of ['scenes.json', 'dialogs.json']) {
                let data;
                try {
                    data = readJson(id, file);
                } catch {
                    continue;
                }
                if (!data.meta?.id) continue;
                expect(data.meta.id, `${id}/${file}`).toBe(id);
            }
        }
    });
    it('every puzzle hotspot references a puzzle', () => {
        // A `puzzle` hotspot without `puzzleRef` logs an error and does nothing,
        // which is how the demo game became unplayable without anyone noticing.
        for (const id of GAME_IDS) {
            for (const scene of sceneList(readJson(id, 'scenes.json').scenes)) {
                for (const hotspot of scene.hotspots ?? []) {
                    if (hotspot.type !== 'puzzle') continue;
                    expect(hotspot.puzzleRef, `${id}/${scene.id}`).toBeTruthy();
                }
            }
        }
    });
    it('no game uses the removed puzzleList feature', () => {
        // `puzzleList` and `openPuzzleList` called a function that was never
        // defined, so they threw a ReferenceError. They were removed rather than
        // implemented, because sequences already work through `kind: list` with
        // puzzleRef. A game using them now would silently do nothing, hence this
        // guard. See EI-009.
        for (const id of GAME_IDS) {
            const raw = readFileSync(join(GAMES_DIR, id, 'scenes.json'), 'utf8');
            expect(raw, id).not.toContain('puzzleList');
        }
    });
});
