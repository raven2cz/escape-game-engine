// EI-001: a once-event must not be able to count as done before its durable
// effects are stored.
//
// The event is marked in `eventsFired` and persisted the moment it matches, so
// that a blocking action cannot re-trigger it. But `setFlags` used to run last,
// after the dialog and the video had been awaited. Anything that ends the page
// in between - a reload, a sleeping tablet, a killed tab - left the event
// recorded as done with its flags never set, and a once-event does not run
// again.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'ei001', version: '1.0.0' },
    startScene: 'hall',
    scenes: [
        {
            id: 'hall',
            title: 'Hall',
            image: 'scenes/hall.jpg',
            hotspots: [
                { type: 'goTo', target: 'vault', requireFlags: ['door_unlocked'], rect: { x: 1, y: 1, w: 5, h: 5 } },
            ],
        },
        { id: 'vault', title: 'Vault', image: 'scenes/vault.jpg', hotspots: [] },
    ],
    events: [
        {
            id: 'unlock-the-door',
            once: true,
            when: { on: 'enterScene', scene: 'hall' },
            then: {
                setFlags: ['door_unlocked'],
                openDialog: { id: 'caretaker' },
            },
        },
    ],
};

const DIALOGS = {
    meta: { id: 'ei001' },
    characters: [],
    dialogs: [
        {
            id: 'caretaker',
            typewriter: false,
            sequence: [
                { speaker: 'left', text: 'Odemkl jsem ti dveře.' },
                { speaker: 'left', text: 'Běž.' },
            ],
        },
    ],
};

describe('EI-001: once-event interrupted while its dialog is open', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('keeps the flags it set after a reload', async () => {
        const h = createReloadHarness({ scenes: SCENES, dialogs: DIALOGS });

        const { game } = h.bootDetached();
        await waitFor(() => document.querySelector('.dlg-overlay:not(.hidden)'), { label: 'caretaker dialog' });

        // The pupil is looking at the dialog. The tablet reloads here.
        const reloaded = await h.reload();

        expect(reloaded.state.flags.door_unlocked).toBe(true);
        expect(game.state.eventsFired['unlock-the-door']).toBe(true);
    });

    it('does not replay the event after the reload', async () => {
        // The deliberate trade-off: the dialog is lost rather than repeated,
        // because the action list also contains things that are not idempotent
        // (a video, a puzzle). Losing a line of dialogue beats replaying a video
        // on every interrupted load.
        const h = createReloadHarness({ scenes: SCENES, dialogs: DIALOGS });

        h.bootDetached();
        await waitFor(() => document.querySelector('.dlg-overlay:not(.hidden)'), { label: 'caretaker dialog' });

        const reloaded = await h.reload();

        expect(document.querySelector('.dlg-overlay:not(.hidden)')).toBeNull();
        expect(reloaded.state.eventsFired['unlock-the-door']).toBe(true);
    });

    it('leaves the gated hotspot usable after the reload', async () => {
        // The flag is not the point on its own. What matters is that the scene
        // the flag gates can still be reached.
        const h = createReloadHarness({ scenes: SCENES, dialogs: DIALOGS });

        h.bootDetached();
        await waitFor(() => document.querySelector('.dlg-overlay:not(.hidden)'), { label: 'caretaker dialog' });

        const reloaded = await h.reload();
        document.querySelector('#hotspotLayer .hotspot').click();
        await waitFor(() => reloaded.state.scene === 'vault', { label: 'vault scene' });

        expect(reloaded.state.scene).toBe('vault');
    });
});
