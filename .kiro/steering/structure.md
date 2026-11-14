# Project Structure

```
video-downloader/
├── manifest.json            # MV3 manifest — permissions, content scripts, icons
├── lib/
│   └── extract.js           # Pure functions: find videos in X / Instagram JSON,
│                            # URL allowlist, sanitizing, filenames, post-from-URL.
│                            # Classic script (global VDLExtract) + CommonJS for tests.
├── content/
│   ├── hook.js              # PAGE world ("world": "MAIN"), document_start.
│   │                        # Wraps fetch/XHR, forwards API responses that mention
│   │                        # videos via window.postMessage. Never alters traffic.
│   ├── bridge.js            # Isolated world, document_start (after lib/extract.js).
│   │                        # Extracts videos from hook messages and Instagram's
│   │                        # embedded JSON; sends VDL_FOUND to the service worker.
│   ├── x-buttons.js         # Isolated world, document_idle, x.com only.
│   │                        # ↓ button on tweets with video; looks up by tweet IDs.
│   └── content.css          # Button and toast styles
├── background/
│   └── background.js        # Service worker: per-tab video store (memory +
│                            # chrome.storage.session), badge, HEAD sizes, downloads
├── popup/                   # popup.html/.css/.js (lists videos), about.html/.css
├── icons/                   # Extension icons; apps/ has platform logos for the popup
└── tests/
    ├── extract.test.js      # node --test tests/*.test.js
    ├── fixtures/            # Sample API responses (X GraphQL/syndication, IG v1/GraphQL/legacy)
    └── e2e/run_e2e.py       # Playwright: real Chrome + fake x.com / instagram.com
```

## Architecture Patterns

### Why two content-script worlds

Content scripts run in an isolated world and cannot see the page's `fetch`,
XHR or globals. `hook.js` must run in the MAIN world at `document_start` to
see the site's API traffic; everything that touches extension APIs lives in
the isolated world (`bridge.js`, `x-buttons.js`).

### Messages (`chrome.runtime.sendMessage`)

| Type | From → To | Purpose |
|---|---|---|
| `VDL_PAGE_START` | bridge → background | Full page load: clear the tab's list |
| `VDL_FOUND` | bridge → background | Add/merge captured videos (re-sanitized in the worker) |
| `VDL_GET` | popup → background | List the tab's videos, most recent first |
| `VDL_GET_FOR_POST` | x-buttons → background | Videos for given post IDs (owner or alias) |
| `VDL_SIZE` | popup → background | File size via HEAD (cached) |
| `VDL_DOWNLOAD` | popup/x-buttons → background | Download (allowlisted hosts only) |
| `VDL_CLEAR` | popup → background | Clear the tab's list |

Content scripts can only act on their own tab (`sender.tab`); extension pages
(the popup) pass `tabId` explicitly.

### Video shape

See the header of `lib/extract.js`: `key`, `platform`, `postId`, `aliases`,
`username`, `thumbnail`, `durationMs`, `variants[]` (best first).

### Adding a New Platform

1. Teach `lib/extract.js` to recognize the platform's JSON (new branch in the walker), its CDN hosts and its post URLs (`postFromUrl`); add fixtures and tests
2. Add the site to the hook/bridge `matches` in `manifest.json` and its API paths to `API_RE` in `content/hook.js`
3. Add the CDN hosts to `host_permissions`
4. Register the platform in `PLATFORMS` in `popup/popup.js` with label and icon (`icons/apps/`)
5. Extend `tests/e2e/run_e2e.py` with a fake page for the site
