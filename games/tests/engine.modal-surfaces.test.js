// EI-023: re-rendering the hotspots must not destroy something mounted on top
// of them.
//
// A puzzle and a content panel are both mounted into the hotspot layer, and
// _renderHotspots() cleared that layer wholesale. Anything that re-rendered
// while a puzzle was open tore it out of the DOM without ever calling
// onResolve, so _openPuzzleByRef() waited for a promise nothing would settle -
// and since EI-013 the activation lock is held for as long as that wait, so
// afterwards no tap did anything at all.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'ei023', version: '1.0.0' },
    startScene: 'room',
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
    content: {
        note: {
            id: 'note',
            title: 'Poznámka',
            format: 'markdown',
            body: 'Něco k přečtení.',
            panel: { rect: { x: 5, y: 5, w: 50, h: 90 }, animation: 'none' },
            once: false,
        },
    },
    scenes: [
        {
            id: 'room',
            title: 'Room',
            image: 'scenes/room.jpg',
            hotspots: [
                { type: 'puzzle', puzzleRef: 'riddle', rect: { x: 1, y: 1, w: 5, h: 5 } },
            ],
        },
    ],
};

describe('EI-023: a re-render underneath an open puzzle', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('leaves the puzzle mounted', async () => {
        const harness = createReloadHarness({ scenes: SCENES });
        const game = await harness.boot();

        const result = game._openPuzzleByRef({ ref: 'riddle', rect: { x: 10, y: 10, w: 80, h: 80 } });
        await waitFor(() => document.querySelector('.pz-container'), { label: 'the puzzle' });

        // What an event does when a flag changes while the puzzle is open.
        game._renderHotspots();

        expect(document.querySelector('.pz-container')).not.toBeNull();

        // And it still settles, which is the part the engine waits on.
        document.querySelector('.pz-btn--cancel').click();
        await expect(result).resolves.toMatchObject({ ok: false });
    });

    it('leaves the hotspot layer usable afterwards', async () => {
        // The activation lock is held for as long as the puzzle is open, so a
        // puzzle that can never settle means no tap works again.
        const harness = createReloadHarness({ scenes: SCENES });
        const game = await harness.boot();

        document.querySelector('#hotspotLayer .hotspot').click();
        await waitFor(() => document.querySelector('.pz-container'), { label: 'the puzzle' });

        game._renderHotspots();
        document.querySelector('.pz-btn--cancel').click();
        await waitFor(() => !game._hotspotBusy, { label: 'the activation to finish' });

        // A second attempt opens the puzzle again.
        document.querySelector('#hotspotLayer .hotspot').click();
        await waitFor(() => document.querySelector('.pz-container'), { label: 'the puzzle again' });
        expect(document.querySelectorAll('.pz-container')).toHaveLength(1);
    });

    it('leaves a content panel mounted', async () => {
        const harness = createReloadHarness({ scenes: SCENES });
        const game = await harness.boot();

        const closed = game.contentPanel.open('note');
        await waitFor(() => document.querySelector('.cp-container'), { label: 'the panel' });

        game._renderHotspots();

        expect(document.querySelector('.cp-container')).not.toBeNull();
        game.contentPanel.close();
        await closed;
    });

    it('still clears the hotspots it drew last time', async () => {
        // The renderer must still own its own output, or every re-render would
        // leave a second copy of every hotspot behind.
        const harness = createReloadHarness({ scenes: SCENES });
        const game = await harness.boot();

        game._renderHotspots();
        game._renderHotspots();

        expect(document.querySelectorAll('#hotspotLayer .hotspot')).toHaveLength(1);
    });
});
