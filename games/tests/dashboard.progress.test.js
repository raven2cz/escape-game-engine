// EI-010: the private progress record and the model that is its only writer.

import {describe, it, expect, beforeEach} from 'vitest';
import {GameSignals, SIGNALS} from '../../engine/dashboard/signals.js';
import {manualClock} from '../../engine/dashboard/clock.js';
import {
    ProgressModel, freshProgress, normalizeProgress, PROGRESS_LIMITS,
} from '../../engine/dashboard/progress-model.js';

let signals, clock, state, model;
const runIds = () => {
    let n = 0;
    return () => `run-${++n}`;
};

beforeEach(() => {
    signals = new GameSignals();
    clock = manualClock(1_000_000);
    state = {progress: freshProgress(clock, runIds())};
    model = new ProgressModel({signals, getState: () => state, clock});
});

describe('freshProgress', () => {
    it('starts a run now, with nothing recorded', () => {
        expect(state.progress).toEqual({
            run: 'run-1', revision: 0, seq: 0, startedAt: 1_000_000,
            scene: null, sceneEnteredAt: 1_000_000, completedAt: null,
            sceneTime: {}, puzzles: {}, itemsUsed: {}, dialogsSeen: {},
        });
    });
});

describe('ProgressModel', () => {
    it('times each scene and keeps the clock running on a re-entry of the same scene', () => {
        signals.emit(SIGNALS.SCENE_ENTERED, {scene: 'hall'});
        clock.advance(5000);
        signals.emit(SIGNALS.SCENE_ENTERED, {scene: 'lab'});
        clock.advance(3000);
        signals.emit(SIGNALS.SCENE_ENTERED, {scene: 'lab'}); // a reload lands here
        expect(state.progress.scene).toBe('lab');
        expect(state.progress.sceneEnteredAt).toBe(1_005_000); // not reset by the re-entry
        clock.advance(2000);
        signals.emit(SIGNALS.SCENE_ENTERED, {scene: 'hall'});
        expect(state.progress.sceneTime).toEqual({hall: 5000, lab: 5000});
    });

    it('counts attempts and mistakes, and solved is terminal', () => {
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: true});
        signals.emit(SIGNALS.PUZZLE_SOLVED, {ref: 'q'});
        expect(state.progress.puzzles.q).toEqual({seq: 1, attempts: 3, mistakes: 2, solved: true});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        expect(state.progress.puzzles.q.solved).toBe(true);
    });

    it('records items used and dialogs seen once, in first-touch order across both', () => {
        signals.emit(SIGNALS.ITEM_USED, {id: 'key'});
        signals.emit(SIGNALS.DIALOG_ENDED, {id: 'intro'});
        signals.emit(SIGNALS.ITEM_USED, {id: 'key'});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: true});
        expect(state.progress.itemsUsed).toEqual({key: 1});
        expect(state.progress.dialogsSeen).toEqual({intro: 2});
        expect(state.progress.puzzles.q.seq).toBe(3);
    });

    it('stamps completion once', () => {
        signals.emit(SIGNALS.RUN_COMPLETED);
        clock.advance(60_000);
        signals.emit(SIGNALS.RUN_COMPLETED);
        expect(state.progress.completedAt).toBe(1_000_000);
    });

    it('tracks the innermost open puzzle and forgets it on settle or scene change', () => {
        expect(model.activity()).toBeNull();
        signals.emit(SIGNALS.PUZZLE_OPENED, {ref: 'outer-step'});
        clock.advance(100);
        signals.emit(SIGNALS.PUZZLE_OPENED, {ref: 'inner'});
        expect(model.activity()).toEqual({ref: 'inner', since: 1_000_100});
        signals.emit(SIGNALS.PUZZLE_SETTLED, {ref: 'inner'});
        expect(model.activity()).toEqual({ref: 'outer-step', since: 1_000_000});
        signals.emit(SIGNALS.SCENE_ENTERED, {scene: 'elsewhere'});
        expect(model.activity()).toBeNull();
    });

    it('does nothing, and does not throw, while there is no state yet', () => {
        state = null;
        expect(() => signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false})).not.toThrow();
    });

    it('ignores ids that are not ids', () => {
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: '', ok: false});
        signals.emit(SIGNALS.ITEM_USED, {id: 42});
        signals.emit(SIGNALS.DIALOG_ENDED, {id: 'x'.repeat(PROGRESS_LIMITS.idLength + 1)});
        expect(state.progress.puzzles).toEqual({});
        expect(state.progress.itemsUsed).toEqual({});
        expect(state.progress.dialogsSeen).toEqual({});
    });

    it('stops growing at the limits', () => {
        for (let i = 0; i < PROGRESS_LIMITS.puzzles + 20; i++) {
            signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: `p${i}`, ok: false});
        }
        expect(Object.keys(state.progress.puzzles)).toHaveLength(PROGRESS_LIMITS.puzzles);
    });
});

