/* eslint-disable no-unused-vars -- globals consumed by settings.js */
/* global formatUsageInteger, formatUsageTokens, formatUsageMoney, escapeHtml, escapeAttr, computeCacheShare, state, root, render */
/* exported normalizeAgentUsagePayload, applyAgentUsagePayload, refreshAgentUsageNavigation,
   renderAgentUsagePage, renderCodexAgentUsage, renderOpenCodeAgentUsage,
   renderUsageModelsSection, renderUsageWindowCard, loadAgentUsage */

/**
 * Agent Usage view helpers. Loaded before settings.js so the functions land
 * on the same window scope without ES module wiring.
 *
 * Depends on settings.js owning:
 *   - `state` (agentUsage / agentUsageSource / view)
 *   - `render()`
 *   - `root` (for navigation badge)
 */

function normalizeAgentUsagePayload(payload) {
  const isEnvelope = Boolean(payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data"));
  if (!isEnvelope) return { data: payload || null, refreshing: false, stale: false, savedAt: null, error: null };
  return {
    data: payload.data || null,
    refreshing: Boolean(payload.refreshing),
    stale: Boolean(payload.stale),
    savedAt: Number(payload.savedAt || 0) || null,
    error: payload.error || null,
  };
}

function applyAgentUsagePayload(payload) {
  const normalized = normalizeAgentUsagePayload(payload);
  state.agentUsage = {
    loading: normalized.refreshing,
    data: normalized.data,
    error: normalized.error,
    stale: normalized.stale,
    savedAt: normalized.savedAt,
  };
  return normalized;
}

function refreshAgentUsageNavigation() {
  const dot = root.querySelector("[data-action='show-usage'] .nav-dot");
  dot?.classList.toggle("has-alert", Boolean(state.agentUsage.error));
}

function renderAgentUsagePage() {
  const usage = state.agentUsage;
  const aggregate = usage.data;
  const source = state.agentUsageSource === "codex" ? "codex" : "opencode";
  const codex = aggregate?.codex || (aggregate?.windows ? aggregate : null);
  const opencode = aggregate?.opencode || null;
  const selectedData = source === "codex" ? codex : opencode;
  const refreshedAt = selectedData?.generatedAt || aggregate?.generatedAt;
  const sourceLabel = source === "opencode" ? "OpenCode" : "Codex";
  const description = source === "opencode"
    ? "汇总本机 OpenCode 会话、消息、Token 与 provider 记录费用。"
    : "汇总本机 Codex Agent 的请求、Token 与 API 等价费用，不按账号拆分。";
  const sourceError = aggregate?.sourceErrors?.[source] || null;
  const cacheState = usage.loading
    ? "正在后台更新，当前结果可继续使用"
    : sourceError
      ? "本次更新未成功，正在显示上次可用结果"
      : usage.stale || selectedData?.stale
        ? "显示上次统计结果，后台会自动刷新"
        : "";

  let body = "";

  if (usage.loading && !aggregate) {
    body = `<div class="usage-loading" aria-live="polite"><span></span><strong>正在读取本机 Agent 用量…</strong><small>Codex 只读取本地会话日志；OpenCode 只调用本机 CLI 统计命令。</small></div>`;
  } else if (usage.error && !aggregate) {
    body = `<div class="usage-error"><strong>统计失败</strong><p>${escapeHtml(usage.error)}</p><button class="btn" data-action="refresh-agent-usage">重试</button></div>`;
  } else if (source === "opencode") {
    body = renderOpenCodeAgentUsage(opencode);
  } else {
    body = renderCodexAgentUsage(codex);
  }

  return `
    <div class="editor-head">
      <div class="section-title"><strong>Agent 用量</strong><span>${escapeHtml(description)}</span></div>
      <div class="agent-usage-actions">
        <div class="agent-source-switch" role="group" aria-label="Agent 用量来源">
          <button class="agent-source-button ${source === "codex" ? "is-active" : ""}" type="button" data-action="set-agent-usage-source" data-source="codex" aria-label="显示 Codex 用量" aria-pressed="${source === "codex"}" title="Codex 用量"><img src="../assets/codex-logo.png" alt="" /></button>
          <button class="agent-source-button ${source === "opencode" ? "is-active" : ""}" type="button" data-action="set-agent-usage-source" data-source="opencode" aria-label="显示 OpenCode 用量" aria-pressed="${source === "opencode"}" title="OpenCode 用量"><img src="../assets/opencode-logo.png" alt="" /></button>
        </div>
        <button class="btn" data-action="refresh-agent-usage" ${usage.loading ? "disabled" : ""}>${usage.loading ? "统计中…" : "重新统计"}</button>
      </div>
    </div>
    <div class="form usage-page">
      ${cacheState ? `<p class="usage-refresh-note${sourceError ? " is-warning" : ""}"${sourceError ? ` title="${escapeAttr(sourceError)}"` : ""}>${cacheState}</p>` : ""}
      <div class="usage-meta"><span>${escapeHtml(sourceLabel)} 数据更新时间：${escapeHtml(refreshedAt ? new Date(refreshedAt).toLocaleString("zh-CN") : "尚未统计")}</span>${source === "codex" && codex?.lastEventAt ? `<span>最近活动：${escapeHtml(new Date(codex.lastEventAt).toLocaleString("zh-CN"))}</span>` : ""}</div>
      ${body}
    </div>
  `;
}

function renderCodexAgentUsage(data) {
  if (!data) return `<div class="usage-error"><strong>Codex 数据不可用</strong><p>请重新统计本机 Codex 会话用量。</p></div>`;
  if (data.error) return `<div class="usage-error usage-unavailable"><strong>Codex 统计不可用</strong><p>${escapeHtml(data.error)}</p><button class="btn" data-action="refresh-agent-usage">重新统计</button></div>`;
  const daily = Array.isArray(data.daily) ? data.daily : [];
  const models = Array.isArray(data.models) ? data.models : [];
  const maxDaily = Math.max(1, ...daily.map((item) => Number(item.totalTokens || 0)));
  return `
    <div class="usage-window-grid">
      ${renderUsageWindowCard("今天", data.windows?.today, false, "估算", "included")}
      ${renderUsageWindowCard("最近 7 天", data.windows?.sevenDays, false, "估算", "included")}
      ${renderUsageWindowCard("最近 30 天", data.windows?.thirtyDays, true, "估算", "included")}
    </div>
    <section class="usage-section">
      <div class="usage-section-head">
        <div><strong>近 7 天趋势</strong><span>柱高按每日 Token 总量计算</span></div>
        <span class="usage-legend"><i></i>Token</span>
      </div>
      <div class="usage-chart" role="img" aria-label="近 7 天 Codex Token 使用趋势">
        ${daily.map((item) => {
          const height = Math.max(item.totalTokens ? 8 : 2, Math.round(Number(item.totalTokens || 0) / maxDaily * 100));
          const day = new Date(`${item.date}T00:00:00`).toLocaleDateString("zh-CN", { weekday: "short" });
          return `<div class="usage-day" title="${escapeAttr(item.date)} · ${escapeAttr(formatUsageTokens(item.totalTokens))} Token">
            <span class="usage-day-value">${escapeHtml(formatUsageTokens(item.totalTokens))}</span>
            <span class="usage-day-track"><i style="height:${height}%"></i></span>
            <span class="usage-day-label">${escapeHtml(day)}</span>
          </div>`;
        }).join("")}
      </div>
    </section>
    ${renderUsageModelsSection(models, "模型明细", "最近 30 天，费用按公开 API 单价估算", "估算费用", "最近 30 天没有可统计的 Codex 会话。")}
    <p class="usage-note">统计来自本机 Codex JSONL 会话日志，不代表订阅账单；未知模型不会计入金额，但 Token 仍会保留。</p>
  `;
}

function renderOpenCodeAgentUsage(data) {
  if (!data) {
    return `<div class="usage-error usage-unavailable"><strong>OpenCode 统计尚未就绪</strong><p>请重新统计以读取本机 OpenCode CLI 数据。</p></div>`;
  }
  if (!data.available) {
    return `<div class="usage-error usage-unavailable"><strong>OpenCode 统计不可用</strong><p>${escapeHtml(data.error || "未检测到 OpenCode CLI。")}</p><button class="btn" data-action="refresh-agent-usage">重新统计</button></div>`;
  }
  const models = Array.isArray(data.models) ? data.models : [];
  return `
    <div class="usage-window-grid is-opencode">
      ${renderUsageWindowCard("今天", data.windows?.today, false, "估算", "separate")}
      ${renderUsageWindowCard("最近 7 天", data.windows?.sevenDays, false, "估算", "separate")}
      ${renderUsageWindowCard("最近 30 天", data.windows?.thirtyDays, true, "估算", "separate")}
    </div>
    ${renderUsageModelsSection(models, "模型明细", "最近 30 天；有 provider 记录费用时优先使用，否则按公开 API 单价估算", "估算费用", "最近 30 天没有可统计的 OpenCode 使用记录。")}
    <p class="usage-note">统计读取本机 OpenCode 数据，不读取或上传聊天正文。费用优先用 provider 记录；为 $0 或缺失时按公开标准 API 单价估算，不等于订阅账单。</p>
  `;
}

function renderUsageModelsSection(models, title, subtitle, costLabel, emptyText) {
  return `
    <section class="usage-section">
      <div class="usage-section-head"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div></div>
      <div class="usage-model-table">
        <div class="usage-model-row is-head"><span>模型</span><span>请求</span><span>Token</span><span>${escapeHtml(costLabel)}</span></div>
        ${models.map((item) => `<div class="usage-model-row">
          <strong title="${escapeAttr(item.model)}">${escapeHtml(item.model)}</strong>
          <span>${formatUsageInteger(item.requests)}</span>
          <span>${escapeHtml(formatUsageTokens(item.totalTokens))}</span>
          <span class="usage-cost">${escapeHtml(formatUsageMoney(item.costUsd, item.partialCost))}</span>
        </div>`).join("") || `<div class="usage-model-empty">${escapeHtml(emptyText)}</div>`}
      </div>
    </section>
  `;
}

function renderUsageWindowCard(label, windowData = {}, featured = false, costLabel = "估算", cacheMode = "included") {
  const cacheShare = computeCacheShare(windowData, cacheMode);
  return `
    <article class="usage-window-card ${featured ? "is-featured" : ""}">
      <div class="usage-window-title"><span>${escapeHtml(label)}</span><em>${formatUsageInteger(windowData?.sessions)} 个会话</em></div>
      <strong class="usage-window-total">${escapeHtml(formatUsageTokens(windowData?.totalTokens))}<small> Token</small></strong>
      <div class="usage-window-stats"><span><b>${formatUsageInteger(windowData?.requests)}</b> 请求</span><span><b>${escapeHtml(formatUsageMoney(windowData?.costUsd, windowData?.partialCost))}</b> ${escapeHtml(costLabel)}</span></div>
      <div class="usage-token-split"><span>输入 <b>${escapeHtml(formatUsageTokens(windowData?.inputTokens))}</b></span><span>输出 <b>${escapeHtml(formatUsageTokens(windowData?.outputTokens))}</b></span><span>缓存 <b>${escapeHtml(formatUsageTokens(windowData?.cacheReadTokens))}</b></span></div>
      <div class="usage-cache"><span>${escapeHtml(cacheShare.label)} ${cacheShare.rate}%</span><i><b style="width:${cacheShare.rate}%"></b></i></div>
    </article>
  `;
}

async function loadAgentUsage(options = {}) {
  if (state.agentUsage.loading && !options.force) return;
  state.agentUsage = { ...state.agentUsage, loading: true, error: null };
  if (state.view === "usage") render();
  try {
    const payload = typeof window.codingPlanBar.getAgentUsage === "function"
      ? await window.codingPlanBar.getAgentUsage({ force: Boolean(options.force) })
      : {
        generatedAt: Date.now(),
        codex: await window.codingPlanBar.getCodexAgentUsage(),
        opencode: { available: false, generatedAt: Date.now(), windows: {}, models: [], error: "当前版本尚未提供 OpenCode 统计。" },
      };
    applyAgentUsagePayload(payload);
  } catch (error) {
    state.agentUsage = {
      ...state.agentUsage,
      loading: false,
      stale: Boolean(state.agentUsage.data) || state.agentUsage.stale,
      error: error.message || String(error),
    };
  }
  if (state.view === "usage") render();
}
