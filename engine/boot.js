// engine/boot.js
//
// Everything needed to put a game on a page: the DOM the engine expects, the
// stylesheets, the i18n fetch, the Game, the buttons.
//
// It exists so that there is one copy of this. It all used to live inline in
// index.html, and the hosted runtime has to generate its own HTML - it injects
// the session, the team and the game id - so it would have copied that block.
// From that moment an engine release that changed boot would silently never
// reach production, because the production copy would be in another repository.
//
// So `boot()` owns the skeleton and the stylesheets as well as the wiring, and
// index.html is a shell with no knowledge of either. The Worker's HTML can be
// the same shell with different arguments.
//
//     import { boot } from './engine/boot.js';
//     const game = await boot({ gameId: 'demo' });

import {Game} from './engine.js';
import {ENGINE_I18N} from './i18n.js';
import {askWhoPlays, loadPlayer, savePlayer, forgetPlayer, cleanName, mintPlayerId, isPlayerId} from './join.js';

/** The nodes the engine takes by reference, and the chrome around them. */
const SKELETON = `
<header class="topbar">
    <div class="title" data-boot="title"></div>
    <div class="controls">
        <button id="btnRestart" data-boot="restart"></button>
        <button id="btnEditor" class="hidden" data-boot="editor"></button>
    </div>
</header>

<main id="gameRoot">
    <div id="sceneContainer">
        <img id="sceneImage" alt="">
        <div id="hotspotLayer"></div>
        <div id="editorOverlay" class="hidden"></div>
    </div>

    <section id="uiBar">
        <div id="inventory"></div>
        <div id="msg"></div>
    </section>
</main>

<div id="modal" class="hidden">
    <div class="modal-content">
        <div id="modalTitle" class="modal-title"></div>
        <div id="modalBody" class="modal-body"></div>
        <div class="modal-actions">
            <button id="modalCancel"></button>
            <button id="modalOk"></button>
        </div>
    </div>
</div>
`;

const STYLESHEETS = ['../styles/puzzles.css', '../styles/content.css', '../styles/style.css'];

/**
 * Add a stylesheet once, resolved against this module rather than the page, so
 * it follows the engine wherever the engine is served from.
 */
