import type { LocalNoteSnapshot, MergeState, RemoteNote } from "@/types";
import { renderNoteMarkdown } from "./render";

/** 内容指纹，用于判断远端内容是否变化 */
export function hashContent(text: string): string {
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

/**
 * 归一化文本用于比对。
 * 思源返回的 kramdown 与我们写入的 markdown 在空白上可能有差异，
 * 统一折叠空白后再比，避免把格式差异误判成用户编辑。
 */
export function normalizeForCompare(text: string): string {
    return (text || "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

export interface MergeInput {
    remote: RemoteNote;
    /** 上次同步时写入思源的内容快照 */
    snapshot?: LocalNoteSnapshot;
    /** 思源中该块当前的 kramdown */
    localText?: string;
}

/**
 * 三方比对：本地块文本、上次快照、当前远端原文。
 *
 * 返回：
 * - new        本地无此笔记
 * - unchanged  远端与本地均无变化（或仅本地被编辑）
 * - update     仅远端变化，本地保持原样 -> 静默更新
 * - conflict   两端都变过 -> 保留本地，另存远端新版
 */
export function decideMerge(input: MergeInput): MergeState {
    const { remote, snapshot, localText } = input;

    if (!snapshot) return "new";

    const remoteRaw = renderNoteMarkdown(remote, {});
    const remoteChanged = normalizeForCompare(remoteRaw) !== normalizeForCompare(snapshot.content);
    if (!remoteChanged) return "unchanged";

    const localChanged =
        localText !== undefined &&
        normalizeForCompare(localText) !== normalizeForCompare(snapshot.content);

    return localChanged ? "conflict" : "update";
}

/**
 * 判断某条本地笔记是否被远端删除。
 * 远端列表中不存在、且本地有记录的即视为已删除。
 */
export function findDeleted(
    localIds: string[],
    remoteIds: Set<string>
): string[] {
    return localIds.filter((id) => !remoteIds.has(id));
}
