# Escape Game Engine

A **no-build**, iPad-friendly **escape game framework** in plain HTML/CSS/JS.  
Create sophisticated point-and-click adventures with **Puzzles 2.0**, **dialogs**, **theming system**, and an **in-browser editor**.

- **Demo (GitHub Pages):**
  - https://raven2cz.github.io/escape-game-engine/index.html?game=leeuwenhoek&lang=cs&debug=1&hero=adam&reset=1 (two heroes: "adam" and "eva", adam selected)
  - https://raven2cz.github.io/escape-game-engine/index.html?game=leeuwenhoek&lang=cs&debug=1&hero=eva&reset=1 (two heroes: "adam" and "eva", eva selected)
  - https://raven2cz.github.io/escape-game-engine/index.html?game=stop-train&lang=cs&debug=1&reset=1 
  - https://raven2cz.github.io/escape-game-engine/index.html?game=time-factory&lang=cs&debug=1&reset=1
  - https://raven2cz.github.io/escape-game-engine/index.html?game=reactor&lang=cs&debug=1&reset=1
- **PWA:** `?pwa=1` exists but does nothing today, see the note under iPad & Mobile (EI-007).

---

## ✨ Features

### Core Engine
- **Scene Management**: Navigate between scenes with hotspots (`goTo`, `pickup`, `puzzle`, `dialog`)
- **Inventory System**: Collect items with image/description inspect modals
- **State Management**: Use flags and `requireItems`/`requireFlags` to lock doors or reveal secret paths
- **Event System**: Trigger action chains on entering a scene (`enterScene`) or on any state change (`stateChange`)
- **Hero Profiles**: Support for multiple playable characters with custom avatars and names
- **Internationalization (i18n)**: Multi-language support with `@key@fallback` syntax
- **PWA Support**: present but not working today, see the note under iPad & Mobile (EI-007)

### Puzzles 2.0 System
Nine built-in puzzle types with unified theming and layout system:

- **`phrase`**: Text answer (diacritics/case-insensitive)
- **`code`**: Numeric/alphanumeric code (optional password mask)
- **`order`**: Arrange tokens into correct sequence
- **`match`**: Match pairs (columns or drag-and-drop mode)
- **`quiz`**: Multiple-choice questions (single or multi-select)
- **`choice`**: Select from options or fill editable fields
- **`group`**: Sort tokens into categories
- **`cloze`**: Fill-in-the-blank text exercises
- **`list`**: Sequential puzzle chains with summary screen

#### Puzzle Features
- **Universal Theming**: Hierarchical CSS variables cascade from engine → game → puzzle → token
- **Flexible Layouts**: AUTO (responsive vertical/horizontal/grid) or MANUAL (absolute positioning)
- **Aggregate Mode**: Collect results without immediate feedback for list sequences
- **Block Until Solved**: Require puzzle completion before proceeding
- **Success/Fail Actions**: Award items, set flags, display messages, navigate scenes

### Dialog System
- **Character Profiles**: Define characters with multiple poses and expressions
- **Hero Alias**: Special "hero" character auto-maps to the selected player profile
- **Choice-Based Dialogs**: Interactive branching through `choices` and `onChoose` (jump, set flags, end)
- **Typewriter Text**: Per-dialog, with tap to skip to the end of the line
- **Blocking**: `openDialog` does not return until the dialog is closed, so an event can wait for it

### Editor Tools
- **Hotspot Editor**: Draw rectangles, live coordinate labels in percent
- **Puzzle Editor**: Visual positioning for AUTO (window rect) or MANUAL (component layout)
- **JSON Export**: Copy complete hotspot/puzzle JSON or just rect coordinates
- **Real-time Labels**: See `x,y,w,h` values while dragging
- **Keyboard Support**: Delete/Backspace to remove selected elements

---

## 📁 Project Structure

