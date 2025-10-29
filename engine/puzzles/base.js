import { applyAutoLayout } from './layout.js';
import { t as i18nT, text as i18nText } from '../i18n-helpers.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

/**
 * Base class for all puzzles – container, theming, buttons, wiring.
 * Provides common infrastructure: mount, layout, i18n, token styling, etc.
 */
export class BasePuzzle {
    /**
     * @param {{
     *   id: string,
     *   kind: string,
     *   config: any,
     *   i18n?: (key:string, fallback?:string)=>string,
     *   engine: any,
     *   instanceOptions?: any
     * }} ctx
     */
    constructor(ctx) {
        this.id = ctx.id;
        this.kind = ctx.kind;
        this.config = ctx.config || {};

        // Sloučení instance options + config.options (zpětná kompatibilita)
        this.instanceOptions = { ...(ctx.instanceOptions || {}), ...(this.config.options || {}) };

        // I18n centralized through i18n-helpers.js
        this.engine = ctx.engine || {};
        const i18nDict = {
            engine: this.engine?.i18n?.engine || {},
            game: this.engine?.i18n?.game || {}
        };

        // Wrapper pro i18n helpers
        this.t = (val, fallback = '') => i18nText(i18nDict, val, fallback);
        this.tKey = (key, fallback = '') => i18nT(i18nDict, key, fallback);

        this.root = null;
        this.windowEl = null;
        this.flowEl = null;
        this.okBtn = null;
        this.cancelBtn = null;
        this.onRequestClose = null;
        this.resolveOk = null;
        this.resolveFail = null;

        if (DBG()) console.debug('[PZ] constructor', { id: this.id, kind: this.kind });
    }

    /** Create root DOM, apply layout and theme. */
    mount(container, workRect, backgroundUrl) {
        const root = document.createElement('div');
        root.className = `pz pz--kind-${this.kind} pz--id-${this.id}`;

        // Apply workRect to root if provided (for custom positioning)
        if (workRect) {
            Object.assign(root.style, {
                position: 'absolute',
                left: workRect.x + '%',
                top: workRect.y + '%',
                width: workRect.w + '%',
                height: workRect.h + '%'
            });
        } else {
        // Root vyplní celý container
        Object.assign(root.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%'
        });
        }
        container.appendChild(root);
        this.root = root;

        // Pracovní okno - pozicované dle workRect (z cfg.rect)
        const win = document.createElement('div');
        win.className = 'pz__window';
            Object.assign(win.style, {
                position: 'absolute',
                inset: '0'
            });
        root.appendChild(win);
        this.windowEl = win;

        if (DBG()) {
            console.debug('[PZ] base.mount window rect:', workRect, {
                computed: win.getBoundingClientRect(),
                parent: container.getBoundingClientRect()
            });
        }

        // Background overlay (CELÁ OBRAZOVKA, pod rootem)
        if (backgroundUrl) {
            const overlay = document.createElement('div');
            overlay.className = 'pz-overlay';
            overlay.style.background = `url("${backgroundUrl}") center/cover no-repeat`;
            overlay.style.opacity = '1';
            overlay.style.pointerEvents = 'none';
            overlay.style.position = 'absolute';
            overlay.style.inset = '0';
            container.insertBefore(overlay, container.firstChild);
            this._bgOverlay = overlay;
        }

        // Flow container - ŽÁDNÉ inline styly!
        const flow = document.createElement('div');
        flow.className = 'pz__flow';
        win.appendChild(flow);
        this.flowEl = flow;

