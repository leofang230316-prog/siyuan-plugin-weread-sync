<script lang="ts">
    import BookCard from "./BookCard.svelte";

    export let books: any[] = [];
    export let i18n: any;
    export let readOnly: boolean = false;
    export let coverMap: Record<string, string> = {};
    export let syncingIds: any = new Set();
    export let onSync: (bookId: string) => void = () => {};
    export let onOpen: (bookId: string) => void = () => {};

    export let keyword = "";

    const t = i18n.dock;

    $: filtered = keyword
        ? books.filter((b) => {
              const kw = keyword.toLowerCase();
              return (
                  (b.title || "").toLowerCase().includes(kw) ||
                  (b.author || "").toLowerCase().includes(kw)
              );
          })
        : books;
</script>

<div class="wr-list">
    <input
        class="b3-text-field wr-list__search"
        type="text"
        placeholder={t.searchPlaceholder}
        bind:value={keyword}
    />

    {#if books.length > 0}
        <div class="wr-list__count">{t.bookCount.replace("{n}", String(books.length))}</div>
    {/if}

    {#if books.length === 0}
        <div class="wr-list__empty">{t.noBooks}</div>
    {:else if filtered.length === 0}
        <div class="wr-list__empty">{t.noMatch}</div>
    {:else}
        {#each filtered as book (book.bookId)}
            <BookCard
                {book}
                {i18n}
                {readOnly}
                coverSrc={coverMap[book.bookId] || ""}
                syncing={syncingIds.has(book.bookId)}
                {onSync}
                {onOpen}
            />
        {/each}
    {/if}
</div>

<style>
    .wr-list {
        display: flex;
        flex-direction: column;
        padding: 8px 12px 16px;
    }
    .wr-list__search {
        width: 100%;
        margin-bottom: 8px;
        flex-shrink: 0;
    }
    .wr-list__count {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        margin-bottom: 8px;
    }
    .wr-list__empty {
        padding: 32px 8px;
        text-align: center;
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        line-height: 1.7;
    }
</style>
