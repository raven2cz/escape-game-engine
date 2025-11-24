/**
 * engine/dialogs.js
 * Handles the Dialog UI, character portraits, typewriter text effects,
 * and branching conversation flow.
 * * Architecture Note:
 * Portraits are anchored to the dialog panel via .dlg-stage (bottom: 0).
 * The open() method returns a Promise that resolves only when the dialog closes,
 * allowing the main Engine to await the conversation.
 */

export class DialogUI {
    /**
     * @param {import('./engine.js').Game} game
     */
    constructor(game) {
        this.game = game;
        this.overlay = null; // Root DOM element (.dlg-overlay)

        /** @type {object|null} Current dialog state { id, dlg, idx, leftChar, rightChar, leftMirror, rightMirror ... } */
        this.active = null;

        this._typewriterRunning = false;
        this._typewriterSkipped = false;

        /** @type {Function|null} Resolver for the Promise returned by open() */
        this._closeResolver = null;

        /** * Input lock to prevent race conditions during async transitions.
         * Prevents "double-click" skipping issues.
         * @type {boolean}
         */
        this._busy = false;

        this.typewriterConfig = {
            enabled: true,
            speed: 15,        // ms per char
            skipOnClick: true // clicking skips animation to end
        };
    }

    /**
     * Non-blocking sleep helper.
     * @param {number} ms
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // --- Visual Effects ---

    /**
     * Renders text character by character.
     * @param {HTMLElement} element
     * @param {string} text
     */
    async _typewriterText(element, text) {
        if (!element || !text || !this.typewriterConfig.enabled) {
            if (element) element.textContent = text;
            return;
        }

        this._typewriterRunning = true;
        this._typewriterSkipped = false;
        element.textContent = '';

        const chars = text.split('');
        for (let i = 0; i < chars.length; i++) {
            if (this._typewriterSkipped) {
                element.textContent = text;
                break;
            }
            element.textContent += chars[i];
            await this._sleep(this.typewriterConfig.speed);
        }

        this._typewriterRunning = false;
    }

    _skipTypewriter() {
        if (this._typewriterRunning) {
            this._typewriterSkipped = true;
        }
    }

    /**
     * Visually highlights the selected choice button briefly before proceeding.
     * @param {HTMLElement} btn
     */
    async _flashChoice(btn) {
        if (!btn || btn.__flashing) return;
        btn.__flashing = true;
        btn.classList.add('dlg-choice--selected');
        btn.setAttribute('disabled', 'disabled');
        try {
            await this._sleep(220);
        } finally {
            btn.classList.remove('dlg-choice--selected');
            btn.removeAttribute('disabled');
            btn.__flashing = false;
        }
    }

    // --- Debugging ---

    _dbgOn() {
        try { return new URLSearchParams(location.search).get('debug') === '1'; } catch { return false; }
    }

    _dbg(...a) {
        if (this._dbgOn()) console.debug('[DLG]', ...a);
    }

    // --- DOM Mounting ---

