// popup.js — lists the videos captured in the active tab and downloads them.
"use strict";

const VDL = globalThis.VDLExtract;

const PLATFORMS = {
  twitter: { label: "X / Twitter", icon: "../icons/apps/twitter.png" },
  instagram: { label: "Instagram", icon: "../icons/apps/social.png" },
};

const MAX_OTHERS = 50;
const SIZE_LOOKUPS = 12;

const $ = (id) => document.getElementById(id);
const els = {
  badge: $("platform-badge"),
  status: $("status"),
  currentSection: $("current-section"),
  currentList: $("current-list"),
  othersSection: $("others-section"),
  othersTitle: $("others-title"),
  othersList: $("others-list"),
  empty: $("empty-state"),
  emptyHint: $("empty-hint"),
};

let tab = null;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      void chrome.runtime.lastError;
      resolve(response || {});
    });
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function setStatus(text, kind = "info") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
  els.status.classList.toggle("hidden", !text);
}

async function getTab() {
  const param = Number(new URLSearchParams(location.search).get("tab"));
  if (Number.isInteger(param) && param > 0) return chrome.tabs.get(param);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active || null;
}

// ─── Rendering ─────────────────────────────────────────────────────────────────

const sizeQueue = [];

function variantRow(video, variant) {
  const li = el("li", "quality-item");
  const info = el("div", "quality-info");
  info.appendChild(el("span", "quality-badge", variant.quality));
  const meta = el("span", "quality-meta");
  const parts = [];
  if (variant.width && variant.height) parts.push(`${variant.width}×${variant.height}`);
  if (variant.bitrate) parts.push(`${Math.round(variant.bitrate / 1000)} kbps`);
  meta.textContent = parts.join(" · ");
  info.appendChild(meta);
  sizeQueue.push({ url: variant.url, meta, parts });

  const btn = el("button", "btn-download");
  btn.type = "button";
  btn.setAttribute("aria-label", `Baixar ${variant.quality}`);
  btn.insertAdjacentHTML(
    "afterbegin",
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v-2H5v2z"/></svg>'
  );
  btn.appendChild(document.createTextNode("Baixar"));
  btn.addEventListener("click", () => downloadVariant(video, variant, btn));

  li.append(info, btn);
  return li;
}

function videoCard(video) {
  const card = el("li", "video-card");
  const head = el("div", "video-head");

  if (video.thumbnail) {
    const img = el("img", "thumb");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.src = video.thumbnail;
    img.addEventListener("error", () => img.remove());
    head.appendChild(img);
  }

  const title = el("div", "video-title");
  const platform = PLATFORMS[video.platform];
  if (platform) {
    const icon = el("img", "platform-icon-sm");
    icon.src = platform.icon;
    icon.alt = platform.label;
    title.appendChild(icon);
  }
  title.appendChild(el("span", "author", video.username ? `@${video.username}` : platform?.label || "Vídeo"));
  const details = [formatDuration(video.durationMs), video.postId ? `post ${video.postId}` : ""].filter(Boolean);
  if (details.length) title.appendChild(el("span", "video-sub", details.join(" · ")));
  head.appendChild(title);

  const list = el("ul", "quality-list nested");
  for (const variant of video.variants) list.appendChild(variantRow(video, variant));

  card.append(head, list);
  return card;
}

async function loadSizes() {
  const jobs = sizeQueue.splice(0, SIZE_LOOKUPS);
  await Promise.all(
    jobs.map(async ({ url, meta, parts }) => {
      const { size } = await send({ type: "VDL_SIZE", url });
      if (size) meta.textContent = [...parts, formatBytes(size)].join(" · ");
    })
  );
}

function showPlatform(platform) {
  const info = PLATFORMS[platform];
  els.badge.replaceChildren();
  els.badge.classList.toggle("hidden", !info);
  if (!info) return;
  const icon = el("img", "badge-icon");
  icon.src = info.icon;
  icon.alt = "";
  els.badge.append(icon, el("span", null, info.label));
}

function emptyHint(platform) {
  if (!platform) return "Abra o X ou o Instagram e navegue até um vídeo.";
  const where =
    platform === "twitter"
      ? "Role a timeline ou abra um tweet com vídeo."
      : "Abra um post, reel ou story com vídeo.";
  return `Nenhum vídeo capturado nesta aba ainda.\n${where}\nSe a aba já estava aberta antes de instalar ou atualizar a extensão, recarregue a página.`;
}

async function render() {
  sizeQueue.length = 0;
  setStatus("");
  const page = tab?.url ? VDL.postFromUrl(tab.url) : null;
  showPlatform(page?.platform);

  const { videos = [] } = tab && page ? await send({ type: "VDL_GET", tabId: tab.id }) : {};
  const current = page?.postId ? VDL.videosForPost(videos, page.platform, [page.postId]) : [];
  const currentKeys = new Set(current.map((v) => v.key));
  const others = videos.filter((v) => !currentKeys.has(v.key)).slice(0, MAX_OTHERS);

  els.currentList.replaceChildren(...current.map(videoCard));
  els.currentSection.classList.toggle("hidden", !current.length);

  els.othersList.replaceChildren(...others.map(videoCard));
  els.othersTitle.textContent = current.length ? "Outros vídeos nesta aba" : "Vídeos nesta aba";
  els.othersSection.classList.toggle("hidden", !others.length);

  const nothing = !current.length && !others.length;
  els.emptyHint.textContent = emptyHint(page?.platform);
  els.empty.classList.toggle("hidden", !nothing);

  if (page?.postId && !current.length && others.length) {
    setStatus("O vídeo deste post ainda não foi capturado. Dê play nele ou recarregue a página.", "info");
  }
  loadSizes();
}

// ─── Actions ───────────────────────────────────────────────────────────────────

async function downloadVariant(video, variant, btn) {
  btn.disabled = true;
  const r = await send({ type: "VDL_DOWNLOAD", url: variant.url, filename: VDL.buildFilename(video, variant) });
  if (r.ok) {
    setStatus(`Download iniciado: ${variant.quality}.`, "success");
  } else {
    setStatus(r.error || "Não foi possível baixar este vídeo.", "error");
    btn.disabled = false;
  }
}

$("btn-refresh").addEventListener("click", render);
$("btn-clear").addEventListener("click", async () => {
  if (tab) await send({ type: "VDL_CLEAR", tabId: tab.id });
  render();
});

(async () => {
  try {
    tab = await getTab();
  } catch (_) {
    tab = null;
  }
  render();
})();
