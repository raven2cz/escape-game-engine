// videoBlob: the hosted runtime's server cannot answer byte ranges cheaply
// (Safari streams a video by asking for pieces from the middle of the file, and
// each costs more CPU than the free plan allows), so the engine downloads each
// video whole, in the background, and plays it from memory.

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {boot} from '../../engine/boot.js';

const SCENES = {
    meta: {id: 'vb', version: '1.0.0', saveVersion: 1},
    startScene: 'room',
    scenes: [{
        id: 'room', title: 'Místnost', image: 'scenes/room.jpg',
        hotspots: [{id: 'h', rect: {x: 0, y: 0, w: 10, h: 10}, onApply: {playVideo: {src: 'assets/video/intro.mp4'}}}],
    }],
    events: [{id: 'e', when: {on: 'stateChange', requireFlags: ['never']}, then: {playVideo: {src: 'assets/video/outro.mp4'}}, once: true}],
};

let requested;
let release;
beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    requested = [];
    release = {};
    vi.stubGlobal('fetch', (url) => {
        const name = String(url).split('?')[0].split('/').pop();
        if (name === 'scenes.json') return Promise.resolve({ok: true, json: async () => structuredClone(SCENES)});
        if (name.endsWith('.mp4')) {
            requested.push(name);
            return new Promise((resolve) => {
                release[name] = (ok = true) => resolve({ok, blob: async () => new Blob([name])});
            });
        }
        return Promise.resolve({ok: false, status: 404, json: async () => ({})});
    });
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:vb/${++n}`);
    URL.revokeObjectURL = vi.fn();
    window.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue();
    window.HTMLVideoElement.prototype.pause = vi.fn();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const flush = () => new Promise(r => setTimeout(r, 0));
const video = () => document.querySelector('.video-overlay video');

describe('videoBlob', () => {
    it('downloads the videos one at a time, in the order the game lists them', async () => {
        const game = await boot({gameId: 'vb', baseUrl: './g/', videoBlob: true});
        await flush();
        expect(requested).toEqual(['intro.mp4']);
        release['intro.mp4']();
        await flush(); await flush();
        expect(requested).toEqual(['intro.mp4', 'outro.mp4']);
    });

    it('plays a downloaded video from memory and gives the memory back afterwards', async () => {
        const game = await boot({gameId: 'vb', baseUrl: './g/', videoBlob: true});
        release['intro.mp4']();
        await flush(); await flush();
        const done = game._playVideo({src: 'assets/video/intro.mp4'});
        // Synchronously, as close to the pupil's tap as a stream would start (iOS).
        expect(video().getAttribute('src')).toBe('blob:vb/1');
        expect(window.HTMLVideoElement.prototype.play).toHaveBeenCalledTimes(1);
        video().dispatchEvent(new Event('ended'));
        await done;
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:vb/1');
    });

    it('a video still downloading starts when it arrives; a failed download streams instead', async () => {
        const game = await boot({gameId: 'vb', baseUrl: './g/', videoBlob: true});
        const done = game._playVideo({src: 'assets/video/intro.mp4'});
        await vi.waitFor(() => expect(video()).not.toBeNull());
        expect(video().getAttribute('src')).toBeNull();
        release['intro.mp4'](false);
        await vi.waitFor(() => expect(video().getAttribute('src')).toMatch(/assets\/video\/intro\.mp4$/));
        video().dispatchEvent(new Event('ended'));
        await done;
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('without it nothing is downloaded and the video streams, as before', async () => {
        const game = await boot({gameId: 'vb', baseUrl: './g/'});
        await flush();
        game._playVideo({src: 'assets/video/intro.mp4'});
        await vi.waitFor(() => expect(video()).not.toBeNull());
        expect(video().getAttribute('src')).toMatch(/assets\/video\/intro\.mp4$/);
        expect(requested.filter(n => n === 'intro.mp4')).toEqual([]);
    });
});
