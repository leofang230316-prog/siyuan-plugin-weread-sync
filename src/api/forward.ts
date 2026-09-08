import { fetchSyncPost } from "siyuan";
import { logger } from "@/core/logger";

/**
 * 网络层：所有对外部域名的请求必须且只能经由本模块转发。
 *
 * 思源内核提供 POST /api/network/forwardProxy，请求由 Go 后端发出，
 * 因此不受浏览器同源策略限制，且可完整读取响应头（含 Set-Cookie）。
 *
 * 红线：禁止在插件其它位置直接 fetch 外部域名。
 */

export interface ForwardResult {
    code: number;
    msg: string;
    data?: {
        url: string;
        status: number;
        contentType: string;
        body: string;
        bodyEncoding: string;
        headers: Record<string, string[]>;
        elapsed: number;
    };
}

export interface ForwardOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    payload?: any;
    payloadEncoding?: string;
    responseEncoding?: string;
    /** 毫秒 */
    timeout?: number;
    redirect?: boolean;
}

const DEFAULT_TIMEOUT = 15000;

export class ForwardError extends Error {
    code: number;

    constructor(code: number, msg: string) {
        super(`[forwardProxy ${code}] ${msg}`);
        this.code = code;
        this.name = "ForwardError";
    }
}

/** 登录凭证过期 / 鉴权失败（微信读书 errCode -2012/-2013 或 HTTP 401）。 */
export class AuthExpiredError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "AuthExpiredError";
    }
}

export async function forward(opts: ForwardOptions): Promise<ForwardResult> {
    const body: Record<string, any> = {
        url: opts.url,
        method: (opts.method || "GET").toUpperCase(),
        timeout: opts.timeout ?? DEFAULT_TIMEOUT,
    };

    if (opts.headers) {
        // 内核要求 headers 为 [{key: value}, ...] 形式
        body.headers = Object.entries(opts.headers).map(([k, v]) => ({ [k]: v }));
    }
    if (opts.payload !== undefined) body.payload = opts.payload;
    if (opts.payloadEncoding) body.payloadEncoding = opts.payloadEncoding;
    if (opts.responseEncoding) body.responseEncoding = opts.responseEncoding;
    if (opts.redirect === false) body.redirect = false;

    // 记录请求（不记录 headers，其中含登录凭证）
    const t0 = Date.now();
    const tag = `${body.method} ${opts.url.split("?")[0]}`;
    logger.debug(`⇢ forwardProxy ${tag}`);
    let resp: ForwardResult;
    try {
        resp = (await fetchSyncPost("/api/network/forwardProxy", body)) as ForwardResult;
    } catch (e: any) {
        logger.error(`⇠ forwardProxy ${tag} THREW (${Date.now() - t0}ms) ${e?.message || String(e)}`);
        throw e;
    }
    logger.debug(
        `⇠ forwardProxy ${tag} -> code=${resp?.code} status=${resp?.data?.status ?? "-"} ` +
            `bytes=${resp?.data?.body?.length ?? 0} (${Date.now() - t0}ms)`
    );
    return resp;
}

export interface ForwardSuccess {
    body: string;
    status: number;
    headers: Record<string, string[]>;
}

/** 校验转发结果，失败时抛出 ForwardError */
export function assertOk(resp: ForwardResult, context: string): ForwardSuccess {
    if (resp.code !== 0) {
        throw new ForwardError(resp.code, `${context}: ${resp.msg || "kernel rejected"}`);
    }
    if (!resp.data) {
        throw new ForwardError(-1, `${context}: empty response`);
    }
    if (resp.data.status >= 400) {
        if (resp.data.status === 401) {
            throw new AuthExpiredError(`${context}: 微信读书登录已过期，请重新扫码登录 (HTTP 401)`);
        }
        throw new ForwardError(resp.data.status, `${context}: HTTP ${resp.data.status}`);
    }
    return {
        body: resp.data.body,
        status: resp.data.status,
        headers: resp.data.headers || {},
    };
}

/** 从响应头中解析 Set-Cookie */
export function parseSetCookies(headers: Record<string, string[]>): Record<string, string> {
    const cookies: Record<string, string> = {};
    const rawList = headers["Set-Cookie"] || headers["set-cookie"] || [];
    for (const item of rawList) {
        const pair = (item || "").split(";")[0];
        const idx = pair.indexOf("=");
        if (idx > 0) {
            cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
        }
    }
    return cookies;
}

/** 读取响应头（忽略大小写） */
export function getHeader(headers: Record<string, string[]>, name: string): string[] {
    if (headers[name]) return headers[name];
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) return headers[key];
    }
    return [];
}
