/**
 * 登录链路端到端测试（不依赖思源，直接走网络）
 *
 * 流程：获取 uid -> 生成二维码 PNG -> 长轮询等待扫码 -> 用凭证调用数据接口验证
 *
 * 重要：二维码实测寿命约 55 秒，过期后服务端返回 LOGIN_TIMEOUT 且 canRetry=false，
 * 该 uid 即作废。因此这里在过期后**自动重新获取 uid 并覆盖 scripts/qr-test.png**，
 * 与插件内 AuthService 的行为保持一致，用户有充足时间扫码。
 *
 * 用法：node scripts/qr_test.mjs
 * 输出：scripts/qr-test.png（二维码，会自动刷新）、qr-result.json（测试结果）
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-generator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const WEB = "https://weread.qq.com";
const API = "https://i.weread.qq.com";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const POLL_TIMEOUT = 65000;
const TOTAL_TIMEOUT = 5 * 60 * 1000;
// ---------------------------------------------------------------- PNG 编码

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writePNG(file, w, h, rgba) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    let p = 0;
    for (let y = 0; y < h; y++) {
        raw[p++] = 0;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            raw[p++] = rgba[i];
            raw[p++] = rgba[i + 1];
            raw[p++] = rgba[i + 2];
            raw[p++] = rgba[i + 3];
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
    fs.writeFileSync(file, png);
}

/** 用 qrcode-generator 的模块矩阵画二维码 */
function renderQR(content, cell = 8, margin = 4) {
    const qr = qrcode(0, "M");
    qr.addData(content);
    qr.make();
    const n = qr.getModuleCount();
    const size = (n + margin * 2) * cell;
    const rgba = new Uint8Array(size * size * 4);
    // 白底
    for (let i = 0; i < size * size; i++) {
        rgba[i * 4] = 255;
        rgba[i * 4 + 1] = 255;
        rgba[i * 4 + 2] = 255;
        rgba[i * 4 + 3] = 255;
    }
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (!qr.isDark(r, c)) continue;
            const x0 = (c + margin) * cell;
            const y0 = (r + margin) * cell;
            for (let y = y0; y < y0 + cell; y++) {
                for (let x = x0; x < x0 + cell; x++) {
                    const i = (y * size + x) * 4;
                    rgba[i] = 0;
                    rgba[i + 1] = 0;
                    rgba[i + 2] = 0;
                }
            }
        }
    }
    return { size, rgba };
}

// ---------------------------------------------------------------- 主流程

function writeResult(obj) {
    fs.writeFileSync(path.join(ROOT, "qr-result.json"), JSON.stringify(obj, null, 2), "utf8");
}

function mask(s) {
    if (!s) return "";
    return String(s).slice(0, 6) + "…(len=" + String(s).length + ")";
}

async function getUid() {
    const r = await fetch(`${WEB}/api/auth/getLoginUid`, { headers: { "User-Agent": UA } });
    const j = await r.json();
    if (!j?.uid) throw new Error("getLoginUid 未返回 uid: " + JSON.stringify(j));
    return String(j.uid);
}

