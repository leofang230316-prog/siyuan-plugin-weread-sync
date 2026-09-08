<script lang="ts">
    import { onMount } from "svelte";
    import * as siyuan from "@/api/siyuan";
    import { logger } from "@/core/logger";

    export let i18n: any;
    export let store: any;
    export let nodeElement: HTMLElement | null = null;
    export let onClose: () => void = () => {};

    let keyword = "";
    let items: any[] = [];
    let loading = true;
    let activeIndex = 0;
    let inputEl: HTMLInputElement;

    const t = i18n.search;

    onMount(async () => {
        await load();
        inputEl?.focus();
    });

    /**
     * 读取已同步的笔记。
     *
     * 【重要】这里刻意**不走 SQL 查 attributes 表**。
     * 实测：块属性确实写进了思源（getBlockAttrs 能读到 weread-bmid 等），
     * 但 /api/query/sql 查的 attributes 是**索引表**，索引未刷新时查询恒为空
     * ——这正是斜杠搜索"搜不到笔记"的原因，也是思源反复提示重建索引的原因。
     *
     * 改为直接用插件自己的同步状态（sync-state.json），
     * 同步完立刻可搜，不依赖索引，也快得多。
     */
    async function load() {
        loading = true;
        const bookMap = new Map(store.getShelf().map((b: any) => [b.bookId, b]));
        const states = (store.getAllBookStates() || {}) as Record<string, any>;
        const list: any[] = [];

        for (const [bookId, st] of Object.entries(states)) {
            const book: any = bookMap.get(bookId) || {};
            const notes = st?.notes || {};
            for (const note of Object.values(notes) as any[]) {
                if (!note?.blockId) continue;
                list.push({
                    blockId: note.blockId,
                    text: toPlainText(note.content || ""),
                    bookTitle: book.title || "",
                    author: book.author || "",
                });
            }
        }

        items = list;
        logger.info(`搜索索引已加载：${items.length} 条笔记（来自同步状态，不依赖 SQL 索引）`);
        loading = false;
    }

    /** 把笔记 markdown 转成用于列表展示的纯文本 */
    function toPlainText(md: string): string {
        return (md || "")
            .replace(/^>\s?/gm, "")
            .replace(/\*\*/g, "")
            .replace(/`/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    $: filtered = keyword
        ? items.filter((i) => {
              const kw = keyword.toLowerCase();
              return (
                  (i.text || "").toLowerCase().includes(kw) ||
                  (i.bookTitle || "").toLowerCase().includes(kw) ||
                  (i.author || "").toLowerCase().includes(kw)
              );
          })
        : items;

    $: if (activeIndex > filtered.length - 1) activeIndex = 0;

    function onKeydown(e: KeyboardEvent) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, Math.max(0, filtered.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
        } else if (e.key === "Enter") {
            e.preventDefault();
            insert(filtered[activeIndex]);
        } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }
    }

    async function insert(item: any) {
        if (!item) return;
        const nodeId = nodeElement?.dataset?.nodeId;
        if (!nodeId) {
            siyuan.pushErrMsg(t.insertFailed || "Insert failed");
            return;
        }
        const preview = (item.text || "").replace(/"/g, "'").replace(/\n/g, " ").slice(0, 60);
        const md = `((${item.blockId} "${preview}"))`;
        try {
            const ids = await siyuan.insertBlock({
                data: md,
                previousID: nodeId,
            });
            if (!ids || ids.length === 0) {
                throw new Error("insertBlock returned empty");
            }
            siyuan.pushMsg(t.inserted || "Inserted");
            onClose();
        } catch (e) {
            console.error("[weread] insert note failed", e);
            siyuan.pushErrMsg(t.insertFailed || "Insert failed");
        }
    }
</script>

<div class="wr-search">
    <input
        class="b3-text-field wr-search__input"
        type="text"
        placeholder={t.placeholder}
        bind:value={keyword}
        bind:this={inputEl}
        on:keydown={onKeydown}
    />

    {#if loading}
        <div class="wr-search__empty">…</div>
    {:else if filtered.length === 0}
        <div class="wr-search__empty">{t.empty}</div>
    {:else}
        <div class="wr-search__list">
            {#each filtered.slice(0, 200) as item, i (item.blockId)}
                <div
                    class="wr-search__item"
                    class:wr-search__item--active={i === activeIndex}
                    role="button"
                    tabindex="0"
                    on:click={() => insert(item)}
                    on:keydown={(e) => e.key === "Enter" && insert(item)}
                >
                    <div class="wr-search__text">{item.text}</div>
                    {#if item.bookTitle}
                        <div class="wr-search__from">《{item.bookTitle}》{item.author ? ` · ${item.author}` : ""}</div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}

    <div class="wr-search__hint">{t.hint}</div>
</div>

<style>
    .wr-search {
        padding: 12px;
        min-width: 420px;
    }
    .wr-search__input {
        width: 100%;
        margin-bottom: 8px;
    }
    .wr-search__list {
        max-height: 360px;
        overflow-y: auto;
    }
    .wr-search__item {
        padding: 8px 10px;
        border-radius: 4px;
        cursor: pointer;
        margin-bottom: 2px;
    }
    .wr-search__item:hover {
        background: var(--b3-theme-surface);
    }
    .wr-search__item--active {
        background: var(--b3-theme-primary-light, var(--b3-theme-surface));
    }
    .wr-search__text {
        font-size: 13px;
        line-height: 1.5;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }
    .wr-search__from {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        margin-top: 3px;
    }
    .wr-search__empty {
        padding: 28px 8px;
        text-align: center;
        font-size: 12px;
        color: var(--b3-theme-on-surface);
    }
    .wr-search__hint {
        margin-top: 8px;
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        text-align: right;
    }
</style>
