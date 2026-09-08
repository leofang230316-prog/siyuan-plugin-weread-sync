import * as siyuan from "@/api/siyuan";
import * as weread from "@/api/weread";
import { AuthExpiredError } from "@/api/forward";
import { logger } from "./logger";
import { renderNoteMarkdown, renderBookMarkdown } from "./render";
import { decideMerge, hashContent, normalizeForCompare } from "./merge";
import type { Store } from "./store";
import type { AuthService } from "./auth";
import type {
    BookMeta,
    BookSyncState,
    LocalNoteSnapshot,
    RemoteNote,
    SyncStats,
    WereadCredential,
} from "@/types";

export interface SyncProgressInfo {
    done: number;
    total: number;
    currentTitle: string;
}

export interface SyncOptions {
    /** 仅同步有笔记的书 */
    quick?: boolean;
    /** 强制全量重建（会丢弃本地编辑） */
    force?: boolean;
    /** 指定书籍，为空表示全部 */
    bookIds?: string[];
    onProgress?: (info: SyncProgressInfo) => void;
    signal?: AbortSignal;
    i18n: any;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFileName(name: string): string {
    return (name || "untitled").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
}

/** 转义 Markdown 标题中的特殊字符，避免章节标题破坏块结构 */
function sanitizeHeading(text: string): string {
    return (text || "")
        .replace(/\r\n/g, " ")
        .replace(/[\n\r]/g, " ")
        .replace(/^#+\s*/, "")
        .trim();
}

function isEmptyContent(raw: string): boolean {
    return !raw || normalizeForCompare(raw) === "";
}

function coverMimeType(url: string): string {
    const m = url.match(/\.(jpe?g|png|webp|gif|bmp)(\?|$)/i);
    if (m) {
        const ext = m[1].toLowerCase();
        if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
        return `image/${ext}`;
    }
    return "image/jpeg";
}

/**
 * 取封面地址（直接引用微信读书 CDN，不再下载并内嵌 base64）。
 *
 * 实测：单张封面 base64 可达 **17 万字符**（128KB 图片）。把它塞进
 * `createDocWithMd` / `insertBlock` 的 markdown 后再提交内核，会触发
 * `transaction panic: runtime error: invalid memory address or nil pointer dereference`
 * ——这正是同步时反复出现的那个崩溃。改为引用 URL 后，markdown 只有几十字符。
 */
function pickCoverUrl(meta: BookMeta, enabled: boolean): string | undefined {
    if (!enabled) return undefined;
    const url = (meta?.cover || "").trim();
    return url || undefined;
}

function orderNotes(notes: RemoteNote[], chapterOrder: Map<number, number>): RemoteNote[] {
    return [...notes].sort((a, b) => {
        const oa = chapterOrder.get(a.chapterUid) ?? Number.MAX_SAFE_INTEGER;
        const ob = chapterOrder.get(b.chapterUid) ?? Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        return a.createTime - b.createTime;
    });
}

export class SyncEngine {
    private store: Store;
    private auth: AuthService;

    constructor(store: Store, auth: AuthService) {
        this.store = store;
        this.auth = auth;
    }

    async run(opts: SyncOptions): Promise<SyncStats> {
        const stats: SyncStats = { added: 0, updated: 0, conflict: 0, deleted: 0, failedBooks: [] };

        const cred = this.store.getCred();
        if (!cred) throw new Error("not-logged-in");

        const settings = this.store.getSettings();
        const notebookId = await this.ensureNotebook(settings.notebookName);
        if (settings.notebookId !== notebookId) {
            await this.store.saveSettings({ notebookId });
        }

        // 书架：强制模式或首次时重新拉取
        let books = this.store.getShelf();
        if (opts.force || books.length === 0) {
            const shelf = await weread.getShelf(cred);
            books = shelf.books;
            await this.store.saveShelf(books);
        }

        // 确定目标书籍
        let targets = books;
        if (opts.bookIds && opts.bookIds.length) {
            const set = new Set(opts.bookIds);
            targets = books.filter((b) => set.has(b.bookId));
        } else if (opts.quick || settings.syncRange === "noted") {
            const noted = await weread.getNotedBookIds(cred);
            if (noted.length) {
                const set = new Set(noted);
                targets = books.filter((b) => set.has(b.bookId));
            }
        }

        // 断点续传：跳过上一轮已完成的书
        const allIds = targets.map((b) => b.bookId);
        let pendingIds = allIds;
        const saved = this.store.getProgress();
        if (saved && saved.total.length === allIds.length && saved.done.length > 0) {
            const doneSet = new Set(saved.done);
            pendingIds = allIds.filter((id) => !doneSet.has(id));
        } else {
            await this.store.startProgress(allIds);
        }

        const pendingBooks = targets.filter((b) => pendingIds.includes(b.bookId));
        const total = pendingBooks.length;

        // 思源 SQLite 对并发写入敏感，顺序处理单本书以避免 transaction panic。
        // 同一本书内部的笔记块插入也保持顺序。
        logger.info(
            `sync start: targets=${targets.length} pending=${pendingBooks.length} ` +
                `quick=${!!opts.quick} force=${!!opts.force}`
        );

        for (let i = 0; i < pendingBooks.length; i++) {
            if (opts.signal?.aborted) break;
            const book = pendingBooks[i];
            logger.info(`[${i + 1}/${total}] 开始同步《${book.title}》(${book.bookId})`);
            try {
                await this.syncOneBook(cred, book, notebookId, opts, stats);
                await this.store.markDone(book.bookId);
                logger.info(`[${i + 1}/${total}] 完成《${book.title}》`);
            } catch (e) {
                // 凭证过期必须立刻终止并向上抛出，提示用户重新登录
                if (e instanceof AuthExpiredError) throw e;
                logger.error(`《${book.title}》同步失败: ${e?.message || String(e)}`);
                stats.failedBooks.push({
                    bookId: book.bookId,
                    title: book.title,
                    reason: e?.message || String(e),
                });
                // 连续失败过多则熔断，避免刷爆日志
                if (stats.failedBooks.length >= 10) break;
            }
            opts.onProgress?.({ done: i + 1, total, currentTitle: book.title });
            // 书与书之间留一点喘息时间
            if (i < pendingBooks.length - 1) {
                await sleep(settings.interval + Math.random() * 200);
            }
        }

        if (!opts.signal?.aborted) {
            await this.store.clearProgress();
        }
        logger.info(
            `sync done: added=${stats.added} updated=${stats.updated} ` +
                `conflict=${stats.conflict} deleted=${stats.deleted} failed=${stats.failedBooks.length}`
        );
        logger.flush();
        return stats;
    }

    private async ensureNotebook(name: string): Promise<string> {
        const settings = this.store.getSettings();
        if (settings.notebookId) {
            const list = await siyuan.lsNotebooks();
            if (list.some((nb) => nb.id === settings.notebookId)) {
                return settings.notebookId;
            }
        }
        const list = await siyuan.lsNotebooks();
        const existed = list.find((nb) => nb.name === name);
        if (existed) return existed.id;
        return await siyuan.createNotebook(name);
    }

    private async docExists(docId: string): Promise<boolean> {
        try {
            const rows = await siyuan.sql(
                `SELECT id FROM blocks WHERE id = '${siyuan.escapeSql(docId)}' AND type = 'd' LIMIT 1`
            );
            return rows.length > 0;
        } catch {
            return false;
        }
    }

    private async syncOneBook(
        cred: WereadCredential,
        book: BookMeta,
        notebookId: string,
        opts: SyncOptions,
        stats: SyncStats
    ): Promise<void> {
        if (opts.signal?.aborted) return;

        const settings = this.store.getSettings();
        await sleep(settings.interval + Math.random() * 200);

        // 注意：这里刻意**顺序**请求而不用 Promise.all。
        // 实测并发发起两个 forwardProxy 请求会显著提高思源内核
        // `transaction panic: nil pointer dereference` 的触发概率
        // （v1.0.9 日志显示崩溃正好发生在并发拉取的那一步）。
        const bookmarks = settings.fetchBookmarks
            ? await weread.getBookmarks(cred, book.bookId)
            : [];
        const reviews = await weread.getReviews(cred, book.bookId);
        const notes = [...bookmarks, ...reviews];
        logger.debug(
            `《${book.title}》拉取到 notes=${notes.length} (划线=${bookmarks.length} 想法=${reviews.length})`
        );
        if (notes.length === 0) return; // 无笔记的书不建文档，仅在面板展示

        if (opts.signal?.aborted) return;

        const chapters = await weread.getChapters(cred, book.bookId);
        const chapterOrder = new Map<number, number>();
        const chapterTitleMap = new Map<number, string>();
        chapters.forEach((c, i) => {
            chapterOrder.set(c.chapterUid, i);
            chapterTitleMap.set(c.chapterUid, c.title);
        });

        const extra = await weread.getBookInfo(cred, book.bookId);
        const readInfo = await weread.getReadInfo(cred, book.bookId);
        const meta: BookMeta = { ...book, ...extra, ...readInfo };
        logger.debug(`《${book.title}》元数据就绪 chapters=${chapters?.length ?? 0}`);

        // 文档定位
        let state = opts.force ? undefined : this.store.getBookState(book.bookId);
        let docId = state?.docId;
        if (!docId || !(await this.docExists(docId))) {
            // 封面直接引用 CDN 地址（不再内嵌 base64，避免内核事务崩溃）
            const coverUrl = pickCoverUrl(meta, settings.cacheCover);
            const path = `/${sanitizeFileName(meta.title)}`;
            docId = await siyuan.createDocWithMd(
                notebookId,
                path,
                renderBookMarkdown(meta, opts.i18n, coverUrl)
            );
            await siyuan.setBlockAttrs(docId, {
                "book-id": book.bookId,
                "weread-synced": String(Date.now()),
                "weread-cover": coverUrl ? "1" : "0",
                ...(coverUrl ? { "title-img": coverUrl } : {}),
            });
            state = undefined;
        }

        // 已存在的文档：若开启封面且尚未插入封面图，则补一张到文档顶部（幂等）
        if (docId) {
            await this.ensureCover(docId, settings.cacheCover ? meta.cover : undefined);
        }

        // 本地已有笔记块（以思源为准，不盲信缓存）
        const localBlocks = await siyuan.queryDocNotes(docId);
        const localMap = new Map(localBlocks.map((b) => [b.bmid, b]));

        const ordered = orderNotes(notes, chapterOrder);
        const newNotes: Record<string, LocalNoteSnapshot> = {};
        const chapterAnchors: Record<string, string> = { ...(state?.chapters || {}) };
        const i18n = opts.i18n;

        logger.debug(`《${book.title}》准备写入 ${ordered.length} 条笔记到文档 ${docId}`);

        for (let ni = 0; ni < ordered.length; ni++) {
            const note = ordered[ni];
            if (opts.signal?.aborted) return;
            logger.debug(`  写入笔记 ${ni + 1}/${ordered.length} id=${note.id} type=${note.type}`);

            const chapterTitle =
                chapterTitleMap.get(note.chapterUid) || note.chapterTitle || i18n.note.noChapter;

            const snapshot = state?.notes?.[note.id];
            const local = localMap.get(note.id);
            const remoteRaw = renderNoteMarkdown(note, {});
            const decision = decideMerge({
                remote: note,
                snapshot,
                localText: local?.kramdown,
            });

            if (decision === "unchanged") {
                if (snapshot) newNotes[note.id] = snapshot;
                localMap.delete(note.id);
                continue;
            }

            if (decision === "new") {
                if (isEmptyContent(remoteRaw)) {
                    localMap.delete(note.id);
                    continue;
                }
                if (!chapterAnchors[chapterTitle]) {
                    const heading = sanitizeHeading(chapterTitle);
                    const ids = heading
                        ? await siyuan.appendBlock(docId, `### ${heading}`)
                        : [];
                    chapterAnchors[chapterTitle] = ids[0] || docId;
                }
                const anchor = chapterAnchors[chapterTitle];
                const ids = await siyuan.insertBlock({ data: remoteRaw, previousID: anchor });
                const blockId = ids[0];
                if (blockId) {
                    await siyuan.setBlockAttrs(blockId, this.buildAttrs(note, remoteRaw));
                    newNotes[note.id] = {
                        blockId,
                        hash: hashContent(remoteRaw),
                        ts: note.createTime,
                        content: remoteRaw,
                    };
                    chapterAnchors[chapterTitle] = blockId;
                    stats.added++;
                }
                localMap.delete(note.id);
                continue;
            }

            if (decision === "update" && local) {
                if (isEmptyContent(remoteRaw)) {
                    localMap.delete(note.id);
                    continue;
                }
                await siyuan.updateBlock(local.blockId, remoteRaw);
                await siyuan.setBlockAttrs(local.blockId, this.buildAttrs(note, remoteRaw));
                newNotes[note.id] = {
                    blockId: local.blockId,
                    hash: hashContent(remoteRaw),
                    ts: note.createTime,
                    content: remoteRaw,
                };
                stats.updated++;
                localMap.delete(note.id);
                continue;
            }

            if (decision === "conflict" && local) {
                if (isEmptyContent(remoteRaw)) {
                    localMap.delete(note.id);
                    continue;
                }
                // 保留本地版本不动，在其后追加微信读书新版
                const conflictRaw = appendMark(remoteRaw, i18n.note.conflictMark);
                const ids = await siyuan.insertBlock({ data: conflictRaw, previousID: local.blockId });
                const blockId = ids[0];
                if (blockId) {
                    await siyuan.setBlockAttrs(blockId, {
                        ...this.buildAttrs(note, conflictRaw),
                        "weread-conflict": String(Date.now()),
                    });
                    newNotes[note.id] = {
                        blockId: local.blockId,
                        hash: hashContent(conflictRaw),
                        ts: note.createTime,
                        content: conflictRaw,
                    };
                    stats.conflict++;
                }
                localMap.delete(note.id);
                continue;
            }

            localMap.delete(note.id);
        }

        // 本地有而远端已无：保留内容，仅打标记
        for (const [bmid, local] of localMap) {
            if (opts.signal?.aborted) return;
            if (!local.blockId) continue;
            const alreadyMarked = (local.kramdown || "").includes(i18n.note.deletedMark);
            if (!alreadyMarked && local.kramdown) {
                const marked = appendMark(local.kramdown, i18n.note.deletedMark);
                if (marked && marked.trim()) {
                    await siyuan.updateBlock(local.blockId, marked);
                }
            }
            await siyuan.setBlockAttrs(local.blockId, { "weread-deleted": String(Date.now()) });
            const prev = state?.notes?.[bmid];
            if (prev) newNotes[bmid] = prev;
            stats.deleted++;
        }

        const newState: BookSyncState = {
            bookId: book.bookId,
            docId,
            lastSyncAt: Date.now(),
            notes: newNotes,
            chapters: chapterAnchors,
        } as BookSyncState;
        await this.store.saveBookState(newState);
        await siyuan.setBlockAttrs(docId, { "weread-synced": String(Date.now()) });
    }

    private buildAttrs(note: RemoteNote, raw: string): Record<string, string> {
        return {
            "weread-bmid": note.id,
            "weread-hash": hashContent(raw),
            "weread-ts": String(note.createTime || 0),
            "weread-type": note.type,
            "weread-chapter": note.chapterTitle || "",
            "weread-book": note.bookId,
        };
    }

    /**
     * 为已存在的文档补充封面（内联图片置于文档顶部），幂等。
     * 仅当 cacheCover 开启、meta.cover 存在且文档尚未标记 weread-cover=1 时才插入，
     * 避免每次同步重复添加，也不触碰用户已有的正文编辑。
     */
    private async ensureCover(docId: string, coverUrl: string | undefined): Promise<void> {
        if (!coverUrl) return;
        try {
            const attrs = await siyuan.getBlockAttrs(docId);
            if (attrs && attrs["weread-cover"] === "1") return;
            // 设为文档题头图（即「书籍封面」），markdown 里只引用 URL
            await siyuan.setBlockAttrs(docId, { "title-img": coverUrl });
            const md = `![cover](${coverUrl})`;
            let ids: string[] = [];
            try {
                const doc: any = await siyuan.getDoc(docId);
                const content: string = doc?.content || "";
                const m = content.match(/data-node-id="([^"]+)"/);
                const firstId = m ? m[1] : "";
                ids = firstId
                    ? await siyuan.insertBlock({ data: md, nextID: firstId })
                    : await siyuan.insertBlock({ data: md, parentID: docId });
            } catch {
                ids = await siyuan.insertBlock({ data: md, parentID: docId });
            }
            if (ids && ids.length) {
                await siyuan.setBlockAttrs(docId, { "weread-cover": "1" });
            }
        } catch (e) {
            console.warn("[weread] ensureCover failed", (e as Error)?.message || e);
        }
    }
}

/** 在块文本末尾追加标记，保持块结构不变 */
function appendMark(kramdown: string, mark: string): string {
    if (!mark) return kramdown;
    if ((kramdown || "").includes(mark)) return kramdown;
    const lines = (kramdown || "").split("\n");
    lines[lines.length - 1] = `${lines[lines.length - 1]}　**${mark}**`;
    return lines.join("\n");
}
