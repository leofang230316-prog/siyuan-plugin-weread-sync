// 自动登录微信读书并抓取真实接口数据，用于验证插件解析字段。
// 用法：node scripts/weread_auto.mjs            （完整流程：取uid→生成二维码→轮询→写凭证→抓数据）
//       node scripts/weread_auto.mjs --otp XXX  （扫码后需验证码时带上）
// 输出标记行：EVENT:QR / EVENT:STATUS / EVENT:SUCCESS / EVENT:OTP / EVENT:FETCH_DONE / EVENT:ERROR
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
let qrcode;
try {
    qrcode = require("qrcode");
} catch (e) {
    console.log("EVENT:ERROR msg=qrcode-not-installed");
    process.exit(1);
}

const WEB = "https://weread.qq.com";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const PROJ = "D:/app/微信读书插件";
const PNG = path.join(PROJ, "login_qr.png");
const UID_FILE = path.join(PROJ, "login_uid.txt");
const CRED_FILE = "D:/siyuan-data/data/storage/petal/siyuan-plugin-weread-sync/credential.json";
const RESULT_FILE = path.join(PROJ, "fetch_result.json");

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getLoginUid() {
    const r = await fetch(WEB + "/api/auth/getLoginUid", { headers: h() });
    const j = await r.json();
    if (!j?.uid) throw new Error("no uid in " + JSON.stringify(j));
    return String(j.uid);
}
const buildQR = (uid) => WEB + "/web/confirm?uid=" + encodeURIComponent(uid);

async function pollLogin(uid, otp) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 65000);
    try {
        const r = await fetch(
            WEB + `/api/auth/getLoginInfo?uid=${encodeURIComponent(uid)}&otp=${encodeURIComponent(otp || "")}`,
            { headers: h(), signal: ac.signal }
        );
        const txt = await r.text();
        try {
            return JSON.parse(txt);
        } catch {
            return null;
        }
    } catch {
        return null; // 长轮询超时/网络抖动
    } finally {
        clearTimeout(t);
    }
}

