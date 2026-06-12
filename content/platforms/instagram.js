// instagram.js - Content script for Instagram
// Strategy:
//   1. Read video_url from Instagram's page data (window.__additionalData / inline JSON)
//   2. Intercept GraphQL / API responses that carry video_url fields
//   3. Observe <video> src attributes as a live fallback

(function () {
  "use strict";

  const processedUrls = new Set();

  // ─── CDN hostname check (no extension required) ──────────────────────────────

  function isInstagramCdnUrl(url) {
    if (!url || url.startsWith("blob:") || url.startsWith("data:")) return false;
    return (
      url.includes("cdninstagram.com") ||
      url.includes("fbcdn.net") ||
      /scontent[^.]*\.(cdninstagram|fbcdn)/.test(url)
    );
  }

  // ─── Quality inference ───────────────────────────────────────────────────────

  function inferQuality(url) {
    // Instagram sometimes encodes resolution in path: /s1080x1920/
    const sMatch = url.match(/\/s(\d{3,4})x(\d{3,4})\//i);
    if (sMatch) {
      const h = Math.min(parseInt(sMatch[1], 10), parseInt(sMatch[2], 10));
      return h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : `${h}p`;
    }
    // Or as /WxH/ anywhere in path
    const wh = url.match(/[/_](\d{3,4})x(\d{3,4})[/_]/i);
    if (wh) {
      const h = Math.min(parseInt(wh[1], 10), parseInt(wh[2], 10));
      return h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : `${h}p`;
    }
    return "MP4";
  }

  // ─── Report a discovered URL ─────────────────────────────────────────────────

  function reportVideo(rawUrl, quality) {
    let url;
    try {
      // Normalise escaped slashes from JSON strings
      url = rawUrl.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
      // Validate
      new URL(url);
    } catch (_) {
      return;
    }

    // Dedup by path (ignore query string churn)
    const key = url.split("?")[0];
    if (processedUrls.has(key)) return;
    processedUrls.add(key);

    chrome.runtime.sendMessage(
      {
        type: "VIDEO_FOUND",
        video: {
          url,
          quality: quality || inferQuality(url),
          type: "mp4",
          platform: "instagram",
        },
      },
      () => { if (chrome.runtime.lastError) {} }
    );
  }

  // ─── 1. Extract from Instagram page-level data objects ───────────────────────
  // Instagram injects video data into window.__additionalData and window._sharedData

  function extractFromPageData() {
    function walkAndExtract(obj) {
      if (!obj || typeof obj !== "object") return;
      // video_url is the direct CDN link
      if (typeof obj.video_url === "string" && obj.video_url.startsWith("http")) {
        reportVideo(obj.video_url);
      }
      // video_versions array (newer API shape)
      if (Array.isArray(obj.video_versions)) {
        // Sort by width desc so highest quality is first
        const sorted = [...obj.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
        sorted.forEach((v) => {
          if (v.url) reportVideo(v.url);
        });
      }
      for (const key of Object.keys(obj)) {
        if (obj[key] && typeof obj[key] === "object") walkAndExtract(obj[key]);
      }
    }

    try {
      if (window.__additionalData) walkAndExtract(window.__additionalData);
    } catch (_) {}

    try {
      if (window._sharedData) walkAndExtract(window._sharedData);
    } catch (_) {}

    // Also scan any <script type="application/json"> blocks Meta injects
    document.querySelectorAll('script[type="application/json"]').forEach((s) => {
      try {
        walkAndExtract(JSON.parse(s.textContent));
      } catch (_) {}
    });
  }

  // ─── 2. Walk arbitrary JSON for Instagram video fields ───────────────────────

  function walkJsonForVideos(obj) {
    if (!obj || typeof obj !== "object") return;

    if (typeof obj.video_url === "string" && obj.video_url.startsWith("http")) {
      reportVideo(obj.video_url);
    }

    if (Array.isArray(obj.video_versions)) {
      const sorted = [...obj.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
      sorted.forEach((v) => { if (v.url) reportVideo(v.url); });
    }

    // Clip / Reel shape
    if (obj.clips_metadata && obj.clips_metadata.original_sound_info) {
      // already handled by video_url above
    }

    // Inline CDN urls that appear as plain string values
    if (typeof obj === "string" && isInstagramCdnUrl(obj)) {
      reportVideo(obj);
    }

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === "object") walkJsonForVideos(val);
    }
  }

  function parseAndScan(text) {
    if (!text || (!text.includes("video_url") && !text.includes("cdninstagram") && !text.includes("fbcdn"))) return;
    try {
      walkJsonForVideos(JSON.parse(text));
    } catch (_) {
      // Not valid JSON — regex fallback for raw CDN urls
      const matches = text.match(/https?:(?:\\\/\\\/|\/\/)[^"'\s\\]+(?:cdninstagram\.com|fbcdn\.net)[^"'\s\\]*/g);
      if (matches) {
        matches.forEach((raw) => reportVideo(raw));
      }
    }
  }

  // ─── 3. Intercept fetch ───────────────────────────────────────────────────────

  const IG_API_PATTERNS = [
    /instagram\.com\/graphql\/query/i,
    /instagram\.com\/api\/v1\//i,
    /instagram\.com\/api\/graphql/i,
    /instagram\.com\/.*\/?__a=1/i,
  ];

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : (args[0]?.url || "");

    // Direct CDN video request
    if (isInstagramCdnUrl(url)) reportVideo(url);

    return originalFetch.apply(this, args).then((response) => {
      const isApi = IG_API_PATTERNS.some((re) => re.test(url));
      const ct = response.headers.get("content-type") || "";
      if (isApi || ct.includes("application/json") || ct.includes("text/javascript")) {
        response.clone().text().then(parseAndScan).catch(() => {});
      }
      return response;
    });
  };

  // ─── 4. Intercept XHR ────────────────────────────────────────────────────────

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._vdlUrl = url;
    return originalOpen.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      if (!this._vdlUrl) return;
      if (isInstagramCdnUrl(this._vdlUrl)) reportVideo(this._vdlUrl);
      if (this.responseText) parseAndScan(this.responseText);
    });
    return originalSend.apply(this, arguments);
  };

  // ─── 5. MutationObserver — watch <video src> live ────────────────────────────

  function checkVideoElements() {
    document.querySelectorAll("video").forEach((v) => {
      // currentSrc is the actually playing source (resolves <source> children too)
      const src = v.currentSrc || v.src || "";
      if (src && !src.startsWith("blob:") && isInstagramCdnUrl(src)) {
        reportVideo(src);
      }
      // Also check explicit src attribute
      const attrSrc = v.getAttribute("src") || "";
      if (attrSrc && !attrSrc.startsWith("blob:") && isInstagramCdnUrl(attrSrc)) {
        reportVideo(attrSrc);
      }
    });
  }

  new MutationObserver(checkVideoElements).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });

  // Also listen for play events — Instagram sets src right before playing
  document.addEventListener("play", (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    const src = v.currentSrc || v.src || "";
    if (src && !src.startsWith("blob:") && isInstagramCdnUrl(src)) {
      reportVideo(src);
    }
  }, true);

  // ─── Init ─────────────────────────────────────────────────────────────────────

  // Run page data extraction immediately (data may already be in the page)
  extractFromPageData();
  checkVideoElements();

  // Re-run after a short delay in case React hasn't hydrated yet
  setTimeout(extractFromPageData, 1500);
  setTimeout(extractFromPageData, 4000);
})();
