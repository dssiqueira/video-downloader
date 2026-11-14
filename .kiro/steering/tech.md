# Tech Stack

## Runtime & Platform

- **Chrome Extension Manifest V3** — service worker model, no persistent background pages
- **Vanilla JavaScript (ES2020+)** — no frameworks, no bundler, no transpilation
- **Pure CSS** — no preprocessors; dark theme inspired by X.com

## Chrome Extension APIs Used

- `chrome.runtime` — messaging between popup, content scripts and service worker
- `chrome.downloads` — `chrome.downloads.download()` for the chosen variant
- `chrome.storage.session` — per-tab video lists that survive service worker restarts
- `chrome.action` — badge with the number of videos captured in the tab
- `chrome.tabs` — active tab URL/ID in the popup; cleanup on tab close
- Content scripts with `"world": "MAIN"` (Chrome 111+) for the network hook

## External Services

None. The extension only reads API responses the page itself received; the
service worker's only requests are `HEAD` (file size) and downloads to the
platforms' video CDNs.

## No Build System

There is no build step, no `package.json`, no `node_modules`. Files are loaded directly by Chrome.

- **Unit tests**: `node --test tests/*.test.js` (Node's built-in runner, no install)
- **End-to-end**: `python tests/e2e/run_e2e.py` (Playwright + Chromium; fake x.com/instagram.com pages, no login needed)

- **To install**: Load the project folder via `chrome://extensions` → "Load unpacked"
- **To test changes**: Edit files → click the refresh icon on `chrome://extensions` → reload the target page
- **To package for distribution**: Use Chrome's "Pack extension" on `chrome://extensions` or `zip` the folder excluding `.git`

## Code Style Conventions

- `"use strict"` at the top of every script
- IIFE pattern (`(function() { ... })()`) for content scripts to avoid polluting global scope
- Section comments using `// ─── Section Name ───` dividers for readability
- `const` by default; `let` only when reassignment is needed; no `var`
- Arrow functions for callbacks and short helpers; named `function` declarations for top-level logic
- Async/await for promise chains in the background service worker
- Error handling: silent catches (`catch (_) {}`) are acceptable for non-critical network probing; user-facing errors use `sendResponse({ success: false, error: ... })`
