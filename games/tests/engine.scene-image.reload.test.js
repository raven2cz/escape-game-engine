// EI-006: a scene image changed by an event must still be changed after a
// reload.
//
// The handler mutated `sc.image` on the in-memory `this.data` and nothing else.
// Because the event that makes the change is `once`, it never ran again, so the
// world contradicted itself: in leeuwenhoek the chest was shut again although
// `chest_opened` was set and the golden key was in the inventory.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, loadGameFixtures, waitFor } from './helpers/reload.js';

const OPENED = './games/leeuwenhoek/assets/treasure-room-opened.jpg';
const CLOSED = './games/leeuwenhoek/assets/treasure-room.jpg';

const fixtures = loadGameFixtures('leeuwenhoek');

/** Open the chest in the treasure room, the way the game does it. */
async function openTheChest(harness) {
    const { game, ready } = harness.bootDetached();
    await waitFor(() => document.querySelector('.dlg-overlay:not(.hidden)'), { label: 'intro dialog' });
    await game.dialogUI.close();
    await ready;

    await game.goto('treasure-room');
    await game._applyActions({ setFlags: ['chest_opened'] });
    return game;
}

describe('leeuwenhoek: the opened chest survives a reload (EI-006)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('has the data this test depends on', () => {
        const event = fixtures.scenes.events.find(e => e.id === 'treasure-opened-visual');
        expect(event.once).toBe(true);
        expect(event.when.requireFlags).toContain('chest_opened');
        expect(event.then.setSceneImage).toEqual({
            sceneId: 'treasure-room',
            image: 'assets/treasure-room-opened.jpg',
        });
    });

    it('shows the opened chest straight away', async () => {
        const harness = createReloadHarness(fixtures, { baseUrl: './games/leeuwenhoek/' });
        const game = await openTheChest(harness);

        expect(game.sceneImage.getAttribute('src')).toBe(OPENED);
    });

    it('still shows the opened chest after a reload', async () => {
        const harness = createReloadHarness(fixtures, { baseUrl: './games/leeuwenhoek/' });
        await openTheChest(harness);

        const reloaded = await harness.reload();

        expect(reloaded.state.scene).toBe('treasure-room');
        expect(reloaded.sceneImage.getAttribute('src')).toBe(OPENED);
    });

    it('still shows it after leaving the room and coming back', async () => {
        // Not the same test: goto() is the path that reads the image, and a
        // reload restores through goto() as well. This one proves the override
        // is not only applied to the scene that happened to be on screen.
        const harness = createReloadHarness(fixtures, { baseUrl: './games/leeuwenhoek/' });
        await openTheChest(harness);

        const reloaded = await harness.reload();
        await reloaded.goto('title');
        expect(reloaded.sceneImage.getAttribute('src')).toBe('./games/leeuwenhoek/assets/title.jpg');

        await reloaded.goto('treasure-room');
        expect(reloaded.sceneImage.getAttribute('src')).toBe(OPENED);
    });

    it('leaves an untouched scene alone', async () => {
        const harness = createReloadHarness(fixtures, { baseUrl: './games/leeuwenhoek/' });
        const { game, ready } = harness.bootDetached();
        await waitFor(() => document.querySelector('.dlg-overlay:not(.hidden)'), { label: 'intro dialog' });
        await game.dialogUI.close();
        await ready;

        await game.goto('treasure-room');
        expect(game.sceneImage.getAttribute('src')).toBe(CLOSED);

        const reloaded = await harness.reload();
        expect(reloaded.sceneImage.getAttribute('src')).toBe(CLOSED);
    });
});
