#!/usr/bin/env node
// scripts/simulate-lesson.mjs
//
// A lesson without a class: simulated teams play a real game and report to the
// dev server's board, so the board can be seen working without thirty tablets.
//
//     npm run dev                                   (one terminal)
//     node scripts/simulate-lesson.mjs --game warp-engine
//     open  http://127.0.0.1:5500/board/?game=warp-engine&session=ukazka&source=http
//
// The reports are real: built by the engine's own projector and toWire() from a
// simulated saved state, so the board receives exactly what tablets would send.
// The route, the tasks and the items come from the game's files; what a team
// does with them is invented. Players are pre-aged (the lesson is already ten
// minutes in), and a few have a part to play: two race to the end, two get
// stuck in a room, two drop off the network. One pupil per tablet, as in class.
//
// Options: --game <id>  --session <s>  --url <dev server>  --games <dir>  --players <n>  --interval <ms>

import {readFileSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCatalogue, puzzleMap} from '../engine/dashboard/catalogue.js';
import {project} from '../engine/dashboard/projector.js';
import {toWire} from '../engine/dashboard/report.js';

const MIN = 60_000;
const PLAYER_NAMES = [
    'Adam', 'Anička', 'Barbora', 'Čeněk', 'David', 'Eliška', 'Filip', 'Gabriela', 'Hynek', 'Ivana',
    'Jakub', 'Kateřina', 'Lukáš', 'Magdaléna', 'Matěj', 'Natálie', 'Ondřej', 'Petra', 'Radek', 'Šárka',
    'Tomáš', 'Tereza', 'Vojtěch', 'Veronika', 'Zdeněk', 'Zuzana', 'Štěpán', 'Klára', 'Marek', 'Lucie',
];
/** Who plays which part: two race ahead, two get stuck, two lose the network. */
const ROLES = {2: 'fast', 13: 'fast', 3: 'stuck', 18: 'stuck', 4: 'dropout', 22: 'dropout'};

/** A small seeded random generator, so a run can be repeated. */
export function seeded(seed = 7) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

/** The route through a game: scenes in file order, with the tasks and items each holds. */
export function planRoute(scenesDoc, catalogue) {
    const tasksByRoot = new Map();
    for (const t of catalogue.tasks || []) {
        let root = t.id;
        let parent = t.parent;
        const byId = new Map(catalogue.tasks.map(x => [x.id, x]));
        while (parent) {
            root = parent;
            parent = byId.get(parent)?.parent ?? null;
        }
        if (!tasksByRoot.has(root)) tasksByRoot.set(root, []);
        tasksByRoot.get(root).push(t.id);
    }
    const itemsIn = (node, out = []) => {
        if (!node || typeof node !== 'object') return out;
        if (Array.isArray(node)) {
            node.forEach(n => itemsIn(n, out));
            return out;
        }
        for (const [k, v] of Object.entries(node)) {
            if (k === 'giveItem') out.push(...(Array.isArray(v) ? v : [v]));
            else if (k === 'itemId' && node.type === 'pickup') out.push(v);
            else itemsIn(v, out);
        }
        return out;
    };
    return (scenesDoc.scenes || []).map(sc => ({
        scene: sc.id,
        end: !!sc.end,
        tasks: (sc.hotspots || [])
            .filter(h => h?.type === 'puzzle')
            .flatMap(h => tasksByRoot.get(h.puzzleRef || h.puzzle?.ref) || []),
        items: [...new Set(itemsIn(sc.hotspots || []))].filter(id => catalogue.items.some(i => i.id === id)),
    })).sort((a, b) => Number(a.end) - Number(b.end)); // the end scene last, wherever the file has it
}

/**
 * A simulated lesson. `step(now)` moves every team that is due and returns the
 * reports of every team still connected.
 */
