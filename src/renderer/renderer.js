const root = document.getElementById("app");
const STATUS_TEXT = {
  ok: "可用",
  warn: "偏高",
  danger: "接近上限",
  error: "错误",
  expired: "已过期",
  missing: "缺少配置",
  manual: "手动",
};

// Crisp, consistently-rendered stroke icons (replace inconsistent unicode glyphs).
const ICONS = {
  refresh:
    '<svg class="icon icon-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
  settings:
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  grip:
    '<svg viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.25"/><circle cx="11" cy="4" r="1.25"/><circle cx="5" cy="10" r="1.25"/><circle cx="11" cy="10" r="1.25"/><circle cx="5" cy="16" r="1.25"/><circle cx="11" cy="16" r="1.25"/></svg>',
};

const MAX_VISIBLE_PROVIDERS = 6;

let snapshot = {
  loading: true,
  providers: [],
  updatedAt: null,
  refreshIntervalSeconds: 300,
  errorCount: 0,
};
let lastReportedHeight = 0;
let lastLayoutKey = "";
let layoutReportQueued = false;
let hasEntered = false;
let hasRenderedShell = false;
let prevSnapshotUpdatedAt = null;
let renderedProviderSignatures = new Map();
let draggedProviderId = null;
let refreshHighlightTimer = null;
// Popup provider selection: "all" or a provider id. Module-level so it survives
// hide/show cycles; the resolved default is persisted to config via IPC.
let selectedProviderId = null;
let renderedSelectorSignature = "";
const shownCelebrationKeys = new Set();

window.codingPlanBar.onSnapshot((next) => {
  const nextLayoutKey = next.layoutKey || providerLayoutKey(next.providers);
  if (nextLayoutKey !== lastLayoutKey) {
    lastReportedHeight = 0;
    lastLayoutKey = nextLayoutKey;
  }
  const isDataRefresh = !next.loading && prevSnapshotUpdatedAt !== next.updatedAt && hasEntered;
  prevSnapshotUpdatedAt = next.updatedAt;
  snapshot = next;
  render(isDataRefresh);
  handleCelebrations(next.celebrations);
});

function handleCelebrations(celebrations) {
  for (const entry of Array.isArray(celebrations) ? celebrations : []) {
    if (!entry?.key || shownCelebrationKeys.has(entry.key)) continue;
    shownCelebrationKeys.add(entry.key);
    showResetToast(entry);
    spawnConfetti();
  }
}

