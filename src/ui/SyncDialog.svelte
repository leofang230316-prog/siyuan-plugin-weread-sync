<script lang="ts">
    import { onMount } from "svelte";

    export let i18n: any;
    export let engine: any;
    export let options: any;
    export let onClose: () => void = () => {};

    let done = 0;
    let total = 0;
    let current = "";
    let finished = false;
    let stats: any = null;
    let error = "";
    let controller = new AbortController();

    const t = i18n.sync;

    onMount(() => {
        run();
    });

    async function run() {
        try {
            stats = await engine.run({
                ...options,
                signal: controller.signal,
                onProgress: (p: any) => {
                    done = p.done;
                    total = p.total;
                    current = p.currentTitle;
                },
            });
        } catch (e) {
            error = String(e?.message || e);
        } finally {
            finished = true;
        }
    }

    function percent(): number {
        if (!total) return 0;
        return Math.round((done / total) * 100);
    }

    function report(): string {
        if (!stats) return "";
        return t.report
            .replace("{added}", String(stats.added))
            .replace("{updated}", String(stats.updated))
            .replace("{conflict}", String(stats.conflict))
            .replace("{deleted}", String(stats.deleted))
            .replace("{failed}", String(stats.failedBooks?.length || 0));
    }
</script>

<div class="wr-sync">
    {#if !finished}
        <div class="wr-sync__title">{t.title}</div>

        {#if total > 0}
            <div class="wr-sync__row">{t.progress.replace("{done}", String(done)).replace("{total}", String(total))}</div>
            <div class="wr-sync__bar">
                <div class="wr-sync__bar-inner" style="width: {percent()}%"></div>
            </div>
        {/if}

        <div class="wr-sync__row wr-sync__row--muted">
            {done === 0 && total === 0 ? t.preparing : t.fetchingBook.replace("{title}", current)}
        </div>

        <div class="wr-sync__actions">
            <button class="b3-button" on:click={() => controller.abort()}>{t.cancel}</button>
        </div>
    {:else}
        <div class="wr-sync__title">
            {error ? t.failed || "同步失败" : controller.signal.aborted ? t.cancelled : t.done}
        </div>

        {#if error}
            <div class="wr-sync__error">{error}</div>
        {:else if stats}
            <div class="wr-sync__row">{report()}</div>

            {#if stats.failedBooks?.length}
                <div class="wr-sync__failed">
                    <div class="wr-sync__failed-title">{t.failedList}</div>
                    {#each stats.failedBooks as fb (fb.bookId)}
                        <div class="wr-sync__failed-item">{fb.title}</div>
                    {/each}
                </div>
            {/if}
        {/if}

        <div class="wr-sync__actions">
            <button class="b3-button b3-button--primary" on:click={onClose}>
                {i18n.msg.ok}
            </button>
        </div>
    {/if}
</div>

<style>
    .wr-sync {
        padding: 16px;
        min-width: 320px;
    }
    .wr-sync__title {
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 12px;
        color: var(--b3-theme-on-background);
    }
    .wr-sync__row {
        font-size: 12px;
        color: var(--b3-theme-on-background);
        margin: 6px 0;
        line-height: 1.6;
    }
    .wr-sync__row--muted {
        color: var(--b3-theme-on-surface);
    }
    .wr-sync__bar {
        height: 4px;
        border-radius: 2px;
        background: var(--b3-theme-background);
        overflow: hidden;
        margin: 8px 0;
    }
    .wr-sync__bar-inner {
        height: 100%;
        background: var(--b3-theme-primary);
        transition: width 0.2s;
    }
    .wr-sync__error {
        font-size: 12px;
        color: var(--b3-theme-error);
        margin: 8px 0;
        word-break: break-all;
    }
    .wr-sync__failed {
        margin-top: 10px;
        max-height: 160px;
        overflow-y: auto;
    }
    .wr-sync__failed-title {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        margin-bottom: 4px;
    }
    .wr-sync__failed-item {
        font-size: 12px;
        padding: 2px 0;
        color: var(--b3-theme-on-background);
    }
    .wr-sync__actions {
        margin-top: 16px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
