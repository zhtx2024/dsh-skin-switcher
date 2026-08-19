# 架构：dsh-skin-switcher

皮肤切换器是一个「两半」插件：host 半运行在 DSH 服务器进程（Node），browser 半运行在 Web GUI。两半之间经同源 HTTP API（`/api/skin-switcher/*`）通信，不经过模型。

## 组件

| 半 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | 挂载 `/api/skin-switcher/state` 与 `/api/skin-switcher/use` 路由；扫描 profile 的 node_modules 发现皮肤（legacy 包 + v2 资产）；读写 boot patch 的 managed section 与 v2 激活文件 `~/.dsh/skin-center-active.json`；启动时执行一次性 v2 迁移 |
| Browser | `lib/client.js` | 注册设置面板 `settings.section`「皮肤」页；切换后轮询 state 直至配置监视器确认，再刷新页面加载新的客户端插件图 |

## 数据流（切换一次皮肤）

1. 用户点击「使用」→ browser `POST /api/skin-switcher/use`，body 为 `{skin: "<id>"}` 或 `{official: true}`
2. host 校验目标在 registry 中；对 legacy 非 bundle-wired 皮肤先 `ensureSymlink` 建立 profile node_modules 链接，再 `checkResolvable` 验证插件目录契约（package.json 名称 + host 入口存在）。v2 资产皮肤跳过此步（它们不是 cordis 包）
3. **v2 世界**（中心 >= 0.2 已安装）下：host 把激活选择原子写入 `~/.dsh/skin-center-active.json`（v2 皮肤写目标 id；legacy 皮肤或恢复默认写 `null`），中心在每次 index.html 响应时读取并应用
4. host 重写 `~/.dsh/cordis.patch.yml`：`stripManaged` 去掉旧 managed section → `sanitizeOutside` 清理残留 → `renderManaged` 生成新 section → `writePatchAtomic` 原子替换（v2 世界的 section 不再含中心禁用行）
5. DSH 配置监视器检测到文件变化，数秒内热重载 patch
6. browser 端 `confirmActive` 以 300ms 间隔轮询 `/state`（预算 8s）直到 active 等于目标；成功后延迟 1.5s 刷新页面（给 HMR 监视器重放 patch 的时间），加载新的客户端插件图

## 关键设计决策

- **bundleWired 判定不信任 skin.json**：npm carrier（dsh-skins）打包的 skin.json 可能携带陈旧的 `wiring.bundleWired` 标志。真实判定来自 profile 的 `package.json` 里 `dsh.profile.bundles` 列表（`dsh plugin add` 的路径）——被列表引用的包由 bundle patch 层插入。bundle-wired 皮肤激活时 managed section 不写 insert 行，只要求不存在 disabled 行。
- **managed section 恒为合法 YAML 数组**：无行时写显式 `[]`。曾因空 section 使整个 patch 文件不再是顶层数组，DSH HMR 报错「must be a top-level YAML array」，热重载中断。
- **双文档 YAML 坑**：managed section 之外若残留裸 `[]` 或 `---`，patch 文件会被解析为多文档 YAML，HMR 同样失败。`sanitizeOutside` 在每次写入前清除这些残留。
- **单一管理权威（仅 legacy 世界）**：`renderManaged` 在 legacy 世界恒定写入中心行 + `disabled: true`（dsh-web-ui 的皮肤中心，行 id 随聚合版本变化、从 bundle patch 动态发现），避免两个管理器同时写同一个 patch 文件的冲突。v2 世界例外见下。
- **v2 引擎判定**：中心包 `dsh-client-ui-skin-center` 的 package.json 版本 >= 0.2（major>0 或 major=0 且 minor>=2）即为 v2 资产引擎；版本不可读时以「内置 skins/ 下存在合法 v2 manifest」兜底。v2 引擎读写 `~/.dsh/skin-center-active.json`、不写 patch，因此**不**再禁用。
- **v2 世界渲染语义**：中心行保持启用（引擎）；同 id 有 v2 孪生的 legacy 行**恒定**禁用（v2 资产是唯一机制，两套不叠加）；legacy-only 条目按旧规则（active 且 bundle-wired → 无行；active 非 bundle-wired → insert 行；非 active 且 composed → disabled 行）；v2 条目永无 cordis 行。
- **激活文件写 null 语义**：切到 legacy 皮肤或恢复默认时写 `{"active": null}`，让中心应用默认外观，patch 机制接管剩余部分。文件只读时（缺中心、缺文件、id 未知）回落到 patch 判定。
- **孪生合并**：loadRegistry 对同 id 的 legacy 包 + v2 资产合并为一条 `kind: 'v2'` 条目，保留 `legacyWiringId`/`legacyBundleWired`/`legacyPkg` 供禁用旧行；用户目录条目在 builtin 之后收集、按 id 覆盖（与中心 catalog 的 shadow 规则一致）。
- **v2 发现门控**：v2 资产合并仅在 `isV2World(modulesDir)` 为真时执行——没有引擎时 v2 资产是惰性文件，列出可切换项会产生静默 no-op。
- **启动迁移**：`reconcileV2AtBoot`（apply 时）在 v2 世界做两件事：① 激活文件为空且存在活跃的 legacy 孪生皮肤时，把该 id 写入激活文件（升级不丢用户外观）；② 切换器已拥有 managed section 时按 v2 语义重渲染（解除旧版写下的 `web-ui-skin-center disabled: true`，禁用孪生行），仅当内容有变化才写入。
- **Windows junction fallback**：`symlinkSync` 在无开发者模式或非管理员权限下抛 `EPERM`/`EACCES`/`ENOSYS`，此时改建目录 junction（绝对目标）。清理陈旧 junction 必须用 `rmdirSync`（`unlink` 对目录 reparse point 抛 EPERM）。
- **原子写入**：`writePatchAtomic` 先写 `${patchPath}.tmp-${pid}` 再 rename 覆盖；v2 激活文件同法（`writeActiveSelectionAtomic`）——崩溃不会留下半写的 boot patch 或激活文档。
- **同源防护**：浏览器请求携带 `Sec-Fetch-Site`，值为 `cross-site` 一律 403；`Origin` 与请求 `Host` 不一致也 403。无这些头的请求（curl、Node http）放行——这是本地单用户工具，防线只针对跨站浏览器向量。
- **导航图标**：官方设置壳按 section id 硬编码导航图标、未知 id 兜底成齿轮。插件用 body 级 MutationObserver（`childList` + `subtree`）给「皮肤」导航单元打 `data-ssw-nav` 标记，CSS mask 绘制调色板图标；`currentColor` 着色使其自动适配明暗主题，观察器保证导航在账本/语言变化重渲染后仍带图标。