function showResetToast(entry) {
  root.querySelector(".reset-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "reset-toast";
  toast.textContent = `🎉 ${entry.providerName || entry.providerId || "供应商"} 周额度已重置`;
  root.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

function spawnConfetti() {
  root.querySelector(".confetti-layer")?.remove();
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  const colors = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];
  for (let index = 0; index < 24; index += 1) {
    const piece = document.createElement("i");
    piece.className = "confetti-piece";
    piece.style.setProperty("--x", `${4 + Math.random() * 92}%`);
    piece.style.setProperty("--delay", `${(Math.random() * 0.35).toFixed(2)}s`);
    piece.style.setProperty("--duration", `${(1.2 + Math.random() * 0.4).toFixed(2)}s`);
    piece.style.setProperty("--spin", `${Math.round(360 + Math.random() * 540)}deg`);
    piece.style.background = colors[index % colors.length];
    layer.appendChild(piece);
  }
  root.appendChild(layer);
  window.setTimeout(() => layer.remove(), 1900);
}

if (typeof window.codingPlanBar.onPopupVisibility === "function") {
  window.codingPlanBar.onPopupVisibility(({ visible }) => {
    ensurePopupShell();
    const shell = root.querySelector(".panel-shell");
    if (!shell) return;
    shell.classList.remove("is-entering", "is-leaving");
    if (visible) {
      void shell.offsetWidth;
      shell.classList.add("is-entering");
      return;
    }
    shell.classList.add("is-leaving");
    window.setTimeout(() => {
      if (shell.classList.contains("is-leaving")) {
        window.codingPlanBar.popupVisibilityComplete(false);
      }
    }, prefersReducedMotion() ? 0 : 160);
  });
}

// Light tick: only refreshes the "刚刚更新 / X 分钟前" text without rebuilding
// the DOM, so scroll position and the entrance animation are not disturbed.
setInterval(tickTimestamp, 30000);

function tickTimestamp() {
  const node = root.querySelector(".header p");
  if (node && !snapshot.loading) {
    node.textContent = formatUpdated(snapshot.updatedAt);
  }
}

root.addEventListener("mouseenter", () => {
  root.dataset.hover = "true";
  window.codingPlanBar.keepOpen();
});

root.addEventListener("mousemove", () => {
  window.codingPlanBar.keepOpen();
});

root.addEventListener("mouseleave", () => {
  root.dataset.hover = "false";
  window.codingPlanBar.leavePopup();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  // Force a fresh height report so the popup snaps to its true content height,
  // overriding any estimate the main process applied while it was hidden.
  lastReportedHeight = 0;
  queueLayoutReport();
});

function render(isDataRefresh = false) {
  const providers = snapshot.providers || [];
  const fresh = providers.length > 0 && !hasEntered;
  if (fresh) hasEntered = true;
  ensurePopupShell();

  const shell = root.querySelector(".panel-shell");
  const list = root.querySelector(".provider-list");
  if (!shell || !list) return;

  shell.classList.toggle("is-loading", Boolean(snapshot.loading));
  shell.classList.toggle("density-compact", snapshot.panelDensity === "compact");
  shell.classList.toggle("density-comfortable", snapshot.panelDensity !== "compact");
  document.documentElement.dataset.theme = snapshot.theme === "dark" ? "dark" : "light";

  const status = root.querySelector("[data-role='refresh-status']");
  if (status) status.textContent = snapshot.loading ? "正在刷新..." : formatUpdated(snapshot.updatedAt);
  const refresh = root.querySelector("[data-action='refresh']");
  if (refresh) {
    refresh.disabled = Boolean(snapshot.loading);
    refresh.classList.toggle("is-spinning", Boolean(snapshot.loading));
    refresh.setAttribute("aria-busy", snapshot.loading ? "true" : "false");
  }

  const attention = providers.filter((provider) => providerAlertClass(provider));
  const attentionButton = root.querySelector("[data-action='focus-attention']");
  if (attentionButton) {
    const hasAttention = attention.length > 0;
    attentionButton.hidden = !hasAttention;
    attentionButton.textContent = hasAttention
      ? `${attention.length} 个账户需要处理`
      : "";
  }

  const selection = resolveProviderSelection(providers);
  patchProviderSelector(providers, selection);

  if (selection === "all") {
    // Returning from a detail view: the reconciler only manages .provider
    // cards, so drop any leftover .provider-detail wrapper (usage chart, MCP
    // row) before rebuilding the list.
    if (list.querySelector(".provider-detail")) {
      list.innerHTML = "";
      renderedProviderSignatures.clear();
    }
    patchProviderList(list, providers, { fresh, isDataRefresh });
    list.classList.remove("is-detail");
    // Use provider count as a fast default, but after the first layout pass
    // upgrade to scrollable when content overflows the window — a single tall
    // card (e.g. Grok with three tiers) can exceed the work area even with
    // fewer than the normal visible-provider limit.
    list.classList.toggle("is-scrollable", providers.length > MAX_VISIBLE_PROVIDERS);
    list.classList.toggle("is-static", providers.length <= MAX_VISIBLE_PROVIDERS);
    upgradeToScrollableIfOverflowing(list);
  } else {
    renderedProviderSignatures.clear();
    const selected = providers.find((provider) => String(provider.id) === selection) || null;
    list.innerHTML = selected
      ? `<div class="provider-detail">${renderProvider(selected, 0, false, false, false)}${renderUsageDetail(selected)}</div>`
      : renderEmpty();
    // Detail content (especially GLM usage charts) can be taller than the
    // current popup. Make the content region scroll immediately so flexbox
    // never shrinks and clips the provider selector while waiting for the
    // post-layout overflow check.
    list.classList.remove("is-static");
    list.classList.add("is-scrollable", "is-detail");
  }

  const fatal = root.querySelector("[data-role='fatal']");
  if (fatal) {
    fatal.hidden = !snapshot.fatalError;
    fatal.textContent = snapshot.fatalError || "";
  }
  const interval = root.querySelector("[data-role='refresh-interval']");
  if (interval) interval.textContent = `自动 ${Math.round((snapshot.refreshIntervalSeconds || 300) / 60)} 分钟`;
  const freshness = root.querySelector("[data-role='freshness']");
  if (freshness) freshness.textContent = snapshot.loading ? "更新中" : formatUpdated(snapshot.updatedAt);

  const pointer = root.querySelector(".pointer");
  if (pointer) {
    const placement = snapshot.popupPlacement || {};
    const side = placement.placement || "above";
    pointer.className = `pointer pointer-${side}`;
    pointer.hidden = placement.pointerVisible === false;
    if (Number.isFinite(placement.pointerOffset)) {
      pointer.style.setProperty("--pointer-offset", `${placement.pointerOffset}px`);
    }
  }

  announcePopupStatus(providers);
  queueLayoutReport();
}

function ensurePopupShell() {
  if (hasRenderedShell) return;
  root.innerHTML = `
    <section class="panel-shell density-comfortable">
      <header class="header">
        <div>
          <h1>Coding Plan Bar</h1>
          <p data-role="refresh-status">正在刷新...</p>
          <button class="header-summary" type="button" data-action="focus-attention" hidden></button>
        </div>
        <div class="header-actions">
          <button class="icon-button" data-action="refresh" title="刷新" aria-label="刷新" aria-busy="true">${ICONS.refresh}</button>
          <button class="icon-button" data-action="config" title="设置" aria-label="设置">${ICONS.settings}</button>
        </div>
      </header>

      <div class="sr-only" data-role="live-status" aria-live="polite" aria-atomic="true"></div>
      <div class="provider-selector" data-role="provider-selector" role="tablist" aria-label="供应商选择"></div>
      <section class="provider-list is-static"></section>
      <div class="fatal" data-role="fatal" hidden></div>

      <footer class="footer">
        <span data-role="refresh-interval"></span>
        <span data-role="freshness"></span>
        <button class="footer-button" data-action="quit">退出</button>
      </footer>
      <div class="pointer pointer-above" aria-hidden="true"></div>
    </section>
  `;
  hasRenderedShell = true;
  root.querySelector("[data-action='refresh']")?.addEventListener("click", () => window.codingPlanBar.refresh());
  root.querySelector("[data-action='config']")?.addEventListener("click", () => window.codingPlanBar.openConfig());
  root.querySelector("[data-action='quit']")?.addEventListener("click", () => window.codingPlanBar.quit());
  root.querySelector("[data-action='focus-attention']")?.addEventListener("click", focusFirstAttentionProvider);
  root.querySelector("[data-role='provider-selector']")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-select-provider]");
    if (chip) selectProviderView(chip.dataset.selectProvider);
  });
  root.querySelector(".provider-list")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-provider-drag]")) return;
    const row = event.target.closest(".provider.overview-row[data-provider-id]");
    if (row) selectProviderView(row.dataset.providerId);
  });
  root.querySelector(".provider-list")?.addEventListener("keydown", (event) => {
    if (event.target.closest("[data-provider-drag]")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".provider.overview-row[data-provider-id]");
    if (!row) return;
    event.preventDefault();
    selectProviderView(row.dataset.providerId);
  });
}

function selectProviderView(next) {
  if (!next || next === selectedProviderId) return;
  selectedProviderId = next;
  renderedSelectorSignature = "";
  lastReportedHeight = 0;
  render(false);
  queueLayoutReport();
  window.codingPlanBar.selectProvider?.(next).catch(() => {});
}

