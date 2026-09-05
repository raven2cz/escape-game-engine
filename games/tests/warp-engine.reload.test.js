// The worst defect the audit found, against the real data of the game it
// happens in.
//
// warp-engine, scenes.json:
//   event "warp-ready", once, when all six slots are filled
//     then: setSceneImage -> openDialog "warp-core.victory" -> setFlags
//                                                              ["warp_engine_active"]
//   scene "warp-core", hotspot goTo "exit", requireFlags ["warp_engine_active"]
//
// A team that reloaded while the victory dialog was on screen could never leave
// the warp core again: the event was in `eventsFired`, so it would not run a
// second time, and the flag its last action would have set was never written.
// The only way out was a full restart, which throws away the whole lesson.
//
// See EI-001. This test names the game on purpose.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, loadGameFixtures, waitFor } from './helpers/reload.js';

const SLOT_FLAGS = [
    'slot_gravity_ok',
    'slot_power_ok',
    'slot_induction_ok',
    'slot_radio_ok',
    'slot_ac_ok',
    'slot_rel_ok',
];

const fixtures = loadGameFixtures('warp-engine');

/** Reach the warp core with the intro out of the way, as a team would. */
async function reachWarpCore(harness) {
    const { game, ready } = harness.bootDetached();
    await waitFor(() => document.querySelector('.dlg-overlay:not(.hidden)'), { label: 'intro dialog' });
    await game.dialogUI.close();
    await ready;
    await game.goto('warp-core');
    return game;
}

describe('warp-engine: reload during the victory dialog (EI-001)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('has the data this test depends on', () => {
        // If the game is re-authored, this test should say so rather than pass
        // for the wrong reason.
        const event = fixtures.scenes.events.find(e => e.id === 'warp-ready');
        expect(event.once).toBe(true);
        expect(event.then.setFlags).toContain('warp_engine_active');
        expect(event.then.openDialog.id).toBe('warp-core.victory');

        const core = fixtures.scenes.scenes.find(s => s.id === 'warp-core');
        const exitHotspot = core.hotspots.find(h => h.type === 'goTo' && h.target === 'exit');
        expect(exitHotspot.requireFlags).toEqual(['warp_engine_active']);
    });

    it('still lets the team leave the warp core', async () => {
        const harness = createReloadHarness(fixtures, { baseUrl: './games/warp-engine/' });
        const game = await reachWarpCore(harness);

        // Filling the last slot fires "warp-ready", which opens the victory
        // dialog and blocks. Do not await: the team is looking at the dialog.
        game._applyActions({ setFlags: SLOT_FLAGS });
        await waitFor(
            () => game.dialogUI.active?.id === 'warp-core.victory',
            { label: 'victory dialog' },
        );

        // Tablet reloads.
        const reloaded = await harness.reload();

        expect(reloaded.state.scene).toBe('warp-core');
        expect(reloaded.state.eventsFired['warp-ready']).toBe(true);
        expect(reloaded.state.flags.warp_engine_active).toBe(true);

        const exitEl = [...document.querySelectorAll('#hotspotLayer .hotspot')].find(
            el => reloaded.currentScene.hotspots[Number(el.dataset.index)].target === 'exit',
        );
        exitEl.click();
        await waitFor(() => reloaded.state.scene === 'exit', { label: 'exit scene' });

        expect(reloaded.state.scene).toBe('exit');
    });
});
