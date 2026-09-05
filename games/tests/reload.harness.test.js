// Tests for the reload harness itself.
//
// Five of the remaining fixes are tested only through this helper, so if it
// quietly carries something over from the first run, those five tests would
// pass against code that is still broken. That is worth its own test file.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'harness', version: '1.0.0' },
    startScene: 'room',
    scenes: [
        { id: 'room', title: 'Room', image: 'scenes/room.jpg', hotspots: [] },
    ],
    events: [
        {
            id: 'greeting',
            once: true,
            when: { on: 'enterScene', scene: 'room' },
            then: { openDialog: { id: 'greeting' } },
        },
    ],
};

const DIALOGS = {
    meta: { id: 'harness' },
    characters: [],
    dialogs: [
        { id: 'greeting', typewriter: false, sequence: [{ speaker: 'left', text: 'Ahoj' }] },
    ],
};

describe('reload harness', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('carries persisted state across a reload', async () => {
        const h = createReloadHarness({ scenes: SCENES });

        const first = await h.boot();
        first.state.inventory.push('golden_key');
        first._saveState();

        const second = await h.reload();
        expect(second.state.inventory).toContain('golden_key');
    });

    it('does not carry an in-memory change to the game data', async () => {
        // setSceneImage mutates this.data in place (EI-006). If both runs shared
        // one fixture object, that mutation would look like it had been
        // persisted when nothing wrote it anywhere.
        const h = createReloadHarness({ scenes: SCENES });

        const first = await h.boot();
        first.data.scenes[0].image = 'scenes/changed-in-memory.jpg';

        const second = await h.reload();
        expect(second.data.scenes[0].image).toBe('scenes/room.jpg');
        expect(SCENES.scenes[0].image).toBe('scenes/room.jpg');
    });

    it('builds a new DOM, so nothing rendered by the first run answers for the second', async () => {
        const h = createReloadHarness({ scenes: SCENES });

        const first = await h.boot();
        expect(first.sceneImage.getAttribute('src')).toBe('./games/test/scenes/room.jpg');
        first.sceneImage.setAttribute('src', 'stale.jpg');

        const second = await h.reload();
        expect(second.sceneImage).not.toBe(first.sceneImage);
        expect(second.sceneImage.getAttribute('src')).toBe('./games/test/scenes/room.jpg');
    });

    it('can stop a run where the engine is blocked on the player', async () => {
        // This is what makes an interrupted event testable: init() is still
        // awaiting the dialog and will never resolve, which is exactly the
        // situation a tablet reload creates.
        const h = createReloadHarness({ scenes: SCENES, dialogs: DIALOGS });

        const { game, ready } = h.bootDetached();
        await waitFor(() => document.querySelector('.dlg-overlay:not(.hidden)'), { label: 'dialog' });

        let settled = false;
        ready.then(() => { settled = true; });
        await new Promise(res => setTimeout(res, 20));
        expect(settled).toBe(false);
        expect(game.dialogUI.active).not.toBeNull();

        const second = await h.reload();
        expect(second).not.toBe(game);
        expect(document.querySelector('.dlg-overlay:not(.hidden)')).toBeNull();
    });

    it('refuses to reload before anything has booted', async () => {
        const h = createReloadHarness({ scenes: SCENES });
        await expect(h.reload()).rejects.toThrow(/before any boot/);
    });
});
