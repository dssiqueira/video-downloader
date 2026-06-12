# Product: Video Downloader

A Chrome extension (Manifest V3) that lets users download videos from **X (Twitter)** and **Instagram** directly in the browser — no external services, no data leaving the user's machine.

## Core Capabilities

- **X / Twitter**: Detects videos while browsing the timeline via network interception; injects a download button (↓) on each tweet with video; also supports URL-based lookup via popup
- **Instagram**: Captures video URLs from Reels, Posts, and Stories using three parallel detection layers; requires the video to be played in the current session
- Shows available quality options (1080p, 720p, 480p, 360p…) with file sizes before downloading
- Auto-identifies the current platform and adapts the popup UI accordingly

## Target Users

Personal use — individuals who want to save social media videos locally.

## Key Constraints

- Zero external dependencies — no npm packages, no bundler, no framework
- Private accounts and DRM-protected content are out of scope
- Instagram Stories URLs expire; YouTube is explicitly unsupported
