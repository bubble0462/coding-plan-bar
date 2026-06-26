# 任务列表

## Task 1: 隐藏设置窗口默认菜单栏

- 目标: 设置窗口不再显示 `File / Edit / View / Window` 菜单栏。
- 输入: 现有 `createSettingsWindow()` 逻辑。
- 输出: 设置窗口打开后顶部只显示应用内容和系统标题栏。
- 影响文件: `src/main.js`
- 估计: 简单

## Task 2: 增加自动更新配置结构

- 目标: 在配置中保存自动更新偏好，例如启动时自动检查。
- 输入: 当前 `config.json` 和 `config.example.json` 格式。
- 输出: `autoUpdate.enabled` 或等价字段被归一化、保存和读取。
- 影响文件: `src/config-store.js`, `config.example.json`, `src/settings/settings.js`
- 估计: 简单

## Task 3: 实现 GitHub Release 检查逻辑

- 目标: 主进程请求 GitHub latest release，判断当前版本是否落后。
- 输入: `app.getVersion()`、GitHub Release JSON。
- 输出: 包含 `currentVersion`、`latestVersion`、`hasUpdate`、`releaseUrl`、`asset` 的结构化结果。
- 影响文件: `src/main.js`
- 估计: 中等

## Task 4: 实现安装包下载与进度

- 目标: 在应用内下载 Release 安装包，并把进度传给设置页。
- 输入: Release asset `browser_download_url`、文件大小。
- 输出: 下载进度、下载完成路径、失败错误。
- 影响文件: `src/main.js`, `src/preload.js`, `src/settings/settings.js`
- 估计: 中等

## Task 5: 实现启动安装程序

- 目标: 下载完成后可从设置页启动安装器。
- 输入: 已下载的安装包路径。
- 输出: Windows 启动安装程序；失败时显示错误。
- 影响文件: `src/main.js`, `src/preload.js`, `src/settings/settings.js`
- 估计: 简单

## Task 6: 设置页增加“自动更新”页面

- 目标: 在设置窗口中提供检查更新页面，展示当前版本、最新版本、检查状态、下载进度、安装按钮和自动检查开关。
- 输入: 更新 IPC 状态和配置。
- 输出: 图形化更新页面，不需要打开 JSON。
- 影响文件: `src/settings/settings.js`, `src/settings/settings.css`
- 估计: 中等

## Task 7: 启动时自动检查

- 目标: 用户开启自动检查后，应用启动时后台检查新版本。
- 输入: `autoUpdate.enabled` 配置。
- 输出: 有新版本时托盘菜单或设置页能看到提示；不自动下载、不自动安装。
- 影响文件: `src/main.js`, `src/settings/settings.js`
- 估计: 中等

## Task 8: 测试和截图覆盖

- 目标: 覆盖更新页面渲染、无更新、有更新、下载中、下载完成和失败状态。
- 输入: 现有 `scripts/capture-settings.js` 模式。
- 输出: 可重复运行的检查脚本，至少保证更新页面无空白、无遮挡。
- 影响文件: `scripts/capture-settings.js`, `scripts/smoke-test.js`
- 估计: 中等

## Task 9: 文档和发布

- 目标: README 说明自动更新行为、网络访问、安装器启动和手动下载兜底方式。
- 输入: 当前 README 中英文版本。
- 输出: 中文/英文文档更新；版本号递增；打包并上传 GitHub Release。
- 影响文件: `README.md`, `README_EN.md`, `package.json`, `package-lock.json`
- 估计: 简单
