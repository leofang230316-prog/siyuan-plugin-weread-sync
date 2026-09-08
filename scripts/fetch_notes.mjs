// 用本地已有凭证实测笔记接口，打印真实字段结构（不重新登录）。
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

async function get(url, cred) {
    try {
        const r = await fetch(url, { headers: h({ Cookie: cookieHeader(cred) }) });
        const body = await r.text();
        return { status: r.status, body };
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
        console.log("  (not json) body head:", res.body.slice(0, 200));
        return null;
    }
    console.log("  top keys:", Object.keys(json).join(", "));
    if (typeof json.errCode === "number") console.log("  errCode:", json.errCode, json.errMsg || "");
    if (typeof json.errcode === "number") console.log("  errcode:", json.errcode, json.errmsg || "");
    for (const k of ["updated", "reviews", "books", "data", "bookIds"]) {
        if (Array.isArray(json[k]) && json[k].length) {
            console.log(`  ${k}: length=${json[k].length}`);
            const first = json[k][0];
            console.log(`  ${k}[0] keys:`, Object.keys(first || {}).join(", "));
            console.log(`  ${k}[0] sample:`, JSON.stringify(first).slice(0, 700));
            if (json[k].length > 1) {
                console.log(`  ${k}[1] sample:`, JSON.stringify(json[k][1]).slice(0, 400));
            }
        }
    }
    return json;
}

async function main() {
    const cred = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
    console.log("cred keys:", Object.keys(cred).join(", "));

    summarize("web/shelf/sync", await get(WEB + "/web/shelf/sync", cred));

    const nb = summarize("api/user/notebook", await get(WEB + "/api/user/notebook", cred));
    let notedIds = [];
    if (nb) {
        const arr = nb.books ?? nb.data ?? [];
        notedIds = arr.map((x) => String(x?.bookId ?? x?.book?.bookId ?? "")).filter(Boolean);
    }
    console.log("\nnoted book ids:", JSON.stringify(notedIds.slice(0, 10)));

    const targets = notedIds.slice(0, 3);
    for (const bookId of targets) {
        console.log(`\n\n########## bookId=${bookId} ##########`);
        summarize("api/book/info", await get(WEB + `/api/book/info?bookId=${encodeURIComponent(bookId)}`, cred));
        summarize(
            "web/book/bookmarklist",
            await get(WEB + `/web/book/bookmarklist?bookId=${encodeURIComponent(bookId)}`, cred)
        );
        summarize(
            "web/review/list",
            await get(
                WEB +
                    `/web/review/list?bookId=${encodeURIComponent(bookId)}&listType=4&maxIdx=0&count=0&listMode=2&syncKey=0`,
                cred
            )
        );
        summarize(
            "web/book/chapterInfos",
            await post(WEB + "/web/book/chapterInfos", cred, { bookIds: [bookId] })
        );
    }
}

main().catch((e) => console.log("FATAL", e));
