// 从微信读书前端 JS 中挖出划线(bookmark)相关的真实接口路径。
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

async function main() {
    const cred = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
    const headers = {
        "User-Agent": UA,
        Cookie: cookieHeader(cred),
        Accept: "text/html,application/xhtml+xml,*/*",
    };

    console.log("=== 拉取首页 HTML ===");
    const html = await (await fetch(WEB + "/", { headers })).text();
    console.log("html length:", html.length);

    const srcs = [...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+\.js[^"']*)["']/gi)].map((m) => m[1]);
    const unique = [...new Set(srcs)];
    console.log("script srcs found:", unique.length);
    const abs = unique.map((s) => (s.startsWith("http") ? s : WEB + (s.startsWith("/") ? s : "/" + s)));
    for (const u of abs) console.log("  ", u);

    console.log("\n=== 下载 JS 并搜索 bookmark / markText ===");
    for (const url of abs.slice(0, 12)) {
        let js = "";
        try {
            const r = await fetch(url, { headers: { "User-Agent": UA } });
            if (!r.ok) {
                console.log(`  [${r.status}] ${url}`);
                continue;
            }
            js = await r.text();
        } catch (e) {
            console.log("  ERR", url, e.message);
            continue;
        }
        const hits = [...js.matchAll(/.{140}bookmark.{140}/gi)].map((m) => m[0]);
        const hits2 = [...js.matchAll(/.{100}markText.{120}/gi)].map((m) => m[0]);
        if (hits.length || hits2.length) {
            console.log(`\n--- ${url} (${js.length} chars) ---`);
            for (const h of [...new Set(hits)].slice(0, 8)) console.log("  [bookmark] ..." + h.replace(/\s+/g, " ") + "...");
            for (const h of [...new Set(hits2)].slice(0, 5)) console.log("  [markText] ..." + h.replace(/\s+/g, " ") + "...");
        } else {
            console.log(`  (no bookmark hit) ${url} (${js.length} chars)`);
        }
    }
    console.log("\nEVENT:JS_SCAN_DONE");
}

main().catch((e) => console.log("FATAL", e));