        // Header group (title + prompt společně nahoře)
        const hasHeader = this.config.title || this.config.prompt;
        if (hasHeader) {
            const headerGroup = document.createElement('div');
            headerGroup.className = 'pz-header-group';

            if (this.config.title) {
                const titleVisible = this.config.theme?.title?.visible !== false;
                if (titleVisible) {
                    const title = document.createElement('div');
                    title.className = 'pz-title';
                    const titleText = this.t(this.config.title, '');
                    title.textContent = titleText;

                    // Apply theme styles
                    const titleStyle = this.config.theme?.title || {};
                    this.applyStyle(title, titleStyle);

                    headerGroup.appendChild(title);
                    if (DBG()) console.debug('[PZ] title:', { raw: this.config.title, translated: titleText });
                }
            }

            if (this.config.prompt) {
                const promptVisible = this.config.theme?.prompt?.visible !== false;
                if (promptVisible) {
                    const prompt = document.createElement('div');
                    prompt.className = 'pz-prompt';
                    const promptText = this.t(this.config.prompt, '');
                    prompt.textContent = promptText;

                    // Apply theme styles
                    const promptStyle = this.config.theme?.prompt || {};
                    this.applyStyle(prompt, promptStyle);

                    headerGroup.appendChild(prompt);
                    if (DBG()) console.debug('[PZ] prompt:', { raw: this.config.prompt, translated: promptText });
                }
            }

            // Only append header group if it has children
            if (headerGroup.children.length > 0) {
                flow.appendChild(headerGroup);
            }
        }

        // Buttons (merge z config + instanceOptions)
        const mergedButtons = {
            ok:     { visible: true,  label: '@btn.ok@OK',         ...(this.config.buttons?.ok||{}),     ...(this.instanceOptions.buttons?.ok||{}) },
            cancel: { visible: true,  label: '@btn.cancel@Zavřít', ...(this.config.buttons?.cancel||{}), ...(this.instanceOptions.buttons?.cancel||{}) },
        };

        const footer = document.createElement('div');
        footer.className = 'pz-footer';

        if (mergedButtons.ok.visible !== false) {
            const ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'pz-btn pz-btn--ok';
            ok.textContent = this.t(mergedButtons.ok.label, 'OK');
            ok.addEventListener('click', () => this.onOk());
            footer.appendChild(ok);
            this.okBtn = ok;
        }
        if (mergedButtons.cancel.visible !== false) {
            const c = document.createElement('button');
            c.type = 'button';
            c.className = 'pz-btn pz-btn--cancel';
            c.textContent = this.t(mergedButtons.cancel.label, 'Zavřít');
            c.addEventListener('click', () => this.onCancel());
            footer.appendChild(c);
            this.cancelBtn = c;
        }

        flow.appendChild(footer);

        // Layout (auto/manual/grid)
        const layoutCfg = this.instanceOptions.layout || this.config.layout || this.config.options?.layout || { mode:'auto', direction:'vertical' };
        applyAutoLayout(root, layoutCfg);

