// 从笔记/书籍详情等页面的前端 JS 中挖出划线(bookmark)真实接口。
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

const PAGES = [
    "https://weread.qq.com/web/notes",
    "https://weread.qq.com/web/book/note?bookId=43830871",
    "https://weread.qq.com/web/notebook",
    "https://weread.qq.com/web/bookDetail?bookId=43830871",
    "https://weread.qq.com/web/reader?bookId=43830871",
];

async function main() {
    const cred = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
    const headers = { "User-Agent": UA, Cookie: cookieHeader(cred), Accept: "text/html,*/*" };
    const seen = new Set();

    for (const page of PAGES) {
        console.log(`\n########## ${page} ##########`);
        let html = "";
        try {
            const r = await fetch(page, { headers });
            html = await r.text();
            console.log("  status:", r.status, "len:", html.length);
        } catch (e) {
            console.log("  ERR", e.message);
            continue;
        }
        const srcs = [...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+\.js[^"']*)["']/gi)].map((m) => m[1]);
        const abs = [...new Set(srcs)].map((s) => (s.startsWith("http") ? s : WEB + (s.startsWith("/") ? s : "/" + s)));
        console.log("  js count:", abs.length);

        for (const url of abs) {
            if (seen.has(url)) continue;
            seen.add(url);
            let js = "";
            try {
                const r = await fetch(url, { headers: { "User-Agent": UA } });
                if (!r.ok) continue;
                js = await r.text();
            } catch {
                continue;
            }
            const hits = [
                ...new Set([...js.matchAll(/.{160}bookmark.{160}/gi)].map((m) => m[0].replace(/\s+/g, " "))),
            ];
            const marks = [
                ...new Set([...js.matchAll(/.{120}markText.{140}/gi)].map((m) => m[0].replace(/\s+/g, " "))),
            ];
            const lists = [
                ...new Set([...js.matchAll(/.{100}(bookmarklist|bookmarkList|getBookmark).{160}/gi)].map((m) =>
                    m[0].replace(/\s+/g, " ")
                )),
            ];
            if (hits.length || marks.length) {
                console.log(`\n  >>> ${url} (${js.length})`);
                for (const h of lists.slice(0, 6)) console.log("    [API] ..." + h + "...");
                for (const h of hits.slice(0, 6)) console.log("    [bookmark] ..." + h + "...");
                for (const h of marks.slice(0, 4)) console.log("    [markText] ..." + h + "...");
            }
        }
    }
    console.log("\nEVENT:SCAN2_DONE");
}

main().catch((e) => console.log("FATAL", e));
