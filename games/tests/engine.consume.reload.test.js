// EI-011: an item consumed by a hotspot must actually be gone after a reload.
//
// _removeItemFromInventory() spliced the array and re-rendered, and never saved.
// It was persisted only by accident, when a following onApply happened to change
// a flag or the scene and triggered a save for its own reasons. Every current use
// in the shipped games is followed by such an action, which is why nothing looks
// wrong today, so this needs its own fixture.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'ei011', version: '1.0.0' },
    startScene: 'room',
    items: [
        { id: 'coin', label: 'Mince', icon: 'items/coin.png' },
        { id: 'token', label: 'Žeton', icon: 'items/token.png' },
    ],
    scenes: [
        {
            id: 'room',
            title: 'Room',
            image: 'scenes/room.jpg',
            hotspots: [
                // No onApply at all: the item is consumed and the player is told
                // so, and nothing else in the state changes.
                {
                    type: 'apply',
                    acceptItems: [{ id: 'coin', consume: true }],
                    rect: { x: 1, y: 1, w: 5, h: 5 },
                },
                // The same, but with an onApply that would have saved anyway.
                {
                    type: 'apply',
                    acceptItems: [{ id: 'token', consume: true }],
                    onApply: { setFlags: ['token_used'] },
                    rect: { x: 10, y: 1, w: 5, h: 5 },
                },
            ],
        },
    ],
};

describe('EI-011: a consumed item stays consumed', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('is gone after a reload even with nothing else to save', async () => {
        const harness = createReloadHarness({ scenes: SCENES });
        const game = await harness.boot();

        game.state.inventory.push('coin');
        game._saveState();
        game._renderInventory();
        game.enterUseMode('coin');

        document.querySelectorAll('#hotspotLayer .hotspot')[0].click();
        await waitFor(() => !game.state.inventory.includes('coin'), { label: 'the coin to be consumed' });

        const reloaded = await harness.reload();
        expect(reloaded.state.inventory).not.toContain('coin');
    });

    it('does not leave the consumed item selected for use', async () => {
        // Saving the removal is only half of it. The save happened while the
        // item was still the one held for use, so after a reload the inventory
        // was empty but useItemId still named the coin - and _activateHotspot
        // checks the held item against acceptItems without looking in the
        // inventory, so the same coin could be spent a second time.
        const harness = createReloadHarness({ scenes: SCENES });
        const game = await harness.boot();

        game.state.inventory.push('coin');
        game._saveState();
        game._renderInventory();
        game.enterUseMode('coin');

        document.querySelectorAll('#hotspotLayer .hotspot')[0].click();
        await waitFor(() => !game.state.inventory.includes('coin'), { label: 'the coin to be consumed' });

        const reloaded = await harness.reload();
        expect(reloaded.state.useItemId).toBeNull();

        // And the phantom cannot be spent again.
        document.querySelectorAll('#hotspotLayer .hotspot')[0].click();
        await new Promise(res => setTimeout(res, 0));
        expect(reloaded.state.inventory).toEqual([]);
    });

    it('is still gone when a following action would have saved anyway', async () => {
        // The case every shipped game happens to use, kept so the accidental
        // save is not what the first test is really measuring.
        const harness = createReloadHarness({ scenes: SCENES });
        const game = await harness.boot();

        game.state.inventory.push('token');
        game._saveState();
        game._renderInventory();
        game.enterUseMode('token');

        document.querySelectorAll('#hotspotLayer .hotspot')[1].click();
        await waitFor(() => game.state.flags.token_used, { label: 'the token to be used' });

        const reloaded = await harness.reload();
        expect(reloaded.state.inventory).not.toContain('token');
        expect(reloaded.state.flags.token_used).toBe(true);
    });
});
