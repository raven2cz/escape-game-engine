// @vitest-environment node
//
// The dev server is the thing used every day, and the half of it worth testing
// is the half nobody looks at: which requests it refuses. It serves two roots,
// one of them outside this repository, so a request that escapes either of them
// reaches the whole disk.
//
// The rest is the handful of things that only fail on a tablet - Range requests
// for video, MIME types strict enough for module scripts - which is exactly why
// they need a test on a desktop.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
    createDevServer,
    findGames,
    mimeFor,
    parseRange,
    resolveRequest,
} from '../../scripts/dev-server.mjs';

const ENGINE_ROOT = resolve(process.cwd());

let external;
let games;
let server;
let base;

beforeAll(async () => {
    // A second games root, standing in for ../escape-games.
    external = mkdtempSync(join(tmpdir(), 'egs-'));
    mkdirSync(join(external, 'outside-game', 'assets'), { recursive: true });
    writeFileSync(join(external, 'outside-game', 'scenes.json'), JSON.stringify({ meta: { id: 'outside-game' } }));
    writeFileSync(join(external, 'outside-game', 'assets', 'clip.mp4'), Buffer.from('0123456789'));
    // Not a game: no scenes.json.
    mkdirSync(join(external, 'notes'), { recursive: true });
    writeFileSync(join(external, 'notes', 'secret.txt'), 'private');

    ({ games } = findGames([join(ENGINE_ROOT, 'games'), external]));

    server = createDevServer(games);
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise(res => server.close(res));
    rmSync(external, { recursive: true, force: true });
});

describe('which directories count as games', () => {
    it('finds the demo here and a game in the other root', () => {
        expect(games.has('demo')).toBe(true);
        expect(games.has('outside-game')).toBe(true);
    });

    it('does not treat a directory without scenes.json as a game', () => {
        expect(games.has('notes')).toBe(false);
    });

    it('does not treat the test suite as a game', () => {
        expect(games.has('tests')).toBe(false);
    });
});

describe('what the server refuses', () => {
    const refuse = (path, status) => {
        expect(resolveRequest(path, games).status, path).toBe(status);
    };

    it('refuses to climb out of a root', () => {
        refuse('/engine/../package.json', 403);
        refuse('/games/demo/../../package.json', 403);
        // Encoded, which is the version that gets past a naive check: the path
        // is decoded first and only then split.
        refuse('/engine/%2e%2e/package.json', 403);
        refuse('/games/demo/%2E%2E/%2E%2E/.git/config', 403);
    });

    it('refuses anything outside the four mounts', () => {
        refuse('/package.json', 404);
        refuse('/plans/OPEN-ITEMS.md', 404);
        refuse('/.git/config', 404);
        refuse('/games/tests/games.data.test.js', 404);
        refuse('/games/notes/secret.txt', 404);
    });

    it('refuses a game id that is not one', () => {
        refuse('/games/Demo/scenes.json', 404);
        refuse('/games/../scenes.json', 403);
    });

    it('serves no directory listings', () => {
        refuse('/engine/', 404);
        refuse('/games/demo/', 404);
    });

    it('answers a broken percent-escape rather than throwing', () => {
        refuse('/engine/%ZZ', 400);
    });

    it('serves the shell at the root', () => {
        expect(resolveRequest('/', games).file).toBe(join(ENGINE_ROOT, 'index.html'));
        expect(resolveRequest('/index.html', games).file).toBe(join(ENGINE_ROOT, 'index.html'));
    });

    it('reaches a game in the other root', () => {
        const hit = resolveRequest('/games/outside-game/scenes.json', games);
        expect(hit.file.startsWith(external + sep)).toBe(true);
    });
});

describe('MIME types', () => {
    it('serves module scripts as javascript, or the browser refuses them', () => {
        expect(mimeFor('/engine/engine.js')).toBe('text/javascript; charset=utf-8');
    });

    it('serves svg as an image, or the demo has no artwork', () => {
        expect(mimeFor('a/b/hall.svg')).toBe('image/svg+xml');
    });

    it('falls back to octet-stream rather than guessing', () => {
        expect(mimeFor('a/b/thing.unknown')).toBe('application/octet-stream');
        expect(mimeFor('a/b/noextension')).toBe('application/octet-stream');
    });
});

describe('Range requests', () => {
    it('reads the form iOS Safari opens a video with', () => {
        expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    });

    it('reads an open end and a suffix', () => {
        expect(parseRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 });
        expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    });

    it('refuses nonsense rather than serving something wrong', () => {
        expect(parseRange('bytes=9-2', 10)).toBeNull();
        expect(parseRange('bytes=20-30', 10)).toBeNull();
        expect(parseRange('items=0-1', 10)).toBeNull();
        expect(parseRange('', 10)).toBeNull();
    });
});

describe('over an actual socket', () => {
    it('serves the engine with a usable content type', async () => {
        const r = await fetch(`${base}/engine/engine.js`);
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
        expect(r.headers.get('cache-control')).toBe('no-store');
    });

    it('serves a game from the other root', async () => {
        const r = await fetch(`${base}/games/outside-game/scenes.json`);
        expect(r.status).toBe(200);
        expect((await r.json()).meta.id).toBe('outside-game');
    });

    it('answers a Range request with 206, which is what makes video play on iOS', async () => {
        const r = await fetch(`${base}/games/outside-game/assets/clip.mp4`, {
            headers: { Range: 'bytes=0-1' },
        });
        expect(r.status).toBe(206);
        expect(r.headers.get('content-range')).toBe('bytes 0-1/10');
        expect(r.headers.get('accept-ranges')).toBe('bytes');
        expect(await r.text()).toBe('01');
    });

    it('answers an unsatisfiable range with 416', async () => {
        const r = await fetch(`${base}/games/outside-game/assets/clip.mp4`, {
            headers: { Range: 'bytes=99-200' },
        });
        expect(r.status).toBe(416);
    });

    it('refuses to be climbed over the wire', async () => {
        // 404 rather than the 403 that resolveRequest() gives the same string.
        // `new URL()` normalises the path before the server ever sees it, so
        // `%2e%2e` has already collapsed to `..` and resolved to /package.json,
        // which is outside the mounts. Both refuse; the segment check in
        // resolveRequest() is the layer underneath, for the day that
        // normalisation behaves differently.
        for (const path of [
            '/engine/%2e%2e/package.json',
            '/engine/../package.json',
            '/games/demo/../../.git/config',
            '/games/demo/%2E%2E/%2E%2E/package.json',
        ]) {
            const r = await fetch(base + path);
            expect([403, 404], path).toContain(r.status);
            expect(r.status, path).not.toBe(200);
        }
    });

    it('does not serve the repository around the mounts', async () => {
        for (const path of ['/package.json', '/plans/RELEASE.md', '/.git/config', '/games/tests/games.data.test.js']) {
            const r = await fetch(base + path);
            expect(r.status, path).toBe(404);
        }
    });

    it('refuses anything but GET and HEAD', async () => {
        const r = await fetch(`${base}/engine/engine.js`, { method: 'POST' });
        expect(r.status).toBe(405);
    });

    it('answers HEAD with the length and no body', async () => {
        const r = await fetch(`${base}/games/outside-game/assets/clip.mp4`, { method: 'HEAD' });
        expect(r.status).toBe(200);
        expect(r.headers.get('content-length')).toBe('10');
        expect(await r.text()).toBe('');
    });
});
