/**
 * 扫码登录测试：内置一个本地 HTTP 服务，实时展示二维码并自动换码。
 *
 * 用法：node scripts/login_server.mjs
 * 然后浏览器打开 http://127.0.0.1:8765
 *
 * 与插件内 AuthService 行为一致：二维码约 55 秒作废，作废后自动重新获取 uid。
 * 登录成功后会自动用凭证调用数据接口验证，并把脱敏结果写入 qr-result.json。
 */
import fs from "node:fs";
import http from "node:http";
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

const PORT = Number(process.env.WR_PORT || 8765);
const POLL_TIMEOUT = 65000;
const TOTAL_TIMEOUT = 10 * 60 * 1000;
const PNG_PATH = path.join(__dirname, "qr-test.png");
const RESULT_PATH = path.join(ROOT, "qr-result.json");

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

function encodePNG(w, h, rgba) {
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
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

function renderQR(content, cell = 10, margin = 4) {
    const qr = qrcode(0, "M");
    qr.addData(content);
    qr.make();
    const n = qr.getModuleCount();
    const size = (n + margin * 2) * cell;
    const rgba = new Uint8Array(size * size * 4);
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

// ---------------------------------------------------------------- 状态

const state = {
    stage: "starting",
    uid: "",
    issuedAt: 0,
    round: 0,
    log: [],
    result: null,
};

function log(line) {
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    state.log.push(`[${stamp}] ${line}`);
    if (state.log.length > 200) state.log.shift();
    console.log(`[${stamp}] ${line}`);
}

function writeResult(obj) {
    state.result = obj;
    try {
        fs.writeFileSync(RESULT_PATH, JSON.stringify(obj, null, 2), "utf8");
    } catch {
        /* 忽略 */
    }
}

function issueQR(uid) {
    const content = `${WEB}/web/confirm?uid=${encodeURIComponent(uid)}`;
    const { size, rgba } = renderQR(content);
    fs.writeFileSync(PNG_PATH, encodePNG(size, size, rgba));
    state.uid = uid;
    state.issuedAt = Date.now();
    state.stage = "waiting";
    writeResult({ stage: "waiting-scan", uid, qrContent: content, at: new Date().toISOString() });
}

function mask(s) {
    if (!s) return "";
    return String(s).slice(0, 6) + "…(len=" + String(s).length + ")";
}

// 把 Set-Cookie 头解析成 cookie jar（key -> value）
function parseSetCookies(headers) {
    const jar = {};
    const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const c of list) {
        const idx = c.indexOf("=");
        if (idx < 0) continue;
        const k = c.slice(0, idx).trim();
        const v = c.slice(idx + 1).split(";")[0].trim();
        if (k.startsWith("wr_")) jar[k] = v;
    }
    return jar;
}

function cookieFromJar(jar) {
    return Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

// 用真实 cookie 实测每个数据接口，返回 [{name,url,http,ok,note}]
async function testEndpoints(cookie) {
    const cases = [
        { name: "shelf/sync(web)", url: `${WEB}/web/shelf/sync`, method: "GET" },
        { name: "user/notebook(web)", url: `${WEB}/api/user/notebook`, method: "GET" },
        { name: "shelf/sync(i域-对照)", url: `https://i.weread.qq.com/shelf/sync?userVid=&synckey=0`, method: "GET" },
    ];
    const out = [];
    for (const c of cases) {
        try {
            const r = await fetch(c.url, {
                method: c.method,
                headers: { Cookie: cookie, "User-Agent": UA, Referer: `${WEB}/web/shelf` },
            });
            const t = await r.text();
            let ok = false;
            let note = "";
            try {
                const j = JSON.parse(t);
                const n = Array.isArray(j?.books)
                    ? j.books.length
                    : j?.errCode
                    ? `errCode=${j.errCode}`
                    : Object.keys(j).length;
                ok = r.status === 200 && (!j?.errCode || j.errCode === 0);
                note = `字段数=${n}`;
            } catch {
                note = "非JSON, 长度=" + t.length;
                ok = r.status === 200 && t.length > 0;
            }
            out.push({ name: c.name, http: r.status, ok, note });
            log(`  实测 ${c.name}: HTTP ${r.status} ${note}`);
        } catch (e) {
            out.push({ name: c.name, http: -1, ok: false, note: String(e?.message || e) });
            log(`  实测 ${c.name}: 异常 ${String(e?.message || e)}`);
        }
    }
    return out;
}

// ---------------------------------------------------------------- 登录流程

async function getUid() {
    const r = await fetch(`${WEB}/api/auth/getLoginUid`, { headers: { "User-Agent": UA } });
    const j = await r.json();
    if (!j?.uid) throw new Error("getLoginUid 未返回 uid: " + JSON.stringify(j));
    return String(j.uid);
}

async function runLogin() {
    log("获取 uid …");
    let uid = await getUid();
    issueQR(uid);
    log(`二维码已生成，请用微信扫描 http://127.0.0.1:${PORT}`);

    const deadline = Date.now() + TOTAL_TIMEOUT;
    while (Date.now() < deadline) {
        state.round++;
        const round = state.round;
        let outcome = null;
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), POLL_TIMEOUT);
            const resp = await fetch(
                `${WEB}/api/auth/getLoginInfo?uid=${encodeURIComponent(uid)}&otp=`,
                { headers: { "User-Agent": UA, Referer: `${WEB}/` }, signal: ctrl.signal }
            );
            clearTimeout(timer);
            const text = await resp.text();
            let j = null;
            try {
                j = JSON.parse(text);
            } catch {
                j = null;
            }
            log(`轮次 ${round}: HTTP ${resp.status} ${text.slice(0, 120)}`);
            if (j?.succeed && j?.accessToken && j?.webLoginVid) outcome = { done: true, j };
            else if (j?.logicCode === "LOGIN_TIMEOUT") outcome = { expired: true };
            else if (j?.logicCode === "NEED_OTP") outcome = { otp: true };
        } catch {
            log(`轮次 ${round}: 超时/网络中断，继续等待`);
        }

        if (outcome?.done) {
            state.stage = "verifying";
            const { accessToken, webLoginVid } = outcome.j;
            log(`登录成功 vid=${mask(webLoginVid)} skey=${mask(accessToken)}`);

            // 合并响应体凭证 + Set-Cookie（与插件内 pollLogin 行为一致）
            const jar = { wr_vid: String(webLoginVid), wr_skey: String(accessToken) };
            try {
                const setCookies = parseSetCookies(resp.headers);
                Object.assign(jar, setCookies);
            } catch {
                /* 忽略 */
            }
            const cookie = cookieFromJar(jar);
            log(`完整 cookie 字段: ${Object.keys(jar).join(", ")}`);

            // 用真实 cookie 实测新 web 接口（验证 v1.0.4 修复）
            log("开始实测数据接口 …");
            const tests = await testEndpoints(cookie);

            let userInfo = null;
            try {
                const ur = await fetch(`${WEB}/api/userInfo?userVid=${encodeURIComponent(webLoginVid)}`, {
                    headers: { Cookie: cookie, "User-Agent": UA },
                });
                const ut = await ur.text();
                userInfo = { status: ur.status, head: ut.slice(0, 160) };
                log(`userInfo: HTTP ${ur.status} ${ut.slice(0, 120)}`);
            } catch (e) {
                userInfo = { status: -1, head: String(e?.message || e) };
            }

            const ok = tests.filter((t) => t.ok).length;
            state.stage = ok > 0 ? "success" : "verify-failed";
            writeResult({
                stage: state.stage,
                uid,
                webLoginVidMasked: mask(webLoginVid),
                accessTokenMasked: mask(accessToken),
                cookieFields: Object.keys(jar),
                tests,
                userInfo,
                at: new Date().toISOString(),
            });
            log(`完成：实测通过 ${ok}/${tests.length} 个接口，结果已写入 qr-result.json`);
            return;
        }

        if (outcome?.otp) {
            state.stage = "need-otp";
            writeResult({ stage: "need-otp", uid, at: new Date().toISOString() });
            log("服务端要求验证码（NEED_OTP），本脚本不支持交互输入，请改用插件界面");
            return;
        }

        if (outcome?.expired) {
            log("二维码已过期，自动换新 …");
            uid = await getUid();
            issueQR(uid);
        }
    }

    state.stage = "timeout";
    writeResult({ stage: "timeout", uid, at: new Date().toISOString() });
    log("结束：超过总时长未检测到扫码");
}

