// popup.js - Video Downloader

const tweetUrlInput    = document.getElementById("tweet-url");
const btnFetch         = document.getElementById("btn-fetch");
const btnRefresh       = document.getElementById("btn-refresh");
const btnClear         = document.getElementById("btn-clear");
const statusEl         = document.getElementById("status");
const videoListEl      = document.getElementById("video-list");
const qualityListEl    = document.getElementById("quality-list");
const pageVideoSection = document.getElementById("page-videos-section");
const pageVideoList    = document.getElementById("page-video-list");
const emptyState       = document.getElementById("empty-state");
const emptyHint        = document.getElementById("empty-hint");
const platformBadge    = document.getElementById("platform-badge");
const urlSection       = document.getElementById("url-section");

// ─── Platform metadata ────────────────────────────────────────────────────────

const PLATFORMS = {
  twitter:   { label: "X / Twitter", icon: "../icons/apps/twitter.png" },
  instagram: { label: "Instagram",   icon: "../icons/apps/social.png"  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.classList.remove("hidden");
}

function hideStatus() {
  statusEl.classList.add("hidden");
}

function setLoading(loading) {
  btnFetch.disabled = loading;
  btnFetch.textContent = loading ? "Buscando..." : "Buscar";
}

function formatBitrate(bitrate) {
  if (!bitrate) return "";
  return `${Math.round(bitrate / 1000)} kbps`;
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return null;
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576)    return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024)       return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function buildFilename(platform, username, quality) {
  const safeQuality = (quality || "video")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "video";
  const user = username ? `${username}_` : "";
  const pfx  = (platform || "video").replace(/[^a-zA-Z0-9]/g, "_");
  return `${pfx}_${user}${safeQuality}.mp4`;
}

function extractTweetId(url) {
  const m = url.match(/status\/(\d+)/);
  return m ? m[1] : null;
}

function extractUsernameFromUrl(url) {
  const m = url.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status\//);
  return m ? m[1] : null;
}

function detectPlatformFromUrl(url) {
  if (!url) return null;
  if (url.includes("x.com") || url.includes("twitter.com")) return "twitter";
  if (url.includes("instagram.com")) return "instagram";
  return null;
}

// ─── Render video list ────────────────────────────────────────────────────────

function renderVideoList(videos, container, username = null) {
  container.innerHTML = "";

  if (!videos || videos.length === 0) {
    container.innerHTML = '<li class="empty-item">Nenhum vídeo encontrado.</li>';
    return;
  }

  const sorted = [...videos].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  sorted.forEach((video, index) => {
    const li           = document.createElement("li");
    li.className       = "quality-item";

    const qualityLabel = video.quality || `Opção ${index + 1}`;
    const bitrateLabel = video.bitrate ? formatBitrate(video.bitrate) : "";
    const sizeLabel    = formatFileSize(video.fileSize);
    const isHighest    = index === 0;
    const filename     = buildFilename(video.platform, username, qualityLabel);
    const platformInfo = PLATFORMS[video.platform];
    const platformIcon = platformInfo
      ? `<img src="${platformInfo.icon}" alt="${platformInfo.label}" class="platform-icon-sm">`
      : "";

    const metaParts = [bitrateLabel, sizeLabel].filter(Boolean);
    const metaLine  = metaParts.join(" · ");

    li.innerHTML = `
      <div class="quality-info">
        <div class="quality-top">
          ${platformIcon}
          <span class="quality-badge">${qualityLabel}${isHighest ? " ⭐" : ""}</span>
        </div>
        ${metaLine ? `<span class="quality-meta">${metaLine}</span>` : ""}
      </div>
      <button class="btn-download"
        data-url="${video.url}"
        data-filename="${filename}"
        aria-label="Baixar ${qualityLabel}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v-2H5v2z"/>
        </svg>
        Baixar
      </button>
    `;

    container.appendChild(li);
  });

  container.querySelectorAll(".btn-download").forEach((btn) => {
    btn.addEventListener("click", () => {
      downloadVideo(btn.dataset.url, btn.dataset.filename, btn);
    });
  });
}

