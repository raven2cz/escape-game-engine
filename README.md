# Escape Game Engine

A **no-build**, iPad-friendly **escape game framework** in plain HTML/CSS/JS.  
Create sophisticated point-and-click adventures with **Puzzles 2.0**, **dialogs**, **theming system**, and an **in-browser editor**.

**Demo (GitHub Pages):** https://raven2cz.github.io/escape-game-engine?game=leeuwenhoek&lang=cs&debug=1&hero=adam&reset=1 (two heroes: "adam" and "eva")
**PWA:** append `?pwa=1` for installable/offline mode.

---

## ✨ Features

### Core Engine
- **Scene Management**: Navigate between scenes with hotspots (`goTo`, `pickup`, `puzzle`, `dialog`)
- **Inventory System**: Collect items with image/description inspect modals
- **State Management**: Use flags and `requireItems`/`requireFlags` to lock doors or reveal secret paths
- **Event System**: Trigger complex action chains on scene enter/exit, item pickup, puzzle completion
- **Hero Profiles**: Support for multiple playable characters with custom avatars and names
- **Internationalization (i18n)**: Multi-language support with `@key@fallback` syntax
- **PWA Support**: Install as offline-capable app on mobile devices

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
- **Hero Alias**: Special "hero" character auto-maps to selected player profile
- **Choice-Based Dialogs**: Interactive branching with conditions (`requireFlags`, `requireItems`)
- **Voice Lines**: Link audio files to dialog steps
- **Auto-Advance**: Configurable delays for cinematic sequences
- **Theme Integration**: Dialogs use puzzle theming system for consistent UI

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
│   ├── engine.js          # Core runtime (scenes, inventory, flags, dialogs)
│   ├── editor.js          # In-browser editor (draw hotspots, export JSON)
│   ├── dialogs.js         # Dialog system with character management
│   ├── i18n.js            # Engine internationalization strings
│   └── puzzles/
│       ├── index.js       # Puzzle runner factory
│       ├── base.js        # Shared puzzle infrastructure
│       ├── layout.js      # AUTO layout algorithm
│       ├── phrase.js      # Text input puzzle
│       ├── code.js        # Code entry puzzle
│       ├── order.js       # Token sequencing puzzle
│       ├── match.js       # Pair matching puzzle
│       ├── quiz.js        # Multiple choice quiz
│       ├── choice.js      # Choice/fill-in puzzle
│       ├── group.js       # Category sorting puzzle
│       ├── cloze.js       # Fill-in-the-blank puzzle
│       └── list.js        # Puzzle sequence manager
├── games/
│   └── <game-id>/
│       ├── scenes.json    # Scene definitions, hotspots, items
│       ├── puzzles.json   # Puzzle configurations
│       ├── dialogs.json   # Dialog trees (optional)
│       ├── i18n/
│       │   ├── cs.json    # Czech translations
│       │   └── en.json    # English translations
│       ├── game.css       # Per-game theme overrides (optional)
│       └── assets/        # Images, audio, backgrounds
├── service-worker.js      # PWA offline cache
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

