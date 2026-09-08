import { forward, assertOk, parseSetCookies, ForwardError, AuthExpiredError } from "./forward";
import type { BookMeta, ChapterInfo, RemoteNote, WereadCredential } from "@/types";

/**
 * 微信读书接口。
 *
 * 注意：以下端点均为非官方接口，来自公开逆向资料整理，未做长期稳定性保证。
 * 全部接口收敛于本文件，一旦官方变更可在此单点替换。
 * 所有请求经 forwardProxy 由思源内核发出，不存在跨域限制。
 */

const WEB = "https://weread.qq.com";
/**
 * 数据接口基址。
 *
 * 2026-08-29 确认：i.weread.qq.com 端点现在要求移动端 skey，通过网页扫码拿到的
 * wr_skey 会返回 401。因此数据接口统一迁移到 web 域 weread.qq.com 下的 /web/* 与
 * /api/* 端点，这些端点接受网页登录凭证。
 */
const API = WEB;

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** 登录轮询超时：服务端长轮询实测约 55 秒返回，客户端需略大于它 */
const POLL_TIMEOUT = 65000;

/**
 * 二维码有效时长（毫秒）。
 *
 * 2026-08-29 实测：getLoginInfo 在无人扫码时挂起约 55 秒后返回
 * {"succeed":false,"logicCode":"LOGIN_TIMEOUT","canRetry":false}。
 * 该 uid 即作废，必须重新获取。与官方前端 `timeout: 6e4` 一致。
 */
export const QR_LIFETIME_MS = 55000;

