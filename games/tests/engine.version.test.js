// @vitest-environment node
//
// The engine's version has to live in two places: package.json, which is what
// npm and the release workflow read, and engine/version.js, which is what the
// browser can import without a build step. Two places means they can disagree,
// and a tarball whose contents claim a different version than its name is the
// kind of thing nobody notices until they are trying to reproduce a bug.
//
// scripts/version-sync.mjs writes the second from the first during `npm
// version`. This test is what makes that the only way it happens.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, ENGINE_API_VERSION } from '../../engine/version.js';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

describe('engine version', () => {
    it('matches package.json', () => {
        expect(ENGINE_VERSION).toBe(pkg.version);
    });

    it('looks like a version', () => {
        expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('reports an API version the dashboard can compare', () => {
        // An integer, so that "newer than I understand" is a comparison and not
        // a string parse.
        expect(Number.isInteger(ENGINE_API_VERSION)).toBe(true);
        expect(ENGINE_API_VERSION).toBeGreaterThan(0);
    });
});
