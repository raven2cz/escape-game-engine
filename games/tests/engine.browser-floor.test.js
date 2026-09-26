// The supported floor is iPadOS / Safari 15.0 (EI-027). Some APIs that look
// ordinary arrived only in 15.4 or later; used anywhere in code that runs on the
// tablet or the teacher's board, they throw on the older half of the floor.
// One slipped into EI-010 (Object.hasOwn in checkReport) and was caught in
// review; this keeps the next one out.

import {describe, it, expect} from 'vitest';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

const ROOTS = ['engine', 'board'];
const NEWER_THAN_FLOOR = [
    [/\bObject\.hasOwn\s*\(/, 'Object.hasOwn (Safari 15.4)'],
    [/\.at\s*\(\s*-?\d/, 'Array/String.prototype.at (Safari 15.4)'],
    [/\bstructuredClone\s*\(/, 'structuredClone (Safari 15.4)'],
    [/\.findLast(Index)?\s*\(/, 'findLast (Safari 15.4)'],
    [/\.to(Sorted|Reversed|Spliced)\s*\(/, 'change-array-by-copy (Safari 16)'],
    [/\.groupBy\s*\(|Object\.groupBy/, 'groupBy (Safari 17.4)'],
    [/\bArray\.fromAsync\s*\(/, 'Array.fromAsync (Safari 16.4)'],
];

const files = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : (/\.(m?js|html)$/.test(name) ? [path] : []);
});

describe('code that runs in the browser stays within the iPadOS 15.0 floor', () => {
    const all = [...ROOTS.flatMap(r => files(join(process.cwd(), r))), join(process.cwd(), 'index.html')];
    it.each(NEWER_THAN_FLOOR.map(([re, what]) => [what, re]))('no %s', (_what, re) => {
        const hits = all.filter(f => re.test(readFileSync(f, 'utf8'))).map(f => f.replace(process.cwd() + '/', ''));
        expect(hits).toEqual([]);
    });
});
