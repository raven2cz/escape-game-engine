// A dialog portrait that never answers must not take the game with it.
//
// DialogUI.open() preloads the portraits before it builds anything, and it has
// always handled `onerror` with a comment saying the game must not get stuck on
// a missing image. A request that is dropped rather than refused fires neither
// event, which is an ordinary thing for a school network to do, and there was no
// timeout.
//
// On its own that hung one dialog. Since EI-013 it hangs everything: the
// resolver is never installed, so `_opening` stays claimed and every later
// dialog is refused, and when the dialog was opened from a hotspot the
// activation lock is held too and no tap does anything at all.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createReloadHarness, takeOverImageLoading, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'preload', version: '1.0.0' },
    startScene: 'room',
    scenes: [
        {
            id: 'room',
            title: 'Room',
            image: 'scenes/room.jpg',
            hotspots: [
                { type: 'dialog', dialogId: 'greeting', rect: { x: 1, y: 1, w: 5, h: 5 } },
                { type: 'goTo', target: 'hall', rect: { x: 10, y: 1, w: 5, h: 5 } },
            ],
        },
        { id: 'hall', title: 'Hall', image: 'scenes/hall.jpg', hotspots: [] },
    ],
};

const DIALOGS = {
    meta: { id: 'preload' },
    characters: [
        { id: 'guide', name: 'Průvodce', poses: { idle: 'npc/guide/idle.png' } },
    ],
    dialogs: [
        {
            id: 'greeting',
            typewriter: false,
            left: { characterId: 'guide', defaultPose: 'idle' },
            sequence: [{ speaker: 'left', text: 'Dobrý den.' }],
        },
    ],
};

describe('a dialog portrait that never loads', () => {
    let img;

    beforeEach(() => {
        localStorage.clear();
        img = takeOverImageLoading();
    });

    afterEach(() => {
        img.restore();
    });

    const bootRoom = async (harness) => {
        const { game, ready } = harness.bootDetached({ gameOpts: { sceneImageTimeoutMs: 50 } });
        await img.waitForRequest('room.jpg');
        img.settle('room.jpg');
        await ready;
        return game;
    };

    it('opens the dialog anyway, within the timeout', async () => {
        const harness = createReloadHarness({ scenes: SCENES, dialogs: DIALOGS });
        const game = await bootRoom(harness);

        document.querySelectorAll('#hotspotLayer .hotspot')[0].click();
        await img.waitForRequest('idle.png');
        // The portrait request is simply never answered.

        await waitFor(() => game.dialogUI.active?.id === 'greeting', { label: 'the dialog to open' });
        expect(document.querySelector('.dlg-overlay:not(.hidden)')).not.toBeNull();
    });

    it('leaves the rest of the game usable', async () => {
        const harness = createReloadHarness({ scenes: SCENES, dialogs: DIALOGS });
        const game = await bootRoom(harness);

        document.querySelectorAll('#hotspotLayer .hotspot')[0].click();
        await img.waitForRequest('idle.png');
        await waitFor(() => game.dialogUI.active, { label: 'the dialog to open' });

        await game.dialogUI.close();
        await new Promise(res => setTimeout(res, 0));

        // The activation lock was released, so the pupil can still leave.
        document.querySelectorAll('#hotspotLayer .hotspot')[1].click();
        await img.waitForRequest('hall.jpg');
        img.settle('hall.jpg');
        await waitFor(() => game.currentScene.id === 'hall', { label: 'the hall' });

        expect(game.currentScene.id).toBe('hall');
    });
});
