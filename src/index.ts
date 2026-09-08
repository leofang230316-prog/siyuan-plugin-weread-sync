import { Plugin, Dialog, showMessage, confirm } from "siyuan";
import * as siyuanApi from "siyuan";
import * as siyuan from "@/api/siyuan";
import { Store } from "@/core/store";
import { AuthService } from "@/core/auth";
import { SyncEngine } from "@/core/sync";
import Dock from "@/ui/Dock.svelte";
import SearchDialog from "@/ui/SearchDialog.svelte";
import SyncDialog from "@/ui/SyncDialog.svelte";
import Setting from "@/ui/Setting.svelte";

const openTab = (siyuanApi as any).openTab;

const DOCK_TYPE = "weread-dock";

const ICON = `<symbol id="iconWeread" viewBox="0 0 32 32">
    <path d="M16 8.2C13.4 6 9.7 4.8 5.6 4.8v18.6c4.1 0 7.8 1.2 10.4 3.4 2.6-2.2 6.3-3.4 10.4-3.4V4.8c-4.1 0-7.8 1.2-10.4 3.4z" fill="currentColor" opacity="0.85"/>
    <path d="M16 8.2v18.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M6.8 9.4h6.2M6.8 13h6.2M19 9.4h6.2M19 13h6.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/>
</symbol>`;

function confirmAsync(title: string, text: string): Promise<boolean> {
    return new Promise((resolve) => {
        confirm(title, text, () => resolve(true), () => resolve(false));
    });
}

export default class WereadSyncPlugin extends Plugin {
    /** 思源的 i18n 类型为 IObject（值均为 string），而我们的语言文件是嵌套结构 */
    declare i18n: any;
    private store: Store;
    private auth: AuthService;
    private engine: SyncEngine;
    private dockApp: any = null;
    private isMobile = false;
    private autoSyncTimer: number | null = null;
    private lastAutoSync = 0;

    async onload() {
        this.addIcons(ICON);

        this.store = new Store(this);
        this.auth = new AuthService(this.store);
        this.engine = new SyncEngine(this.store, this.auth);
        await this.store.load();

        this.isMobile = !!(window as any).siyuan?.mobile;


        // 供 UI 组件调用
        (this as any).__wereadConfirm = (msg: string) =>
            confirmAsync(this.i18n.pluginName || "WeRead", msg);
        (this.store as any).__confirm = (msg: string) =>
            confirmAsync(this.i18n.pluginName || "WeRead", msg);

        window.addEventListener("weread-open-doc", this.handleOpenDoc);
        this.scheduleAutoSync();

        // 后台异步校验登录态，不阻塞加载
        setTimeout(() => this.checkCredential(), 3000);
    }

    onLayoutReady() {
        // 思源界面完全加载后 i18n 已就绪，再注册顶栏/dock/命令
        this.registerTopBar();
        this.registerDock();
        this.registerCommands();
        this.registerSlash();
    }

