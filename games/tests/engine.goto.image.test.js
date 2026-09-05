// EI-003: goto() must not hang, and must not record a scene it could not show.
//
// Three separate problems in six lines:
//   1. _saveState() ran before the image was known to load, so a scene that
//      cannot be displayed was recorded as the current one and the pupil landed
//      back in it after a reload.
//   2. The promise resolved only on `onload`. No onerror, no timeout, so a 404
//      or a stalled request never resolved and goto() never returned. No
//      hotspots, no scene events, nothing further saved.
//   3. `this.sceneImage.onload = ...` assigns rather than adds, so a second
//      navigation stole the first one's handler and the first never settled.
//
// School networks lose requests, so all three are ordinary Tuesday afternoon.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'ei003', version: '1.0.0' },
    startScene: 'hall',
    scenes: [
        {
            id: 'hall',
            title: 'Hall',
            image: 'scenes/hall.jpg',
            hotspots: [
                { type: 'goTo', target: 'broken', rect: { x: 1, y: 1, w: 5, h: 5 } },
                { type: 'goTo', target: 'library', rect: { x: 10, y: 1, w: 5, h: 5 } },
            ],
        },
        {
            id: 'broken',
            title: 'Broken',
            image: 'scenes/missing.jpg',
            hotspots: [
                { type: 'goTo', target: 'hall', rect: { x: 1, y: 1, w: 5, h: 5 } },
            ],
        },
        { id: 'library', title: 'Library', image: 'scenes/library.jpg', hotspots: [] },
        { id: 'attic', title: 'Attic', image: 'scenes/attic.jpg', hotspots: [] },
    ],
};

/**
 * Take over image loading for this file. The shared setup fires `load` on every
 * src assignment, which is what most tests want and is exactly what a test about
 * a failing or stalled image must not have.
 */
function takeOverImageLoading() {
    const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const pending = [];

    Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        get() { return this.getAttribute('src') || ''; },
        set(value) {
            this.setAttribute('src', value);
            pending.push({ el: this, src: value });
        },
    });

    return {
        pending,
        /** Fire `type` on the pending request whose src contains `match`. */
        settle(match, type = 'load') {
            const i = pending.findIndex(p => p.src.includes(match));
            if (i < 0) throw new Error(`no pending image request matching ${match}`);
            const [req] = pending.splice(i, 1);
            req.el.dispatchEvent(new Event(type));
        },
        waitForRequest(match) {
            return waitFor(
                () => pending.some(p => p.src.includes(match)),
                { label: `image request for ${match}` },
            );
        },
        restore() {
            Object.defineProperty(HTMLImageElement.prototype, 'src', original);
        },
    };
}

describe('EI-003: goto() and the scene image', () => {
    let img;

    beforeEach(() => {
        localStorage.clear();
        img = takeOverImageLoading();
    });

    afterEach(() => {
        img.restore();
    });

    it('finishes and renders hotspots when the image 404s', async () => {
        const harness = createReloadHarness({ scenes: SCENES });

        const { game, ready } = harness.bootDetached();
        await img.waitForRequest('hall.jpg');
        img.settle('hall.jpg');
        await ready;

        const done = game.goto('broken');
        await img.waitForRequest('missing.jpg');
        img.settle('missing.jpg', 'error');
        await done;

        expect(game.currentScene.id).toBe('broken');
        expect(document.querySelectorAll('#hotspotLayer .hotspot')).toHaveLength(1);
    });

    it('finishes within the timeout when the image never answers', async () => {
        const harness = createReloadHarness({ scenes: SCENES });

        const { game, ready } = harness.bootDetached({ gameOpts: { sceneImageTimeoutMs: 50 } });
        await img.waitForRequest('hall.jpg');
        img.settle('hall.jpg');
        await ready;

        // Nothing is ever fired for this one. A stalled request on a school
        // network looks exactly like this.
        await game.goto('broken');

        expect(game.currentScene.id).toBe('broken');
        expect(document.querySelectorAll('#hotspotLayer .hotspot')).toHaveLength(1);
    });

    it('does not record a scene it could not show', async () => {
        const harness = createReloadHarness({ scenes: SCENES });

        const { game, ready } = harness.bootDetached();
        await img.waitForRequest('hall.jpg');
        img.settle('hall.jpg');
        await ready;

        const done = game.goto('broken');
        await img.waitForRequest('missing.jpg');
        img.settle('missing.jpg', 'error');
        await done;

        // In memory the pupil is in the broken scene and can navigate out of it.
        // Storage still points at the last scene that actually displayed, so a
        // reload does not drop them straight back into the same dead end.
        expect(game.currentScene.id).toBe('broken');
        expect(game._loadState().scene).toBe('hall');
    });

    it('settles both of two navigations in a row, and the later one wins', async () => {
        // The first navigation's handler used to be overwritten by the second,
        // so whoever awaited the first waited forever.
        const harness = createReloadHarness({ scenes: SCENES });

        const { game, ready } = harness.bootDetached();
        await img.waitForRequest('hall.jpg');
        img.settle('hall.jpg');
        await ready;

        let firstSettled = false;
        let secondSettled = false;
        const first = game.goto('library').then(() => { firstSettled = true; });
        await img.waitForRequest('library.jpg');
        const second = game.goto('attic').then(() => { secondSettled = true; });
        await img.waitForRequest('attic.jpg');

        // There is one <img>, so a browser aborts the first request and fires
        // one load event, for the second. The first navigation still has to
        // settle rather than wait for an event that is never coming.
        img.settle('attic.jpg');
        await waitFor(() => firstSettled && secondSettled, { label: 'both navigations to settle' });
        await Promise.all([first, second]);

        expect(game.currentScene.id).toBe('attic');
        expect(game.sceneImage.getAttribute('src')).toContain('attic.jpg');
    });
});
