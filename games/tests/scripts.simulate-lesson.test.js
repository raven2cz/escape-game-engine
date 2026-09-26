// The lesson simulator (scripts/simulate-lesson.mjs): what it sends to the board
// has to be real reports, and a simulated lesson has to actually happen.

import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createLesson, planRoute, seeded} from '../../scripts/simulate-lesson.mjs';
import {checkReport} from '../../engine/dashboard/report.js';
import {buildCatalogue} from '../../engine/dashboard/catalogue.js';

const read = (f) => JSON.parse(readFileSync(join(process.cwd(), 'games', 'demo', f), 'utf8'));
const lessonFor = (now) => createLesson({scenesDoc: read('scenes.json'), puzzles: read('puzzles.json'), dialogs: read('dialogs.json'), now, rng: seeded(3)});

describe('simulate-lesson', () => {
    it('plans the route from the game files, the end scene last', () => {
        const cat = buildCatalogue(read('scenes.json'), read('puzzles.json'));
        const route = planRoute(read('scenes.json'), cat);
        expect(route.at(-1).end).toBe(true);
        expect(new Set(route.flatMap(r => r.tasks))).toEqual(new Set(cat.tasks.map(t => t.id)));
    });

    it('sends only well-formed reports, and the lesson moves: someone finishes, someone drops out', () => {
        let now = 1_800_000_000_000;
        const lesson = lessonFor(now);
        let invalid = 0;
        let lastCount = 0;
        for (let i = 0; i < 200; i++) {
            now += 2000;
            const reports = lesson.step(now);
            invalid += reports.flatMap(r => checkReport(r)).length;
            lastCount = reports.length;
        }
        expect(invalid).toBe(0);
        expect(lesson.teams.some(t => t.progress.completedAt != null)).toBe(true);
        expect(lastCount).toBe(lesson.teams.length - 1); // the dropout stopped reporting
        const stuck = lesson.teams.find(t => t.role === 'stuck');
        expect(stuck.progress.completedAt).toBeNull();
    });

    it('is repeatable with the same seed', () => {
        const a = lessonFor(1_800_000_000_000).step(1_800_000_002_000);
        const b = lessonFor(1_800_000_000_000).step(1_800_000_002_000);
        expect(a).toEqual(b);
    });
});
