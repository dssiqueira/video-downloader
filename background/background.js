// background.js - Service Worker for Video Downloader
"use strict";

// tabId → [{ url, quality, type, platform, bitrate, fileSize }]
const videoCache = new Map();

// ─── Download helpers ────────────────────────────────────────────────────────

function ensureMp4(filename) {
  if (!filename) return "video_downloader.mp4";
  return filename.replace(/\.[^/.]+$/, "") + ".mp4";
}

function downloadDirect(url, filename, sendResponse) {
  chrome.downloads.download(
    { url, filename: ensureMp4(filename), saveAs: false, conflictAction: "uniquify" },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    }
  );
}

// ─── Twitter / X.com API fetching ────────────────────────────────────────────

async function fetchTweetVideos(tweetId) {
  let username = null;
  let videos   = [];

  // Try syndication API first (no auth required)
  try {
    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=pt&features=tfw_timeline_list%3A%3Btfw_follower_count_sunset%3Atrue&token=x`;
    const response = await fetch(url, {
      headers: {
        Origin:       "https://platform.twitter.com",
        Referer:      "https://platform.twitter.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept:       "application/json",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    videos   = extractVideosFromSyndication(data);
    username = data?.user?.screen_name
      || data?.core?.user_results?.result?.legacy?.screen_name
      || null;
  } catch (e) {
    console.warn("[VDL] Syndication API failed:", e.message);
  }

  // Fallback: fxtwitter
  if (!videos.length) {
    try {
      const url      = `https://api.fxtwitter.com/status/${tweetId}`;
      const response = await fetch(url, { headers: { "User-Agent": "VideoDownloader/2.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      videos   = extractVideosFromFxTwitter(data);
      username = username || data?.tweet?.author?.screen_name || null;
    } catch (e) {
      console.warn("[VDL] fxtwitter failed:", e.message);
    }
  }

  if (!videos.length) return { videos: [], username };

  // Fetch file sizes in parallel
  await Promise.all(videos.map(async (video) => {
    try {
      const head = await fetch(video.url, { method: "HEAD" });
      const cl   = head.headers.get("content-length");
      video.fileSize = cl ? parseInt(cl, 10) : null;
    } catch (_) {
      video.fileSize = null;
    }
  }));

  return { videos, username };
}

function extractVideosFromSyndication(data) {
  const videos = [];

  function recurse(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj.variants)) {
      obj.variants.forEach((v) => {
        if ((v.type === "video/mp4" || v.content_type === "video/mp4") && (v.src || v.url)) {
          const videoUrl = v.src || v.url;
          videos.push({
            url:     videoUrl,
            quality: resolveQuality(videoUrl, v.bitrate),
            bitrate: v.bitrate || null,
            type:    "mp4",
            platform: "twitter",
          });
        }
      });
    }
    if (obj.video_info?.variants) {
      obj.video_info.variants.forEach((v) => {
        if (v.content_type === "video/mp4" && v.url) {
          videos.push({
            url:     v.url,
            quality: resolveQuality(v.url, v.bitrate),
            bitrate: v.bitrate || null,
            type:    "mp4",
            platform: "twitter",
          });
        }
      });
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "object") recurse(obj[key]);
    }
  }

  recurse(data);
  return deduplicateVideos(videos);
}

function extractVideosFromFxTwitter(data) {
  const videos = [];
  const media  = data?.tweet?.media;
  if (!media) return videos;

  if (Array.isArray(media.videos)) {
    media.videos.forEach((v) => {
      if (Array.isArray(v.variants)) {
        v.variants.forEach((variant) => {
          if (variant.content_type === "video/mp4" && variant.url) {
            videos.push({
              url:     variant.url,
              quality: resolveQuality(variant.url, variant.bitrate),
              bitrate: variant.bitrate || null,
              type:    "mp4",
              platform: "twitter",
            });
          }
        });
      }
    });
  }

  return deduplicateVideos(videos);
}

function resolveQuality(url, bitrate) {
  const m = url.match(/\/(\d{3,5})x(\d{3,5})\//);
  if (m) {
    const h = Math.min(parseInt(m[1], 10), parseInt(m[2], 10));
    if (h >= 2160) return "2160p (4K)";
    if (h >= 1440) return "1440p (2K)";
    if (h >= 1080) return "1080p";
    if (h >= 720)  return "720p";
    if (h >= 480)  return "480p";
    if (h >= 360)  return "360p";
    return `${h}p`;
  }
  if (bitrate) {
    if (bitrate >= 8000000) return "1080p";
    if (bitrate >= 5000000) return "720p";
    if (bitrate >= 800000)  return "480p";
    if (bitrate >= 300000)  return "360p";
    return "270p";
  }
  return "MP4";
}

function deduplicateVideos(videos) {
  const seenUrls  = new Set();
  const unique    = videos.filter((v) => {
    if (seenUrls.has(v.url)) return false;
    seenUrls.add(v.url);
    return true;
  });
  const byQuality = new Map();
  unique.forEach((v) => {
    const existing = byQuality.get(v.quality);
    if (!existing || (v.bitrate || 0) > (existing.bitrate || 0)) {
      byQuality.set(v.quality, v);
    }
  });
  return Array.from(byQuality.values());
}

// ─── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "VIDEO_FOUND") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    if (!videoCache.has(tabId)) videoCache.set(tabId, []);
    const existing = videoCache.get(tabId);
    if (!existing.some((v) => v.url === message.video.url)) {
      existing.push(message.video);
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "GET_VIDEOS") {
    sendResponse({ videos: videoCache.get(message.tabId) || [] });
    return true;
  }

  if (message.type === "FETCH_TWEET_VIDEOS") {
    fetchTweetVideos(message.tweetId)
      .then(({ videos, username }) => sendResponse({ success: true, videos, username }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "CLEAR_VIDEOS") {
    videoCache.delete(message.tabId);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "DOWNLOAD_VIDEO") {
    downloadDirect(message.url, message.filename, sendResponse);
    return true;
  }

  return true;
});

// ─── Tab lifecycle ────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  videoCache.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    videoCache.delete(tabId);
  }
});
