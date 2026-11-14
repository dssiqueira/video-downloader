// bridge.js — runs in the extension's isolated world at document_start on
// x.com and instagram.com, after lib/extract.js.
//
// Receives API response text from content/hook.js (page world), extracts the
// videos and sends them to the service worker. Also reads the JSON that
// Instagram embeds in the HTML on first load (server-side rendered posts).

(function () {
  "use strict";

  const { extractVideos } = globalThis.VDLExtract;

  function send(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (_) {
      /* extension reloaded; ignore */
    }
  }

  function report(videos) {
    if (videos.length) send({ type: "VDL_FOUND", videos, pageUrl: location.href });
  }

  // A full page load starts a fresh list for this tab (signed URLs expire).
  send({ type: "VDL_PAGE_START" });

  // ─── From hook.js ────────────────────────────────────────────────────────────

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "vdl-hook" || typeof data.text !== "string") return;
    try {
      report(extractVideos(data.text));
    } catch (_) {}
  });

  // ─── Instagram: JSON embedded in the page ────────────────────────────────────

  const scanned = new WeakSet();

  function scanEmbeddedJson() {
    const found = [];
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if (scanned.has(script)) continue;
      scanned.add(script);
      const text = script.textContent || "";
      if (!/"video_versions"|"video_url"/.test(text)) continue;
      try {
        found.push(...extractVideos(text));
      } catch (_) {}
    }
    report(found);
  }

  if (location.hostname.endsWith("instagram.com")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scanEmbeddedJson, { once: true });
    } else {
      scanEmbeddedJson();
    }
    window.addEventListener("load", scanEmbeddedJson, { once: true });
  }
})();
