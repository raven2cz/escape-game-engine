// EI-015: nothing in the engine is named after one particular game.
//
// The first game's names sat in places that presented themselves as engine-wide:
// the storage key, the hero fallback and its asset path, the service worker
// cache name. Mostly it was confusion rather than breakage, and it gets worse
// the moment the games move to their own repository and the engine is supposed
// to stand on its own.
//
// Scope is `engine/`. `index.html` is the shell rather than the engine and
// legitimately picks a game to open when the address bar does not say; that one
// place is named and commented. `service-worker.js` is EI-007, an open decision
// about whether it is repaired or removed.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE_DIR = join(process.cwd(), 'engine');
const GAMES_DIR = join(process.cwd(), 'games');

const GAME_IDS = readdirSync(GAMES_DIR)
    .filter(name => name !== 'tests')
    .filter(name => statSync(join(GAMES_DIR, name)).isDirectory());

const engineFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return engineFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
});

// The one mention that has to stay: the key every game shared before EI-002
// namespaced it. Migrating a lesson that is already in progress means naming it.
const ALLOWED = ["const LEGACY_STATE_KEY = 'leeuwenhoek_escape_state';"];

const isComment = (line) => {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

describe('the engine is not named after a game', () => {
    it('names no shipped game in code', () => {
        const offenders = [];

        for (const file of engineFiles(ENGINE_DIR)) {
            const lines = readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (isComment(line)) return;                       // history may be explained
                if (ALLOWED.includes(line.trim())) return;
                const hit = GAME_IDS.find(id => line.toLowerCase().includes(id));
                if (hit) offenders.push(`${file}:${i + 1} mentions "${hit}": ${line.trim()}`);
            });
        }

        expect(offenders).toEqual([]);
    });

    it('gives a game with no heroes no asset path of its own', () => {
        // The concrete shape the old fallback took: assets/npc/adam/, which is
        // one character in one game.
        const offenders = [];

        for (const file of engineFiles(ENGINE_DIR)) {
            const lines = readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (isComment(line)) return;
                if (/assets\/npc\//.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
            });
        }

        expect(offenders).toEqual([]);
    });
});
