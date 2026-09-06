// @vitest-environment node
//
// version-sync.mjs runs from npm's `version` hook, between npm writing the new
// version into package.json and npm making the commit. Its job is to refuse a
// release that would be wrong, and the refusal only helps if it happens there:
// a check that runs after `npm version` leaves a tag to delete by hand.
//
// So what is tested is the refusing, against a throwaway tree.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncVersion } from '../../scripts/version-sync.mjs';

let root;

const build = ({ version = '1.2.3', engineVersion = '0.0.0', changelog = '## 1.2.3\n' } = {}) => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
    mkdirSync(join(root, 'engine'), { recursive: true });
    writeFileSync(
        join(root, 'engine', 'version.js'),
        `export const ENGINE_VERSION = '${engineVersion}';\nexport const ENGINE_API_VERSION = 1;\n`,
    );
    if (changelog !== null) writeFileSync(join(root, 'CHANGELOG.md'), changelog);
};

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ver-'));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('version-sync', () => {
    it('writes the version into the file the browser reads', () => {
        build();
        const result = syncVersion(root);

        expect(result.ok).toBe(true);
        expect(readFileSync(join(root, 'engine', 'version.js'), 'utf8'))
            .toContain("ENGINE_VERSION = '1.2.3'");
    });

    it('refuses a release with nothing written in the changelog', () => {
        // The entry is written before the tag or it is written never.
        build({ changelog: '# Changelog\n\n## 1.0.0\n' });
        const result = syncVersion(root);

        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain('no "## 1.2.3" section');
    });

    it('refuses a release with no changelog at all', () => {
        build({ changelog: null });
        expect(syncVersion(root).ok).toBe(false);
    });

    it('accepts the changelog heading in either form', () => {
        build({ changelog: '## [1.2.3] - 2026-09-06\n' });
        expect(syncVersion(root).ok).toBe(true);
    });

    it('refuses a version that is not a plain semver', () => {
        // The tag, the tarball name and the manifest all key on this string.
        build({ version: '1.2.3-beta.1' });
        expect(syncVersion(root).ok).toBe(false);
    });

    it('says nothing changed when it is already in step', () => {
        build({ engineVersion: '1.2.3' });
        const result = syncVersion(root);

        expect(result.ok).toBe(true);
        expect(result.changed).toBe(false);
    });

    it('does not write when asked not to', () => {
        build();
        syncVersion(root, { write: false });

        expect(readFileSync(join(root, 'engine', 'version.js'), 'utf8'))
            .toContain("ENGINE_VERSION = '0.0.0'");
    });
});
