/**
 * 同步日志。
 *
 * 存在意义：思源内核在同步过程中偶发 `transaction panic: nil pointer dereference`，
 * 只在弹窗里报一句、没有任何上下文，无法定位是哪一次 API 调用触发的。
 * 这里把每一次内核 API 调用的**参数摘要、耗时、返回码**全部记下来，
 * panic 发生时日志的最后一条就是嫌疑现场。
 *
 * 注意：日志正文里绝不能出现登录凭证（wr_skey / Cookie 等）。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
    ts: number;
    level: LogLevel;
    msg: string;
    data?: string;
}

/** 内存中保留的最大条数，防止长期运行占满内存 */
const MAX_ENTRIES = 1500;
/** 持久化节流间隔，避免每条日志都写一次存储 */
const PERSIST_DELAY = 800;

class Logger {
    private entries: LogEntry[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private persistHook: ((entries: LogEntry[]) => void) | null = null;
    /** 是否把日志同时打到浏览器控制台（便于 F12 排查） */
    verbose = true;

    /** 装配持久化回调，由插件主流程注入 */
    setPersistHook(fn: ((entries: LogEntry[]) => void) | null): void {
        this.persistHook = fn;
    }

    private schedulePersist(): void {
        if (!this.persistHook || this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            try {
                this.persistHook?.(this.entries);
            } catch {
                /* 持久化失败不能影响同步 */
            }
        }, PERSIST_DELAY);
    }

    private push(level: LogLevel, msg: string, data?: unknown): void {
        const entry: LogEntry = {
            ts: Date.now(),
            level,
            msg,
            data: data === undefined ? undefined : safeStringify(data),
        };
        this.entries.push(entry);
        if (this.entries.length > MAX_ENTRIES) {
            this.entries.splice(0, this.entries.length - MAX_ENTRIES);
        }

        if (this.verbose) {
            const line = `[weread ${level}] ${msg}${entry.data ? " " + entry.data : ""}`;
            if (level === "error") console.error(line);
            else if (level === "warn") console.warn(line);
            else console.log(line);
        }
        this.schedulePersist();
    }

    debug(msg: string, data?: unknown): void {
        this.push("debug", msg, data);
    }
    info(msg: string, data?: unknown): void {
        this.push("info", msg, data);
    }
    warn(msg: string, data?: unknown): void {
        this.push("warn", msg, data);
    }
    error(msg: string, data?: unknown): void {
        this.push("error", msg, data);
    }

    getEntries(): LogEntry[] {
        return this.entries;
    }

    /** 插件启动时把上次持久化的日志读回来（便于崩溃后回看） */
    restore(entries: LogEntry[]): void {
        if (!Array.isArray(entries) || !entries.length) return;
        const valid = entries.filter((e) => e && typeof e.ts === "number" && typeof e.msg === "string");
        this.entries = valid.slice(-MAX_ENTRIES);
    }

    clear(): void {
        this.entries = [];
        this.schedulePersist();
    }

    /** 立即持久化一次（同步结束时调用） */
    flush(): void {
        if (!this.persistHook) return;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        try {
            this.persistHook(this.entries);
        } catch {
            /* ignore */
        }
    }

    /** 导出为可读文本，便于复制给开发者 */
    format(): string {
        if (!this.entries.length) return "（暂无日志）";
        return this.entries
            .map((e) => {
                const t = new Date(e.ts);
                const p = (n: number) => String(n).padStart(2, "0");
                const time = `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${String(
                    t.getMilliseconds()
                ).padStart(3, "0")}`;
                const tag = e.level.toUpperCase().padEnd(5);
                return `${time} ${tag} ${e.msg}${e.data ? " | " + e.data : ""}`;
            })
            .join("\n");
    }
}

function safeStringify(value: unknown): string {
    if (typeof value === "string") return value;
    try {
        const s = JSON.stringify(value);
        return s === undefined ? String(value) : s;
    } catch {
        return String(value);
    }
}

export const logger = new Logger();