async function main() {
    writeResult({ stage: "start", at: new Date().toISOString() });
    console.log("[1/4] 获取 uid …");

    let uid = await getUid();
    let content = `${WEB}/web/confirm?uid=${encodeURIComponent(uid)}`;

    console.log("[2/4] 生成二维码 …");
    const { size, rgba } = renderQR(content);
    writePNG(path.join(__dirname, "qr-test.png"), size, size, rgba);
    console.log("      qr-test.png", size + "x" + size);
    console.log("      二维码内容:", content);

    writeResult({ stage: "waiting-scan", uid, qrContent: content, at: new Date().toISOString() });
    console.log("[3/4] 开始长轮询，等待扫码（最长 5 分钟，二维码每 55 秒自动换新）…");
    console.log("      请用微信扫描（打开 scripts/qr_view.html 查看，会自动刷新）");

    const deadline = Date.now() + TOTAL_TIMEOUT;
    let round = 0;
    while (Date.now() < deadline) {
        round++;
        let outcome;
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), POLL_TIMEOUT);
            const resp = await fetch(`${WEB}/api/auth/getLoginInfo?uid=${encodeURIComponent(uid)}&otp=`, {
                headers: { "User-Agent": UA, Referer: `${WEB}/` },
                signal: ctrl.signal,
            });
            clearTimeout(timer);
            const text = await resp.text();
            let j = null;
            try {
                j = JSON.parse(text);
            } catch {
                j = null;
            }
            console.log(`      轮次 ${round}: HTTP ${resp.status} ${text.slice(0, 160)}`);

            if (j?.succeed && j?.accessToken && j?.webLoginVid) {
                outcome = { done: true, j };
            } else if (j?.logicCode === "LOGIN_TIMEOUT") {
                outcome = { expired: true };
            } else if (j?.logicCode === "NEED_OTP") {
                outcome = { otp: true };
            }
        } catch (e) {
            // 长轮询超时属于正常现象
            console.log(`      轮次 ${round}: 超时/网络中断，继续等待`);
        }

        if (outcome?.done) {
            const { accessToken, webLoginVid } = outcome.j;
            console.log("[4/4] 登录成功，验证凭证 …");
            console.log("      webLoginVid =", mask(webLoginVid));
            console.log("      accessToken =", mask(accessToken));

            const cookie = `wr_vid=${webLoginVid}; wr_skey=${accessToken}`;
            const vr = await fetch(`${API}/user/notebooks`, {
                headers: { Cookie: cookie, "User-Agent": UA },
            });
            let noteCount = -1;
            let verifyBody = "";
            try {
                verifyBody = (await vr.text()).slice(0, 200);
                const vj = JSON.parse(verifyBody);
                noteCount = Array.isArray(vj?.books) ? vj.books.length : -1;
            } catch {
                /* 保持 -1 */
            }
            console.log("      数据接口 HTTP", vr.status, "有笔记的书:", noteCount);

            // 顺带验证官方前端登录后调用的 /api/userInfo
            let userInfo = null;
            try {
                const ur = await fetch(`${WEB}/api/userInfo?userVid=${encodeURIComponent(webLoginVid)}`, {
                    headers: { Cookie: cookie, "User-Agent": UA },
                });
                const ut = await ur.text();
                userInfo = { status: ur.status, head: ut.slice(0, 160) };
                console.log("      userInfo HTTP", ur.status, ut.slice(0, 120));
            } catch (e) {
                userInfo = { status: -1, head: String(e?.message || e) };
            }

            writeResult({
                stage: "success",
                uid,
                webLoginVidMasked: mask(webLoginVid),
                accessTokenMasked: mask(accessToken),
                dataApiStatus: vr.status,
                notebookCount: noteCount,
                dataApiBodyHead: verifyBody.slice(0, 160),
                userInfo,
                at: new Date().toISOString(),
            });
            console.log("DONE: success");
            return;
        }

        if (outcome?.otp) {
            console.log("      >>> 服务端要求验证码（NEED_OTP），本脚本不支持交互输入，请改用插件界面");
            writeResult({ stage: "need-otp", uid, at: new Date().toISOString() });
            console.log("DONE: need-otp");
            return;
        }

        if (outcome?.expired) {
            // 自动换码：重新获取 uid 并覆盖二维码文件
            console.log("      二维码已过期，自动换新 …");
            uid = await getUid();
            content = `${WEB}/web/confirm?uid=${encodeURIComponent(uid)}`;
            const next = renderQR(content);
            writePNG(path.join(__dirname, "qr-test.png"), next.size, next.size, next.rgba);
            console.log("      新二维码已写入 qr-test.png");
            writeResult({ stage: "waiting-scan", uid, qrContent: content, refreshed: true, at: new Date().toISOString() });
            continue;
        }

        await new Promise((r) => setTimeout(r, 1000));
    }

    writeResult({ stage: "timeout", uid, at: new Date().toISOString() });
    console.log("DONE: timeout (未检测到扫码)");
}

main().catch((e) => {
    writeResult({ stage: "error", message: e?.message || String(e), at: new Date().toISOString() });
    console.error("FAILED:", e?.message || e);
    process.exit(1);
});