Reference in a hotspot:
```json
{
  "type": "puzzle",
  "ref": "my-puzzle",
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
      "steps": [
        {
          "side": "right",
          "text": "Welcome to my laboratory!",
          "pose": "happy"
        },
        {
          "side": "left",
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

### PWA Installation
1. Add `?pwa=1` to URL
2. Open in Safari/Chrome
3. Tap "Add to Home Screen"
4. App runs offline after first load

### Offline Updates
When updating code, bump `CACHE_NAME` in `service-worker.js`:

```javascript
const CACHE_NAME = 'escape-game-v2'; // increment version
```

---

## 🎮 Advanced Features

### Event Actions
Hotspots and puzzles support rich action chains in `onSuccess`, `onFail`, `onEnter`, `onExit`:

```json
{
  "onSuccess": [
    { "giveItem": "golden_key" },
    { "setFlags": ["lab_unlocked"] },
    { "clearFlags": ["first_visit"] },
    { "message": "You found the key!" },
    { "goTo": "laboratory" },
    { "delay": 1000 },
    { "openDialog": "victory_dialog" },
    { "setSceneImage": { "sceneId": "corridor", "image": "corridor_night.jpg" } },
    { "highlightHotspot": { "rect": { "x": 30, "y": 50, "w": 15, "h": 20 }, "ms": 3000 } },
    { "openPuzzle": { "ref": "bonus_puzzle", "onSuccess": [...] } },
    { "openPuzzleList": { "items": ["puzzle1", "puzzle2"], "aggregateOnly": true } }
  ]
}
```

### Conditional Visibility
Lock hotspots until conditions are met:

```json
{
  "type": "goTo",
  "scene": "secret_room",
  "requireItems": ["brass_key", "cipher_note"],
  "requireFlags": ["password_entered"],
  "missingMessage": "The door won't open without the key and cipher."
}
```

### Hero Selection
Set player character dynamically:

```javascript
// In game code or console
window.__game.setHero({
  id: 'eva',
  heroId: 'eva',
  heroName: 'Eva',
  heroBase: 'assets/characters/eva'
});
```

Dialogs will automatically use the hero's avatar when `characterId: "hero"` is used.

### Item Usage System
Enable "use item on scene" mode:

1. Click inventory item → enters use mode (cursor changes)
2. Click hotspot → triggers `onUse` action chain
3. ESC key exits use mode

```json
{
  "items": [
    {
      "id": "screwdriver",
      "name": "Screwdriver",
      "image": "assets/items/screwdriver.png",
      "description": "A flathead screwdriver."
    }
  ],
  "hotspots": [
    {
      "type": "inspect",
      "onUse": {
        "screwdriver": [
          { "message": "You opened the panel!" },
          { "setFlags": ["panel_open"] },
          { "consumeItem": true }
        ]
      }
    }
  ]
}
```

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
4. Copy rect for `options.rect` in JSON

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

Uses Vitest with JSDOM for DOM testing. Test files mirror source structure.

---

## 📝 Configuration Reference

### scenes.json
```json
{
  "meta": {
    "id": "leeuwenhoek",
    "version": "2.0.0",
    "title": "The Mystery of Leeuwenhoek",
    "authors": ["Your Name"],
    "startScene": "entry_hall"
  },
  "items": [
    {
      "id": "brass_key",
      "name": "Brass Key",
      "description": "An old brass key.",
      "image": "assets/items/brass_key.png"
    }
  ],
  "scenes": [
    {
      "id": "entry_hall",
      "name": "Entry Hall",
      "image": "assets/scenes/entry_hall.jpg",
      "onEnter": [
        { "message": "You enter the hall..." }
      ],
      "hotspots": [
        {
          "type": "goTo",
          "scene": "library",
          "rect": { "x": 70, "y": 40, "w": 15, "h": 30 }
        },
        {
          "type": "pickup",
          "itemId": "brass_key",
          "rect": { "x": 20, "y": 60, "w": 8, "h": 10 }
        },
        {
          "type": "puzzle",
          "ref": "entry_code",
          "rect": { "x": 45, "y": 35, "w": 12, "h": 18 },
          "onSuccess": [
            { "giveItem": "silver_coin" },
            { "setFlags": ["safe_opened"] }
          ]
        },
        {
          "type": "dialog",
          "dialogId": "guard_chat",
          "rect": { "x": 30, "y": 30, "w": 10, "h": 20 }
        }
      ]
    }
  ]
}
```

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
```json
{
  "characters": [
    {
      "id": "guard",
      "name": "Palace Guard",
      "poses": {
        "neutral": "assets/characters/guard_neutral.png",
        "suspicious": "assets/characters/guard_suspicious.png"
      }
    }
  ],
  "dialogs": [
    {
      "id": "guard_chat",
      "left": { "characterId": "hero" },
      "right": { "characterId": "guard", "defaultPose": "neutral" },
      "steps": [
        {
          "side": "right",
          "text": "Halt! State your business.",
          "pose": "suspicious"
        },
        {
          "side": "left",
          "text": "I'm here to see the professor."
        },
        {
          "side": "right",
          "text": "Very well. Proceed.",
          "pose": "neutral",
          "requireFlags": ["has_invitation"],
          "choices": [
            {
              "label": "Thank you",
              "action": [{ "goTo": "laboratory" }]
            }
          ]
        }
      ]
    }
  ]
}
```

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
1. Create `engine/puzzles/your-puzzle.js` extending `BasePuzzle`
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