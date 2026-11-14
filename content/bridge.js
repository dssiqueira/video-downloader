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
  //
  // Instagram ships post data in <script type="application/json"> blocks, both
  // in the initial HTML and in blocks it inserts later while you navigate.

  const JSON_SCRIPT = 'script[type="application/json"]';
  const scanned = new WeakSet();

  function scanEmbeddedJson() {
    const found = [];
    for (const script of document.querySelectorAll(JSON_SCRIPT)) {
      if (scanned.has(script)) continue;
      const text = script.textContent || "";
      if (!text) continue; // may be filled in later; look again next time
      scanned.add(script);
      if (!/"video_versions"|"video_url"/.test(text)) continue;
      try {
        found.push(...extractVideos(text));
      } catch (_) {}
    }
    report(found);
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanEmbeddedJson();
    }, 250);
  }

  function addsJsonScript(mutation) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.(JSON_SCRIPT) || node.querySelector?.(JSON_SCRIPT)) return true;
    }
    // Text added to an existing (previously empty) JSON block.
    return mutation.type === "childList" && mutation.target.matches?.(JSON_SCRIPT);
  }

  if (location.hostname.endsWith("instagram.com")) {
    new MutationObserver((mutations) => {
      if (mutations.some(addsJsonScript)) scheduleScan();
    }).observe(document, { childList: true, subtree: true });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scanEmbeddedJson, { once: true });
    } else {
      scanEmbeddedJson();
    }
    window.addEventListener("load", scanEmbeddedJson, { once: true });
  }
})();