export function createLesson({scenesDoc, puzzles = null, dialogs = null, session = 'ukazka', players = 30, now = Date.now(), rng = seeded()}) {
    const catalogue = buildCatalogue(scenesDoc, puzzles, {dialogsDoc: dialogs});
    const route = planRoute(scenesDoc, catalogue);
    const flagMilestones = catalogue.milestones.filter(m => m.type === 'flag');
    const game = catalogue.game;

    const makeTeam = (name, i) => {
        const role = ROLES[i] || 'normal';
        const startedAt = now - (8 + Math.floor(rng() * 6)) * MIN;
        const t = {
            name, role,
            speedMs: role === 'fast' ? 3000 : 7000 + Math.floor(rng() * 6000),
            mistakeRate: role === 'stuck' ? 0.85 : 0.25 + rng() * 0.3,
            stepIdx: 0, taskIdx: 0, opened: false, nextAt: now,
            offlineAt: role === 'dropout' ? now + 30_000 + Math.floor(rng() * 30_000) : Infinity,
            state: {inventory: [], solved: {}, flags: {}, visited: {}, scene: route[0].scene},
            progress: {
                run: `sim-${name}-${startedAt}`, revision: 0, seq: 0, startedAt,
                scene: route[0].scene, sceneEnteredAt: startedAt, completedAt: null,
                sceneTime: {}, puzzles: {}, itemsUsed: {}, dialogsSeen: {},
            },
            activity: null,
        };
        t.state.visited[route[0].scene] = true;
        return t;
    };
    const list = PLAYER_NAMES.slice(0, players).map(makeTeam);

    const enter = (t, idx, at) => {
        const leg = route[idx];
        t.stepIdx = idx;
        t.taskIdx = 0;
        t.opened = false;
        t.activity = null;
        t.state.scene = leg.scene;
        t.state.visited[leg.scene] = true;
        t.progress.scene = leg.scene;
        t.progress.sceneEnteredAt = at;
        if (leg.end && t.progress.completedAt == null) t.progress.completedAt = at;
        // Everything collected is spent just before the end, as warp-engine does at the core.
        if (route[idx + 1]?.end) {
            for (const id of t.state.inventory) t.progress.itemsUsed[id] ??= ++t.progress.seq;
            t.state.inventory = [];
        }
    };

    const syncFlags = (t) => {
        // Invented, since the simulator does not run the game's events: flag
        // milestones are reached in declaration order as the team gets on.
        const solved = Object.values(t.progress.puzzles).filter(p => p.solved).length;
        const total = catalogue.totals.tasks || 1;
        const reached = t.progress.completedAt != null || route[t.stepIdx + 1]?.end
            ? flagMilestones.length
            : Math.min(flagMilestones.length - 1, Math.floor((solved / total) * flagMilestones.length));
        flagMilestones.forEach((m, i) => { t.state.flags[m.ref] = i < reached; });
    };

    /** One action: open the next task, answer it, or move on. */
    const act = (t, at) => {
        const leg = route[t.stepIdx];
        if (leg.end) return;
        if (t.role === 'stuck' && leg.tasks.length && Object.keys(t.progress.puzzles).length >= 1) {
            // Stuck on the first task in this room: tries now and then, gets it wrong.
            const ref = leg.tasks[0];
            t.activity ??= {ref, since: at - 9 * MIN};
            const rec = (t.progress.puzzles[ref] ??= {seq: ++t.progress.seq, attempts: 0, mistakes: 0, solved: false});
            if (rng() < 0.3) { rec.attempts++; rec.mistakes++; }
            return;
        }
        if (t.taskIdx < leg.tasks.length) {
            const ref = leg.tasks[t.taskIdx];
            if (!t.opened) {
                t.opened = true;
                t.activity = {ref, since: at};
                return;
            }
            const rec = (t.progress.puzzles[ref] ??= {seq: ++t.progress.seq, attempts: 0, mistakes: 0, solved: false});
            rec.attempts++;
            if (rng() < t.mistakeRate) {
                rec.mistakes++;
                return;
            }
            rec.solved = true;
            t.state.solved[`solved:pz:${ref}`] = true;
            t.activity = null;
            t.opened = false;
            t.taskIdx++;
            return;
        }
        for (const id of leg.items) {
            if (!t.state.inventory.includes(id) && t.progress.itemsUsed[id] == null) t.state.inventory.push(id);
        }
        t.progress.sceneTime[leg.scene] = (t.progress.sceneTime[leg.scene] || 0) + (at - t.progress.sceneEnteredAt);
        enter(t, t.stepIdx + 1, at);
    };

    // Pre-age: the lesson has been going for a while.
    for (const t of list) {
        const warm = t.role === 'fast' ? Math.floor(route.length * 1.6) : t.role === 'stuck' ? 12 : 3 + Math.floor(rng() * 8);
        let at = t.progress.startedAt;
        for (let i = 0; i < warm && !route[t.stepIdx].end; i++) {
            at += Math.floor(20_000 + rng() * 40_000);
            act(t, Math.min(at, now - 5000));
        }
        if (t.role === 'stuck' && route[t.stepIdx].tasks.length === 0) {
            const idx = route.findIndex((leg, i) => i > t.stepIdx && leg.tasks.length);
            if (idx > 0) enter(t, idx, now - 11 * MIN);
        }
        if (t.role === 'stuck') t.progress.sceneEnteredAt = Math.min(t.progress.sceneEnteredAt, now - 11 * MIN);
        syncFlags(t);
    }

    return {
        catalogue,
        route,
        teams: list,
        step(at) {
            const reports = [];
            for (const t of list) {
                if (at >= t.offlineAt) continue;
                if (at >= t.nextAt) {
                    act(t, at);
                    syncFlags(t);
                    t.nextAt = at + t.speedMs * (t.role === 'stuck' ? 3 : 1);
                }
                t.progress.revision++;
                reports.push(toWire(project({
                    state: t.state, progress: t.progress, activity: t.activity, catalogue,
                    identity: {game, gameVersion: catalogue.version, session, team: t.name},
                    now: at, revision: t.progress.revision,
                })));
            }
            return reports;
        },
    };
}

