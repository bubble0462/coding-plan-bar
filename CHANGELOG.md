# Changelog

## [0.4.5] - 2026-07-23

### Fixed

- 修复迁移到 D 盘后启动即崩溃：`normalizeUnavailableSecretFields` 未导出导致读配置时直接抛错。
- 单条 DPAPI 凭据无法解密时改为标记该账号需重新授权，不再拖垮整个应用启动；写回配置时保留原密文，不误删其它账号。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。若个别账号显示需重新填写 API Key / 重新导入 token，仅补该账号即可。

## [0.4.4] - 2026-07-23

### Added

- 应用启动后立即在后台预热 Codex 与 OpenCode Agent 用量；设置页优先显示最近一次可用汇总，刷新在后台进行。
- 应用自己的配置、配额缓存、Agent 用量汇总和 Electron 会话缓存默认保存到 `D:\Coding Plan Bar\Data`，并支持 `CODING_PLAN_BAR_DATA_DIR` 覆盖。

### Changed

- Agent 用量缓存只保存聚合后的统计快照（最大 512 KB），不复制原始会话或聊天内容。
- 每日清理过期临时文件，应用日志最多保留 14 天或 10 MB，并清理 Electron HTTP 缓存。
- 首次升级会安全迁移旧 `%APPDATA%\Coding Plan Bar` 应用数据；仅复制成功后才删除旧目录，D 盘不可用时自动回退。

### Fixed

- Codex 或 OpenCode 单个来源的本次统计失败时保留上次成功结果，不再让另一个来源或整个 Agent 用量页失效。
- 已缓存的 Agent 用量在首次打开设置页时立即显示，并以后台刷新状态提示代替整页加载等待。


## [0.4.3] - 2026-07-23

### Added

- 设置页「Agent 用量」新增 OpenCode 本机统计：读取今天、最近 7 天和最近 30 天的会话、请求、Token、provider 记录费用与模型明细。
- Agent 用量页顶部加入 Codex / OpenCode 图标切换；首次进入默认显示 OpenCode。

### Fixed

- Codex 会话扫描异常时不再阻断 OpenCode 统计；两个来源独立降级并显示各自错误信息。
- OpenCode CLI 不存在、超时或返回异常时提供明确提示，不影响 Codex 用量查看。

### Notes

- OpenCode 数据仅来自本机 `opencode stats --pure`，不会读取或上传聊天内容。
- provider 未记录价格时仍显示 Token 与请求数，费用可能为 `$0.00`。

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
