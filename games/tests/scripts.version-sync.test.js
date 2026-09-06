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
import { checkUnreleased, syncVersion } from '../../scripts/version-sync.mjs';

let root;

const build = ({ version = '1.2.3', engineVersion = '0.0.0', changelog = '## Unreleased\n\n- something\n' } = {}) => {
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

    it('gives the Unreleased section its number', () => {
        // Written under Unreleased while the change is fresh, numbered here, so
        // nobody has to predict what npm will call it.
        build();
        syncVersion(root);

        const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
        expect(changelog).toContain('## 1.2.3');
        expect(changelog).not.toContain('## Unreleased');
        expect(changelog).toContain('- something');
    });

    it('refuses to start a release with nothing written down', () => {
        // This runs in `preversion`, before npm has touched anything, so the
        // repository is left exactly as it was rather than half-bumped.
        build({ changelog: '# Changelog\n\n## 1.0.0\n\n- old news\n' });
        const result = checkUnreleased(root);

        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain('no "## Unreleased" section');
    });

    it('refuses an Unreleased section with nothing under it', () => {
        build({ changelog: '# Changelog\n\n## Unreleased\n\n## 1.0.0\n\n- old news\n' });
        const result = checkUnreleased(root);

        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain('is empty');
    });

    it('refuses a release with no changelog at all', () => {
        build({ changelog: null });
        expect(checkUnreleased(root).ok).toBe(false);
        expect(syncVersion(root).ok).toBe(false);
    });

    it('accepts a changelog that already names the version', () => {
        build({ changelog: '## [1.2.3] - 2026-09-06\n\n- done\n' });
        expect(syncVersion(root).ok).toBe(true);
    });

    it('refuses a version that is not a plain semver', () => {
        // The tag, the tarball name and the manifest all key on this string.
        build({ version: '1.2.3-beta.1' });
        expect(syncVersion(root).ok).toBe(false);
    });

    it('says nothing changed when it is already in step', () => {
        build({ engineVersion: '1.2.3', changelog: '## 1.2.3\n\n- done\n' });
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
