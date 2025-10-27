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

export { normalizeText };
