// engine/i18n-helpers.js
// Minimal helpers for per-game translations (scenes, dialogs, puzzles).

export async function loadI18nDict(url) {
    if (!url) return {};
    try {
        const r = await fetch(url);
        if (!r.ok) return {};
        const json = await r.json();
        return (json && typeof json === 'object') ? json : {};
    } catch {
        return {};
    }
}

/** tr(dict, key, fallback) -> translate key or fallback */
export function tr(dict, key, fallback = '') {
    if (!key) return String(fallback ?? '');
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) {
        const v = dict[key];
        return (v == null ? '' : String(v));
    }
    return String(fallback ?? '');
}

/** tx(dict, value, fallback) resolves:
 *   - string               => returned as is
 *   - { key: "…" }         => tr(key, fallback)
 *   - "@key@fallback"      => tr(key, fallback)
 */
export function tx(dict, value, fallback = '') {
    if (value == null) return String(fallback ?? '');

    if (typeof value === 'object' && value.key) {
        return tr(dict, value.key, fallback);
    }
    if (typeof value === 'string') {
        const m = value.match(/^@([^@]+)@(.*)$/s);
        if (m) {
            const key = m[1].trim();
            const def = m[2];
            return tr(dict, key, def);
        }
        return value;
    }
    return String(value);
}

/** interpolate("Picked up {name}", {name:"Key"}) => "Picked up Key" */
export function interpolate(str, params = {}) {
    if (str == null) return '';
    return String(str).replace(/\{(\w+)\}/g, (_, k) =>
        Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`
    );
}