function parseArgs(argv) {
    const o = {game: 'warp-engine', session: 'ukazka', url: 'http://127.0.0.1:5500', games: '../escape-games', players: 30, interval: 2000};
    for (let i = 0; i < argv.length; i += 2) {
        const k = argv[i].replace(/^--/, '');
        if (!(k in o)) throw new Error(`unknown option ${argv[i]}`);
        o[k] = typeof o[k] === 'number' ? Number(argv[i + 1]) : argv[i + 1];
    }
    return o;
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const dir = [join(root, 'games', o.game), join(resolve(root, o.games), o.game)]
        .find(d => { try { readFileSync(join(d, 'scenes.json')); return true; } catch { return false; } });
    if (!dir) throw new Error(`game ${o.game} not found in games/ or ${o.games}`);
    const read = (f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };

    const lesson = createLesson({
        scenesDoc: read('scenes.json'), puzzles: puzzleMap(read('puzzles.json')), dialogs: read('dialogs.json'),
        session: o.session, players: o.players,
    });
    console.log(`Simulating ${lesson.teams.length} players on ${o.game}, lesson "${o.session}", reporting to ${o.url}`);
    console.log(`Board: ${o.url}/board/?game=${o.game}&session=${encodeURIComponent(o.session)}&source=http`);
    console.log(`Play along: ${o.url}/?game=${o.game}&session=${encodeURIComponent(o.session)}&team=Ty&report=http\n`);

    const tick = async () => {
        const reports = lesson.step(Date.now());
        const results = await Promise.all(reports.map(r => fetch(`${o.url}/api/report`, {
            method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(r),
        }).then(res => res.status).catch(() => 'down')));
        const done = lesson.teams.filter(t => t.progress.completedAt != null).length;
        process.stdout.write(`\r${results.every(s => s === 204) ? 'ok ' : 'ERR'} ${reports.length} reporting, ${done} finished   `);
    };
    await tick();
    setInterval(tick, o.interval);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main().catch((e) => {
        console.error(e.message);
        process.exit(1);
    });
}
