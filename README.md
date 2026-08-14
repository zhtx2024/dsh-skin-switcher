# dsh-skin-switcher

DeepSeek Harness Web GUI 的皮肤切换插件：在设置界面新增「皮肤」页，列出所有已安装的皮肤并提供一键切换按钮，支持一键恢复官方默认外观。

## 特性

- **设置界面内切换**：官方设置面板新增「皮肤」页（`settings.section`），已安装皮肤自动列出，无需改代码
- **热切换，无需重启**：切换写入 `~/.dsh/cordis.patch.yml` 的 managed section（原子重写），DSH 配置监视器数秒内热重载，页面自动刷新生效
- **一键恢复默认**：「恢复默认」回到官方原版外观
- **自动发现**：扫描 web profile 中所有 `dsh-client-ui-skin-*` 皮肤包（支持任意 npm scope，如 `@dsh-external/dsh-client-ui-skin-maid-atelier`），新增皮肤即刻出现在列表
- **兼容 bundle-wired 皮肤**：经 `dsh plugin add` 安装（`dsh.profile.bundles`）的皮肤与 home-layer insert 皮肤都能正确切换

## 安装

```sh
# 1. 克隆本仓库
git clone https://github.com/<owner>/dsh-skin-switcher.git

# 2. 安装进 web profile
dsh plugin --profile web add link:<克隆路径>/dsh-skin-switcher
```

然后重启 `dsh web`（或依赖热重载），打开 设置 → 皮肤。

## 卸载

```sh
dsh plugin --profile web remove @dsh-local/dsh-skin-switcher
```

卸载后如仍残留 `~/.dsh/cordis.patch.yml` 中的 managed section，可手动删除
`# --- dsh-skin-switcher managed ---` 与 `# --- end dsh-skin-switcher managed ---` 之间的内容。

## 工作原理

| 半 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | 挂载 `/api/skin-switcher/state` 与 `/api/skin-switcher/use` 路由；扫描 `~/.dsh/profiles/web/node_modules` 发现皮肤；管理 boot patch 的 managed section |
| Browser | `lib/client.js` | 注册设置面板 `settings.section`「皮肤」页；切换后轮询 state 直至配置监视器确认，再刷新页面加载新的客户端插件图 |

### 皮肤切换协议

- 非激活皮肤 → 写入 `- id: <wiringId>` + `disabled: true`（DSH 官方 loader patch 语法）
- 激活皮肤（bundle-wired）→ 不写行，解除禁用即恢复
- 激活皮肤（未 bundle-wired）→ 写入 `insert` 行
- managed section 恒为合法 YAML 数组（无行时写 `[]`），保证 patch 文件始终可被 DSH 解析

## 适配自己的皮肤

皮肤包需满足：

1. 包名以 `dsh-client-ui-skin-` 开头
2. 根目录含 `skin.json`（字段：`id`、`package`、`wiring.id`，可选 `name`/`nameEn`/`author`/`tagline`/`description`/`wiring.bundleWired`）
3. 通过 `dsh plugin --profile web add <pkg>` 安装进 profile

## 许可与致谢

皮肤切换的 patch 管理逻辑移植自
[zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 的
`dsh-skin` CLI / skin-center（BSD-3-Clause）。本插件同样以 BSD-3-Clause 发布，见 [LICENSE](LICENSE)。
