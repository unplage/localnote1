# AGENTS.md

## Project Overview

Zero-build PWA note app. Everything is in `index.html` (~1900 lines of inline HTML/CSS/JS). No npm, no bundler, no transpilation.

## Key Files

- `index.html` — Single-file app: UI (HTML), styles (CSS), logic (JS) all inline. `DBManager` (IndexedDB) and `App` class defined in a `<script>` tag.
- `sw.js` — Service Worker. Network-first for HTML, cache-first for static assets. Dynamically scopes by subpath for GitHub Pages multi-project isolation.
- `manifest.json` — PWA manifest, icons point at the PNGs in `icons/`.
- `icons/icon.svg` — Master vector for the app icon (notebook + pencil on the brand indigo). Source of truth for every generated bitmap.
- `tools/make_icons.py` — Regenerates all icon bitmaps from `icons/icon.svg` (needs `cairosvg` + `pillow`). Run after editing the SVG.
- `clear.html` — Standalone cache-clearing utility page.
- `android/` — Android WebView wrapper. Built via `android/build.sh` (requires local Android SDK/JDK, not automated in CI). `android/app/src/main/assets/` is a **manual copy** of the web files (`index.html`, `sw.js`, `manifest.json`, `clear.html`, `fontawesome.min.css`, `webfonts/`, `icons/`); keep it in sync when editing the app.

## Dev Workflow

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

No build step. No lint/test/typecheck commands exist.

## Architecture Notes

- Data layer: IndexedDB (`SimpleNotesDB` v2) with three object stores: `notes`, `categories`, `settings`.
- Categories have an `order` field for sort; `getAllCategories()` auto-assigns `order` if missing.
- Editor is a zero-dependency `contenteditable` (`#rich-editor`) with a toolbar; formatting uses `document.execCommand`. No editor library and no CDN, so rich text works fully offline (including Android WebView).
- Note `content` is stored as sanitized HTML. Plain-text and legacy TipTap JSON are normalized on read via `normalizeToHtml()` / `legacyTiptapToHtml()`; use `toPlainText()` for previews, search and Markdown export. `sanitizeHtml()` strips disallowed tags/attributes.
- Data-loss guards: per-note emergency draft in `localStorage` (`simpleNotesDraft:<id>`) written on input and flushed on `pagehide`/`visibilitychange`; SW `controllerchange` defers reload while the editor is open; `navigator.storage.persist()` is requested on init.
- Note IDs: `Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)`.
- Auto-save uses a configurable timer (default 3s), triggered on editor `input` events.
- Dark theme toggled via `data-theme="dark"` on `<html>`.
- Icons: Font Awesome 6.4.0 is vendored locally (`fontawesome.min.css` + `webfonts/`), not loaded from a CDN.
- App icon: `icons/icon.svg` is the only hand-edited source. `python3 tools/make_icons.py` regenerates `icons/*.png`, `favicon.ico` and the Android launcher bitmaps in `android/app/src/main/res/`. The `<g id="glyph">` block in the SVG is reused (scaled) for the maskable / adaptive-icon variants, so keep that id intact.


## Gotchas

- Editing the app means editing `index.html` — there is no separate JS/CSS file to modify.
- The Android build script (`android/build.sh`) has hardcoded absolute paths to a specific developer's SDK install; it won't work as-is elsewhere.
- Service Worker caches aggressively. After changes, use `clear.html` or hard-refresh to see updates.
- The `sw.js` cache name is derived from the subpath (`pwa-cache-<path>-vN`); changing the deployment path changes the cache key. Bump `N` after editing app files to force an update.
