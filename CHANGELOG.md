# Changelog

## [0.4.15] - 2026-07-25

### Changed

- 额度达到 90% 才进入「诊断中心」、左侧「需处理」筛选和弹窗待处理汇总。
- 70% 起仍保留黄色额度条和「关注」提示，但不再作为需要处理的问题。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。token 即将过期、查询失败和余额不足仍会正常进入诊断中心。

## [0.4.14] - 2026-07-25

### Changed

- OpenCode「今天 / 7 天 / 30 天」统一从本机 `opencode.db` 按模型汇总 Token，并按公开 API 单价估算费用；provider 有非零记录时仍优先用记录值。
- 修复今天/7 天卡片因缺少模型拆分而显示「未定价」或仅显示极少记录费用的问题。

### Notes

升级前请从系统托盘完全退出旧版本。打开 Agent 用量后点「重新统计」刷新。估算费用不等于订阅账单。

## [0.4.13] - 2026-07-24

### Fixed

- 「最新文件」可识别新版 CPA 导出文件名，例如 `codex-name@gmail.com-plus.json`；不再要求文件名必须包含 `cpa`。
- Downloads 扫描增加近期 JSON 内容识别兜底，避免 CPA 导出改名后找不到。

### Notes

升级前请从系统托盘完全退出旧版本。把 CPA 导出 JSON 放到 Downloads 后点「最新文件」即可。

## [0.4.12] - 2026-07-24

### Added

- OpenCode 模型费用：provider 记录为 $0 或缺失时，按公开标准 API 单价估算（与 Codex 估算口径一致，不等同订阅账单）。
- 定价表补充 Grok / Gemini 常见型号。

### Notes

升级前请从系统托盘完全退出旧版本。打开 Agent 用量后可点「重新统计」刷新。

## [0.4.11] - 2026-07-24

### Fixed

- 应用数据目录移出安装目录：默认改为 `D:\Apps\Coding Plan Bar Data`，避免 NSIS 升级/重装清空账号配置。
- 启动时自动迁移旧路径 `D:\Apps\Coding Plan Bar\Data`、`D:\Coding Plan Bar\Data` 与 `%APPDATA%` 中的配置（不覆盖已有文件）。

### Notes

升级前请从系统托盘完全退出旧版本。若账号仍缺失，可从备份恢复 `config.json` 到新数据目录。

## [0.4.10] - 2026-07-24

### Changed

- 精简 OpenCode Agent 用量页说明文案，去掉多余的「今天」时间口径提示。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。

## [0.4.9] - 2026-07-24

### Changed

- OpenCode「今天」改为读取本机 `opencode.db`，按本地 0 点切割；近 7/30 天仍用 `opencode stats --pure`。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。首次打开 Agent 用量可点「重新统计」刷新缓存。

## [0.4.8] - 2026-07-23

### Changed

- Agent 用量页面逻辑拆到 `settings/agent-usage-view.js`，减小 `settings.js` 体积。

### Fixed

- 截图脚本 `chat:list-codex-models` mock 改为返回完整 `{slug,label}` 列表，避免探测卡片反复加载并在 capture 时刷屏报错。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。

## [0.4.7] - 2026-07-23

### Changed

- 默认应用数据目录改为 `D:\Apps\Coding Plan Bar\Data`（与安装目录同树）。
- 升级时自动从旧路径 `D:\Coding Plan Bar\Data` 与 `%APPDATA%\Coding Plan Bar` 迁移配置/缓存（不覆盖已有文件）。

### Notes

升级前请从系统托盘完全退出旧版本。若需自定义目录，可设置环境变量 `CODING_PLAN_BAR_DATA_DIR`。

## [0.4.6] - 2026-07-23

### Fixed

- OpenCode Agent 用量「缓存占输入」误按 `cache / input` 计算并被封顶为 100%。现按 Anthropic / cc-switch 口径改为 **缓存命中率** `cache / (input + cache)`；Codex 仍使用 `cache / input`。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。

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