```
escape-game-engine/
├── index.html              # Main entry point
├── styles/
│   ├── style.css          # Global app styles
│   └── puzzles.css        # Puzzles 2.0 framework (semi-transparent colors)
├── engine/
│   ├── engine.js          # Core runtime (scenes, inventory, flags, events, state)
│   ├── dialogs.js         # Dialog system with character management
│   ├── content.js         # Content panels
│   ├── content-renderer.js# Markdown/HTML rendering for panels
│   ├── editor.js          # In-browser editor (draw hotspots, export JSON)
│   ├── i18n.js            # Engine internationalization strings
│   ├── i18n-helpers.js    # @key@fallback resolution
│   ├── utils.js           # Text normalization for answer checking
│   └── puzzles/
│       ├── index.js       # Puzzle runner factory and kind registry
│       ├── base.js        # Shared puzzle infrastructure
│       ├── layout.js      # AUTO layout algorithm
│       └── kinds/
│           ├── phrase.js  # Text input puzzle
│           ├── code.js    # Code entry puzzle
│           ├── order.js   # Token sequencing puzzle
│           ├── match.js   # Pair matching puzzle
│           ├── quiz.js    # Multiple choice quiz
│           ├── choice.js  # Choice/fill-in puzzle
│           ├── group.js   # Category sorting puzzle
│           ├── cloze.js   # Fill-in-the-blank puzzle
│           └── list.js    # Puzzle sequence manager
├── games/
│   ├── <game-id>/
│   │   ├── scenes.json    # Scenes, hotspots, items, events, content
│   │   ├── puzzles.json   # Puzzle configurations
│   │   ├── dialogs.json   # Dialog trees (optional)
│   │   ├── i18n/
│   │   │   ├── cs.json    # Czech translations
│   │   │   └── en.json    # English translations
│   │   ├── game.css       # Per-game theme overrides (optional)
│   │   └── assets/        # Images, video, backgrounds
│   └── tests/             # Vitest suite, including the reload harness
├── plans/                 # Defect registry and stabilization plan
├── service-worker.js      # PWA offline cache (not working, see EI-007)
└── manifest.webmanifest   # PWA manifest
```

---

## 🚀 Quick Start

### 1. Local Development
```bash
# Serve locally (Python 3)
python3 -m http.server 5500

# Or use any static server
# Open http://localhost:5500/
```

### 2. Create a Hotspot
1. Toggle **✎ Edit** mode
2. Draw a rectangle on the scene
3. Click **Copy JSON** or **Rect JSON** to get:

```json
{
  "type": "pickup",
  "itemId": "glass_key",
  "rect": { "x": 72, "y": 58, "w": 8, "h": 10 }
}
```

4. Paste into `games/<your-game>/scenes.json` under the current scene

### 3. Add a Puzzle
Define in `games/<your-game>/puzzles.json`:

```json
{
  "my-puzzle": {
    "id": "my-puzzle",
    "kind": "phrase",
    "title": "Enter the secret phrase",
    "prompt": "What did Anton say?",
    "solution": "microscopy is life",
    "options": {
      "aggregateOnly": false,
      "blockUntilSolved": true
    }
  }
}
```

Reference in a hotspot. The field is `puzzleRef`; a `puzzle` hotspot without it
logs an error and opens nothing:
```json
{
  "type": "puzzle",
  "puzzleRef": "my-puzzle",
  "rect": { "x": 40, "y": 30, "w": 20, "h": 15 }
}
```

### 4. Create a Dialog
Define in `games/<your-game>/dialogs.json`:

```json
{
  "characters": [
    {
      "id": "professor",
      "name": "Prof. Leeuwenhoek",
      "poses": {
        "neutral": "assets/characters/prof-neutral.png",
        "happy": "assets/characters/prof-happy.png"
      }
    }
  ],
  "dialogs": [
    {
      "id": "intro",
      "left": {
        "characterId": "hero",
        "defaultPose": "neutral"
      },
      "right": {
        "characterId": "professor",
        "defaultPose": "neutral"
      },
      "sequence": [
        {
          "speaker": "right",
          "text": "Welcome to my laboratory!",
          "pose": "happy"
        },
        {
          "speaker": "left",
          "text": "Thank you, Professor!"
        }
      ]
    }
  ]
}
```

