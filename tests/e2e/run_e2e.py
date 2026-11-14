"""End-to-end test: loads the unpacked extension in Chrome and drives fake
x.com / instagram.com pages whose API responses come from tests/fixtures.

    pip install playwright && python -m playwright install chromium
    python tests/e2e/run_e2e.py [--chrome /path/to/chrome] [--screenshots DIR]

No network access or login is needed: every request to x.com, instagram.com
and the video CDNs is answered locally.
"""

import argparse
import asyncio
import json
import os
import pathlib
import sys
import tempfile

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
os.environ.setdefault("PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS", "1")

X_PAGE = """<!doctype html><html><body>
<article data-testid="tweet">
  <a href="/nasa/status/1850000000000000001"><time>1h</time></a>
  <div data-testid="videoPlayer"><video></video></div>
  <div role="group" aria-label="actions"><button>reply</button></div>
</article>
<article data-testid="tweet">
  <a href="/fan/status/1850000000000000002"><time>2h</time></a>
  <div><div data-testid="videoComponent"></div></div>
  <div role="group" aria-label="actions"><button>reply</button></div>
</article>
<article data-testid="tweet">
  <a href="/someone/status/1850000000000000999"><time>3h</time></a>
  <p>text only</p>
  <div role="group" aria-label="actions"><button>reply</button></div>
</article>
<script>
  // The site's own code: fetch (TweetDetail) and XHR (syndication-style payload).
  window.pageChecks = {};
  fetch('/i/api/graphql/abc123/TweetDetail?variables=%7B%7D', {credentials: 'include'})
    .then(r => r.json())
    .then(j => { window.pageChecks.fetchOk = !!(j && j.data); });
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/i/api/graphql/def456/TweetResultByRestId');
  xhr.onload = () => { window.pageChecks.xhrOk = xhr.status === 200 && xhr.responseText.length > 10; };
  xhr.send();
</script>
</body></html>"""

IG_PAGE = """<!doctype html><html><body>
<script type="application/json" data-sjs>__SSR__</script>
<main>reel</main>
<script>
  window.pageChecks = {};
  fetch('/api/v1/media/3456789012345678901/info/')
    .then(r => r.json()).then(j => { window.pageChecks.fetchOk = j.status === 'ok'; });
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/graphql/query');
  xhr.onload = () => { window.pageChecks.xhrOk = xhr.status === 200; };
  xhr.send('doc_id=1');
</script>
</body></html>"""

passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))


async def route_all(context):
    fx = lambda n: (FIXTURES / n).read_text()

    async def x_site(route):
        url = route.request.url
        if "/TweetDetail" in url:
            await route.fulfill(status=200, content_type="application/json", body=fx("x_tweet_detail.json"))
        elif "/TweetResultByRestId" in url:
            await route.fulfill(status=200, content_type="application/json", body=fx("x_syndication.json"))
        else:
            await route.fulfill(status=200, content_type="text/html", body=X_PAGE)

    async def ig_site(route):
        url = route.request.url
        if "/api/v1/media/" in url:
            await route.fulfill(status=200, content_type="application/json", body=fx("ig_media_info.json"))
        elif "/graphql/query" in url:
            await route.fulfill(status=200, content_type="text/javascript", body=fx("ig_ndjson.txt"))
        else:
            await route.fulfill(status=200, content_type="text/html", body=IG_PAGE.replace("__SSR__", fx("ig_graphql_carousel.json")))

    async def media(route):
        await route.fulfill(status=200, headers={"content-type": "video/mp4", "content-length": "2097152"}, body=b"\0" * 2097152)

    async def image(route):
        await route.fulfill(status=404, body="")

    await context.route("https://x.com/**", x_site)
    await context.route("https://www.instagram.com/**", ig_site)
    await context.route("https://video.twimg.com/**", media)
    await context.route("https://*.cdninstagram.com/**", media)
    await context.route("https://*.fbcdn.net/**", media)
    await context.route("https://pbs.twimg.com/**", image)