    _ensureMounted() {
        if (this.overlay) return;

        const root = document.createElement('div');
        root.className = 'dlg-overlay hidden';
        root.innerHTML = `
            <div class="dlg-blocker"></div>
            <div class="dlg-stage">
                <div class="dlg-char left"><img class="dlg-char-img" alt=""></div>
                <div class="dlg-char right"><img class="dlg-char-img" alt=""></div>
            </div>
            <div class="dlg-panel">
                <div class="dlg-nameplate"></div>
                <div class="dlg-text"></div>
                <div class="dlg-choices"></div>
                <div class="dlg-continue"></div>
            </div>
        `;

        // I18n for "tap to continue" hint
        const cont = root.querySelector('.dlg-continue');
        if (cont) cont.textContent = this.game._text('@ui.tapToNext@Klepni pro pokračování');

        // Blocker layer to capture clicks outside the panel
        const blocker = root.querySelector('.dlg-blocker');
        if (blocker) {
            Object.assign(blocker.style, {
                position: 'absolute',
                inset: '0',
                zIndex: '1050',
                pointerEvents: 'auto',
                background: 'transparent'
            });

            blocker.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this._handleInput();
            });
        }

        // Global click handler for advancement
        root.addEventListener('click', (e) => {
            if (e.target?.closest('.dlg-choices')) return;
            this._handleInput();
        });

        // Mount into scene container or body
        const host = this.game?.sceneImage?.closest('#sceneContainer') ||
            this.game?.sceneImage?.parentElement ||
            document.body;
        host.appendChild(root);
        this.overlay = root;

        // Responsive handling
        const onResize = () => {
            const compact = window.innerHeight < 560;
            this.overlay.classList.toggle('dlg-compact', compact);
        };
        window.addEventListener('resize', onResize);
        onResize();
    }

    /**
     * Centralized input handler. Skips typewriter or advances dialog.
     */
    _handleInput() {
        if (this._busy) return;

        if (this._typewriterRunning && this.typewriterConfig.skipOnClick) {
            this._skipTypewriter();
        } else {
            void this.next();
        }
    }

    _show() {
        if (!this.overlay) this._ensureMounted();
        this.overlay.classList.remove('hidden');
    }

    _hide() {
        if (this.overlay) this.overlay.classList.add('hidden');
    }

    // --- Core Lifecycle ---

    /**
     * Opens a dialog sequence.
     * Returns a Promise that resolves when the dialog is closed.
     * @param {string} dialogId
     * @returns {Promise<void>}
     */
    async open(dialogId) {
        this._dbg('open() →', dialogId);

        const list = Array.isArray(this.game.dialogsData?.dialogs) ? this.game.dialogsData.dialogs : [];

        // Resolve ID (support for dotted notation fallback)
        let dlg = list.find(d => d?.id === dialogId);
        if (!dlg && typeof dialogId === 'string' && dialogId.includes('.')) {
            const tail = dialogId.split('.').pop();
            dlg = list.find(d => d?.id === tail);
        }
        if (!dlg) {
            this._dbg('open() abort: not found', dialogId);
            return;
        }

        this._ensureMounted();
        this._show();

        // Initialize state including default mirror settings
        this.active = {
            id: dialogId,
            dlg,
            idx: 0,
            leftChar: dlg.left ? this._findCharacter(dlg.left.characterId) : null,
            rightChar: dlg.right ? this._findCharacter(dlg.right.characterId) : null,
            leftPose: dlg.left?.defaultPose || null,
            rightPose: dlg.right?.defaultPose || null,
            // Capture default mirror settings from config
            leftDefaultMirror: !!dlg.left?.mirror,
            rightDefaultMirror: !!dlg.right?.mirror
        };

        // Merge local typewriter config
        if (dlg.typewriter !== undefined) {
            if (typeof dlg.typewriter === 'boolean') {
                this.typewriterConfig.enabled = dlg.typewriter;
            } else if (typeof dlg.typewriter === 'object') {
                this.typewriterConfig = { ...this.typewriterConfig, ...dlg.typewriter };
            }
        }

        this._renderStep();

        // Return promise to block engine execution until closed
        return new Promise(resolve => {
            this._closeResolver = resolve;
        });
    }

    /**
     * Force close the dialog (e.g. on game restart).
     * In normal flow, _end() handles the closing logic.
     */
    async close() {
        this.active = null;
        this._hide();

        if (this._closeResolver) {
            this._closeResolver();
            this._closeResolver = null;
        }
    }

    refresh() {
        if (!this.active) return;
        this._renderStep();
    }

    // --- Character & Asset Resolution ---

    _findCharacter(charId) {
        const chars = Array.isArray(this.game.dialogsData?.characters) ? this.game.dialogsData.characters : [];

        // Special handling for 'hero' placeholder
        if (charId === 'hero') {
            const hero = this.game.getHero();
            const byId = chars.find(c => c?.id === hero.id);
            if (byId) return byId;

            const tpl = chars.find(c => c?.id === 'hero');
            if (!tpl) return null;

            // Clone and replace placeholders
            const clone = JSON.parse(JSON.stringify(tpl));
            clone.name = this.game._text(hero.name) || hero.name || clone.name;
            const poses = clone.poses || {};
            for (const [k, v] of Object.entries(poses)) {
                let p = String(v || '');
                p = p.replaceAll('{heroId}', hero.id);
                p = p.replaceAll('{heroBase}', hero.assetsBase || '');
                p = p.replace(/\/hero\//g, `/${hero.id}/`);
                p = p.replace(/\/hero(?=\/|$)/g, `/${hero.id}`);
                poses[k] = p;
            }
            clone.poses = poses;
            return clone;
        }

        return chars.find(c => c?.id === charId) || null;
    }

    _els(side) {
        const wrap = this.overlay?.querySelector(side === 'left' ? '.dlg-char.left' : '.dlg-char.right');
        return {wrap, img: wrap?.querySelector('.dlg-char-img')};
    }

    _setSpeaking(side) {
        const L = this.overlay?.querySelector('.dlg-char.left');
        const R = this.overlay?.querySelector('.dlg-char.right');
        L?.classList.remove('speaking');
        R?.classList.remove('speaking');
        this.overlay?.classList.remove('speaker-left', 'speaker-right');

        if (side === 'left') {
            L?.classList.add('speaking');
            this.overlay?.classList.add('speaker-left');
        }
        if (side === 'right') {
            R?.classList.add('speaking');
            this.overlay?.classList.add('speaker-right');
        }
    }

    /**
     * Updates character image.
     * @param {string} side - 'left' or 'right'
     * @param {string|null} poseOverride - specific pose to use, or null for default
     * @param {boolean} mirror - whether to flip the image horizontally
     */
    _applyPortrait(side, poseOverride = null, mirror = false) {
        const {img} = this._els(side);
        const actor = (side === 'left') ? this.active?.leftChar : this.active?.rightChar;
        const basePose = (side === 'left') ? this.active?.leftPose : this.active?.rightPose;
        const pose = poseOverride || basePose;

        if (!img || !actor) {
            if (img) img.src = '';
            return;
        }

        const poses = actor.poses || {};
        const src0 = (pose && poses[pose]) || poses.neutral || Object.values(poses)[0] || '';
        img.src = this.game._resolveAsset(src0);
        img.alt = this.game._text(actor.name) || '';

        // Apply mirror class if requested (Framework level feature)
        if (mirror) {
            img.classList.add('is-mirrored');
        } else {
            img.classList.remove('is-mirrored');
        }
    }

    // --- Rendering ---

    _renderStep() {
        const step = this.active?.dlg?.sequence?.[this.active?.idx ?? -1];
        if (!step) {
            // If index is out of bounds, we are done.
            void this._end();
            return;
        }

        // Update poses
        if (step.leftPose) this.active.leftPose = step.leftPose;
        if (step.rightPose) this.active.rightPose = step.rightPose;

        // Determine mirroring based on Defaults + Step Override
        // 1. Start with defaults defined in dialog config
        let mirrorLeft = this.active.leftDefaultMirror;
        let mirrorRight = this.active.rightDefaultMirror;

        // 2. If step specifies mirror, apply it ONLY to the active speaker
        // (This allows transient flipping or overriding defaults)
        if (typeof step.mirror === 'boolean') {
            if (step.speaker === 'left') mirrorLeft = step.mirror;
            if (step.speaker === 'right') mirrorRight = step.mirror;
        }

        // Visuals
        const sp = step.speaker === 'left' ? 'left' : (step.speaker === 'right' ? 'right' : null);
        this._setSpeaking(sp);

        // Apply portraits with resolved mirror settings
        this._applyPortrait(
            'left',
            (step.pose && step.speaker === 'left') ? step.pose : null,
            mirrorLeft
        );

        this._applyPortrait(
            'right',
            (step.pose && step.speaker === 'right') ? step.pose : null,
            mirrorRight
        );

        // UI Elements
        const nameEl = this.overlay?.querySelector('.dlg-nameplate');
        const textEl = this.overlay?.querySelector('.dlg-text');
        const choicesEl = this.overlay?.querySelector('.dlg-choices');

        if (nameEl) {
            let speakerName = '';
            if (step.speaker === 'left' && this.active.leftChar) speakerName = this.game._text(this.active.leftChar.name);
            if (step.speaker === 'right' && this.active.rightChar) speakerName = this.game._text(this.active.rightChar.name);
            nameEl.textContent = speakerName || '';
        }
        if (textEl) {
            const text = this.game._text(step.text || '');
            void this._typewriterText(textEl, text);
        }

        // Choices
        if (choicesEl) {
            choicesEl.innerHTML = '';
            if (Array.isArray(step.choices) && step.choices.length) {
                step.choices.forEach(ch => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'dlg-choice';
                    b.textContent = this.game._text(ch?.label || '');
                    b.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await this._flashChoice(b);
                        await this._applyChoice(step, ch || {});
                    }, {passive: false});
                    choicesEl.appendChild(b);
                });
            }
        }
    }

    // --- Logic & Flow ---

    async _applyChoice(step, ch) {
        if (this._busy) return;
        this._busy = true;

        try {
            const act = ch?.onChoose || {};
            if (act.setFlags) await this._applyFlags(act.setFlags);

            if (act.jump) {
                const to = (this.active?.dlg?.sequence || []).findIndex(n => n?.id === act.jump);
                if (to >= 0) {
                    this.active.idx = to;
                    this._renderStep();
                    return;
                }
            }
            if (act.end) {
                await this._end(act.onEnd || null);
                return;
            }
            await this._nextInternal();
        } finally {
            this._busy = false;
        }
    }

    /**
     * Advances to the next step in the sequence.
     */
    async next() {
        if (!this.active || this._busy) return;
        this._busy = true;
        try {
            await this._nextInternal();
        } finally {
            this._busy = false;
        }
    }

    async _nextInternal() {
        const step = this.active?.dlg?.sequence?.[this.active?.idx ?? -1];
        if (!step) {
            await this._end();
            return;
        }

        if (step.onNext) await this._applyOnNodeEnd(step.onNext);

        this.active.idx++;
        const total = this.active?.dlg?.sequence?.length ?? 0;
        if (this.active.idx >= total) {
            await this._end(this.active.dlg.onEnd || null);
            return;
        }
        this._renderStep();
    }

    async _applyOnNodeEnd(act) {
        if (act?.setFlags) await this._applyFlags(act.setFlags);
    }

    async _applyFlags(flags) {
        const g = this.game;
        let changed = false;
        if (Array.isArray(flags)) {
            for (const f of flags) if (!g.state.flags[f]) {
                g.state.flags[f] = true;
                changed = true;
            }
        } else if (flags && typeof flags === 'object') {
            for (const [k, v] of Object.entries(flags)) {
                if (!!g.state.flags[k] !== !!v) {
                    g.state.flags[k] = !!v;
                    changed = true;
                }
            }
        }

        if (changed) {
            await g._stateChanged();
        }
    }

    /**
     * Ends the dialog sequence correctly.
     * * CRITICAL ORDER:
     * 1. Hide UI (Visual close)
     * 2. Apply Logic/Flags (Triggers Engine Events)
     * 3. Resolve Promise (Unblock Engine)
     */
    async _end(onEnd = null) {
        const g = this.game;

        // 1. Visual close
        // We hide the overlay but do NOT resolve the promise yet.
        this._hide();
        this.active = null;

        // 2. Apply logic
        if (onEnd) {
            if (onEnd.message) g._msg(g._text(onEnd.message));

            // Triggers engine events. Since UI is hidden, highlights will be visible.
            if (onEnd.setFlags) await this._applyFlags(onEnd.setFlags);

            if (onEnd.goTo) await g.goto(onEnd.goTo);
        }

        // 3. Unblock Engine
        // Now we tell the engine "dialog is fully done".
        if (this._closeResolver) {
            this._closeResolver();
            this._closeResolver = null;
        }
    }
}
