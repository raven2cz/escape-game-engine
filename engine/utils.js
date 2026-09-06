// engine/utils.js
// Small, framework-wide utilities. Keep them stable.

function stripDiacritics(input) {
    // Prefer Unicode NFD if available (covers most Latin accents)
    try {
        return input
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, ''); // combining marks
    } catch {
        // Fallback mapping for environments without proper normalize()
        const map = {
            á:'a', č:'c', ď:'d', é:'e', ě:'e', í:'i', ň:'n', ó:'o', ř:'r', š:'s', ť:'t', ú:'u', ů:'u', ý:'y', ž:'z',
            ä:'a', ö:'o', ü:'u', ë:'e', ô:'o', ĺ:'l', ľ:'l',
            Á:'A', Č:'C', Ď:'D', É:'E', Ě:'E', Í:'I', Ň:'N', Ó:'O', Ř:'R', Š:'S', Ť:'T', Ú:'U', Ů:'U', Ý:'Y', Ž:'Z',
            Ä:'A', Ö:'O', Ü:'U', Ë:'E', Ô:'O', Ĺ:'L', Ľ:'L'
        };
        return input.replace(/[^A-Za-z0-9]/g, ch => map[ch] ?? ch);
    }
}

/**
 * Normalize user-entered text for puzzle matching.
 * Steps:
 *  - toLowerCase()
 *  - trim
 *  - strip diacritics
 *  - collapse spaces
 *  - remove non-alphanumerics (optional – keeps a–z0–9 only)
 */
function normalizeText(value) {
    const s = String(value ?? '')
        .toLowerCase()
        .trim();

    const noDia = stripDiacritics(s)
        .replace(/\s+/g, ' ')       // collapse whitespace
        .replace(/[^a-z0-9 ]+/g, '') // remove punctuation/symbols
        .trim();

    return noDia.replace(/\s+/g, ''); // final: no spaces for strict matching
}

/**
 * Read a flag specification into `[name, value]` pairs.
 *
 * Games write flags three ways, and all three have to mean what they look like:
 *
 *     "setFlags": "lab_unlocked"
 *     "setFlags": ["lab_unlocked", "lamp_lit"]
 *     "setFlags": { "lab_unlocked": true, "first_visit": false }
 *
 * The single name used to fall through to `Object.entries()`, which walks a
 * string character by character: one flag called "0", one called "1", and the
 * flag the author asked for never set. Nothing threw, the state saved, and the
 * door simply never opened. `giveItem` had always accepted a single value, which
 * is exactly what made this worth a trap.
 *
 * @param {string|string[]|Object<string, boolean>|null|undefined} spec
 * @returns {Array<[string, boolean]>}
 */
function flagEntries(spec) {
    if (!spec) return [];
    if (typeof spec === 'string') return [[spec, true]];
    if (Array.isArray(spec)) {
        return spec.filter(name => typeof name === 'string').map(name => [name, true]);
    }
    if (typeof spec === 'object') {
        return Object.entries(spec).map(([name, value]) => [name, !!value]);
    }
    return [];
}

export { normalizeText, flagEntries };