    onunload() {
        this.dockApp?.$destroy();
        this.dockApp = null;
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
        }
        window.removeEventListener("weread-open-doc", this.handleOpenDoc);
    }

    // ------------------------------------------------------------ 注册

    private registerTopBar() {
        this.addTopBar({
            icon: "iconWeread",
            title: this.i18n.pluginName,
            position: "left",
            callback: () => this.openDock(),
        });
    }

    private registerDock() {
        const self = this;
        this.addDock({
            config: {
                position: "RightBottom",
                size: { width: 300, height: 0 },
                icon: "iconWeread",
                title: this.i18n.pluginName,
            },
            data: {},
            type: DOCK_TYPE,
            // 思源的 init 以 this 绑定 dock model，不通过参数传入
            init() {
                const element = (this as any).element;
                if (!element) return;
                self.dockApp = new Dock({
                    target: element,
                    props: {
                        plugin: self,
                        store: self.store,
                        auth: self.auth,
                        engine: self.engine,
                        i18n: self.i18n,
                        isMobile: self.isMobile,
                    },
                });
            },
            destroy() {
                self.dockApp?.$destroy();
                self.dockApp = null;
            },
        });
    }

    private registerCommands() {
        this.addCommand({
            langKey: "wereadSyncAll",
            langText: this.i18n.dock?.syncAll || "Sync all",
            hotkey: "",
            callback: () => this.runSync({}),
        });

        this.addCommand({
            langKey: "wereadQuickSync",
            langText: this.i18n.dock?.quickSync || "Quick sync",
            hotkey: "",
            callback: () => this.runSync({ quick: true }),
        });

        this.addCommand({
            langKey: "wereadSearch",
            langText: this.i18n.search?.title || "Insert note",
            hotkey: "",
            editorCallback: (protyle: any) => {
                const node = protyle?.protyle?.element?.querySelector(".protyle-wysiwyg--select");
                this.openSearch(protyle, node);
            },
        });
    }

    private registerSlash() {
        const triggers = this.store.getSettings().slashTriggers || [];
        if (!triggers.length) return;

        this.protyleSlash = triggers.map((trigger: string, index: number) => ({
            filter: [trigger],
            html: `<div class="b3-list-item__first">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconWeread"></use></svg>
    <span class="b3-list-item__text">${this.i18n.search?.title || "WeRead note"}</span>
</div>`,
            id: `weread-search-${index}`,
            callback: (protyle: any, nodeElement: HTMLElement) => {
                // slash 回调的 nodeElement 有时不是带 data-node-id 的块，兜底取当前选中块
                const el =
                    nodeElement ||
                    protyle?.protyle?.element?.querySelector(".protyle-wysiwyg--select");
                if (!el?.dataset?.nodeId) {
                    showMessage(this.i18n.dock?.insertFailed || "Insert failed", 4000, "error");
                    return;
                }
                this.openSearch(protyle, el as HTMLElement);
            },
        }));
    }

    // ------------------------------------------------------------ 交互

    openSetting() {
        const dialog = new Dialog({
            title: this.i18n.setting?.title || "Settings",
            content: `<div id="wereadSetting"></div>`,
            width: "520px",
        });
        new Setting({
            target: dialog.element.querySelector("#wereadSetting"),
            props: {
                i18n: this.i18n,
                store: this.store,
                auth: this.auth,
                onSaved: () => dialog.destroy(),
            },
        });
    }

    async runSync(options: any = {}) {
        const cred = this.store.getCred();
        if (!cred || !(await this.auth.ensureValid())) {
            const msg = cred
                ? this.i18n.login?.credExpired || "微信读书登录已过期，请重新扫码登录"
                : this.i18n.login?.notLoggedIn || "请先登录微信读书";
            showMessage(msg, 5000, "error");
            return;
        }

        const dialog = new Dialog({
            title: this.i18n.sync?.title || "Syncing",
            content: `<div id="wereadSync"></div>`,
            width: "480px",
        });

        new SyncDialog({
            target: dialog.element.querySelector("#wereadSync"),
            props: {
                i18n: this.i18n,
                engine: this.engine,
                options: { ...options, i18n: this.i18n },
                onClose: () => dialog.destroy(),
            },
        });
    }

    private openSearch(protyle: any, nodeElement: HTMLElement | null) {
        if (this.isMobile) return; // 移动端不支持插入
        if (!nodeElement?.dataset?.nodeId) {
            showMessage(this.i18n.dock?.insertFailed || "Insert failed", 4000, "error");
            return;
        }
        const dialog = new Dialog({
            title: this.i18n.search?.title || "Insert note",
            content: `<div id="wereadSearch"></div>`,
            width: "560px",
        });
        new SearchDialog({
            target: dialog.element.querySelector("#wereadSearch"),
            props: {
                i18n: this.i18n,
                store: this.store,
                nodeElement,
                onClose: () => dialog.destroy(),
            },
        });
    }

    private openDock() {
        if (openTab) {
            openTab({
                app: this.app,
                custom: {
                    id: this.name + DOCK_TYPE,
                    icon: "iconWeread",
                    title: this.i18n.pluginName,
                    data: {},
                },
            });
        }
    }

    private handleOpenDoc = (evt: any) => {
        const docId = evt?.detail?.docId;
        if (!docId || !openTab) return;
        openTab({ app: this.app, doc: { id: docId } });
    };

    // ------------------------------------------------------------ 后台任务

    private async checkCredential() {
        if (!this.store.getCred()) return;
        const ok = await this.auth.ensureValid();
        if (!ok) {
            showMessage(this.i18n.login?.credExpired || "Session expired", 6000, "error");
        }
    }

    private scheduleAutoSync() {
        if (!this.store.getSettings().autoSync) return;
        // 每 30 分钟检查一次，距上次同步超过 24 小时则执行
        this.autoSyncTimer = window.setInterval(
            async () => {
                const now = Date.now();
                if (now - this.lastAutoSync < 24 * 60 * 60 * 1000) return;
                this.lastAutoSync = now;
                try {
                    await this.engine.run({ i18n: this.i18n });
                } catch (e) {
                    console.error("[weread] auto sync failed", e);
                }
            },
            30 * 60 * 1000
        );
    }
}
