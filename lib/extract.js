// extract.js — finds downloadable videos in X (Twitter) and Instagram JSON.
//
// Pure functions shared by the content bridge, the service worker and the
// popup (and by the Node tests). Loaded as a classic script: exposes
// `VDLExtract` on the global object, or module.exports under Node.
//
// Video shape returned by extractVideos():
// {
//   key:       "twitter:1234" | "instagram:5678"   unique per media file
//   platform:  "twitter" | "instagram"
//   postId:    tweet ID / Instagram shortcode that owns the video
//   aliases:   [other post IDs that show this video, e.g. a quoting tweet]
//   username:  author handle, if known
//   thumbnail: poster image URL, if known
//   durationMs
//   variants:  [{ url, width, height, bitrate, quality }]  best first
// }

(function (root) {
  "use strict";

  // ─── URL safety ──────────────────────────────────────────────────────────────

  // Video files are only ever downloaded from the platforms' own CDNs.
  const X_HOSTS = ["twimg.com"];
  const IG_HOSTS = ["cdninstagram.com", "fbcdn.net"];
  const VIDEO_HOSTS = [...X_HOSTS, ...IG_HOSTS];
  // Thumbnails come from the same CDNs.
  const IMAGE_HOSTS = VIDEO_HOSTS;

  function hostAllowed(url, hosts) {
    if (typeof url !== "string" || url.length > 4096) return false;
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === "https:" && hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
    } catch {
      return false;
    }
  }

  const isAllowedVideoUrl = (url) => hostAllowed(url, VIDEO_HOSTS);
  const isXVideoUrl = (url) => hostAllowed(url, X_HOSTS);
  const isIgVideoUrl = (url) => hostAllowed(url, IG_HOSTS);
  const isAllowedImageUrl = (url) => hostAllowed(url, IMAGE_HOSTS);

  // ─── Small helpers ───────────────────────────────────────────────────────────

  const isObj = (v) => v !== null && typeof v === "object";
  const str = (v) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

  // "/vid/avc1/720x1280/" or "/vid/1280x720/" → { width, height }
  function dimsFromUrl(url) {
    const m = /\/(\d{2,5})x(\d{2,5})\//.exec(url);
    return m ? { width: +m[1], height: +m[2] } : {};
  }

  function qualityLabel(width, height) {
    if (!width || !height) return null;
    return `${Math.min(width, height)}p`;
  }

  function sortVariants(variants) {
    return variants.sort(
      (a, b) =>
        (Math.min(b.width || 0, b.height || 0) - Math.min(a.width || 0, a.height || 0)) ||
        ((b.bitrate || 0) - (a.bitrate || 0))
    );
  }

  /** Parses an API response body: plain JSON, "for (;;);" prefixed, or NDJSON. */
  function parseJsonText(text) {
    if (typeof text !== "string") return [];
    const body = text.replace(/^\s*for \(;;\);/, "").trim();
    if (!body) return [];
    try {
      return [JSON.parse(body)];
    } catch {
      const out = [];
      for (const line of body.split("\n")) {
        const l = line.trim();
        if (!l || (l[0] !== "{" && l[0] !== "[")) continue;
        try {
          out.push(JSON.parse(l));
        } catch {
          /* skip */
        }
      }
      return out;
    }
  }

  // ─── X / Twitter ─────────────────────────────────────────────────────────────

  // https://x.com/user/status/123/video/1 → { username, statusId }
  function statusFromUrl(url) {
    const m = /(?:x|twitter)\.com\/([^/?#]+)\/status(?:es)?\/(\d+)/.exec(url || "");
    return m ? { username: m[1], statusId: m[2] } : {};
  }

  function tweetInfo(node) {
    // GraphQL: { rest_id, legacy, core: { user_results: { result: ... } } }
    if (str(node.rest_id) && /^\d+$/.test(node.rest_id) && isObj(node.legacy)) {
      const user = node.core?.user_results?.result;
      return {
        id: node.rest_id,
        username: str(user?.core?.screen_name) || str(user?.legacy?.screen_name),
      };
    }
    // Syndication / v1.1: { id_str, user: { screen_name } }
    if (str(node.id_str) && /^\d+$/.test(node.id_str) && isObj(node.user) && str(node.user.screen_name)) {
      return { id: node.id_str, username: node.user.screen_name };
    }
    return null;
  }

  function twitterVideo(media, ctx) {
    const variants = [];
    for (const v of media.video_info.variants) {
      if (!isObj(v)) continue;
      const url = str(v.url);
      const type = v.content_type || v.contentType || v.type;
      if (!url || (type && type !== "video/mp4") || !isXVideoUrl(url)) continue;
      const { width, height } = dimsFromUrl(url);
      variants.push({
        url,
        width: width || null,
        height: height || null,
        bitrate: typeof v.bitrate === "number" ? v.bitrate : null,
        quality: qualityLabel(width, height) || (media.type === "animated_gif" ? "GIF" : "MP4"),
      });
    }
    if (!variants.length) return null;

    const owner = statusFromUrl(media.expanded_url);
    const nearest = ctx.tweets[ctx.tweets.length - 1];
    const postId = owner.statusId || nearest?.id || null;
    const mediaId = str(media.id_str) || str(media.media_key) || variants[0].url;
    return {
      key: `twitter:${mediaId}`,
      platform: "twitter",
      postId,
      aliases: [...new Set(ctx.tweets.map((t) => t.id).filter((id) => id && id !== postId))],
      username: owner.username || nearest?.username || null,
      thumbnail: isAllowedImageUrl(media.media_url_https) ? media.media_url_https : null,
      durationMs: typeof media.video_info.duration_millis === "number" ? media.video_info.duration_millis : null,
      variants: sortVariants(variants),
    };
  }

  // ─── Instagram ───────────────────────────────────────────────────────────────

  // Shortcodes look like "C1aBcDeFgHi" (letters, digits, - and _).
  const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,64}$/;

  function igPostInfo(node) {
    const code = [node.code, node.shortcode].find((c) => typeof c === "string" && SHORTCODE_RE.test(c));
    if (!code) return null;
    return { code, username: str(node.user?.username) || str(node.owner?.username) };
  }

  function igThumb(node) {
    const candidates = node.image_versions2?.candidates;
    const url = (Array.isArray(candidates) && candidates[0]?.url) || node.display_url || node.thumbnail_src;
    return isAllowedImageUrl(url) ? url : null;
  }

  function igVideo(node, ctx, variants) {
    if (!variants.length) return null;
    const post = ctx.ig[ctx.ig.length - 1];
    const own = igPostInfo(node);
    const postId = own?.code || post?.code || null;
    const mediaId = str(node.pk) || str(node.id) || variants[0].url.split("?")[0];
    return {
      key: `instagram:${String(mediaId).split("_")[0]}`,
      platform: "instagram",
      postId,
      aliases: [],
      username: own?.username || post?.username || str(node.user?.username) || null,
      thumbnail: igThumb(node),
      durationMs: typeof node.video_duration === "number" ? Math.round(node.video_duration * 1000) : null,
      variants: sortVariants(variants),
    };
  }

  // v1 API / xdt GraphQL: { video_versions: [{ url, width, height }] }
  function igVersions(node) {
    const seen = new Set();
    const variants = [];
    for (const v of node.video_versions) {
      const url = str(v?.url);
      if (!url || !isIgVideoUrl(url)) continue;
      const base = url.split("?")[0];
      if (seen.has(base)) continue;
      seen.add(base);
      const width = typeof v.width === "number" ? v.width : null;
      const height = typeof v.height === "number" ? v.height : null;
      variants.push({ url, width, height, bitrate: null, quality: qualityLabel(width, height) || "MP4" });
    }
    return variants;
  }

  // Legacy GraphQL: { is_video, video_url, dimensions }
  function igLegacy(node) {
    const url = str(node.video_url);
    if (!url || !isIgVideoUrl(url)) return [];
    const width = node.dimensions?.width ?? null;
    const height = node.dimensions?.height ?? null;
    return [{ url, width, height, bitrate: null, quality: qualityLabel(width, height) || "MP4" }];
  }

  // ─── Walker ──────────────────────────────────────────────────────────────────

  const MAX_NODES = 500000;

  /**
   * Finds every video in a parsed JSON value (or a JSON text).
   * @param {*} input   parsed JSON, or a string with the response body
   * @returns {Array}   videos (see shape above), merged by key
   */
  function extractVideos(input) {
    const roots = typeof input === "string" ? parseJsonText(input) : [input];
    const found = new Map();
    const add = (video) => {
      if (!video) return;
      found.set(video.key, found.has(video.key) ? mergeVideo(found.get(video.key), video) : video);
    };

    for (const rootValue of roots) {
      const stack = [{ node: rootValue, ctx: { tweets: [], ig: [] } }];
      let visited = 0;
      while (stack.length && visited++ < MAX_NODES) {
        const { node, ctx } = stack.pop();
        if (!isObj(node)) continue;

        let next = ctx;
        if (!Array.isArray(node)) {
          const tweet = tweetInfo(node);
          if (tweet) next = { ...next, tweets: [...next.tweets, tweet] };
          const igPost = igPostInfo(node);
          if (igPost) next = { ...next, ig: [...next.ig, igPost] };

          if (isObj(node.video_info) && Array.isArray(node.video_info.variants)) {
            add(twitterVideo(node, next));
          }
          if (Array.isArray(node.video_versions) && node.video_versions.length) {
            add(igVideo(node, next, igVersions(node)));
          } else if (typeof node.video_url === "string" && node.is_video !== false) {
            add(igVideo(node, next, igLegacy(node)));
          }
        }

        const children = Array.isArray(node) ? node : Object.values(node);
        for (let i = children.length - 1; i >= 0; i--) {
          if (isObj(children[i])) stack.push({ node: children[i], ctx: next });
        }
      }
    }
    return [...found.values()];
  }

  /** Combines two captures of the same media (more variants, more aliases). */
  function mergeVideo(a, b) {
    const byUrl = new Map();
    for (const v of [...a.variants, ...b.variants]) {
      const base = v.url.split("?")[0];
      if (!byUrl.has(base)) byUrl.set(base, v);
    }
    const postId = a.postId || b.postId;
    return {
      ...a,
      postId,
      aliases: [...new Set([...a.aliases, ...b.aliases, a.postId, b.postId])].filter((id) => id && id !== postId),
      username: a.username || b.username,
      thumbnail: a.thumbnail || b.thumbnail,
      durationMs: a.durationMs || b.durationMs,
      variants: sortVariants([...byUrl.values()]),
    };
  }

  /** Re-checks a video received from another context before trusting it. */
  function sanitizeVideo(v) {
    if (!isObj(v) || !Array.isArray(v.variants)) return null;
    if (v.platform !== "twitter" && v.platform !== "instagram") return null;
    const text = (s, max = 200) => (typeof s === "string" && s.length <= max ? s : null);
    const num = (n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
    const hostOk = v.platform === "twitter" ? isXVideoUrl : isIgVideoUrl;
    const variants = v.variants
      .filter((x) => isObj(x) && hostOk(x.url))
      .slice(0, 20)
      .map((x) => ({
        url: x.url,
        width: num(x.width),
        height: num(x.height),
        bitrate: num(x.bitrate),
        quality: text(x.quality, 20) || "MP4",
      }));
    if (!variants.length || !text(v.key)) return null;
    return {
      key: v.key,
      platform: v.platform,
      postId: text(v.postId, 64),
      aliases: Array.isArray(v.aliases) ? v.aliases.map((a) => text(a, 64)).filter(Boolean).slice(0, 10) : [],
      username: text(v.username, 64),
      thumbnail: isAllowedImageUrl(v.thumbnail) ? v.thumbnail : null,
      durationMs: num(v.durationMs),
      variants: sortVariants(variants),
    };
  }

  // ─── Page / post helpers ─────────────────────────────────────────────────────

  /** Which post a page URL points to: { platform, postId } or { platform } or null. */
  function postFromUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const host = u.hostname.replace(/^www\.|^mobile\./, "");
    if (host === "x.com" || host === "twitter.com") {
      const m = /^\/[^/]+\/status\/(\d+)/.exec(u.pathname);
      return { platform: "twitter", postId: m ? m[1] : null };
    }
    if (host === "instagram.com") {
      const m = /^\/(?:[^/]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
      return { platform: "instagram", postId: m ? m[1] : null };
    }
    return null;
  }

  /** Videos that belong to (or are shown in) a given post. */
  function videosForPost(videos, platform, postIds) {
    const ids = new Set((Array.isArray(postIds) ? postIds : [postIds]).filter(Boolean));
    return videos.filter(
      (v) => v.platform === platform && (ids.has(v.postId) || v.aliases.some((a) => ids.has(a)))
    );
  }

  function buildFilename(video, variant) {
    const clean = (s) => String(s || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    const parts = [
      video.platform === "twitter" ? "x" : "instagram",
      clean(video.username),
      clean(video.postId),
      clean(variant?.quality),
    ].filter(Boolean);
    return `${parts.join("_") || "video"}.mp4`;
  }

  const api = {
    VIDEO_HOSTS,
    isAllowedVideoUrl,
    isAllowedImageUrl,
    parseJsonText,
    extractVideos,
    mergeVideo,
    sanitizeVideo,
    postFromUrl,
    videosForPost,
    buildFilename,
    qualityLabel,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VDLExtract = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
