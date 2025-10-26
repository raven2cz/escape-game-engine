// engine/dialogs.js
// Dialog UI – portréty jsou ukotvené k panelu přes .dlg-stage (bottom: 0)

export class DialogUI {
    constructor(game) {
        this.game = game;
        this.overlay = null;  // root .dlg-overlay
        this.active  = null;  // { id, dlg, idx, leftChar, rightChar, leftPose, rightPose }
    }

    _dbgOn() {
        try { return new URLSearchParams(location.search).get('debug') === '1'; }
        catch { return false; }
    }
    _dbg(...a) { if (this._dbgOn()) console.debug('[DLG]', ...a); }

    // ---------- mount ----------
    _ensureMounted() {
        if (this.overlay) return;

        const root = document.createElement('div');
        root.className = 'dlg-overlay hidden';
        root.innerHTML = `
      <div class="dlg-stage">
        <div class="dlg-char left"><img class="dlg-char-img" alt=""></div>
        <div class="dlg-char right"><img class="dlg-char-img" alt=""></div>
      </div>
      <div class="dlg-panel">
        <div class="dlg-nameplate"></div>
        <div class="dlg-text"></div>
        <div class="dlg-choices"></div>
        <div class="dlg-continue">@ui.tapToNext@</div>
      </div>
    `;
        const cont = root.querySelector('.dlg-continue');
        if (cont) cont.textContent = this.game._text('@ui.tapToNext@Klepni pro pokračování');

        // Kliknutí mimo volby → next
        root.addEventListener('click', (e) => {
            if (e.target && e.target.closest('.dlg-choices')) return;
            void this.next();
        });

        // Uvnitř sceneContainer (absolutní overlay)
        const host = this.game?.sceneImage?.closest('#sceneContainer')
            || this.game?.sceneImage?.parentElement
            || document.body;
        host.appendChild(root);
        this.overlay = root;

        // kompaktní režim
        const onResize = () => {
            const compact = window.innerHeight < 560;
            this.overlay.classList.toggle('dlg-compact', compact);
        };
        window.addEventListener('resize', onResize);
        onResize();

        this._dbg('mount overlay', { zIndex: getComputedStyle(root).zIndex });
    }

    _show() { if (!this.overlay) this._ensureMounted(); this.overlay.classList.remove('hidden'); }
    _hide() { if (this.overlay) this.overlay.classList.add('hidden'); }

    // ---------- open/close ----------
    async open(dialogId) {
        this._dbg('open() begin →', dialogId);

        const data = this.game.dialogsData;
        const list = Array.isArray(data?.dialogs) ? data.dialogs : [];

        let dlg = list.find(d => d && d.id === dialogId);
        if (!dlg && typeof dialogId === 'string' && dialogId.includes('.')) {
            const tail = dialogId.split('.').pop();
            dlg = list.find(d => d && d.id === tail);
            this._dbg('open() fallback by tail', tail, '→', !!dlg);
        }
        if (!dlg) { this._dbg('open() abort: not found', dialogId); return; }

        this._ensureMounted();
        this._show();

        this.active = {
            id: dialogId,
            dlg,
            idx: 0,
            leftChar:  dlg.left  ? this._findCharacter(dlg.left.characterId)  : null,
            rightChar: dlg.right ? this._findCharacter(dlg.right.characterId) : null,
            leftPose:  dlg.left?.defaultPose  || null,
            rightPose: dlg.right?.defaultPose || null
        };

        this._renderStep();
    }

    async close() { this.active = null; this._hide(); }

    // ---------- utils ----------
    _findCharacter(charId) {
        return (this.game.dialogsData?.characters || []).find(c => c && c.id === charId) || null;
    }
    _els(side) {
        const wrap = this.overlay?.querySelector(side === 'left' ? '.dlg-char.left' : '.dlg-char.right');
        return { wrap, img: wrap?.querySelector('.dlg-char-img') };
    }
    _setSpeaking(side) {
        const L = this.overlay?.querySelector('.dlg-char.left');
        const R = this.overlay?.querySelector('.dlg-char.right');
        if (L) L.classList.remove('speaking');
        if (R) R.classList.remove('speaking');
        this.overlay?.classList.remove('speaker-left', 'speaker-right');

        if (side === 'left') {
            if (L) L.classList.add('speaking');
            this.overlay?.classList.add('speaker-left');
        } else if (side === 'right') {
            if (R) R.classList.add('speaking');
            this.overlay?.classList.add('speaker-right');
        }
    }
    _applyPortrait(side, poseOverride = null) {
        const { img } = this._els(side);
        const actor    = (side === 'left') ? this.active?.leftChar  : this.active?.rightChar;
        const basePose = (side === 'left') ? this.active?.leftPose  : this.active?.rightPose;
        const pose     = poseOverride || basePose;
        if (!img || !actor) { if (img) img.src = ''; return; }
        const poses = actor.poses || {};
        const src = (pose && poses[pose]) || poses.neutral || Object.values(poses)[0] || '';
        img.src = this.game._resolveAsset(src);
        img.alt = this.game._text(actor.name) || '';
    }

