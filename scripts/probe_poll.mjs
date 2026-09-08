// 探针：测量 getLoginInfo 各阶段的耗时与返回内容，判断 LOGIN_TIMEOUT 的真实语义
const WEB = "https://weread.qq.com";

async function getJson(url, headers = {}) {
    const t0 = Date.now();
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers } });
    const text = await resp.text();
    return { ms: Date.now() - t0, status: resp.status, text };
}

async function main() {
    // 1. 拿 uid
    const u = await getJson(`${WEB}/api/auth/getLoginUid`);
    console.log(`getLoginUid  ${u.status}  ${u.ms}ms  ${u.text}`);
    const uid = JSON.parse(u.text).uid;
    console.log(`uid = ${uid}\n`);

    // 2. 立刻轮询（带 70s 超时），看是立刻返回还是挂起
    for (let round = 1; round <= 2; round++) {
        const t0 = Date.now();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 70000);
        let out;
        try {
            const resp = await fetch(`${WEB}/api/auth/getLoginInfo?uid=${uid}&otp=`, {
                headers: { "User-Agent": "Mozilla/5.0" },
                signal: ctrl.signal,
            });
            out = `${resp.status}  ${await resp.text()}`;
        } catch (e) {
            out = `ABORTED/ERR ${e.name}`;
        } finally {
            clearTimeout(timer);
        }
        console.log(`轮次 ${round}: 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
    }

    // 3. 不带 otp 参数试试
    const t0 = Date.now();
    const r3 = await fetch(`${WEB}/api/auth/getLoginInfo?uid=${uid}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
    });
    console.log(`\n无 otp 参数: ${r3.status} ${Date.now() - t0}ms ${await r3.text()}`);
}

main();