function patchProviderList(list, providers, { fresh, isDataRefresh }) {
  const priorScrollTop = list.scrollTop;
  const expectedIds = new Set(providers.map((provider) => String(provider.id || "")));
  list.querySelectorAll(".provider[data-provider-id]").forEach((card) => {
    if (!expectedIds.has(card.dataset.providerId)) {
      renderedProviderSignatures.delete(card.dataset.providerId);
      card.remove();
    }
  });

  if (!providers.length) {
    renderedProviderSignatures.clear();
    list.innerHTML = renderEmpty();
    list.scrollTop = priorScrollTop;
    return;
  }

  list.querySelector(".empty-state")?.remove();
  const canReorder = providers.length > 1;
  for (const [index, provider] of providers.entries()) {
    const id = String(provider.id || "");
    const signature = providerDisplaySignature(provider);
    const priorSignature = renderedProviderSignatures.get(id);
    const changed = Boolean(priorSignature && priorSignature !== signature && !snapshot.loading);
    let card = list.querySelector(`.provider[data-provider-id="${cssEscape(id)}"]`);
    if (!card) {
      card = providerCardFromMarkup(renderOverviewRow(provider, index, fresh, changed || isDataRefresh, canReorder));
    } else if (priorSignature !== signature || card.dataset.canReorder !== String(canReorder)) {
      const next = providerCardFromMarkup(renderOverviewRow(provider, index, false, changed, canReorder));
      card.replaceWith(next);
      card = next;
      if (changed) flashChangedCard(card);
    }
    renderedProviderSignatures.set(id, signature);
    list.append(card);
  }
  list.scrollTop = priorScrollTop;
  bindProviderReorder();
}

