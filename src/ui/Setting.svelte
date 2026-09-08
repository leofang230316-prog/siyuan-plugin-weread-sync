<script lang="ts">
    import { onMount } from "svelte";
    import { Dialog } from "siyuan";
    import * as siyuan from "@/api/siyuan";
    import LoginPanel from "./LoginPanel.svelte";
    import { DONATE_QR_DATA_URL } from "@/assets/donate";

    export let i18n: any;
    export let store: any;
    export let auth: any;
    export let onSaved: () => void = () => {};

    let settings = { ...store.getSettings() };
    let notebooks: any[] = [];
    let msg = "";
    let slashText = (settings.slashTriggers || []).join(",");
    let loggedIn = auth.isLoggedIn();

    const t = i18n.setting;

    onMount(async () => {
        notebooks = await siyuan.lsNotebooks();
    });

    function flash(text: string) {
        msg = text;
        setTimeout(() => (msg = ""), 2500);
    }

    async function save() {
        settings.slashTriggers = slashText
            .split(",")
            .map((s) => s.trim())
            .filter((s) => !!s);
        await store.saveSettings(settings);
        flash(t.saved);
        onSaved?.();
    }

    function openLogin() {
        const dialog = new Dialog({
            title: i18n.login.title,
            content: `<div id="wereadLoginInSetting"></div>`,
            width: "320px",
        });
        new LoginPanel({
            target: dialog.element.querySelector("#wereadLoginInSetting"),
            props: {
                i18n,
                auth,
                onSuccess: () => {
                    loggedIn = true;
                    dialog.destroy();
                },
            },
        });
    }

    async function logout() {
        const ok = await store.__confirm?.(i18n.login.logoutConfirm);
        if (ok === false) return;
        await auth.logout();
        loggedIn = false;
    }

    async function resetState() {
        const ok = await store.__confirm?.(t.resetStateConfirm);
        if (ok === false) return;
        await store.resetState();
        flash(t.resetDone);
    }
</script>

<div class="wr-setting">
    <!-- 登录状态：在设置面板里也能直接登录/退出 -->
    <div class="wr-setting__card">
        <div class="wr-setting__row">
            <div>
                <div class="wr-setting__label">{i18n.login.title}</div>
                <div class="wr-setting__desc">
                    {loggedIn ? i18n.login.loggedIn : i18n.login.notLoggedIn}
                </div>
            </div>
            {#if loggedIn}
                <button class="b3-button b3-button--small" on:click={logout}>
                    {i18n.login.logout}
                </button>
            {:else}
                <button class="b3-button b3-button--primary b3-button--small" on:click={openLogin}>
                    {i18n.login.title}
                </button>
            {/if}
        </div>
    </div>

    <div class="wr-setting__item">
        <label class="wr-setting__label" for="wr-notebook">{t.notebook}</label>
        <select id="wr-notebook" class="b3-select" bind:value={settings.notebookId}>
            {#each notebooks as nb (nb.id)}
                <option value={nb.id}>{nb.name}</option>
            {/each}
        </select>
        <div class="wr-setting__desc">{t.notebookDesc}</div>
    </div>

    <div class="wr-setting__item">
        <label class="wr-setting__label" for="wr-range">{t.syncRange}</label>
        <select id="wr-range" class="b3-select" bind:value={settings.syncRange}>
            <option value="all">{t.rangeAll}</option>
            <option value="noted">{t.rangeNoted}</option>
        </select>
    </div>

    <div class="wr-setting__item">
        <div class="wr-setting__row">
            <span class="wr-setting__label">{t.autoSync}</span>
            <input type="checkbox" class="b3-switch" bind:checked={settings.autoSync} />
        </div>
        <div class="wr-setting__desc">{t.autoSyncDesc}</div>
    </div>

    <div class="wr-setting__item">
        <label class="wr-setting__label" for="wr-conc">{t.concurrency}</label>
        <input id="wr-conc" class="b3-text-field" type="number" min="1" max="5" bind:value={settings.concurrency} />
        <div class="wr-setting__desc">{t.concurrencyDesc}</div>
    </div>

    <div class="wr-setting__item">
        <label class="wr-setting__label" for="wr-int">{t.interval}</label>
        <input id="wr-int" class="b3-text-field" type="number" min="0" step="100" bind:value={settings.interval} />
        <div class="wr-setting__desc">{t.intervalDesc}</div>
    </div>

    <div class="wr-setting__item">
        <label class="wr-setting__label" for="wr-slash">{t.slash}</label>
        <input id="wr-slash" class="b3-text-field" type="text" bind:value={slashText} />
        <div class="wr-setting__desc">{t.slashDesc}</div>
    </div>

    <div class="wr-setting__item">
        <div class="wr-setting__row">
            <span class="wr-setting__label">{t.cover}</span>
            <input type="checkbox" class="b3-switch" bind:checked={settings.cacheCover} />
        </div>
        <div class="wr-setting__desc">{t.coverDesc}</div>
    </div>

    <div class="wr-setting__item">
        <button class="b3-button" on:click={resetState}>{t.resetState}</button>
        <div class="wr-setting__desc">{t.resetStateDesc}</div>
    </div>

    <div class="wr-donate">
        <img class="wr-donate__qr" src={DONATE_QR_DATA_URL} alt={t.donateQrAlt || "打赏码"} />
        <div class="wr-donate__note">{t.donateNote}</div>
        <div class="wr-donate__line">{t.donateAuthor}</div>
        <div class="wr-donate__line">
            {t.donateContact}
            <a href="mailto:{t.donateEmail}">{t.donateEmail}</a>
        </div>
    </div>

    <div class="wr-setting__actions">
        {#if msg}<span class="wr-setting__msg">{msg}</span>{/if}
        <button class="b3-button b3-button--primary" on:click={save}>{i18n.msg.ok}</button>
    </div>
</div>

<style>
    .wr-setting {
        padding: 16px;
        min-width: 380px;
    }
    .wr-setting__card {
        background: var(--b3-theme-surface);
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 16px;
    }
    .wr-setting__item {
        margin-bottom: 16px;
    }
    .wr-setting__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .wr-setting__row .wr-setting__label {
        margin-bottom: 0;
        flex: 1;
    }
    .wr-setting__label {
        display: block;
        font-size: 13px;
        color: var(--b3-theme-on-background);
        margin-bottom: 6px;
    }
    .wr-setting__desc {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        margin-top: 4px;
        line-height: 1.6;
    }
    .wr-setting__actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 20px;
    }
    .wr-setting__msg {
        font-size: 12px;
        color: var(--b3-theme-primary);
    }

    .wr-donate {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        text-align: center;
    }
    .wr-donate__qr {
        width: 180px;
        height: auto;
        border-radius: 10px;
        display: block;
    }
    .wr-donate__note {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        margin-top: 4px;
    }
    .wr-donate__line {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .wr-donate__line a {
        color: var(--b3-theme-primary);
        text-decoration: none;
    }
    .wr-donate__line a:hover {
        text-decoration: underline;
    }
</style>
