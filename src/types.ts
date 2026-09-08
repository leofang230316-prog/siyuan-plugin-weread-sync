/** 微信读书登录凭证 */
export interface WereadCredential {
    wr_vid?: string;
    wr_skey?: string;
    wr_rt?: string;
    wr_gid?: string;
    wr_name?: string;
    wr_avatar?: string;
    /** 登录后从 /api/userInfo 取到的昵称，仅用于界面展示 */
    userName?: string;
    [key: string]: string | undefined;
}

/** 书籍元数据 */
export interface BookMeta {
    bookId: string;
    title: string;
    author: string;
    translator?: string;
    publisher?: string;
    isbn?: string;
    cover?: string;
    category?: string;
    publishTime?: string;
    /** 阅读进度百分比 0-100 */
    progress?: number;
    /** 累计阅读时长，分钟 */
    readingTime?: number;
    /** 笔记数量 */
    noteCount?: number;
    /** 微信读书最后阅读时间戳（秒） */
    readUpdateTime?: number;
}

/** 章节信息 */
export interface ChapterInfo {
    chapterUid: number;
    title: string;
}

export type NoteType = "underline" | "review";

/** 远端笔记（微信读书侧） */
export interface RemoteNote {
    /** bookmarkId 或 reviewId，全局唯一且稳定，作为合并锚点 */
    id: string;
    type: NoteType;
    bookId: string;
    chapterUid: number;
    chapterTitle: string;
    /** 划线原文，review 类型为空 */
    markText: string;
    /** 想法内容，underline 类型为空 */
    content: string;
    /** 微信读书笔记时间，秒级时间戳 */
    createTime: number;
}

/** 本地已同步笔记的快照 */
export interface LocalNoteSnapshot {
    blockId: string;
    hash: string;
    ts: number;
    /** 上次同步时写入思源的远端规范化文本 */
    content: string;
}

/** 单本书的同步状态 */
export interface BookSyncState {
    bookId: string;
    docId: string;
    lastSyncAt: number;
    notes: Record<string, LocalNoteSnapshot>;
    /** 章节标题 -> 该章节最后一个块 ID，用于增量插入时定位插入点 */
    chapters: Record<string, string>;
}

/** 合并判定状态 */
export type MergeState = "new" | "update" | "conflict" | "deleted" | "unchanged";

/** 单条笔记的合并决策 */
export interface MergeDecision {
    state: MergeState;
    bmid: string;
    ts: number;
    /** 远端规范化文本 */
    remoteRaw: string;
    /** 本地块 ID，新增时为 undefined */
    localBlockId?: string;
    /** 本地块当前文本 */
    localContent?: string;
}

/** 同步配置 */
export interface SyncSettings {
    notebookId: string;
    notebookName: string;
    syncRange: "all" | "noted";
    autoSync: boolean;
    concurrency: number;
    interval: number;
    slashTriggers: string[];
    cacheCover: boolean;
    /**
     * 是否请求划线（web/book/bookmarklist）。
     * 2026-09 实测该接口对所有书籍恒返回空对象（已废弃），默认关闭：
     * 既省掉每本书一次 forwardProxy 请求，也避免并发请求诱发内核崩溃。
     */
    fetchBookmarks: boolean;
}

/** 同步统计 */
export interface SyncStats {
    added: number;
    updated: number;
    conflict: number;
    deleted: number;
    failedBooks: { bookId: string; title: string; reason: string }[];
}