export function cookieHeader(cred: WereadCredential): string {
    return Object.entries(cred || {})
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

function getHeaders(cred: WereadCredential): Record<string, string> {
    return {
        Cookie: cookieHeader(cred),
        "User-Agent": UA,
        Referer: `${WEB}/web/shelf`,
        Accept: "application/json, text/plain, */*",
    };
}

function postHeaders(cred: WereadCredential): Record<string, string> {
    return {
        ...getHeaders(cred),
        "Content-Type": "application/json",
    };
}

function parseJson(body: string, context: string): any {
    try {
        return JSON.parse(body);
    } catch {
        throw new ForwardError(-1, `${context}: response is not valid JSON`);
    }
}

/**
 * 检查 web 域接口的业务错误。
 *
 * 这些接口即使 HTTP 200，也可能返回 {errCode, errMsg} 表示失败（如未登录）。
 */
function checkWebErr(json: any, context: string): void {
    if (!json) return;
    const code =
        typeof json.errCode === "number"
            ? json.errCode
            : typeof json.errcode === "number"
            ? json.errcode
            : 0;
    const msg = json.errMsg || json.errmsg || "unknown error";
    if (code !== 0) {
        // 微信读书鉴权类错误：登录超时(-2012) / 鉴权失败(-2013)
        if (code === -2012 || code === -2013) {
            throw new AuthExpiredError(`${context}: 微信读书登录已过期，请重新扫码登录 (${msg})`);
        }
        throw new ForwardError(code, `${context}: ${msg}`);
    }
}

/** 同时解析 JSON 并检查 web 域业务错误 */
function parseWebJson(body: string, context: string): any {
    const json = parseJson(body, context);
    checkWebErr(json, context);
    return json;
}

/** 凭证是否有效（至少要有 vid 与 skey） */
export function isCredValid(cred: WereadCredential | null | undefined): boolean {
    return !!(cred && cred.wr_vid && cred.wr_skey);
}

/** 将 Set-Cookie 解析结果规范化为凭证对象 */
export function normalizeCred(cookies: Record<string, string>): WereadCredential {
    const cred: WereadCredential = {};
    for (const key of Object.keys(cookies)) {
        const lower = key.toLowerCase();
        if (lower.startsWith("wr_")) {
            let value = cookies[key];
            try {
                value = decodeURIComponent(value);
            } catch {
                /* 保持原值 */
            }
            cred[lower] = value;
        }
    }
    return cred;
}

// ---------------------------------------------------------------- 登录

/** 获取扫码登录 uid。返回形如 {"uid":"129bbd43-84d7-4e50-97d8-61dc8283c0f6"} */
export async function getLoginUid(): Promise<string> {
    const res = await forward({
        url: `${WEB}/api/auth/getLoginUid`,
        method: "GET",
        headers: { "User-Agent": UA, Referer: `${WEB}/` },
        timeout: 15000,
    });
    const { body } = assertOk(res, "getLoginUid");
    const json = parseJson(body, "getLoginUid");
    const uid = json?.uid;
    if (!uid) {
        throw new ForwardError(-1, "getLoginUid: uid not found in response");
    }
    return String(uid);
}

/** 二维码内容（供生成二维码图片） */
export function buildQRContent(uid: string): string {
    return `${WEB}/web/confirm?uid=${encodeURIComponent(uid)}`;
}

export type OtpReason = "NEED_OTP" | "OTP_EXPIRED" | "OTP_NOT_MATCH";

export type LoginPollResult =
    | { status: "waiting" }
    | { status: "scanned" }
    | { status: "otp"; reason?: OtpReason }
    | { status: "success"; cred: WereadCredential }
    | { status: "expired" };

/**
 * 轮询登录状态。
 *
 * 服务端为 60 秒长轮询：未扫码时连接会挂起，因此 forwardProxy 超时属于正常现象，
 * 应判为「继续等待」而不是失败。
 *
 * 成功后响应体形如 { succeed: true, accessToken: "...", webLoginVid: "..." }，
 * 其中 accessToken 即 skey、webLoginVid 即 vid，与 Cookie 鉴权体系一致。
 */
export async function pollLogin(uid: string, otp: string = ""): Promise<LoginPollResult> {
    const res = await forward({
        url: `${WEB}/api/auth/getLoginInfo?uid=${encodeURIComponent(uid)}&otp=${encodeURIComponent(otp)}`,
        method: "GET",
        headers: { "User-Agent": UA, Referer: `${WEB}/` },
        timeout: POLL_TIMEOUT,
    });

    // 长轮询超时或网络抖动：继续等待
    if (res.code !== 0 || !res.data || res.data.status >= 400) {
        return { status: "waiting" };
    }

    const headers = res.data.headers || {};

    // 优先取响应体中的凭证
    let json: any = null;
    try {
        json = JSON.parse(res.data.body);
    } catch {
        json = null;
    }

    if (json?.succeed && json?.accessToken && json?.webLoginVid) {
        const cred: WereadCredential = {
            wr_vid: String(json.webLoginVid),
            wr_skey: String(json.accessToken),
        };
        // 服务端若同时下发 Cookie，合并进来
        Object.assign(cred, normalizeCred(parseSetCookies(headers)));
        return { status: "success", cred };
    }

    if (json?.logicCode) {
        // 取值来自官方前端 BVQc4ULa.js 的 switch 分支，逐一对应其状态机
        switch (json.logicCode) {
            case "LOGIN_TIMEOUT":
            case "UID_EXPIRED":
            case "UID_INVALID":
            case "QRCODE_EXPIRED":
                // 官方前端：C() => p.value = "EXPIRED"，即弃用该 uid 重新获取
                return { status: "expired" };
            case "NEED_OTP":
                // 异地/新设备扫码，服务端要求补填验证码
                return { status: "otp", reason: "NEED_OTP" };
            case "OTP_EXPIRED":
                return { status: "otp", reason: "OTP_EXPIRED" };
            case "OTP_NOT_MATCH":
                return { status: "otp", reason: "OTP_NOT_MATCH" };
            case "SCANNED":
                return { status: "scanned" };
        }
    }

    // 兼容仅通过 Set-Cookie 下发凭证的情况
    const cookies = parseSetCookies(headers);
    if (cookies.wr_vid && cookies.wr_skey) {
        return { status: "success", cred: normalizeCred(cookies) };
    }

    return { status: "waiting" };
}

/** 校验凭证是否仍有效 */
export async function verifyCred(cred: WereadCredential): Promise<boolean> {
    try {
        const res = await forward({
            url: `${API}/web/shelf/sync`,
            method: "GET",
            headers: getHeaders(cred),
            timeout: 10000,
        });
        if (res.code !== 0 || !res.data || res.data.status !== 200) return false;
        const json = parseJson(res.data.body, "verifyCred");
        return typeof json?.errCode !== "number" || json.errCode === 0;
    } catch {
        return false;
    }
}

/**
 * 拉取当前登录用户的基本信息。
 *
 * 官方前端在拿到 accessToken / webLoginVid 后会立即调用
 * `GET /api/userInfo?userVid=<vid>`（web 域），返回形如 { value: { name, ... } }。
 * 仅用于展示，失败不影响登录本身。
 */
export async function getUserInfo(cred: WereadCredential): Promise<{ name?: string } | null> {
    const vid = String(cred?.wr_vid || "");
    if (!vid) return null;
    try {
        const res = await forward({
            url: `${WEB}/api/userInfo?userVid=${encodeURIComponent(vid)}`,
            method: "GET",
            headers: getHeaders(cred),
            timeout: 10000,
        });
        const { body } = assertOk(res, "userInfo");
        const json = parseJson(body, "userInfo");
        const value = json?.value ?? json?.data ?? json;
        return { name: value?.name ? String(value.name) : undefined };
    } catch {
        return null;
    }
}

/**
 * 续期凭证。
 *
 * 经核对微信读书前端源码，当前版本不存在 token 续期接口，
 * 凭证过期后只能重新扫码登录，因此这里始终返回 null。
 */
export async function refreshCred(_cred: WereadCredential): Promise<WereadCredential | null> {
    return null;
}

// ---------------------------------------------------------------- 书架

export interface ShelfResult {
    books: BookMeta[];
    userVid: string;
}

/** 从 /web/shelf 的 HTML 中解析 INITIAL_STATE 作为书架兜底 */
async function getShelfFromHTML(cred: WereadCredential): Promise<ShelfResult> {
    const userVid = String(cred.wr_vid || "");
    const res = await forward({
        url: `${WEB}/web/shelf`,
        method: "GET",
        headers: getHeaders(cred),
        timeout: 30000,
    });
    const { body } = assertOk(res, "web/shelf");
    const m = body.match(/window\.INITIAL_STATE\s*=\s*({.*?});?\s*<\/script>/s);
    if (!m) {
        throw new ForwardError(-1, "web/shelf: INITIAL_STATE not found");
    }
    const state = parseJson(m[1], "web/shelf INITIAL_STATE");
    const rawBooks: any[] = state?.shelf?.rawBooks ?? state?.rawBooks ?? [];
    const rawIndexes: any[] = state?.shelf?.rawIndexes ?? state?.rawIndexes ?? [];

    const byId = new Map<string, any>();
    for (const b of rawBooks) {
        const id = String(b?.bookId ?? b?.id ?? "");
        if (id) byId.set(id, b);
    }
    const books: BookMeta[] = rawIndexes
        .map((idx: any) => {
            const id = String(idx?.bookId ?? idx);
            const b = byId.get(id) || {};
            return {
                bookId: id,
                title: String(b.title ?? ""),
                author: String(b.author ?? ""),
                translator: b.translator || "",
                publisher: b.publisher || "",
                isbn: b.isbn || "",
                cover: b.cover || "",
                category: b.category || "",
                publishTime: b.publishTime || "",
                progress: typeof b.progress === "number" ? b.progress : undefined,
                readingTime: typeof b.readingTime === "number" ? b.readingTime : undefined,
                noteCount: typeof b.noteCount === "number" ? b.noteCount : undefined,
                readUpdateTime: typeof b.readUpdateTime === "number" ? b.readUpdateTime : undefined,
            } as BookMeta;
        })
        .filter((b: BookMeta) => !!b.bookId && !!b.title);

    return { books, userVid };
}

/** 拉取书架全量书籍 */
export async function getShelf(cred: WereadCredential): Promise<ShelfResult> {
    const userVid = String(cred.wr_vid || "");
    try {
        const res = await forward({
            url: `${API}/web/shelf/sync`,
            method: "GET",
            headers: getHeaders(cred),
            timeout: 30000,
        });
        const { body } = assertOk(res, "web/shelf/sync");
        const json = parseWebJson(body, "web/shelf/sync");

        const rawBooks: any[] = json?.books ?? json?.data?.books ?? [];
        const books: BookMeta[] = rawBooks.map((b: any) => ({
            bookId: String(b.bookId ?? b.id ?? ""),
            title: String(b.title ?? ""),
            author: String(b.author ?? ""),
            translator: b.translator || "",
            publisher: b.publisher || "",
            isbn: b.isbn || "",
            cover: b.cover || "",
            category: b.category || "",
            publishTime: b.publishTime || "",
            progress: typeof b.progress === "number" ? b.progress : undefined,
            readingTime: typeof b.readingTime === "number" ? b.readingTime : undefined,
            noteCount: typeof b.noteCount === "number" ? b.noteCount : undefined,
            readUpdateTime: typeof b.readUpdateTime === "number" ? b.readUpdateTime : undefined,
        })).filter((b: BookMeta) => !!b.bookId && !!b.title);

        return { books, userVid };
    } catch (e) {
        // JSON 接口失败时，回退到 HTML 页面解析
        return getShelfFromHTML(cred);
    }
}

/** 拉取有笔记的书籍 ID 列表（用于快速模式） */
export async function getNotedBookIds(cred: WereadCredential): Promise<string[]> {
    try {
        const res = await forward({
            url: `${API}/api/user/notebook`,
            method: "GET",
            headers: getHeaders(cred),
            timeout: 20000,
        });
        const { body } = assertOk(res, "api/user/notebook");
        const json = parseWebJson(body, "api/user/notebook");
        const list: any[] = json?.books ?? json?.data ?? [];
        return list
            .map((item: any) => String(item?.bookId ?? item?.book?.bookId ?? ""))
            .filter((id: string) => !!id);
    } catch {
        return [];
    }
}

/** 书籍详情（补充出版社、ISBN 等元数据） */
export async function getBookInfo(cred: WereadCredential, bookId: string): Promise<Partial<BookMeta>> {
    try {
        const res = await forward({
            url: `${API}/api/book/info?bookId=${encodeURIComponent(bookId)}`,
            method: "GET",
            headers: getHeaders(cred),
            timeout: 20000,
        });
        const { body } = assertOk(res, "api/book/info");
        const json = parseWebJson(body, "api/book/info");
        return {
            publisher: json?.publisher || "",
            isbn: json?.isbn || "",
            category: json?.category || "",
            publishTime: json?.publishTime || "",
            translator: json?.translator || "",
        };
    } catch {
        return {};
    }
}

/** 阅读进度 */
export async function getReadInfo(cred: WereadCredential, bookId: string): Promise<{ progress?: number; readingTime?: number }> {
    try {
        const res = await forward({
            url: `${API}/web/book/getProgress?bookId=${encodeURIComponent(bookId)}`,
            method: "GET",
            headers: getHeaders(cred),
            timeout: 15000,
        });
        const { body } = assertOk(res, "web/book/getProgress");
        const json = parseWebJson(body, "web/book/getProgress");
        return {
            progress: typeof json?.progress === "number" ? json.progress : undefined,
            readingTime: typeof json?.readingTime === "number" ? json.readingTime : undefined,
        };
    } catch {
        return {};
    }
}

// ---------------------------------------------------------------- 笔记

/** 章节目录 */
export async function getChapters(cred: WereadCredential, bookId: string): Promise<ChapterInfo[]> {
    try {
        const res = await forward({
            url: `${API}/web/book/chapterInfos`,
            method: "POST",
            headers: postHeaders(cred),
            payload: { bookIds: [bookId] },
            timeout: 20000,
        });
        const { body } = assertOk(res, "web/book/chapterInfos");
        const json = parseWebJson(body, "web/book/chapterInfos");
        const entry = json?.data?.[0];
        const list: any[] = entry?.updated ?? [];
        return list.map((c: any) => ({
            chapterUid: Number(c.chapterUid ?? c.uid ?? 0),
            title: String(c.title ?? ""),
        }));
    } catch {
        return [];
    }
}

/** 划线（bookmarklist） */
export async function getBookmarks(cred: WereadCredential, bookId: string): Promise<RemoteNote[]> {
    try {
        const res = await forward({
            url: `${API}/web/book/bookmarklist?bookId=${encodeURIComponent(bookId)}`,
            method: "GET",
            headers: getHeaders(cred),
            timeout: 20000,
        });
        const { body } = assertOk(res, "web/book/bookmarklist");
        const json = parseWebJson(body, "web/book/bookmarklist");
        const list: any[] = json?.updated ?? [];
        return list.map((item: any) => ({
            id: String(item.bookmarkId ?? ""),
            type: "underline" as const,
            bookId,
            chapterUid: Number(item.chapterUid ?? 0),
            chapterTitle: String(item.chapterTitle ?? ""),
            markText: String(item.markText ?? ""),
            content: "",
            createTime: Number(item.createTime ?? 0),
        })).filter((n: RemoteNote) => !!n.id);
    } catch (e) {
        // 鉴权过期必须向外抛出，让同步流程提示重新登录，而不是静默清空
        if (e instanceof AuthExpiredError) throw e;
        console.warn("[weread] getBookmarks failed", (e as Error)?.message || e);
        return [];
    }
}

/** 个人想法（review/list） */
export async function getReviews(cred: WereadCredential, bookId: string): Promise<RemoteNote[]> {
    try {
        // 参数对齐微信读书 web 前端与 mcp-server-weread
        const url =
            `${API}/web/review/list?bookId=${encodeURIComponent(bookId)}&listType=4&maxIdx=0&count=0&listMode=2&syncKey=0`;
        const res = await forward({
            url,
            method: "GET",
            headers: getHeaders(cred),
            timeout: 20000,
        });
        const { body } = assertOk(res, "web/review/list");
        const json = parseWebJson(body, "web/review/list");
        const list: any[] = json?.reviews ?? [];
        return list
            .map((item: any) => {
                const r = item?.review ?? item;
                return {
                    id: String(r.reviewId ?? ""),
                    type: "review" as const,
                    bookId,
                    chapterUid: Number(r.chapterUid ?? 0),
                    chapterTitle: String(r.chapterTitle ?? ""),
                    markText: String(r.abstract ?? r.abridged ?? ""),
                    content: String(r.content ?? ""),
                    createTime: Number(r.createTime ?? 0),
                } as RemoteNote;
            })
            .filter((n: RemoteNote) => !!n.id);
    } catch (e) {
        // 鉴权过期必须向外抛出，让同步流程提示重新登录，而不是静默返回「没有笔记」
        if (e instanceof AuthExpiredError) throw e;
        console.warn("[weread] getReviews failed", (e as Error)?.message || e);
        return [];
    }
}

/** 封面图（base64 字符串） */
export async function getCoverBase64(coverUrl: string): Promise<string> {
    if (!coverUrl) return "";
    const res = await forward({
        url: coverUrl,
        method: "GET",
        headers: { Referer: `${WEB}/web/shelf` },
        responseEncoding: "base64",
        timeout: 20000,
    });
    const { body } = assertOk(res, "cover");
    return body || "";
}