function addStylesheet(href) {
    const url = new URL(href, import.meta.url).href;
    if (document.querySelector(`link[rel="stylesheet"][href="${url}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
}

/** Fetch JSON, or an empty object. A game need not have translations. */
async function fetchJsonSafe(url, timeoutMs = 8000) {
    // Bounded: a request a school network drops (rather than refuses) would
    // otherwise hold the start of the game forever, after the loading shell
    // and its ten-second warning are already gone.
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
        const r = await fetch(url, {cache: 'no-cache', ...(ctrl ? {signal: ctrl.signal} : {})});
        if (!r.ok) throw new Error(r.statusText);
        return await r.json();
    } catch {
        return {};
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Keep the scene box at the aspect ratio of the first image, and complain when a
 * later one disagrees. A game whose scenes are not all the same shape looks
 * broken in a way nobody can describe, so it is worth saying out loud while the
 * game is being made.
 */
function watchSceneAspect(game, sceneImage) {
    let baseline = null; // height / width

    sceneImage.addEventListener('load', () => {
        const w = sceneImage.naturalWidth || 16;
        const h = sceneImage.naturalHeight || 9;

        if (baseline === null) {
            document.documentElement.style.setProperty('--scene-aspect', `${w} / ${h}`);
            baseline = h / w;
            return;
        }

        const drift = Math.abs(h / w - baseline) / baseline;
        if (drift > 0.02) {
            game.toast?.(game._t('engine.aspectDrift',
                'Pozor: tento obrázek má jiný poměr stran než ostatní. Doporučeno sjednotit.'), 5000);
        }
    });
}

/** Whether a run is saved under a key, without trusting what is in it. */
function hasStoredRun(key, webStorage) {
    try {
        return !!webStorage?.getItem(key);
    } catch {
        return false;
    }
}

/**
 * "Kdo hraje?" until there is a player. Without a host the engine mints the id;
 * with one, the host does, and whatever it refuses with is shown on the screen
 * with the pupil's answer kept, so they only press Hrát again.
 */
async function whoPlays(root, t, host) {
    let error = null;
    let last = null;
    for (;;) {
        const answer = await askWhoPlays(root, t, {error, last});
        if (!host) return {id: mintPlayerId(), ...answer};
        last = answer;
        try {
            const res = await host.register(answer);
            if (isPlayerId(res?.playerId)) return {id: res.playerId, ...answer};
            error = typeof res?.error === 'string' && res.error ? res.error : t('engine.join.failed', 'Připojení se nepovedlo. Zkus to prosím znovu.');
        } catch {
            error = t('engine.join.failed', 'Připojení se nepovedlo. Zkus to prosím znovu.');
        }
    }
}

/**
 * Build the page and start the game.
 *
 * @param {object} opts
 * @param {string}  opts.gameId    which game
 * @param {string} [opts.lang]     'cs'
 * @param {string} [opts.baseUrl]  where that game's files are. Defaults to
 *                                 `./games/<gameId>/`; the runtime passes its own
 *                                 versioned prefix.
 * @param {object} [opts.storage]  {load, save, clear}. Where a reload finds the run.
 *        Local only: it may cache the state on the device and must never
 *        transmit it. The saved state is the engine's private model.
 * @param {object} [opts.report]   the DashboardReport transport,
 *        `{enabled, send(wire, {terminal})}`. The only sanctioned way anything
 *        about a run leaves the tablet, and it carries a DashboardReport, never
 *        the state. Defaults to sending nothing. See docs/DASHBOARD-API.md.
 * @param {string} [opts.sessionId] which lesson this run belongs to
 * @param {string} [opts.teamId]    which team within it
 *        Both optional, and the engine never invents them. Without them one
 *        tablet has one slot per game, so the next class resumes the last
 *        class's progress unless somebody resets. See EI-002.
 * @param {boolean|object} [opts.join]   ask "Kdo hraje?" (name + animal) before the game.
 *        Defaults to on in a lesson (a session is given) when the link names no
 *        player, off otherwise, so local play is unchanged. The answer is the
 *        player: the slot the run is saved under and the name on the teacher's
 *        board. A host that hands out the player itself passes
 *        `{register({name, avatar}) -> Promise<{playerId} | {error}>}`: the
 *        engine shows the screen, the host returns an id (`p-...`) or a message
 *        the pupil sees on the same screen (a full lesson, a finished one).
 * @param {Storage} [opts.webStorage]  where the tablet remembers the player and
 *        the run: `localStorage` by default. A host that wants nothing to outlive
 *        the browser tab passes `sessionStorage`.
 * @param {boolean} [opts.restart]  offer the Restart button. Default on; a host
 *        running a lesson can turn it off so a pupil cannot wipe their own run.
 * @param {string} [opts.avatar]   the player's animal, when the caller already knows it
 * @param {HTMLElement} [opts.root]   where to build. Defaults to document.body.
 * @param {boolean} [opts.editor]  offer the editor. Defaults to off; a tablet in
 *                                 a lesson should not fetch it or see the button.
 * @param {(game: Game) => void} [opts.onGame]
 *        Called as soon as the Game exists, before it starts loading.
 *        The returned promise resolves only once the game is *running*, and a
 *        game whose first scene opens a dialog is not running until somebody
 *        closes it - so a caller that wants a handle for debugging cannot wait
 *        for the promise. This is that handle.
 * @returns {Promise<Game>} once the first scene is on screen
 */
export async function boot(opts = {}) {
    const gameId = opts.gameId;
    if (!gameId) throw new Error('boot() needs a gameId');

    const lang = (opts.lang || 'cs').toLowerCase();
    const baseUrl = opts.baseUrl || `./games/${gameId}/`;
    const sessionId = opts.sessionId || null;
    // A player named in the link is an identity (the save slot, EI-002) and may
    // be an opaque id from the runtime: kept whole. Only what the board shows is
    // cleaned like a typed name.
    let teamId = String(opts.teamId ?? '').trim() || null;
    let playerName = cleanName(teamId) || null; // nothing showable is no name, never the raw id
    let avatar = opts.avatar || null;
    const root = opts.root || document.body;

    STYLESHEETS.forEach(addStylesheet);
    // Per-game overrides last, so they win. A game need not have one; the
    // browser logs a 404 and nothing else happens.
    addStylesheet(new URL(`${baseUrl}game.css`, document.baseURI).href);

    root.innerHTML = SKELETON;
    const el = (id) => root.querySelector(`#${id}`);

    const engineStrings = ENGINE_I18N?.[lang] || ENGINE_I18N?.cs || {};
    const gameStrings = await fetchJsonSafe(`${baseUrl}i18n/${lang}.json`);
    const t = (key, fallback) => gameStrings?.[key] ?? engineStrings?.[key] ?? fallback;

    // The chrome was hardcoded Czech. It comes from the dictionary now, so a
    // game shipped in another language does not have two of them on screen.
    root.querySelector('[data-boot="title"]').textContent = t('engine.appTitle', 'Úniková hra');
    const restart = root.querySelector('[data-boot="restart"]');
    restart.textContent = t('engine.restart', '↺ Restart');
    restart.title = t('engine.restart', '↺ Restart');
    el('modalCancel').textContent = t('engine.modal.cancel', 'Zavřít');
    el('modalOk').textContent = t('engine.modal.ok', 'OK');

    // In a lesson, find out who is playing before anything is loaded under
    // their name. A tablet that already knows its player for this lesson
    // (a reload) is not asked again.
    // Not when this tablet is already playing this lesson from before the
    // screen existed (a session link, no player): an engine release must never
    // end a lesson, and asking would move the pupil to a new, empty slot. The
    // key is the one Game._storageKey() gives a session without a player.
    const webStorage = opts.webStorage || globalThis.localStorage;
    const running = !!sessionId && !teamId && !opts.storage
        && hasStoredRun(`state:${encodeURIComponent(sessionId)}:${gameId}:`, webStorage);
    const host = opts.join && typeof opts.join === 'object' ? opts.join : null;
    const join = host ? true : (opts.join ?? (!!sessionId && !teamId && !running));
    if (join) {
        const player = loadPlayer(sessionId, gameId, webStorage) || await whoPlays(root, t, host);
        savePlayer(sessionId, gameId, player, webStorage);
        teamId = player.id;          // the save slot and the identity: stable, never shown
        playerName = player.name;    // only a label: two Aničkas stay two players
        avatar = player.avatar;
    }

    const game = new Game({
        baseUrl,
        scenesUrl: `${baseUrl}scenes.json`,
        dialogsUrl: `${baseUrl}dialogs.json`,
        lang,
        i18n: {engine: engineStrings, game: gameStrings || {}},
        ...(opts.storage ? {storage: opts.storage} : {}),
        webStorage,
        ...(opts.report ? {reportTransport: opts.report} : {}),
        sessionId,
        teamId,
        playerName,
        avatar,

        sceneImage: el('sceneImage'),
        hotspotLayer: el('hotspotLayer'),
        inventoryRoot: el('inventory'),
        messageBox: el('msg'),
        modalRoot: el('modal'),
        modalTitle: el('modalTitle'),
        modalBody: el('modalBody'),
        modalCancel: el('modalCancel'),
        modalOk: el('modalOk'),
    });

    // Before init(), deliberately. init() does not return until the first scene
    // is up, and the first scene commonly opens a blocking dialog, so anything
    // that waits for boot() to resolve has no handle on the game while the
    // pupil is reading it.
    opts.onGame?.(game);

    if (opts.restart === false) {
        restart.remove();
    } else {
        restart.addEventListener('click', () => {
            // A restart on a shared tablet is usually the next child: forget who
            // was playing, so they are asked their own name.
            if (join) forgetPlayer(sessionId, gameId, webStorage);
            game.restart();
        });
    }

    if (opts.editor) {
        // Loaded only when asked for. It is 53 kB that a tablet in a lesson has
        // no use for, and a visible Edit button in a classroom is an invitation.
        const {Editor} = await import('./editor.js');
        const editor = new Editor({
            game,
            overlay: el('editorOverlay'),
            hotspotLayer: el('hotspotLayer'),
        });
        const button = root.querySelector('[data-boot="editor"]');
        button.textContent = t('engine.editor', '✎ Edit');
        button.title = t('engine.editor', '✎ Edit');
        button.classList.remove('hidden');
        button.addEventListener('click', () => editor.toggle());
    }

    watchSceneAspect(game, el('sceneImage'));

    await game.init();
    return game;
}
