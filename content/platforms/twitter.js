// twitter.js - Content script for X.com / Twitter
// Detects video elements and intercepts video URLs

(function () {
  "use strict";

  const BUTTON_CLASS = "vdl-download-btn";
  const processedVideos = new Set();

  // ─── Network interception ────────────────────────────────────────────────────

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._vdlUrl = url;
    return originalOpen.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      if (this._vdlUrl) handleNetworkUrl(this._vdlUrl, this.responseText);
    });
    return originalSend.apply(this, arguments);
  };

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url =
      typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    return originalFetch.apply(this, args).then((response) => {
      const cloned = response.clone();
      cloned.text().then((text) => handleNetworkUrl(url, text)).catch(() => {});
      return response;
    });
  };

  function handleNetworkUrl(url, responseText) {
    if (url.includes("video.twimg.com") && url.includes(".mp4")) {
      reportVideo({
        url,
        quality: resolveQuality(url),
        type: "mp4",
        platform: "twitter",
      });
    }

    if (
      (url.includes("/TweetDetail") ||
        url.includes("/TweetResultByRestId") ||
        url.includes("tweet_result")) &&
      responseText
    ) {
      try {
        extractVideosFromTweetJson(JSON.parse(responseText));
      } catch (_) {}
    }
  }

  function extractVideosFromTweetJson(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.video_info && Array.isArray(obj.video_info.variants)) {
      obj.video_info.variants.forEach((v) => {
        if (v.url && v.content_type === "video/mp4") {
          reportVideo({
            url: v.url,
            quality: resolveQuality(v.url, v.bitrate),
            bitrate: v.bitrate,
            type: "mp4",
            platform: "twitter",
          });
        }
      });
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "object") extractVideosFromTweetJson(obj[key]);
    }
  }

  function resolveQuality(url, bitrate) {
    const m = url.match(/\/(\d{3,5})x(\d{3,5})\//);
    if (m) {
      const h = Math.min(parseInt(m[1], 10), parseInt(m[2], 10));
      if (h >= 1080) return "1080p";
      if (h >= 720) return "720p";
      if (h >= 480) return "480p";
      if (h >= 360) return "360p";
      return `${h}p`;
    }
    if (bitrate) {
      if (bitrate >= 5000000) return "1080p";
      if (bitrate >= 2000000) return "720p";
      if (bitrate >= 800000) return "480p";
      if (bitrate >= 300000) return "360p";
      return "270p";
    }
    return "MP4";
  }

  function reportVideo(video) {
    if (processedVideos.has(video.url)) return;
    processedVideos.add(video.url);
    chrome.runtime.sendMessage({ type: "VIDEO_FOUND", video }, () => {
      if (chrome.runtime.lastError) {}
    });
  }

  // ─── Inject download buttons ─────────────────────────────────────────────────

  function injectDownloadButtons() {
    document
      .querySelectorAll('article[data-testid="tweet"]')
      .forEach((article) => {
        if (!article.querySelector("video")) return;
        if (article.querySelector(`.${BUTTON_CLASS}`)) return;
        const actionBar = article.querySelector('[role="group"]');
        if (!actionBar) return;
        actionBar.appendChild(createButton(article));
      });
  }

  function createButton(article) {
    const btn = document.createElement("button");
    btn.className = BUTTON_CLASS;
    btn.title = "Download video (Video Downloader)";
    btn.setAttribute("aria-label", "Download video");
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v-2H5v2z"/>
      </svg>`;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const videoEl = article.querySelector("video");
      const src = videoEl?.src || videoEl?.currentSrc;
      if (src && src.includes("video.twimg.com")) {
        chrome.runtime.sendMessage(
          { type: "DOWNLOAD_VIDEO", url: src, filename: `twitter_${Date.now()}.mp4` },
          (r) => showToast(r?.success ? "Download iniciado!" : "Use o popup para baixar.")
        );
      } else {
        showToast("Abra o popup da extensão para baixar o vídeo.");
      }
    });
    return btn;
  }

  function showToast(msg) {
    const el = document.getElementById("vdl-toast");
    if (el) el.remove();
    const t = document.createElement("div");
    t.id = "vdl-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ─── Observer ────────────────────────────────────────────────────────────────

  new MutationObserver(injectDownloadButtons).observe(document.body, {
    childList: true,
    subtree: true,
  });

  injectDownloadButtons();
})();
