#!/usr/bin/env node
// scripts/dev-server.mjs
//
// Serves the engine from this working tree and games from here *and* from the
// private games repository next door, so a game can be opened and edited without
// copying anything anywhere.
//
//     npm run dev
//     npm run dev -- --games ../escape-games --games ../other-games
//     npm run dev -- --host 0.0.0.0 --port 8080
//
// It is a development server and says so when it starts. No licence check, no
// caching, no compression. What it does have is the handful of things that only
// fail on the device that matters:
//
//   - Range requests, because iOS Safari asks for `bytes=0-1` before it will
//     play a video and refuses a server that answers 200. `python -m
//     http.server` has the same gap, which is why a desktop never showed it.
//   - a fixed MIME table, because a module script served as anything but
//     text/javascript is refused outright, and an .svg served as text is invisible
//   - `--host 0.0.0.0`, because the product runs on tablets and a tablet cannot
//     reach 127.0.0.1
//
// Only four things are reachable: `/`, `/engine/`, `/styles/` and
// `/games/<id>/`. Everything else is 404, including `/plans/`, `/package.json`
// and `/.git/`.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAME_ID = /^[a-z0-9-]+$/;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

export function mimeFor(path) {
    const dot = path.lastIndexOf('.');
    return (dot < 0 ? null : MIME[path.slice(dot).toLowerCase()]) || 'application/octet-stream';
}

/**
 * Every game directory under a root, in the order the roots were given.
 * A directory is a game only if it holds a scenes.json.
 */
export function findGames(roots) {
    const found = new Map(); // id -> {dir, root}
    const shadowed = [];
    for (const root of roots) {
        if (!existsSync(root)) continue;
        for (const name of readdirSync(root)) {
            if (!GAME_ID.test(name)) continue;
            const dir = join(root, name);
            if (!existsSync(join(dir, 'scenes.json'))) continue;
            if (found.has(name)) {
                shadowed.push({ id: name, ignored: dir, used: found.get(name).dir });
                continue;
            }
            found.set(name, { dir, root });
        }
    }
    return { games: found, shadowed };
}

/**
 * Map a request path onto a file, or say why not.
 *
 * Pure, so that the interesting half - refusing to leave a root - can be tested
 * without a socket. Returns `{file}` or `{status}`.
 */
export function resolveRequest(rawPath, games) {
    let pathname;
    try {
        pathname = decodeURIComponent(rawPath);
    } catch {
        return { status: 400 }; // Czech filenames arrive percent-encoded
    }

    if (pathname.includes('\0')) return { status: 400 };
    if (pathname === '/' || pathname === '/index.html') {
        return { file: join(ENGINE_ROOT, 'index.html') };
    }
    if (pathname === '/favicon.ico') return { status: 204 };

    const parts = pathname.split('/').filter(Boolean);
    // Checked after decoding: `%2e%2e` is `..` and would otherwise slip past.
    if (parts.some(p => p === '..' || p === '.')) return { status: 403 };
    if (!parts.length) return { status: 404 };

    let root;
    let rest;
    if (parts[0] === 'engine' || parts[0] === 'styles') {
        root = join(ENGINE_ROOT, parts[0]);
        rest = parts.slice(1);
    } else if (parts[0] === 'games') {
        const id = parts[1];
        if (!id || !GAME_ID.test(id)) return { status: 404 }; // also keeps /games/tests out
        const game = games.get(id);
        if (!game) return { status: 404 };
        root = game.dir;
        rest = parts.slice(2);
    } else {
        return { status: 404 };
    }

    if (!rest.length) return { status: 404 }; // no directory listings

    const file = resolve(root, ...rest);
    // Belt and braces: the traversal check above is on segments, this one is on
    // the resolved path, which also catches a symlink pointing outside.
    if (file !== root && !file.startsWith(root + sep)) return { status: 403 };

    return { file };
}

function send(res, status, headers = {}, body = null) {
    res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
    if (body === null) res.end();
    else res.end(body);
}

