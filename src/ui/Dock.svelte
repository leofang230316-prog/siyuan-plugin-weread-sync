<script lang="ts">
    import LoginPanel from "./LoginPanel.svelte";
    import BookList from "./BookList.svelte";
    import SyncDialog from "./SyncDialog.svelte";
    import { getCoverBase64 } from "@/api/weread";
    import * as siyuan from "@/api/siyuan";

    export let plugin: any;
    export let store: any;
    export let auth: any;
    export let engine: any;
    export let i18n: any;
    export let isMobile: boolean = false;

    let loggedIn = auth.isLoggedIn();
    let books = store.getShelf();
    let coverMap: Record<string, string> = {};
    let syncingIds: Set<string> = new Set();
    let syncOptions: any = null;
    let keyword = "";

    const t = i18n.dock;

    function onLoginSuccess() {
        loggedIn = true;
        refreshShelf();
    }

    async function refreshShelf() {
        try {
            const cred = store.getCred();
            if (!cred) return;
            const shelf = await import("@/api/weread").then((m) => m.getShelf(cred));
            books = shelf.books;
            await store.saveShelf(books);
            loadCovers();
        } catch (e) {
            console.error("[weread] refresh shelf failed", e);
        }
    }

    async function loadCovers() {
        if (!store.getSettings().cacheCover) return;
        const pending = books.filter((b: any) => b.cover && !coverMap[b.bookId]).slice(0, 30);
        for (const book of pending) {
            try {
                const b64 = await getCoverBase64(book.cover);
                if (b64) {
                    coverMap = { ...coverMap, [book.bookId]: `data:image/jpeg;base64,${b64}` };
                }
            } catch {
                /* 封面失败不影响主流程 */
            }
        }
    }

    function openSync(options: any) {
        syncOptions = { ...options, i18n };
    }

    function onSyncDone() {
        syncOptions = null;
    }

    async function syncOneBook(bookId: string) {
        syncingIds = new Set(syncingIds).add(bookId);
        try {
            await engine.run({ bookIds: [bookId], i18n });
            books = store.getShelf();
        } catch (e) {
            console.error("[weread] sync book failed", e);
        } finally {
            const next = new Set(syncingIds);
            next.delete(bookId);
            syncingIds = next;
        }
    }

    async function openBookDoc(bookId: string) {
        const state = store.getBookState(bookId);
        if (!state?.docId) return;
        siyuan.openTab(state.docId);
    }

    async function logout() {
        const ok = await plugin.__wereadConfirm?.(i18n.login.logoutConfirm);
        if (ok === false) return;
        await auth.logout();
        loggedIn = false;
        books = [];
        coverMap = {};
    }
</script>

<div class="wr-dock">
    {#if !loggedIn}
        <LoginPanel {i18n} {auth} onSuccess={onLoginSuccess} />
    {:else}
        <div class="wr-dock__toolbar">
            {#if !isMobile}
                <button
                    class="b3-button b3-button--small"
                    disabled={!!syncOptions}
                    on:click={() => openSync({})}
                >
                    {t.syncAll}
                </button>
                <button
                    class="b3-button b3-button--small"
                    disabled={!!syncOptions}
                    on:click={() => openSync({ quick: true })}
                >
                    {t.quickSync}
                </button>
            {/if}
            <button class="b3-button b3-button--small" on:click={refreshShelf}>{t.refresh}</button>
            <button class="b3-button b3-button--small" on:click={() => plugin.openSetting()}>
                {t.settings}
            </button>
            <button class="b3-button b3-button--small" on:click={logout}>{i18n.login.logout}</button>
        </div>

        {#if isMobile}
            <div class="wr-dock__tip">{t.mobileReadonly}</div>
        {/if}

        <div class="wr-dock__body">
            <BookList
                {books}
                {i18n}
                {isMobile}
                {coverMap}
                {syncingIds}
                bind:keyword
                onSync={syncOneBook}
                onOpen={openBookDoc}
            />
        </div>
    {/if}

    {#if syncOptions}
        <SyncDialog {i18n} {engine} options={syncOptions} onClose={onSyncDone} />
    {/if}
</div>

<style>
    .wr-dock {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }
    .wr-dock__toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }
    .wr-dock__tip {
        padding: 6px 12px;
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        background: var(--b3-theme-surface);
    }
    .wr-dock__body {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
    }
</style>
