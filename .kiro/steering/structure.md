# Project Structure

```
video-downloader/
├── manifest.json                  # Extension manifest (MV3) — permissions, scripts, icons
│
├── background/
│   └── background.js              # Service worker (runs in extension context)
│                                  # Owns: videoCache Map, Twitter API fetching,
│                                  # chrome.downloads, message routing
│
├── content/
│   ├── content.css                # Injected styles — download button (↓) and toast notifications
│   └── platforms/
│       ├── twitter.js             # Injected into x.com / twitter.com
│       │                          # Intercepts XHR + fetch, parses TweetDetail JSON,
│       │                          # injects ↓ button into tweet action bars
│       └── instagram.js           # Injected into instagram.com
│                                  # Three-layer detection: page data, API interception,
│                                  # MutationObserver + play event on <video>
│
├── popup/
│   ├── popup.html                 # Main extension popup UI
│   ├── popup.css                  # Popup styles
│   ├── popup.js                   # Popup logic — platform detection, video list rendering,
│   │                              # URL-based Twitter fetch, download dispatch
│   ├── about.html                 # "About" page (opened from popup)
│   └── about.css                  # About page styles
│
└── icons/
    ├── icon16.png                 # Extension toolbar icon (16px)
    ├── icon48.png                 # Extension management page icon (48px)
    ├── icon128.png                # Chrome Web Store / install icon (128px)
    ├── create-icons.js            # Dev utility — generates icon PNGs programmatically
    ├── generate-icons.html        # Dev utility — browser-based icon generation helper
    └── apps/
        ├── twitter.png            # X/Twitter logo used in popup UI
        └── social.png             # Instagram logo used in popup UI
```

## Architecture Patterns

### Message Passing (content ↔ background ↔ popup)

All cross-context communication goes through `chrome.runtime.sendMessage`. Message types:

| Type | Direction | Purpose |
|---|---|---|
| `VIDEO_FOUND` | content → background | Cache a detected video URL for the tab |
| `GET_VIDEOS` | popup → background | Retrieve cached videos for a tab ID |
| `FETCH_TWEET_VIDEOS` | popup → background | Fetch video variants for a tweet ID via API |
| `DOWNLOAD_VIDEO` | popup/content → background | Trigger `chrome.downloads.download()` |
| `CLEAR_VIDEOS` | popup → background | Flush the cache for a tab |

### Video Cache

`background.js` maintains a `Map<tabId, videoArray>` in memory. It is cleared on tab navigation (`onUpdated`) and tab close (`onRemoved`). Cache is per-tab and session-only.

### Adding a New Platform

1. Create `content/platforms/{platform}.js` — implement network interception and call `chrome.runtime.sendMessage({ type: "VIDEO_FOUND", video })` for each discovered URL
2. Add the content script entry to `manifest.json` under `content_scripts` with appropriate `matches`
3. Add CDN domains to `host_permissions` in `manifest.json`
4. Register the platform in `popup.js` `PLATFORMS` map with label and icon
5. Add platform icon to `icons/apps/` and register it in `manifest.json` `web_accessible_resources`
