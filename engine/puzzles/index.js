import {BasePuzzle} from './base.js';
import {rectToStyle} from './layout.js';
import PhrasePuzzle from './kinds/phrase.js';
import CodePuzzle from './kinds/code.js';
import QuizPuzzle from './kinds/quiz.js';
import OrderPuzzle from './kinds/order.js';
import MatchPuzzle from './kinds/match.js';
import GroupPuzzle from './kinds/group.js';
import ChoicePuzzle from './kinds/choice.js';
import ListPuzzle from './kinds/list.js';
import ClozePuzzle from './kinds/cloze.js';

// ============================================================================
// PUZZLE KINDS REGISTRY
// ============================================================================
// Centrální mapa všech dostupných puzzle typů.
// Pro přidání nového typu stačí přidat import výše a záznam do této mapy.
// ============================================================================

const PUZZLE_KINDS = {
    phrase: PhrasePuzzle,
    code: CodePuzzle,
    quiz: QuizPuzzle,
    order: OrderPuzzle,
    match: MatchPuzzle,
    group: GroupPuzzle,
    choice: ChoicePuzzle,
    list: ListPuzzle,
    cloze: ClozePuzzle
};

const _registry = new Map();

export function registerKind(kind, clazz) {
    _registry.set(kind, clazz);
}

export function getKind(kind) {
    return _registry.get(kind) || BasePuzzle;
}

// Automatická registrace všech puzzle kinds z mapy
for (const [kind, clazz] of Object.entries(PUZZLE_KINDS)) {
    registerKind(kind, clazz);
}

/** Create and run a single puzzle instance inside a container overlay. */
export function createPuzzleRunner(args) {
    const cfg = args.config || (args.ref ? args.puzzlesById?.[args.ref] : null);
    if (!cfg) throw new Error(`Puzzle config not found (ref='${args.ref || ''}')`);

    const Clazz = getKind(cfg.kind);
    const i18nFn = args.i18n || ((k, def = '') => (
        args.engine?._t?.(k, def) ??
        args.engine?.i18n?.game?.[k] ??
        args.engine?.i18n?.engine?.[k] ??
        def
    ));

    const puzzle = new Clazz({
        id: args.ref || cfg.id || 'inline',
        kind: cfg.kind,
        config: cfg,
        i18n: i18nFn,
        engine: args.engine,
        instanceOptions: args.instanceOptions || {}
    });

    // single-shot guard
    let __resolved = false;
    puzzle.resolveOk = (detail) => {
        if (!__resolved) {
            __resolved = true;
            args.onResolve?.({ok: true, detail});
        }
    };
    puzzle.resolveFail = (reason, extra) => {
        if (!__resolved) {
            __resolved = true;
            args.onResolve?.({ok: false, detail: {reason, ...(extra || {})}});
        }
    };

    const _origOnOk = puzzle.onOk?.bind(puzzle);
    puzzle.onOk = () => {
        const res = _origOnOk ? _origOnOk() : puzzle.evaluate?.();
        return Promise.resolve(res).then((r) => {
            if (__resolved) return;
            if (r && (r.hold === true || r === 'hold')) return; // keep open
            const ok = !!(r && r.ok);
            __resolved = true;
            args.onResolve?.({ok, detail: r?.detail});
        });
    };

    const containerRect = (args.instanceOptions && args.instanceOptions.overrideContainerRect === true && args.rect) ? args.rect : {
        x: 0,
        y: 0,
        w: 100,
        h: 100
    };

    const container = document.createElement('div');
    container.className = 'pz-container';
    Object.assign(container.style, {
        position: 'absolute',
        pointerEvents: 'auto',
        zIndex: '8000',
        ...rectToStyle(containerRect)
    });

    // host modal hardly stopped
    const hostModal = args.engine?.modalRoot;
    let prevDisplay = '';
    if (hostModal) {
        prevDisplay = hostModal.style.display;
        hostModal.style.display = 'none';
    }

    function mountInto(rootEl) {
        rootEl.appendChild(container);

        const workRect = cfg.rect || {x: 10, y: 10, w: 80, h: 80};

        // Resolve background: args.background (from list step) OR cfg.background (from puzzle config)
        const resolvedBackground = args.background ||
                                   (cfg.background ? (args.engine?._resolveAsset?.(cfg.background) || cfg.background) : undefined);

        console.log('[PZ] runner mountInto:', {
            id: puzzle.id,
            kind: puzzle.kind,
            argsRect: args.rect,
            cfgRect: cfg.rect,
            containerRect,
            workRect,
            'args.background': args.background,
            'cfg.background': cfg.background,
            'resolvedBackground': resolvedBackground
        });

        if (/\bdebug=1\b/.test(window.location.search)) {
            console.debug('[PZ] runner mountInto:', {
                id: puzzle.id,
                kind: puzzle.kind,
                'args.rect (hotspot)': args.rect,
                'cfg.rect (puzzle config)': cfg.rect,
                'containerRect (used)': containerRect,
                'workRect (used)': workRect,
                containerStyle: container.style.cssText
            });
        }

        puzzle.mount(container, workRect, resolvedBackground);
        puzzle.render?.();
    }

    function unmount() {
        try {
            puzzle.unmount();
        } catch {
        }
        if (container.parentNode) container.parentNode.removeChild(container);
        if (hostModal) hostModal.style.display = prevDisplay || '';
    }

    puzzle.onRequestClose = ({reason}) => {
        if (__resolved) return;
        __resolved = true;
        args.onResolve?.({ok: false, detail: {reason: reason || 'cancel'}});
    };

    return {puzzle, mountInto, unmount};
}

/** Open list/sequence of puzzles. */
export function openListModal(engine, cfg) {
    const mountRoot = engine.hotspotLayer;
    const i18n = (k, def = '') => engine._t?.(k, def) || def;

    let puzzlesById = cfg.puzzlesById;
    if (!puzzlesById) {
        const raw = engine.data?.puzzles || engine.data?.puzzlesById || {};
        puzzlesById = Array.isArray(raw) ? Object.fromEntries(raw.map(p => [p.id, p])) : raw;
    }

    const listItems = (cfg.items || []).map(it => ({
        ...it,
        background: it.background ? engine._resolveAsset(it.background) : undefined
    }));

    return new Promise((resolve) => {
        runPuzzleList({
            items: listItems,
            rect: cfg.rect || {x: 0, y: 0, w: 100, h: 100},
            background: cfg.background ? engine._resolveAsset(cfg.background) : undefined,
            aggregateOnly: !!cfg.aggregateOnly,
            blockUntilSolved: !!cfg.blockUntilSolved,
            summary: cfg.summary || {show: true},
            puzzlesById,
            i18n,
            engine,
            mountRoot,
            onDone: (res) => resolve(!!res.ok)
        });
    });
}