async def popup_for(context, ext_id, tab_id):
    popup = await context.new_page()
    await popup.set_viewport_size({"width": 380, "height": 900})
    await popup.goto(f"chrome-extension://{ext_id}/popup/popup.html?tab={tab_id}")
    await popup.wait_for_timeout(800)
    return popup


async def main(chrome, shots):
    async with async_playwright() as p:
        kwargs = dict(headless=True, accept_downloads=True,
                      args=[f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}",
                            "--disable-features=DisableLoadExtensionCommandLineSwitch", "--no-sandbox"])
        if chrome:
            kwargs["executable_path"] = chrome
        else:
            kwargs["channel"] = "chromium"  # full Chromium; the headless shell can't load extensions
        context = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), **kwargs)
        await route_all(context)
        sw = context.service_workers[0] if context.service_workers else await context.wait_for_event("serviceworker", timeout=15000)
        ext_id = sw.url.split("/")[2]
        errors = []
        # Playwright renames downloaded files, so record what the extension asks for.
        await sw.evaluate("""() => {
          self.__downloads = [];
          const original = chrome.downloads.download.bind(chrome.downloads);
          chrome.downloads.download = (opts) => { self.__downloads.push(opts); return original(opts); };
        }""")

        # ─── X ──────────────────────────────────────────────────────────────────
        print("X / Twitter")
        page = await context.new_page()
        page.on("pageerror", lambda e: errors.append(f"x page: {e}"))
        await page.goto("https://x.com/nasa/status/1850000000000000001")
        await page.wait_for_timeout(1500)
        checks = await page.evaluate("window.pageChecks")
        check("page fetch still works with the hook", checks.get("fetchOk") is True, checks)
        check("page XHR still works with the hook", checks.get("xhrOk") is True, checks)

        tab_id = await sw.evaluate("async () => (await chrome.tabs.query({url: 'https://x.com/*'}))[0].id")
        videos = await sw.evaluate(f"async () => Object.values((await chrome.storage.session.get('tab:{tab_id}'))['tab:{tab_id}'] || {{}})")
        keys = sorted(v["key"] for v in videos)
        check("captured X videos (fetch + XHR)", keys == ["twitter:1850000000000000100", "twitter:1850000000000000400", "twitter:1850000000000000501"], keys)
        badge = await sw.evaluate(f"() => chrome.action.getBadgeText({{tabId: {tab_id}}})")
        check("badge shows the count", badge == "3", badge)

        buttons = await page.locator(".vdl-download-btn").count()
        check("download button only on tweets with video", buttons == 2, buttons)

        await page.locator(".vdl-download-btn").nth(1).click()  # quote tweet → quoted video
        await page.wait_for_timeout(1200)
        toast = await page.locator("#vdl-toast").text_content()
        check("button on the quoting tweet downloads the quoted video", "Download iniciado" in (toast or ""), toast)
        dl = await sw.evaluate("() => self.__downloads")
        check("download uses best quality and a clean filename",
              any(d["url"].endswith("720x1280/c.mp4?tag=12") and d["filename"] == "x_nasa_1850000000000000001_720p.mp4" for d in dl), dl)
        started = await sw.evaluate("async () => (await chrome.downloads.search({})).map(d => d.url)")
        check("Chrome registered the download", any(u.endswith("c.mp4?tag=12") for u in started), started)

        popup = await popup_for(context, ext_id, tab_id)
        popup.on("pageerror", lambda e: errors.append(f"popup: {e}"))
        current = await popup.locator("#current-list .video-card").count()
        others = await popup.locator("#others-list .video-card").count()
        check("popup: 'Este post' shows the tweet's video", current == 1, current)
        check("popup: other videos listed", others == 2, others)
        qualities = await popup.locator("#current-list .quality-badge").all_text_contents()
        check("popup: qualities best first", qualities == ["720p", "480p", "320p"], qualities)
        author = await popup.locator("#current-list .author").text_content()
        check("popup: author", author == "@nasa", author)
        if shots:
            await popup.screenshot(path=str(pathlib.Path(shots) / "popup-x.png"), full_page=True)
        await popup.close()

        # Reload clears the old list and captures again.
        await page.reload()
        await page.wait_for_timeout(1500)
        count = await sw.evaluate(f"async () => Object.keys((await chrome.storage.session.get('tab:{tab_id}'))['tab:{tab_id}'] || {{}}).length")
        check("reload starts a fresh list (no duplicates)", count == 3, count)

        # A fake message with a foreign URL must be ignored.
        await page.evaluate("""() => window.postMessage({source: 'vdl-hook', text: JSON.stringify({video_versions: [{url: 'https://evil.com/x.mp4', width: 1, height: 1}], code: 'Evil12345'})}, location.origin)""")
        await page.wait_for_timeout(500)
        count = await sw.evaluate(f"async () => Object.keys((await chrome.storage.session.get('tab:{tab_id}'))['tab:{tab_id}'] || {{}}).length")
        check("forged message with foreign URL is ignored", count == 3, count)

        # ─── Instagram ──────────────────────────────────────────────────────────
        print("Instagram")
        ig = await context.new_page()
        ig.on("pageerror", lambda e: errors.append(f"ig page: {e}"))
        await ig.goto("https://www.instagram.com/reel/C1aBcDeFgHi/")
        await ig.wait_for_timeout(1500)
        checks = await ig.evaluate("window.pageChecks")
        check("IG page fetch/XHR still work", checks.get("fetchOk") is True and checks.get("xhrOk") is True, checks)
        ig_tab = await sw.evaluate("async () => (await chrome.tabs.query({url: 'https://www.instagram.com/*'}))[0].id")
        videos = await sw.evaluate(f"async () => Object.values((await chrome.storage.session.get('tab:{ig_tab}'))['tab:{ig_tab}'] || {{}})")
        posts = sorted(v["postId"] for v in videos)
        check("captured IG: SSR JSON + fetch + NDJSON XHR", posts == ["C1aBcDeFgHi", "CarouSel_01", "ReelOne_001", "ReelTwo_002"], posts)

        popup = await popup_for(context, ext_id, ig_tab)
        popup.on("pageerror", lambda e: errors.append(f"popup ig: {e}"))
        check("IG popup: current reel first", await popup.locator("#current-list .author").text_content() == "@natgeo")
        await popup.locator("#current-list .btn-download").first.click()
        await popup.wait_for_timeout(1000)
        status = await popup.locator("#status").text_content()
        check("IG popup: download starts", "Download iniciado" in (status or ""), status)
        dl = await sw.evaluate("() => self.__downloads.map(d => d.filename)")
        check("IG filename", "instagram_natgeo_C1aBcDeFgHi_720p.mp4" in dl, dl)
        if shots:
            await popup.screenshot(path=str(pathlib.Path(shots) / "popup-instagram.png"), full_page=True)

        # Empty state on an unsupported page.
        await context.route("https://example.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body="<p>hi</p>"))
        before = set(await sw.evaluate("async () => (await chrome.tabs.query({})).map(t => t.id)"))
        other = await context.new_page()
        await other.goto("https://example.com/")
        after = await sw.evaluate("async () => (await chrome.tabs.query({})).map(t => t.id)")
        other_tab = max(set(after) - before)
        popup2 = await popup_for(context, ext_id, other_tab)
        hint = await popup2.locator("#empty-hint").text_content()
        visible = await popup2.locator("#empty-state").is_visible()
        check("empty state on other sites", visible and "Abra o X ou o Instagram" in (hint or ""), hint)

        check("no JavaScript errors", not errors, errors)
        await context.close()

    print(f"\n{len(passed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome", help="Chrome/Chromium executable (default: Playwright's Chromium)")
    ap.add_argument("--screenshots", help="directory for popup screenshots")
    a = ap.parse_args()
    if a.screenshots:
        os.makedirs(a.screenshots, exist_ok=True)
    sys.exit(asyncio.run(main(a.chrome, a.screenshots)))
