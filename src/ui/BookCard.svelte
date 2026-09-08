<script lang="ts">
    export let book: any;
    export let i18n: any;
    export let coverSrc: string = "";
    export let readOnly: boolean = false;
    export let syncing: boolean = false;
    export let onSync: (bookId: string) => void = () => {};
    export let onOpen: (bookId: string) => void = () => {};

    const t = i18n.dock;
</script>

<div class="wr-card">
    <div class="wr-card__cover">
        {#if coverSrc}
            <img src={coverSrc} alt={book.title} loading="lazy" />
        {:else}
            <div class="wr-card__cover-ph">{(book.title || "?").trim().slice(0, 1)}</div>
        {/if}
    </div>

    <div class="wr-card__body">
        <div
            class="wr-card__title"
            title={book.title}
            role="button"
            tabindex="0"
            on:click={() => onOpen(book.bookId)}
            on:keydown={(e) => e.key === "Enter" && onOpen(book.bookId)}
        >
            {book.title}
        </div>

        {#if book.author}
            <div class="wr-card__meta">{book.author}</div>
        {/if}

        {#if typeof book.progress === "number" && book.progress > 0}
            <div class="wr-card__bar">
                <div class="wr-card__bar-inner" style="width: {Math.min(100, book.progress)}%"></div>
            </div>
        {/if}

        {#if !readOnly}
            <div class="wr-card__actions">
                <button
                    class="b3-button b3-button--small"
                    disabled={syncing}
                    on:click={() => onSync(book.bookId)}
                >
                    {syncing ? t.syncing : t.sync}
                </button>
            </div>
        {/if}
    </div>
</div>

<style>
    .wr-card {
        display: flex;
        gap: 10px;
        padding: 10px;
        border-radius: 6px;
        background: var(--b3-theme-surface);
        margin-bottom: 8px;
    }
    .wr-card:hover {
        background: var(--b3-theme-background-hover, var(--b3-theme-surface));
    }
    .wr-card__cover {
        width: 46px;
        height: 64px;
        flex-shrink: 0;
        border-radius: 3px;
        overflow: hidden;
        background: var(--b3-theme-background);
    }
    .wr-card__cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .wr-card__cover-ph {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        color: var(--b3-theme-on-surface);
    }
    .wr-card__body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .wr-card__title {
        font-size: 13px;
        font-weight: 500;
        line-height: 1.4;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }
    .wr-card__title:hover {
        color: var(--b3-theme-primary);
    }
    .wr-card__meta {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .wr-card__bar {
        height: 3px;
        border-radius: 2px;
        background: var(--b3-theme-background);
        overflow: hidden;
    }
    .wr-card__bar-inner {
        height: 100%;
        background: var(--b3-theme-primary);
    }
    .wr-card__actions {
        margin-top: 2px;
        display: flex;
        gap: 6px;
    }
</style>
