# 贡献指南

感谢你考虑为 dsh-skin-switcher 做贡献！本插件没有构建步骤——`lib/` 下的两个文件就是全部源码，直接编辑即可。

## 开发环境

- Node.js ≥ 18（实际运行于 DSH 的宿主进程）
- 本机可用的 `dsh`（DeepSeek Harness CLI）

## 验证

```sh
npm run check       # node --check 两个 lib 入口 + 校验 cordis.patch.yml 顶层数组
npm pack --dry-run  # 确认发布包内容
```

端到端验证：

```sh
# 1. 以链接方式安装进 web profile
dsh plugin --profile web add link:<本仓库路径>

# 2. 重启 dsh web，打开 设置 → 皮肤
# 3. 切换皮肤，观察 ~/.dsh/cordis.patch.yml 的 managed section 与页面自动刷新
```

## 代码结构

| 文件 | 内容 |
|---|---|
| `lib/index.js` | host 半：路由、皮肤扫描、patch 管理（见 [docs/architecture.md](docs/architecture.md)） |
| `lib/client.js` | browser 半：设置面板「皮肤」页 UI、切换轮询 |
| `cordis.patch.yml` | bundle patch：把 `ui-skin-switcher` 插入 web 插件列表 |
| `scripts/verify-patch.mjs` | 发布前校验 patch 文件保持顶层 YAML 数组 |

## 提交规范

- 提交信息使用 Conventional Commits 风格（`feat:` / `fix:` / `docs:` / `chore:` / `ci:`）
- 每处行为变更同步更新 `CHANGELOG.md` 与 `docs/architecture.md`（若涉及设计决策）

## 发布流程

```sh
npm version patch      # 或 minor / major，自动打 tag
npm run check          # 发布前校验
npm publish            # 发布到 npm
git push && git push --tags
```

## 已知边界

- managed section 依赖 DSH 配置监视器热重载，切换后数秒内生效属预期
- Windows 下首次为皮肤建链接可能触发管理员/开发者模式提示（junction fallback 可绕开）