async function fetchGet(url, cred) {
    const r = await fetch(url, { headers: h({ Cookie: cookieHeader(cred) }) });
    return { status: r.status, body: await r.text() };
}
async function fetchPost(url, cred, payload) {
    const r = await fetch(url, {
        method: "POST",
        headers: h({ Cookie: cookieHeader(cred), "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
    });
    return { status: r.status, body: await r.text() };
}

async function main() {
    const argv = process.argv.slice(2);
    let otp = argv.includes("--otp") ? argv[argv.indexOf("--otp") + 1] : "";
    let uid = null;
    const deadline = Date.now() + 5 * 60 * 1000;
    let cred = null;

    while (Date.now() < deadline) {
        if (!uid) {
            try {
                uid = await getLoginUid();
            } catch (e) {
                console.log("EVENT:ERROR msg=getLoginUid-failed:" + e.message);
                await sleep(2000);
                continue;
            }
            const qr = buildQR(uid);
            await qrcode.toFile(PNG, qr);
            fs.writeFileSync(UID_FILE, uid);
            console.log("EVENT:QR path=" + PNG + " uid=" + uid);
        }
        const j = await pollLogin(uid, otp);
        if (j && j.succeed && j.accessToken && j.webLoginVid) {
            cred = { wr_vid: String(j.webLoginVid), wr_skey: String(j.accessToken) };
            break;
        }
        if (j && j.logicCode) {
            if (["LOGIN_TIMEOUT", "UID_EXPIRED", "UID_INVALID", "QRCODE_EXPIRED"].includes(j.logicCode)) {
                uid = null;
                otp = "";
                continue; // 自动换码
            }
            if (["NEED_OTP", "OTP_EXPIRED", "OTP_NOT_MATCH"].includes(j.logicCode)) {
                console.log("EVENT:OTP reason=" + j.logicCode);
                if (otp) {
                    console.log("EVENT:ERROR msg=otp-failed-restart-without-otp");
                    process.exit(2);
                } else {
                    console.log("EVENT:ERROR msg=need-otp-run-with---otp");
                    process.exit(3);
                }
            }
            // SCANNED 等 → 继续轮询同 uid
        }
        // null / waiting → 继续
    }

    if (!cred) {
        console.log("EVENT:ERROR msg=login-timeout");
        process.exit(4);
    }

    fs.writeFileSync(CRED_FILE, JSON.stringify(cred, null, 2));
    console.log("EVENT:SUCCESS vid=" + cred.wr_vid);

    const result = { cred: { wr_vid: cred.wr_vid, wr_skey: cred.wr_skey.substring(0, 6) + "..." } };
    const safe = (s) => {
        try {
            return JSON.parse(s);
        } catch {
            return { __raw__: s.slice(0, 500) };
        }
    };

    try {
        const shelf = await fetchGet(WEB + "/web/shelf/sync", cred);
        result.shelf = { status: shelf.status, json: safe(shelf.body) };
    } catch (e) {
        result.shelf = { error: e.message };
    }

    let notedIds = [];
    try {
        const nb = await fetchGet(WEB + "/api/user/notebook", cred);
        result.notebook = { status: nb.status, json: safe(nb.body) };
        const arr = result.notebook.json?.books ?? result.notebook.json?.data ?? [];
        notedIds = arr.map((x) => String(x?.bookId ?? x?.book?.bookId ?? "")).filter(Boolean);
    } catch (e) {
        result.notebook = { error: e.message };
    }

    const targetIds = notedIds.length ? notedIds.slice(0, 5) : [];
    result.books = [];
    for (const bookId of targetIds) {
        const b = { bookId };
        try {
            const info = await fetchGet(WEB + `/api/book/info?bookId=${encodeURIComponent(bookId)}`, cred);
            b.bookInfo = { status: info.status, json: safe(info.body) };
        } catch (e) {
            b.bookInfo = { error: e.message };
        }
        try {
            const prog = await fetchGet(WEB + `/web/book/getProgress?bookId=${encodeURIComponent(bookId)}`, cred);
            b.progress = { status: prog.status, json: safe(prog.body) };
        } catch (e) {
            b.progress = { error: e.message };
        }
        try {
            const ch = await fetchPost(WEB + "/web/book/chapterInfos", cred, { bookIds: [bookId] });
            b.chapters = { status: ch.status, json: safe(ch.body) };
        } catch (e) {
            b.chapters = { error: e.message };
        }
        try {
            const bm = await fetchGet(WEB + `/web/book/bookmarklist?bookId=${encodeURIComponent(bookId)}`, cred);
            b.bookmarks = { status: bm.status, json: safe(bm.body) };
        } catch (e) {
            b.bookmarks = { error: e.message };
        }
        try {
            const rv = await fetchGet(
                WEB +
                    `/web/review/list?bookId=${encodeURIComponent(bookId)}&listType=4&maxIdx=0&count=0&listMode=2&syncKey=0`,
                cred
            );
            b.reviews = { status: rv.status, json: safe(rv.body) };
        } catch (e) {
            b.reviews = { error: e.message };
        }
        result.books.push(b);
        await sleep(300);
    }

    // 下载第一本书封面（若 book/info 给出 cover URL）
    try {
        const first = result.books?.[0]?.bookInfo?.json;
        let cover = first?.cover || first?.data?.cover || "";
        if (cover && !cover.startsWith("http")) cover = WEB + cover;
        if (cover) {
            const cr = await fetch(cover, { headers: h() });
            const buf = Buffer.from(await cr.arrayBuffer());
            result.coverSample = {
                url: cover,
                contentType: cr.headers.get("content-type"),
                bytes: buf.length,
                base64Head: buf.toString("base64").slice(0, 80) + "...",
            };
        } else {
            result.coverSample = { note: "no cover field in bookInfo" };
        }
    } catch (e) {
        result.coverSample = { error: e.message };
    }

    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
    console.log("EVENT:FETCH_DONE books=" + result.books.length);
}

main().catch((e) => {
    console.log("EVENT:ERROR msg=" + (e?.message || String(e)));
    process.exit(1);
});
