// Data tests over the shipped games.
//
// These catch the class of defect that unit tests never will, because nothing
// is wrong with the code: a game that cannot signal it was finished, or a game
// that still carries another game's identity after being copied from it. Both
// happened, see EI-014 and EI-015.

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

    // A blunt "no game mentions leeuwenhoek" test used to live here. It was
    // written when stop-train, copied from leeuwenhoek, still carried its
    // meta.id. The sharp version of that guard is the meta.id test below, which
    // catches the same thing without tripping over a character's name in the
    // dialogue: `games/demo` is a game *about* Antoni van Leeuwenhoek and says
    // so out loud. The blunt version still earns its keep in the games
    // repository, where there are six games to confuse with each other.

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
    it('every asset a game references exists', () => {
        // A missing image is not a code defect and no unit test sees it. It is
        // seen in a classroom, on a projector, by thirty people at once.
        const assetLike = /^assets\/.+\.(jpg|jpeg|png|svg|webp|mp4|mp3|ogg)$/i;
        const missing = [];

        for (const id of GAME_IDS) {
            const scenes = readJson(id, 'scenes.json');
            // A pose path may contain `/hero/`, which the engine replaces with
            // the selected hero's id at runtime. Accept any of them.
            const heroes = Object.keys(scenes.heroes ?? {});

            const walk = (node) => {
                if (Array.isArray(node)) return node.forEach(walk);
                if (node && typeof node === 'object') return Object.values(node).forEach(walk);
                if (typeof node !== 'string' || !assetLike.test(node)) return;

                const candidates = node.includes('/hero/') && heroes.length
                    ? heroes.map(h => node.replace('/hero/', `/${h}/`))
                    : [node];
                if (!candidates.some(c => existsSync(join(GAMES_DIR, id, c)))) {
                    missing.push(`${id}: ${node}`);
                }
            };

            for (const file of ['scenes.json', 'dialogs.json', 'puzzles.json']) {
                try {
                    walk(readJson(id, file));
                } catch {
                    // not every game has every file
                }
            }
        }

        expect(missing).toEqual([]);
    });

    it('every game declares a saveVersion', () => {
        // meta.version is a label for people and gets bumped for a typo.
        // meta.saveVersion is the number that decides whether a team's saved
        // progress survives, so it has to be stated rather than defaulted:
        // without it the signature falls back to meta.version and a typo fix
        // ends every lesson in progress. See docs/RELEASING.md.
        for (const id of GAME_IDS) {
            const meta = readJson(id, 'scenes.json').meta ?? {};
            expect(meta.saveVersion, `${id} meta.saveVersion`).toBeTypeOf('number');
            expect(Number.isInteger(meta.saveVersion), `${id} meta.saveVersion is an integer`).toBe(true);
        }
    });

    it('every asset path is relative', () => {
        // _resolveAsset() passes through anything starting with ./ or /, so an
        // absolute path works locally and 404s under the runtime's versioned
        // prefix (/g/<tag>/<id>/). Nothing else would catch it: the game runs
        // fine on a dev server.
        const assetish = /\.(jpg|jpeg|png|svg|webp|mp4|mp3|ogg)$/i;
        const offenders = [];

        for (const id of GAME_IDS) {
            const walk = (node) => {
                if (Array.isArray(node)) return node.forEach(walk);
                if (node && typeof node === 'object') return Object.values(node).forEach(walk);
                if (typeof node !== 'string' || !assetish.test(node)) return;
                if (/^(?:https?:)?\/\//i.test(node)) return; // an absolute URL is deliberate
                if (node.startsWith('./') || node.startsWith('/')) offenders.push(`${id}: ${node}`);
            };
            for (const file of ['scenes.json', 'dialogs.json', 'puzzles.json']) {
                try {
                    walk(readJson(id, file));
                } catch { /* not every game has every file */ }
            }
        }

        expect(offenders).toEqual([]);
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
