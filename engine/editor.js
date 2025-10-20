// engine/editor.js
// Editor: kreslení hotspot obdélníku tahem (myš/touch/pero) + souřadnicové štítky + JSON panel.
// Toolbar a JSON panel jsou MIMO hotspotLayer, takže kliky na ně neprobublají do listeneru kreslení.

export class Editor {
  constructor({ game, overlay, hotspotLayer }) {
    this.game = game;
    this.overlay = overlay;            // vizuální vrstva (štítky + dočasný box), je sourozencem hotspotLayer
    this.hotspotLayer = hotspotLayer;  // sbíráme z něj pointer události
    this.sceneContainer = hotspotLayer.parentElement; // rodič obou vrstev

    this.enabled = false;
    this.dragging = null; // { start:{x,y}, end:{x,y} } v %
    this.rect = null;     // poslední hotový obdélník
    this.toolbar = null;
    this.jsonPanel = null;
    this._observer = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp   = this._onPointerUp.bind(this);
    this._onDomMutate   = this._onDomMutate.bind(this);
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('editor-on');
    this.overlay.classList.remove('hidden');
    this.overlay.style.pointerEvents = 'none';  // overlay nic nechytá

    this._buildToolbar();
    this._bind();
    this._observeHotspots();
    this._renderStaticLabels();

    this._hint('Editor ZAPNUT: táhni po scéně pro vytvoření hotspotu.');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    document.body.classList.remove('editor-on');
    this.overlay.classList.add('hidden');
    this._unbind();
    this._unobserveHotspots();
    this._removeToolbar();
    this._hideJsonPanel();
    this._clearTemp();
    this._clearLabels();
    this.dragging = null;
  }

  toggle(){ this.enabled ? this.disable() : this.enable(); }

  _bind(){
    this.hotspotLayer.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    window.addEventListener('pointermove', this._onPointerMove, { passive: false });
    window.addEventListener('pointerup',   this._onPointerUp,   { passive: false });
  }
  _unbind(){
    this.hotspotLayer.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup',   this._onPointerUp);
  }

  _observeHotspots(){
    if (this._observer) return;
    this._observer = new MutationObserver(this._onDomMutate);
    this._observer.observe(this.hotspotLayer, { childList: true, attributes: true, subtree: false });
  }
  _unobserveHotspots(){
    if (this._observer){ this._observer.disconnect(); this._observer = null; }
  }
  _onDomMutate(){
    if (!this.enabled) return;
    this._renderStaticLabels();
  }

  _buildToolbar(){
    const tb = document.createElement('div');
    tb.className = 'editor-toolbar';
    tb.style.position = 'absolute';
    tb.style.right = '10px';
    tb.style.top = '10px';
    tb.style.zIndex = '1000';
    tb.style.pointerEvents = 'auto'; // MUSÍ být klikací

    const btnCopy = document.createElement('button');
    btnCopy.textContent = 'Zkopírovat JSON';
    btnCopy.title = 'Zkopírovat poslední obdélník do schránky';
    btnCopy.addEventListener('click', ()=> this._copyJson());

    const btnRect = document.createElement('button');
    btnRect.textContent = 'Zobrazit JSON';
    btnRect.title = 'Zobraz JSON posledního obdélníku';
    btnRect.addEventListener('click', ()=> this._toggleJsonPanel());

    const btnInfo = document.createElement('button');
    btnInfo.textContent = 'Info o scéně';
    btnInfo.title = 'Zobrazí základní údaje o aktuální scéně';
    btnInfo.addEventListener('click', ()=>{
      const s = this.game.currentScene;
      alert(JSON.stringify({
        id: s.id,
        title: s.title,
        image: s.image,
        hotspotCount: (s.hotspots||[]).length
      }, null, 2));
    });

    tb.appendChild(btnCopy);
    tb.appendChild(btnRect);
    tb.appendChild(btnInfo);

    this.toolbar = tb;
    // KLÍČOVÉ: vložit do sceneContainer (sourozenec hotspotLayer), ne dovnitř hotspotLayer
    this.sceneContainer.appendChild(tb);
  }

  _removeToolbar(){
    if (this.toolbar?.parentNode) this.toolbar.parentNode.removeChild(this.toolbar);
    this.toolbar = null;
  }

  _hint(text){
    let hint = this.overlay.querySelector('.editor-hint');
    if (!hint){
      hint = document.createElement('div');
      hint.className = 'editor-hint';
      this.overlay.appendChild(hint);
    }
    hint.textContent = text;
  }

  _clientToPercent(ev){
    const container = this.hotspotLayer.getBoundingClientRect();
    const clamp = (v,min,max)=>Math.max(min, Math.min(max, v));
    const x = clamp((ev.clientX - container.left) / container.width, 0, 1);
    const y = clamp((ev.clientY - container.top) / container.height, 0, 1);
    return { x: +(x*100).toFixed(2), y: +(y*100).toFixed(2) };
  }

  _onPointerDown(ev){
    if (!this.enabled) return;

    // IGNORUJ kliky na toolbar/JSON panel — řeší „přebíjení“
    if (ev.target.closest('.editor-toolbar') || ev.target.closest('.editor-jsonpanel')) return;

    // u myši bereme jen levé tlačítko
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;

    ev.preventDefault();
    try { ev.currentTarget.setPointerCapture?.(ev.pointerId); } catch {}

    const p = this._clientToPercent(ev);
    this.dragging = { start:p, end:p };
    this._renderTemp();
  }
  _onPointerMove(ev){
    if (!this.dragging) return;
    ev.preventDefault();
    const p = this._clientToPercent(ev);
    this.dragging.end = p;
    this._renderTemp();
  }
  _onPointerUp(ev){
    if (!this.dragging) return;
    ev.preventDefault();
    const p = this._clientToPercent(ev);
    this.dragging.end = p;
    this._renderTemp();
    this.rect = this._currentRect();
    this.dragging = null;
    this._hint('Hotspot připraven. Klikni na „Zkopírovat JSON“ nebo „Zobrazit JSON“.');
    this._updateJsonPanel();
  }

