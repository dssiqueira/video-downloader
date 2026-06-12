# Tech Stack

## Runtime & Platform

- **Chrome Extension Manifest V3** — service worker model, no persistent background pages
- **Vanilla JavaScript (ES2020+)** — no frameworks, no bundler, no transpilation
- **Pure CSS** — no preprocessors; dark theme inspired by X.com

## Chrome Extension APIs Used

- `chrome.runtime` — messaging between popup, content scripts, and service worker
- `chrome.downloads` — trigger file downloads via `chrome.downloads.download()`
- `chrome.tabs` — query active tab URL and ID
- `chrome.storage` — reserved for future settings (not actively used)
- `chrome.scripting` — inject content scripts programmatically

## External APIs (fetched at runtime, no SDK)

- `cdn.syndication.twimg.com` — Twitter syndication API (no auth required), primary source for tweet video variants
- `api.fxtwitter.com` — fallback when syndication API fails
- Instagram GraphQL / REST API responses are intercepted passively (no direct calls initiated by the extension)

## No Build System

There is no build step, no `package.json`, no `node_modules`. Files are loaded directly by Chrome.

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
