// Lightweight i18n helper for @key@fallback strings and text normalization.

/**
 * Resolve "@key@fallback" against provided dictionary function or object.
 * If not in that form, returns input as-is.
 * @param {string} s
 * @param {(key:string)=>string|string|undefined} dictOrFn
 * @returns {string}
 */
export function resolveI18n(s, dictOrFn) {
    if (typeof s !== 'string') return s;

    if (s.startsWith('@')) {
        const match = s.match(/^@([^@]+)@(.*)$/s);
        if (match) {
            const [, key, fallback] = match;

            if (typeof dictOrFn === 'function') {
                const v = dictOrFn(key);
                return (v == null || v === '') ? fallback : String(v);
            } else if (dictOrFn && typeof dictOrFn === 'object') {
                const v = dictOrFn[key] ?? dictOrFn?.engine?.[key] ?? dictOrFn?.game?.[key];
                return (v == null || v === '') ? fallback : String(v);
            }
            return fallback;
        }
    }

    return s;
}

/** Normalize user text (lowercase + strip diacritics) */
export function normalizeText(s) {
    if (typeof s !== 'string') return '';
    const lower = s.toLowerCase().trim();
    return lower.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
