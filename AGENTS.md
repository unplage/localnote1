# AGENTS.md

## Project Overview

Zero-build PWA note app. Everything is in `index.html` (~3400 lines of inline HTML/CSS/JS). No npm, no bundler, no transpilation.

## Key Files

- `index.html` — Single-file app: UI (HTML), styles (CSS), logic (JS) all inline. `DBManager` (IndexedDB) and `App` class defined in a `<script>` tag.
- `sw.js` — Service Worker. Network-first for HTML (4s timeout + content-fingerprint validation), cache-first for static assets. Dynamically scopes by subpath for GitHub Pages multi-project isolation.
- `manifest.json` — PWA manifest, icons point at the PNGs in `icons/`.
- `icons/icon.svg` — Master vector for the app icon (notebook + pencil on the brand indigo). Source of truth for every generated bitmap.
- `tools/make_icons.py` — Regenerates all icon bitmaps from `icons/icon.svg` (needs `cairosvg` + `pillow`). Run after editing the SVG.
- `tools/selftest.html` — Zero-dependency browser self-test. Loads `index.html` in a hidden same-origin iframe and asserts the pure functions (sanitizer, Markdown converter, timestamp, namespace). Open it directly and click 「运行自检」.
- `tools/check_syntax.mjs` — Repo-level check (Node built-ins only, no deps): inline-script syntax, `manifest.json` validity, SW precache list vs. files on disk, Android assets sync. Run after every change.
- `clear.html` — Standalone cache-clearing utility page + offline-availability self-check.
- `android/` — Android WebView wrapper. Built via `android/build.sh` (requires local Android SDK/JDK, not automated in CI). `android/app/src/main/assets/` is a **manual copy** of the web files (`index.html`, `sw.js`, `manifest.json`, `clear.html`, `fontawesome.min.css`, `webfonts/`, `icons/`); keep it in sync when editing the app.

## Dev Workflow

```bash
python3 -m http.server 8080
# Open http://localhost:8080

node tools/check_syntax.mjs      # repo-level checks
# open tools/selftest.html       # in-browser assertions
```

No build step. The only checks that exist are the two above.

## Architecture Notes

