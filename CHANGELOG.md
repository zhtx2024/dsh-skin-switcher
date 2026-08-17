# Changelog

本文件记录 dsh-skin-switcher 的用户可见变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

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

[0.2.1]: https://github.com/zhtx2024/dsh-skin-switcher/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zhtx2024/dsh-skin-switcher/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zhtx2024/dsh-skin-switcher/releases/tag/v0.1.0
