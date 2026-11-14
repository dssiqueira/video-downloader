// x-buttons.js — isolated world, document_idle, x.com / twitter.com.
//
// Adds a download button to the action bar of every tweet that shows a video.
// On click it asks the service worker for the videos captured for that tweet
// (by the tweet's own ID or the ID of a quoted/retweeted post) and downloads
// the best quality.

(function () {
  "use strict";

  const BUTTON_CLASS = "vdl-download-btn";
  const VIDEO_SELECTOR = 'video, [data-testid="videoPlayer"], [data-testid="videoComponent"]';
  const { buildFilename } = globalThis.VDLExtract;

  function statusIds(article) {
    const ids = new Set();
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const m = /\/status\/(\d+)/.exec(a.getAttribute("href") || "");
      if (m) ids.add(m[1]);
    }
    return [...ids];
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError;
          resolve(response || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  async function onClick(event, article, button) {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      const { videos = [] } = await sendMessage({
        type: "VDL_GET_FOR_POST",
        platform: "twitter",
        postIds: statusIds(article),
      });
      if (!videos.length) {
        showToast("Vídeo ainda não carregado. Abra o tweet ou dê play e tente de novo.");
        return;
      }
      let started = 0;
      for (const video of videos) {
        const best = video.variants[0];
        const r = await sendMessage({ type: "VDL_DOWNLOAD", url: best.url, filename: buildFilename(video, best) });
        if (r.ok) started++;
      }
      showToast(started ? `Download iniciado (${started > 1 ? `${started} vídeos` : videos[0].variants[0].quality}).` : "Não foi possível baixar.");
    } finally {
      button.disabled = false;
    }
  }

  function createButton(article) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BUTTON_CLASS;
    btn.title = "Baixar vídeo (Video Downloader)";
    btn.setAttribute("aria-label", "Baixar vídeo");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v-2H5v2z"/></svg>';
    btn.addEventListener("click", (e) => onClick(e, article, btn));
    return btn;
  }

  function injectButtons() {
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (article.querySelector(`.${BUTTON_CLASS}`)) continue;
      if (!article.querySelector(VIDEO_SELECTOR)) continue;
      const groups = article.querySelectorAll('[role="group"]');
      const actionBar = groups[groups.length - 1];
      if (actionBar) actionBar.appendChild(createButton(article));
    }
  }

  function showToast(text) {
    document.getElementById("vdl-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "vdl-toast";
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      injectButtons();
    });
  }).observe(document.body, { childList: true, subtree: true });

  injectButtons();
})();
