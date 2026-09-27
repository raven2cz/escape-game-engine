// engine/join.js
//
// "Kdo hraje?": the screen before a game in a lesson, where a pupil writes a
// name (or nickname) and picks a picture. The player gets a stable id, minted
// here and never shown: that id is the slot the run is saved under within the
// lesson (EI-002 `team`) and the player's identity on the teacher's board. The
// name is only a label, so two pupils called Anička stay two players (EI-010).
//
// Remembered per lesson and game on the tablet, so a reload does not ask again.
// Restart forgets it, so the next child on a shared tablet enters their own.
//
// A host (the hosted runtime) can take over what only a server can do: hand out
// the player id, count seats, refuse a full or finished lesson. It passes
// `boot({join: {register}})`; this screen stays the part a pupil sees and shows
// the host's answer. The engine knows nothing about who the host is.

import {AVATARS, AVATAR_CREDITS, avatarById, avatarSrc} from './dashboard/avatars.js';

export const NAME_MAX = 24;

/**
 * A name fit to show: normalised, no control, format (zero-width, bidi, word
 * joiner, ...), separator, private-use or unassigned characters, spaces
 * collapsed, at most NAME_MAX characters.
 */
export function cleanName(raw) {
    // Remove first, then normalise: taking a character out can bring a base
    // letter and a combining mark together, and the result must still be NFC.
    const s = String(raw ?? '')
        .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/gu, '')
        .normalize('NFC')
        .replace(/\s+/g, ' ')
        .trim();
    return [...s].slice(0, NAME_MAX).join('').trim();
}

/**
 * The browser's localStorage, or null where even reaching it throws (a
 * SecurityError with storage blocked). Callers already treat null as "nothing
 * remembered".
 */
export function browserStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** A player id: opaque, stable for as long as the tablet remembers the player. */
export function mintPlayerId() {
    try {
        if (globalThis.crypto?.randomUUID) return `p-${globalThis.crypto.randomUUID()}`;
    } catch { /* fall through */
    }
    const rnd = () => Math.floor(Math.random() * 0x100000000).toString(36);
    return `p-${Date.now().toString(36)}-${rnd()}${rnd()}`;
}

const ID = /^p-[A-Za-z0-9-]{8,80}$/;

/** A player id as the engine accepts it, from itself or from a host. */
export function isPlayerId(id) {
    return typeof id === 'string' && ID.test(id);
}

const key = (sessionId, gameId) => `player:${encodeURIComponent(sessionId ?? '')}:${gameId}`;

/** The player this tablet already is in this lesson, or null. */
export function loadPlayer(sessionId, gameId, storage = browserStorage()) {
    try {
        const raw = JSON.parse(storage?.getItem(key(sessionId, gameId)) ?? 'null');
        const id = isPlayerId(raw?.id) ? raw.id : null;
        const name = cleanName(raw?.name);
        const avatar = avatarById(raw?.avatar)?.id ?? null;
        return id && name && avatar ? {id, name, avatar} : null;
    } catch {
        return null;
    }
}

export function savePlayer(sessionId, gameId, player, storage = browserStorage()) {
    try {
        storage?.setItem(key(sessionId, gameId), JSON.stringify({id: player.id, name: player.name, avatar: player.avatar}));
    } catch { /* private mode: the pupil is asked again after a reload, nothing worse */
    }
}

export function forgetPlayer(sessionId, gameId, storage = browserStorage()) {
    try {
        storage?.removeItem(key(sessionId, gameId));
        storage?.removeItem(joinKeyKey(sessionId, gameId));
    } catch { /* noop */
    }
}

const joinKeyKey = (sessionId, gameId) => `join:${key(sessionId, gameId)}`;

/**
 * The key this tablet registers with, the same for every attempt until a player
 * is saved. A reload during a registration whose answer was lost sends the same
 * key again, so a host can hand back the player it already made instead of
 * taking a second place in the lesson.
 */
export function joinKey(sessionId, gameId, storage = browserStorage()) {
    const k = joinKeyKey(sessionId, gameId);
    try {
        const kept = storage?.getItem(k);
        if (isPlayerId(kept)) return kept;
    } catch { /* fall through: a fresh key, only idempotence across a reload is lost */
    }
    const fresh = mintPlayerId();
    try {
        storage?.setItem(k, fresh);
    } catch { /* noop */
    }
    return fresh;
}

