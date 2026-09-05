// EI-013: a double tap must not open two dialogs or two puzzles.
//
// Nothing stopped a second activation while the first was still opening, and
// DialogUI kept a single _closeResolver that a second open() overwrote. So
// whoever awaited the first dialog waited forever, and the run carried on with
// a step silently skipped: the same class of failure as EI-001, from a different
// direction.
//
// On a tablet a double tap is an ordinary input, not an edge case.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'ei013', version: '1.0.0' },
    startScene: 'room',
    events: [
        {
            id: 'after-the-handover',
            once: true,
            when: { on: 'stateChange', requireFlags: ['handover_done'] },
            then: { openDialog: { id: 'follow-up' } },
        },
    ],
    puzzles: {
        riddle: {
            id: 'riddle',
            kind: 'phrase',
            title: 'Hádanka',
            prompt: 'Odpověz',
            solution: 'ano',
            options: { blockUntilSolved: false },
        },
    },
    scenes: [
        {
            id: 'room',
            title: 'Room',
            image: 'scenes/room.jpg',
            hotspots: [
                { type: 'puzzle', puzzleRef: 'riddle', rect: { x: 1, y: 1, w: 5, h: 5 } },
                { type: 'dialog', dialogId: 'chat', rect: { x: 10, y: 1, w: 5, h: 5 } },
            ],
        },
    ],
};

const DIALOGS = {
    meta: { id: 'ei013' },
    characters: [],
    dialogs: [
        {
            id: 'chat',
            typewriter: false,
            sequence: [
                { speaker: 'left', text: 'První.' },
                { speaker: 'left', text: 'Druhá.' },
            ],
        },
        { id: 'interloper', typewriter: false, sequence: [{ speaker: 'left', text: 'Já taky.' }] },
        { id: 'empty', typewriter: false, sequence: [] },
        {
            id: 'handover',
            typewriter: false,
            sequence: [{ speaker: 'left', text: 'Předávám ti to.' }],
            onEnd: { setFlags: ['handover_done'] },
        },
        { id: 'follow-up', typewriter: false, sequence: [{ speaker: 'left', text: 'Navazuji.' }] },
    ],
};

const bootRoom = async () => {
    const harness = createReloadHarness({ scenes: SCENES, dialogs: DIALOGS });
    return harness.boot();
};

describe('EI-013: a double tap', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('opens one puzzle, not two', async () => {
        const game = await bootRoom();
        const puzzleHotspot = document.querySelectorAll('#hotspotLayer .hotspot')[0];

        puzzleHotspot.click();
        puzzleHotspot.click();
        await waitFor(() => document.querySelector('.pz-container'), { label: 'puzzle' });

        expect(document.querySelectorAll('.pz-container')).toHaveLength(1);
        expect(game.currentScene.id).toBe('room');
    });

    it('runs one dialog hotspot activation, not two', async () => {
        // There is only ever one overlay element, so counting DOM nodes would
        // pass whatever happened. What matters is how many times the activation
        // ran, because the second one is what steals the first one's resolver.
        const game = await bootRoom();
        const dialogHotspot = document.querySelectorAll('#hotspotLayer .hotspot')[1];

        let opens = 0;
        const realOpen = game.dialogUI.open.bind(game.dialogUI);
        game.dialogUI.open = (id) => { opens++; return realOpen(id); };

        dialogHotspot.click();
        dialogHotspot.click();
        await waitFor(() => game.dialogUI.active, { label: 'dialog' });

        expect(opens).toBe(1);
        expect(game.dialogUI.active.id).toBe('chat');
    });

    it('settles an awaited dialog even when a second open() arrives', async () => {
        const game = await bootRoom();

        let settled = false;
        const awaited = game.openDialog('chat').then(() => { settled = true; });
        await waitFor(() => game.dialogUI.active?.id === 'chat', { label: 'chat dialog' });

        // The second open must not take over the first one's resolver.
        await game.openDialog('interloper');
        expect(game.dialogUI.active.id).toBe('chat');

        await game.dialogUI.close();
        await waitFor(() => settled, { label: 'the first dialog to settle' });
        await awaited;

        expect(settled).toBe(true);
    });

    it('settles a dialog that has nothing to show', async () => {
        // A dialog with an empty sequence ends during open(), before the promise
        // the caller is handed even exists. It used to hang the event that
        // opened it, and a hung event is a run that quietly stops progressing.
        const game = await bootRoom();

        let settled = false;
        game.openDialog('empty').then(() => { settled = true; });
        await waitFor(() => settled, { label: 'the empty dialog to settle' });

        expect(settled).toBe(true);
        expect(game.dialogUI.active).toBeNull();
    });

    it('still lets a dialog open one from its own onEnd, and lets the pupil click through it', async () => {
        // The refusal must not catch this. A dialog whose onEnd sets a flag that
        // an event reacts to by opening another dialog is a normal chain in the
        // shipped games, and it runs while the first dialog is still finishing.
        //
        // The second dialog also has to be usable, which is EI-021: _busy was
        // still held by the advance that started the chain, and _handleInput()
        // returns early whenever _busy is set, so every tap on the second dialog
        // was ignored and the run stopped there for good.
        const game = await bootRoom();

        let settled = false;
        game.openDialog('handover').then(() => { settled = true; });
        await waitFor(() => game.dialogUI.active?.id === 'handover', { label: 'handover dialog' });

        // next() does not return until everything the ending sets in motion is
        // done, so it must not be awaited here.
        game.dialogUI.next();
        await waitFor(() => game.dialogUI.active?.id === 'follow-up', { label: 'follow-up dialog' });

        expect(game.state.flags.handover_done).toBe(true);
        expect(settled).toBe(false); // the first dialog waits for what it started

        // Closed the way a pupil closes it: by tapping.
        document.querySelector('.dlg-overlay').click();
        await waitFor(() => settled, { label: 'the handover dialog to settle' });
        expect(game.dialogUI.active).toBeNull();
    });

    it('lets the next dialog open once the first one is closed', async () => {
        // The lock must not outlive the operation it protects.
        const game = await bootRoom();

        game.openDialog('chat');
        await waitFor(() => game.dialogUI.active?.id === 'chat', { label: 'chat dialog' });
        await game.dialogUI.close();

        game.openDialog('interloper');
        await waitFor(() => game.dialogUI.active?.id === 'interloper', { label: 'interloper dialog' });

        expect(game.dialogUI.active.id).toBe('interloper');
    });

    it('lets the next hotspot be used once the first activation is done', async () => {
        // The lock is held for as long as the activation runs, which for a
        // dialog means until it is closed. It must be released after that, or a
        // pupil who closes a dialog can never tap anything again.
        const game = await bootRoom();
        const dialogHotspot = document.querySelectorAll('#hotspotLayer .hotspot')[1];

        dialogHotspot.click();
        await waitFor(() => game.dialogUI.active?.id === 'chat', { label: 'dialog' });
        await game.dialogUI.close();
        await new Promise(res => setTimeout(res, 0));

        dialogHotspot.click();
        await waitFor(() => game.dialogUI.active?.id === 'chat', { label: 'dialog again' });

        expect(game.dialogUI.active.id).toBe('chat');
    });
});
