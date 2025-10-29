import { BasePuzzle } from './base.js';
import { rectToStyle } from './layout.js';
import PhrasePuzzle from './kinds/phrase.js';
import CodePuzzle   from './kinds/code.js';
import QuizPuzzle   from './kinds/quiz.js';
import OrderPuzzle  from './kinds/order.js';
import MatchPuzzle  from './kinds/match.js';
import GroupPuzzle  from './kinds/group.js';
import ChoicePuzzle from './kinds/choice.js';
import ListPuzzle   from './kinds/list.js';

const _registry = new Map();
export function registerKind(kind, clazz) { _registry.set(kind, clazz); }
export function getKind(kind) { return _registry.get(kind) || BasePuzzle; }

registerKind('phrase', PhrasePuzzle);
registerKind('code',   CodePuzzle);
registerKind('quiz',   QuizPuzzle);
registerKind('order',  OrderPuzzle);
registerKind('match',  MatchPuzzle);
registerKind('group',  GroupPuzzle);
registerKind('choice', ChoicePuzzle);
registerKind('list',   ListPuzzle);

/** Create and run a single puzzle instance inside a container overlay. */
export function createPuzzleRunner(args) {
    const cfg = args.config || (args.ref ? args.puzzlesById?.[args.ref] : null);
    if (!cfg) throw new Error(`Puzzle config not found (ref='${args.ref || ''}')`);

    const Clazz = getKind(cfg.kind);
    const i18nFn = args.i18n || ((k, def='') => (
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
    puzzle.resolveOk   = (detail)                => { if (!__resolved) { __resolved = true; args.onResolve?.({ ok:true,  detail }); } };
    puzzle.resolveFail = (reason, extra)         => { if (!__resolved) { __resolved = true; args.onResolve?.({ ok:false, detail:{ reason, ...(extra||{}) } }); } };

    const _origOnOk = puzzle.onOk?.bind(puzzle);
    puzzle.onOk = () => {
        const res = _origOnOk ? _origOnOk() : puzzle.evaluate?.();
        return Promise.resolve(res).then((r) => {
            if (__resolved) return;
            if (r && (r.hold === true || r === 'hold')) return; // keep open
            const ok = !!(r && r.ok);
            __resolved = true;
            args.onResolve?.({ ok, detail: r?.detail });
        });
    };

    // OPRAVA: Container je celá obrazovka (nebo args.rect), ale pracovní okno uvnitř je cfg.rect
    // Pokud args.rect není definován, container bude celá obrazovka
    const containerRect = args.rect || {x:0, y:0, w:100, h:100};

    const container = document.createElement('div');
    container.className = 'pz-container';
    Object.assign(container.style, {
        position: 'absolute',
        pointerEvents: 'auto',
        zIndex: '8000',
        ...rectToStyle(containerRect)
    });

    // Tvůj hostitelský modal tvrdě vypneme (nejen class "hidden")
    const hostModal = args.engine?.modalRoot;
    let prevDisplay = '';
    if (hostModal) { prevDisplay = hostModal.style.display; hostModal.style.display = 'none'; }

    function mountInto(rootEl) {
        rootEl.appendChild(container);

        // OPRAVA: Použijeme cfg.rect (z puzzles.json) jako workRect
        // Pokud cfg.rect není, použijeme rozumné defaulty (ne celou obrazovku)
        const workRect = cfg.rect || {x: 10, y: 10, w: 80, h: 80};

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

        puzzle.mount(container, workRect, args.background);
        puzzle.render?.();
    }

    function unmount() {
        try { puzzle.unmount(); } catch {}
        if (container.parentNode) container.parentNode.removeChild(container);
        if (hostModal) hostModal.style.display = prevDisplay || '';
    }

    puzzle.onRequestClose = ({reason}) => {
        if (__resolved) return;
        __resolved = true;
        args.onResolve?.({ ok:false, detail:{ reason: reason || 'cancel' } });
    };

    return { puzzle, mountInto, unmount };
}

/** Open list/sequence of puzzles. */
export function openListModal(engine, cfg) {
    const mountRoot = engine.hotspotLayer;
    const i18n = (k, def='') => engine._t?.(k, def) || def;

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
            rect: cfg.rect || {x:0, y:0, w:100, h:100},
            background: cfg.background ? engine._resolveAsset(cfg.background) : undefined,
            aggregateOnly: !!cfg.aggregateOnly,
            blockUntilSolved: !!cfg.blockUntilSolved,
            summary: cfg.summary || { show: true },
            puzzlesById,
            i18n,
            engine,
            mountRoot,
            onDone: (res) => resolve(!!res.ok)
        });
    });
}