Trigger from hotspot:
```json
{
  "type": "dialog",
  "dialogId": "intro",
  "rect": { "x": 50, "y": 60, "w": 10, "h": 15 }
}
```

---

## 🎨 Theming

### Puzzle Theming Hierarchy
Puzzles 2.0 uses cascading CSS variables:

```
engine defaults (puzzles.css)
  ↓ override via game.css
  ↓ override via puzzle.theme in JSON
  ↓ override via token.style in JSON
```

### Example: Custom Puzzle Theme
In `puzzles.json`:

```json
{
  "my-puzzle": {
    "kind": "phrase",
    "options": {
      "theme": {
        "vars": {
          "--pz-token-bg": "rgba(100, 200, 255, 0.15)",
          "--pz-token-border": "rgba(100, 200, 255, 0.4)"
        },
        "title": {
          "fontSize": "1.5em",
          "color": "rgba(255, 255, 255, 0.95)"
        }
      }
    }
  }
}
```

### Per-Game Global Theme
Create `games/<your-game>/game.css`:

```css
:root {
  --app-bg: #1a1a2e;
  --app-text: #e0e0e0;
  --inventory-item-bg: rgba(255, 255, 255, 0.08);
}

/* Override puzzle defaults */
.pz {
  --pz-token-bg: rgba(50, 150, 200, 0.12);
  --pz-token-border: rgba(50, 150, 200, 0.35);
}
```

---

## 🌍 Internationalization

### Engine Strings
Edit `engine/i18n.js` for core UI strings (inventory, modals, buttons).

### Game Strings
Create translation files in `games/<your-game>/i18n/`:

**`cs.json`**:
```json
{
  "lh.pz.lensTitle": "Sestav větu",
  "lh.pz.lensPrompt": "Zadej větu, kterou jsi odvodil z indicií."
}
```

**`en.json`**:
```json
{
  "lh.pz.lensTitle": "Compose the sentence",
  "lh.pz.lensPrompt": "Enter the sentence you deduced from the clues."
}
```

### Usage in JSON
Use `@key@fallback` syntax:

```json
{
  "title": "@lh.pz.lensTitle@Assemble the sentence",
  "prompt": "@lh.pz.lensPrompt@Enter the deduced sentence."
}
```

The engine loads the translation for current language, falling back to the text after `@` if key not found.

### Change Language
Add `?lang=en` to URL or modify `index.html` default.

---

## 📱 iPad & Mobile

### Touch Support
- All puzzles support touch/pen/mouse input
- Drag-and-drop works on touch devices
- Editor overlay supports touch drawing

### PWA installation

> **Not working today.** 15 of the 19 paths in the service worker's precache list
> do not exist, and `cache.addAll()` is atomic, so installation always fails and
> `?pwa=1` is a silent no-op. Whether the service worker is repaired or removed
> is an open decision (EI-007 in `plans/OPEN-ITEMS.md`); offline play and a
> per-lesson licence pull in opposite directions. Do not rely on any of this.

The intended flow, once that is settled:

1. Add `?pwa=1` to the URL
2. Open in Safari/Chrome
3. Tap "Add to Home Screen"

### Offline updates
When updating code, bump `CACHE_NAME` in `service-worker.js`:

```javascript
const CACHE_NAME = 'escape-game-engine-v4'; // increment version
```

---

## 🎮 Advanced Features

### Action bundles
`onApply`, `onSuccess` and `onFail` take **one object**, not a list, and the
engine runs its keys in a fixed order regardless of how they are written:

```json
{
  "onSuccess": {
    "toast":            { "text": "You found the key!", "ms": 4000 },
    "message":          "The lock clicks open.",
    "openDialog":       "victory_dialog",
    "openContent":      "note-about-locks",
    "highlightHotspot": { "sceneId": "corridor", "rect": { "x": 30, "y": 50, "w": 15, "h": 20 }, "ms": 3000 },
    "playVideo":        { "src": "assets/video/door.mp4", "mode": "fullscreen", "allowSkip": true },
    "giveItem":         "golden_key",
    "setFlags":         ["lab_unlocked"],
    "clearFlags":       ["first_visit"],
    "goTo":             "laboratory"
  }
}
```

