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
import {SIGNALS} from '../dashboard/signals.js';

/**
 * What counts as the pupil changing their answer, for deciding whether a second
 * wrong evaluation is a new attempt. An OK press (or Enter, which submits) is
 * not a change; typing, selecting, dragging and dropping are.
 */
const CHANGE_EVENTS = ['input', 'change', 'pointerdown', 'click', 'keydown', 'drop'];

/**
 * What an evaluation meant. A kind says it explicitly with `status`; an older
 * or third-party kind that does not is read the old way: a hold is no
 * statement at all, anything else is correct or wrong by `ok`.
 *
 *   correct     solved, the runner resolves
 *   wrong       a real wrong answer; counted as a mistake, held or closed
 *   incomplete  nothing submitted yet (an empty field, nothing selected); not a mistake
 *   locked      a cooldown refused the answer; not a mistake
 */
export function evaluationStatus(result) {
    const held = !!(result && (result.hold === true || result === 'hold'));
    if (result && typeof result.status === 'string') return result.status;
    if (held) return null;
    return result && result.ok ? 'correct' : 'wrong';
}

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

    // --- dashboard identity and lifecycle (EI-010) ---------------------------
    // The public id of this task: a puzzle's own ref, or `<list>#<index>` for an
    // inline list step, which cannot collide between two lists. A list is a
    // container, not a task: it reports no evaluations and never counts as
    // solved; its steps do. Open and settle are tracked here, at the one
    // boundary every runner passes, because list steps never go through
    // _openPuzzleByRef.
    const signals = args.engine?.signals || null;
    const taskId = args.taskId || args.ref || cfg.id || null;
    const isContainer = cfg.kind === 'list';
    const reports = !!signals && !!taskId && !isContainer;
    puzzle.taskId = taskId;
    let opened = false;
    let settled = false;
    const settle = () => {
        if (opened && !settled) {
            settled = true;
            signals.emit(SIGNALS.PUZZLE_SETTLED, {ref: taskId});
        }
    };
    const evaluated = (ok) => {
        if (!reports) return;
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: taskId, ok});
        if (ok) signals.emit(SIGNALS.PUZZLE_SOLVED, {ref: taskId});
    };

    // single-shot guard
    let __resolved = false;
    puzzle.resolveOk = (detail) => {
        if (!__resolved) {
            __resolved = true;
            // A leaf that resolves itself, without going through onOk, has
            // still been answered correctly.
            evaluated(true);
            settle();
            args.onResolve?.({ok: true, detail});
        }
    };
    puzzle.resolveFail = (reason, extra) => {
        if (!__resolved) {
            __resolved = true;
            settle();
            args.onResolve?.({ok: false, detail: {reason, ...(extra || {})}});
        }
    };

    // Single flight: one submit gesture is at most one evaluation.
    let __evaluating = false;
    // A wrong answer submitted again unchanged (a double tap, a second press
    // while the feedback is still showing) is evaluated again, so the pupil sees
    // exactly what they always saw, but it is not a second mistake. Only a
    // changed answer is a new attempt. Decided by the answer itself, not by a
    // timer, so a quick correction is never swallowed. Every built-in kind
    // returns `answer` with a held wrong result; for a kind that does not, any
    // interaction inside the puzzle counts as a change. EI-010, SOL review.
    let __lastWrong = null;
    let __changedSinceWrong = true;
    const _origOnOk = puzzle.onOk?.bind(puzzle);
    puzzle.onOk = () => {
        if (__resolved || __evaluating) return Promise.resolve();
        __evaluating = true;
        let res;
        try {
            res = _origOnOk ? _origOnOk() : puzzle.evaluate?.();
        } catch (err) {
            __evaluating = false;
            throw err;
        }
        return Promise.resolve(res).then((r) => {
            __evaluating = false;
            if (__resolved) return;
            const held = !!(r && (r.hold === true || r === 'hold'));
            const status = evaluationStatus(r);
            if (status === 'incomplete') {
                // Not an answer yet. Say so without saying what is right or
                // wrong: that feedback is for a finished answer.
                const showHint = args.instanceOptions?.showErrorToast ?? cfg.showErrorToast ?? true;
                if (showHint && args.engine?.toast) {
                    args.engine.toast(i18nFn('engine.puzzle.incomplete', 'Nejdřív dokonči všechny odpovědi.'), 2500);
                }
            }
            if (status === 'correct') evaluated(true);
            if (status === 'wrong') {
                const key = r && r.answer !== undefined ? JSON.stringify(r.answer) : null;
                const isNew = key !== null ? key !== __lastWrong : __changedSinceWrong;
                if (isNew) evaluated(false);
                __lastWrong = key;
                __changedSinceWrong = false;
            }
            if (held) return; // keep open
            const ok = !!(r && r.ok);
            __resolved = true;
            settle();
            args.onResolve?.({ok, detail: r?.detail});
        }, (err) => {
            __evaluating = false;
            throw err;
        });
    };

    // The puzzle overlay always covers the whole layer; the puzzle window
    // inside it is placed by the puzzle's own `rect`. There used to be an
    // `overrideContainerRect` instance option that shrank the overlay to the
    // hotspot's rect. No game ever used it and nothing documented it, so it
    // went with the rest of the dead code in EI-018.
    const containerRect = {x: 0, y: 0, w: 100, h: 100};

    const container = document.createElement('div');
    container.className = 'pz-container';
    const noteChange = (e) => {
        const target = e.target;
        if (target?.closest?.('.pz-btn--ok')) return;
        if (e.type === 'keydown' && (e.key === 'Enter' || e.key === 'NumpadEnter')) return;
        __changedSinceWrong = true;
    };
    CHANGE_EVENTS.forEach(type => container.addEventListener(type, noteChange, true));
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

        if (reports && !opened) {
            opened = true;
            signals.emit(SIGNALS.PUZZLE_OPENED, {ref: taskId});
        }
        puzzle.mount(container, workRect, resolvedBackground);
        puzzle.render?.();
    }

    function unmount() {
        // Torn down without an answer (the list around it closed, say): it is
        // not open any more, whatever else happened.
        settle();
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
        settle();
        args.onResolve?.({ok: false, detail: {reason: reason || 'cancel'}});
    };

    return {puzzle, mountInto, unmount};
}
