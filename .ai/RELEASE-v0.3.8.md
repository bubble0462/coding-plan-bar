# v0.3.8

## 新增

- 在官方订阅和 Coding Plan 的 5 小时、周额度周期中显示请求数与 Token 数量。
- 从 Codex 与 Claude 本机会话 JSONL 读取 usage 元数据，不读取对话正文。
- 按实际模型的输入、输出、缓存 Token 单价估算美元 API 等价成本。
- 支持 OpenAI、Claude、Kimi、GLM 与 MiniMax 常用模型价格；未知模型显示 Token 但不猜测金额。

## 修复与优化

- 卡片初始高度包含统计行，避免显示后再次调整造成跳动。
- 三个以内供应商继续按内容动态高度显示，第四个起固定高度滚动。
- GLM-5-Turbo 使用独立官方价格，不再按 GLM-5 通用价格计算。
