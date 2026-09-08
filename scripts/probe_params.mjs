// 1) 对 718151（notebook 显示 rv=2 但查询为 0）穷举 review/list 参数组合
// 2) 从书籍详情/阅读器页面 JS 挖 bookmark 真实端点
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

async function main() {
    const cred = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
    const bookId = "718151";
    console.log(`===== review/list 参数穷举 (bookId=${bookId}, notebook rv=2) =====`);
    const combos = [];
    for (const listType of [0, 1, 2, 3, 4, 5, 6]) {
        combos.push({ listType, listMode: 2, count: 0, maxIdx: 0 });
    }
    for (const listMode of [0, 1, 2]) {
        combos.push({ listType: 4, listMode, count: 0, maxIdx: 0 });
    }
    combos.push({ listType: 4, listMode: 2, count: 10, maxIdx: 0 });
    combos.push({ listType: 4, listMode: 2, count: 100, maxIdx: 0 });
    combos.push({ listType: 4, listMode: 0, count: 10, maxIdx: 0 });

    for (const c of combos) {
        const url =
            `${WEB}/web/review/list?bookId=${bookId}&listType=${c.listType}&maxIdx=${c.maxIdx}` +
            `&count=${c.count}&listMode=${c.listMode}&syncKey=0`;
        const res = await get(url, cred);
        let info = res.body.slice(0, 100);
        try {
            const j = JSON.parse(res.body);
            info = `totalCount=${j.totalCount} reviews=${(j.reviews ?? []).length} hasMore=${j.hasMore}`;
            if ((j.reviews ?? []).length) {
                const r = j.reviews[0].review ?? j.reviews[0];
                info += ` | first: type=${r.type} "${String(r.abstract ?? "").slice(0, 30)}" / "${String(
                    r.content ?? ""
                ).slice(0, 30)}"`;
            }
        } catch {}
        console.log(`  listType=${c.listType} listMode=${c.listMode} count=${c.count} -> ${info}`);
    }

    console.log(`\n===== 划线接口：书籍详情/阅读器页面 JS 扫描 =====`);
    const pages = [
        "https://weread.qq.com/book-detail?type=1&v=e6d327e0813abb97dg0177e7",
        "https://weread.qq.com/web/reader/718151",
        "https://weread.qq.com/web/reader/43830871",
        "https://weread.qq.com/web/shelf",
    ];
    for (const page of pages) {
        let html = "";
        try {
            const r = await fetch(page, {
                headers: { "User-Agent": UA, Cookie: cookieHeader(cred), Accept: "text/html,*/*" },
            });
            html = await r.text();
            console.log(`\n  [${r.status}] ${page} (${html.length})`);
        } catch (e) {
            console.log("  ERR", page, e.message);
            continue;
        }
        const srcs = [...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+\.js[^"']*)["']/gi)].map((m) => m[1]);
        const abs = [...new Set(srcs)].map((s) => (s.startsWith("http") ? s : WEB + (s.startsWith("/") ? s : "/" + s)));
        for (const url of abs) {
            let js = "";
            try {
                const r = await fetch(url, { headers: { "User-Agent": UA } });
                if (!r.ok) continue;
                js = await r.text();
            } catch {
                continue;
            }
            const hits = [
                ...new Set([...js.matchAll(/.{150}bookmark.{150}/gi)].map((m) => m[0].replace(/\s+/g, " "))),
            ];
            if (hits.length) {
                console.log(`    >>> ${url}`);
                for (const x of hits.slice(0, 5)) console.log("       ..." + x + "...");
            }
        }
    }
    console.log("\nEVENT:PARAMS_DONE");
}

main().catch((e) => console.log("FATAL", e));
