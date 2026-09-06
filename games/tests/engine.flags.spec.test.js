// A flag name written on its own must set that flag.
//
// `setFlags` accepted an array or a map, and anything else fell through to
// `Object.entries()`. A string therefore set one flag per character: writing
// `"setFlags": "lab_unlocked"` left `{"0":true, …, "11":true}` in the state, the
// flag itself unset, and - because something did change - the state saved and
// the stateChange events fired. No error anywhere. The door simply never opens,
// and the author has no way to find out why.
//
// `giveItem` has always accepted a single value, which is what makes this a trap
// rather than just a limitation. Found in review of the README rewrite (EI-018),
// which had documented the forgiving behaviour that only one of the two had.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'flags', version: '1.0.0' },
    startScene: 'room',
    items: [{ id: 'lamp', label: 'Lampa' }],
    scenes: [
        {
            id: 'room',
            title: 'Room',
            image: 'scenes/room.jpg',
            hotspots: [
                { type: 'apply', onApply: { setFlags: 'lit' }, rect: { x: 1, y: 1, w: 5, h: 5 } },
            ],
        },
    ],
    events: [
        {
            id: 'single-flag',
            once: true,
            when: { on: 'enterScene', scene: 'room' },
            then: { setFlags: 'entered' },
        },
    ],
};

const DIALOGS = {
    meta: { id: 'flags' },
    characters: [],
    dialogs: [
        {
            id: 'chat',
            typewriter: false,
            sequence: [{ speaker: 'left', text: 'Ahoj' }],
            onEnd: { setFlags: 'talked' },
        },
    ],
};

const boot = () => createReloadHarness({ scenes: SCENES, dialogs: DIALOGS }).boot();

describe('a single flag name, written without a list', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('works in an event', async () => {
        const game = await boot();

        expect(game.state.flags.entered).toBe(true);
        expect(game.state.flags['0']).toBeUndefined();
    });

    it('works in an action bundle', async () => {
        const game = await boot();

        await game._applyActions({ setFlags: 'lab_unlocked' });

        expect(game.state.flags.lab_unlocked).toBe(true);
        expect(Object.keys(game.state.flags)).not.toContain('0');
    });

    it('works at the end of a dialog', async () => {
        const game = await boot();

        game.openDialog('chat');
        await waitFor(() => game.dialogUI.active, { label: 'the dialog' });
        await game.dialogUI.close();
        await game.dialogUI._applyFlags('talked');

        expect(game.state.flags.talked).toBe(true);
    });

    it('works for clearFlags too', async () => {
        const game = await boot();
        await game._applyActions({ setFlags: ['lit'] });

        await game._applyActions({ clearFlags: 'lit' });

        expect(game.state.flags.lit).toBeUndefined();
    });

    it('still takes a list and a map', async () => {
        const game = await boot();

        await game._applyActions({ setFlags: ['a', 'b'] });
        await game._applyActions({ setFlags: { c: true, a: false } });

        expect(game.state.flags.a).toBe(false);
        expect(game.state.flags.b).toBe(true);
        expect(game.state.flags.c).toBe(true);
    });
});
