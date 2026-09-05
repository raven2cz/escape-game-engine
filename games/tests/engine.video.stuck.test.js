// EI-022: a video must never be the end of the lesson.
//
// _playVideo() resolved on `ended` or `error` and on nothing else. A play() the
// browser refuses was caught, logged, and then waited on forever behind a
// full-screen black overlay. Both warp-engine videos are allowSkip: false, so
// there was not even a button, and the intro one plays on the first tap of the
// game.
//
// This is a tablet problem before it is anything else. iOS refuses playback with
// sound unless the call is close enough to a real touch, refuses it outright in
// Low Power Mode, and a school network can leave a video buffering for as long
// as it likes. So: never assume the video starts. If play() is refused the pupil
// gets a play button, which retries inside a real touch handler, which is what
// iOS wants. If nothing starts at all, a way out appears - even when the author
// asked for no skipping, because an intro nobody can get past is worse than an
// intro somebody skipped.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'ei022', version: '1.0.0' },
    startScene: 'room',
    scenes: [
        { id: 'room', title: 'Room', image: 'scenes/room.jpg', hotspots: [] },
    ],
};

const bootRoom = () => createReloadHarness({ scenes: SCENES }).boot({
    gameOpts: { videoStartTimeoutMs: 30 },
});

const overlay = () => document.querySelector('.video-overlay');
const skipButton = () => document.querySelector('.video-skip');
const playButton = () => document.querySelector('.video-play');
const videoEl = () => document.querySelector('.video-overlay video');

const isHidden = (el) => !el || el.hasAttribute('hidden');

describe('EI-022: a video that will not play', () => {
    beforeEach(() => {
        localStorage.clear();
        window.HTMLVideoElement.prototype.pause = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.querySelectorAll('.video-overlay').forEach(el => el.remove());
    });

    it('offers a play button when the browser refuses to autoplay', async () => {
        // What an iPad does with a video that has sound and no fresh touch, and
        // what any iPad does in Low Power Mode.
        const play = vi.fn().mockRejectedValue(new DOMException('NotAllowedError'));
        window.HTMLVideoElement.prototype.play = play;

        const game = await bootRoom();
        const done = game._playVideo({ src: 'intro.mp4', mode: 'fullscreen', allowSkip: false });

        await waitFor(() => !isHidden(playButton()), { label: 'the play button' });

        // Tapping it retries, and that retry happens inside a real touch
        // handler, which is the only way iOS will allow it.
        play.mockResolvedValue(undefined);
        playButton().click();
        await waitFor(() => play.mock.calls.length >= 2, { label: 'playback to be retried' });

        videoEl().dispatchEvent(new Event('ended'));
        await done;
        expect(overlay()).toBeNull();
    });

    it('offers a way out even when the author asked for no skipping', async () => {
        window.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

        const game = await bootRoom();
        const done = game._playVideo({ src: 'intro.mp4', mode: 'fullscreen', allowSkip: false });

        // The video never reports that it started. A stalled download on a
        // school network looks exactly like this.
        await waitFor(() => !isHidden(skipButton()), { label: 'the escape hatch' });

        skipButton().click();
        await done;
        expect(overlay()).toBeNull();
    });

    it('keeps the escape hatch hidden while the video is actually playing', async () => {
        // allowSkip: false has to still mean something, or the fix is just a
        // way of removing the setting.
        window.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

        const game = await bootRoom();
        const done = game._playVideo({ src: 'intro.mp4', mode: 'fullscreen', allowSkip: false });

        await waitFor(() => videoEl(), { label: 'the video element' });
        videoEl().dispatchEvent(new Event('playing'));
        await new Promise(res => setTimeout(res, 60)); // past the watchdog

        expect(isHidden(skipButton())).toBe(true);
        expect(isHidden(playButton())).toBe(true);

        videoEl().dispatchEvent(new Event('ended'));
        await done;
    });

    it('offers a way out when playback stalls part way through', async () => {
        window.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

        const game = await bootRoom();
        const done = game._playVideo({ src: 'intro.mp4', mode: 'fullscreen', allowSkip: false });

        await waitFor(() => videoEl(), { label: 'the video element' });
        videoEl().dispatchEvent(new Event('playing'));
        expect(isHidden(skipButton())).toBe(true);

        videoEl().dispatchEvent(new Event('stalled'));
        await waitFor(() => !isHidden(skipButton()), { label: 'the escape hatch' });

        skipButton().click();
        await done;
    });

    it('shows the skip button from the start when skipping is allowed', async () => {
        window.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

        const game = await bootRoom();
        const done = game._playVideo({ src: 'outro.mp4', mode: 'fullscreen', allowSkip: true });

        await waitFor(() => skipButton(), { label: 'the skip button' });
        expect(isHidden(skipButton())).toBe(false);

        skipButton().click();
        await done;
    });

    it('does not leave the hotspot layer locked when a video will not start', async () => {
        // The activation lock is held for as long as the action runs. A video
        // that never finishes means no tap works for the rest of the lesson.
        window.HTMLVideoElement.prototype.play = vi.fn().mockRejectedValue(new DOMException('NotAllowedError'));

        const game = await bootRoom();
        const done = game._applyActions({ playVideo: { src: 'intro.mp4', allowSkip: false } });

        await waitFor(() => !isHidden(skipButton()), { label: 'the escape hatch' });
        skipButton().click();
        await done;

        expect(overlay()).toBeNull();
    });
});
