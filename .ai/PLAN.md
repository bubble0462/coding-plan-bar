# 技术方案

## 需求概述

为 Coding Plan Bar 增加 GitHub Release 自动更新能力，并在设置窗口提供“检查更新 / 下载更新 / 启动安装”的图形化页面，同时隐藏设置窗口顶部默认的 `File / Edit / View / Window` 菜单栏。

## 技术方案

在 Electron 主进程中实现更新服务，使用 GitHub Releases API 获取 `bubble0462/coding-plan-bar` 的最新发布版本。主进程负责版本比较、下载安装包、下载进度、下载完成后启动安装程序；渲染进程只负责展示状态、触发检查/下载/安装。

设置页增加一个轻量“自动更新”视图，和现有供应商设置共用窗口，不引入新的独立窗口。保留手动检查按钮，配置项支持“启动时自动检查”，并写入现有 `config.json`。自动检查只提示，不静默安装，避免打断用户正在使用的软件。

隐藏默认菜单栏使用 Electron 窗口级设置：`settingsWindow.setMenuBarVisibility(false)`，并可配合 `autoHideMenuBar: true`。不影响托盘右键菜单。

## 影响范围

- `src/main.js`: 设置窗口菜单隐藏；更新 IPC；GitHub Release 检查、下载、安装启动逻辑；启动时自动检查。
- `src/preload.js`: 暴露 `updater:*` IPC 方法给设置页。
- `src/config-store.js`: 增加 `autoUpdate` 配置默认值、归一化和保存。
- `src/settings/settings.js`: 增加自动更新视图、状态机、按钮事件、进度展示。
- `src/settings/settings.css`: 增加更新页面布局、进度条、状态视觉。
- `config.example.json`: 增加默认自动更新配置。
- `scripts/*`: 如有必要，扩展设置页截图脚本覆盖更新页面。
- `package.json`: 如使用第三方库或调整版本号，需要同步更新。
- `README.md` / `README_EN.md`: 记录自动更新行为和权限说明。

## 风险点

- GitHub API 限流: 不带 token 的公开 API 有速率限制。缓解措施是只在启动时和手动触发时请求，并对失败给出可读错误。
- 版本比较错误: Release tag 可能是 `v0.3.6` 格式。缓解措施是实现简单 semver 解析，忽略前缀 `v`，并对非法 tag 降级为“无法判断”。
- 下载中断或文件损坏: 需要写入临时文件，下载完成后再重命名；安装前检查文件大小和扩展名。
- Windows 安装器启动失败: 使用 `shell.openPath()` 或 `child_process.spawn()` 启动 exe，并把失败原因展示在设置页。
- 正在运行的应用覆盖安装: NSIS 安装器已有处理能力，但应提示用户安装时退出当前应用。
- 安全风险: 只接受当前仓库 Release 资产，文件名必须匹配 `Coding.Plan.Bar-Setup-*-x64.exe` 或 `Coding Plan Bar-Setup-*-x64.exe`。
- UI 状态复杂: 检查、下载、失败、已下载四种状态要明确，避免按钮可点状态混乱。

## 依赖

- GitHub Releases API: `https://api.github.com/repos/bubble0462/coding-plan-bar/releases/latest`
- Node/Electron 内置 `https`、`fs`、`path`、`os`、`shell`
- 不建议首版引入 `electron-updater`，因为当前项目没有配置 code signing、publish provider 和自动安装流程；手动下载并启动安装器更可控。

## 非目标

- 不做静默后台安装。
- 不做增量更新。
- 不做多渠道更新源。
- 不处理 macOS/Linux 更新。
