// The last thing standing between an unsupported tablet and a blank screen.
//
// The engine's minimum is iPadOS 15 (EI-027). An older iPad cannot parse the
// module in `index.html` - it fails on syntax, silently, before a single line of
// engine code runs - so nothing in `engine/` can ever report it. The page just
// stays blank, and a teacher with thirty children and a blank tablet has nothing
// to act on.
//
// So the shell says something itself, from a classic ES5 script that the same
// old browser *can* parse. This file is what stops that script from quietly
// becoming unparseable too: the failure mode is invisible in every browser we
// develop on, because on those it never runs at all.
//
// The hosted runtime generates its own HTML and must carry the same block. When
// it exists, its shell belongs in the fixture list below.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** The classic scripts, in document order: `<script>` with no `type`. */
const classicScripts = (html) =>
    [...html.matchAll(/<script(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);

/** Strip comments, so that prose about the syntax is not mistaken for it. Safe
 *  on this script and only this script: no regex literals, no strings holding a
 *  slash pair. */
const code = (script) => script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the loading shell in index.html', () => {
    it('shows something before any JavaScript has run', () => {
        // Static HTML, so it is on screen even if every script fails.
        expect(HTML).toMatch(/<div id="boot-status">[^<]*\S[^<]*<\/div>/);
    });

    it('runs its fallback before the module, not after', () => {
        // Order matters: a module script is deferred to the end of parsing, and
        // on the browsers this is for it is never executed at all. The classic
        // script has to have started its timer by then.
        const classic = HTML.search(/<script(?![^>]*\btype=)[^>]*>/i);
        const module = HTML.search(/<script[^>]*\btype="module"/i);
        expect(classic).toBeGreaterThan(-1);
        expect(module).toBeGreaterThan(-1);
        expect(classic).toBeLessThan(module);
    });

    it('does not use `nomodule` as the detector', () => {
        // The tempting attribute, and the wrong one: Safari 12 understands
        // modules, so it suppresses a `nomodule` script - while still being
        // unable to parse this engine. The only reliable signal that a browser
        // could not start the game is that nothing happened.
        //
        // Matched as an attribute on a tag rather than anywhere in the file, so
        // that the comment explaining this does not trip it.
        expect(HTML).not.toMatch(/<script[^>]*\bnomodule\b/i);
    });

    it('does not sniff the user agent', () => {
        // Any list of strings is wrong the moment Apple ships a new one, and it
        // would miss the other reasons a module never runs: a blocked import, a
        // missing file, a proxy that mangles the response.
        expect(HTML).not.toMatch(/userAgent|navigator\.platform/);
    });

    it('is written in syntax a 2013 iPad can parse', () => {
        // A denylist rather than a real ES5 parse, deliberately: this project has
        // no build step and no parser dependency, and adding acorn to assert one
        // property of one inline script is a poor trade. What it catches is the
        // realistic regression - somebody edits this block in a modern editor and
        // types an arrow function or a template literal out of habit - which is
        // exactly the change that would be invisible everywhere we test.
        const modern = [
            [/=>/, 'arrow function'],
            [/\b(?:const|let)\s/, 'const/let'],
            [/`/, 'template literal'],
            [/\?\./, 'optional chaining'],
            [/\?\?/, 'nullish coalescing'],
            [/\.\.\./, 'spread'],
            [/\bclass\s+\w/, 'class'],
            [/\basync\b|\bawait\b/, 'async/await'],
        ];
        for (const script of classicScripts(HTML).map(code)) {
            for (const [pattern, name] of modern) {
                expect(pattern.test(script), `${name} in the ES5 fallback script`).toBe(false);
            }
        }
    });
});

describe('the loading shell, running', () => {
    let timer;

    const runShell = () => {
        // The element as the real document has it, then the classic script's own
        // source executed against it. Running the real source rather than a copy
        // is the point: a copy would keep passing after somebody edited
        // index.html, which is the only way this can break.
        document.body.innerHTML = HTML.match(/<div id="boot-status">[\s\S]*?<\/div>/)[0];
        const src = classicScripts(HTML).join('\n');
        new Function('document', 'setTimeout', src)(document, (fn, ms) => { timer = { fn, ms }; });
    };

    beforeEach(() => {
        timer = null;
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('waits long enough that a slow but working boot is not accused', () => {
        runShell();
        // boot() writes its skeleton before it awaits anything, so this is not a
        // race against the game loading - only against the page being parsed.
        // Still, a school connection deserves room.
        expect(timer.ms).toBeGreaterThanOrEqual(5000);
    });

    it('tells an unsupported tablet what to do about it', () => {
        runShell();
        timer.fn();

        const text = document.getElementById('boot-status').textContent;
        // The three things the message has to carry: that it failed, the cheap
        // thing to try, and the actual cause with a number the person can check
        // against Nastavení.
        expect(text).toMatch(/nepodařilo/i);
        expect(text).toMatch(/obnov/i);
        expect(text).toMatch(/iPadOS 15/);
    });

    it('says nothing when the engine took the page over', () => {
        runShell();
        // What boot() does: `root.innerHTML = SKELETON` replaces the body, and
        // with it the status element. That absence is the success signal - there
        // is no flag to set and nothing for boot.js to remember to call.
        document.body.innerHTML = '<div id="stage"></div>';

        expect(() => timer.fn()).not.toThrow();
        expect(document.body.innerHTML).toBe('<div id="stage"></div>');
    });
});
