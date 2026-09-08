<script lang="ts">
    import { onDestroy } from "svelte";
    import qrcode from "qrcode-generator";
    import { QR_LIFETIME_MS } from "@/api/weread";

    export let i18n: any;
    export let auth: any;
    export let onSuccess: () => void;

    type PanelStatus =
        | "idle"
        | "waiting"
        | "scanned"
        | "otp"
        | "success"
        | "expired"
        | "failed";

    let qrHtml = "";
    let status: PanelStatus = "idle";
    let showCookie = false;
    let cookieText = "";
    let otpText = "";
    let errorMsg = "";
    let countdown = 0;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const t = i18n.login;

    function stopCountdown() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        countdown = 0;
    }

    /** 每次服务端下发新二维码时重新开始计时 */
    function startCountdown() {
        stopCountdown();
        countdown = Math.round(QR_LIFETIME_MS / 1000);
        timer = setInterval(() => {
            countdown = countdown > 0 ? countdown - 1 : 0;
        }, 1000);
    }

    function renderQR(content: string) {
        try {
            const qr = qrcode(0, "M");
            qr.addData(content);
            qr.make();
            qrHtml = qr.createSvgTag({ cellSize: 6, margin: 2 });
            startCountdown();
        } catch (e) {
            errorMsg = String(e?.message || e);
        }
    }

    async function start() {
        controller?.abort();
        controller = new AbortController();
        status = "waiting";
        errorMsg = "";
        otpText = "";
        showCookie = false;
        qrHtml = "";
        try {
            const cred = await auth.startQRLogin({
                onQR: (c: string) => renderQR(c),
                onStatus: (s: any) => {
                    status = s;
                    if (s === "success") stopCountdown();
                },
                signal: controller.signal,
            });
            if (cred) {
                status = "success";
                stopCountdown();
                onSuccess?.();
            }
        } catch (e) {
            status = "failed";
            stopCountdown();
            errorMsg = String(e?.message || e);
        }
    }

    /** 用户填完验证码后提交，正在运行的轮询下一轮会带上它 */
    function submitOtp() {
        const value = (otpText || "").trim();
        if (!value) return;
        auth.setOtp?.(value);
        errorMsg = "";
    }

    async function submitCookie() {
        const value = (cookieText || "").trim();
        if (!value) {
            errorMsg = t.cookieEmpty;
            return;
        }
        errorMsg = "";
        try {
            await auth.loginByCookie(value);
            status = "success";
            stopCountdown();
            onSuccess?.();
        } catch (e) {
            errorMsg = t.cookieInvalid;
        }
    }

    function statusText(s: PanelStatus): string {
        switch (s) {
            case "waiting":
                return t.waiting;
            case "scanned":
                return t.scanned;
            case "otp":
                return t.otp;
            case "success":
                return t.success;
            case "expired":
                return t.expired;
            case "failed":
                return t.failed;
            default:
                return "";
        }
    }

    onDestroy(() => {
        controller?.abort();
        stopCountdown();
    });
</script>

<div class="wr-login">
    {#if !showCookie}
        <div class="wr-login__title">{t.title}</div>

        {#if status === "idle"}
            <div class="wr-login__hint">{t.desc}</div>
            <button class="b3-button b3-button--primary" on:click={start}>{t.title}</button>
            <button class="wr-login__link" on:click={() => (showCookie = true)}>
                {t.cookieFallback}
            </button>
        {:else}
            <div class="wr-login__qr">
                {#if qrHtml}
                    {@html qrHtml}
                {:else}
                    <div class="wr-login__placeholder">{t.waiting}</div>
                {/if}
            </div>

            <div class="wr-login__status" class:wr-login__status--done={status === "success"}>
                {statusText(status)}
            </div>

            {#if status === "waiting" && countdown > 0}
                <div class="wr-login__countdown">
                    {t.qrCountdown.replace("{n}", String(countdown))}
                </div>
            {/if}

            {#if status === "otp"}
                <div class="wr-login__hint">{t.otpDesc}</div>
                <div class="wr-login__otp">
                    <input
                        class="b3-text-field"
                        type="text"
                        inputmode="numeric"
                        placeholder={t.otpPlaceholder}
                        bind:value={otpText}
                        on:keydown={(e) => e.key === "Enter" && submitOtp()}
                    />
                    <button class="b3-button b3-button--primary" on:click={submitOtp}>
                        {t.otpSubmit}
                    </button>
                </div>
            {/if}

            {#if status === "expired" || status === "failed" || status === "waiting"}
                <button class="b3-button" on:click={start}>{t.refreshTip}</button>
            {/if}

            {#if errorMsg}
                <div class="wr-login__error">{errorMsg}</div>
            {/if}

            {#if status !== "success"}
                <button class="wr-login__link" on:click={() => (showCookie = true)}>
                    {t.cookieFallback}
                </button>
            {/if}
        {/if}
    {:else}
        <div class="wr-login__title">{t.cookieTitle}</div>
        <div class="wr-login__hint">{t.cookieDesc}</div>
        <textarea
            class="b3-text-field wr-login__cookie"
            rows="5"
            placeholder={t.cookiePlaceholder}
            bind:value={cookieText}
        />
        {#if errorMsg}
            <div class="wr-login__error">{errorMsg}</div>
        {/if}
        <div class="wr-login__actions">
            <button class="b3-button b3-button--primary" on:click={submitCookie}>
                {t.cookieSubmit}
            </button>
            <button class="b3-button" on:click={() => (showCookie = false)}>{t.title}</button>
        </div>
    {/if}
</div>

<style>
    .wr-login {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 24px 16px;
        text-align: center;
    }
    .wr-login__title {
        font-size: 15px;
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }
    .wr-login__hint {
        font-size: 12px;
        line-height: 1.6;
        color: var(--b3-theme-on-surface);
        max-width: 260px;
    }
    .wr-login__qr {
        width: 200px;
        height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fff;
        border-radius: 8px;
        padding: 8px;
        box-sizing: border-box;
    }
    .wr-login__qr :global(svg) {
        width: 100%;
        height: 100%;
    }
    .wr-login__placeholder {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
    }
    .wr-login__status {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
    }
    .wr-login__status--done {
        color: var(--b3-theme-primary);
    }
    .wr-login__countdown {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        opacity: 0.7;
    }
    .wr-login__otp {
        display: flex;
        gap: 8px;
        width: 100%;
        max-width: 260px;
    }
    .wr-login__otp input {
        flex: 1;
        min-width: 0;
    }
    .wr-login__error {
        font-size: 12px;
        color: var(--b3-theme-error);
        max-width: 260px;
        word-break: break-all;
    }
    .wr-login__cookie {
        width: 100%;
        resize: vertical;
        font-family: var(--b3-font-family-code);
        font-size: 12px;
    }
    .wr-login__actions {
        display: flex;
        gap: 8px;
    }
    .wr-login__link {
        background: none;
        border: none;
        color: var(--b3-theme-primary);
        font-size: 12px;
        cursor: pointer;
        padding: 4px;
    }
    .wr-login__link:hover {
        text-decoration: underline;
    }
</style>
