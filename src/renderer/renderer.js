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
};

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
let prevSnapshotUpdatedAt = null;

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
});

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
  const refreshingClass = isDataRefresh ? "is-refreshing" : "";

  // Preserve scroll position across full re-renders so the list doesn't snap
  // back to the top when data refreshes while the user is scrolled down.
  const prevList = root.querySelector(".provider-list");
  const savedScroll = prevList ? prevList.scrollTop : 0;

  root.innerHTML = `
    <section class="panel-shell ${snapshot.loading ? "is-loading" : ""} density-${snapshot.panelDensity === "compact" ? "compact" : "comfortable"}">
      <header class="header">
        <div>
          <h1>Coding Plan Bar</h1>
          <p>${snapshot.loading ? "正在刷新..." : formatUpdated(snapshot.updatedAt)}</p>
        </div>
        <div class="header-actions">
          <button class="icon-button ${snapshot.loading ? "is-spinning" : ""}" data-action="refresh" title="刷新" aria-label="刷新">${ICONS.refresh}</button>
          <button class="icon-button" data-action="config" title="设置" aria-label="设置">${ICONS.settings}</button>
        </div>
      </header>

      <section class="provider-list ${providers.length > 3 ? "is-scrollable" : "is-static"}">
        ${providers.length ? providers.map((provider, index) => renderProvider(provider, index, fresh, refreshingClass)).join("") : renderEmpty()}
      </section>

      ${snapshot.fatalError ? `<div class="fatal">${escapeHtml(snapshot.fatalError)}</div>` : ""}

      <footer class="footer">
        <span>自动 ${Math.round((snapshot.refreshIntervalSeconds || 300) / 60)} 分钟</span>
        <span>${snapshot.elapsedMs ? `${snapshot.elapsedMs}ms` : "空闲"}</span>
        <button class="footer-button" data-action="quit">退出</button>
      </footer>
      <div class="pointer" aria-hidden="true"></div>
    </section>
  `;

  root.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
    window.codingPlanBar.refresh();
  });
  root.querySelector('[data-action="config"]')?.addEventListener("click", () => {
    window.codingPlanBar.openConfig();
  });
  root.querySelector('[data-action="quit"]')?.addEventListener("click", () => {
    window.codingPlanBar.quit();
  });

  // Restore scroll position now that the new list is in the DOM.
  const newList = root.querySelector(".provider-list");
  if (newList && savedScroll) newList.scrollTop = savedScroll;

  // Clear the refresh highlight shortly after it plays so a subsequent
  // snapshot can retrigger it cleanly.
  if (isDataRefresh) {
    const title = root.querySelector(".header h1");
    const list = root.querySelector(".provider-list");
    title?.classList.add("is-just-refreshed");
    list?.classList.add("is-refreshing-list");
    window.clearTimeout(refreshHighlightTimer);
    refreshHighlightTimer = window.setTimeout(() => {
      root.querySelectorAll(".provider.is-refreshing").forEach((el) => el.classList.remove("is-refreshing"));
      title?.classList.remove("is-just-refreshed");
      list?.classList.remove("is-refreshing-list");
    }, 750);
  }

  queueLayoutReport();
}

let refreshHighlightTimer = null;

function renderProvider(provider, index, fresh, refreshing) {
  const classes = ["provider", `status-${provider.status}`, providerAlertClass(provider), fresh ? "is-fresh" : "", refreshing]
    .filter(Boolean)
    .join(" ");
  const enterStyle = fresh ? ` style="--enter-delay:${Math.min(index, 4) * 45}ms"` : "";
  const body = provider.balance
    ? renderBalance(provider)
    : provider.tiers?.length
      ? renderTiers(provider.tiers)
      : renderProviderMessage(provider);

  return `
    <article class="${classes}"${enterStyle}>
      <div class="provider-top">
        <div class="provider-title">
          <span class="status-dot"></span>
          <div>
            <h2>${escapeHtml(provider.name)}</h2>
            <p>${provider.planLabel ? escapeHtml(provider.planLabel) : provider.kindLabel || provider.kind}</p>
          </div>
        </div>
        <span class="status-pill">${escapeHtml(STATUS_TEXT[provider.status] || provider.statusText || provider.status)}</span>
      </div>
      ${body}
      ${provider.failure ? `<p class="message failure-help"><strong>${escapeHtml(provider.failure.label)}：</strong>${escapeHtml(provider.failure.action)}</p>` : provider.message ? `<p class="message">${escapeHtml(provider.message)}</p>` : ""}
    </article>
  `;
}

function providerAlertClass(provider) {
  if (["error", "expired", "missing"].includes(provider.status)) return "is-attention";
  const maxUtilization = Math.max(0, ...(provider.tiers || []).map((tier) => Number(tier.utilization || 0)));
  if (maxUtilization >= 90) return "is-attention";
  if (maxUtilization >= 75) return "is-watch";
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
  const reset = countdown(tier.resetsAt);
  const usd =
    tier.usedValueUsd != null && tier.maxValueUsd != null
      ? `<span class="usd">$${Number(tier.usedValueUsd).toFixed(2)} / $${Number(tier.maxValueUsd).toFixed(2)}</span>`
      : "";

  return `
    <div class="tier">
      ${renderTierUsage(tier.usage)}
      <div class="tier-line">
        <span>${escapeHtml(tier.label || tier.name)}</span>
        <strong>已用 ${Math.round(utilization)}%</strong>
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
      <div class="balance-meter">
        <div class="balance-mark"></div>
      </div>
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
  const desiredHeight =
    providerCount <= 3
      ? measureStaticLayoutHeight(shell, rootStyle)
      : measureScrollableLayoutHeight(shell, providerList, rootStyle);

  if (Math.abs(desiredHeight - lastReportedHeight) > 1) {
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

function measureScrollableLayoutHeight(shell, providerList, rootStyle) {
  const cards = Array.from(providerList.querySelectorAll(":scope > article"));
  const visibleCount = 3;
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

function providerLayoutKey(providers = []) {
  return providers
    .map((provider) => {
      const tierCount = Array.isArray(provider.tiers) ? provider.tiers.length : 0;
      const usageCount = Array.isArray(provider.tiers) ? provider.tiers.filter((tier) => tier.usage).length : 0;
      const shape = provider.balance ? `balance:${provider.usage ? 1 : 0}` : `tiers:${tierCount}`;
      return `${provider.id || provider.name}:${provider.kind || ""}:${shape}:usage:${usageCount}:${provider.message ? 1 : 0}`;
    })
    .join("|");
}

function parsePixel(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

render();
