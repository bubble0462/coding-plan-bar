# 验收标准

## 功能验收

- [ ] 设置窗口顶部不再显示 `File / Edit / View / Window` 菜单栏。
- [ ] 设置页有“自动更新”入口或页面，用户不用编辑 JSON 即可检查更新。
- [ ] 更新页能显示当前版本、最新版本、检查时间和检查结果。
- [ ] 点击“检查更新”会请求 GitHub Releases API，并能区分“已是最新”和“发现新版本”。
- [ ] 发现新版本时显示 Release 版本号、发布时间、下载按钮和 GitHub Release 链接。
- [ ] 点击“下载更新”后显示明确进度，包括百分比和已下载大小。
- [ ] 下载完成后显示“安装更新”按钮。
- [ ] 点击“安装更新”会启动下载好的 NSIS 安装程序。
- [ ] 下载失败、网络失败、GitHub API 失败时，设置页显示可读错误，不崩溃。
- [ ] 开启“启动时自动检查”后，重启应用会自动检查一次更新。
- [ ] 自动检查不会自动下载或自动安装。
- [ ] 关闭自动检查后，重启应用不会主动请求更新。

## 安全验收

- [ ] 只从 `bubble0462/coding-plan-bar` 的 GitHub Release 读取更新。
- [ ] 只接受 Windows x64 安装包资产。
- [ ] 下载文件先写入临时路径，完成后再标记为可安装。
- [ ] 不把 GitHub token、API key 或用户配置上传到仓库。

## UI 验收

- [ ] 更新页面在 `860x580` 最小窗口下无重叠、无文字溢出。
- [ ] 下载进度条稳定，不因文本变化造成布局跳动。
- [ ] 检查中、下载中按钮状态清晰，避免重复点击触发并发任务。
- [ ] 更新页视觉风格和现有设置页一致。

## 测试要求

- [ ] `npm run check` 通过。
- [ ] `npm run smoke` 通过。
- [ ] `npm run smoke:electron` 通过。
- [ ] `npm run screenshot:settings` 通过。
- [ ] 新增或扩展的更新页截图脚本通过。
- [ ] 打包后 `release\win-unpacked\Coding Plan Bar.exe --smoke-startup` 通过。
- [ ] 安装包生成到 `release\Coding Plan Bar-Setup-<version>-x64.exe`。

## 发布验收

- [ ] 版本号递增。
- [ ] README 中文和英文说明自动更新。
- [ ] GitHub `main` 分支包含源码改动。
- [ ] GitHub Release 上传新版安装包。
- [ ] Release notes 包含更新功能和 SHA256。
