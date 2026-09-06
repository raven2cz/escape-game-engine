#!/usr/bin/env node
// scripts/version-sync.mjs
//
// Runs from npm's `version` lifecycle hook, after npm has written the new
// version into package.json and before it makes the commit and the tag.
//
// It does two things and refuses the release if it cannot:
//
//   1. writes the version into engine/version.js, which is the copy the browser
//      can import, so the two cannot drift
//   2. checks CHANGELOG.md has a section for the version being cut
//
// Exiting non-zero here aborts `npm version` before the commit, which is the
// point: a check that runs afterwards leaves a tag to delete by hand.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function syncVersion(root = ROOT, { write = true } = {}) {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const version = pkg.version;
    const problems = [];

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        problems.push(`package.json version "${version}" is not a plain semver`);
    }

    const versionFile = join(root, 'engine', 'version.js');
    const source = readFileSync(versionFile, 'utf8');
    const current = /export const ENGINE_VERSION = '([^']*)'/.exec(source)?.[1];
    if (current === undefined) {
        problems.push('engine/version.js has no ENGINE_VERSION to update');
    }

    let changelog = '';
    try {
        changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    } catch {
        problems.push('CHANGELOG.md is missing');
    }
    // `## 1.2.3` or `## [1.2.3]`, anywhere in the file.
    const heading = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?`, 'm');
    if (changelog && !heading.test(changelog)) {
        problems.push(`CHANGELOG.md has no "## ${version}" section. Write what changed before tagging it.`);
    }

    if (problems.length) return { ok: false, version, problems };

    const updated = source.replace(
        /export const ENGINE_VERSION = '[^']*'/,
        `export const ENGINE_VERSION = '${version}'`,
    );
    if (write && updated !== source) writeFileSync(versionFile, updated, 'utf8');

    return { ok: true, version, changed: updated !== source };
}

function main() {
    const result = syncVersion();
    if (!result.ok) {
        console.error(`\nCannot release ${result.version}:\n`);
        for (const p of result.problems) console.error(`  - ${p}`);
        console.error('\nNothing has been committed or tagged.\n');
        process.exit(1);
    }
    console.log(`engine/version.js ${result.changed ? 'updated to' : 'already at'} ${result.version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