The order is: `toast` → `message` → `openDialog` → `openContent` →
`highlightHotspot` → `playVideo` → `giveItem` → `setFlags` → `clearFlags` →
`goTo`. `openDialog`, `openContent` and `playVideo` block: nothing after them
runs until the pupil has clicked through. `giveItem` accepts a single id or an array.
`setFlags` and `clearFlags` accept a single name, an array of names, or an
object of `{ "flag": true|false }`.

### Events
Events live at the top level of `scenes.json` and fire on `enterScene` or on any
state change:

```json
{
  "events": [
    {
      "id": "found-the-chest",
      "once": true,
      "when": {
        "on": "stateChange",
        "scene": "treasure-room",
        "requireItems": ["brass_key"],
        "requireFlags": ["lamp_lit"],
        "missingItems": ["golden_key"]
      },
      "then": {
        "setFlags": ["chest_opened"],
        "setSceneImage": { "sceneId": "treasure-room", "image": "assets/chest-open.jpg" },
        "openDialog": { "id": "chest.opened" },
        "openPuzzle": { "ref": "bonus_puzzle", "onSuccess": { "giveItem": "gem" } }
      }
    }
  ]
}
```

`when.on` is `enterScene` or `stateChange`. `missingItems` matches only while the
player has **none** of the listed items. In `then`, `setFlags` is applied and
saved **before** the event is marked as done, so a reload part way through cannot
lose it; the rest is presentation and may be interrupted. Note that
`openPuzzle` takes `ref`, while a `puzzle` *hotspot* takes `puzzleRef`.

There is no `onEnter`/`onExit` on a scene and no `delay` action. Use an event
with `"on": "enterScene"`, and `playVideo.delay` for a pause before a video.

### Locked hotspots
A `goTo` hotspot names its destination in `target`. Requirements are checked when
the hotspot is activated, not when it is drawn, so the hotspot stays visible and
tells the player what is missing:

```json
{
  "type": "goTo",
  "target": "secret_room",
  "requireItems": ["brass_key", "cipher_note"],
  "requireFlags": ["password_entered"],
  "rect": { "x": 70, "y": 40, "w": 15, "h": 30 }
}
```

The message shown when a requirement is unmet comes from the engine
(`engine.missingItems`, `engine.needUnlock`) and can be overridden per game
through i18n. There is no per-hotspot `missingMessage`.

To change how a hotspot *looks* as the state changes, give it `states`. The
first entry whose `requireFlags` are all satisfied wins, and an entry with no
`requireFlags` is the fallback:

```json
{
  "type": "apply",
  "rect": { "x": 8, "y": 62, "w": 12, "h": 22 },
  "acceptItems": [{ "id": "grav-key", "consume": true }],
  "onApply": { "setFlags": ["slot_gravity_ok"] },
  "states": [
    { "requireFlags": ["slot_gravity_ok"], "cssClass": "state-success", "content": "✓", "clickable": false },
    { "cssClass": "state-empty" }
  ]
}
```

### Hero profiles
A game that wants a playable character defines its heroes in `scenes.json` and
picks a default. A game that defines none has no hero, and the engine does not
invent one:

```json
{
  "heroes": {
    "adam": { "id": "adam", "gender": "m", "name": "@hero.adam@Adam", "assetsBase": "assets/npc/adam/" },
    "eva":  { "id": "eva",  "gender": "f", "name": "@hero.eva@Eva",   "assetsBase": "assets/npc/eva/" }
  },
  "defaultHero": "adam"
}
```

`setHero()` takes the **id**, not an object:

```javascript
window.__game.setHero('eva');   // or open the game with ?hero=eva
```

Dialogs use the selected hero wherever `characterId: "hero"` appears. In the
`hero` character template, `{heroId}` and `{heroBase}` in a pose path are
replaced with the hero's id and `assetsBase`, and so is a `/hero/` segment. Those
are the only two placeholders; there is nothing for the name, so write the name
you want as normal text or an `@key@fallback`.

