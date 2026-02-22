# Engine Content Panel System

## Motivation

The engine currently supports **puzzles** (interactive challenges), **dialogs** (character conversations), and **toasts** (brief messages). However, there is no system for displaying **rich narrative content** — room descriptions, mission briefings, story text, instructions — in a visually appealing, translatable overlay.

Currently, room descriptions are baked into background images, which:
- Cannot be translated (i18n)
- Cannot be updated without regenerating images
- Are not accessible (screen readers, text scaling)
- Cannot be styled dynamically per game theme

**Goal:** A general-purpose Content Panel system that renders rich text (Markdown/HTML) in styled, semi-transparent overlay windows over scene backgrounds. This is a core engine feature — the engine will be offered commercially and games sold, so the design must be polished, extensible, and production-ready.

---

## Design Principles

1. **i18n-first** — All content supports `@key@fallback` translation pattern
2. **Consistent** — Follows existing engine patterns (JSON config, CSS theming, event actions)
3. **Flexible** — Multiple visual themes, positioning, and trigger modes
4. **Lightweight** — Minimal dependencies, fast rendering
5. **Accessible** — Keyboard navigable, screen-reader friendly, responsive
6. **Extensible** — Easy to add new themes, content types, and behaviors

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Game Config                        │
│  scenes.json ──► content definitions + triggers      │
│  i18n/*.json ──► translated content bodies           │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│               ContentPanel Module                    │
│  /engine/content.js                                  │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Renderer │  │ LayoutEngine │  │ ThemeManager  │  │
│  │ (MD→HTML)│  │ (positioning)│  │ (glass/solid) │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ PanelLifecycle: open → render → interact →   │    │
│  │   animate-out → close → resolve promise      │    │
│  └──────────────────────────────────────────────┘    │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│              Engine Integration                      │
│  - New action: "openContent" (in events/hotspots)    │
│  - New hotspot type: "content"                       │
│  - Scene property: "content" (auto-open on enter)    │
│  - State tracking: content.shown flags               │
└─────────────────────────────────────────────────────┘
```

---

## Content Definition Format

Content panels are defined inside `scenes.json` under a new top-level `"content"` section (object map), parallel to `"scenes"` and `"items"`:

```json
{
  "meta": { ... },
  "content": {
    "intro-briefing": {
      "id": "intro-briefing",
      "title": "@content.intro.title@Mise: Zachraňte reaktor",
      "format": "markdown",
      "body": "@content.intro.body@## Je rok 2140.\n\nVědecká stanice **THERMOS-7**...",
      "panel": {
        "rect": { "x": 3, "y": 3, "w": 45, "h": 94 },
        "theme": "glass",
        "backdrop": "dim",
        "scrollable": true,
        "animation": "fade-slide"
      },
      "buttons": {
        "ok": { "visible": true, "label": "@btn.continue@Pokračovat" }
      },
      "once": true
    }
  },
  "scenes": [ ... ],
  "events": [ ... ]
}
```

### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique content identifier |
| `title` | string | `""` | Panel title (supports i18n `@key@fallback`) |
| `format` | `"markdown"` \| `"html"` \| `"text"` | `"markdown"` | Content format |
| `body` | string | required | Content body (supports i18n) |
| `panel.rect` | `{x,y,w,h}` | `{x:5,y:5,w:45,h:90}` | Panel position in % of viewport |
| `panel.theme` | string | `"glass"` | Visual theme (see Themes section) |
| `panel.backdrop` | `"blur"` \| `"dim"` \| `"none"` | `"dim"` | Background treatment |
| `panel.scrollable` | boolean | `true` | Enable vertical scrolling |
| `panel.animation` | `"fade"` \| `"fade-slide"` \| `"none"` | `"fade"` | Show/hide animation |
| `buttons.ok` | object | `{visible:true, label:"OK"}` | Dismiss button config |
| `once` | boolean | `false` | Show only once per game session |

---

## Supported Content Formats

### 1. Markdown (`format: "markdown"`)

Primary format for content authoring. Rendered to HTML using a lightweight parser.

**Supported Markdown features:**
- Headings (`#`, `##`, `###`)
- Bold (`**text**`), Italic (`*text*`)
- Paragraphs (blank line separated)
- Unordered lists (`-`, `*`)
- Ordered lists (`1.`, `2.`)
- Inline code (`` `code` ``)
- Images (`![alt](url)`)
- Horizontal rules (`---`)
- Line breaks (`\n\n`)
- Blockquotes (`> text`)

**Example:**
```json
{
  "format": "markdown",
  "body": "@room1.body@## Řídicí centrum\n\nŘídicí systém hlásí **nejasnosti** v definicích tepla.\n\n- Ověř základní znalosti\n- Oprav chybné definice\n- Odemkni přístup k další sekci"
}
```

### 2. HTML (`format: "html"`)

For advanced layouts where Markdown is insufficient.

```json
{
  "format": "html",
  "body": "@room1.body@<h2>Řídicí centrum</h2><p>Řídicí systém hlásí <strong>nejasnosti</strong>...</p>"
}
```

**Security:** HTML is sanitized — only safe tags/attributes allowed (no `<script>`, no `onclick`, no external resources unless from game assets).

### 3. Plain Text (`format: "text"`)

Simple text with automatic paragraph wrapping.

```json
{
  "format": "text",
  "body": "@room1.body@Řídicí systém hlásí nejasnosti v definicích tepla."
}
```

---

## Visual Themes

### Built-in Themes

#### `glass` (default)
Semi-transparent panel with backdrop blur. Best for immersive scenes.
```css
.cp-panel--glass {
  background: rgba(10, 15, 30, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

#### `solid`
Opaque panel with defined background. Best for text-heavy content.
```css
.cp-panel--solid {
  background: var(--cp-bg, #1a1d2e);
  border: 1px solid var(--cp-border, rgba(255,255,255,0.1));
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
}
```

#### `minimal`
Clean panel with subtle styling. Best for brief messages.
```css
.cp-panel--minimal {
  background: rgba(0, 0, 0, 0.65);
  border-radius: 8px;
  padding: 1.5rem;
}
```

### Custom Theme via CSS Variables

Games can override panel styling through CSS custom properties in their `game.css`:

```css
/* game.css */
.cp-panel {
  --cp-bg: rgba(30, 10, 5, 0.85);
  --cp-text: #ece9e0;
  --cp-heading: #ff6b35;
  --cp-accent: #e8652e;
  --cp-border: rgba(232, 101, 46, 0.2);
  --cp-btn-bg: #e8652e;
  --cp-btn-text: #fff;
  --cp-scrollbar: rgba(232, 101, 46, 0.3);
  --cp-blockquote-border: #e8652e;
  --cp-code-bg: rgba(255, 255, 255, 0.08);
}
```

---

## DOM Structure

```html
<!-- Appended to #hotspotLayer or body -->
<div class="cp-container" role="dialog" aria-modal="true" aria-labelledby="cp-title-{id}">

  <!-- Backdrop (click to dismiss optional) -->
  <div class="cp-backdrop cp-backdrop--{dim|blur|none}"></div>

  <!-- Panel (positioned via rect %) -->
  <div class="cp-panel cp-panel--{theme}"
       style="left:{x}%; top:{y}%; width:{w}%; height:{h}%">

    <!-- Header -->
    <div class="cp-header" data-id="header">
      <h2 class="cp-title" id="cp-title-{id}">{title}</h2>
    </div>

    <!-- Body (scrollable content area) -->
    <div class="cp-body" data-id="body" tabindex="0">
      <!-- Rendered Markdown/HTML content -->
      <div class="cp-content">
        <h2>Heading</h2>
        <p>Paragraph with <strong>bold</strong> and <em>italic</em>.</p>
        <ul>
          <li>List item</li>
        </ul>
        <img src="assets/diagram.png" alt="Diagram">
      </div>
    </div>

    <!-- Footer -->
    <div class="cp-footer" data-id="footer">
      <button class="cp-btn cp-btn--ok">{ok.label}</button>
    </div>
  </div>
