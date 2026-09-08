// 监听本地凭证文件变化：一旦用户在插件里扫码登录成功（凭证文件被更新），
// 立刻用新凭证实测全部数据接口，打印真实字段结构。
// 这样用户只需要在插件界面扫码，抓取由脚本自动完成。
import fs from "fs";
import path from "path";

const WEB = "https://weread.qq.com";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CRED_FILE = "D:/siyuan-data/data/storage/petal/siyuan-plugin-weread-sync/credential.json";
const OUT_FILE = "D:/app/微信读书插件/fetch_result.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function get(url, cred) {
    try {
        const r = await fetch(url, { headers: h({ Cookie: cookieHeader(cred) }) });
        return { status: r.status, body: await r.text() };
    } catch (e) {
        return { status: -1, body: "ERR:" + e.message };
    }
}
async function post(url, cred, payload) {
    try {
        const r = await fetch(url, {
            method: "POST",
            headers: h({ Cookie: cookieHeader(cred), "Content-Type": "application/json" }),
            body: JSON.stringify(payload),
        });
        return { status: r.status, body: await r.text() };
    } catch (e) {
        return { status: -1, body: "ERR:" + e.message };
    }
}

function summarize(label, res) {
    console.log(`\n===== ${label} =====`);
    console.log("  http status:", res.status);
    if (!res.body) {
        console.log("  (empty body)");
        return null;
    }
    let json = null;
    try {
        json = JSON.parse(res.body);
    } catch {
        console.log("  (not json) head:", res.body.slice(0, 200));
        return null;
    }
    console.log("  top keys:", Object.keys(json).join(", "));
    if (typeof json.errCode === "number") console.log("  errCode:", json.errCode, json.errMsg || "");
    if (typeof json.errcode === "number") console.log("  errcode:", json.errcode, json.errmsg || "");
    for (const k of ["updated", "reviews", "books", "data", "bookIds"]) {
        if (Array.isArray(json[k]) && json[k].length) {
            console.log(`  ${k}: length=${json[k].length}`);
            console.log(`  ${k}[0] keys:`, Object.keys(json[k][0] || {}).join(", "));
            console.log(`  ${k}[0] sample:`, JSON.stringify(json[k][0]).slice(0, 800));
            if (json[k].length > 1) {
                console.log(`  ${k}[1] sample:`, JSON.stringify(json[k][1]).slice(0, 400));
            }
        } else if (Array.isArray(json[k])) {
            console.log(`  ${k}: EMPTY ARRAY`);
        }
    }
    return json;
}

async function fetchAll(cred) {
    const out = {};
    console.log("\n>>> credential keys:", Object.keys(cred).join(", "));

    const shelf = await get(WEB + "/web/shelf/sync", cred);
    out.shelf = summarize("web/shelf/sync", shelf) ? "ok" : "fail";

    const nbJson = summarize("api/user/notebook", await get(WEB + "/api/user/notebook", cred));
    let notedIds = [];
    if (nbJson) {
        const arr = nbJson.books ?? nbJson.data ?? [];
        if (Array.isArray(arr)) {
            notedIds = arr.map((x) => String(x?.bookId ?? x?.book?.bookId ?? "")).filter(Boolean);
        }
    }
    console.log("\nnoted book ids:", JSON.stringify(notedIds.slice(0, 10)));
    out.notedIds = notedIds;

    const targets = notedIds.slice(0, 3);
    out.books = {};
    for (const bookId of targets) {
        console.log(`\n\n########## bookId=${bookId} ##########`);
        const b = {};
        b.info = summarize("api/book/info", await get(WEB + `/api/book/info?bookId=${encodeURIComponent(bookId)}`, cred));
        b.bookmarks = summarize(
            "web/book/bookmarklist",
            await get(WEB + `/web/book/bookmarklist?bookId=${encodeURIComponent(bookId)}`, cred)
        );
        b.reviews = summarize(
            "web/review/list",
            await get(
                WEB +
                    `/web/review/list?bookId=${encodeURIComponent(bookId)}&listType=4&maxIdx=0&count=0&listMode=2&syncKey=0`,
                cred
            )
        );
        b.chapters = summarize(
            "web/book/chapterInfos",
            await post(WEB + "/web/book/chapterInfos", cred, { bookIds: [bookId] })
        );
        out.books[bookId] = {
            bookmarkCount: b.bookmarks?.updated?.length ?? 0,
            reviewCount: b.reviews?.reviews?.length ?? 0,
        };
        await sleep(300);
    }
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
    console.log("\nEVENT:FETCH_DONE");
}

async function main() {
    const baseline = fs.statSync(CRED_FILE).mtimeMs;
    console.log("EVENT:WATCHING baseline_mtime=" + baseline + " (等待插件内扫码登录...)");
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
        await sleep(2000);
        try {
            const st = fs.statSync(CRED_FILE);
            if (st.mtimeMs > baseline) {
                console.log("EVENT:CRED_UPDATED new_mtime=" + st.mtimeMs);
                await sleep(1500);
                const cred = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
                if (!cred.wr_skey) {
                    console.log("EVENT:ERROR msg=no-skey-in-credential");
                    process.exit(2);
                }
                await fetchAll(cred);
                return;
            }
        } catch (e) {
            /* ignore transient */
        }
    }
    console.log("EVENT:ERROR msg=watch-timeout-30min");
}

main().catch((e) => console.log("FATAL", e));
