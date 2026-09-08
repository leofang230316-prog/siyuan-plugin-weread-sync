# 项目长期约定：siyuan-plugin-weread-sync

思源笔记插件，同步微信读书书籍与笔记到思源。目标思源版本 v3.8.1，minAppVersion 3.0.0。技术栈 vite + Svelte + TypeScript。

## 技术红线（违反即打回）

1. **禁止在插件中直接 fetch 外部域名**。所有外部请求必须经 `src/api/forward.ts` 封装，统一走思源内核 `POST /api/network/forwardProxy`。该接口由 Go 后端发出请求，天然规避 CORS，且能读取响应头 Set-Cookie、支持 base64 接收二进制。
2. **禁止直接调用 fs / Electron / Node.js API 读写 data 目录**，一律走内核 API（`/api/file/*`）。这是思源集市硬性开发规范，违反会在多端同步时造成数据丢失。
3. **禁止使用 `/api/storage/setLocalStorage`**，该端点 2026-12-01 后删除，改用 `/api/storage/setLocalStorageVal`。
4. **禁止使用 `/api/network/forwardProxy` 以外的任何方式获取登录凭证**。凭证通过响应头 Set-Cookie 提取，禁止写入日志与文档属性，UI 展示须脱敏。

## 源码核对须知

- `raw.githubusercontent.com` 在本机连不通（HTTP 000）。查思源源源码需走 `https://api.github.com/repos/siyuan-note/siyuan/contents/<path>` 取 base64 再用 python 解码。
- `addTopBar` 的 position 可选值为 `"south" | "left"`，网上文档中的 `"right"` 是错的。
- **i18n 文件（zh_CN.json / en_US.json）必须是合法 JSON！** 内核 `model/plugin.go` 的 `loadCode` 用 `gulu.JSON.UnmarshalJSON(data, &petal.I18n)` 直接解析，**一旦某语言文件 JSON 语法错误（如漏逗号），整个 `petal.I18n` 就保持为空 map**，`this.i18n` 成 `{}`，所有 `i18n.login`/`i18n.setting`/`i18n.pluginName` 全部 undefined → 顶栏名字不显示、Dock/设置面板初始化即崩。**（v1.0.7 真实根因：zh_CN.json 第 119 行 `coverDesc` 漏逗号）** 每次改完 i18n 务必用 `node -e "JSON.parse(...)"` 校验。
- **`plugin.json` 的 `i18n` 字段对内核加载语言文件没用**：内核不看它，直接读 `i18n/` 目录下 `.json` 按 `Conf.Lang`→`en`→`zh-CN` + 下划线 legacy 文件名回退匹配。该字段仅用于集市展示，保留无害但别指望它解决加载问题。
- 思源**不展平**嵌套 i18n：嵌套 JSON 原样解析为嵌套对象，`this.i18n.login.title` 可用。
- 界面元素（`addTopBar`/`addDock`/`addCommand`/`protyleSlash`）放在 `onLayoutReady()` 注册是更稳妥的做法（等布局就绪），但不是 i18n 问题的根因。
- **构建前先 `rm -rf dist package.zip` 再 `npm run build`**：`vite-plugin-static-copy` 覆盖 `dist/README.md` 时会走 safe-delete（回收站），Windows 上可能报 `[safe-delete] 操作失败: Error during a trash operation`；先把 dist 删空（用 `rm` 不走回收站）让它是新建文件，就不会触发 trash。`package.zip` 被占用时同样先 `rm -f`。
- **Bash 工具偶发不回显长命令输出**（返回 `Tool ran without output or errors`），但命令其实执行成功了——判断结果要看产物时间戳，不要只看回显。
- **本机思源工作空间路径**：`D:\siyuan-data`（代码装在 `D:\siyuan-data\data\plugins\siyuan-plugin-weread-sync\`，运行数据在 `D:\siyuan-data\data\storage\petal\siyuan-plugin-weread-sync\`）。本地安装包位于 `D:\app\微信读书插件\package.zip`。手动覆盖安装时只动 `data/plugins` 代码目录，勿动 `data/storage/petal` 运行数据（含登录凭证/设置/书架缓存）。
- **安装方式二选一**：(1) 思源打开 → 设置 → 关于 → 插件 → 本地安装 → 选 `package.zip`（已装过先卸载）；(2) 关闭思源 → 把 `package.zip` 解压覆盖到 `data/plugins/siyuan-plugin-weread-sync\` → 重开思源。

## 产品核心（不可妥协）

本插件相对停更竞品 siyuan-plugin-weread 的核心差异化是**保护用户在思源侧的二次创作**：增量追加 + 三方比对，本地编辑零覆盖；冲突双版本共存各带时间戳；远端删除本地保留只打标识。任何"为简化实现而改为覆盖式更新"的提议都应拒绝。

同步合并以微信读书笔记 ID（`weread-bmid` 块属性）为锚点，块 ID 一经生成永不变更，确保已有块引用不失效。

## 思源端稳定性约束

- **同步必须顺序处理书籍**：思源 SQLite 对并发写入敏感，多本书同时 `createDocWithMd` / `appendBlock` / `insertBlock` 容易触发 `transaction panic: runtime error: invalid memory address or nil pointer dereference`。v1.0.5 起取消并发 worker pool，单本书内部也顺序插入块。
- 所有块操作前须校验 ID 非空、内容非空，禁止向内核提交空 markdown 或空 ID。
- **⚠️ `fetchSyncPost` 返回的是完整响应 `{code, msg, data}`，块操作结果在 `res.data`**（v1.1.1 真实根因）。`pickBlockIds` 曾误写 `res?.doOperations`，导致 insertBlock/appendBlock **永远取不到块 ID** → 没写 `weread-bmid` 属性 → 斜杠搜索搜不到笔记、增量合并失效、统计恒为 0。写新 API 封装时先确认返回值层级，别把 `res` 和 `res.data` 搞混（`createDocWithMd` 返回 `res?.data` 是对的，块操作类同样要先取 `data`）。
- **⚠️ 禁止把大 base64 / data URL 塞进提交给内核的 markdown**（v1.0.9 真实根因）：实测单张封面 base64 达 **17 万字符**（128KB 图片），`createDocWithMd` / `insertBlock` 提交这种 markdown 会直接触发 `transaction panic: nil pointer dereference`。**封面一律用 https URL 引用**（`![cover](https://...)`），并用文档属性 `title-img` 设为题头图；要本地化就先 `putFile` 存成 assets 再引用相对路径，绝不内嵌 base64。
- **日志系统**：`src/core/logger.ts` 记录每次内核 API 调用的参数摘要（只记长度）、耗时、返回码；`src/api/siyuan.ts` 的 `post()` 已埋点。同步崩溃时用命令「查看同步日志」复制最后几十行即可定位现场。
- **⚠️ 不要用 `/api/query/sql` 查 `attributes` 表检索自定义块属性**（v1.2.0 真实根因）。块属性存在思源 `.sy` 文件里，`setBlockAttrs` 返回 code=0 且 `getBlockAttrs` 能读到，但 SQL 的 `attributes` 是**索引表**，未刷新时查询恒为空 → 表现为"搜不到笔记"。**检索笔记一律走插件自己的同步状态（sync-state.json）**，别依赖 SQL 索引。
- **查思源数据状态用内核 API 而非直接读 sqlite**：token 在 `{workspace}/conf/conf.json` 的 `api.token`，端口默认 6806，`POST /api/query/sql` 带 `Authorization: Token xxx`。直接读 `temp/siyuan.db` 会因 WAL 模式读到旧快照（复制 db+wal 还容易损坏）。
- 注意：python（Windows 原生）不认 Git Bash 的 `/d/xxx` 路径，要写 `D:/xxx`。

## 微信读书接口现状（2026-08-29 实测确认，非网络资料推测）

登录（域 `https://weread.qq.com`）：
- `GET /api/auth/getLoginUid` → `{"uid":"<uuid>"}`（旧的 `/web/login/getuid` 已 404）
- `GET /api/auth/getLoginInfo?uid=<uid>&otp=` → **长轮询，实测约 55 秒**后服务端主动返回 `{"succeed":false,"logicCode":"LOGIN_TIMEOUT","canRetry":false}`。成功返回 `{succeed:true, accessToken, webLoginVid}`，`accessToken` 即 `wr_skey`、`webLoginVid` 即 `wr_vid`
- **二维码寿命只有约 55 秒，且过期后 canRetry=false，该 uid 作废必须换新**。因此登录流程必须在收到 expired 后**自动重新获取 uid 并刷新二维码**，不能把 expired 当终态——否则用户根本来不及扫。官方前端（`BVQc4ULa.js`）同样用 `timeout: 6e4` 且 `LOGIN_TIMEOUT → EXPIRED`
- `logicCode` 分支（与官方前端 switch 一一对应）：`LOGIN_TIMEOUT`→作废换码；`NEED_OTP`→弹验证码输入框，填完用 `otp` 参数重发轮询；`OTP_EXPIRED`/`OTP_NOT_MATCH`→清输入重填；`SCANNED`→已扫待确认
- 二维码内容：`https://weread.qq.com/web/confirm?uid=<uid>`
- 登录后官方前端还会调 `GET /api/userInfo?userVid=<vid>`（web 域）取昵称，可用于界面展示
- **无 token 续期接口**，凭证过期只能重新扫码

数据（域 `https://weread.qq.com`，2026-08-29 起迁移到 web 端点）：
- 书架：`GET /web/shelf/sync`（JSON），失败可兜底解析 `/web/shelf` 的 `window.INITIAL_STATE`
- 有笔记的书：`GET /api/user/notebook`（注意单数）
- 书籍详情：`GET /api/book/info`
- 章节目录：`POST /web/book/chapterInfos`，请求体 `{bookIds:[bookId]}`（不要传 `synckeys`）
- 划线：`GET /web/book/bookmarklist?bookId=...`，返回 `updated` 数组，元素字段 `markText`
- 想法：`GET /web/review/list?bookId=...&listType=4&maxIdx=0&count=0&listMode=2&syncKey=0`，返回 `reviews` 数组，元素多为 `{review:{...}}`，使用字段 `content`
- 阅读进度：`GET /web/book/getProgress?bookId=...`
- **旧域 `https://i.weread.qq.com` 已不可用**：网页扫码拿到的 `wr_skey` 会返回 401，该域现在要求移动端 skey。
- web 域接口即使 HTTP 200 也可能返回 `{errCode, errMsg}` 或 `{errcode, errmsg}`，需按业务错误处理。
- 封面图下载需带 `Referer: https://weread.qq.com/web/shelf`。
- 思源 `/api/file/putFile` 对文件要求 multipart 表单（字段 `file`），插件内 `fetchSyncPost` 走 JSON，不能直接传 base64；如需持久化封面应使用 data URL 嵌入文档，或改用原生 `fetch` 构造 `FormData`。

排查变更的方法：拉首页 HTML → 提取 Nuxt JS 地址 → 下载 JS 正则搜 `/api/...` 字符串 → 用 urllib 直接实测。比开浏览器抓包快得多，不需要 Playwright/Chromium。
**注意（2026-08-29）**：Nuxt JS 已迁到 `https://cdn.weread.qq.com/web/wrweb-next/_nuxt/*.js`，是绝对地址，不再是同域 `/_nuxt/`。登录逻辑在 `BVQc4ULa.js`（现代包）与 `BZ6SsvaW-legacy.js`（legacy 包），两者内容一致。脚本见 `scripts/fetch_login_js.py`。旧数据接口迁移后，如发现新端点结构变化，同样用此脚本快速定位。

### 凭证有效期与笔记接口实测状态（2026-09-07 实测）

- **web 端 skey 有效期很短**：8-29 21:50 写入的 `credential.json`，到 9-07 实测 `web/shelf/sync` 返回 `-2012 登录超时`、`api/user/notebook` 返回 401。**每次实测接口前先看 `credential.json` 的 mtime**，过期必须重新扫码；不要把旧凭证的失败结果误判为接口 bug。
- **章节接口已验证可用**：`sync-state.json`（8-29 23:01 写入）显示每本书 `chapters` 都有真实章节名（如「17 三体问题」），证明 `POST /web/book/chapterInfos` 正常且解析正确。
- **想法接口 `GET /web/review/list` 已实测可用**：`listType=4` 才返回「我的想法」——字段 `abstract`=引用原文、`content`=想法正文、`reviewId`、`chapterUid`、`chapterName`/`chapterTitle`、`createTime`。实测 `43830871` 得 3 条、`25926862` 得 6 条。**`listType=5` 返回 `type=3` 且 content 为纯数字的热度数据（不是笔记）；2/3 是全站热门；0/1/6 无效。**
- **划线接口 `GET /web/book/bookmarklist` 已废弃**：对每本书都返回 HTTP 200 + 空对象 `{}`，穷举 `syncKey`/`count`/`maxIdx`/`mine`/大小写变体/POST 全部一样空，其它路径 404。前端 JS 里的 `bookMarks.items`（`markText`/`bookmarkId`）是**书籍详情页的热门划线**，不是用户自己的。→ **纯划线拿不到（接口侧限制）**；想法自带 `abstract`（引用原文），所以「划线+想法」类笔记不受影响。
- `notebook` 的 `reviewCount`/`bookmarkCount` 与实际条数可能不符（如 `718151` 标 rv=2 但查得 0），别拿它当准。
- `/` 斜杠插不了笔记是连带症状：笔记块根本没写入思源 → 搜不到带 `weread-bmid` 的块 → 搜索无结果。

### 本地实测脚本（scripts/）

- `weread_auto.mjs`：全自动登录（取 uid → 生成二维码 PNG → 轮询 → 写凭证 → 抓接口）。依赖 `qrcode`，用 `npm install qrcode --no-save` 装（已装）。输出 `EVENT:QR / SUCCESS / FETCH_DONE / OTP / ERROR` 标记便于后台监听。
- `fetch_notes.mjs`：用现有凭证直连，打印各接口 top keys 与首条记录全字段（诊断解析用）。
- `watch_and_fetch.mjs`：**监听 `credential.json` 的 mtime**，用户在插件内扫码登录成功瞬间自动抓取全部接口并打印真实结构（30 分钟窗口）。
- **交互教训（重要）**：脚本生成的二维码只有 55 秒寿命，`present_files` 展示后很快失效，连续三次都因用户未及时扫码而超时（自动换码 5~6 次后退出）。**正确做法：让用户在插件 Dock 面板内扫码**（插件会像官方前端一样自动刷新二维码），配合 `watch_and_fetch.mjs` 监听凭证变化自动抓取，用户无需通知我。

## 当前可用版本与已知限制

**v1.2.0（2026-09-08）已由用户验证可用**：同步正常、笔记（原文+加粗想法）入库、封面为题头图、
`/weread` 与 `/读书` 可搜索并插入笔记。

遗留限制（均为**接口侧**，非插件缺陷，别再当成 bug 反复排查）：

1. **纯划线拿不到**：`GET /web/book/bookmarklist` 对所有书恒返回 `{}`，微信读书未开放。
   只有「划线 + 写了想法」的笔记才完整（想法里带 `abstract` 即被划线的原文）。
2. **凭证有效期只有数天**：无续期接口，过期必须重新扫码（`-2012 登录超时` / `401`）。
   排查"笔记为空"时，**先确认 `credential.json` 的 mtime** 再怀疑代码。

历史崩溃根因（都已修，别再走弯路）：
- v1.0.5~1.0.8 的 `transaction panic`：封面 17 万字符 base64 塞进 markdown。
- v1.0.9 的 panic：每本书开头 `Promise.all` 并发两个 forwardProxy。
- v1.1.1：`pickBlockIds` 误读 `res.doOperations`（应为 `res.data`），属性从未写入。
- v1.2.0：斜杠搜索走 SQL `attributes` 索引表（索引滞后恒为空），改读本地同步状态。

## 分发状态

按思源集市规范开发，但 **暂不上传集市，等待用户明确指令**（当前验证版本 v1.2.0）。仓库名与 plugin.json 的 name 必须一致且为 `siyuan-plugin-weread-sync`。