  _currentRect(){
    const a = this.dragging?.start || {x:0,y:0}, b = this.dragging?.end || {x:0,y:0};
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    return { x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) };
  }

  _clearTemp(){
    this.overlay.querySelector('.temp')?.remove();
    this.overlay.querySelector('.temp-label')?.remove();
  }

  _renderTemp(){
    // Box
    let box = this.overlay.querySelector('.temp');
    if (!box){
      box = document.createElement('div');
      box.className = 'temp';
      box.style.position = 'absolute';
      box.style.border = '2px dashed rgba(0,200,255,.9)';
      box.style.background = 'rgba(0,200,255,.12)';
      this.overlay.appendChild(box);
    }
    const r = this._currentRect();
    box.style.left = r.x + '%';
    box.style.top = r.y + '%';
    box.style.width = r.w + '%';
    box.style.height = r.h + '%';

    // Štítek pro dočasný box (souřadnice)
    let lab = this.overlay.querySelector('.temp-label');
    if (!lab){
      lab = document.createElement('div');
      lab.className = 'hs-label temp-label';
      this.overlay.appendChild(lab);
    }
    lab.textContent = this._rectText(r);
    this._positionLabel(lab, r);
  }

  _clearLabels(){
    this.overlay.querySelectorAll('.hs-label').forEach(n => n.remove());
  }
  _renderStaticLabels(){
    // smaž staré (ať se neduplikuje)
    this.overlay.querySelectorAll('.hs-label:not(.temp-label)').forEach(n => n.remove());

    const scene = this.game.currentScene;
    if (!scene || !Array.isArray(scene.hotspots)) return;

    scene.hotspots.forEach(h => {
      const r = h.rect;
      if (!r) return;
      const lab = document.createElement('div');
      lab.className = 'hs-label';
      lab.textContent = this._rectText(r);
      this.overlay.appendChild(lab);
      this._positionLabel(lab, r);
    });
  }
  _positionLabel(el, rect){
    const pad = 0.6; // ~0.6%
    el.style.position = 'absolute';
    el.style.left = (rect.x + rect.w - pad) + '%';
    el.style.top  = (rect.y + rect.h - pad) + '%';
    el.style.transform = 'translate(-100%, -100%)';
  }
  _rectText(r){
    return `x:${r.x} y:${r.y} w:${r.w} h:${r.h}`;
  }

  _snippet(){
    const r = this.rect || this._currentRect();
    if (!r) return '';
    return JSON.stringify({
      type: "goTo", target: "scene_id", rect: { x: r.x, y: r.y, w: r.w, h: r.h }
    }, null, 2);
  }

  async _copyJson(){
    const str = this._snippet();
    if (!str) { alert('Nakresli nejdřív hotspot.'); return; }
    const ok = await this._copyText(str);
    if (ok) alert('JSON zkopírován do schránky.');
    else    alert('Kopírování selhalo. Otevři „Zobrazit JSON“ a zkopíruj ručně.');
  }

  async _copyText(text){
    try {
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  _toggleJsonPanel(){
    if (this.jsonPanel) { this._hideJsonPanel(); return; }
    this._showJsonPanel();
  }
  _showJsonPanel(){
    const panel = document.createElement('div');
    panel.className = 'editor-jsonpanel';
    panel.style.position = 'absolute';
    panel.style.left = '10px';
    panel.style.top  = '10px';
    panel.style.zIndex = '1001';
    panel.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    title.className = 'editor-jsonpanel-title';
    title.textContent = 'JSON obdélníku';

    const ta = document.createElement('textarea');
    ta.className = 'editor-jsonpanel-text';
    ta.rows = 6;
    ta.readOnly = true;
    ta.value = this._snippet() || '// Nakresli obdélník…';

    const row = document.createElement('div');
    row.className = 'editor-jsonpanel-actions';

    const btnCopy = document.createElement('button');
    btnCopy.textContent = 'Zkopírovat';
    btnCopy.addEventListener('click', async () => {
      const ok = await this._copyText(ta.value);
      if (!ok) alert('Nepodařilo se zkopírovat – zkopíruj prosím ručně.');
    });

    const btnClose = document.createElement('button');
    btnClose.textContent = 'Zavřít';
    btnClose.addEventListener('click', ()=> this._hideJsonPanel());

    row.appendChild(btnCopy);
    row.appendChild(btnClose);

    panel.appendChild(title);
    panel.appendChild(ta);
    panel.appendChild(row);

    this.jsonPanel = panel;

    // KLÍČOVÉ: panel patří do sceneContainer (ne do hotspotLayer)
    this.sceneContainer.appendChild(panel);
  }
  _hideJsonPanel(){
    if (this.jsonPanel?.parentNode) this.jsonPanel.parentNode.removeChild(this.jsonPanel);
    this.jsonPanel = null;
  }
  _updateJsonPanel(){
    if (!this.jsonPanel) return;
    const ta = this.jsonPanel.querySelector('.editor-jsonpanel-text');
    if (ta) ta.value = this._snippet() || '// Nakresli obdélník…';
  }
}
