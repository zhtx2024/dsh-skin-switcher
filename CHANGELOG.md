# Changelog

本文件记录 dsh-skin-switcher 的用户可见变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.0] - 2026-08-19

### 新增

- 适配皮肤中心 v2 资产引擎（`@linxin666/dsh-client-ui-skin-center` >= 0.2.x）：发现其内置 `skins/` 与用户目录 `~/.dsh/skins`（`DSH_SKINS_HOME` 可覆盖）中的 v2 皮肤（`skinManifestVersion: 2`），皮肤页恢复列出全部内置皮肤
- v2 世界不再禁用皮肤中心：v2 中心是资产引擎（读写 `~/.dsh/skin-center-active.json`，不写 patch），与切换器不再冲突——切换器写激活文件，中心在每次页面加载时应用
- 同 id 的旧版皮肤包与 v2 资产合并为一条：以 v2 资产为准，旧 wiring 行恒保持禁用，两套机制不叠加
- 启动时一次性迁移：旧版活跃皮肤若存在 v2 孪生，自动迁移到 v2 激活文件；旧版写下的 `web-ui-skin-center disabled: true` 行自动解除

### 修复

- 无皮肤中心引擎时不再发现或展示用户目录的 v2 资产（没有引擎应用的资产不可切换，避免静默失效）

## [0.3.2] - 2026-08-18

### 修复

- 管理段不再禁用未组合的皮肤行：只对 bundle-wired 或 bundle patch 已插入的皮肤行写 `disabled: true`。此前对所有已安装皮肤写禁用行，未组合的皮肤（如 dsh-skins 载体内的皮肤）会产生 "entry ui-skin-* not found" 警告

## [0.3.1] - 2026-08-18

### 修复

- 皮肤中心禁用行 id 不再硬编码 `ui-skin-center`：改为扫描 profile 的 bundle patch，禁用所有指向 `dsh-client-ui-skin-center` 包的行。dsh-web-ui 0.1.20 起聚合行改名 `web-ui-skin-center`，旧写法会失效（皮肤中心保持启用）并产生 "entry ui-skin-center not found" 警告；发现失败时回退到旧 id 兜底

## [0.3.0] - 2026-08-17

### 修复

- 状态接口响应显式声明 `Cache-Control: no-store`，客户端轮询请求加 `cache: "no-store"`，避免浏览器或中间层缓存旧皮肤状态导致切换后状态页与实际不符
- 激活皮肤 id 的 `ui-skin-` 前缀剥离改用 `.slice('ui-skin-'.length)`：此前 `.replace()` 只替换首次出现，皮肤 id 本身以 `ui-skin-` 开头时会残留前缀导致状态判定错误

### 工程

- 新增 GitHub Actions CI（`node --check` 语法检查 + `npm pack --dry-run` 打包验证）
- 新增 `docs/architecture.md`（数据流 / 关键决策 / API 协议 / 皮肤形态）、`CONTRIBUTING.md` 与 issue/PR 模板
- `package.json` 补齐 `engines`（node >=18）、`bugs`、`homepage` 与 `scripts`（check / prepack）

## [0.2.1] - 2026-08-14

### 新增

- 设置面板「皮肤」导航项显示调色板图标：官方设置壳按 section id 硬编码导航图标、未知 id 一律兜底成齿轮，本版本用 body 级 DOM 观察器给「皮肤」导航单元打上 `data-ssw-nav` 标记，再以 CSS mask 绘制调色板图标（`currentColor` 着色，自动适配明暗主题）

## [0.2.0] - 2026-08-14

### 新增

- 统一管理全部已安装皮肤：除直接安装的 `dsh-client-ui-skin-*` 皮肤包外，还发现 dsh-web-ui 聚合包内置的 `dsh-skins/skins/*` 载体目录（qq98 / ths / xp / minecraft / blue-fantasy / whale-song / trading / dragon-heir / miku 等），无需逐个 npm 安装即可切换
- 自动禁用 dsh-web-ui 自带的皮肤中心（`ui-skin-center`），保证本插件是唯一的管理权威，避免两个管理器写入冲突的配置

### 修复

- 空 managed section 写成合法 YAML 数组 `[]` 而非裸文本，修复无皮肤时整个 patch 文件不再是顶层数组、DSH 配置热重载报错的问题
- 每次写入前清理 managed section 之外的残留裸 `[]` 与多余 YAML 文档标记（`---`），修复双文档 YAML 导致热重载失败的问题

## [0.1.0] - 2026-08-14

### 新增

- 首个版本：设置面板新增「皮肤」页，列出所有已安装皮肤，提供一键切换与「恢复默认」
- 切换写入 `~/.dsh/cordis.patch.yml` 的 managed section（原子重写），DSH 配置监视器数秒内热重载，无需重启服务器
- 支持任意 npm scope 下名字匹配 `dsh-client-ui-skin-*` 的皮肤包（如 `@dsh-external/dsh-client-ui-skin-maid-atelier`）

[0.4.0]: https://github.com/zhtx2024/dsh-skin-switcher/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/zhtx2024/dsh-skin-switcher/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/zhtx2024/dsh-skin-switcher/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/zhtx2024/dsh-skin-switcher/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/zhtx2024/dsh-skin-switcher/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zhtx2024/dsh-skin-switcher/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zhtx2024/dsh-skin-switcher/releases/tag/v0.1.0
