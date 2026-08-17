# 架构：dsh-skin-switcher

皮肤切换器是一个「两半」插件：host 半运行在 DSH 服务器进程（Node），browser 半运行在 Web GUI。两半之间经同源 HTTP API（`/api/skin-switcher/*`）通信，不经过模型。

## 组件

| 半 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | 挂载 `/api/skin-switcher/state` 与 `/api/skin-switcher/use` 路由；扫描 profile 的 node_modules 发现皮肤；读写 boot patch 的 managed section |
| Browser | `lib/client.js` | 注册设置面板 `settings.section`「皮肤」页；切换后轮询 state 直至配置监视器确认，再刷新页面加载新的客户端插件图 |

## 数据流（切换一次皮肤）

1. 用户点击「使用」→ browser `POST /api/skin-switcher/use`，body 为 `{skin: "<id>"}` 或 `{official: true}`
2. host 校验目标在 registry 中；对非 bundle-wired 皮肤先 `ensureSymlink` 建立 profile node_modules 链接，再 `checkResolvable` 验证插件目录契约（package.json 名称 + host 入口存在）
3. host 重写 `~/.dsh/cordis.patch.yml`：`stripManaged` 去掉旧 managed section → `sanitizeOutside` 清理残留 → `renderManaged` 生成新 section → `writePatchAtomic` 原子替换
4. DSH 配置监视器检测到文件变化，数秒内热重载 patch
5. browser 端 `confirmActive` 以 300ms 间隔轮询 `/state`（预算 8s）直到 active 等于目标；成功后延迟 1.5s 刷新页面（给 HMR 监视器重放 patch 的时间），加载新的客户端插件图

## 关键设计决策

- **bundleWired 判定不信任 skin.json**：npm carrier（dsh-skins）打包的 skin.json 可能携带陈旧的 `wiring.bundleWired` 标志。真实判定来自 profile 的 `package.json` 里 `dsh.profile.bundles` 列表（`dsh plugin add` 的路径）——被列表引用的包由 bundle patch 层插入。bundle-wired 皮肤激活时 managed section 不写 insert 行，只要求不存在 disabled 行。
- **managed section 恒为合法 YAML 数组**：无行时写显式 `[]`。曾因空 section 使整个 patch 文件不再是顶层数组，DSH HMR 报错「must be a top-level YAML array」，热重载中断。
- **双文档 YAML 坑**：managed section 之外若残留裸 `[]` 或 `---`，patch 文件会被解析为多文档 YAML，HMR 同样失败。`sanitizeOutside` 在每次写入前清除这些残留。
- **单一管理权威**：`renderManaged` 恒定写入 `- id: ui-skin-center` + `disabled: true`（dsh-web-ui 的皮肤中心），避免两个管理器同时写同一个 patch 文件的冲突。
- **Windows junction fallback**：`symlinkSync` 在无开发者模式或非管理员权限下抛 `EPERM`/`EACCES`/`ENOSYS`，此时改建目录 junction（绝对目标）。清理陈旧 junction 必须用 `rmdirSync`（`unlink` 对目录 reparse point 抛 EPERM）。
- **原子写入**：`writePatchAtomic` 先写 `${patchPath}.tmp-${pid}` 再 rename 覆盖——崩溃不会留下半写的 boot patch，监视器永远只看到完整内容。
- **同源防护**：浏览器请求携带 `Sec-Fetch-Site`，值为 `cross-site` 一律 403；`Origin` 与请求 `Host` 不一致也 403。无这些头的请求（curl、Node http）放行——这是本地单用户工具，防线只针对跨站浏览器向量。
- **导航图标**：官方设置壳按 section id 硬编码导航图标、未知 id 兜底成齿轮。插件用 body 级 MutationObserver（`childList` + `subtree`）给「皮肤」导航单元打 `data-ssw-nav` 标记，CSS mask 绘制调色板图标；`currentColor` 着色使其自动适配明暗主题，观察器保证导航在账本/语言变化重渲染后仍带图标。

## API 协议

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/skin-switcher/state` | — | `{ok, active, skins: [{id, package, name, nameEn, author, tagline, description, bundleWired}]}` |
| POST | `/api/skin-switcher/use` | `{skin: "<id>"}` 或 `{official: true}` | `{ok, active, message}` |

错误统一为 `{ok: false, error}`；405 方法不允许、403 跨站拒绝、400 参数/校验错误、500 host 异常。

## 兼容的皮肤包形态

1. **直接皮肤包**：任意 scope 下名字匹配 `/^dsh-client-ui-skin-[a-z0-9-]+$/` 且根目录含 `skin.json`
2. **载体皮肤**：聚合包的 `<scope>/dsh-skins/skins/<id>` 或 `dsh-skins/skins/<id>` 子目录（dsh-web-ui 的皮肤不按 npm 包名分发）

`skin.json` 必填字段：`id`（`/^[a-z0-9-]+$/`）、`package`、`wiring.id`；可选字段：`name`、`nameEn`、`author`、`tagline`、`description`、`wiring.bundleWired`（仅作参考，见上文）。

## 验证

- `npm run check`：语法检查两个 lib 入口（`node --check`）+ 校验 `cordis.patch.yml` 保持顶层数组
- `npm pack --dry-run`：确认发布包内容
- 本地端到端：`dsh plugin --profile web add link:<本仓库>` 后重启 `dsh web`，在 设置 → 皮肤 中切换并观察 `~/.dsh/cordis.patch.yml` 的 managed section
