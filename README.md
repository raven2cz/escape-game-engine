# Escape Game Engine

A **no-build**, iPad-friendly **escape game framework** in plain HTML/CSS/JS.  
Create point-and-click adventures with an **in-browser editor** and deploy on GitHub Pages.

**Demo (GitHub Pages):** https://raven2cz.github.io/escape-game-engine/  
**PWA:** append `?pwa=1` for installable/offline mode.

---

## Features
- Hotspots: `goTo`, `pickup`, `puzzle` (`phrase`, `code`, `order`, `match`)
- Inventory with image/description **inspect** modals
- `requireItems` / `requireFlags` to lock doors or reveal secret paths
- **Editor** overlay: draw rectangles, live coordinate labels, **Copy JSON** or **Rect JSON** panel
- Runs from any static host (GitHub Pages), optimized for iPad touch

## Project Structure
```bash
index.html
style.css
engine/
engine.js      # core runtime (scenes, inventory, flags)
puzzles.js     # built-in puzzles (phrase, code, order, match)
editor.js      # in-browser editor (draw hotspots, copy JSON, labels)
game/
scenes.json    # your content: scenes, items, hotspots
assets/          # images and icons (case-sensitive on Pages)
service-worker.js  # optional PWA
manifest.webmanifest
```

## Quick Start
1. Serve locally (optional): `python3 -m http.server 5500` → open `http://localhost:5500/`
2. Toggle **✎ Edit** and draw a rectangle on the scene.
3. Use **Copy JSON** or **Rect JSON** to get a snippet like:
```json
{
  "type": "pickup",
  "itemId": "glass_key",
  "rect": { "x": 72, "y": 58, "w": 8, "h": 10 }
}
```

4. Paste it under the current scene in `game/scenes.json`.

## Puzzles (built-in)

* **phrase**: text answer (diacritics/case-insensitive)
* **code**: numeric/alphanumeric code (optional password mask)
* **order**: arrange tokens into correct order
* **match**: match left-right pairs

Each puzzle supports `onSuccess`:
`giveItem`, `setFlags` / `clearFlags`, `message`, `goTo`.

## Deploy on GitHub Pages

* Settings → Pages → **Deploy from a branch**
* Branch: `main` | Folder: `/ (root)`
* Open `https://<your-username>.github.io/<repo-name>/`
* For PWA/offline test: add `?pwa=1` and “Add to Home Screen”.

> When updating code, bump `CACHE_NAME` in `service-worker.js` to invalidate the old cache.

## iPad Notes

* Works in Safari; for offline use install via `?pwa=1`.
* The editor supports touch/pen/mouse; labels show `x,y,w,h` in percent.

## License

MIT