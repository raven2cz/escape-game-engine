#!/usr/bin/env node
// scripts/version-sync.mjs
//
// Runs from npm's `version` lifecycle hook, after npm has written the new
// version into package.json and before it makes the commit and the tag.
//
// Two modes, because npm gives two chances and only the first one is clean.
//
//   --check   from `preversion`, before npm has touched anything. Verifies there
//             is a `## Unreleased` section with something written under it. A
//             failure here leaves the repository exactly as it was.
//
//   (default) from `version`, after npm has written the new version into
//             package.json. Renames `## Unreleased` to `## <version>` and writes
//             the version into engine/version.js, which is the copy the browser
//             can import.
//
// The check cannot ask about the new version in `preversion`, because npm has
// not computed it yet - which is why the changelog is written under `Unreleased`
// and renamed rather than written under a number somebody has to predict.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const UNRELEASED = /^##\s+Unreleased\s*$/m;

/** Is there an `## Unreleased` heading with something written under it? */
export function checkUnreleased(root = ROOT) {
    let changelog;
    try {
        changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    } catch {
        return { ok: false, problems: ['CHANGELOG.md is missing'] };
    }

    const at = changelog.search(UNRELEASED);
    if (at < 0) {
        return {
            ok: false,
            problems: ['CHANGELOG.md has no "## Unreleased" section. Write what changed, commit it, then release.'],
        };
    }

    const after = changelog.slice(at).split('\n').slice(1);
    const next = after.findIndex(l => /^##\s/.test(l));
    const body = (next < 0 ? after : after.slice(0, next)).join('\n').trim();
    if (!body) {
        return { ok: false, problems: ['"## Unreleased" in CHANGELOG.md is empty. Say what changed.'] };
    }

    return { ok: true, problems: [] };
}

export function syncVersion(root = ROOT, { write = true } = {}) {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const version = pkg.version;
    const problems = [];

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        problems.push(`package.json version "${version}" is not a plain semver`);
    }

    const versionFile = join(root, 'engine', 'version.js');
    const source = readFileSync(versionFile, 'utf8');
    if (!/export const ENGINE_VERSION = '([^']*)'/.test(source)) {
        problems.push('engine/version.js has no ENGINE_VERSION to update');
    }

    const changelogFile = join(root, 'CHANGELOG.md');
    let changelog = '';
    try {
        changelog = readFileSync(changelogFile, 'utf8');
    } catch {
        problems.push('CHANGELOG.md is missing');
    }
    const heading = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?`, 'm');
    const hasUnreleased = UNRELEASED.test(changelog);
    if (changelog && !hasUnreleased && !heading.test(changelog)) {
        problems.push(`CHANGELOG.md has neither "## Unreleased" nor "## ${version}".`);
    }

    if (problems.length) return { ok: false, version, problems };

    const updatedSource = source.replace(
        /export const ENGINE_VERSION = '[^']*'/,
        `export const ENGINE_VERSION = '${version}'`,
    );
    // `## Unreleased` becomes `## <version>`: the entry is written while the
    // change is fresh and given its number here, so nobody has to predict it.
    const updatedChangelog = hasUnreleased
        ? changelog.replace(UNRELEASED, `## ${version}`)
        : changelog;

    if (write) {
        if (updatedSource !== source) writeFileSync(versionFile, updatedSource, 'utf8');
        if (updatedChangelog !== changelog) writeFileSync(changelogFile, updatedChangelog, 'utf8');
    }

    return { ok: true, version, changed: updatedSource !== source, renamedChangelog: hasUnreleased };
}

function main() {
    if (process.argv.includes('--check')) {
        const result = checkUnreleased();
        if (!result.ok) {
            console.error('\nCannot start a release:\n');
            for (const p of result.problems) console.error(`  - ${p}`);
            console.error('\nNothing has been changed.\n');
            process.exit(1);
        }
        return;
    }

    const result = syncVersion();
    if (!result.ok) {
        console.error(`\nCannot release ${result.version}:\n`);
        for (const p of result.problems) console.error(`  - ${p}`);
        console.error(
            '\nNo commit and no tag were made, but npm has already bumped package.json.\n' +
            'Undo it with:  git checkout package.json package-lock.json\n',
        );
        process.exit(1);
    }
    console.log(`engine/version.js ${result.changed ? 'updated to' : 'already at'} ${result.version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
