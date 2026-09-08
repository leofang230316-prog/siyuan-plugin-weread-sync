import type { BookMeta, RemoteNote } from "@/types";

/** 秒级时间戳格式化为 YYYY-MM-DD HH:mm */
export function formatTimestamp(tsSec: number): string {
    if (!tsSec) return "";
    const d = new Date(tsSec * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toQuoteLines(text: string): string[] {
    return (text || "").split("\n").map((line) => `> ${line}`);
}

function appendToLast(lines: string[], extra: string): string[] {
    if (!lines.length) return [extra];
    lines[lines.length - 1] += extra;
    return lines;
}

/**
 * 将单条笔记渲染为「恰好一个」思源块。
 *
 * 一条笔记对应一个块是整套增量合并机制的基础：
 * 块 ID 与笔记 ID 一一对应，才能实现稳定的锚定与引用。
 */
export function renderNoteMarkdown(
    note: RemoteNote,
    opts?: { deletedMark?: string; conflictMark?: string }
): string {
    const stamp = formatTimestamp(note.createTime);
    const suffix = stamp ? `　\`${stamp}\`` : "";

    if (note.type === "underline") {
        return appendToLast(toQuoteLines(note.markText), suffix).join("\n");
    }

    // 想法：引用原文 + 自己的想法，同处一个引用块内（保证「一条笔记 = 一个块」）。
    // 原文用普通引用文本，自己的想法**加粗**，两者在思源里视觉上明显区分。
    if (note.markText) {
        const lines = toQuoteLines(note.markText);
        const thought = (note.content || "").trim();
        if (thought) {
            lines.push(">");
            lines.push(...toQuoteLines(`**${thought}**`));
        }
        return appendToLast(lines, suffix).join("\n");
    }

    return appendToLast((note.content || "").split("\n"), suffix).join("\n");
}

/** 书籍文档初始内容（封面 + 书籍信息 + 笔记区标题） */
export function renderBookMarkdown(meta: BookMeta, i18n: any, coverAssetPath?: string): string {
    const t = i18n?.doc || {};
    const lines: string[] = [];
    lines.push(`# ${meta.title}`, "");
    if (coverAssetPath) {
        lines.push(`![${t.cover || "封面"}](${coverAssetPath})`, "");
    }
    lines.push(`## ${t.bookInfo || "书籍信息"}`, "");

    if (meta.author) lines.push(`- ${t.author || "作者"}：${meta.author}`);
    if (meta.translator) lines.push(`- ${t.translator || "译者"}：${meta.translator}`);
    if (meta.publisher) lines.push(`- ${t.publisher || "出版社"}：${meta.publisher}`);
    if (meta.publishTime) lines.push(`- ${t.publishTime || "出版时间"}：${meta.publishTime}`);
    if (meta.isbn) lines.push(`- ${t.isbn || "ISBN"}：${meta.isbn}`);
    if (meta.category) lines.push(`- ${t.category || "分类"}：${meta.category}`);
    if (typeof meta.progress === "number") {
        lines.push(`- ${t.progress || "阅读进度"}：${meta.progress}%`);
    }
    if (typeof meta.readingTime === "number" && meta.readingTime > 0) {
        lines.push(`- ${t.readingTime || "阅读时长"}：${formatDuration(meta.readingTime)}`);
    }

    lines.push("", `## ${t.notes || "笔记"}`, "");
    return lines.join("\n");
}

/** 分钟数格式化为「x 小时 y 分钟」 */
export function formatDuration(minutes: number): string {
    if (!minutes || minutes <= 0) return "0";
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h <= 0) return `${m}`;
    return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}