// ---------------------------------------------------------------- HTTP 服务

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>微信读书扫码登录测试</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:16px;padding:28px 16px;box-sizing:border-box;background:#1b1b1b;
color:#e8e8e8;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
h1{font-size:16px;font-weight:500;margin:0}
.qr{width:320px;height:320px;background:#fff;border-radius:12px;padding:10px;box-sizing:border-box;
display:flex;align-items:center;justify-content:center}
.qr img{width:100%;height:100%;image-rendering:pixelated}
.note{font-size:13px;line-height:1.7;color:#a5a5a5;max-width:440px;text-align:center}
.note b{color:#e8e8e8;font-weight:500}
.ok{color:#6fb98f}.warn{color:#d8964a}.err{color:#d9705f}
pre{font-size:11px;color:#8a8a8a;max-width:520px;max-height:150px;overflow:auto;
background:#242424;padding:10px;border-radius:8px;margin:0;text-align:left;width:100%;box-sizing:border-box}
</style></head><body>
<h1>微信读书扫码登录测试</h1>
<div class="qr"><img id="img" alt="登录二维码"></div>
<div class="note" id="note">正在生成二维码…</div>
<pre id="log"></pre>
<script>
const img=document.getElementById("img"),note=document.getElementById("note"),logEl=document.getElementById("log");
let cur="";
async function tick(){
  try{
    const r=await fetch("/qr.png?t="+Date.now());
    if(r.ok){
      const b=await r.blob();
      const u=URL.createObjectURL(b);
      img.src=u;
      if(cur)URL.revokeObjectURL(cur);
      cur=u;
    }
  }catch(e){}
  try{
    const s=await(await fetch("/status?t="+Date.now())).json();
    const left=Math.max(0,55-Math.floor((Date.now()-(s.issuedAt||0))/1000));
    if(s.stage==="success"){
      note.innerHTML='<span class="ok">登录成功</span> · 数据接口 HTTP '+s.result?.dataApiStatus+
        ' · 有笔记的书 '+s.result?.notebookCount+'<br>结果已写入项目根目录 qr-result.json';
    }else if(s.stage==="need-otp"){
      note.innerHTML='<span class="warn">服务端要求验证码</span>，请在插件界面完成';
    }else if(s.stage==="timeout"){
      note.innerHTML='<span class="err">已超时</span>，重新运行本脚本可再来一次';
    }else if(s.stage==="verifying"){
      note.innerHTML='<span class="ok">已扫码</span>，正在校验凭证…';
    }else{
      note.innerHTML='请用<b>微信</b>扫描上方二维码<br>二维码寿命约 <b>55 秒</b>，本页会自动换新，无需刷新<br>剩余约 '+left+' 秒';
    }
    logEl.textContent=(s.log||[]).slice(-8).join("\\n");
  }catch(e){}
}
tick();setInterval(tick,1500);
</script></body></html>`;

const server = http.createServer((req, res) => {
    const url = (req.url || "").split("?")[0];
    if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(PAGE);
        return;
    }
    if (url === "/qr.png") {
        try {
            const buf = fs.readFileSync(PNG_PATH);
            res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
            res.end(buf);
        } catch {
            res.writeHead(404).end();
        }
        return;
    }
    if (url === "/status") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(
            JSON.stringify({
                stage: state.stage,
                issuedAt: state.issuedAt,
                uid: state.uid,
                result: state.result,
                log: state.log.slice(-8),
            })
        );
        return;
    }
    res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`\n扫码页面: http://127.0.0.1:${PORT}\n`);
    runLogin().catch((e) => {
        state.stage = "error";
        log("异常: " + String(e?.message || e));
        writeResult({ stage: "error", message: String(e?.message || e), at: new Date().toISOString() });
    });
});