If a game defines a character whose id equals the selected hero's id, that
character is used directly and the template is ignored.

A game that defines no heroes and still uses `characterId: "hero"` gets the
template with `{heroBase}` replaced by nothing, so the portrait will not resolve.
Either define heroes or use a normal character.

### Using an item on a hotspot
1. Tap an inventory item → the inspect panel opens
2. Tap **Použít** → use mode, the item is held
3. Tap a hotspot that accepts it, **or** drag the item straight onto the hotspot
4. Escape leaves use mode

A hotspot accepts items through `acceptItems`. Any hotspot type can have it; the
item branch runs before the type is even looked at. `consume: true` removes the
item when it is used:

```json
{
  "items": [
    {
      "id": "screwdriver",
      "label": "@item.screwdriver.label@Screwdriver",
      "icon": "assets/items/screwdriver.png",
      "meta": {
        "word": "screwdriver",
        "description": "@item.screwdriver.desc@A flathead screwdriver."
      }
    }
  ],
  "hotspots": [
    {
      "type": "apply",
      "rect": { "x": 40, "y": 55, "w": 12, "h": 10 },
      "acceptItems": [{ "id": "screwdriver", "consume": true }],
      "onApply": {
        "message": "You opened the panel!",
        "setFlags": ["panel_open"]
      }
    }
  ]
}
```

Item fields are `label`, `icon` and `meta`; `name`, `image` and a top-level
`description` are ignored. `acceptItems` may also be a plain list of ids
(`["screwdriver"]`), which means the item is not consumed. There is no `onUse`
map and no `consumeItem` action, and there is no `inspect` hotspot type -
inspecting happens from the inventory, not from the scene.

---

## 🛠️ Editor Workflow

### Hotspot Editor
1. **Enable**: Click **✎ Edit** button
2. **Draw**: Click-drag on scene to create rectangle
3. **Resize**: Drag corner handles (NW, NE, SW, SE) or edge handles
4. **Move**: Drag center area
5. **Delete**: Press Delete/Backspace with rectangle selected
6. **Export**: Click **Copy JSON** for complete hotspot or **Rect JSON** for just coordinates

### Puzzle Editor (AUTO Layout)
For puzzles with `layout: { mode: "auto" }`:

1. Enable editor while puzzle is open
2. Adjust yellow window rectangle (puzzle viewport)
3. Components auto-flow inside window
4. Copy the rect into the puzzle's top-level `rect` (not `options.rect`)

### Puzzle Editor (MANUAL Layout)
For puzzles with `layout: { mode: "manual" }`:

1. Enable editor while puzzle is open
2. Each component gets purple overlay with `[data-id]`
3. Position/resize components individually
4. Export generates complete positioning JSON
5. Paste into puzzle config `tokens[].rect`

---

## 🚢 Deploy on GitHub Pages

1. Push repository to GitHub
2. **Settings** → **Pages**
3. **Source**: Deploy from a branch
4. **Branch**: `main` | **Folder**: `/ (root)`
5. **Save**
6. Open `https://<username>.github.io/<repo-name>/`

### Multi-Game Setup
Use `?game=<game-id>` parameter:
```
https://username.github.io/repo/?game=leeuwenhoek
https://username.github.io/repo/?game=mystery-manor
```

Each game lives in `games/<game-id>/` directory.

---

## 🧪 Testing

Run unit tests:
```bash
npm install
npm test
```

Vitest with jsdom. Everything lives in `games/tests/`, and CI runs it on every
push and pull request.

Two things are worth knowing before adding a test:

- **`games/tests/helpers/reload.js`** simulates a page reload. `boot()` builds a
  fresh `Game` on a fresh DOM that reads nothing but what was persisted;
  `bootDetached()` does the same without awaiting `init()`, which is how a run is
  stopped at a point where the engine is blocked on the player. Anything about
  what survives a reload goes through it.