function renderOverviewRow(provider, index, fresh, changed, canReorder) {
  const serviceStatus = providerServiceStatus(provider);
  const quotaRisk = providerQuotaRisk(provider);
  const needsAttention = Boolean(providerAlertClass(provider));
  const classes = [
    "provider",
    "overview-row",
    `status-${serviceStatus.status}`,
    providerServiceClass(provider),
    quotaRisk ? `is-quota-${quotaRisk}` : "",
    canReorder ? "is-reorderable" : "",
    fresh ? "is-fresh" : "",
    changed ? "is-changed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const enterStyle = fresh ? ` style="--enter-delay:${Math.min(index, 4) * 45}ms"` : "";

  const tiers = Array.isArray(provider.tiers) ? provider.tiers : [];
  const maxUtilization = tiers.length
    ? Math.max(...tiers.map((tier) => clamp(Number(tier.utilization) || 0, 0, 100)))
    : 0;
  let metricMarkup = "";
  if (provider.balance) {
    const unit = provider.balance.unit || "";
    const remaining = Number(provider.balance.remaining) || 0;
    metricMarkup = `<strong class="overview-value">${escapeHtml(formatMoney(remaining, unit))}</strong>`;
  } else if (tiers.length > 1) {
    metricMarkup = `<div class="overview-tiers">${tiers.slice(0, 2).map(overviewTierChip).join("")}</div>`;
  } else if (tiers.length === 1) {
    const barWidth = Math.round(maxUtilization);
    const barClass = maxUtilization >= 90 ? "bar-danger" : maxUtilization >= 70 ? "bar-warn" : "bar-ok";
    metricMarkup = `
        ${barWidth ? `<div class="progress-track slim"><div class="progress-bar ${barClass}" style="width:${barWidth}%"></div></div>` : ""}
        <strong class="overview-value">剩余 ${Math.round(100 - maxUtilization)}%</strong>`;
  } else {
    metricMarkup = `<strong class="overview-value">${escapeHtml(serviceStatus.label)}</strong>`;
  }

  return `
    <article class="${classes}" data-provider-id="${escapeAttr(provider.id || "")}" data-can-reorder="${canReorder}" data-needs-attention="${needsAttention}" tabindex="0" role="button" aria-label="${escapeAttr(providerAccessibleLabel(provider, serviceStatus, quotaRisk))}。按 Enter 查看详情。"${enterStyle}>
      ${canReorder ? `<button class="provider-drag-handle" type="button" draggable="true" data-provider-drag="${escapeAttr(provider.id || "")}" title="Alt + 上下方向键调整显示顺序" aria-label="调整 ${escapeAttr(provider.name || provider.id)} 的显示顺序。按 Alt 加上方向键或下方向键移动。">${ICONS.grip}</button>` : ""}
      <span class="status-dot"></span>
      <div class="overview-main">
        <span class="overview-name">${escapeHtml(provider.name || provider.id)}</span>
        <span class="overview-plan">${escapeHtml(provider.planLabel ? provider.planLabel : provider.kindLabel || provider.kind || "")}</span>
      </div>
      <div class="overview-metric">
        ${metricMarkup}
      </div>
    </article>
  `;
}

function overviewTierShortLabel(label) {
  const shortened = String(label || "").replace(/额度$/, "").replace(/\s*(Token|使用)$/, "").trim();
  return shortened || label;
}

function overviewTierChip(tier) {
  const utilization = clamp(Number(tier.utilization) || 0, 0, 100);
  const remaining = Math.round(100 - utilization);
  const barClass = utilization >= 90 ? "bar-danger" : utilization >= 70 ? "bar-warn" : "bar-ok";
  const fullName = tier.label || tier.name || "";
  return `<span class="overview-tier" title="${escapeAttr(`${fullName}：已用 ${Math.round(utilization)}%，剩余 ${remaining}%`)}"><span class="overview-tier-label">${escapeHtml(overviewTierShortLabel(fullName))}</span><span class="progress-track slim mini"><span class="progress-bar ${barClass}" style="width:${Math.round(utilization)}%"></span></span><span class="overview-tier-value">${remaining}%</span></span>`;
}

function providerCardFromMarkup(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

function providerDisplaySignature(provider) {
  return JSON.stringify({
    status: provider.status,
    statusText: provider.statusText,
    planLabel: provider.planLabel,
    message: provider.message,
    failure: provider.failure && { label: provider.failure.label, action: provider.failure.action },
    lastSuccess: provider.lastSuccess && provider.lastSuccess.queriedAt,
    balance: provider.balance,
    usage: provider.usage,
    tiers: provider.tiers,
    extraUsage: provider.extraUsage,
    usageHistory: provider.usageHistory && {
      todayCalls: provider.usageHistory.todayCalls,
      todayTokens: provider.usageHistory.todayTokens,
    },
    mcpQuota: provider.mcpQuota && Math.round(provider.mcpQuota.utilization),
    platformUsage: provider.platformUsage && {
      month: provider.platformUsage.month,
      error: provider.platformUsage.error || null,
      days: provider.platformUsage.daily?.length || 0,
      costCny: provider.platformUsage.totals?.costCny,
    },
  });
}

function flashChangedCard(card) {
  card.classList.remove("is-changed");
  void card.offsetWidth;
  card.classList.add("is-changed");
  window.clearTimeout(refreshHighlightTimer);
  refreshHighlightTimer = window.setTimeout(() => {
    root.querySelectorAll(".provider.is-changed").forEach((node) => node.classList.remove("is-changed"));
  }, 520);
}

let lastAnnouncement = "";
function announcePopupStatus(providers) {
  const live = root.querySelector("[data-role='live-status']");
  if (!live) return;
  const attention = providers.filter((provider) => providerAlertClass(provider));
  const message = snapshot.loading
    ? "正在刷新额度"
    : snapshot.fatalError
      ? `刷新失败：${snapshot.fatalError}`
      : attention.length
        ? `刷新完成，${attention.length} 个账户需要处理`
        : `刷新完成，已检查 ${providers.length} 个账户`;
  if (message === lastAnnouncement) return;
  lastAnnouncement = message;
  live.textContent = message;
}

function focusFirstAttentionProvider() {
  // Attention cards outside the selected detail view are not in the DOM —
  // fall back to the all view first so the focus target exists.
  if (selectedProviderId !== null && selectedProviderId !== "all") {
    selectProviderView("all");
  }
  const card = root.querySelector('.provider[data-needs-attention="true"]');
  if (!card) return;
  card.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  card.classList.add("is-focus-target");
  card.focus({ preventScroll: true });
  window.setTimeout(() => card.classList.remove("is-focus-target"), prefersReducedMotion() ? 0 : 520);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function isGlmProvider(provider) {
  // Zhipu/Z.ai coding plans are the only providers carrying server-side usage
  // detail today; also match by name so the default works before data loads.
  return Boolean(provider.usageHistory || provider.mcpQuota) ||
    /glm|zhipu|bigmodel|z\.ai/i.test(`${provider.id || ""} ${provider.name || ""}`);
}

function resolveProviderSelection(providers) {
  const persist = (value) => {
    window.codingPlanBar.selectProvider?.(value).catch(() => {});
  };
  if (selectedProviderId === null) {
    const stored = snapshot.popupSelectedProvider || "";
    if (stored === "all" || (stored && providers.some((provider) => String(provider.id) === stored))) {
      selectedProviderId = stored;
    } else {
      const glm = providers.find(isGlmProvider);
      selectedProviderId = glm ? String(glm.id) : "all";
      persist(selectedProviderId);
    }
  } else if (selectedProviderId !== "all" && !providers.some((provider) => String(provider.id) === selectedProviderId)) {
    const glm = providers.find(isGlmProvider);
    selectedProviderId = glm ? String(glm.id) : "all";
    persist(selectedProviderId);
  }
  return selectedProviderId;
}

function patchProviderSelector(providers, selection) {
  const container = root.querySelector("[data-role='provider-selector']");
  if (!container) return;
  const signature = JSON.stringify([providers.map((provider) => provider.id), selection]);
  if (signature === renderedSelectorSignature) return;
  renderedSelectorSignature = signature;
  const chips = [
    `<button class="selector-chip ${selection === "all" ? "is-active" : ""}" type="button" role="tab" aria-selected="${selection === "all"}" data-select-provider="all">全部</button>`,
    ...providers.map((provider) => `
      <button class="selector-chip ${selection === String(provider.id) ? "is-active" : ""}" type="button" role="tab" aria-selected="${selection === String(provider.id)}" data-select-provider="${escapeAttr(String(provider.id || ""))}" title="${escapeAttr(provider.name || String(provider.id || ""))}">${escapeHtml(provider.name || String(provider.id || ""))}</button>
    `),
  ];
  container.innerHTML = chips.join("");
}

function renderUsageDetail(provider) {
  if (provider.usageHistory && Array.isArray(provider.usageHistory.hourly) && provider.usageHistory.hourly.length) {
    return renderGlmUsageDetail(provider);
  }
  if (provider.platformUsage) return renderDeepSeekUsage(provider.platformUsage);
  if (isDeepSeekProvider(provider)) {
    return `
      <div class="usage-detail">
        <p class="usage-hint">在设置中填写 DeepSeek 平台 Token 后，这里会显示本月 Token、费用与逐日趋势。余额查询不受影响。</p>
      </div>
    `;
  }
  return "";
}

function isDeepSeekProvider(provider) {
  return /deepseek/i.test(`${provider.id || ""} ${provider.name || ""}`);
}

function renderGlmUsageDetail(provider) {
  const history = provider.usageHistory;
  const mcp = provider.mcpQuota;
  return `
    <div class="usage-detail">
      <div class="stat-chips">
        <span class="stat-chip">今日调用 <strong>${escapeHtml(formatCompactNumber(history.todayCalls))}</strong> 次</span>
        <span class="stat-chip">Token <strong>${escapeHtml(formatCompactNumber(history.todayTokens))}</strong></span>
      </div>
      ${renderLineChart(
        history.hourly.map((point) => point.calls),
        history.hourly.map((point) => (point.hour ? `${point.hour}:00` : "")),
        "近 24 小时调用量折线图",
      )}
      ${mcp ? renderMcpQuota(mcp) : ""}
      <p class="usage-source">数据来源：智谱服务端接口（额度 · model-usage），不代表订阅账单。</p>
    </div>
  `;
}

function renderDeepSeekUsage(platformUsage) {
  if (platformUsage.error || !Array.isArray(platformUsage.daily) || !platformUsage.daily.length) {
    return `
      <div class="usage-detail">
        <p class="usage-hint is-warning">${escapeHtml(platformUsage.error || "平台用量数据暂不可用。")}余额仍来自官方 API，不受影响。</p>
        <p class="usage-source">数据来源：余额 · 官方 API / 用量 · 平台控制台。</p>
      </div>
    `;
  }
  const totals = platformUsage.totals || { costCny: 0, totalTokens: 0, hit: 0, miss: 0, output: 0 };
  const pricing = deepSeekPricingBadge();
  return `
    <div class="usage-detail">
      <div class="stat-chips">
        <span class="stat-chip">本月费用 <strong>¥${(Number(totals.costCny) || 0).toFixed(2)}</strong>${pricing}</span>
        <span class="stat-chip">本月 Token <strong>${escapeHtml(formatCompactNumber(totals.totalTokens))}</strong></span>
      </div>
      <p class="usage-breakdown">缓存命中 ${escapeHtml(formatCompactNumber(totals.hit))} · 未命中 ${escapeHtml(formatCompactNumber(totals.miss))} · 输出 ${escapeHtml(formatCompactNumber(totals.output))}</p>
      ${renderLineChart(
        platformUsage.daily.map((day) => day.costCny),
        platformUsage.daily.map((day) => String(day.date || "").slice(5)),
        "本月逐日费用折线图",
      )}
      <p class="usage-source">数据来源：余额 · 官方 API / 用量与费用 · 平台控制台（${escapeHtml(platformUsage.month || "")}）。峰谷提示不参与费用计算。</p>
    </div>
  `;
}

function deepSeekPricingBadge() {
  const now = new Date();
  const beijing = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60_000);
  const minutes = beijing.getHours() * 60 + beijing.getMinutes();
  const isPeak =
    (minutes >= 9 * 60 && minutes < 12 * 60) ||
    (minutes >= 14 * 60 && minutes < 18 * 60);
  const isOffPeak = !isPeak;
  return `<span class="pricing-badge ${isOffPeak ? "is-off-peak" : ""}" title="DeepSeek 高峰为 09:00–12:00、14:00–18:00（北京时间），其余空闲时段 5 折；仅提示不参与计算">${isOffPeak ? "空闲 5 折" : "高峰时段"}</span>`;
}

function renderLineChart(values, labels, ariaLabel) {
  const series = (values || []).map((value) => Number(value) || 0);
  if (series.length < 2) return "";
  const width = 380;
  const height = 56;
  const top = 5;
  const bottom = 50;
  const max = Math.max(1, ...series);
  const stepX = width / (series.length - 1);
  const points = series.map((value, index) => {
    const x = index * stepX;
    const y = bottom - (value / max) * (bottom - top);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  let peakIndex = 0;
  series.forEach((value, index) => {
    if (value > series[peakIndex]) peakIndex = index;
  });
  const peakX = (peakIndex * stepX).toFixed(1);
  const peakY = (bottom - (series[peakIndex] / max) * (bottom - top)).toFixed(1);
  const area = `0,${bottom} ${points.join(" ")} ${width},${bottom}`;
  const label = (index) => escapeHtml(labels?.[index] || "");
  const middleIndex = Math.floor(series.length / 2);
  return `
    <div class="detail-chart">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeAttr(ariaLabel)}">
        <polygon class="chart-area" points="${area}"></polygon>
        <polyline class="chart-line" points="${points.join(" ")}"></polyline>
        <circle class="chart-peak" cx="${peakX}" cy="${peakY}" r="2.6"></circle>
      </svg>
      <div class="chart-labels"><span>${label(0)}</span><span>${label(middleIndex)}</span><span>${label(series.length - 1)}</span></div>
    </div>
  `;
}

function renderMcpQuota(mcp) {
  const utilization = clamp(Number(mcp.utilization) || 0, 0, 100);
  const colorClass = utilization >= 90 ? "bar-danger" : utilization >= 70 ? "bar-warn" : "bar-ok";
  const reset = countdown(mcp.resetsAt);
  return `
    <div class="tier mcp-tier">
      <div class="tier-line">
        <span>MCP 月额度</span>
        <strong>已用 ${Math.round(utilization)}%</strong>
      </div>
      <div class="progress-track">
        <div class="progress-bar ${colorClass}" style="width:${utilization}%"></div>
      </div>
      <div class="tier-meta">
        <span>${escapeHtml(formatCompactNumber(mcp.used))} / ${escapeHtml(formatCompactNumber(mcp.total))} 次</span>
        <span class="reset-time ${reset ? reset.tone : ""}">${reset ? `${escapeHtml(reset.relative)} · ${escapeHtml(reset.absolute)} 重置` : ""}</span>
      </div>
    </div>
  `;
}

function formatCompactNumber(value) {
  const numeric = Number(value) || 0;
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`;
  return String(numeric);
}

function renderProvider(provider, index, fresh, changed, canReorder) {
  const serviceStatus = providerServiceStatus(provider);
  const quotaRisk = providerQuotaRisk(provider);
  const needsAttention = Boolean(providerAlertClass(provider));
  const classes = [
    "provider",
    `status-${serviceStatus.status}`,
    providerServiceClass(provider),
    quotaRisk ? `is-quota-${quotaRisk}` : "",
    canReorder ? "is-reorderable" : "",
    fresh ? "is-fresh" : "",
    changed ? "is-changed" : "",
  ]    .filter(Boolean)
    .join(" ");
  const enterStyle = fresh ? ` style="--enter-delay:${Math.min(index, 4) * 45}ms"` : "";
  const body = provider.balance
    ? renderBalance(provider)
    : provider.tiers?.length
      ? renderTiers(provider.tiers)
      : renderProviderMessage(provider);

  return `
    <article class="${classes}" data-provider-id="${escapeAttr(provider.id || "")}" data-can-reorder="${canReorder}" data-needs-attention="${needsAttention}" tabindex="-1" aria-label="${escapeAttr(providerAccessibleLabel(provider, serviceStatus, quotaRisk))}"${enterStyle}>
      ${canReorder ? `<button class="provider-drag-handle" type="button" draggable="true" data-provider-drag="${escapeAttr(provider.id || "")}" title="Alt + 上下方向键调整显示顺序" aria-label="调整 ${escapeAttr(provider.name || provider.id)} 的显示顺序。按 Alt 加上方向键或下方向键移动。">${ICONS.grip}</button>` : ""}
      <div class="provider-top">
        <div class="provider-title">
          <span class="status-dot"></span>
          <div>
            <h2>${escapeHtml(provider.name)}</h2>
            <p>${provider.planLabel ? escapeHtml(provider.planLabel) : provider.kindLabel || provider.kind}</p>
          </div>
        </div>
        <span class="status-pill">${escapeHtml(serviceStatus.label)}</span>
      </div>
      ${body}
      ${renderGrokBilling(provider)}
      ${renderResetCredits(provider)}
      ${renderProviderNotice(provider)}
    </article>
  `;
}

function renderGrokBilling(provider) {
  if (provider.tool !== "grok" || !provider.extraUsage) return "";
  const extra = provider.extraUsage;
  const hasAmount = extra.usedCredits != null || extra.monthlyLimit != null || extra.prepaidBalance != null;
  const amount = hasAmount
    ? [extra.usedCredits != null ? `已用 ${formatMoney(extra.usedCredits, extra.currency)}` : "", extra.monthlyLimit != null ? `上限 ${formatMoney(extra.monthlyLimit, extra.currency)}` : ""].filter(Boolean).join(" / ")
    : "";
  return `
    <div class="grok-billing-row">
      <span>按量付费</span>
      <strong class="${extra.isEnabled ? "is-enabled" : ""}">${extra.isEnabled ? "已启用" : "未启用"}</strong>
      ${amount ? `<span class="grok-billing-amount">${escapeHtml(amount)}</span>` : ""}
    </div>
  `;
}

function renderResetCredits(provider) {
  const available = provider.resetCredits?.available;
  if (available == null || !Number.isFinite(available) || available < 0) return "";
  const label = available === 0 ? "已用尽" : `剩余 ${available} 次`;
  return `
    <div class="reset-credits-row">
      <span>可重置额度</span>
      <strong class="${available > 0 ? "is-available" : ""}">${escapeHtml(label)}</strong>
    </div>
  `;
}

function bindProviderReorder() {
  const list = root.querySelector(".provider-list");
  if (!list) return;
  const rows = [...list.querySelectorAll(".provider[data-provider-id]")];
  const clearDropState = () => {
    rows.forEach((row) => row.classList.remove("is-dragging", "is-drop-before", "is-drop-after"));
  };

  rows.forEach((row) => {
    if (row.dataset.reorderBound === "true") return;
    row.dataset.reorderBound = "true";
    const handle = row.querySelector("[data-provider-drag]");
    if (!handle) return;
    handle.addEventListener("dragstart", (event) => {
      draggedProviderId = row.dataset.providerId;
      row.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", draggedProviderId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      window.codingPlanBar.keepOpen();
    });
    handle.addEventListener("dragend", () => {
      draggedProviderId = null;
      clearDropState();
    });
    handle.addEventListener("keydown", (event) => {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const sibling = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling?.matches?.(".provider[data-provider-id]")) return;
      if (event.key === "ArrowUp") list.insertBefore(row, sibling);
      else list.insertBefore(sibling, row);
      persistProviderDomOrder(row.dataset.providerId);
    });
    row.addEventListener("dragover", (event) => {
      if (!draggedProviderId || draggedProviderId === row.dataset.providerId) return;
      event.preventDefault();
      clearDropState();
      const before = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      row.classList.add(before ? "is-drop-before" : "is-drop-after");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const source = list.querySelector(`[data-provider-id="${cssEscape(draggedProviderId)}"]`);
      if (!source || source === row) return;
      const before = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      list.insertBefore(source, before ? row : row.nextElementSibling);
      clearDropState();
      persistProviderDomOrder(source.dataset.providerId);
      draggedProviderId = null;
    });
  });
}

function persistProviderDomOrder(focusId) {
  const list = root.querySelector(".provider-list");
  const ids = [...list.querySelectorAll(".provider[data-provider-id]")].map((row) => row.dataset.providerId);
  window.codingPlanBar.reorderProviders(ids).catch(() => render(false));
  lastReportedHeight = 0;
  queueLayoutReport();
  requestAnimationFrame(() => {
    list.querySelector(`[data-provider-drag="${cssEscape(focusId)}"]`)?.focus();
  });
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(String(value || "")) : String(value || "").replace(/["\\]/g, "\\$&");
}

function providerAlertClass(provider) {
  return providerServiceClass(provider) ? "is-attention" : "";
}

function providerServiceClass(provider) {
  const quotaOnlyFailure = provider.failure?.kind === "quota_exhausted";
  const serviceFailure = !quotaOnlyFailure && (
    Boolean(provider.failure) || ["error", "expired", "missing"].includes(provider.status)
  );
  return serviceFailure ? "is-service-attention" : "";
}

function providerServiceStatus(provider) {
  if (providerServiceClass(provider)) {
    return {
      status: provider.status,
      label: provider.failure?.label || provider.statusText || STATUS_TEXT[provider.status] || "错误",
    };
  }
  if (Array.isArray(provider.tiers) && provider.tiers.length > 0) {
    return { status: "ok", label: STATUS_TEXT.ok };
  }
  return {
    status: provider.status,
    label: provider.statusText || STATUS_TEXT[provider.status] || provider.status,
  };
}

function providerQuotaRisk(provider) {
  const maxUtilization = Math.max(0, ...(provider.tiers || []).map((tier) => Number(tier.utilization || 0)));
  if (maxUtilization >= 90) return "danger";
  if (maxUtilization >= 75) return "watch";
  return "";
}

function providerAccessibleLabel(provider, serviceStatus, quotaRisk) {
  const parts = [provider.name || provider.id, `服务${serviceStatus.label}`];
  if (quotaRisk === "danger") parts.push("额度接近上限");
  if (quotaRisk === "watch") parts.push("额度需要关注");
  return parts.filter(Boolean).join("，");
}

function renderProviderNotice(provider) {
  if (provider.failure) {
    const prefix = provider.lastSuccess
      ? `显示上次成功数据（${formatUpdated(provider.lastSuccess.queriedAt)}）。`
      : "";
    return `<p class="message failure-help"><strong>${escapeHtml(provider.failure.label)}：</strong>${escapeHtml(prefix + provider.failure.action)}</p>`;
  }
  if (provider.message) return `<p class="message">${escapeHtml(provider.message)}</p>`;
  return "";
}

function renderTiers(tiers) {
  return `
    <div class="tiers">
      ${tiers.map(renderTier).join("")}
    </div>
  `;
}

function renderTier(tier) {
  const utilization = clamp(Number(tier.utilization || 0), 0, 100);
  const remaining = clamp(100 - utilization, 0, 100);
  const colorClass = utilization >= 90 ? "bar-danger" : utilization >= 70 ? "bar-warn" : "bar-ok";
  const riskClass = utilization >= 90 ? "is-quota-danger" : utilization >= 75 ? "is-quota-watch" : "";
  const riskLabel = utilization >= 90 ? "接近上限" : utilization >= 75 ? "需要关注" : "";
  const reset = countdown(tier.resetsAt);
  const usd =
    tier.usedValueUsd != null && tier.maxValueUsd != null
      ? `<span class="usd">$${Number(tier.usedValueUsd).toFixed(2)} / $${Number(tier.maxValueUsd).toFixed(2)}</span>`
      : "";

  return `
    <div class="tier ${riskClass}">
      ${renderTierUsage(tier.usage)}
      <div class="tier-line">
        <span>${escapeHtml(tier.label || tier.name)}</span>
        <strong>${riskLabel ? `<span class="tier-risk-label">${riskLabel}</span>` : ""}已用 ${Math.round(utilization)}%</strong>
      </div>
      <div class="progress-track">
        <div class="progress-bar ${colorClass}" style="width:${utilization}%"></div>
      </div>
      <div class="tier-meta">
        <span>剩余 ${Math.round(remaining)}%</span>
        <span class="reset-time ${reset ? reset.tone : ""}">${usd}${reset ? ` ${escapeHtml(reset.relative)} · ${escapeHtml(reset.absolute)} 重置` : "重置时间未知"}</span>
      </div>
    </div>
  `;
}

function renderTierUsage(usage) {
  if (!usage) return "";
  const cost = usage.costUsd == null
    ? "$--"
    : `${usage.partialCost ? "≥ " : ""}${formatUsageCost(usage.costUsd, usage.currency || "USD")}`;
  return `
    <div class="tier-usage" title="根据本机会话 Token 和模型公开 API 价格估算，不代表订阅实际账单">
      <span><strong>${Math.max(0, Number(usage.requests) || 0)}</strong> 次请求</span>
      <span><strong>${formatCompactTokens(usage.totalTokens)}</strong> Token</span>
      <span class="tier-cost">估算 <strong>${cost}</strong></span>
    </div>
  `;
}

function formatUsageCost(value, unit) {
  const amount = Math.max(0, Number(value) || 0);
  const number = formatEstimatedCost(amount);
  if (unit === "CNY") return `￥${number}`;
  if (unit === "USD") return `$${number}`;
  return `${number} ${unit}`;
}

function formatCompactTokens(value) {
  const tokens = Math.max(0, Number(value) || 0);
  if (tokens >= 1_000_000) return `${stripTrailingZero((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 1_000) return `${stripTrailingZero((tokens / 1_000).toFixed(1))}K`;
  return String(Math.round(tokens));
}

function formatEstimatedCost(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount > 0 && amount < 0.01) return amount.toFixed(3);
  return amount.toFixed(2);
}

function stripTrailingZero(value) {
  return value.replace(/\.0$/, "");
}

function renderBalance(provider) {
  const balance = provider.balance;
  const amount = formatMoney(balance.remaining, balance.unit);
  const extra = balance.extra
    ? [
        moneyPart("充值", balance.extra.toppedUpBalance, balance.unit),
        moneyPart("赠送", balance.extra.grantedBalance, balance.unit),
      ]
        .filter(Boolean)
        .join(" / ")
    : "";

  return `
    <div class="balance-box">
      ${renderBalanceUsage(provider.usage)}
      <div class="balance-value-row">
        <span class="balance-label">${escapeHtml(balance.planName || "余额")}</span>
        <strong>${amount}</strong>
      </div>
      <div class="balance-meter" aria-hidden="true"></div>
      ${extra ? `<p>${escapeHtml(extra)}</p>` : ""}
    </div>
  `;
}

function renderBalanceUsage(usage) {
  if (!usage) return "";
  const cost = usage.costUsd == null
    ? "$--"
    : `${usage.partialCost ? "≥ " : ""}${formatUsageCost(usage.costUsd, usage.currency || "USD")}`;
  const costLabel = usage.estimated ? "估算" : "消费";
  const title = usage.estimated
    ? "根据本机会话 Token 和模型公开 API 价格估算"
    : "由余额接口直接返回的今日用量";
  return `
    <div class="tier-usage balance-usage" title="${title}">
      <span class="usage-scope">${escapeHtml(usage.scope || "用量")}</span>
      <span><strong>${Math.max(0, Number(usage.requests) || 0)}</strong> 次请求</span>
      <span><strong>${formatCompactTokens(usage.totalTokens)}</strong> Token</span>
      <span class="tier-cost">${costLabel} <strong>${cost}</strong></span>
    </div>
  `;
}

function renderProviderMessage(provider) {
  const message = provider.message || "暂无额度数据";
  return `<div class="empty-row">${escapeHtml(message)}</div>`;
}

function renderEmpty() {
  return `
    <article class="empty-state">
      <h2>没有启用供应商</h2>
      <p>打开设置并至少启用一个供应商。</p>
    </article>
  `;
}

function formatUpdated(timestamp) {
  if (!timestamp) return "等待首次刷新";
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60000) return "刚刚更新";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  return `${Math.floor(minutes / 60)} 小时前更新`;
}

function countdown(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  const diff = time - Date.now();
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0) return { relative: "已到重置时间", absolute: formatResetAbsolute(time), tone: "is-danger" };
  const minutes = Math.floor(diff / 60000);
  const relative = minutes < 60
    ? `${minutes} 分钟后`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后`
      : `${Math.floor(minutes / 1440)} 天 ${Math.floor((minutes % 1440) / 60)} 小时后`;
  const tone = minutes <= 60 ? "is-soon" : minutes <= 360 ? "is-watch" : "";
  return { relative, absolute: formatResetAbsolute(time), tone };
}

function formatResetAbsolute(time) {
  const date = new Date(time);
  const today = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const offset = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - start) / dayMs);
  const timeText = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (offset === 0) return `今天 ${timeText}`;
  if (offset === 1) return `明天 ${timeText}`;
  return `${date.toLocaleDateString("zh-CN", { weekday: "short" })} ${timeText}`;
}

function formatMoney(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "unknown";
  const number = Number(value);
  if (unit === "USD") return `$${number.toFixed(2)}`;
  if (unit === "CNY") return `\uFFE5${number.toFixed(2)}`;
  return `${number.toFixed(2)} ${unit || ""}`.trim();
}

function moneyPart(label, value, unit) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return `${label}: ${formatMoney(value, unit)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\u0060/g, "&#96;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function queueLayoutReport() {
  if (layoutReportQueued) return;
  layoutReportQueued = true;
  requestAnimationFrame(() => {
    layoutReportQueued = false;
    reportLayoutHeight();
  });
}

function reportLayoutHeight() {
  const shell = root.querySelector(".panel-shell");
  const providerList = root.querySelector(".provider-list");
  if (!shell || !providerList) return;

  const providerCount = (snapshot.providers || []).length;
  const rootStyle = getComputedStyle(root);
  // Detail view renders a single .provider-detail wrapper (card + usage
  // charts). The card-count formula below is only valid for the overview
  // list — on the detail page it measures one <article> and misses the
  // usage detail, briefly reporting a drastically short height right after
  // the popup becomes visible (the shrink-then-grow resize storm that
  // paints over the provider selector row).
  const isDetailView = Boolean(providerList.querySelector(":scope > .provider-detail"));
  // Prefer the list's actual class (set by the content-overflow check) over
  // the raw count, so a single tall card that was upgraded to scrollable
  // reports a bounded height instead of its full natural height.
  const isScrollable = !isDetailView &&
    (providerList.classList.contains("is-scrollable") || providerCount > MAX_VISIBLE_PROVIDERS);
  const desiredHeight = isDetailView
    ? measureDetailLayoutHeight(shell, providerList, rootStyle)
    : isScrollable
      ? measureScrollableLayoutHeight(shell, providerList, rootStyle)
      : measureStaticLayoutHeight(shell, rootStyle);

  if (Math.abs(desiredHeight - lastReportedHeight) > 1) {
    // 详情视图在同一布局形态内不回传明显更矮的瞬时高度（图表在 innerHTML
    // 重建后重新排布的瞬间会短暂塌陷）：可见窗口先缩后涨会触发透明窗口的
    // 绘制残影，把顶部供应商选择器行盖住。真正的收缩都会伴随布局形态变化
    // （档位/用量行增删），那时 lastReportedHeight 已被重置，不受此限制。
    if (isDetailView && lastReportedHeight > 0 && desiredHeight < lastReportedHeight - 24) return;
    lastReportedHeight = desiredHeight;
    window.codingPlanBar.resize(desiredHeight, snapshot.layoutKey || providerLayoutKey(snapshot.providers));
  }
}

function measureStaticLayoutHeight(shell, rootStyle) {
  const footer = shell.querySelector(".footer");
  if (!footer) return Math.ceil(root.getBoundingClientRect().height);

  const rootRect = root.getBoundingClientRect();
  const footerRect = footer.getBoundingClientRect();
  return Math.ceil(footerRect.bottom - rootRect.top) + parsePixel(rootStyle.paddingBottom);
}

function upgradeToScrollableIfOverflowing(list) {
  requestAnimationFrame(() => {
    if (!list.classList.contains("is-static")) return;
    const shell = root.querySelector(".panel-shell");
    if (!shell) return;
    const rootStyle = getComputedStyle(root);
    const fullHeight = measureStaticLayoutHeight(shell, rootStyle);
    if (fullHeight > window.innerHeight + 1) {
      list.classList.replace("is-static", "is-scrollable");
      queueLayoutReport();
    }
  });
}

function measureScrollableLayoutHeight(shell, providerList, rootStyle) {
  const cards = Array.from(providerList.querySelectorAll(":scope > article"));
  const visibleCount = MAX_VISIBLE_PROVIDERS;
  const listStyle = getComputedStyle(providerList);
  const listPadding =
    parsePixel(listStyle.paddingTop) + parsePixel(listStyle.paddingBottom);
  const listGap = parsePixel(listStyle.rowGap || listStyle.gap);
  const visibleCards = cards.slice(0, visibleCount);
  const cardHeight = visibleCards.reduce(
    (total, card) => total + Math.ceil(card.getBoundingClientRect().height),
    0,
  );
  const listHeight =
    visibleCards.length > 0
      ? listPadding + cardHeight + Math.max(0, visibleCards.length - 1) * listGap
      : Math.ceil(providerList.scrollHeight);

  const shellStyle = getComputedStyle(shell);
  const fixedHeight = [
    ".header",
    ".provider-selector",
    ".fatal",
    ".footer",
  ].reduce((total, selector) => {
    const element = shell.querySelector(selector);
    return total + (element ? Math.ceil(element.getBoundingClientRect().height) : 0);
  }, 0);
  return (
    parsePixel(rootStyle.paddingTop) +
    parsePixel(rootStyle.paddingBottom) +
    parsePixel(shellStyle.borderTopWidth) +
    parsePixel(shellStyle.borderBottomWidth) +
    fixedHeight +
    Math.ceil(listHeight)
  );
}

function measureDetailLayoutHeight(shell, providerList, rootStyle) {
  const shellStyle = getComputedStyle(shell);
  const listStyle = getComputedStyle(providerList);
  const detail = providerList.querySelector(":scope > .provider-detail");
  const detailHeight = detail
    ? Math.ceil(detail.getBoundingClientRect().height)
    : Math.ceil(providerList.scrollHeight);
  const listHeight =
    parsePixel(listStyle.paddingTop) +
    parsePixel(listStyle.paddingBottom) +
    detailHeight;
  const fixedHeight = [
    ".header",
    ".provider-selector",
    ".fatal",
    ".footer",
  ].reduce((total, selector) => {
    const element = shell.querySelector(selector);
    return total + (element && !element.hidden ? Math.ceil(element.getBoundingClientRect().height) : 0);
  }, 0);
  return (
    parsePixel(rootStyle.paddingTop) +
    parsePixel(rootStyle.paddingBottom) +
    parsePixel(shellStyle.borderTopWidth) +
    parsePixel(shellStyle.borderBottomWidth) +
    fixedHeight +
    listHeight
  );
}

function providerLayoutKey(providers = []) {
  const selection = selectedProviderId || "all";
  return `sel:${selection}|${providers
    .map((provider) => {
      const tierCount = Array.isArray(provider.tiers) ? provider.tiers.length : 0;
      const usageCount = Array.isArray(provider.tiers) ? provider.tiers.filter((tier) => tier.usage).length : 0;
      const shape = provider.balance
        ? `balance:${provider.usage ? 1 : 0}:${provider.platformUsage ? (provider.platformUsage.error ? "perr" : `p${provider.platformUsage.daily?.length || 0}`) : ""}`
        : `tiers:${tierCount}:${provider.usageHistory ? "rich" : "plain"}`;
      return `${provider.id || provider.name}:${provider.kind || ""}:${shape}:usage:${usageCount}:${provider.message ? 1 : 0}`;
    })
    .join("|")}`;
}

function parsePixel(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

render();
