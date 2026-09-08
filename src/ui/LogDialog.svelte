<script lang="ts">
    import { showMessage } from "siyuan";
    import { logger } from "@/core/logger";

    export let title: string = "同步日志";
    export let onClear: () => void = () => {};

    let text = logger.format();

    function refresh() {
        text = logger.format();
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(text);
            showMessage("日志已复制到剪贴板");
        } catch {
            showMessage("复制失败，请手动选中复制", 4000, "error");
        }
    }

    function clear() {
        logger.clear();
        onClear?.();
        refresh();
    }

    function download() {
        try {
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `weread-sync-log-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            showMessage("导出失败", 4000, "error");
        }
    }
</script>

<div class="weread-log">
    <div class="weread-log__bar">
        <button class="b3-button b3-button--small" on:click={refresh}>刷新</button>
        <button class="b3-button b3-button--small" on:click={copy}>复制</button>
        <button class="b3-button b3-button--small" on:click={download}>导出</button>
        <button class="b3-button b3-button--small b3-button--cancel" on:click={clear}>清空</button>
    </div>
    <p class="weread-log__hint">
        若同步时思源弹出「transaction panic」，请点刷新后<b>复制最后几十行</b>发给我——崩溃前最后一次内核调用就在那里。
    </p>
    <textarea class="weread-log__text" readonly spellcheck="false">{text}</textarea>
</div>

<style>
    .weread-log {
        display: flex;
        flex-direction: column;
        gap: 8px;
        height: 100%;
        padding: 8px;
        box-sizing: border-box;
    }
    .weread-log__bar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .weread-log__hint {
        margin: 0;
        font-size: 12px;
        opacity: 0.75;
        line-height: 1.5;
    }
    .weread-log__text {
        flex: 1;
        width: 100%;
        min-height: 340px;
        resize: none;
        font-family: var(--b3-font-family-code, monospace);
        font-size: 12px;
        line-height: 1.5;
        white-space: pre;
        overflow: auto;
    }
</style>
