// hook.js — runs in the PAGE's JavaScript world ("world": "MAIN") at
// document_start on x.com and instagram.com.
//
// X and Instagram load their posts through their own API calls, and those
// JSON responses already contain the MP4 URLs of every video. This script
// wraps fetch() and XMLHttpRequest so it can read a copy of the API responses
// that mention videos and hand the text to content/bridge.js (isolated world)
// via window.postMessage. It never changes requests or responses, and never
// makes requests of its own.

(function () {
  "use strict";

  if (window.__vdlHooked) return;
  Object.defineProperty(window, "__vdlHooked", { value: true });

  // API endpoints that carry post/timeline data.
  const API_RE = /\/i\/api\/graphql\/|\/i\/api\/2\/|\/graphql\/query|\/api\/graphql|\/api\/v1\/|tweet-result/;
  // Cheap pre-check so only responses that mention videos are forwarded.
  const VIDEO_HINT_RE = /"video_info"|"video_versions"|"video_url"/;
  const MAX_TEXT = 20 * 1024 * 1024;

  function forward(url, text) {
    if (typeof text !== "string" || text.length > MAX_TEXT || !VIDEO_HINT_RE.test(text)) return;
    window.postMessage({ source: "vdl-hook", url: String(url).slice(0, 500), text }, location.origin);
  }

  function urlOf(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return (input && input.url) || "";
  }

  // ─── fetch ───────────────────────────────────────────────────────────────────

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      const promise = originalFetch.apply(this, arguments);
      try {
        const url = urlOf(input);
        if (API_RE.test(url)) {
          promise.then(
            (response) => {
              try {
                response.clone().text().then((text) => forward(url, text), () => {});
              } catch (_) {
                /* body already used or opaque */
              }
            },
            () => {}
          );
        }
      } catch (_) {
        /* never break the page */
      }
      return promise;
    };
  }

  // ─── XMLHttpRequest ──────────────────────────────────────────────────────────

  const xhrUrls = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      xhrUrls.set(this, urlOf(url));
    } catch (_) {}
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    try {
      const url = xhrUrls.get(this);
      if (url && API_RE.test(url)) {
        this.addEventListener("load", function () {
          try {
            if (this.responseType === "" || this.responseType === "text") forward(url, this.responseText);
            else if (this.responseType === "json" && this.response) forward(url, JSON.stringify(this.response));
          } catch (_) {}
        });
      }
    } catch (_) {}
    return originalSend.apply(this, arguments);
  };
})();