    // ---------- render ----------
    _renderStep() {
        const step = this.active?.dlg?.sequence?.[this.active?.idx ?? -1];
        if (!step) { void this._end(); return; }

        if (step.leftPose)  this.active.leftPose  = step.leftPose;
        if (step.rightPose) this.active.rightPose = step.rightPose;

        const sp = step.speaker === 'left' ? 'left' : (step.speaker === 'right' ? 'right' : null);
        this._setSpeaking(sp);
        this._applyPortrait('left',  (step.pose && step.speaker === 'left')  ? step.pose : null);
        this._applyPortrait('right', (step.pose && step.speaker === 'right') ? step.pose : null);

        const nameEl    = this.overlay?.querySelector('.dlg-nameplate');
        const textEl    = this.overlay?.querySelector('.dlg-text');
        const choicesEl = this.overlay?.querySelector('.dlg-choices');

        if (nameEl) {
            let speakerName = '';
            if (step.speaker === 'left'  && this.active.leftChar)  speakerName = this.game._text(this.active.leftChar.name);
            if (step.speaker === 'right' && this.active.rightChar) speakerName = this.game._text(this.active.rightChar.name);
            nameEl.textContent = speakerName || '';
        }
        if (textEl) textEl.textContent = this.game._text(step.text || '');

        if (choicesEl) {
            choicesEl.innerHTML = '';
            if (Array.isArray(step.choices) && step.choices.length) {
                step.choices.forEach(ch => {
                    const b = document.createElement('button');
                    b.className = 'dlg-choice';
                    b.textContent = this.game._text(ch?.label || '');
                    b.addEventListener('click', async (e) => { e.stopPropagation(); await this._applyChoice(step, ch || {}); });
                    choicesEl.appendChild(b);
                });
            }
        }
    }

    async _applyChoice(step, ch) {
        const act = ch?.onChoose || {};
        if (act.setFlags) await this._applyFlags(act.setFlags);

        if (act.jump) {
            const to = (this.active?.dlg?.sequence || []).findIndex(n => n && n.id === act.jump);
            if (to >= 0) { this.active.idx = to; this._renderStep(); return; }
        }
        if (act.end) { await this._end(act.onEnd || null); return; }

        await this.next();
    }

    async next() {
        if (!this.active) return;
        const step = this.active?.dlg?.sequence?.[this.active?.idx ?? -1];
        if (!step) { await this._end(); return; }
        if (step.onNext) await this._applyOnNodeEnd(step.onNext);

        this.active.idx++;
        const total = this.active?.dlg?.sequence?.length ?? 0;
        if (this.active.idx >= total) { await this._end(this.active.dlg.onEnd || null); return; }
        this._renderStep();
    }

    async _applyOnNodeEnd(act) { if (act?.setFlags) await this._applyFlags(act.setFlags); }

    async _applyFlags(flags) {
        const g = this.game; let changed = false;
        if (Array.isArray(flags)) {
            for (const f of flags) if (!g.state.flags[f]) { g.state.flags[f] = true; changed = true; }
        } else if (flags && typeof flags === 'object') {
            for (const [k, v] of Object.entries(flags)) {
                if (!!g.state.flags[k] !== !!v) { g.state.flags[k] = !!v; changed = true; }
            }
        }
        if (changed) g._saveState();
    }

    async _end(onEnd = null) {
        const g = this.game;
        if (onEnd) {
            if (onEnd.message) g._msg(g._text(onEnd.message));
            if (onEnd.setFlags) await this._applyFlags(onEnd.setFlags);
            if (onEnd.goTo) await g.goto(onEnd.goTo);
        }
        await this.close();
    }
}
