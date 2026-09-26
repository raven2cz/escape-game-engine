// engine/dashboard/report.js
//
// The public contract: what a dashboard is told about one run of one team.
// This is the only shape that crosses the wire. It is declared once, here, as a
// schema, and that schema drives both the wire serialisation and the tests, so
// "the report has exactly these fields" is enforced by construction rather than
// by discipline. See docs/DASHBOARD-API.md, which is the prose of this file.
//
// The rule the whole of EI-010 exists for: the engine's internal state is never
// shipped. The projector reads it and builds a report; toWire() then copies the
// report into a fresh, deeply independent plain object, field by declared field,
// coercing each to its declared type. Anything the schema does not name - a
// solution key, a flag, a hero, a back-reference into the state - cannot reach
// the transport, because nothing copies it.

import {ENGINE_API_VERSION} from '../version.js';

/** Version of this contract. Moves when a field is removed or changes meaning, not when one is added. */
export const DASHBOARD_API_VERSION = ENGINE_API_VERSION;

/** Soft target and hard ceiling for one serialised report, in UTF-8 bytes. sendBeacon shares a ~64 KiB queue. */
export const WIRE_TARGET_BYTES = 32 * 1024;
export const WIRE_MAX_BYTES = 48 * 1024;

const STR_MAX = 200;
const LIST_MAX = 500;

// Field types. A schema node is one of these strings, or {obj}, {objOrNull}, {list}.
const T = Object.freeze({
    INT: 'int', INT_OR_NULL: 'int?', STR: 'str', STR_OR_NULL: 'str?', BOOL: 'bool',
});

const PUZZLE_OUTCOME = {obj: {ref: T.STR, attempts: T.INT, mistakes: T.INT, solved: T.BOOL}};

/** The DashboardReport, field by field. The order here is the order on the wire. */
export const REPORT_SCHEMA = Object.freeze({
    obj: {
        api: T.INT,
        game: T.STR,
        gameVersion: T.STR_OR_NULL,
        session: T.STR_OR_NULL,
        team: T.STR_OR_NULL,
        run: T.STR,
        revision: T.INT,
        startedAt: T.INT,
        updatedAt: T.INT,
        completedAt: T.INT_OR_NULL,
        completed: T.BOOL,
        position: {obj: {scene: T.STR_OR_NULL, label: T.STR_OR_NULL, since: T.INT}},
        activity: {objOrNull: {ref: T.STR, label: T.STR_OR_NULL, since: T.INT}},
        progress: {
            obj: {
                scenesVisited: T.INT, scenesTotal: T.INT_OR_NULL,
                puzzlesSolved: T.INT, puzzlesTotal: T.INT_OR_NULL,
            },
        },
        inventory: {list: T.STR},
        itemsUsed: {list: T.STR},
        dialogsSeen: {list: T.STR},
        puzzles: {list: PUZZLE_OUTCOME},
        milestones: {list: T.STR},
        truncated: T.BOOL,
    },
});

const toInt = (v) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};
const toStr = (v) => String(v ?? '').slice(0, STR_MAX);

function coerce(node, value) {
    switch (node) {
        case T.INT: return toInt(value);
        case T.INT_OR_NULL: return value == null ? null : toInt(value);
        case T.STR: return toStr(value);
        case T.STR_OR_NULL: return value == null ? null : toStr(value);
        case T.BOOL: return value === true;
        default: break;
    }
    if (node.obj) return copyObject(node.obj, value);
    if (node.objOrNull) return value == null ? null : copyObject(node.objOrNull, value);
    if (node.list) {
        const src = Array.isArray(value) ? value.slice(0, LIST_MAX) : [];
        return src.map(item => coerce(node.list, item));
    }
    throw new Error('report schema: unknown node');
}

function copyObject(fields, value) {
    const src = value && typeof value === 'object' ? value : {};
    const out = {};
    for (const [key, node] of Object.entries(fields)) out[key] = coerce(node, src[key]);
    return out;
}

/** UTF-8 size of a value's JSON. */
export function wireBytes(value) {
    const json = JSON.stringify(value);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
}

/**
 * The only way a report becomes something a transport may send.
 * Returns a fresh plain object that shares nothing with its input.
 */
export function toWire(report) {
    const wire = coerce(REPORT_SCHEMA, report);
    // Bounded by the game's own size in practice. The ceiling is for a save
    // somebody edited: shed the per-puzzle detail first, it is the largest part
    // and the counts in `progress` still hold, then every other list, halving
    // the longest until the whole report fits.
    const lists = ['puzzles', 'inventory', 'itemsUsed', 'dialogsSeen', 'milestones'];
    while (wireBytes(wire) > WIRE_MAX_BYTES) {
        const longest = wire.puzzles.length ? 'puzzles'
            : lists.reduce((a, b) => (wire[b].length > wire[a].length ? b : a));
        if (!wire[longest].length) break;
        wire[longest].length = Math.floor(wire[longest].length / 2);
        wire.truncated = true;
    }
    return wire;
}

/**
 * Check a value against the schema: exactly the declared keys, at every depth,
 * each of the declared type. For the board, the runtime and the tests.
 * @returns {string[]} problems; empty when the value is a well-formed report
 */
export function checkReport(value, node = REPORT_SCHEMA, path = 'report') {
    const problems = [];
    const typeOk = {
        [T.INT]: v => Number.isInteger(v) && v >= 0,
        [T.INT_OR_NULL]: v => v === null || (Number.isInteger(v) && v >= 0),
        [T.STR]: v => typeof v === 'string',
        [T.STR_OR_NULL]: v => v === null || typeof v === 'string',
        [T.BOOL]: v => typeof v === 'boolean',
    };
    if (typeof node === 'string') {
        if (!typeOk[node](value)) problems.push(`${path} is not ${node}`);
        return problems;
    }
    const fields = node.obj || node.objOrNull;
    if (fields) {
        if (value === null && node.objOrNull) return problems;
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} is not an object`];
        for (const key of Object.keys(value)) {
            if (!(key in fields)) problems.push(`${path}.${key} is not part of the contract`);
        }
        for (const [key, child] of Object.entries(fields)) {
            if (!(key in value)) problems.push(`${path}.${key} is missing`);
            else problems.push(...checkReport(value[key], child, `${path}.${key}`));
        }
        return problems;
    }
    if (node.list) {
        if (!Array.isArray(value)) return [`${path} is not a list`];
        value.forEach((item, i) => problems.push(...checkReport(item, node.list, `${path}[${i}]`)));
    }
    return problems;
}
