// Run with: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const X = require("../lib/extract.js");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const json = (name) => JSON.parse(fixture(name));
const byKey = (videos) => Object.fromEntries(videos.map((v) => [v.key, v]));

test("X TweetDetail: video with mp4 variants, best first, owner from expanded_url", () => {
  const videos = byKey(X.extractVideos(json("x_tweet_detail.json")));
  const v = videos["twitter:1850000000000000100"];
  assert.ok(v, "video found");
  assert.equal(v.platform, "twitter");
  assert.equal(v.postId, "1850000000000000001");
  assert.equal(v.username, "nasa");
  assert.equal(v.durationMs, 15000);
  assert.match(v.thumbnail, /^https:\/\/pbs\.twimg\.com\//);
  assert.deepEqual(v.variants.map((x) => x.quality), ["720p", "480p", "320p"]);
  assert.equal(v.variants[0].bitrate, 2176000);
  assert.ok(v.variants.every((x) => x.url.startsWith("https://video.twimg.com/")), "only https twimg");
});

test("X: quoting tweet becomes an alias of the quoted video", () => {
  const v = byKey(X.extractVideos(json("x_tweet_detail.json")))["twitter:1850000000000000100"];
  assert.deepEqual(v.aliases, ["1850000000000000002"]);
  const all = X.extractVideos(json("x_tweet_detail.json"));
  assert.equal(X.videosForPost(all, "twitter", ["1850000000000000002"]).length, 1);
});

test("X: retweeted GIF (TweetWithVisibilityResults) and photos are handled", () => {
  const videos = byKey(X.extractVideos(json("x_tweet_detail.json")));
  const gif = videos["twitter:1850000000000000400"];
  assert.equal(gif.postId, "1850000000000000004");
  assert.equal(gif.username, "gifs");
  assert.equal(gif.variants[0].quality, "GIF");
  assert.ok(gif.aliases.includes("1850000000000000003"), "retweet id is an alias");
  assert.equal(videos["twitter:1850000000000000200"], undefined, "photo is not a video");
  assert.equal(Object.keys(videos).length, 2);
});

test("X syndication payload (embeds)", () => {
  const [v] = X.extractVideos(json("x_syndication.json"));
  assert.equal(v.postId, "1850000000000000500");
  assert.equal(v.username, "embed");
  assert.deepEqual(v.variants.map((x) => x.quality), ["1080p", "360p"]);
});

test("Instagram v1 media info: dedupes variants, drops foreign hosts", () => {
  const [v] = X.extractVideos(json("ig_media_info.json"));
  assert.equal(v.key, "instagram:3456789012345678901");
  assert.equal(v.platform, "instagram");
  assert.equal(v.postId, "C1aBcDeFgHi");
  assert.equal(v.username, "natgeo");
  assert.equal(v.durationMs, 12500);
  assert.deepEqual(v.variants.map((x) => x.quality), ["720p", "480p"]);
  assert.ok(v.variants.every((x) => new URL(x.url).hostname.endsWith("cdninstagram.com")));
  assert.match(v.thumbnail, /cdninstagram\.com/);
});

test("Instagram carousel: child video inherits the post shortcode and author", () => {
  const videos = X.extractVideos(json("ig_graphql_carousel.json"));
  assert.equal(videos.length, 1);
  const [v] = videos;
  assert.equal(v.key, "instagram:12");
  assert.equal(v.postId, "CarouSel_01");
  assert.equal(v.username, "travel");
  assert.equal(v.variants[0].quality, "1080p");
});

test("Instagram legacy shortcode_media (video_url)", () => {
  const [v] = X.extractVideos(json("ig_legacy_shortcode.json"));
  assert.equal(v.postId, "B0LdLegacy1");
  assert.equal(v.username, "old");
  assert.equal(v.variants[0].quality, "640p");
  assert.match(v.thumbnail, /fbcdn\.net/);
});

test("Response text: 'for (;;);' prefix and NDJSON", () => {
  assert.equal(X.extractVideos(fixture("ig_for_loop.txt")).length, 1);
  const reels = X.extractVideos(fixture("ig_ndjson.txt"));
  assert.deepEqual(reels.map((v) => v.postId).sort(), ["ReelOne_001", "ReelTwo_002"]);
  assert.deepEqual(X.extractVideos("not json"), []);
});

test("Traps: X error codes, X video_url and wrong hosts produce nothing", () => {
  assert.deepEqual(X.extractVideos(json("traps.json")), []);
});

test("mergeVideo combines variants and aliases", () => {
  const [a] = X.extractVideos(json("ig_media_info.json"));
  const b = { ...a, postId: null, aliases: ["Other_post1"], variants: [{ url: "https://scontent.cdninstagram.com/new.mp4", width: 1080, height: 1920, bitrate: null, quality: "1080p" }] };
  const m = X.mergeVideo(a, b);
  assert.equal(m.postId, "C1aBcDeFgHi");
  assert.deepEqual(m.aliases, ["Other_post1"]);
  assert.deepEqual(m.variants.map((x) => x.quality), ["1080p", "720p", "480p"]);
});

test("sanitizeVideo rejects tampered data", () => {
  const [good] = X.extractVideos(json("x_syndication.json"));
  assert.ok(X.sanitizeVideo(good));
  assert.equal(X.sanitizeVideo({ ...good, platform: "youtube" }), null);
  assert.equal(X.sanitizeVideo({ ...good, variants: [{ url: "https://evil.com/a.mp4" }] }), null);
  assert.equal(X.sanitizeVideo({ ...good, variants: [{ url: "https://scontent.cdninstagram.com/a.mp4" }] }), null, "IG host on an X video");
  const s = X.sanitizeVideo({ ...good, username: "<b>x</b>".repeat(50), thumbnail: "https://evil.com/t.jpg" });
  assert.equal(s.username, null);
  assert.equal(s.thumbnail, null);
});

test("isAllowedVideoUrl", () => {
  for (const ok of ["https://video.twimg.com/a.mp4", "https://scontent-gru1-1.cdninstagram.com/a.mp4", "https://instagram.fgru5-1.fna.fbcdn.net/a.mp4"])
    assert.ok(X.isAllowedVideoUrl(ok), ok);
  for (const bad of ["http://video.twimg.com/a.mp4", "https://evil.com/?fbcdn.net", "https://evilfbcdn.net/a", "https://twimg.com.evil.com/a", "javascript:alert(1)", "nope", 42])
    assert.ok(!X.isAllowedVideoUrl(bad), String(bad));
});

test("postFromUrl", () => {
  assert.deepEqual(X.postFromUrl("https://x.com/nasa/status/123?s=20"), { platform: "twitter", postId: "123" });
  assert.deepEqual(X.postFromUrl("https://twitter.com/nasa/status/123/video/1"), { platform: "twitter", postId: "123" });
  assert.deepEqual(X.postFromUrl("https://x.com/home"), { platform: "twitter", postId: null });
  assert.deepEqual(X.postFromUrl("https://www.instagram.com/p/C1aBcDeFgHi/"), { platform: "instagram", postId: "C1aBcDeFgHi" });
  assert.deepEqual(X.postFromUrl("https://www.instagram.com/reel/ReelOne_001/?igsh=x"), { platform: "instagram", postId: "ReelOne_001" });
  assert.deepEqual(X.postFromUrl("https://www.instagram.com/natgeo/reel/ReelOne_001/"), { platform: "instagram", postId: "ReelOne_001" });
  assert.equal(X.postFromUrl("https://example.com/"), null);
  assert.equal(X.postFromUrl("garbage"), null);
});

test("buildFilename is safe and descriptive", () => {
  const [v] = X.extractVideos(json("x_tweet_detail.json"));
  assert.equal(X.buildFilename(v, v.variants[0]), "x_nasa_1850000000000000001_720p.mp4");
  assert.equal(X.buildFilename({ platform: "instagram", username: "../../etc", postId: "a/b", variants: [] }, { quality: "720p" }), "instagram_etc_a_b_720p.mp4");
});
