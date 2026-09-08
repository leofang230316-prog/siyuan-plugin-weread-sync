# -*- coding: utf-8 -*-
"""拉取微信读书首页 -> 提取 Nuxt JS（含 CDN 绝对地址）-> 搜索登录相关逻辑原文"""
import re, os, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}
CACHE = os.path.join(os.path.dirname(__file__), ".cache")
os.makedirs(CACHE, exist_ok=True)


def get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()


def main():
    html = get("https://weread.qq.com/").decode("utf-8", "ignore")
    urls = set(re.findall(r'<script[^>]*src="([^"]+\.js)"', html))
    urls |= set(re.findall(r'["\'](/_nuxt/[^"\']+\.js)["\']', html))
    # Nuxt 3 payload 里还会有 buildManifest / 预加载列表
    for m in re.findall(r'"(https://cdn\.weread\.qq\.com/[^"]+\.js)"', html):
        urls.add(m)
    urls = sorted(urls)
    print(f"发现 JS: {len(urls)}")
    for u in urls:
        print("   ", u)

    hits = []
    for u in urls:
        full = u if u.startswith("http") else "https://weread.qq.com" + u
        name = re.sub(r"[^A-Za-z0-9._-]", "_", u)[-80:]
        path = os.path.join(CACHE, name)
        if os.path.exists(path):
            data = open(path, "rb").read()
        else:
            try:
                data = get(full)
            except Exception as e:
                print(f"  [skip] {u}: {e}")
                continue
            with open(path, "wb") as f:
                f.write(data)
        txt = data.decode("utf-8", "ignore")
        if "getLoginInfo" in txt or "getLoginUid" in txt:
            hits.append((u, txt))
            print(f"  [HIT] {u}  ({len(txt)} chars)")

    if not hits:
        print("未找到登录相关 JS")
        return

    for u, txt in hits:
        print("\n" + "=" * 70)
        print("FILE:", u)
        print("=" * 70)
        for kw in ["getLoginUid", "getLoginInfo", "logicCode", "canRetry", "accessToken", "webLoginVid", "LOGIN_TIMEOUT"]:
            for m in re.finditer(re.escape(kw), txt):
                s = max(0, m.start() - 350)
                e = min(len(txt), m.end() + 350)
                print(f"\n--- {kw} @ {m.start()} ---")
                print(txt[s:e].replace("\n", " "))


main()
