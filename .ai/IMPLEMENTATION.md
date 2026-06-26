# 实现记录 — 自动更新功能（v0.3.6）

执行范围：Task 1–8（代码 + 测试）+ Task 9（仅文档）。按用户决定，不新建分支、不递增版本号、不打包发布。测试采用 mock 数据，不依赖真实 GitHub Release。

## 完成的任务

- [x] Task 1: 隐藏设置窗口默认菜单栏 — `autoHideMenuBar: true` + `setMenuBarVisibility(false)`
- [x] Task 2: 增加 `autoUpdate` 配置结构 — 归一化、`config.example.json` 默认值、settings.js cloneConfig
- [x] Task 3: GitHub Release 检查逻辑 — 新模块 `src/updater.js`（semver 比较、asset 匹配、结构化结果）
- [x] Task 4: 安装包下载与进度 — `updater.js#downloadAsset` 写 `.part` 完成后 rename，进度推送
- [x] Task 5: 启动安装程序 — `shell.openPath` 启动 NSIS exe，失败展示错误后退出
- [x] Task 6: 设置页「关于与更新」页面 — sidebar 底部导航项，右侧视图切换，进度条/版本/开关 UI
- [x] Task 7: 启动时自动检查 — `maybeAutoCheckOnStartup`，仅 silent 提示，不下载不安装
- [x] Task 8: 测试截图覆盖 — `--update` mock 模式 + 断言，smoke-test 增加 updater 纯逻辑断言
- [x] Task 9: README 中英文文档更新（不含发布）

## 修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/main.js` | 菜单隐藏；updater 编排（check/download/install/状态推送/启动检查）；`updater:*` IPC 注册 |
| `src/updater.js` | **新增**：纯逻辑更新模块（版本解析/比较、asset 匹配、buildUpdateResult、fetchLatestRelease、downloadAsset） |
| `src/preload.js` | 暴露 `onUpdaterState` / `checkForUpdates` / `downloadUpdate` / `installUpdate` / `getUpdaterState` |
| `src/config-store.js` | `normalizeAutoUpdate` + `normalizeConfig` 增加 `autoUpdate` |
| `src/settings/settings.js` | `state.view`/`updater`；`renderUpdatePage`；更新页事件绑定；`updater:state` 订阅；`cloneConfig` 带 autoUpdate |
| `src/settings/settings.css` | sidebar 导航项、nav badge、更新页布局/进度条/版本卡片/开关样式 |
| `config.example.json` | 增加 `autoUpdate: { enabled: true }` |
| `scripts/capture-settings.js` | `--update` mock 模式（mock updater IPC + 断言更新页渲染） |
| `scripts/smoke-test.js` | updater 纯逻辑断言 + autoUpdate 归一化断言 |
| `package.json` | check 脚本加入 `updater.js`；新增 `screenshot:settings:update` 脚本 |
| `README.md` / `README_EN.md` | 更新使用说明 + 安全说明（中英文） |

## 测试结果

- [x] `npm run check` — 通过（含 updater.js）
- [x] `npm run smoke` — 通过（含 updater 纯逻辑 + autoUpdate 断言）
- [x] `npm run smoke:electron` — 通过
- [x] `npm run screenshot:settings` — 通过
- [x] `npm run screenshot:settings:templates` — 通过（带可见性断言）
- [x] `npm run screenshot:settings:update` — 通过（mock「有更新可用」状态，断言版本号与按钮渲染）

## 设计要点

- **纯逻辑分离**：updater.js 是无 Electron 依赖的纯逻辑模块，可被 smoke-test 直接 require 测试，也可被 capture 脚本 mock，无需真实网络。
- **状态机**：updater 有 7 个状态（idle/checking/available/latest/downloading/ready/error），UI 按状态展示对应主操作按钮。
- **防重复**：`updateCheckInFlight` / `downloadInFlight` 防止并发触发；检查中/下载中按钮禁用。
- **下载安全**：先写 `.part` 临时文件，完成且非空后 rename 为 `.exe`，避免半成品被误当安装包。
- **自动检查只提示**：`maybeAutoCheckOnStartup` 用 `silent: true`，只填充状态供设置页查看，绝不触发下载。
- **mock 测试**：`capture-settings.js --update` 注入固定的 mock updater 状态，并断言更新页 DOM 含版本号与下载按钮，避免静默失败。

## 验收标准对照（ACCEPTANCE.md）

功能/UI/测试验收项均已在 mock 环境验证通过。**发布验收项**（版本递增、上传 GitHub Release、SHA256）按用户决定**本次不执行**——待仓库有真实 Release 资产后可连真实流程验证下载/安装。

## 备注

- 仓库 `bubble0462/coding-plan-bar` 当前搜不到公开 Release，因此 Task 3/4/5 的下载与安装链路用 mock 验证 UI；真实 GitHub API 请求逻辑已按规格实现，接入真实 Release 后即可端到端跑通。
- 未改动 `providers.js` / `layout.js` / `renderer/`，业务逻辑零影响。
