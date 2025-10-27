// engine/i18n-helpers.js
// Tiny i18n helpers used across the codebase.
// Keep these functions dumb and dependency-free.

function fmt(str, params) {
    if (!params) return String(str ?? '');
    return String(str ?? '').replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

/**
 * Translate a key against i18n maps:
 * - prefer game-level map
 * - then engine-level map
 * - otherwise use fallback
 */
function t(i18n, key, fallback = '', params = null) {
    const g = i18n?.game?.[key];
    const e = i18n?.engine?.[key];
    const raw = (g != null ? g : (e != null ? e : fallback));
    return fmt(raw, params);
}

/**
 * Resolve a possibly-localized value:
 * - plain string → returned as is
 * - object with { key } → use `t`
 * - "@key@fallback" → split and use `t`
 */
function text(i18n, val, fallback = '') {
    if (val && typeof val === 'object' && val.key) {
        return t(i18n, String(val.key), fallback);
    }
    if (typeof val === 'string') {
        const m = val.match(/^@([^@]+)@(.*)$/s);
        if (m) {
            const key = m[1].trim();
            const def = m[2];
            return t(i18n, key, def);
        }
        return val;
    }
    return String(val ?? fallback);
}

export { fmt, t, text };