- **Data tests** (`games.data.test.js`, `readme.contract.test.js`,
  `engine.neutrality.test.js`) check the shipped games, this document and the
  engine rather than a unit of code. They catch the class of defect where nothing
  is wrong with the code: a game that cannot signal it was finished, a documented
  field the engine ignores, a game's name hardcoded into the engine.

---

## 📝 Configuration Reference

### scenes.json

Everything below is read by the engine. `meta.id` and `meta.version` together
decide whether a saved game is still valid, so bumping the version starts every
team over; the other `meta` fields are for people, not for the engine.

```json
{
  "meta": {
    "id": "my-game",
    "name": "The Mystery of the Brass Key",
    "description": "A one-lesson escape room.",
    "author": "Your Name",
    "version": "1.0.0",
    "tags": ["history"],
    "languages": ["cs"]
  },
  "startScene": "entry_hall",

  "items": [
    {
      "id": "brass_key",
      "label": "@item.brassKey.label@Brass Key",
      "icon": "assets/items/brass_key.png",
      "meta": {
        "word": "key",
        "description": "@item.brassKey.desc@An old brass key."
      }
    }
  ],

  "content": {
    "mission-briefing": {
      "id": "mission-briefing",
      "title": "Your mission",
      "format": "markdown",
      "body": "## Find the key\n\nAnd get out.",
      "panel": { "rect": { "x": 10, "y": 10, "w": 80, "h": 80 } },
      "once": true
    }
  },

  "scenes": [
    {
      "id": "entry_hall",
      "title": "Entry Hall",
      "image": "assets/scenes/entry_hall.jpg",
      "content": { "ref": "mission-briefing", "trigger": "enter", "once": true },
      "hotspots": [
        {
          "type": "goTo",
          "target": "library",
          "label": "To the library",
          "rect": { "x": 70, "y": 40, "w": 15, "h": 30 }
        },
        {
          "type": "pickup",
          "itemId": "brass_key",
          "rect": { "x": 20, "y": 60, "w": 8, "h": 10 }
        },
        {
          "type": "puzzle",
          "puzzleRef": "entry_code",
          "rect": { "x": 45, "y": 35, "w": 12, "h": 18 },
          "onSuccess": { "giveItem": "silver_coin", "setFlags": ["safe_opened"] },
          "onFail": { "message": "Nothing happens." }
        },
        {
          "type": "dialog",
          "dialogId": "guard_chat",
          "rect": { "x": 30, "y": 30, "w": 10, "h": 20 }
        },
        {
          "type": "content",
          "contentRef": "mission-briefing",
          "rect": { "x": 2, "y": 2, "w": 6, "h": 6 }
        },
        {
          "type": "apply",
          "rect": { "x": 50, "y": 50, "w": 10, "h": 10 },
          "onApply": { "playVideo": { "src": "assets/video/intro.mp4" } }
        }
      ]
    },
    {
      "id": "exit",
      "title": "Outside",
      "image": "assets/scenes/exit.jpg",
      "end": true
    }
  ],

  "events": [ "…see Events above…" ]
}
```

**Scene fields:** `id`, `title`, `image`, `end` (exactly one scene per game
should have it - it is how completion is detected), `content`, `hotspots`,
`settings`. A scene's display name is `title`, not `name`.

**Hotspot types:** `goTo` (`target`), `pickup` (`itemId`), `puzzle`
(`puzzleRef`), `dialog` (`dialogId`), `content` (`contentRef`), `apply`
(`onApply`). Every type also accepts `rect`, `label`, `requireItems`,
`requireFlags`, `acceptItems`, `states` and `showNeedHint`.

### puzzles.json
```json
{
  "entry_code": {
    "id": "entry_code",
    "kind": "code",
    "title": "Enter the code",
    "prompt": "The safe requires a 4-digit code.",
    "solution": "1738",
    "options": {
      "aggregateOnly": false,
      "blockUntilSolved": true,
      "layout": {
        "mode": "auto",
        "direction": "vertical"
      },
      "theme": {
        "vars": {
          "--pz-token-bg": "rgba(255, 255, 255, 0.10)"
        }
      }
    },
    "background": "assets/puzzles/safe_closeup.jpg"
  }
}
```

