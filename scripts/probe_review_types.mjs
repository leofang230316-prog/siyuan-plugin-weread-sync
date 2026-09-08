// 验证：划线数据是否藏在 review/list 里（用 type 区分），并测试不同 listType。
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

// bm=1 的书（有划线）与作为对照的 rv 多的书
const TARGETS = [
    { bookId: "CB_EvX4Cl4EpDca71o71U0Xk1ZP", note: "bm=1 rv=0 侯卫东官场笔记" },
    { bookId: "718151", note: "bm=1 rv=2 南京大屠杀" },
    { bookId: "CB_DSH8OT8Ry6Gc6rm6tC5W6GMk", note: "bm=1 rv=0 二号首长" },
];

async function main() {
    const cred = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
    for (const t of TARGETS) {
        console.log(`\n########## ${t.bookId}  (${t.note}) ##########`);
        const url =
            `${WEB}/web/review/list?bookId=${encodeURIComponent(t.bookId)}&listType=4&maxIdx=0&count=0&listMode=2&syncKey=0`;
        const res = await get(url, cred);
        console.log("  http:", res.status);
        let j;
        try {
            j = JSON.parse(res.body);
        } catch {
            console.log("  not json:", res.body.slice(0, 200));
            continue;
        }
        console.log("  top keys:", Object.keys(j).join(", "), "| totalCount:", j.totalCount);
        const list = j.reviews ?? [];
        console.log("  reviews length:", list.length);
        list.forEach((item, i) => {
            const r = item?.review ?? item;
            console.log(
                `   #${i} type=${r.type} chapter=${r.chapterName || r.chapterTitle} | abstract="${String(
                    r.abstract ?? ""
                ).slice(0, 60)}" | content="${String(r.content ?? "").slice(0, 60)}"`
            );
        });
        // 顺带确认划线接口
        const bm = await get(`${WEB}/web/book/bookmarklist?bookId=${encodeURIComponent(t.bookId)}`, cred);
        console.log("  bookmarklist:", bm.status, bm.body.slice(0, 120));
    }
    console.log("\nEVENT:REVIEW_TYPE_DONE");
}

main().catch((e) => console.log("FATAL", e));
