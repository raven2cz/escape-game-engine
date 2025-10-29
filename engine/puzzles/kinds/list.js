// engine/puzzles/kinds/list.js
// Kind: list – sequential puzzle execution with aggregation and summary

import { BasePuzzle } from '../base.js';
import { createPuzzleRunner } from '../index.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class ListPuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._results = [];
        this._currentIdx = 0;
        this._running = false;
        this._bgOverlay = null;
    }

    mount(container, workRect, backgroundUrl) {
        // List doesn't use standard BasePuzzle mount - it manages its own sequence
        this.container = container;
        this.workRect = workRect;
        this.backgroundUrl = backgroundUrl;

        // Shared background for entire list
        if (backgroundUrl) {
            this._bgOverlay = document.createElement('div');
            Object.assign(this._bgOverlay.style, {
                position: 'absolute',
                inset: '0',
                backgroundImage: `url("${backgroundUrl}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                pointerEvents: 'none',
                zIndex: '7999'
            });
            container.appendChild(this._bgOverlay);
        }

        if (DBG()) {
            console.debug('[PZ.list] mounted', {
                steps: this.config.steps?.length || 0,
                aggregateOnly: this.instanceOptions.aggregateOnly,
                blockUntilSolved: this.instanceOptions.blockUntilSolved
            });
        }
    }

    render() {
        if (this._running) return;
        this._running = true;

        const steps = this.config.steps || this.config.items || [];

        if (DBG()) {
            console.debug('[PZ.list] starting sequence', { stepCount: steps.length });
        }

        this._runSequence(steps);
    }

    _runSequence(steps) {
        if (this._currentIdx >= steps.length) {
            // All done - show summary
            this._showSummary();
            return;
        }

        const step = steps[this._currentIdx];
        const instOpts = {
            aggregateOnly: this.instanceOptions.aggregateOnly ?? false,
            blockUntilSolved: this.instanceOptions.blockUntilSolved ?? false,
            ...(step.options || {})
        };

        if (DBG()) {
            console.debug('[PZ.list] starting step', {
                idx: this._currentIdx,
                ref: step.ref,
                options: instOpts
            });
        }

        // IMPORTANT: Use step.rect if defined, otherwise use full screen (not this.workRect)
        // this.workRect is for the list container itself, not for individual puzzles
        const puzzleRect = step.rect || { x: 0, y: 0, w: 100, h: 100 };

        const runner = createPuzzleRunner({
            ref: step.ref,
            config: step.config,
            rect: puzzleRect,
            background: step.background || undefined,
            instanceOptions: instOpts,
            puzzlesById: this.engine.data?.puzzles || {},
            i18n: (k, def) => this.tKey(k, def),
            engine: this.engine,
            onResolve: (result) => {
                this._results.push({
                    index: this._currentIdx,
                    ref: step.ref || step.config?.id || `#${this._currentIdx}`,
                    ok: !!result.ok,
                    detail: result.detail
                });

                if (DBG()) {
                    console.debug('[PZ.list] step resolved', {
                        idx: this._currentIdx,
                        ok: result.ok,
                        blockUntilSolved: instOpts.blockUntilSolved
                    });
                }

                // blockUntilSolved takes precedence
                if (instOpts.blockUntilSolved && !result.ok) {
                    if (DBG()) {
                        console.debug('[PZ.list] blocked - must solve correctly');
                    }
                    return; // Stay on this step
                }

                // Progress to next
                runner.unmount();
                this._currentIdx++;
                this._runSequence(steps);
            }
        });

        runner.mountInto(this.container);
    }

    _showSummary() {
        const total = this._results.length;
        const ok = this._results.filter(r => r.ok).length;
        const allOk = ok === total;

        if (DBG()) {
            console.debug('[PZ.list] summary', { total, ok, allOk });
        }

        const summary = this.config.summary || {};

        if (summary.show === false) {
            // No summary - resolve immediately
            this._finish(allOk);
            return;
        }

        // Create summary overlay (use CSS classes, minimal inline styles)
        const host = document.createElement('div');
        host.className = 'pz-list-summary';
        Object.assign(host.style, {
            left: (this.workRect?.x ?? 10) + '%',
            top: (this.workRect?.y ?? 10) + '%',
            width: (this.workRect?.w ?? 80) + '%',
            height: (this.workRect?.h ?? 80) + '%'
        });

        // Title
        const title = document.createElement('div');
        title.textContent = this.t(summary.title || '@list.summary.title@Výsledek série', 'Výsledek série');
        Object.assign(title.style, {
            fontSize: '1.4em',
            fontWeight: '700',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.95)'
        });
        host.appendChild(title);

        // Score (if enabled)
        if (summary.showScore !== false) {
            const score = document.createElement('div');
            score.textContent = `${ok} / ${total}`;
            Object.assign(score.style, {
                fontSize: '2.5em',
                fontWeight: '700',
                color: allOk ? 'rgba(20, 220, 90, 0.9)' : 'rgba(255, 160, 90, 0.9)'
            });
            host.appendChild(score);
        }

        // Message
        const message = document.createElement('div');
        const msgKey = allOk ? 'messageOk' : 'messageFail';
        const msgDefault = allOk ? 'Skvělé! Série splněna.' : 'Něco se nepovedlo.';
        message.textContent = this.t(summary[msgKey] || msgDefault, msgDefault);
        Object.assign(message.style, {
            fontSize: '1.1em',
            textAlign: 'center',
            opacity: '0.9',
            color: 'rgba(255, 255, 255, 0.9)',
            maxWidth: '80%'
        });
        host.appendChild(message);

        // OK button - MUST use only CSS classes, NO inline background/border styles
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pz-btn pz-btn--ok';
        btn.textContent = this.t('@engine.modal.ok@OK', 'OK');

        // Only layout styles inline, NO background/border (CSS handles those)
        Object.assign(btn.style, {
            marginTop: '2vh',
            minWidth: '120px'
        });

        btn.addEventListener('click', () => {
            if (host.parentNode) {
                host.parentNode.removeChild(host);
            }
            this._finish(allOk);
        });
        host.appendChild(btn);

        this.container.appendChild(host);
    }

    _finish(allOk) {
        if (DBG()) {
            console.debug('[PZ.list] finished', { allOk, results: this._results });
        }

        if (allOk) {
            this.resolveOk?.({ results: this._results });
        } else {
            this.resolveFail?.('incomplete', { results: this._results });
        }
    }

    unmount() {
        if (this._bgOverlay?.parentNode) {
            this._bgOverlay.parentNode.removeChild(this._bgOverlay);
        }
        this._running = false;

        if (DBG()) {
            console.debug('[PZ.list] unmount');
        }
    }

    onOk() {
        // List manages its own flow - no manual OK
        return { hold: true };
    }

    onCancel() {
        this.resolveFail?.('cancel');
        this.onRequestClose?.({ reason: 'cancel' });
    }
}