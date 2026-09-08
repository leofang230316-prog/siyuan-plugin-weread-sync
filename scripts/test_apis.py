#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用本地真实凭证实测微信读书 web 接口，打印真实返回结构。
仅用于本地调试，不写入任何日志/文档。"""
import json
import os
import urllib.request
import urllib.error

CRED_PATH = r"D:\siyuan-data\data\storage\petal\siyuan-plugin-weread-sync\credential.json"
WEB = "https://weread.qq.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

def load_cookie():
    with open(CRED_PATH, "r", encoding="utf-8") as f:
        cred = json.load(f)
    parts = []
    for k, v in cred.items():
        if k.startswith("wr_") or k in ("userName",):
            parts.append(f"{k}={v}")
    return "; ".join(parts)

COOKIE = load_cookie()

def get(url, referer=f"{WEB}/web/shelf"):
    req = urllib.request.Request(url)
    req.add_header("Cookie", COOKIE)
    req.add_header("User-Agent", UA)
    req.add_header("Referer", referer)
    req.add_header("Accept", "application/json, text/plain, */*")
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, f"ERR:{e}"

def post(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Cookie", COOKIE)
    req.add_header("User-Agent", UA)
    req.add_header("Referer", f"{WEB}/web/shelf")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json, text/plain, */*")
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, f"ERR:{e}"

def head(url, n=400):
    return (url or "")[:n]

print("=" * 70)
print("1) web/shelf/sync")
st, body = get(f"{WEB}/web/shelf/sync")
print("status:", st, "len:", len(body))
try:
    j = json.loads(body)
    print("top keys:", list(j.keys())[:20])
    books = j.get("books") or j.get("data", {}).get("books") or []
    print("book count:", len(books))
    if books:
        b0 = books[0]
        print("book[0] keys:", list(b0.keys()))
        print("book[0] sample:", json.dumps(b0, ensure_ascii=False)[:300])
except Exception as e:
    print("parse fail:", e, body[:200])

print("=" * 70)
print("2) api/user/notebook (noted books)")
st, body = get(f"{WEB}/api/user/notebook")
print("status:", st, "len:", len(body))
try:
    j = json.loads(body)
    print("top keys:", list(j.keys())[:20])
    nb = j.get("books") or j.get("data") or []
    print("noted book count:", len(nb))
    if nb:
        print("noted[0]:", json.dumps(nb[0], ensure_ascii=False)[:300])
except Exception as e:
    print("parse fail:", e, body[:200])

# pick a book id that has notes
book_id = None
try:
    j = json.loads(get(f"{WEB}/api/user/notebook")[1])
    nb = j.get("books") or j.get("data") or []
    if nb:
        first = nb[0]
        book_id = str(first.get("bookId") or first.get("book", {}).get("bookId") or "")
except Exception:
    pass
# fallback: use shelf first book
if not book_id:
    try:
        j = json.loads(get(f"{WEB}/web/shelf/sync")[1])
        books = j.get("books") or j.get("data", {}).get("books") or []
        if books:
            book_id = str(books[0].get("bookId"))
    except Exception:
        pass
print("CHOSEN bookId:", book_id)

if book_id:
    print("=" * 70)
    print("3) web/book/bookmarklist")
    st, body = get(f"{WEB}/web/book/bookmarklist?bookId={book_id}")
    print("status:", st, "len:", len(body))
    try:
        j = json.loads(body)
        print("top keys:", list(j.keys()))
        upd = j.get("updated") or []
        print("updated count:", len(upd))
        if upd:
            print("bookmark[0] keys:", list(upd[0].keys()))
            print("bookmark[0]:", json.dumps(upd[0], ensure_ascii=False)[:400])
    except Exception as e:
        print("parse fail:", e, body[:200])

    print("=" * 70)
    print("4) web/review/list")
    url = f"{WEB}/web/review/list?bookId={book_id}&listType=4&maxIdx=0&count=0&listMode=2&syncKey=0"
    st, body = get(url)
    print("status:", st, "len:", len(body))
    try:
        j = json.loads(body)
        print("top keys:", list(j.keys()))
        revs = j.get("reviews") or []
        print("reviews count:", len(revs))
        if revs:
            r0 = revs[0]
            print("review[0] keys:", list(r0.keys()) if isinstance(r0, dict) else type(r0))
            print("review[0]:", json.dumps(r0, ensure_ascii=False)[:500])
    except Exception as e:
        print("parse fail:", e, body[:200])

    print("=" * 70)
    print("5) web/book/chapterInfos (POST)")
    st, body = post(f"{WEB}/web/book/chapterInfos", {"bookIds": [book_id]})
    print("status:", st, "len:", len(body))
    try:
        j = json.loads(body)
        print("top keys:", list(j.keys()))
        data0 = (j.get("data") or [])
        if data0:
            entry = data0[0]
            print("data[0] keys:", list(entry.keys()))
            upd = entry.get("updated") or []
            print("chapters count:", len(upd))
            if upd:
                print("chapter[0]:", json.dumps(upd[0], ensure_ascii=False)[:200])
    except Exception as e:
        print("parse fail:", e, body[:200])

    print("=" * 70)
    print("6) api/book/info")
    st, body = get(f"{WEB}/api/book/info?bookId={book_id}")
    print("status:", st, "len:", len(body))
    try:
        j = json.loads(body)
        print("book info:", json.dumps(j, ensure_ascii=False)[:400])
    except Exception as e:
        print("parse fail:", e, body[:200])

    print("=" * 70)
    print("7) web/book/getProgress")
    st, body = get(f"{WEB}/web/book/getProgress?bookId={book_id}")
    print("status:", st, "len:", len(body))
    try:
        j = json.loads(body)
        print("progress:", json.dumps(j, ensure_ascii=False)[:300])
    except Exception as e:
        print("parse fail:", e, body[:200])

    print("=" * 70)
    print("8) cover download (first book from shelf)")
    try:
        j = json.loads(get(f"{WEB}/web/shelf/sync")[1])
        books = j.get("books") or j.get("data", {}).get("books") or []
        if books:
            cover = books[0].get("cover") or ""
            print("cover url:", cover[:200])
            if cover:
                st, data = get(cover, referer=f"{WEB}/web/shelf")
                print("cover status:", st, "bytes:", len(data))
    except Exception as e:
        print("cover fail:", e)