        this.applyTheme();
        if (DBG()) console.debug('[PZ] base.mount ok', { id:this.id, cls: this.root.className, layout: layoutCfg });
    }

    applyTheme() {
        const t1 = this.config.theme || {};
        const t2 = (this.instanceOptions && this.instanceOptions.theme) || {};
        const vars = {...(t1.vars || {}), ...(t2.vars || {})};
        for (const [k, v] of Object.entries(vars)) this.root?.style.setProperty(k, v);
        const cls = [t1.class, t2.class].filter(Boolean).join(' ');
        if (cls) this.root?.classList.add(...cls.split(/\s+/));
        if (this.instanceOptions?.aggregateOnly) this.root?.classList.add('pz--agg');
    }

    /**
     * Apply style object to element (common theming utility).
     * Supports: visible, display, bg, color, border, borderColor, borderWidth, borderRadius, fontSize, textAlign, etc.
     */
    applyStyle(el, style = {}) {
        if (!el || !style) return;

        // visible (JS API) - has priority over display
        if (style.visible === false) {
            el.style.display = 'none';
        } else if (style.display) {
            // display (CSS property) - only if visible is not false
            el.style.display = style.display;
        }

        // Other CSS properties
        if (style.bg) el.style.background = style.bg;
        if (style.color) el.style.color = style.color;
        if (style.border) el.style.border = style.border;
        if (style.borderColor) el.style.borderColor = style.borderColor;
        if (style.borderWidth) el.style.borderWidth = style.borderWidth;
        if (style.borderRadius) el.style.borderRadius = style.borderRadius;
        if (style.fontSize) el.style.fontSize = style.fontSize;
        if (style.textAlign) el.style.textAlign = style.textAlign;
        if (style.fontWeight) el.style.fontWeight = style.fontWeight;
        if (style.padding) el.style.padding = style.padding;
        if (style.margin) el.style.margin = style.margin;

        if (DBG() && Object.keys(style).length > 0) {
            console.debug('[PZ] applyStyle:', { el: el.className, style });
        }
    }

    /**
     * Create token element with text/image content.
     * @param {object} token - { id, label, text, image, style, rect }
     * @param {string} baseClass - dodatečná CSS třída (např. 'pz-token-shuffled')
     * @returns {HTMLElement}
     */
    createToken(token, baseClass = '') {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `pz-token ${baseClass}`.trim();
        el.setAttribute('data-id', String(token.id || ''));

        // Image
        if (token.image) {
            const img = document.createElement('img');
            img.className = 'pz-token-image';
            img.src = token.image;
            img.alt = this.t(token.label || token.text || '', '');
            el.appendChild(img);
        }

        // Text/Label
        if (token.label || token.text || !token.image) {
            const span = document.createElement('span');
            span.className = 'pz-token-text';
            span.textContent = this.t(token.label || token.text || '', '');
            el.appendChild(span);
        }

        // Apply merged theme: config.theme.token + token.style
        const mergedStyle = {
            ...(this.config.theme?.token || {}),
            ...(token.style || {})
        };
        this.applyStyle(el, mergedStyle);

        // Manual positioning (pokud je rect)
        if (token.rect) {
            Object.assign(el.style, {
                position: 'absolute',
                left: (token.rect.x || 0) + '%',
                top: (token.rect.y || 0) + '%',
                width: (token.rect.w || 0) + '%',
                height: (token.rect.h || 0) + '%'
            });
        }

        return el;
    }

    /**
     * Helper: převod array/string na Set<string> pro porovnání řešení
     */
    toIdSet(arr) {
        const s = new Set();
        (Array.isArray(arr) ? arr : [arr]).forEach(x => s.add(String(x)));
        return s;
    }

    /**
     * Create content area for tokens (respects layout mode).
     * @returns {HTMLElement} - area element, ready to append tokens
     */
    createTokenArea() {
        const area = document.createElement('div');
        area.className = 'pz-token-area';

        const layoutCfg = this.instanceOptions.layout || this.config.layout || {};
        const mode = layoutCfg.mode || 'auto';

        if (mode === 'manual') {
            Object.assign(area.style, { position: 'relative', flex: '1 1 auto' });
        } else if (layoutCfg.grid) {
            // Grid layout
            Object.assign(area.style, {
                display: 'grid',
                gridTemplateColumns: `repeat(${layoutCfg.grid.cols || 2}, 1fr)`,
                gap: layoutCfg.grid.gap || 'var(--pz-token-gap)',
                alignContent: 'start'
            });
        } else {
            // Auto flex layout (vertical/horizontal)
            const dir = layoutCfg.direction || 'vertical';
            Object.assign(area.style, {
                display: 'flex',
                flexDirection: dir === 'horizontal' ? 'row' : 'column',
                flexWrap: 'wrap',
                gap: 'var(--pz-token-gap)',
                alignItems: 'stretch'
            });
        }

        return area;
    }

    render() {
        // Override in subclasses
    }

    onOk() {
        return this.evaluate?.();
    }

    onCancel() {
        this.resolveFail?.('cancel');
        this.onRequestClose?.({reason: 'cancel'});
    }

    evaluate() {
        return {ok:false};
    }

    unmount() {
        if (this._bgOverlay?.parentNode) this._bgOverlay.parentNode.removeChild(this._bgOverlay);
        if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
        this.root = null;
        this.windowEl = null;
        this.flowEl = null;
        this.okBtn = null;
        this.cancelBtn = null;
        this._bgOverlay = null;
    }
}