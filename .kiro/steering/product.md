# Product: Video Downloader

A Chrome extension (Manifest V3) that lets users download videos from **X (Twitter)** and **Instagram** directly in the browser — no external services, no data leaving the user's machine.

## Core Capabilities

- **X / Twitter**: Captures videos from the site's own GraphQL responses while browsing; injects a download button (↓) on each tweet with video (also quote tweets and retweets)
- **Instagram**: Captures videos from Reels, Posts (including carousels) and Stories from the site's API responses and the JSON embedded in the page
- Shows available quality options (1080p, 720p, 480p, 360p…) with file sizes before downloading
- Auto-identifies the current platform and adapts the popup UI accordingly

## Target Users

Personal use — individuals who want to save social media videos locally.

## Key Constraints

- Zero runtime dependencies — no npm packages, no bundler, no framework (tests use Node's built-in runner and Playwright)
- No third-party services: the extension never calls external APIs; it only reads responses the page already received
- Private accounts and DRM-protected content are out of scope
- Instagram media URLs expire; YouTube is explicitly unsupported
