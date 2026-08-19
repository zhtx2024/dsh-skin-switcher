# dsh-skin-switcher

DeepSeek Harness Web GUI 的皮肤切换插件：在设置界面新增「皮肤」页，列出所有已安装的皮肤并提供一键切换按钮，支持一键恢复官方默认外观。

## 特性

- **设置界面内切换**：官方设置面板新增「皮肤」页（`settings.section`），已安装皮肤自动列出，无需改代码
- **统一管理所有皮肤**：自动发现 profile 中所有 `dsh-client-ui-skin-*` 皮肤包（支持任意 npm scope，如 `@dsh-external/dsh-client-ui-skin-maid-atelier`），以及 dsh-web-ui 的 `dsh-skins` 聚合载体
- **支持皮肤中心 v2 资产引擎**（0.4.0+）：皮肤中心（`@linxin666/dsh-client-ui-skin-center` >= 0.2.x）内置的 `skins/` 与用户目录 `~/.dsh/skins`（`DSH_SKINS_HOME` 可覆盖）中的 v2 皮肤自动列出；切换写入 `~/.dsh/skin-center-active.json`，中心在页面加载时应用，无需 cordis 行
- **热切换，无需重启**：legacy 皮肤切换写入 `~/.dsh/cordis.patch.yml` 的 managed section（原子重写），DSH 配置监视器数秒内热重载，页面自动刷新生效
- **一键恢复默认**：「恢复默认」回到官方原版外观
- **升级不丢外观**：启动时自动把旧版活跃皮肤迁移到 v2 激活文件（存在 v2 孪生时），并解除旧版写下的皮肤中心禁用行
- **单一管理权威（仅旧版中心）**：legacy 皮肤中心（< 0.2，写 patch 的竞争者，行 id 自动从 bundle patch 发现，兼容 `ui-skin-center` 与 `web-ui-skin-center`）自动禁用；v2 中心是资产引擎，不会被禁用

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add dsh-skin-switcher
```

### 从 GitHub 仓库安装（改代码调试）

```sh
# 1. 克隆本仓库
git clone https://github.com/zhtx2024/dsh-skin-switcher.git

# 2. 安装进 web profile
dsh plugin --profile web add link:<克隆路径>/dsh-skin-switcher
```

然后重启 `dsh web`（或依赖热重载），打开 设置 → 皮肤。

## 卸载

```sh
dsh plugin --profile web remove dsh-skin-switcher
```

卸载后如仍残留 `~/.dsh/cordis.patch.yml` 中的 managed section，可手动删除
`# --- dsh-skin-switcher managed ---` 与 `# --- end dsh-skin-switcher managed ---` 之间的内容。

## 工作原理

| 半 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | 挂载 `/api/skin-switcher/state` 与 `/api/skin-switcher/use` 路由；扫描 profile node_modules 发现皮肤（legacy 包 + v2 资产）；管理 boot patch 的 managed section 与 v2 激活文件 `~/.dsh/skin-center-active.json` |
| Browser | `lib/client.js` | 注册设置面板 `settings.section`「皮肤」页；切换后轮询 state 直至配置监视器确认，再刷新页面加载新的客户端插件图 |

### 皮肤切换协议

- **legacy 皮肤**：非激活皮肤 → 仅对「已组合」的皮肤写入 `- id: <wiringId>` + `disabled: true`（DSH 官方 loader patch 语法）：bundle-wired 的皮肤，或 bundle patch 已插入其行的皮肤；仅安装而未组合的皮肤不写行，避免 "entry not found" 警告
- 激活皮肤（bundle-wired，即其包名在 `dsh.profile.bundles` 中）→ 不写行，解除禁用即恢复
- 激活皮肤（未 bundle-wired，如 dsh-skins 载体中的皮肤）→ 自动在 profile node_modules 建链接并写入 `insert` 行
- **v2 资产皮肤**（中心引擎存在时）：激活 → 写入 `~/.dsh/skin-center-active.json` 的 `{"active": "<id>"}`，中心在每次页面加载时应用；同 id 存在旧版皮肤包时其 wiring 行恒保持禁用，两套机制不叠加
- 皮肤中心 → 旧版（< 0.2）从 profile bundle patch 中发现其实际行 id（如 `ui-skin-center` / `web-ui-skin-center`），恒定写入 `disabled: true`；v2 中心（>= 0.2，资产引擎）不写禁用行
- 恢复默认 → 清空激活文件（`{"active": null}`）并禁用所有 composed legacy 行
- managed section 恒为合法 YAML 数组（无行时写 `[]`），保证 patch 文件始终可被 DSH 解析

## 适配自己的皮肤

### legacy 皮肤包（cordis 插件形态）

皮肤包需满足：

1. 包名以 `dsh-client-ui-skin-` 开头
2. 根目录含 `skin.json`（字段：`id`、`package`、`wiring.id`，可选 `name`/`nameEn`/`author`/`tagline`/`description`/`wiring.bundleWired`）
3. 通过 `dsh plugin --profile web add <pkg>` 安装进 profile

### v2 资产皮肤（皮肤中心引擎形态）

皮肤目录需满足：

1. 目录内 `skin.json` 声明 `"skinManifestVersion": 2`，`id` 与目录名一致（`/^[a-z0-9-]+$/`）
2. 放进用户目录 `~/.dsh/skins/<id>/`（`DSH_SKINS_HOME` 可覆盖），或随皮肤中心包内置分发
3. 无需 cordis 行：切换器写激活文件，皮肤中心引擎应用

## 许可与致谢

皮肤切换的 patch 管理逻辑移植自
[zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 的
`dsh-skin` CLI / skin-center（BSD-3-Clause）。本插件同样以 BSD-3-Clause 发布，见 [LICENSE](LICENSE)。
