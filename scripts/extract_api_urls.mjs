// 从前端 JS 中提取所有含 bookmark/mark 的接口路径，并检查 listType=5 的真实数据。
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
        return { status: r.status, body: await r.text() };
    } catch (e) {
        return { status: -1, body: "ERR:" + e.message };
    }
}

const JS_URLS = [
    "https://weread-1258476243.file.myqcloud.com/web/book-detail/27cc1e6.js",
    "https://cdn.weread.qq.com/web/wrwebnjlogic/js/app.a5baf81f.js",
];

async function main() {
    const cred = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));

    console.log("===== 1) 从 JS 提取含 mark/bookmark 的接口路径 =====");
    for (const url of JS_URLS) {
        let js = "";
        try {
            const r = await fetch(url, { headers: { "User-Agent": UA } });
            if (!r.ok) {
                console.log(`  [${r.status}] ${url}`);
                continue;
            }
            js = await r.text();
        } catch (e) {
            console.log("  ERR", e.message);
            continue;
        }
        console.log(`\n>>> ${url} (${js.length} chars)`);
        // 所有 /web/... 或 /api/... 路径中含 mark 的
        const paths = [...js.matchAll(/["'`](\/(?:web|api)\/[A-Za-z0-9_\-\/]*)["'`]/g)].map((m) => m[1]);
        const markPaths = [...new Set(paths.filter((p) => /mark/i.test(p)))];
        console.log("  mark 相关路径:", markPaths.length ? markPaths.join(", ") : "(none)");
        // 直接搜 bookmarklist / bookmark 附近字符串
        const near = [...new Set([...js.matchAll(/.{80}bookmarklist.{120}/gi)].map((m) => m[0].replace(/\s+/g, " ")))];
        for (const x of near.slice(0, 6)) console.log("  [bookmarklist] ..." + x + "...");
        const near2 = [...new Set([...js.matchAll(/.{80}bookMarks.{100}/gi)].map((m) => m[0].replace(/\s+/g, " ")))];
        for (const x of near2.slice(0, 6)) console.log("  [bookMarks] ..." + x + "...");
        // items 字段来源：搜 fetchBookBookMarkList 附近
        const near3 = [
            ...new Set([...js.matchAll(/.{100}BookMarkList.{200}/gi)].map((m) => m[0].replace(/\s+/g, " "))),
        ];
        for (const x of near3.slice(0, 6)) console.log("  [BookMarkList] ..." + x + "...");
    }

    console.log("\n===== 2) listType=5 的真实数据（对比 listType=4）=====");
    for (const bookId of ["718151", "43830871", "25926862"]) {
        for (const listType of [4, 5]) {
            const url =
                `${WEB}/web/review/list?bookId=${bookId}&listType=${listType}&maxIdx=0&count=0&listMode=2&syncKey=0`;
            const res = await get(url, cred);
            try {
                const j = JSON.parse(res.body);
                const list = j.reviews ?? [];
                console.log(`\n  bookId=${bookId} listType=${listType} -> totalCount=${j.totalCount} len=${list.length}`);
                list.slice(0, 3).forEach((item, i) => {
                    const r = item?.review ?? item;
                    console.log(
                        `    #${i} type=${r.type} ch=${r.chapterName || r.chapterTitle} abstract="${String(
                            r.abstract ?? ""
                        ).slice(0, 40)}" content="${String(r.content ?? "").slice(0, 40)}"`
                    );
                });
            } catch {
                console.log(`  bookId=${bookId} listType=${listType} -> status ${res.status} (not json)`);
            }
        }
    }
    console.log("\nEVENT:EXTRACT_DONE");
}

main().catch((e) => console.log("FATAL", e));