</div>
```

---

## Engine Integration

### 1. New Action: `openContent`

Added to the engine's action system alongside existing actions (`toast`, `openDialog`, `playVideo`, etc.):

```json
// In events
{
  "id": "evt-room1-intro",
  "when": {
    "on": "enterScene",
    "scene": "room-1"
  },
  "once": true,
  "then": {
    "openContent": "content-room1"
  }
}
```

### 2. New Hotspot Type: `content`

```json
// In scene hotspots
{
  "type": "content",
  "rect": { "x": 5, "y": 5, "w": 10, "h": 10 },
  "contentRef": "room-1-info",
  "label": "ℹ️"
}
```

### 3. Scene Auto-Content

Scenes can specify content to show automatically on entry:

```json
{
  "id": "room-1",
  "image": "assets/scenes/room-1.jpg",
  "content": {
    "ref": "content-room1",
    "trigger": "enter",
    "once": true
  },
  "hotspots": [ ... ]
}
```

---

## Module API

### `ContentPanel` class (`/engine/content.js`)

```javascript
class ContentPanel {
  constructor(game) {
    this.game = game;
    // Reference to engine for i18n, state, asset resolution
  }

  /**
   * Open a content panel by its ID.
   * Returns a Promise that resolves when the panel is dismissed.
   *
   * @param {string} contentId - ID from content definitions
   * @param {object} [overrides] - Optional runtime overrides (rect, theme, etc.)
   * @returns {Promise<void>}
   */
  async open(contentId, overrides = {}) { ... }

