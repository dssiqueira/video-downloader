// background.js — service worker.
//
// Keeps the videos captured in each tab, answers the popup and the in-page
// download buttons, and performs downloads (only from the platforms' CDNs).
// The list lives in memory and in chrome.storage.session, so it survives the
// service worker being stopped while the tab stays open.

"use strict";

importScripts("../lib/extract.js");
const VDL = self.VDLExtract;

const MAX_VIDEOS_PER_TAB = 300;
const SIZE_TIMEOUT_MS = 5000;

// ─── Per-tab store ─────────────────────────────────────────────────────────────

const memory = new Map(); // tabId → Map(key → video)
const queues = new Map(); // tabId → Promise (serializes updates per tab)

const storageKey = (tabId) => `tab:${tabId}`;

async function load(tabId) {
  if (memory.has(tabId)) return memory.get(tabId);
  let saved = {};
  try {
    saved = (await chrome.storage.session.get(storageKey(tabId)))[storageKey(tabId)] || {};
  } catch (_) {}
  const map = new Map(Object.entries(saved));
  memory.set(tabId, map);
  return map;
}

function persist(tabId, map) {
  chrome.storage.session.set({ [storageKey(tabId)]: Object.fromEntries(map) }).catch(() => {});
  const count = map.size;
  chrome.action.setBadgeText({ tabId, text: count ? String(Math.min(count, 99)) : "" }).catch(() => {});
}

function withTab(tabId, fn) {
  const run = (queues.get(tabId) || Promise.resolve()).then(fn, fn);
  queues.set(tabId, run.catch(() => {}));
  return run;
}

function listOf(map) {
  return [...map.values()].sort((a, b) => b.capturedAt - a.capturedAt);
}

function addVideos(tabId, videos) {
  return withTab(tabId, async () => {
    const map = await load(tabId);
    const now = Date.now();
    for (const raw of videos.slice(0, 200)) {
      const video = VDL.sanitizeVideo(raw);
      if (!video) continue;
      const prev = map.get(video.key);
      map.delete(video.key); // re-insert to keep insertion order = recency
      map.set(video.key, { ...(prev ? VDL.mergeVideo(prev, video) : video), capturedAt: now });
    }
    while (map.size > MAX_VIDEOS_PER_TAB) map.delete(map.keys().next().value);
    persist(tabId, map);
    return map.size;
  });
}

function clearTab(tabId) {
  return withTab(tabId, async () => {
    memory.set(tabId, new Map());
    await chrome.storage.session.remove(storageKey(tabId)).catch(() => {});
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  memory.delete(tabId);
  queues.delete(tabId);
  chrome.storage.session.remove(storageKey(tabId)).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: "#1d9bf0" }).catch(() => {});
});

// ─── Downloads ─────────────────────────────────────────────────────────────────

function safeFilename(name) {
  const base = String(name || "video").replace(/\.mp4$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 120);
  return `${base || "video"}.mp4`;
}

async function download(url, filename) {
  if (!VDL.isAllowedVideoUrl(url)) throw new Error("URL de vídeo não permitida.");
  return chrome.downloads.download({ url, filename: safeFilename(filename), conflictAction: "uniquify" });
}

const sizes = new Map(); // url without query → bytes | null

async function fileSize(url) {
  if (!VDL.isAllowedVideoUrl(url)) return null;
  const key = url.split("?")[0];
  if (sizes.has(key)) return sizes.get(key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIZE_TIMEOUT_MS);
  let size = null;
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal, credentials: "omit" });
    const len = Number(res.headers.get("content-length"));
    if (res.ok && len > 0) size = len;
  } catch (_) {
  } finally {
    clearTimeout(timer);
  }
  sizes.set(key, size);
  return size;
}

// ─── Messages ──────────────────────────────────────────────────────────────────

const EXTENSION_ORIGIN = chrome.runtime.getURL("");

/**
 * Tab the message is about. Extension pages (the popup, even when opened in a
 * tab) name it explicitly; content scripts can only ever act on their own tab
 * (their sender.url is the site's URL, so they cannot pass as extension pages).
 */
function tabFor(message, sender) {
  const fromExtensionPage = sender.id === chrome.runtime.id && String(sender.url || "").startsWith(EXTENSION_ORIGIN);
  if (fromExtensionPage) return Number.isInteger(message.tabId) ? message.tabId : null;
  return sender.tab ? sender.tab.id : null;
}

async function handle(message, sender) {
  const tabId = tabFor(message, sender);

  switch (message?.type) {
    case "VDL_PAGE_START":
      if (sender.tab) await clearTab(tabId);
      return { ok: true };

    case "VDL_FOUND":
      if (!sender.tab || !Array.isArray(message.videos)) return { ok: false };
      return { ok: true, count: await addVideos(tabId, message.videos) };

    case "VDL_GET":
      if (tabId == null) return { ok: false, videos: [] };
      return { ok: true, videos: listOf(await load(tabId)) };

    case "VDL_GET_FOR_POST": {
      if (tabId == null) return { ok: false, videos: [] };
      const list = listOf(await load(tabId));
      return { ok: true, videos: VDL.videosForPost(list, message.platform, message.postIds) };
    }

    case "VDL_CLEAR":
      if (tabId != null) await clearTab(tabId);
      return { ok: true };

    case "VDL_SIZE":
      return { ok: true, size: await fileSize(message.url) };

    case "VDL_DOWNLOAD":
      try {
        const downloadId = await download(message.url, message.filename);
        return { ok: true, downloadId };
      } catch (e) {
        return { ok: false, error: e.message };
      }

    default:
      return { ok: false, error: "unknown message" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});