- Data layer: IndexedDB (`<app-id>::SimpleNotesDB` v3) with four object stores: `notes`, `categories`, `settings`, `backups`. The `<app-id>` prefix is derived from the deployment subpath (`localnote1`, `android_asset`, …) so same-origin PWAs never share a database. Legacy `SimpleNotesDB` is copied into the namespaced DB once (`migrateLegacyDB`) but never deleted.
- Storage isolation: every `localStorage` key goes through the `Store` helper and is prefixed with `<app-id>::` (password, theme, drafts). The legacy shared password key `app_password_hash` is **not** auto-migrated; the user must confirm it (see `resolveLegacyPassword`) because it may belong to another same-origin PWA.
- Categories have an `order` field for sort; `getAllCategories()` auto-assigns `order` if missing. The `daily` category is guaranteed to exist (notes fall back to it).
- Editor is a zero-dependency `contenteditable` (`#rich-editor`) with a toolbar; formatting uses `document.execCommand`. No editor library and no CDN, so rich text works fully offline (including Android WebView).
- Note `content` is stored as sanitized HTML. Plain-text and legacy TipTap JSON are normalized on read via `normalizeToHtml()` / `legacyTiptapToHtml()`; use `toPlainText()` for previews and search, `htmlToMarkdown(normalizeToHtml(x))` for Markdown export. `sanitizeHtml()` strips disallowed tags/attributes and validates attribute/style **values** (not just names).
- Data-loss guards: per-note emergency draft in `localStorage` (`<app-id>::simpleNotesDraft:<id>`) written on input and flushed on `pagehide`/`visibilitychange`; the draft covers **title + body + category**, not just the body. SW `controllerchange` defers reload while the editor is open; `navigator.storage.persist()` is requested on init.
- **Editor session token** (`this._session`): incremented on every `openEditor`/`closeEditor`. Every async save captures the token and the note id **before its first `await`**; after the await it only mutates session state if the token still matches. Never read `this.editingId` after an `await` in `saveNote`.
- **Dirty flag** (`this._dirty`): `saveNote()` writes only when BOTH `_dirty` is set AND `_noteValues().changed` is true. `_dirty` is sticky within an editing session, but `triggerAutoSave()` must recompute `changed` from the actual values — mobile IMEs fire `input` events on mere focus, so treating every event as a real edit wrongly bumps `updatedAt`. The snapshot is taken from the `<input>`'s real value through `sanitizeTitle()` (the input strips newlines, so normalizing the raw DB title instead causes a permanent "changed" mismatch). `_noteValues()` is the single source of truth shared by `saveNote`, `_hasUnsavedChanges()` and the dirty flag.
- The editor footer shows the note's real `updatedAt` (`_formatEditTime`), not the moment the note was opened.
- Image viewer (`#imageViewer`): tapping an image inside the editor opens a fullscreen viewer with pinch-zoom / double-tap-zoom / drag-pan / pinch-to-close (pointer events, `touch-action:none`). Pointer capture must be taken on `e.target`, not on the container — otherwise `pointerup` is retargeted to the container and the tap can no longer be told apart from a backdrop tap.
- Note IDs: `Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)`.
- Auto-save uses a configurable timer (default 3s), triggered on editor `input` events **and on title/category changes**.
- Dark theme toggled via `data-theme="dark"` on `<html>`; `theme` preference is `light`/`dark`/`auto` and the effective theme is re-resolved on `prefers-color-scheme` changes.
- Icons: Font Awesome 6.4.0 is vendored locally (`fontawesome.min.css` + `webfonts/`), not loaded from a CDN.
- App icon: `icons/icon.svg` is the only hand-edited source. `python3 tools/make_icons.py` regenerates `icons/*.png`, `favicon.ico` and the Android launcher bitmaps in `android/app/src/main/res/`. The `<g id="glyph">` block in the SVG is reused (scaled) for the maskable / adaptive-icon variants, so keep that id intact.

## Gotchas

- Editing the app means editing `index.html` — there is no separate JS/CSS file to modify.
- The Android build script (`android/build.sh`) has hardcoded absolute paths to a specific developer's SDK install; it won't work as-is elsewhere. The Android WebView loads the app over `file://`, so **Service Workers and (in some WebView versions) IndexedDB do not work there** — the browser PWA is the supported target.
- Service Worker caches aggressively. After changes, use `clear.html` or hard-refresh to see updates.
- The `sw.js` cache name is derived from the subpath (`pwa-cache-<path>-vN`); changing the deployment path changes the cache key. Bump `N` after editing app files to force an update. `activate` only deletes caches matching this project's exact `^pwa-cache<path>v\d+$` pattern — never other PWAs' caches; cache lookups are also scoped to the current project cache.
- `sw.js` no longer calls `skipWaiting()` in `install`. Updates are user-initiated: the page shows an 「发现新版本」 banner and posts `SKIP_WAITING`; the SW must reply to `GET_PRECACHE_REPORT` via `event.ports[0]` (not `event.source`).
- The navigation handler re-creates `Response` headers from scratch when caching a page — never copy `content-encoding`/`content-length` from the network response onto a decoded body.
- `showConfirm()` resolves with `null` when another confirm dialog is already open (concurrency guard). `null` means 「no decision」 — only `false` means 「user declined」. Do not treat `null` as `false` when the decision would destroy data.
- `renderCategories()` rebuilds the category `<select>`; it must restore the previous value (and add a temporary option if the category was deleted) or the editor's category silently changes on the next save.
- `db.saveNote()` uses `put`, which replaces the whole record — `createdAt` must be carried over explicitly (see `this._createdAt`).
- `clearAll()` also clears the `backups` store; 「清除所有数据」 must not leave restorable copies behind.