### dialogs.json

The list of lines is `sequence`, and a line names its speaker with `speaker`.

```json
{
  "meta": { "id": "my-game", "name": "Dialogs" },
  "characters": [
    {
      "id": "guard",
      "name": "@character.guard.name@Palace Guard",
      "poses": {
        "neutral": "assets/characters/guard_neutral.png",
        "suspicious": "assets/characters/guard_suspicious.png"
      }
    },
    {
      "id": "hero",
      "name": "@character.hero.name@Hrdina",
      "poses": { "neutral": "{heroBase}neutral.png" }
    }
  ],
  "dialogs": [
    {
      "id": "guard_chat",
      "typewriter": { "enabled": true, "speed": 15 },
      "left":  { "characterId": "hero", "defaultPose": "neutral" },
      "right": { "characterId": "guard", "defaultPose": "neutral", "mirror": true },
      "sequence": [
        {
          "id": "s1",
          "speaker": "right",
          "text": "Halt! State your business.",
          "pose": "suspicious"
        },
        {
          "id": "s2",
          "speaker": "left",
          "text": "I'm here to see the professor.",
          "onNext": { "setFlags": ["asked_for_professor"] }
        },
        {
          "id": "s3",
          "speaker": "right",
          "text": "Very well. Which way?",
          "choices": [
            { "label": "The laboratory", "onChoose": { "end": true, "onEnd": { "goTo": "laboratory" } } },
            { "label": "Ask again",      "onChoose": { "jump": "s1" } },
            { "label": "Say nothing",    "onChoose": { "setFlags": ["stayed_quiet"] } }
          ]
        }
      ],
      "onEnd": {
        "message": "The guard steps aside.",
        "setFlags": ["guard_passed"],
        "goTo": "corridor"
      }
    }
  ]
}
```

**A step** takes `id`, `speaker` (`"left"` or `"right"`), `text`, `pose`,
`mirror`, `choices` and `onNext`. **A choice** takes `label` and `onChoose`,
which understands `setFlags`, `jump` (to a step `id`), `end` and `onEnd`. A step
has no `requireFlags` or `requireItems`: conditions live on hotspots and events,
not inside a dialog. Tapping anywhere advances one step, and tapping during the
typewriter animation completes the line instead. That applies to a step with
`choices` too: the buttons are an offer, not a gate, so a step whose branches
matter should say so in its text.

**Blocking.** `openDialog` returns only once the dialog has closed *and* its
`onEnd` has finished, including any scene change it makes.

---

## 🎓 Learning Resources

### Example Games
Explore `games/leeuwenhoek/` for a complete example with:
- All puzzle types
- Dialog trees
- Item usage
- Multi-language support
- Custom theming

### Code Examples
Check source files for inline documentation:
- `engine/engine.js` - Core game loop and state management
- `engine/puzzles/base.js` - Puzzle framework architecture
- `engine/dialogs.js` - Dialog system implementation
- `engine/editor.js` - Visual editor tools

---

## 🤝 Contributing

Contributions welcome! Areas for improvement:
- New puzzle types (crossword, sliding puzzle, etc.)
- Audio/music system enhancements
- Save/load slot system
- Achievements/statistics
- Accessibility improvements (keyboard navigation, screen readers)

### Adding a New Puzzle Type
1. Create `engine/puzzles/kinds/your-puzzle.js` extending `BasePuzzle`
2. Implement `mount()`, `validate()`, `destroy()`
3. Register in `engine/puzzles/index.js`
4. Add CSS in `styles/puzzles.css` under `.pz--kind-your-puzzle`
5. Document in README

---

## 📄 License

MIT License

Copyright (c) 2024 Antonín Fischer (raven2cz)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🙏 Acknowledgments

Built with inspiration from classic point-and-click adventures and modern web technologies.

Special thanks to the open-source community for tools and libraries that made this possible.

---

**Ready to create your escape game?** Start by duplicating the `games/leeuwenhoek/` directory and customize it to your story! 🎮
