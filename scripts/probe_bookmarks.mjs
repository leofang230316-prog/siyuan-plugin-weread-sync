// 探测划线接口的正确用法：先找出确实有划线的书，再对多种参数/端点变体实测。
import fs from "fs";

const WEB = "https://weread.qq.com";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CRED_FILE = "D:/siyuan-data/data/storage/petal/siyuan-plugin-weread-sync/credential.json";

function cookieHeader(cred) {
    return Object.entries(cred || {})
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}
function h(extra = {}) {
    return {
        "User-Agent": UA,
        Referer: WEB + "/web/shelf",
        Accept: "application/json, text/plain, */*",
        ...extra,
    };
}
async function req(url, cred, opts = {}) {
    try {
        const r = await fetch(url, { headers: h({ Cookie: cookieHeader(cred), ...(opts.headers || {}) }), ...opts });
        return { status: r.status, body: await r.text() };
    } catch (e) {
        return { status: -1, body: "ERR:" + e.message };
    }
}

function brief(label, res) {
    let keys = "(none)";
    let extra = "";
    try {
        const j = JSON.parse(res.body);
        keys = Object.keys(j).join(", ") || "(empty obj)";
        if (Array.isArray(j.updated)) extra = ` updated.len=${j.updated.length}`;
        if (j.updated?.[0]) extra += ` first=${JSON.stringify(j.updated[0]).slice(0, 260)}`;
        if (typeof j.errCode === "number") extra += ` errCode=${j.errCode} ${j.errMsg || ""}`;
    } catch {
        extra = " (not json) " + res.body.slice(0, 120);
    }
    console.log(`  [${res.status}] ${label}\n      keys: ${keys}${extra}`);
}

async function main() {
    const cred = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));

    // 1) 找出有划线的书
    const nb = await req(WEB + "/api/user/notebook", cred);
    const nbJson = JSON.parse(nb.body);
    const arr = nbJson.books ?? nbJson.data ?? [];
    console.log("=== notebook 各书计数（bookmark=划线, review=想法, note=笔记）===");
    const rows = arr
        .map((x) => ({
            bookId: String(x?.bookId ?? ""),
            title: String(x?.book?.title ?? "").slice(0, 24),
            bookmarkCount: x?.bookmarkCount ?? 0,
            reviewCount: x?.reviewCount ?? 0,
            noteCount: x?.noteCount ?? 0,
        }))
        .sort((a, b) => b.bookmarkCount - a.bookmarkCount);
    for (const r of rows) {
        console.log(
            `  ${r.bookId.padEnd(28)} bm=${String(r.bookmarkCount).padStart(3)} rv=${String(r.reviewCount).padStart(3)} note=${String(r.noteCount).padStart(3)}  ${r.title}`
        );
    }

    const target = rows.find((r) => r.bookmarkCount > 0) ?? rows[0];
    console.log(`\n>>> 用 bookId=${target.bookId} (bm=${target.bookmarkCount}) 测试划线接口变体\n`);

    const id = encodeURIComponent(target.bookId);
    const variants = [
        ["GET /web/book/bookmarklist?bookId=", `${WEB}/web/book/bookmarklist?bookId=${id}`],
        ["GET ...&syncKey=0", `${WEB}/web/book/bookmarklist?bookId=${id}&syncKey=0`],
        ["GET ...&syncKey=0&count=100", `${WEB}/web/book/bookmarklist?bookId=${id}&syncKey=0&count=100`],
        ["GET ...&count=100&maxIdx=0", `${WEB}/web/book/bookmarklist?bookId=${id}&count=100&maxIdx=0`],
        ["GET ...&mine=1", `${WEB}/web/book/bookmarklist?bookId=${id}&mine=1`],
        ["GET /api/book/bookmarklist", `${WEB}/api/book/bookmarklist?bookId=${id}`],
        ["GET /web/book/bookmarkList(大写L)", `${WEB}/web/book/bookmarkList?bookId=${id}`],
        ["GET /web/bookmark/list", `${WEB}/web/bookmark/list?bookId=${id}`],
        ["GET /web/book/bookmarks", `${WEB}/web/book/bookmarks?bookId=${id}`],
    ];
    for (const [label, url] of variants) {
        brief(label, await req(url, cred));
    }

    // POST 变体
    console.log("\n--- POST 变体 ---");
    brief(
        "POST /web/book/bookmarklist {bookId}",
        await req(`${WEB}/web/book/bookmarklist`, cred, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookId: target.bookId }),
        })
    );
    brief(
        "POST /web/book/bookmarklist {bookIds[]}",
        await req(`${WEB}/web/book/bookmarklist`, cred, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookIds: [target.bookId] }),
        })
    );
    console.log("\nEVENT:PROBE_DONE");
}

main().catch((e) => console.log("FATAL", e));
