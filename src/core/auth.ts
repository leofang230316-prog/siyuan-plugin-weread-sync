import {
    getLoginUid,
    buildQRContent,
    pollLogin,
    verifyCred,
    refreshCred,
    getUserInfo,
} from "@/api/weread";
import type { Store } from "./store";
import type { WereadCredential } from "@/types";

/** 两次轮询之间的最小间隔；等待扫码的时间主要由服务端长轮询承担 */
const POLL_INTERVAL = 1000;
/** 需要验证码时的轮询间隔，避免服务端立即返回造成紧密循环 */
const OTP_POLL_INTERVAL = 1500;
/** 整个登录流程的最长尝试时长 */
const QR_TIMEOUT = 5 * 60 * 1000;

export type LoginStatus = "waiting" | "scanned" | "otp" | "success" | "expired" | "failed";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** 解析用户粘贴的 Cookie 字符串 */
export function parseCookieString(raw: string): WereadCredential {
    const cred: WereadCredential = {};
    for (const part of (raw || "").split(";")) {
        const idx = part.indexOf("=");
        if (idx <= 0) continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (key.toLowerCase().startsWith("wr_")) {
            cred[key.toLowerCase()] = decodeSafe(value);
        }
    }
    return cred;
}

export class AuthService {
    private store: Store;
    /** 用户在界面上填写的验证码，由下一次轮询带上 */
    private pendingOtp = "";

    constructor(store: Store) {
        this.store = store;
    }

    /** 用户提交验证码后调用，正在进行的轮询会在下一轮带上它 */
    setOtp(code: string): void {
        this.pendingOtp = code || "";
    }

    getCred(): WereadCredential | null {
        return this.store.getCred();
    }

    isLoggedIn(): boolean {
        const cred = this.store.getCred();
        return !!(cred && cred.wr_skey);
    }

    /**
     * 扫码登录主流程。
     *
     * 关键点：二维码每次只有约 55 秒寿命（见 QR_LIFETIME_MS），过期后服务端返回
     * LOGIN_TIMEOUT 且 canRetry=false，该 uid 作废。因此这里在收到 expired 后
     * **自动重新获取 uid 并刷新二维码**，而不是直接终止登录——否则用户往往来不及扫。
     */
    async startQRLogin(callbacks: {
        onQR: (content: string) => void;
        onStatus: (status: LoginStatus) => void;
        signal?: AbortSignal;
    }): Promise<WereadCredential | null> {
        const deadline = Date.now() + QR_TIMEOUT;
        this.pendingOtp = "";
        let uid: string | null = null;

        while (Date.now() < deadline) {
            if (callbacks.signal?.aborted) return null;

            // 首次进入或上一张二维码已过期：换一张新码
            if (!uid) {
                try {
                    uid = await getLoginUid();
                } catch (e) {
                    callbacks.onStatus("failed");
                    throw e;
                }
                callbacks.onQR(buildQRContent(uid));
                callbacks.onStatus("waiting");
            }

            if (callbacks.signal?.aborted) return null;

            let result;
            try {
                result = await pollLogin(uid, this.pendingOtp);
            } catch {
                // 网络抖动不应中断整个登录流程，稍后重试同一张码
                await sleep(POLL_INTERVAL);
                continue;
            }

            if (result.status === "success") {
                await this.store.saveCred(result.cred);
                // 顺带取一次昵称用于界面展示，失败不影响登录结果
                const info = await getUserInfo(result.cred);
                if (info?.name) {
                    await this.store.saveCred({ ...result.cred, userName: info.name } as WereadCredential);
                }
                callbacks.onStatus("success");
                return result.cred;
            }

            if (result.status === "expired") {
                // 自动续期：丢弃旧 uid，下一轮换一张新二维码
                uid = null;
                this.pendingOtp = "";
                continue;
            }

            if (result.status === "otp") {
                callbacks.onStatus("otp");
                await sleep(OTP_POLL_INTERVAL);
                continue;
            }

            // waiting / scanned
            callbacks.onStatus(result.status);
        }

        callbacks.onStatus("expired");
        return null;
    }

    /** 手动 Cookie 登录 */
    async loginByCookie(cookieStr: string): Promise<WereadCredential> {
        const cred = parseCookieString(cookieStr);
        if (!cred.wr_skey) {
            throw new Error("cookie-missing-skey");
        }
        const ok = await verifyCred(cred);
        if (!ok) {
            throw new Error("cookie-invalid");
        }
        await this.store.saveCred(cred);
        return cred;
    }

    async logout(): Promise<void> {
        await this.store.saveCred(null);
    }

    /** 确保凭证有效，必要时自动续期 */
    async ensureValid(): Promise<boolean> {
        const cred = this.store.getCred();
        if (!cred || !cred.wr_skey) return false;

        if (await verifyCred(cred)) return true;

        const renewed = await refreshCred(cred);
        if (renewed && (await verifyCred(renewed))) {
            await this.store.saveCred(renewed);
            return true;
        }
        return false;
    }
}