/**
 * Show the screen and resolve with {name, avatar} when the pupil presses Hrát.
 * Built with textContent only; nothing typed is ever parsed as markup.
 *
 * @param {HTMLElement} root  where to draw it (over the game shell)
 * @param {(key: string, fallback: string) => string} t  the engine's strings
 * @param {object} [opts]
 * @param {string} [opts.error]  why the last attempt failed (from a host), shown on the screen
 * @param {{name: string, avatar: string}} [opts.last]  what the pupil entered last time, kept
 */
export function askWhoPlays(root, t = (_k, fallback) => fallback, {error = null, last = null} = {}) {
    return new Promise((resolve) => {
        const el = (tag, cls, text) => {
            const node = document.createElement(tag);
            if (cls) node.className = cls;
            if (text != null) node.textContent = text;
            return node;
        };

        const overlay = el('div', 'join-overlay');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const form = el('form', 'join-card');
        form.noValidate = true;
        const title = el('h1', 'join-title', t('engine.join.title', 'Kdo hraje?'));
        title.id = 'joinTitle';
        overlay.setAttribute('aria-labelledby', 'joinTitle');

        const nameLabel = el('label', 'join-label', t('engine.join.name', 'Tvoje jméno nebo přezdívka'));
        const input = el('input', 'join-name');
        input.type = 'text';
        input.name = 'name';
        input.maxLength = NAME_MAX * 2; // cleanName() cuts to NAME_MAX characters, emoji included
        input.autocomplete = 'off';
        input.autocapitalize = 'words';
        input.spellcheck = false;
        input.placeholder = t('engine.join.placeholder', 'např. Modrý tygr');
        if (last?.name) input.value = last.name;
        nameLabel.append(input);
        const hint = el('p', 'join-hint', t('engine.join.hint',
            'Stačí přezdívka, celé jméno psát nemusíš. Učitel během hodiny uvidí tvůj postup, přezdívku a obrázek; po hodině se všechno smaže.'));

        const pickLabel = el('div', 'join-label', t('engine.join.avatar', 'Vyber si obrázek'));
        const grid = el('div', 'join-avatars');
        grid.setAttribute('role', 'radiogroup');
        grid.setAttribute('aria-label', t('engine.join.avatar', 'Vyber si obrázek'));
        let picked = null;
        // One radio group: a single tab stop, arrows move and choose (ARIA
        // radio group pattern), so a keyboard does not tab through 32 pictures.
        const choose = (b, focus = false) => {
            picked = b.dataset.avatar;
            buttons.forEach(x => {
                x.setAttribute('aria-checked', String(x === b));
                x.tabIndex = x === b ? 0 : -1;
            });
            if (focus) b.focus();
            update();
        };
        const buttons = AVATARS.map((a) => {
            const b = el('button', `join-avatar join-avatar--${a.kind}`);
            const img = el('img');
            img.src = avatarSrc(a);
            img.alt = '';
            img.draggable = false;
            b.append(img);
            b.type = 'button';
            b.dataset.avatar = a.id;
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', 'false');
            b.setAttribute('aria-label', a.label);
            b.title = a.label;
            b.tabIndex = -1;
            b.addEventListener('click', () => choose(b));
            grid.append(b);
            return b;
        });
        buttons[0].tabIndex = 0;
        const again = last?.avatar && buttons.find(b => b.dataset.avatar === last.avatar);
        grid.addEventListener('keydown', (e) => {
            const i = buttons.indexOf(document.activeElement);
            if (i < 0) return;
            const top = buttons[0].offsetTop;
            const cols = Math.max(1, buttons.filter(b => b.offsetTop === top).length);
            const step = {ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols}[e.key];
            if (!step) return;
            e.preventDefault();
            choose(buttons[(i + step + buttons.length) % buttons.length], true);
        });

        const play = el('button', 'join-play', t('engine.join.play', 'Hrát'));
        play.type = 'submit';

        const update = () => {
            play.disabled = !(cleanName(input.value) && picked);
        };
        input.addEventListener('input', update);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = cleanName(input.value);
            if (!name || !picked) return;
            overlay.remove();
            resolve({name, avatar: picked});
        });

        // CC BY 4.0 asks for the author to be named; here, where the pictures are.
        const parts = [title, nameLabel, hint, pickLabel, grid];
        if (error) {
            const note = el('p', 'join-error', error);
            note.setAttribute('role', 'alert');
            parts.push(note);
        }
        form.append(...parts, play, el('p', 'join-credits', AVATAR_CREDITS));
        overlay.append(form);
        root.append(overlay);
        if (again) choose(again);
        update();
        try {
            input.focus();
        } catch { /* noop */
        }
    });
}