/** `bytes=start-end` against a known size, or null if it is unusable. */
export function parseRange(header, size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
    if (!m) return null;
    const [, rawStart, rawEnd] = m;
    if (rawStart === '' && rawEnd === '') return null;

    let start;
    let end;
    if (rawStart === '') {
        // `bytes=-500`: the last 500 bytes.
        const len = Number(rawEnd);
        if (!len) return null;
        start = Math.max(0, size - len);
        end = size - 1;
    } else {
        start = Number(rawStart);
        end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
    return { start, end };
}

export function createDevServer(games) {
    return createServer((req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return send(res, 405, { Allow: 'GET, HEAD' });
        }

        const { pathname } = new URL(req.url, 'http://localhost');
        const hit = resolveRequest(pathname, games);
        if (hit.status) return send(res, hit.status);

        let stat;
        try {
            stat = statSync(hit.file);
        } catch {
            return send(res, 404);
        }
        if (stat.isDirectory()) return send(res, 404);

        const type = mimeFor(hit.file);
        const range = req.headers.range ? parseRange(req.headers.range, stat.size) : null;

        if (req.headers.range && !range) {
            return send(res, 416, { 'Content-Range': `bytes */${stat.size}` });
        }

        if (range) {
            // iOS Safari will not start a video without this.
            res.writeHead(206, {
                'Cache-Control': 'no-store',
                'Content-Type': type,
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
                'Content-Length': range.end - range.start + 1,
            });
            if (req.method === 'HEAD') return res.end();
            return createReadStream(hit.file, { start: range.start, end: range.end }).pipe(res);
        }

        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': type,
            'Accept-Ranges': 'bytes',
            'Content-Length': stat.size,
        });
        if (req.method === 'HEAD') return res.end();
        return createReadStream(hit.file).pipe(res);
    });
}

function parseArgs(argv) {
    const opts = { port: 5500, host: '127.0.0.1', games: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--port') opts.port = Number(argv[++i]);
        else if (a === '--host') opts.host = argv[++i];
        else if (a === '--games') opts.games.push(argv[++i]);
        else if (a === '--help' || a === '-h') opts.help = true;
        else throw new Error(`unknown option: ${a}`);
    }
    return opts;
}

function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        console.error('usage: npm run dev -- [--port 5500] [--host 127.0.0.1] [--games ../escape-games]');
        process.exit(1);
    }
    if (opts.help) {
        console.log('usage: npm run dev -- [--port 5500] [--host 127.0.0.1] [--games <dir>]...');
        console.log('note: without the -- npm eats the options.');
        return;
    }

    // Relative to the engine, not to wherever this was run from.
    const roots = [
        join(ENGINE_ROOT, 'games'),
        ...(opts.games.length ? opts.games : ['../escape-games']).map(g => resolve(ENGINE_ROOT, g)),
    ];

    const { games, shadowed } = findGames(roots);

    console.log('escape-game-engine dev server — no licence check, no caching. Not for production.\n');
    for (const root of roots) {
        const here = [...games.entries()].filter(([, g]) => g.root === root).map(([id]) => id);
        const label = existsSync(root) ? (here.join(', ') || '(no games)') : 'not present';
        console.log(`  ${root}\n    ${label}`);
    }
    for (const s of shadowed) {
        console.log(`  ! "${s.id}" also in ${s.ignored} — ignored, using ${s.used}`);
    }

    const server = createDevServer(games);
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\nport ${opts.port} is already in use. Try --port 5501.`);
            process.exit(1);
        }
        console.error(`\n${err.message}`);
        process.exit(1);
    });

    server.listen(opts.port, opts.host, () => {
        const shown = opts.host === '0.0.0.0' ? lanAddress() : opts.host;
        console.log(`\n  http://${shown}:${opts.port}/?game=demo`);
        if (opts.host !== '0.0.0.0') {
            console.log('  (--host 0.0.0.0 to open it on a tablet)');
        }
    });
}

function lanAddress() {
    // Best effort: the first non-internal IPv4, which is what a tablet on the
    // same wifi can reach.
    try {
        const nets = Object.values(networkInterfaces()).flat();
        return nets.find(n => n && n.family === 'IPv4' && !n.internal)?.address || '0.0.0.0';
    } catch {
        return '0.0.0.0';
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main();
}
