// EI-018: the README documented an API the engine does not have.
//
// It described `onEnter`/`onExit`, action bundles as arrays, a `delay` action,
// `consumeItem`, `missingMessage`, hotspot types `inspect` and `onUse`,
// `goTo.scene` where the engine reads `target`, `puzzle.ref` where it reads
// `puzzleRef`, item `name`/`image`/`description` where it reads
// `label`/`icon`/`meta.description`, dialog `steps`/`side` where it reads
// `sequence`/`speaker`, and `setHero({...})` where it takes an id.
//
// None of that produces an error. The engine reads the field it knows, finds
// nothing, and does nothing, so whoever authors a game in the new private
// repository by following the README gets content that is silently ignored.
// That is what these tests are for: not to prove the prose is good, but to stop
// the examples drifting away from the code again.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.idea', 'assets']);

/** Every file name in the repository, for checking the documented tree. */
const allRepoFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
        return SKIP_DIRS.has(entry.name) ? [] : allRepoFiles(join(dir, entry.name));
    }
    return [entry.name];
});

const README = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
const ENGINE = readFileSync(join(process.cwd(), 'engine', 'engine.js'), 'utf8');

/** Every fenced ```json block, with its line number for a useful failure. */
const jsonBlocks = () => {
    const blocks = [];
    const lines = README.split('\n');
    let start = -1;
    lines.forEach((line, i) => {
        if (start < 0 && line.trim() === '```json') {
            start = i;
        } else if (start >= 0 && line.trim() === '```') {
            blocks.push({ line: start + 1, source: lines.slice(start + 1, i).join('\n') });
            start = -1;
        }
    });
    return blocks;
};

// Field names the engine does not read, and what it reads instead. A name here
// must never appear in a JSON example.
const RETIRED = [
    ['"onEnter"', 'scenes have no onEnter; use an event with "on": "enterScene"'],
    ['"onExit"', 'there is no onExit at all'],
    ['"onUse"', 'a hotspot accepts items through acceptItems + onApply'],
    ['"consumeItem"', 'consumption is { "id": "…", "consume": true } inside acceptItems'],
    ['"missingMessage"', 'the unmet-requirement message comes from engine i18n'],
    ['"steps"', 'a dialog\'s lines are in "sequence"'],
    ['"side"', 'a dialog step names its speaker with "speaker"'],
    ['"delay": 1000', 'there is no delay action; playVideo has its own delay'],
];

describe('README documents the engine that exists', () => {
    it('has JSON examples that are actually JSON', () => {
        // An example nobody can paste is worse than no example.
        for (const { line, source } of jsonBlocks()) {
            if (source.includes('…')) continue; // deliberate elision
            expect(() => JSON.parse(source), `README.md:${line}`).not.toThrow();
        }
    });

    it('does not document fields the engine ignores', () => {
        const offenders = [];
        for (const { line, source } of jsonBlocks()) {
            for (const [needle, why] of RETIRED) {
                if (source.includes(needle)) offenders.push(`README.md:${line}: ${needle} — ${why}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('names hotspot destinations and puzzles the way the engine reads them', () => {
        // The two that cost the most: a goTo with "scene" navigates nowhere, and
        // a puzzle hotspot with "ref" logs an error and opens nothing.
        const offenders = [];
        for (const { line, source } of jsonBlocks()) {
            let data;
            try {
                data = JSON.parse(source);
            } catch {
                continue;
            }
            const walk = (node) => {
                if (Array.isArray(node)) return node.forEach(walk);
                if (!node || typeof node !== 'object') return;
                if (node.type === 'goTo' && !node.target) {
                    offenders.push(`README.md:${line}: goTo hotspot without "target"`);
                }
                if (node.type === 'puzzle' && !node.puzzleRef) {
                    offenders.push(`README.md:${line}: puzzle hotspot without "puzzleRef"`);
                }
                Object.values(node).forEach(walk);
            };
            walk(data);
        }
        expect(offenders).toEqual([]);
    });

    it('only documents hotspot types the engine implements', () => {
        // Read the list out of the engine rather than repeating it here, so that
        // adding a type does not need this test edited.
        const implemented = new Set(
            [...ENGINE.matchAll(/h\.type === '([a-zA-Z]+)'/g)].map(m => m[1]),
        );
        expect(implemented.size).toBeGreaterThan(0);

        const documented = new Set(
            [...README.matchAll(/"type"\s*:\s*"([a-zA-Z]+)"/g)].map(m => m[1]),
        );

        for (const type of documented) {
            expect(implemented, `hotspot type "${type}" in README`).toContain(type);
        }
    });

    it('describes a project structure whose files exist', () => {
        // The tree listed the puzzle kinds one directory too high and named a
        // file that has since been deleted. Nobody notices a wrong map until
        // they follow it.
        const tree = README.split('```')[1] || '';
        const names = [...tree.matchAll(/[├└]──\s+([A-Za-z0-9._-]+\.[a-z]+)/g)].map(m => m[1]);
        expect(names.length).toBeGreaterThan(10);

        const known = new Set(allRepoFiles(process.cwd()));
        for (const name of names) {
            expect(known, `README project structure names ${name}`).toContain(name);
        }
    });

    it('does not show setHero being given an object', () => {
        // setHero(id). The old example passed { id, heroId, heroName, heroBase },
        // none of which the engine looks at.
        expect(README).not.toMatch(/setHero\(\s*\{/);
    });
});