## API 协议

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/skin-switcher/state` | — | `{ok, active, skins: [{id, kind: 'legacy'\|'v2', package, source, name, nameEn, author, tagline, description, bundleWired}]}` |
| POST | `/api/skin-switcher/use` | `{skin: "<id>"}` 或 `{official: true}` | `{ok, active, message}` |

错误统一为 `{ok: false, error}`；405 方法不允许、403 跨站拒绝、400 参数/校验错误、500 host 异常。

## 兼容的皮肤包形态

1. **直接皮肤包（legacy）**：任意 scope 下名字匹配 `/^dsh-client-ui-skin-[a-z0-9-]+$/` 且根目录含 `skin.json`
2. **载体皮肤（legacy）**：聚合包的 `<scope>/dsh-skins/skins/<id>` 或 `dsh-skins/skins/<id>` 子目录（dsh-web-ui 的皮肤不按 npm 包名分发）
3. **v2 资产皮肤**：皮肤中心包内 `skins/<id>/`（builtin）或 `~/.dsh/skins/<id>/`（user，`DSH_SKINS_HOME` 覆盖）子目录，`skin.json` 声明 `skinManifestVersion: 2` 且 `id` 与目录名一致——无 cordis 包、无 wiring 行，激活走中心引擎

`skin.json`（v1）必填字段：`id`（`/^[a-z0-9-]+$/`）、`package`、`wiring.id`；可选字段：`name`、`nameEn`、`author`、`tagline`、`description`、`wiring.bundleWired`（仅作参考，见上文）。`skin.json`（v2）必填字段：`skinManifestVersion: 2`、`id`；可选：`name`、`nameEn`、`author`、`tagline`、`description` 等（与中心 catalog 校验规则一致）。

## 验证

- `npm run check`：语法检查两个 lib 入口（`node --check`）+ 校验 `cordis.patch.yml` 保持顶层数组 + 运行 `scripts/v2-smoke.mjs`（合成 ~/.dsh 树的功能冒烟：v2 发现/合并、启动迁移、双世界切换、legacy 回归，27 项断言）
- `npm pack --dry-run`：确认发布包内容
- 本地端到端：`dsh plugin --profile web add link:<本仓库>` 后重启 `dsh web`，在 设置 → 皮肤 中切换并观察 `~/.dsh/cordis.patch.yml` 的 managed section 与 `~/.dsh/skin-center-active.json`