// ─── Download ─────────────────────────────────────────────────────────────────

function downloadVideo(url, filename, btn) {
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
    </svg> Baixando...`;

  chrome.runtime.sendMessage({ type: "DOWNLOAD_VIDEO", url, filename }, (response) => {
    if (response?.success) {
      btn.innerHTML = `✓ Iniciado`;
      btn.style.background = "#00ba7c";
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.style.background = "";
        btn.disabled = false;
      }, 2500);
    } else {
      showStatus("Erro ao baixar. Tente novamente.", "error");
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }
  });
}

// ─── Fetch videos from URL (Twitter / X only) ────────────────────────────────

async function fetchVideosFromUrl(inputUrl) {
  const tweetId = extractTweetId(inputUrl);
  if (!tweetId) {
    showStatus("URL inválida. Use: https://x.com/user/status/ID", "error");
    return;
  }

  const urlUsername = extractUsernameFromUrl(inputUrl);

  setLoading(true);
  showStatus("Buscando vídeo...", "loading");
  videoListEl.classList.add("hidden");
  emptyState.classList.add("hidden");

  chrome.runtime.sendMessage({ type: "FETCH_TWEET_VIDEOS", tweetId }, (response) => {
    setLoading(false);

    if (chrome.runtime.lastError) {
      showStatus("Erro interno. Recarregue a página.", "error");
      emptyState.classList.remove("hidden");
      return;
    }

    if (!response?.success || !response.videos?.length) {
      showStatus("Nenhum vídeo encontrado. O post pode não ter vídeo ou estar protegido.", "error");
      emptyState.classList.remove("hidden");
      return;
    }

    hideStatus();
    renderVideoList(response.videos, qualityListEl, response.username || urlUsername);
    videoListEl.classList.remove("hidden");
  });
}

// ─── Load videos detected on current page ────────────────────────────────────

async function loadPageVideos() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const platform = detectPlatformFromUrl(tab.url || "");

  // Platform badge
  if (platform && PLATFORMS[platform]) {
    const meta = PLATFORMS[platform];
    platformBadge.innerHTML = `<img src="${meta.icon}" alt="${meta.label}" class="badge-icon"><span>${meta.label}</span>`;
    platformBadge.classList.remove("hidden");
  } else {
    platformBadge.classList.add("hidden");
  }

  // URL input only shown on X/Twitter
  const isTwitter = platform === "twitter";
  urlSection.classList.toggle("hidden", !isTwitter && !!platform);

  if (isTwitter && tab.url?.includes("/status/")) {
    tweetUrlInput.value = tab.url;
  }

  // Load cached page videos
  chrome.runtime.sendMessage({ type: "GET_VIDEOS", tabId: tab.id }, (response) => {
    const videos = response?.videos || [];
    if (videos.length > 0) {
      renderVideoList(videos, pageVideoList);
      pageVideoSection.classList.remove("hidden");
      emptyState.classList.add("hidden");
    } else {
      pageVideoSection.classList.add("hidden");
      emptyState.classList.remove("hidden");
      if (platform === "instagram") {
        emptyHint.innerHTML = "Reproduza um vídeo no Instagram<br/>e clique em Atualizar";
      } else if (!platform) {
        emptyHint.innerHTML = "Navegue pelo X ou Instagram<br/>e reproduza um vídeo";
      }
    }
  });
}

// ─── Event listeners ──────────────────────────────────────────────────────────

btnFetch.addEventListener("click", () => {
  const url = tweetUrlInput.value.trim();
  if (!url) { showStatus("Cole a URL do post primeiro.", "error"); return; }
  fetchVideosFromUrl(url);
});

tweetUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnFetch.click();
});

btnRefresh.addEventListener("click", () => {
  videoListEl.classList.add("hidden");
  loadPageVideos();
});

btnClear.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ type: "CLEAR_VIDEOS", tabId: tab.id }, () => {
    pageVideoSection.classList.add("hidden");
    emptyState.classList.remove("hidden");
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  await loadPageVideos();
})();