describe('normalizeProgress', () => {
    it('gives an older save, which has none, a fresh record', () => {
        const p = normalizeProgress(undefined, clock, () => 'new-run');
        expect(p.run).toBe('new-run');
        expect(p.startedAt).toBe(1_000_000);
    });

    it('keeps a valid record, run and revision included', () => {
        const saved = {
            run: 'kept', revision: 7, seq: 3, startedAt: 10, scene: 'lab', sceneEnteredAt: 20, completedAt: 30,
            sceneTime: {hall: 5}, puzzles: {q: {seq: 1, attempts: 2, mistakes: 1, solved: true}},
            itemsUsed: {key: 2}, dialogsSeen: {intro: 3},
        };
        expect(normalizeProgress(structuredClone(saved), clock)).toEqual(saved);
    });

    it('drops what is the wrong type, and anything it does not know', () => {
        const p = normalizeProgress({
            run: 5, revision: -3, startedAt: 'yesterday', scene: {}, completedAt: NaN,
            sceneTime: {hall: 'long', lab: 4}, puzzles: {q: 'solved', r: {attempts: 'x', mistakes: 2, solved: 'yes', secret: 1}},
            itemsUsed: [1, 2], dialogsSeen: {a: -1}, flags: {cheat: true},
        }, clock, () => 'fresh');
        expect(p.run).toBe('fresh');
        expect(p.revision).toBe(0);
        expect(p.startedAt).toBe(1_000_000);
        expect(p.scene).toBeNull();
        expect(p.completedAt).toBeNull();
        expect(p.sceneTime).toEqual({hall: 0, lab: 4});
        expect(p.puzzles).toEqual({r: {seq: 0, attempts: 0, mistakes: 2, solved: false}});
        expect(p.itemsUsed).toEqual({});
        expect(p.dialogsSeen).toEqual({a: 0});
        expect(p).not.toHaveProperty('flags');
    });

    it('bounds collections an edited save tried to inflate', () => {
        const puzzles = {};
        for (let i = 0; i < PROGRESS_LIMITS.puzzles * 3; i++) puzzles[`p${i}`] = {seq: i, attempts: 1, mistakes: 1, solved: false};
        expect(Object.keys(normalizeProgress({puzzles}, clock).puzzles)).toHaveLength(PROGRESS_LIMITS.puzzles);
    });

    it('starts a new run rather than continue from a revision it cannot safely increment', () => {
        for (const revision of [Number.MAX_SAFE_INTEGER, 2 ** 40, -1, 1.5, '7']) {
            const p = normalizeProgress({run: 'old', revision}, clock, () => 'new');
            expect(p.run, String(revision)).toBe('new');
            expect(p.revision).toBe(0);
        }
        expect(normalizeProgress({run: 'old', revision: 41}, clock, () => 'new')).toMatchObject({run: 'old', revision: 41});
        // A run without its revision would count again from 0: new run.
        expect(normalizeProgress({run: 'old'}, clock, () => 'new')).toMatchObject({run: 'new', revision: 0});
    });

    it('keeps the first-touch counter ahead of every stored order', () => {
        const p = normalizeProgress({seq: 1, puzzles: {q: {seq: 9}}, itemsUsed: {k: 12}}, clock);
        expect(p.seq).toBe(12);
    });
});
