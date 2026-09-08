import { fetchSyncPost } from "siyuan";
import { logger } from "@/core/logger";

/**
 * 思源内核 API 封装。
 *
 * 红线：读写 data 目录一律走内核 API，禁止直接调用 fs / Electron / Node.js API，
 * 否则会在多端同步时造成数据丢失。
 */

/**
 * 生成参数摘要：只记录长度与关键短字段，绝不打印可能很大的正文
 * （尤其是 markdown / base64，实测封面数据可达 17 万字符）。
 */
function summarize(data: any): string {
    if (!data || typeof data !== "object") return "";
    const parts: string[] = [];
    for (const [k, v] of Object.entries(data)) {
        if (v === undefined || v === null) continue;
        if (typeof v === "string") {
            if (v.length > 120) {
                parts.push(`${k}.len=${v.length}`);
            } else {
                parts.push(`${k}="${v.replace(/\s+/g, " ")}"`);
            }
        } else if (typeof v === "object") {
            const s = JSON.stringify(v) || "";
            parts.push(s.length > 160 ? `${k}.len=${s.length}` : `${k}=${s}`);
        } else {
            parts.push(`${k}=${String(v)}`);
        }
    }
    return parts.join(" ");
}

/**
 * 统一的内核调用入口，带日志埋点。
 *
 * 同步时的 `transaction panic` 只在弹窗报一句，没有任何上下文；
 * 这里把每次调用的参数摘要、耗时、返回码都记下来，panic 时最后一条日志就是现场。
 */
async function post(url: string, data: any = {}): Promise<any> {
    const t0 = Date.now();
    logger.debug(`→ ${url} ${summarize(data)}`);
    try {
        const res = await fetchSyncPost(url, data);
        const ms = Date.now() - t0;
        const code = res?.code;
        if (code !== undefined && code !== 0) {
            logger.error(`✗ ${url} code=${code} msg=${res?.msg ?? ""} (${ms}ms)`);
        } else {
            logger.debug(`✓ ${url} (${ms}ms)`);
        }
        return res;
    } catch (e: any) {
        logger.error(`✗ ${url} THREW (${Date.now() - t0}ms) ${e?.message || String(e)}`);
        throw e;
    }
}

// ---------------------------------------------------------------- 笔记本

export interface Notebook {
    id: string;
    name: string;
    closed?: boolean;
}

export async function lsNotebooks(): Promise<Notebook[]> {
    const res = await post("/api/notebook/lsNotebooks");
    return (res?.data?.notebooks || []).filter((nb: Notebook) => !nb.closed);
}

export async function createNotebook(name: string): Promise<string> {
    const res = await post("/api/notebook/createNotebook", { name });
    return res?.data?.notebook?.id;
}

// ---------------------------------------------------------------- 文档

/** 创建文档，path 形如 "/书名"，返回文档 ID */
export async function createDocWithMd(notebookId: string, path: string, markdown: string): Promise<string> {
    const res = await post("/api/filetree/createDocWithMd", {
        notebook: notebookId,
        path,
        markdown,
    });
    return res?.data;
}

export async function getDoc(docId: string): Promise<any> {
    const res = await post("/api/filetree/getDoc", { id: docId });
    return res?.data;
}

export async function removeDoc(docId: string): Promise<void> {
    await post("/api/filetree/removeDoc", { id: docId });
}

export async function setBlockAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
    await post("/api/attr/setBlockAttrs", { id: blockId, attrs });
}

export async function getBlockAttrs(blockId: string): Promise<Record<string, string>> {
    const res = await post("/api/attr/getBlockAttrs", { id: blockId });
    return res?.data || {};
}

// ---------------------------------------------------------------- 块

/** 追加块，返回新块 ID 列表 */
export async function appendBlock(parentId: string, markdown: string): Promise<string[]> {
    const res = await post("/api/block/appendBlock", {
        data: markdown,
        parentID: parentId,
        dataType: "markdown",
    });
    const ids = pickBlockIds(res);
    if (!ids.length) logger.warn(`appendBlock 未取到块 ID，父块=${parentId}`);
    return ids;
}

export interface InsertBlockOptions {
    data: string;
    previousID?: string;
    parentID?: string;
    nextID?: string;
}

export async function insertBlock(opts: InsertBlockOptions): Promise<string[]> {
    const res = await post("/api/block/insertBlock", {
        data: opts.data,
        dataType: "markdown",
        previousID: opts.previousID,
        parentID: opts.parentID,
        nextID: opts.nextID,
    });
    const ids = pickBlockIds(res);
    if (!ids.length) {
        logger.warn(
            `insertBlock 未取到块 ID（笔记属性会丢失）previousID=${opts.previousID ?? "-"} ` +
                `parentID=${opts.parentID ?? "-"} nextID=${opts.nextID ?? "-"}`
        );
    }
    return ids;
}