  /**
   * Close the currently open panel (if any).
   */
  close() { ... }

  /**
   * Check if a content panel is currently visible.
   * @returns {boolean}
   */
  get isOpen() { ... }
}
```

### Integration in `engine.js`

```javascript
// In Game constructor
this.contentPanel = new ContentPanel(this);

// In _applyActions()
if (actions.openContent) {
  await this.contentPanel.open(actions.openContent);
}

// In _activateHotspot() for type "content"
case 'content':
  await this.contentPanel.open(hotspot.contentRef);
  break;
```

---

## Markdown Renderer

### Option A: Lightweight Built-in Parser (Recommended)

A minimal Markdown-to-HTML renderer (~2-3 KB) built into the engine. Supports the subset of Markdown features needed for game content (headings, bold, italic, lists, paragraphs, images, blockquotes).

**Advantages:**
- Zero external dependencies
- Full control over output HTML/sanitization
- Smaller bundle size
- No supply-chain risk

**Implementation approach:**
```javascript
function renderMarkdown(md) {
  let html = md
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + Italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Lists and paragraphs (multi-pass)
    ...
  return html;
}
```

### Option B: External Library (`marked`)

Use the MIT-licensed `marked` library (~32 KB minified, ~8 KB gzipped).

**Advantages:**
- Full CommonMark spec compliance
- Battle-tested, widely used
- Supports extensions/plugins

**Disadvantages:**
- External dependency
- Larger bundle
- Needs HTML sanitization layer on top

### Recommendation

**Option A** for the initial implementation — a focused, minimal parser that covers the subset we need. This keeps the engine dependency-free and bundle-small. Can be upgraded to Option B later if full CommonMark support is needed.

---

## CSS Stylesheet

New file: `/engine/content.css` (or section in existing engine CSS)

```css
/* ── Container ── */
.cp-container {
  position: absolute;
  inset: 0;
  z-index: 7500;
  pointer-events: auto;
}

