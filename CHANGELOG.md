# Changelog

## [0.4.2] - 2026-07-21

### Fixed

- 修复 Grok 额度解析中 `firstNumber` 重复定义：`null` 不再被误当成 `0`，月度积分与按量付费字段在缺失时正确显示为空。
- 修复设置页开关（启用/停用供应商、自动更新等）点击时因未定义的 `pulseToggle` 中断事件处理的问题。
- 修复额度刷新 `finally` 中不安全的 `return`，避免吞掉刷新任务异常。

### Changed

- `npm run check` 改为自动扫描 `src/` 与 `scripts/` 下全部 `.js` 做语法检查，并接入 ESLint。
- 主进程 timer（刷新 / 隐藏弹窗）集中到 `AppTimers`，退出时统一清理。
- HTTP 请求增加 `fetchWithTimeout` 封装；Grok Web Billing 默认走该超时路径。
- 设置页纯格式化函数拆到 `settings/helpers.js`，降低 `settings.js` 体积。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。

## [0.4.1] - 2026-07-20

### Changed

- 代理支持与连通性修复（系统 / 直连 / 手动代理）。
- 额度查询、测试连通、对话探测改走 Electron Chromium 网络栈。
- 修复「测试连通」脱敏 token 与利用率显示错误等问题。