export async function updateBlock(blockId: string, markdown: string): Promise<void> {
    await post("/api/block/updateBlock", {
        id: blockId,
        data: markdown,
        dataType: "markdown",
    });
}

export async function getBlockKramdown(blockId: string): Promise<string> {
    const res = await post("/api/block/getBlockKramdown", { id: blockId });
    return res?.data?.kramdown || "";
}

export async function getBlockByID(blockId: string): Promise<any> {
    const res = await post("/api/block/getBlockInfo", { id: blockId });
    return res?.data;
}

/**
 * 从块操作响应中提取块 ID。
 *
 * `fetchSyncPost` 返回的是完整响应 `{ code, msg, data }`，块操作
 * （insertBlock / appendBlock）的结果在 **data** 里，形如：
 * `[{ doOperations: [{ action, id, ... }], undoOperations: [...] }]`。
 *
 * 【修复记录】早期版本写成 `res?.doOperations`，而 res 是响应对象不是数组，
 * 因此永远取不到 id。后果：块虽已插入思源，却因拿不到 blockId 而
 * ① 没写 `weread-bmid` 属性 → 斜杠搜索搜不到、增量合并失效；
 * ② 统计 added/updated 恒为 0；③ 章节标题块 ID 丢失，笔记全堆在文档末尾。
 */
function pickBlockIds(res: any): string[] {
    const payload = res?.data ?? res;
    let ops: any[] | undefined;
    if (Array.isArray(payload)) {
        ops = payload[0]?.doOperations ?? payload[0];
    } else if (Array.isArray(payload?.doOperations)) {
        ops = payload.doOperations;
    }
    if (!Array.isArray(ops)) return [];
    return ops.map((op: any) => op?.id).filter((id: any) => typeof id === "string");
}

// ---------------------------------------------------------------- SQL

export async function sql(stmt: string): Promise<any[]> {
    const res = await post("/api/query/sql", { stmt });
    return res?.data || [];
}

/**
 * 查询某文档下所有带指定属性的块。
 * 用于同步前重建本地笔记索引，避免依赖可能失效的缓存。
 */
export async function queryDocNotes(docId: string): Promise<{ blockId: string; bmid: string; kramdown: string }[]> {
    const stmt = `SELECT B.id AS blockId, B.markdown AS kramdown, A.value AS bmid
FROM blocks AS B
JOIN attributes AS A ON A.block_id = B.id
WHERE A.name = 'weread-bmid' AND B.root_id = '${escapeSql(docId)}'`;
    const rows = await sql(stmt);
    return (rows || []).map((row: any) => ({
        blockId: row.blockId,
        bmid: row.bmid,
        kramdown: row.kramdown || "",
    }));
}

/** 按属性名查询插件笔记本下已同步的书籍文档 */
export async function querySyncedDocs(notebookId: string): Promise<{ docId: string; bookId: string }[]> {
    const stmt = `SELECT B.id AS docId, A.value AS bookId
FROM blocks AS B
JOIN attributes AS A ON A.block_id = B.id
WHERE A.name = 'book-id' AND B.box = '${escapeSql(notebookId)}' AND B.type = 'd'`;
    const rows = await sql(stmt);
    return (rows || []).map((row: any) => ({
        docId: row.docId,
        bookId: row.bookId,
    }));
}

export function escapeSql(value: string): string {
    return String(value ?? "").replace(/'/g, "''");
}

// ---------------------------------------------------------------- 文件

/** 写入文件或创建目录，path 为 data 目录下的相对路径，content 为 base64 字符串 */
export async function putFile(path: string, base64Content: string, isDir = false): Promise<void> {
    await post("/api/file/putFile", {
        path,
        isDir,
        file: isDir ? undefined : base64Content,
    });
}

export async function getFile(path: string): Promise<string> {
    const res = await post("/api/file/getFile", { path });
    return typeof res === "string" ? res : res?.data || "";
}

export async function removeFile(path: string): Promise<void> {
    await post("/api/file/removeFile", { path });
}

// ---------------------------------------------------------------- 其他

export async function pushMsg(msg: string, timeout = 4000): Promise<void> {
    await post("/api/notification/pushMsg", { msg, timeout });
}

export async function pushErrMsg(msg: string, timeout = 6000): Promise<void> {
    await post("/api/notification/pushErrMsg", { msg, timeout });
}

/** 打开文档（在主编辑区） */
export function openTab(docId: string): void {
    // 由思源前端处理，此处通过自定义事件交给主流程
    window.dispatchEvent(new CustomEvent("weread-open-doc", { detail: { docId } }));
}
