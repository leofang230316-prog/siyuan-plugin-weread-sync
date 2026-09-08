import type { Plugin } from "siyuan";
import type { BookMeta, BookSyncState, SyncSettings, WereadCredential } from "@/types";

const KEY_CRED = "credential.json";
const KEY_SETTINGS = "settings.json";
const KEY_SHELF = "shelf.json";
const KEY_STATE = "sync-state.json";
const KEY_PROGRESS = "sync-progress.json";
const KEY_LOG = "sync-log.json";
/** 持久化保留的日志条数上限，防止存储文件无限增长 */
const LOG_KEEP = 600;

export const DEFAULT_SETTINGS: SyncSettings = {
    notebookId: "",
    notebookName: "微信读书",
    syncRange: "noted",
    autoSync: false,
    concurrency: 1,
    interval: 300,
    slashTriggers: ["weread", "读书"],
    cacheCover: true,
    fetchBookmarks: false,
};

export interface SyncProgress {
    startedAt: number;
    total: string[];
    done: string[];
}

/**
 * 插件本地状态存储。
 * 基于 plugin.saveData / loadData，数据落在 petal 存储区。
 */
export class Store {
    private plugin: Plugin;
    private settings: SyncSettings = { ...DEFAULT_SETTINGS };
    private shelf: BookMeta[] = [];
    private state: Record<string, BookSyncState> = {};
    private progress: SyncProgress | null = null;
    private cred: WereadCredential | null = null;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        this.cred = (await this.read(KEY_CRED)) || null;
        const settings = (await this.read(KEY_SETTINGS)) || null;
        this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
        this.shelf = (await this.read(KEY_SHELF)) || [];
        this.state = (await this.read(KEY_STATE)) || {};
        this.progress = (await this.read(KEY_PROGRESS)) || null;
    }

    private async read(key: string): Promise<any> {
        try {
            const raw = await this.plugin.loadData(key);
            if (!raw) return null;
            if (typeof raw === "string") {
                return JSON.parse(raw);
            }
            return raw;
        } catch {
            return null;
        }
    }

    private async write(key: string, value: any): Promise<void> {
        try {
            await this.plugin.saveData(key, JSON.stringify(value));
        } catch (e) {
            console.error(`[weread] save ${key} failed`, e);
        }
    }

    // ------------------------------------------------------------ 凭证

    getCred(): WereadCredential | null {
        return this.cred;
    }

    async saveCred(cred: WereadCredential | null): Promise<void> {
        this.cred = cred;
        await this.write(KEY_CRED, cred);
    }

    // ------------------------------------------------------------ 设置

    getSettings(): SyncSettings {
        return this.settings;
    }

    async saveSettings(patch: Partial<SyncSettings>): Promise<void> {
        this.settings = { ...this.settings, ...patch };
        await this.write(KEY_SETTINGS, this.settings);
    }

    // ------------------------------------------------------------ 书架

    getShelf(): BookMeta[] {
        return this.shelf;
    }

    async saveShelf(books: BookMeta[]): Promise<void> {
        this.shelf = books;
        await this.write(KEY_SHELF, books);
    }

    // ------------------------------------------------------------ 同步状态

    getBookState(bookId: string): BookSyncState | undefined {
        return this.state[bookId];
    }

    /** 全部书籍同步状态，用于建立 docId -> bookId 的反查映射 */
    getAllBookStates(): Record<string, BookSyncState> {
        return this.state;
    }

    async saveBookState(bookState: BookSyncState): Promise<void> {
        this.state[bookState.bookId] = bookState;
        await this.write(KEY_STATE, this.state);
    }

    async resetState(): Promise<void> {
        this.state = {};
        this.progress = null;
        await this.write(KEY_STATE, this.state);
        await this.write(KEY_PROGRESS, null);
    }

    // ------------------------------------------------------------ 断点续传

    getProgress(): SyncProgress | null {
        return this.progress;
    }

    async startProgress(total: string[]): Promise<void> {
        this.progress = { startedAt: Date.now(), total, done: [] };
        await this.write(KEY_PROGRESS, this.progress);
    }

    async markDone(bookId: string): Promise<void> {
        if (!this.progress) return;
        if (!this.progress.done.includes(bookId)) {
            this.progress.done.push(bookId);
        }
        await this.write(KEY_PROGRESS, this.progress);
    }

    async clearProgress(): Promise<void> {
        this.progress = null;
        await this.write(KEY_PROGRESS, null);
    }

    // ------------------------------------------------------------ 同步日志

    /** 保存日志（只留最近若干条），用于崩溃后回看现场 */
    async saveLog(entries: unknown[]): Promise<void> {
        await this.write(KEY_LOG, Array.isArray(entries) ? entries.slice(-LOG_KEEP) : []);
    }

    async loadLog(): Promise<any[]> {
        return (await this.read(KEY_LOG)) || [];
    }

    async clearLog(): Promise<void> {
        await this.write(KEY_LOG, []);
    }
}