/* ── Backdrop variants ── */
.cp-backdrop {
  position: absolute;
  inset: 0;
}
.cp-backdrop--dim {
  background: rgba(0, 0, 0, 0.4);
}
.cp-backdrop--blur {
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.cp-backdrop--none {
  pointer-events: none;
}

/* ── Panel ── */
.cp-panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  color: var(--cp-text, #ece9e0);
  font-family: var(--cp-font, inherit);
  overflow: hidden;
  /* Animation */
  opacity: 0;
  transform: translateX(-8px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.cp-panel.cp-panel--visible {
  opacity: 1;
  transform: translateX(0);
}

/* ── Header ── */
.cp-header {
  padding: 1.25rem 1.5rem 0.5rem;
  flex-shrink: 0;
}
.cp-title {
  margin: 0;
  font-size: 1.4em;
  font-weight: 700;
  color: var(--cp-heading, inherit);
  letter-spacing: 0.02em;
}

/* ── Body ── */
.cp-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0.5rem 1.5rem 1rem;
  scroll-behavior: smooth;
  overscroll-behavior: contain;
}
.cp-body::-webkit-scrollbar {
  width: 6px;
}
.cp-body::-webkit-scrollbar-thumb {
  background: var(--cp-scrollbar, rgba(255,255,255,0.2));
  border-radius: 3px;
}

/* ── Rendered content typography ── */
.cp-content h1, .cp-content h2, .cp-content h3 {
  color: var(--cp-heading, inherit);
  margin: 1em 0 0.5em;
  line-height: 1.3;
}
.cp-content h1 { font-size: 1.5em; }
.cp-content h2 { font-size: 1.3em; }
.cp-content h3 { font-size: 1.1em; }

.cp-content p {
  margin: 0.6em 0;
  line-height: 1.65;
}

.cp-content strong {
  color: var(--cp-accent, inherit);
  font-weight: 700;
}

.cp-content em {
  font-style: italic;
  opacity: 0.9;
}

.cp-content ul, .cp-content ol {
  margin: 0.5em 0;
  padding-left: 1.5em;
}
.cp-content li {
  margin: 0.3em 0;
  line-height: 1.5;
}

.cp-content blockquote {
  border-left: 3px solid var(--cp-blockquote-border, rgba(255,255,255,0.2));
  margin: 0.8em 0;
  padding: 0.5em 1em;
  opacity: 0.85;
  font-style: italic;
}

.cp-content code {
  background: var(--cp-code-bg, rgba(255,255,255,0.08));
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-size: 0.9em;
}

.cp-content img {
  max-width: 100%;
  border-radius: 8px;
  margin: 0.8em 0;
}

.cp-content hr {
  border: none;
  border-top: 1px solid rgba(255,255,255,0.1);
  margin: 1.2em 0;
}

/* ── Footer ── */
.cp-footer {
  padding: 0.75rem 1.5rem 1rem;
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

.cp-btn {
  padding: 0.6em 1.6em;
  border: none;
  border-radius: 8px;
  font-size: 0.95em;
  font-weight: 600;
  cursor: pointer;
  background: var(--cp-btn-bg, rgba(255,255,255,0.12));
  color: var(--cp-btn-text, inherit);
  transition: background 0.2s, transform 0.15s;
}
.cp-btn:hover {
  background: var(--cp-btn-bg-hover, rgba(255,255,255,0.2));
  transform: scale(1.02);
}
.cp-btn:active {
  transform: scale(0.98);
}

/* ── Animations ── */
.cp-container--entering .cp-backdrop {
  animation: cp-fade-in 0.25s ease forwards;
}
.cp-container--leaving .cp-backdrop {
  animation: cp-fade-out 0.2s ease forwards;
}
.cp-container--leaving .cp-panel {
  opacity: 0;
  transform: translateX(-8px);
}

@keyframes cp-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes cp-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* ── Responsive ── */
@media (max-width: 720px) {
  .cp-panel {
    /* On mobile: full width, bottom-anchored */
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    top: auto !important;
    width: 100% !important;
    max-height: 80vh;
    border-radius: 14px 14px 0 0;
  }
}

/* ── Touch/iPad ── */
.cp-body {
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}
.cp-btn {
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
```

---

## i18n Integration

All text content uses the existing `@key@fallback` pattern:

### In scenes.json (content definitions):
```json
{
  "title": "@content.room1.title@Řídicí centrum",
  "body": "@content.room1.body@## Řídicí centrum\n\nŘídicí systém hlásí..."
}
```

### In i18n/cs.json:
```json
{
  "content.room1.title": "Řídicí centrum",
  "content.room1.body": "## Řídicí centrum\n\nŘídicí systém hlásí..."
}
```

### In i18n/en.json:
```json
{
  "content.room1.title": "Control Center",
  "content.room1.body": "## Control Center\n\nThe control system reports..."
}
```

The `body` field is a single i18n string — the entire Markdown/HTML block is one translatable unit. This keeps translations manageable (translators work with complete text blocks, not individual fragments).

---

## State Management

### Tracking "once" content panels

Content panels with `"once": true` are tracked in `state.contentShown`:

```javascript
// In engine state
state.contentShown = {
  "intro-briefing": true,
  "room-1-desc": true
}
```

Before opening:
```javascript
if (contentDef.once && state.contentShown[contentId]) {
  return; // Already shown, skip
}
```

After closing:
```javascript
if (contentDef.once) {
  state.contentShown[contentId] = true;
  this._saveState();
}
```

---

## Implementation Plan

### Step 1: Markdown Renderer
- Create `/engine/content-renderer.js`
- Implement minimal Markdown → HTML converter
- Support: headings, bold, italic, paragraphs, lists, images, blockquotes, hr, inline code
- HTML sanitization for `format: "html"`
- Unit tests for renderer

### Step 2: ContentPanel Class
- Create `/engine/content.js`
- Implement: `constructor(game)`, `open(id, overrides)`, `close()`, `isOpen`
- DOM creation, mounting into hotspot layer
- Animation lifecycle (enter → visible → leave → remove)
- Promise-based open/close
- i18n resolution via `game._text()`
- Theme application via CSS classes + custom properties
- Backdrop handling
- Keyboard support (Escape to close, Tab trapping)

### Step 3: CSS Stylesheet
- Create `/engine/content.css`
- All theme variants (glass, solid, minimal)
- Typography for rendered Markdown content
- Responsive mobile layout
- Animation keyframes
- Scrollbar styling
- Touch/iPad compatibility

### Step 4: Engine Integration
- Add `openContent` to `_applyActions()` in engine.js
- Add `"content"` hotspot type to `_activateHotspot()`
- Add scene `content` property handling in `goto()`
- Add `contentShown` to state save/load
- Load content definitions from scenes.json `content` section

### Step 5: Testing
- Test all three formats (markdown, html, text)
- Test all themes (glass, solid, minimal)
- Test all backdrops (blur, dim, none)
- Test `once: true` behavior
- Test on desktop + iPad/mobile
- Test with i18n (multiple languages)
- Test keyboard accessibility
- Test within game flow (event triggers, hotspot triggers, scene auto-open)

---

## File Changes Summary

| File | Change |
|------|--------|
| `/engine/content-renderer.js` | NEW — Markdown → HTML renderer |
| `/engine/content.js` | NEW — ContentPanel class |
| `/engine/content.css` | NEW — Panel styles and themes |
| `/engine/engine.js` | MODIFY — Add ContentPanel init, action handler, hotspot type, state tracking |
| `/index.html` | MODIFY — Add `<link>` for content.css |

---

## Future Extensions (Out of Scope for v1)

- **Paginated content** — Multi-page panels with prev/next navigation
- **Embedded media** — Video/audio within content panels
- **Interactive elements** — Clickable links that trigger actions
- **Typewriter effect** — Gradual text reveal (like dialog system)
- **Content sequencing** — Chain multiple panels in order
- **Print/export** — Export content for offline reading
- **Rich block format** — Structured JSON blocks as alternative to Markdown
