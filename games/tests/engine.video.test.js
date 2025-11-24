import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

function mountDom() {
    document.body.innerHTML = `
    <main id="gameRoot">
      <div id="sceneContainer">
        <img id="sceneImage" alt="scene">
        <div id="hotspotLayer"></div>
      </div>
      <section id="uiBar">
        <div id="inventory"></div>
        <div id="msg"></div>
      </section>
      <div id="modal" class="hidden">
        <div id="modalTitle"></div>
        <div id="modalBody"></div>
        <button id="modalCancel">X</button>
        <button id="modalOk">OK</button>
      </div>
    </main>`;
}

describe('Engine: Video Playback', () => {
    beforeEach(() => {
        mountDom();
        // Mock HTMLVideoElement methods since JSDOM doesn't implement playback
        window.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue();
        window.HTMLVideoElement.prototype.pause = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('creates video overlay, waits for end, and removes overlay', async () => {
        const game = new Game({
            baseUrl: './',
            scenesUrl: 'scenes.json',
            lang: 'cs',
            i18n: { engine:{}, game:{} },
            sceneImage: document.getElementById('sceneImage'),
            hotspotLayer: document.getElementById('hotspotLayer'),
            inventoryRoot: document.getElementById('inventory'),
            messageBox: document.getElementById('msg'),
            modalRoot: document.getElementById('modal'),
            modalTitle: document.getElementById('modalTitle'),
            modalBody: document.getElementById('modalBody'),
            modalCancel: document.getElementById('modalCancel'),
            modalOk: document.getElementById('modalOk'),
        });

        // Start video playback
        const videoPromise = game._playVideo({
            src: 'test.mp4',
            mode: 'fullscreen',
            delay: 0,
            allowSkip: true
        });

        // Check if overlay is created
        const overlay = document.querySelector('.video-overlay');
        expect(overlay).toBeTruthy();
        expect(overlay.classList.contains('mode-fullscreen')).toBe(true);

        const videoEl = overlay.querySelector('video');
        expect(videoEl).toBeTruthy();

        // FIX: Engine resolves relative paths with baseUrl ('./') -> './test.mp4'
        expect(videoEl.getAttribute('src')).toBe('./test.mp4');

        expect(videoEl.play).toHaveBeenCalled();

        // Simulate "ended" event to resolve the promise
        videoEl.dispatchEvent(new Event('ended'));

        await videoPromise;

        // Overlay should be removed
        expect(document.querySelector('.video-overlay')).toBeNull();
    });

    it('allows skipping via button', async () => {
        const game = new Game({
            baseUrl: './', scenesUrl: 's.json', lang: 'cs',
            i18n: { engine:{}, game:{} },
            sceneImage: document.getElementById('sceneImage'),
            hotspotLayer: document.getElementById('hotspotLayer'),
            inventoryRoot: document.getElementById('inventory'),
            messageBox: document.getElementById('msg'),
            modalRoot: document.getElementById('modal'),
            modalTitle: document.getElementById('modalTitle'),
            modalBody: document.getElementById('modalBody'),
            modalCancel: document.getElementById('modalCancel'),
            modalOk: document.getElementById('modalOk'),
        });

        const videoPromise = game._playVideo({
            src: 'test.mp4',
            mode: 'fullscreen',
            delay: 0,
            allowSkip: true
        });

        const skipBtn = document.querySelector('.video-skip');
        expect(skipBtn).toBeTruthy();

        skipBtn.click();

        await videoPromise;
        expect(document.querySelector('.video-overlay')).toBeNull();
    });
});
