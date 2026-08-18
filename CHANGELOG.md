# Changelog

## [0.6.0] - 2026-08-18

### Fixed

- 修复 0.5.0 中进入单个供应商详情后顶部供应商选择器被遮挡消失的问题（详情内容超高时可整体滚动，选择器与底部按钮始终可见）。
- 修复 0.5.0 中从供应商详情切回「全部」时，MCP 额度等详情区块残留显示的问题。

### Added

- 弹窗改为「总览 / 详情」两级视图：总览以紧凑行展示每家供应商的剩余额度与风险状态（细进度条、风险变色、服务状态红点），点击任意行进入该供应商详情，点「全部」返回。
- DeepSeek 供应商详情新增平台用量面板：本月费用（¥）、本月 Token、缓存命中/未命中/输出明细、当月逐日费用折线与峰谷时段徽章（北京时间 00:30–08:30 谷时 5 折，仅为提示、不影响费用计算）。需在设置中填写 DeepSeek 平台 Token（platform.deepseek.com 控制台获取，可选）；未配置时显示引导提示，Token 失效时提示更新，余额查询均不受影响。平台 Token 通过 Windows DPAPI 加密存储。
- GLM 详情视图底部新增数据来源说明。

### Changed

- 总览行保留拖拽排序、待处理汇总与变更闪烁反馈；高度估算与窗口尺寸随之调整（总览最多直接展示 6 行，超出可滚动）。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。DeepSeek 平台用量来自 DeepSeek 开放平台控制台接口，非公开 API，Token 可能过期；不配置即保持原有余额查询体验。已有供应商、账号与 API Key 配置不受影响。

## [0.5.0] - 2026-08-18

### Added

- 弹窗顶部新增供应商选择器：可在「全部」（原多卡片视图，保留拖拽排序与待处理汇总）与单个供应商详情之间切换。选择会持久保存，悬停重开与重启后保持；默认选中 GLM 供应商（未配置 GLM 时为「全部」）。
- GLM（智谱/Z.ai）详情视图新增今日用量面板：今日调用次数、Token 消耗、近 24 小时调用折线图（白底蓝线）与 MCP 月度额度进度条，数据来自智谱服务端 model-usage 接口。接口失败时自动降级为仅卡片视图。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。今日用量与 24h 折线图为服务端口径的估算数据，不代表订阅账单。已有供应商、账号和 API Key 配置不受影响。

## [0.4.23] - 2026-08-09

### Removed

- 移除 ZCode 用量统计。「Agent 用量」恢复为 Codex 与 Claude Code 两档。原因是 ZCode 本地日志（cli/agents 的子代理 transcript + cli/rollout 的主会话 model-io）只覆盖部分用量，与服务端统计相差较大，无法准确反映实际消耗。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。Codex 与 Claude Code 的用量统计不受影响。

## [0.4.22] - 2026-08-09

### Added

- 「Agent 用量」新增 ZCode 统计：可在 Codex、Claude Code 与 ZCode 之间切换，统计本机 `~/.zcode/cli/agents` 的今天、最近 7 天和最近 30 天的请求、Token、会话和模型费用。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。ZCode 用量只读取本地 JSONL 会话日志，不上传任何内容；费用按公开 API 单价估算，不代表订阅账单。

## [0.4.21] - 2026-08-09

### Fixed

- 修复默认设置窗口宽度下「Agent 用量」标题栏的「重新统计」按钮被挤出可视区域的问题。标题描述现在会自适应省略，操作区固定宽度不被压缩。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。

## [0.4.20] - 2026-08-09

### Added

- 「Agent 用量」新增 Claude Code 统计：可在 Codex 与 Claude Code 之间切换，统计本机 `~/.claude/projects` 的今天、最近 7 天和最近 30 天的请求、Token、会话和模型费用。缓存 Token 按 Anthropic 计费方式单独统计。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。Claude Code 用量只读取本地 JSONL 会话日志，不上传任何内容；费用按公开 API 单价估算，不代表订阅账单。

## [0.4.19] - 2026-08-03

### Removed

- 移除 OpenCode Agent 用量统计功能。「Agent 用量」页面现在只统计本机 Codex Agent 用量，不再调用 OpenCode CLI 或读取 opencode.db。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。已配置的供应商、账号和 API Key 不受影响；agent-usage 缓存格式去掉 opencode 源，旧缓存会在下次刷新后自动失效重建。

## [0.4.18] - 2026-08-03

### Added

- 新增深色模式：设置页「外观主题」可在浅色 / 深色之间切换，悬停弹窗和设置窗口同步应用。
- 选择会立即生效并随配置保存，下次启动沿用上次选择；默认仍为浅色，不影响现有用户。

### Changed

- 弹窗和设置窗口的配色全面变量化（约 400 处硬编码颜色迁移到语义变量），为深色主题提供一致的色板，浅色外观保持不变。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。本次为纯视觉特性，不改变额度查询、凭据或配置格式。

## [0.4.17] - 2026-08-03

### Changed

- 本地 Agent 会话用量扫描（Codex `~/.codex/sessions`、Claude `~/.claude/projects` 等 JSONL 目录）的最小刷新间隔由 5 分钟放宽到 15 分钟，减少空闲期的磁盘扫描与 CPU 占用。额度查询频率不变，仍按设置的刷新间隔进行。

### Performance

- 启用 Grok 供应商时，每次刷新不再重复通过 `where.exe` / `which` 查找 grok 可执行文件路径，首次解析后整个生命周期复用，未安装时不缓存以便后续安装能被检测到。

### Notes

升级前请从系统托盘完全退出旧版本，再运行新安装包。本次为后台资源占用优化，不改变任何额度查询、凭据或配置格式。

## [0.4.16] - 2026-07-26

### Added

- 支持导入 CPA 导出的 Claude OAuth 账号 JSON，例如 `claude-user@example.com.json`，导入后可独立查看 Claude 官方订阅额度。
- 「最新文件」、选择文件、拖放和粘贴 JSON 均支持 Claude 账号格式；同一邮箱再次导入会更新账号，不会与同邮箱 Codex 账号合并。

### Security

- Claude 导入仅保存额度查询所需的 access token，并使用 Windows DPAPI 加密；refresh token 和 ID token 不保存、不展示。
- 已过期的 Claude access token 会直接标记为过期，不再发送额度查询请求。

### Notes

升级前请从系统托盘完全退出旧版本。拿到新的 Claude 账号 JSON 后，可放入 Downloads 点击「最新文件」，或通过「导入」选择、拖放或粘贴。

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
