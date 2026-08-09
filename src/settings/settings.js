/* global motionDelay, formatBytes, formatDuration, displayVersion, releaseNotesPreview,
   maskSecret, safeProviderPreview, shortId, normalizeText, escapeHtml, escapeAttr,
   expiryState,
   applyAgentUsagePayload, refreshAgentUsageNavigation,
   renderAgentUsagePage, loadAgentUsage */

const root = document.getElementById("settings");

const KIND_LABELS = {
  "official-subscription": "官方订阅",
  "coding-plan": "Coding Plan",
  balance: "余额查询",
  manual: "手动额度",
};

let state = {
  configPath: "",
  config: {
    refreshIntervalSeconds: 300,
    showOnHover: true,
    panelDensity: "comfortable",
    theme: "light",
    privacy: {
      suppressAdvancedJsonWarning: false,
      suppressBackupWarning: false,
      suppressImportWarning: false,
    },
    proxy: {
      mode: "system",
      url: "",
    },
    autoUpdate: { enabled: true },
    importHistory: [],
    providers: [],
  },
  templates: [],
  snapshot: { providers: [], loading: false, updatedAt: null },
  selectedId: null,
  // "providers" shows the provider editor; auxiliary views show health, backup/security, and updates.
  view: "providers",
  updater: {
    status: "idle",
    result: null,
    progress: null,
    error: null,
    checkedAt: null,
  },
  agentUsage: {
    loading: false,
    data: null,
    error: null,
    stale: false,
    savedAt: null,
  },
  agentUsageSource: "codex",
  status: "正在读取设置...",
  statusIsError: false,
  statusTone: "loading",
  dirty: false,
  showTemplates: false,
  templatesClosing: false,
  templateOrigin: null,
  openDropdown: null,
  closingDropdown: null,
  importPreview: null,
  importPreviewClosing: false,
  importRaw: "",
  pasteOpen: false,
  backupPreview: null,
  accountFilter: "all",
  accountQuery: "",
  testCodexResult: null,
  chatProbe: {
    providerId: null,
    models: [],
    modelsLoading: false,
    modelsLoaded: false,
    selectedModel: "",
    prompt: "hi",
    status: "idle",
    streamingText: "",
    meta: null,
    error: null,
  },
};

let templatesCloseTimer = null;
let importPreviewCloseTimer = null;
let dropdownCloseTimer = null;
let dialogOrigin = null;
let hasRenderedSettingsShell = false;
let providerDrag = { sourceId: null, targetId: null, position: null };

function rememberDialogOrigin(element) {
  dialogOrigin = {
    action: element?.dataset?.action || "",
    field: element?.dataset?.field || "",
  };
}

function restoreDialogFocus() {
  const origin = dialogOrigin;
  dialogOrigin = null;
  if (!origin?.action) return;
  requestAnimationFrame(() => {
    const action = cssEscape(origin.action);
    const field = origin.field ? `[data-field="${cssEscape(origin.field)}"]` : "";
    root.querySelector(`[data-action="${action}"]${field}`)?.focus();
  });
}

function activeDialog() {
  return root.querySelector(".template-popover:not(.is-leaving), .paste-popover, .import-popover:not(.is-leaving)");
}

function focusDialog(dialog, selector) {
  requestAnimationFrame(() => {
    const target = dialog?.querySelector(selector) || dialog?.querySelector("button:not([disabled]), input:not([disabled]), textarea:not([disabled])");
    target?.focus();
  });
}

function trapDialogFocus(event, dialog) {
  const controls = [...dialog.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
    .filter((element) => !element.closest("[hidden]"));
  if (!controls.length) return;
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

window.addEventListener("click", (event) => {
  // Only re-render when we actually need to close an open provider picker.
  // Re-rendering on every click destroys <select> dropdowns and input focus.
  if (state.openDropdown && !event.target.closest(".custom-select")) {
    closeDropdown({ restoreFocus: false });
    return;
  }
  if (state.importPreview && !state.importPreviewClosing) {
    if (event.target.closest(".import-popover") || event.target.closest("[data-action='import-accounts']")) return;
    closeImportPreview();
    return;
  }
  if (!state.showTemplates || state.templatesClosing) return;
  if (event.target.closest(".template-popover") || event.target.closest("[data-action='toggle-templates']")) {
    return;
  }
  closeTemplates();
});

document.addEventListener("keydown", (event) => {
  const dialog = activeDialog();
  if (event.key === "Escape") {
    if (state.openDropdown) {
      event.preventDefault();
      closeDropdown({ restoreFocus: true });
      return;
    }
    if (state.importPreview && !state.importPreviewClosing) {
      event.preventDefault();
      closeImportPreview();
      return;
    }
    if (state.pasteOpen) {
      event.preventDefault();
      closePasteImport();
      return;
    }
    if (state.showTemplates && !state.templatesClosing) {
      event.preventDefault();
      closeTemplates();
    }
    return;
  }
  if (event.key === "Tab" && dialog) trapDialogFocus(event, dialog);
});

load();

// Subscribe to update state pushed from the main process, and pull the current
// state once on load so the update page reflects any background auto-check.
let lastUpdaterStatus = "idle";
window.codingPlanBar.onSnapshot((next) => {
  state.snapshot = next || state.snapshot;
  if (state.view === "health") {
    render();
    return;
  }
  if (state.view === "providers" && root.childElementCount) {
    refreshProviderRuntimeState();
  }
});

if (typeof window.codingPlanBar.onConfigChanged === "function") {
  window.codingPlanBar.onConfigChanged((payload) => {
    if (!payload?.config || state.dirty) return;
    const selectedId = state.selectedId;
    state.config = sanitizeConfig(cloneConfig(payload.config));
    state.configPath = payload.configPath || state.configPath;
    state.selectedId = state.config.providers.some((provider) => provider.id === selectedId)
      ? selectedId
      : state.config.providers[0]?.id || null;
    state.status = "供应商顺序已同步";
    state.statusTone = "success";
    render();
  });
}

if (typeof window.codingPlanBar.onAgentUsageSnapshot === "function") {
  window.codingPlanBar.onAgentUsageSnapshot((payload) => {
    applyAgentUsagePayload(payload);
    if (state.view === "usage") render();
    else if (root.childElementCount) refreshAgentUsageNavigation();
  });
}

if (typeof window.codingPlanBar.onProbeEvent === "function") {
  window.codingPlanBar.onProbeEvent((payload) => handleProbeEvent(payload));
}

window.codingPlanBar.onUpdaterState((next) => {
  const statusChanged = next.status !== lastUpdaterStatus;
  lastUpdaterStatus = next.status;
  state.updater = next;
  // The update view needs progress renders. Other views only patch the
  // navigation badge so composing text in the provider editor is never lost.
  if (state.view === "update") {
    render();
  } else if (statusChanged && root.childElementCount) {
    refreshUpdaterNavigation();
  }
});
// Best-effort initial state pull; guarded so environments without the updater
// IPC (e.g. capture scripts) don't crash.
if (typeof window.codingPlanBar.getUpdaterState === "function") {
  window.codingPlanBar
    .getUpdaterState()
    .then((initial) => {
      state.updater = initial;
      if (root.childElementCount) {
        if (state.view === "update") render();
        else refreshUpdaterNavigation();
      }
    })
    .catch(() => {});
}

async function load() {

  state.status = "正在读取设置...";
  state.statusIsError = false;
  state.statusTone = "loading";
  if (root.childElementCount) render();
  try {
    const payload = await window.codingPlanBar.getConfig();
    state.configPath = payload.configPath;
    state.config = sanitizeConfig(cloneConfig(payload.config));
    state.snapshot = payload.snapshot || state.snapshot;
    state.templates = payload.templates || [];
    applyTheme();
    state.selectedId = state.config.providers[0]?.id || null;
    state.status = "设置已载入";
    state.statusIsError = false;
    if (payload.agentUsage) applyAgentUsagePayload(payload.agentUsage);
    state.statusTone = "success";
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
  }
  render();
}

function refreshUpdaterNavigation() {
  const button = root.querySelector("[data-action='show-update']");
  if (!button) return;
  const available = state.updater.status === "available";
  button.querySelector(".nav-dot")?.classList.toggle("has-update", available);
  const badge = button.querySelector(".nav-badge");
  if (available && !badge) {
    button.insertAdjacentHTML("beforeend", '<span class="nav-badge">新版本</span>');
  } else if (!available) {
    badge?.remove();
  }
}

function render() {
  syncSelectedProviderWithFilters();
  applyTheme();
  const selected = selectedProvider();
  const enterClass = hasRenderedSettingsShell ? "" : "is-entering";
  root.innerHTML = `
    <section class="settings-shell ${enterClass}">
      <header class="topbar">
        <h1>设置</h1>
        <div class="top-actions">
          <button class="btn" data-action="refresh">重新读取</button>
          <button class="btn" data-action="open-json">高级 JSON</button>
        </div>
      </header>

      <section class="settings-body">
        <aside class="sidebar">
          <div class="sidebar-head">
            <strong>账号与供应商</strong>
            <div class="sidebar-head-actions">
              <button class="btn small" data-action="latest-import" title="从 Downloads 查找最新 Claude 或 CPA 账号 JSON">最新文件</button>
              <button class="btn small" data-action="import-accounts">导入</button>
              <button class="btn small primary" data-action="toggle-templates">添加</button>
            </div>
          </div>
          ${renderAccountTools()}
          <div class="provider-list has-bar ${state.view === "providers" ? "" : "is-dimmed"}">
            <div class="selection-bar" aria-hidden="true"></div>
            ${renderProviderList()}
          </div>
          <nav class="sidebar-nav">
            <button class="nav-item ${state.view === "usage" ? "is-active" : ""}" data-action="show-usage">
              <span class="nav-dot ${state.agentUsage.error ? "has-alert" : ""}"></span>
              Agent 用量
            </button>
            <button class="nav-item ${state.view === "health" ? "is-active" : ""}" data-action="show-health">
              <span class="nav-dot ${healthSummary().attention ? "has-alert" : ""}"></span>
              诊断中心
            </button>
            <button class="nav-item ${state.view === "backup" ? "is-active" : ""}" data-action="show-backup">
              <span class="nav-dot"></span>
              备份与安全
            </button>
            <button class="nav-item ${state.view === "update" ? "is-active" : ""}" data-action="show-update">
              <span class="nav-dot ${state.updater.status === "available" ? "has-update" : ""}"></span>
              关于与更新
              ${state.updater.status === "available" ? '<span class="nav-badge">新版本</span>' : ""}
            </button>
          </nav>
        </aside>

        <section class="editor">
          ${
            state.view === "usage"
              ? renderAgentUsagePage()
              : state.view === "update"
                ? renderUpdatePage()
              : state.view === "health"
                ? renderHealthPage()
                : state.view === "backup"
                  ? renderBackupPage()
                  : selected
                    ? renderEditor(selected)
                    : `<div class="empty"><div><strong>没有供应商</strong><p class="hint">点击左侧“添加”创建一个供应商。</p></div></div>`
          }
        </section>
      </section>

      <footer class="bottom-bar">
        <span class="status ${state.statusIsError ? "is-error" : ""} ${state.statusTone ? `is-${state.statusTone}` : ""}">${escapeHtml(state.status)}</span>
        <div class="bottom-actions">
          ${state.view === "backup" ? `<button class="btn" data-action="backup-config">备份 config.json</button>` : ""}
          ${state.view === "update" ? `<button class="btn" data-action="check-update">检查更新</button>` : ""}
          <span class="dirty-actions">${renderDirtyActions()}</span>
        </div>
      </footer>

      ${renderImportPreview()}
      ${renderPasteDialog()}
    </section>
  `;

  hasRenderedSettingsShell = true;
  bindEvents();
  positionSelectionBar();
  if (lastSelectedId !== state.selectedId) {
    flashFormSwap();
  }
  lastSelectedId = state.selectedId;
}

let lastSelectedId = null;

/* Translate the shared selection bar to cover the active provider row.
   Called after every render so the bar glides instead of jumping. */
function positionSelectionBar() {
  const list = root.querySelector(".provider-list");
  const bar = list?.querySelector(".selection-bar");
  const selected = list?.querySelector(".provider-item.is-selected");
  if (!list || !bar) return;
  if (!selected) {
    bar.style.opacity = "0";
    return;
  }
  const y = selected.offsetTop;
  bar.style.transform = `translateY(${y}px)`;
  bar.style.width = `${selected.offsetWidth}px`;
  bar.style.height = `${selected.offsetHeight + 6}px`;
  bar.style.opacity = "1";
}

/* Briefly flag the editor so the form cross-fades on provider switch. */
function flashFormSwap() {
  const editor = root.querySelector(".editor");
  if (!editor) return;
  editor.classList.remove("is-swapping");
  void editor.offsetWidth;
  editor.classList.add("is-swapping");
  window.setTimeout(() => editor.classList.remove("is-swapping"), 220);
}

function renderAccountTools() {
  return `
    <div class="account-tools">
      <label class="account-search" aria-label="搜索账号">
        <span>搜索</span>
        <input data-action="account-search" value="${escapeAttr(state.accountQuery || "")}" placeholder="邮箱 / accountId / 名称" />
      </label>
      <div class="account-filters" role="group" aria-label="账号筛选">
        ${renderAccountFilter("all", "全部")}
        ${renderAccountFilter("accounts", "官方")}
        ${renderAccountFilter("imported", "导入账号")}
        ${renderAccountFilter("balance", "余额")}
        ${renderAccountFilter("attention", "需处理")}
        ${renderAccountFilter("disabled", "停用")}
      </div>
    </div>
  `;
}

function renderAccountFilter(value, label) {
  return `<button class="account-filter ${state.accountFilter === value ? "is-active" : ""}" data-action="account-filter" data-filter="${escapeAttr(value)}" aria-pressed="${state.accountFilter === value ? "true" : "false"}">${escapeHtml(label)}</button>`;
}

function renderProviderList() {
  if (!state.config.providers.length) return renderEmptyList();
  const providers = filteredProviders();
  if (!providers.length) return `<div class="empty"><p class="hint">没有匹配的账号或供应商。</p></div>`;
  return providers.map(renderProviderItem).join("");
}

function filteredProviders() {
  return state.config.providers.filter((provider) => matchesAccountFilter(provider) && matchesAccountQuery(provider));
}

function syncSelectedProviderWithFilters() {
  if (state.view !== "providers") return;
  if (!state.config.providers.length) return;
  const selected = selectedProvider();
  if (selected && matchesAccountFilter(selected) && matchesAccountQuery(selected)) return;
  state.selectedId = filteredProviders()[0]?.id || null;
}

function matchesAccountFilter(provider) {
  const filter = state.accountFilter || "all";
  if (filter === "all") return true;
  if (filter === "accounts") return (provider.kind === "official-subscription" && !["claude", "cpa", "sub2api"].includes(provider.importedFrom)) || provider.kind === "coding-plan";
  if (filter === "imported") return provider.kind === "official-subscription" && ["claude", "cpa", "sub2api"].includes(provider.importedFrom);
  if (filter === "balance") return provider.kind === "balance";
  if (filter === "disabled") return provider.enabled === false;
  if (filter === "attention") return providerNeedsAttention(provider);
  return true;
}

function matchesAccountQuery(provider) {
  const query = normalizeText(state.accountQuery);
  if (!query) return true;
  return providerSearchText(provider).includes(query);
}

function providerSearchText(provider) {
  return normalizeText([
    provider.id,
    provider.name,
    provider.kind,
    provider.tool,
    provider.importedFrom,
    provider.accountEmail,
    provider.accountId,
    provider.accountUserId,
    provider.planType,
    provider.baseUrl,
    provider.importKey,
  ].filter(Boolean).join(" "));
}

function providerNeedsAttention(provider) {
  const runtime = runtimeProvider(provider.id);
  const expiry = provider.expiresAt ? expiryState(provider.expiresAt) : null;
  const maxUsage = Math.max(0, ...(runtime?.tiers || []).map((tier) => Number(tier.utilization || 0)));
  if (provider.enabled === false) return false;
  return (
    ["error", "expired", "missing", "danger"].includes(runtime?.status) ||
    Boolean(runtime?.failure) ||
    Boolean(expiry?.expired || expiry?.soon) ||
    maxUsage >= 90
  );
}

function runtimeProvider(id) {
  return (state.snapshot.providers || []).find((provider) => provider.id === id) || null;
}

function renderProviderItem(provider) {
  const selected = provider.id === state.selectedId ? "is-selected" : "";
  const detail = providerDetail(provider);
  const badge = providerBadge(provider);
  const attention = providerNeedsAttention(provider) ? "is-attention" : "";
  return `
    <div class="provider-item ${selected} ${attention}" data-id="${escapeAttr(provider.id)}">
      <button class="provider-select" type="button" data-action="select-provider" data-id="${escapeAttr(provider.id)}" aria-pressed="${provider.id === state.selectedId ? "true" : "false"}" aria-label="选择 ${escapeAttr(provider.name || provider.id)}">
        <span class="dot ${provider.enabled === false ? "is-off" : badge.tone === "danger" ? "is-danger" : badge.tone === "warn" ? "is-warn" : ""}"></span>
        <span class="provider-name">
          <strong>${escapeHtml(provider.name || provider.id)}</strong>
          <span>${escapeHtml(detail)}</span>
        </span>
        <span class="provider-badge is-${escapeAttr(badge.tone)}">${escapeHtml(badge.label)}</span>
      </button>
      <button class="drag-handle" type="button" draggable="true" data-action="drag-provider" data-id="${escapeAttr(provider.id)}" title="Alt + 上下方向键调整顺序" aria-label="调整 ${escapeAttr(provider.name || provider.id)} 的显示顺序。按 Alt 加上方向键或下方向键移动。">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
      </button>
      <label class="switch" title="启用">
        <input type="checkbox" data-action="toggle-enabled" data-id="${escapeAttr(provider.id)}" aria-label="启用 ${escapeAttr(provider.name || provider.id)}" ${provider.enabled !== false ? "checked" : ""} />
        <span></span>
      </label>
    </div>
  `;
}

function providerDetail(provider) {
  if (provider.kind === "official-subscription") {
    const parts = [];
    if (provider.importedFrom === "claude") parts.push("Claude 账号");
    else if (provider.importedFrom === "cpa") parts.push("CPA 账号");
    else if (provider.importedFrom === "sub2api") parts.push("sub2api 账号");
    else parts.push(KIND_LABELS[provider.kind]);
    if (provider.accountEmail) parts.push(provider.accountEmail);
    if (provider.accountId) parts.push(`ID ${shortId(provider.accountId)}`);
    if (provider.planType) parts.push(provider.planType);
    return parts.join(" · ");
  }
  return `${KIND_LABELS[provider.kind] || provider.kind}${provider.baseUrl ? ` · ${provider.baseUrl}` : ""}`;
}

function providerBadge(provider) {
  if (provider.enabled === false) return { label: "停用", tone: "muted" };
  const runtime = runtimeProvider(provider.id);
  const expiry = provider.expiresAt ? expiryState(provider.expiresAt) : null;
  const maxUsage = Math.max(0, ...(runtime?.tiers || []).map((tier) => Number(tier.utilization || 0)));
  if (["error", "missing"].includes(runtime?.status) || runtime?.failure) return { label: "失败", tone: "danger" };
  if (runtime?.status === "expired" || expiry?.expired) return { label: "过期", tone: "danger" };
  if (maxUsage >= 90 || runtime?.status === "danger") return { label: "紧张", tone: "danger" };
  if (expiry?.soon) return { label: "将过期", tone: "warn" };
  if (maxUsage >= 75 || runtime?.status === "warn") return { label: "关注", tone: "warn" };
  if (provider.importedFrom === "sub2api") return { label: "独立", tone: "info" };
  return { label: "正常", tone: "ok" };
}

function renderEmptyList() {
  return `<div class="empty"><p class="hint">还没有供应商。</p></div>`;
}

function renderUpdatePage() {
  const u = state.updater;
  const result = u.result || {};
  const currentVersion = displayVersion(result.currentVersion);
  const latestVersion = displayVersion(result.latestVersion);
  const checkedText = u.checkedAt ? new Date(u.checkedAt).toLocaleString("zh-CN") : "尚未检查";
  const publishedText = result.publishedAt ? new Date(result.publishedAt).toLocaleString("zh-CN") : "";
  const autoEnabled = state.config.autoUpdate ? state.config.autoUpdate.enabled !== false : true;
  const asset = result.asset || null;
  const releaseNotes = releaseNotesPreview(result.releaseNotes);

  // Derive the primary action button + status line from the updater state machine.
  let primary = "";
  let statusLine = "";
  if (u.status === "checking") {
    statusLine = "正在检查更新…";
  } else if (u.status === "downloading") {
    statusLine = "正在下载安装包…";
  } else if (u.status === "ready") {
    statusLine = "下载完成，可以安装。";
    primary = `<button class="btn primary" data-action="install-update">安装更新</button>`;
  } else if (u.status === "available") {
    statusLine = result.error
      ? `发现新版本 ${escapeHtml(latestVersion)}。${escapeHtml(result.error)}`
      : `发现新版本 ${escapeHtml(latestVersion)}。`;
    primary = asset
      ? `<button class="btn primary" data-action="download-update">下载更新</button>`
      : `<button class="btn primary" data-action="open-release" data-url="${escapeAttr(result.releaseUrl || "")}">手动下载</button>`;
  } else if (u.status === "latest") {
    statusLine = "当前已是最新版本。";
  } else if (u.status === "error") {
    statusLine = escapeHtml(u.error || "检查更新失败");
  } else {
    statusLine = "点击下方按钮检查是否有新版本。";
  }

  const checking = u.status === "checking" || u.status === "downloading";
  const progress = u.progress && u.progress.totalBytes > 0
    ? `${u.progress.percent}% · ${formatBytes(u.progress.downloadedBytes)} / ${formatBytes(u.progress.totalBytes)}`
    : u.status === "downloading"
      ? `${(u.progress && u.progress.percent) || 0}%`
      : "";
  const progressWidth = `${(u.progress && u.progress.percent) || 0}%`;

  return `
    <div class="editor-head">
      <div class="section-title">
        <strong>关于与更新</strong>
        <span>检查并安装新版本</span>
      </div>
    </div>
    <div class="form update-page">
      <div class="update-version-row">
        <div class="update-version">
          <span class="update-version-label">当前版本</span>
          <strong>${currentVersion !== "—" ? "v" : ""}${escapeHtml(currentVersion)}</strong>
        </div>
        <div class="update-version">
          <span class="update-version-label">最新版本</span>
          <strong class="${u.status === "available" ? "is-newer" : ""}">${latestVersion !== "—" ? "v" : ""}${escapeHtml(latestVersion)}</strong>
          ${publishedText ? `<span class="update-version-date">${escapeHtml(publishedText)}</span>` : ""}
        </div>
      </div>

      <div class="update-progress-wrap ${u.status === "downloading" || u.status === "ready" ? "is-visible" : ""}">
        <div class="update-progress-track"><div class="update-progress-bar" style="width:${progressWidth}"></div></div>
        <span class="update-progress-text">${escapeHtml(progress)}</span>
      </div>

      <p class="update-status ${u.status === "error" ? "is-error" : ""}">${statusLine}</p>

      ${asset ? `
        <div class="update-asset-card">
          <span>安装包</span>
          <strong>${escapeHtml(asset.name || "Windows x64 安装包")}</strong>
          <em>${asset.size ? formatBytes(asset.size) : "大小未知"}</em>
        </div>
      ` : ""}

      ${releaseNotes ? `
        <div class="update-notes-card">
          <strong>更新摘要</strong>
          <p>${escapeHtml(releaseNotes)}</p>
        </div>
      ` : ""}

      ${u.status === "available" && result.releaseUrl ? `<a class="update-release-link" href="#" data-action="open-release">查看 GitHub 发布详情</a>` : ""}

      <div class="update-actions">
        ${primary}
        <button class="btn" data-action="check-update" ${checking ? "disabled" : ""}>${checking ? "检查中…" : "检查更新"}</button>
        ${u.status === "available" && result.releaseUrl ? `<a class="btn" href="#" data-action="open-release">手动下载</a>` : ""}
      </div>

      <div class="section update-auto-section">
        <label class="update-auto">
          <input type="checkbox" data-action="toggle-auto-check" ${autoEnabled ? "checked" : ""} />
          <span>
            <strong>启动时自动检查更新</strong>
            <small>仅在后台检查并提示，不会自动下载或安装。</small>
          </span>
        </label>
        <p class="hint">上次检查：${escapeHtml(checkedText)}</p>
      </div>
    </div>
  `;
}

function renderHealthPage() {
  const rows = healthRows();
  const enabledCount = state.config.providers.filter((provider) => provider.enabled !== false).length;
  const updatedAt = state.snapshot.updatedAt ? new Date(state.snapshot.updatedAt).toLocaleString("zh-CN") : "尚未刷新";
  const nextRefresh = state.snapshot.refreshIntervalSeconds
    ? formatDuration(Number(state.snapshot.refreshIntervalSeconds) * 1000)
    : "5 分钟";
  return `
    <div class="editor-head">
      <div class="section-title">
        <strong>诊断中心</strong>
        <span>只显示需要关注的账号、token 过期、查询失败和额度风险。</span>
      </div>
      <button class="btn" data-action="refresh-quota">立即刷新</button>
    </div>
    <div class="form health-page">
      <div class="diagnostic-hero">
        <strong>${rows.length ? `${rows.length} 个项目需要处理` : "全部正常"}</strong>
        <span>${
          rows.length
            ? "点击左侧账号可以查看身份信息和本地配置摘要。"
            : `已检查 ${enabledCount} 个启用的供应商 · 上次刷新：${escapeHtml(updatedAt)} · 下次自动刷新：约 ${escapeHtml(nextRefresh)} 后`
        }</span>
      </div>
      <div class="health-list">
        ${rows.map(renderHealthRow).join("") || `<div class="empty"><p class="hint">当前没有失败、即将过期或额度偏高的账号。</p></div>`}
      </div>
    </div>
  `;
}

function renderHealthRow(row) {
  return `
    <div class="health-row is-${row.tone}">
      <span class="health-dot"></span>
      <span class="health-main">
        <strong>${escapeHtml(row.name)}</strong>
        <small>${escapeHtml(row.detail)}</small>
      </span>
      <span class="health-status">${escapeHtml(row.label)}</span>
      <span class="health-action">${escapeHtml(row.action)}</span>
    </div>
  `;
}

function healthRows() {
  const snapshots = new Map((state.snapshot.providers || []).map((provider) => [provider.id, provider]));
  return state.config.providers
    .filter((provider) => provider.enabled !== false)
    .map((provider) => healthRow(provider, snapshots.get(provider.id)))
    .filter((row) => row.tone !== "ok");
}

function healthRow(provider, runtime) {
  const expiry = provider.expiresAt ? expiryState(provider.expiresAt) : null;
  const status = runtime?.status || (expiry?.expired ? "expired" : "ok");
  const maxUsage = Math.max(0, ...(runtime?.tiers || []).map((tier) => Number(tier.utilization || 0)));
  const failure = runtime?.failure;
  let tone = "ok";
  let label = "可用";
  let action = "无需处理";
  if (provider.enabled === false) {
    tone = "warn";
    label = "已停用";
    action = "需要时可在左侧重新启用";
  } else if (["error", "missing"].includes(status)) {
    tone = "danger";
    label = failure?.label || runtime?.statusText || "查询失败";
    action = failure?.action || "检查配置后重新刷新";
  } else if (status === "expired" || expiry?.expired) {
    tone = "danger";
    label = "token 已过期";
    action = "重新登录或重新导入账号";
  } else if (maxUsage >= 90 || status === "danger") {
    tone = "danger";
    label = "额度接近上限";
    action = "等待重置或切换账号";
  } else if (expiry?.soon) {
    tone = "warn";
    label = "token 即将过期";
    action = `约 ${expiry.relative} 后过期`;
  }
  const source = provider.importedFrom ? `${provider.importedFrom} 导入` : KIND_LABELS[provider.kind] || provider.kind;
  const detail = [source, provider.accountEmail, expiry ? `过期：${expiry.absolute}` : null, runtime?.message].filter(Boolean).join(" · ");
  return {
    id: provider.id,
    name: provider.name || provider.id,
    tone,
    label,
    detail,
    action,
  };
}

function healthSummary(rows = healthRows()) {
  const summary = rows.reduce(
    (acc, row) => {
      if (row.tone === "danger") acc.danger += 1;
      else if (row.tone === "warn") acc.warn += 1;
      else acc.ok += 1;
      return acc;
    },
    { ok: 0, warn: 0, danger: 0, attention: 0 },
  );
  summary.attention = summary.warn + summary.danger;
  return summary;
}

function renderBackupPage() {
  return `
    <div class="editor-head">
      <div class="section-title">
        <strong>备份与安全</strong>
        <span>配置文件包含 token/API Key，请只保存到可信位置。</span>
      </div>
    </div>
    <div class="form backup-page">
      <div class="security-card is-danger">
        <strong>隐私提醒</strong>
        <p>导入源文件可能包含明文 token/API Key；config.json 与应用备份使用当前 Windows 用户的 DPAPI 加密。仍不要分享到聊天、Issue 或公共仓库。</p>
      </div>
      <label class="security-toggle">
        <input type="checkbox" data-field="suppressBackupWarning" ${state.config.privacy?.suppressBackupWarning ? "checked" : ""} />
        <span>备份/高级 JSON 操作不再提醒我（危险操作仍需确认）</span>
      </label>
      <div class="backup-actions">
        <button class="btn primary" data-action="backup-config">备份 config.json</button>
        <button class="btn" data-action="restore-config">从备份恢复</button>
        <button class="btn" data-action="open-json">打开高级 JSON</button>
      </div>
      ${renderProxySection()}
      ${renderDensitySection()}
      ${renderThemeSection()}
      <div class="section">
        <div class="section-title">
          <strong>最近导入</strong>
          <span>只显示安全摘要，不显示 token。</span>
        </div>
        <div class="history-list">
          ${(state.config.importHistory || []).slice(0, 8).map(renderHistoryItem).join("") || `<p class="hint">暂无导入记录。</p>`}
        </div>
      </div>
    </div>
  `;
}

function renderHistoryItem(item) {
  const time = item.importedAt ? new Date(item.importedAt).toLocaleString("zh-CN") : "未知时间";
  return `
    <div class="history-item">
      <strong>${escapeHtml(item.sourceLabel || "账号 JSON")}</strong>
      <span>${escapeHtml(time)} · ${escapeHtml(item.format || "accounts")} · 检测 ${Number(item.accountCount || 0)} / 新增 ${Number(item.importedCount || 0)} / 更新 ${Number(item.updatedCount || 0)} / 跳过 ${Number(item.skippedCount || 0)}</span>
      <small>${escapeHtml((item.identityMethods || []).join("、") || "身份方式未知")}</small>
    </div>
  `;
}

function renderProxySection() {
  const proxy = state.config.proxy || { mode: "system", url: "" };
  const mode = proxy.mode || "system";
  const showUrl = mode === "manual";
  return `
    <div class="section proxy-section">
      <div class="section-title">
        <strong>网络代理</strong>
        <span>让额度查询 / 测试连通 / 对话探测与浏览器出网一致。</span>
      </div>
      <div class="segmented">
        <button class="segment ${mode === "system" ? "is-active" : ""}" data-action="set-proxy-mode" data-mode="system">系统代理</button>
        <button class="segment ${mode === "direct" ? "is-active" : ""}" data-action="set-proxy-mode" data-mode="direct">直连</button>
        <button class="segment ${mode === "manual" ? "is-active" : ""}" data-action="set-proxy-mode" data-mode="manual">手动代理</button>
      </div>
      ${
        showUrl
          ? `
            <div class="field full" style="margin-top:10px">
              <label id="proxy-url-label">代理地址</label>
              <input data-field="proxyUrl" aria-labelledby="proxy-url-label" value="${escapeAttr(proxy.url || "")}" placeholder="例如：http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" />
              <p class="hint">支持 http / https / socks5。保存后立即生效，并用于后续额度刷新与连通性测试。</p>
            </div>
          `
          : `<p class="hint" style="margin-top:8px">${mode === "direct" ? "不使用任何代理，直接访问上游。" : "跟随 Windows 系统代理 / PAC（推荐，与浏览器行为一致）。"}</p>`
      }
    </div>
  `;
}

function renderDensitySection() {
  return `
    <div class="section density-section">
      <div class="section-title">
        <strong>额度面板密度</strong>
        <span>账号较多时可切换紧凑模式。</span>
      </div>
      <div class="segmented">
        <button class="segment ${state.config.panelDensity !== "compact" ? "is-active" : ""}" data-action="set-density" data-density="comfortable">舒适</button>
        <button class="segment ${state.config.panelDensity === "compact" ? "is-active" : ""}" data-action="set-density" data-density="compact">紧凑</button>
      </div>
    </div>
  `;
}

function renderThemeSection() {
  return `
    <div class="section theme-section">
      <div class="section-title">
        <strong>外观主题</strong>
        <span>切换面板和设置窗口的配色。</span>
      </div>
      <div class="segmented">
        <button class="segment ${state.config.theme !== "dark" ? "is-active" : ""}" data-action="set-theme" data-theme="light">浅色</button>
        <button class="segment ${state.config.theme === "dark" ? "is-active" : ""}" data-action="set-theme" data-theme="dark">深色</button>
      </div>
    </div>
  `;
}

function renderEditor(provider) {
  const showEndpointFields = provider.kind !== "official-subscription";
  const badge = providerBadge(provider);
  return `
    <div class="editor-head">
      <div class="section-title">
        <strong>${escapeHtml(provider.name || provider.id)}</strong>
        <span>${escapeHtml(KIND_LABELS[provider.kind] || provider.kind)}</span>
      </div>
      <div class="row-actions">
        <span class="provider-badge is-${escapeAttr(badge.tone)}">${escapeHtml(badge.label)}</span>
        <label class="switch" title="启用">
          <input type="checkbox" data-field="enabled" aria-label="启用 ${escapeAttr(provider.name || provider.id)}" ${provider.enabled !== false ? "checked" : ""} />
          <span></span>
        </label>
        ${
          provider.kind === "official-subscription" && (provider.tool || "codex") === "codex"
            ? `<button class="btn" data-action="test-codex" title="向 ChatGPT 后端发送一次额度查询请求">测试连通</button>`
            : ""
        }
        <button class="btn danger" data-action="delete-provider">删除</button>
      </div>
    </div>
    <form class="form">
      ${renderAccountDetailCard(provider)}
      ${renderChatProbeCard(provider)}
      <div class="form-grid">
        <div class="field">
          <label id="provider-id-label">供应商 ID</label>
          <input data-field="id" aria-labelledby="provider-id-label" value="${escapeAttr(provider.id)}" />
          <p class="hint">用于配置识别，只能包含字母、数字、下划线和短横线。</p>
        </div>
        <div class="field">
          <label id="provider-name-label">显示名称</label>
          <input data-field="name" aria-labelledby="provider-name-label" value="${escapeAttr(provider.name)}" />
        </div>
        <div class="field">
          <label id="provider-kind-label">供应商类型</label>
          ${renderCustomSelect("kind", provider.kind, [
            ["official-subscription", "官方订阅"],
            ["coding-plan", "Coding Plan 额度"],
            ["balance", "余额查询"],
            ["manual", "手动额度"],
          ], "provider-kind-label")}
        </div>
        ${
          provider.kind === "official-subscription"
            ? `
              <div class="field">
                <label id="provider-tool-label">官方工具</label>
                ${renderCustomSelect("tool", provider.tool || "codex", [
                  ["codex", "Codex"],
                  ["claude", "Claude"],
                  ["grok", "Grok"],
                ], "provider-tool-label")}
              </div>
            `
            : ""
        }
        ${
          showEndpointFields
            ? `
              <div class="field full">
                <label id="provider-base-url-label">请求地址 / Base URL</label>
                <input data-field="baseUrl" aria-labelledby="provider-base-url-label" value="${escapeAttr(provider.baseUrl || "")}" placeholder="例如：https://api.deepseek.com" />
                <p class="hint">Coding Plan 和余额查询需要填写官方接口地址。</p>
              </div>
              <div class="field">
                <label id="provider-api-key-label">API Key</label>
                <input data-field="apiKey" aria-labelledby="provider-api-key-label" type="password" value="${escapeAttr(provider.apiKey || "")}" placeholder="可留空，优先建议使用环境变量" />
              </div>
              <div class="field">
                <label id="provider-api-key-env-label">API Key 环境变量</label>
                <input data-field="apiKeyEnv" aria-labelledby="provider-api-key-env-label" value="${escapeAttr(apiKeyEnvToText(provider.apiKeyEnv))}" placeholder="例如：DEEPSEEK_API_KEY" />
                <p class="hint">多个环境变量用英文逗号分隔。</p>
              </div>
            `
            : `
              <div class="field full">
                ${renderOfficialNotice(provider)}
              </div>
            `
        }
      </div>

      <div class="section">
        <div class="section-title">
          <strong>当前 JSON 预览</strong>
          <span>保存时会写入同一个 config.json。</span>
        </div>
        <pre class="json-preview">${escapeHtml(JSON.stringify(safeProviderPreview(provider), null, 2))}</pre>
      </div>
    </form>
  `;
}

function renderAccountDetailCard(provider) {
  const runtime = runtimeProvider(provider.id);
  const expiry = provider.expiresAt ? expiryState(provider.expiresAt) : null;
  const rows = [
    ["来源", accountSourceLabel(provider)],
    ["邮箱", provider.accountEmail],
    ["accountId", provider.accountId ? shortId(provider.accountId) : ""],
    ["userId", provider.accountUserId ? shortId(provider.accountUserId) : ""],
    ["计划", provider.planType],
    ["token", provider.accessToken ? maskSecret(provider.accessToken) : ""],
    ["过期时间", expiry ? expiry.absolute : "未知"],
    ["最近状态", runtime ? providerBadge(provider).label : "等待刷新"],
  ].filter(([, value]) => value);

  if (!rows.length && provider.kind !== "official-subscription") return "";
  const testBlock = renderCodexTestBlock(provider);
  return `
    <div class="account-detail-card">
      <div>
        <strong>${escapeHtml(provider.importedFrom === "claude" ? "Claude 账号身份" : provider.importedFrom === "cpa" ? "CPA 账号身份" : provider.importedFrom === "sub2api" ? "sub2api 独立额度身份" : "账号身份")}</strong>
        <span>${escapeHtml(identityHelpText(provider))}</span>
      </div>
      <dl>
        ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      </dl>
      ${runtime?.failure ? `<p class="diagnostic-tip"><strong>${escapeHtml(runtime.failure.label)}：</strong>${escapeHtml(runtime.failure.action)}</p>` : ""}
      ${testBlock}
    </div>
  `;
}

function renderCodexTestBlock(provider) {
  if (provider.kind !== "official-subscription" || (provider.tool || "codex") !== "codex") return "";
  const cached = state.testCodexResult && state.testCodexResult.providerId === provider.id
    ? state.testCodexResult.result
    : null;
  if (!cached) return "";
  const testedAt = new Date(cached.testedAt).toLocaleTimeString();
  const headTone = cached.ok ? "is-ok" : "is-danger";
  const headLabel = cached.ok ? "连通正常" : "连通失败";
  const meta = [
    cached.httpStatus ? `HTTP ${cached.httpStatus}` : null,
    `${cached.latencyMs}ms`,
    cached.stage && cached.stage !== "parsed" ? `阶段：${cached.stage}` : null,
  ].filter(Boolean).join(" · ");
  const tiers = (cached.tiers || [])
    .filter((tier) => typeof tier.utilization === "number")
    .map((tier) => {
      const pct = `${Math.round(Number(tier.utilization || 0))}%`;
      const reset = tier.resetsAt ? ` · 重置 ${new Date(tier.resetsAt).toLocaleTimeString()}` : "";
      return `<div><dt>${escapeHtml(tier.name || "窗口")}</dt><dd>${escapeHtml(pct)}${reset}</dd></div>`;
    })
    .join("");
  const resetCredits = cached.resetCredits && typeof cached.resetCredits.available === "number"
    ? `<div><dt>重置额度</dt><dd>${cached.resetCredits.available}</dd></div>`
    : "";
  const failureTip = !cached.ok && cached.failure
    ? `<p class="diagnostic-tip"><strong>${escapeHtml(cached.failure.label)}：</strong>${escapeHtml(cached.failure.action || "")}</p>`
    : "";
  const detailTip = !cached.ok && cached.message
    ? `<p class="diagnostic-tip codex-test-detail">${escapeHtml(cached.message)}</p>`
    : "";
  return `
    <div class="codex-test-block">
      <div class="codex-test-head">
        <span class="provider-badge ${headTone}">${escapeHtml(headLabel)}</span>
        <span class="codex-test-meta">${escapeHtml(meta)} · ${escapeHtml(testedAt)}</span>
      </div>
      ${tiers || resetCredits ? `<dl>${tiers}${resetCredits}</dl>` : ""}
      ${failureTip}
      ${detailTip}
    </div>
  `;
}

function accountSourceLabel(provider) {
  if (provider.importedFrom === "claude") return "Claude JSON 导入";
  if (provider.importedFrom === "cpa") return "CPA JSON 导入";
  if (provider.importedFrom === "sub2api") return "sub2api JSON 导入";
  if (provider.importedFrom === "sessions") return "sessions.json 导入";
  if (provider.importedFrom) return `${provider.importedFrom} 导入`;
  return KIND_LABELS[provider.kind] || provider.kind;
}

function renderChatProbeCard(provider) {
  if (provider.kind !== "official-subscription" || (provider.tool || "codex") !== "codex") return "";
  const probe = state.chatProbe || {};
  const active = probe.providerId === provider.id;
  const models = (active && probe.models) || [];
  const modelsLoading = active && probe.modelsLoading;
  const selectedModel = (active && probe.selectedModel) || "";
  const prompt = (active && probe.prompt) || "hi";
  const status = (active && probe.status) || "idle";
  const streamingText = (active && probe.streamingText) || "";
  const meta = active && probe.meta;
  const error = active && probe.error;
  const busy = status === "loading" || status === "streaming";

  let modelOptions;
  if (models.length) {
    modelOptions = models
      .map((m) => `<option value="${escapeAttr(m.slug)}"${m.slug === selectedModel ? " selected" : ""}>${escapeHtml(m.label)}</option>`)
      .join("");
  } else {
    modelOptions = `<option value="">${modelsLoading ? "加载模型中…" : "点击加载模型清单"}</option>`;
  }

  const sendLabel = busy ? "发送中…" : (status === "idle" && !streamingText ? "发送 hi" : "重新发送");
  const replyBody = streamingText
    ? escapeHtml(streamingText)
    : `<span class="chat-reply-placeholder">${busy ? "等待回复…" : "点击「发送」后会在这里显示模型回复"}</span>`;

  return `
    <div class="chat-probe-card">
      <div class="chat-probe-head">
        <strong>对话探测</strong>
        <span>实际向 ChatGPT 后端发送一条消息，验证模型可回复（消耗少量额度）</span>
      </div>
      <div class="chat-probe-controls">
        <select class="chat-model-select" data-action="select-chat-model" ${busy ? "disabled" : ""} aria-label="选择测试模型">
          ${modelOptions}
        </select>
        ${!models.length && !modelsLoading ? `<button class="btn" data-action="load-chat-models" ${busy ? "disabled" : ""}>加载模型</button>` : ""}
        <input class="chat-prompt-input" data-action="edit-chat-prompt" value="${escapeAttr(prompt)}" placeholder="测试消息（默认 hi）" ${busy ? "disabled" : ""} aria-label="测试消息" />
        <button class="btn primary" data-action="send-chat-probe" ${busy ? "disabled" : ""}>${escapeHtml(sendLabel)}</button>
      </div>
      <div class="chat-reply-area" data-role="chat-reply">${replyBody}${status === "streaming" ? '<span class="chat-cursor">▋</span>' : ""}</div>
      ${(meta || error) ? `<div class="chat-meta ${error ? "is-error" : ""}">${error
        ? `<strong>失败：</strong>${escapeHtml(error)}`
        : `<strong>完成：</strong>HTTP ${meta.httpStatus || 200} · ${meta.latencyMs}ms · ${escapeHtml(meta.model || "")}`}</div>` : ""}
    </div>
  `;
}

function identityHelpText(provider) {
  if (provider.importedFrom === "claude") return "按 Claude 文件中的邮箱匹配账号；再次导入同一邮箱会更新 access token，不会重复新增。";
  if (provider.importedFrom === "cpa") return "按 CPA 文件中的 accountId 匹配账号；再次导入同一账号会更新凭证，不会重复新增。";
  if (provider.importedFrom === "sub2api") return "按 sub2api 导出的独立额度记录保留，不会因为 Gmail 主邮箱或 accountId 相同而合并。";
  if (provider.kind === "official-subscription") return "官方账号 token 使用 Windows DPAPI 加密保存在本机 config.json，预览与历史记录不会显示原文。";
  return "普通供应商使用 Base URL 与 API Key/环境变量查询余额。";
}

function renderOfficialNotice(provider) {
  const imported = provider.importedFrom || provider.accessToken;
  const email = provider.accountEmail || provider.name || "";
  const expires = provider.expiresAt ? new Date(provider.expiresAt).toLocaleString("zh-CN") : "未知";
  if (imported) {
    const service = (provider.tool || "codex") === "claude" ? "Claude" : "OpenAI";
    return `
      <div class="notice-box import-notice">
        <strong>已导入 ${service} OAuth 账号</strong>
        <span>${escapeHtml(email)}${provider.planType ? ` · ${escapeHtml(provider.planType)}` : ""}</span>
        <span>过期时间：${escapeHtml(expires)}。导入的 token 会经 Windows DPAPI 加密后保存在本机 config.json。</span>
      </div>
    `;
  }
  return `
    <div class="notice-box">
      <strong>官方订阅不使用请求地址或 API Key</strong>
      <span>Codex 读取本机 Codex 登录状态，Claude 读取本机 Claude OAuth 登录状态。</span>
    </div>
  `;
}

function renderTemplatePopover() {
  const closing = state.templatesClosing ? "is-leaving" : "";
  const origin = state.templateOrigin || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const originStyle = `--origin-x:${Math.round(origin.x)}px;--origin-y:${Math.round(origin.y)}px`;
  return `
    <div class="template-backdrop ${closing}" data-action="cancel-templates" style="${originStyle}">
      <div class="template-popover ${closing}" role="dialog" aria-modal="true" aria-label="添加供应商">
        <div class="template-head">
          <div>
            <strong>添加供应商</strong>
            <span>选择官方订阅、官方 Coding Plan 或官方余额接口。</span>
          </div>
          <button class="icon-close" data-action="cancel-templates" aria-label="关闭">×</button>
        </div>
        <div class="template-grid">
          ${state.templates.map(renderTemplateCard).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderTemplateCard(template, index) {
  // Per-card stagger covers any number of templates (capped so long lists
  // don't make the user wait for the last card to appear).
  const enterDelay = Math.min(index, 9) * 18;
  return `
    <button class="template-card" data-action="add-template" data-template="${escapeAttr(template.id)}" style="--enter-delay:${enterDelay}ms">
      <span class="template-logo">${escapeHtml(template.short || template.label.slice(0, 2))}</span>
      <span class="template-copy">
        <strong>${escapeHtml(template.label)}</strong>
        <small>${escapeHtml(template.category || KIND_LABELS[template.provider?.kind] || "供应商")}</small>
        <em>${escapeHtml(template.description || "")}</em>
      </span>
    </button>
  `;
}

function renderCustomSelect(field, value, options, labelId = "") {
  const open = state.openDropdown === field;
  const closing = state.closingDropdown === field;
  const selected = options.find(([optionValue]) => optionValue === value) || options[0];
  const listId = `provider-${field}-options`;
  return `
    <div class="custom-select ${open ? "is-open" : ""} ${closing ? "is-closing" : ""}" data-field="${escapeAttr(field)}" data-open="${open ? "true" : "false"}">
      <button class="custom-select-trigger" type="button" data-action="toggle-dropdown" data-field="${escapeAttr(field)}" aria-haspopup="listbox" aria-controls="${listId}" aria-labelledby="${escapeAttr(labelId)}" aria-expanded="${open ? "true" : "false"}">
        <span>${escapeHtml(selected?.[1] || value || "请选择")}</span>
        <svg class="select-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      <div id="${listId}" class="custom-select-options" role="listbox" aria-label="${escapeAttr(selected?.[1] || field)}">
        ${options
          .map(
            ([optionValue, label]) => `
              <button id="${listId}-${escapeAttr(optionValue)}" class="custom-select-option ${optionValue === value ? "is-selected" : ""}" type="button" role="option" aria-selected="${optionValue === value ? "true" : "false"}" data-action="select-option" data-field="${escapeAttr(field)}" data-value="${escapeAttr(optionValue)}">
                ${escapeHtml(label)}
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderPasteDialog() {
  if (!state.pasteOpen) return "";
  return `
    <div class="import-backdrop" data-action="cancel-paste-import">
      <div class="paste-popover" role="dialog" aria-modal="true" aria-label="导入账号 JSON">
        <div class="import-head">
          <div>
            <strong>导入账号</strong>
            <span>支持 Claude、CPA 账号 JSON；兼容 sessions.json 和 sub2api。确认后会立即加密保存。</span>
          </div>
          <button class="icon-close" data-action="cancel-paste-import" aria-label="关闭">×</button>
        </div>
        <div class="import-source-body">
          <div class="import-drop-zone" data-action="drop-import-file" tabindex="0" role="button" aria-label="拖放或选择 JSON 文件">
            <span class="import-file-icon" aria-hidden="true">JSON</span>
            <strong>将 JSON 文件拖到这里</strong>
            <span>仅在本机读取，导入预览不会显示 token 原文</span>
            <button class="btn" data-action="choose-import-file">选择文件</button>
          </div>
          <div class="import-source-divider"><span>或者粘贴内容</span></div>
          <label class="import-paste-label" for="import-json-content">JSON 内容</label>
          <textarea id="import-json-content" class="paste-json" data-field="importRaw" placeholder="把 Claude 或 CPA 账号 JSON 粘贴到这里"></textarea>
        </div>
        <div class="import-actions">
          <button class="btn" data-action="cancel-paste-import">取消</button>
          <button class="btn primary" data-action="preview-paste-import">预览粘贴内容</button>
        </div>
      </div>
    </div>
  `;
}

function renderDirtyActions() {
  if (!state.dirty) return "";
  return `
    <button class="btn" data-action="reset">撤销未保存修改</button>
    <button class="btn primary" data-action="save">保存并刷新额度</button>
  `;
}

function renderImportPreview() {
  if (!state.importPreview) return "";
  const preview = state.importPreview;
  const closing = state.importPreviewClosing ? "is-leaving" : "";
  return `
    <div class="import-backdrop ${closing}" data-action="cancel-import-preview">
      <div class="import-popover ${closing}" role="dialog" aria-modal="true" aria-label="导入账号预览">
        <div class="import-head">
          <div>
            <strong>导入账号预览</strong>
            <span>${escapeHtml(preview.fileName || preview.filePath || "账号 JSON")}</span>
          </div>
          <button class="icon-close" data-action="cancel-import-preview" aria-label="关闭">×</button>
        </div>
        ${renderImportSteps(preview)}
        <div class="import-summary">
          ${renderImportStat(preview.accountCount, "检测账号")}
          ${renderImportStat(preview.importedCount, "新增", "is-add")}
          ${renderImportStat(preview.updatedCount, "更新", "is-update")}
          ${renderImportStat(preview.skippedCount, "跳过", "is-skip")}
        </div>
        ${renderImportGuidance(preview)}
        ${renderImportDuplicateNotes(preview)}
        <div class="import-list">
          ${(preview.items || []).map(renderImportPreviewItem).join("") || `<div class="empty"><p class="hint">没有可导入账号。</p></div>`}
        </div>
        <div class="import-actions">
          <button class="btn" data-action="cancel-import-preview">取消</button>
          <button class="btn primary" data-action="confirm-import-preview" ${(preview.importedCount || preview.updatedCount) ? "" : "disabled"}>确认导入</button>
        </div>
      </div>
    </div>
  `;
}

function renderImportStat(value, label, tone = "") {
  const count = Number(value || 0);
  return `<div class="${[tone, count === 0 ? "is-zero" : ""].filter(Boolean).join(" ")}"><strong>${count}</strong><span>${label}</span></div>`;
}

function renderImportSteps(preview) {
  const hasChanges = Boolean((preview.importedCount || 0) + (preview.updatedCount || 0));
  return `
    <div class="import-steps" aria-label="导入步骤">
      <span class="is-done"><em>1</em>选择来源</span>
      <span class="is-active"><em>2</em>预览确认</span>
      <span class="${hasChanges ? "" : "is-muted"}"><em>3</em>写入本机</span>
    </div>
  `;
}

function renderImportGuidance(preview) {
  const pieces = [];
  pieces.push({
    title: "安全预览",
    detail: "这里只显示账号数量、邮箱、短 ID 和操作原因，不会显示 OAuth token 或 API Key 原文。",
    tone: "info",
  });
  if (preview.updatedCount && !preview.importedCount) {
    pieces.push({
      title: "重复导入说明",
      detail: "这些账号已存在，本次会更新 token、过期时间和计划信息，不会重复新增。",
      tone: "info",
    });
  }
  return `
    <div class="import-guidance">
      ${pieces.map((item) => `
        <div class="import-guide is-${item.tone}">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderImportDuplicateNotes(preview) {
  const groups = preview.duplicateGroups || [];
  if (!groups.length) return "";
  return `
    <div class="import-notes">
      ${groups
        .map(
          (group) => `
            <div class="import-note">
              <strong>${group.message && group.message.includes("sub2api") ? "sub2api 独立额度" : "同主邮箱多账号"}</strong>
              <span>${escapeHtml(group.message || "已按 accountId 分开保留。")}（${Number(group.count || 0)} 个）</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderImportPreviewItem(item) {
  const actionClass = item.action === "add" ? "is-add" : item.action === "update" ? "is-update" : "is-skip";
  const expires = item.expiresAt ? new Date(item.expiresAt).toLocaleString("zh-CN") : "未知";
  return `
    <div class="import-row ${actionClass}">
      <span class="import-action">${escapeHtml(item.actionLabel || item.action || "导入")}</span>
      <span class="import-account">
        <strong>${escapeHtml(item.name || item.email || "OpenAI OAuth")}</strong>
        <small>${escapeHtml([item.identityLabel, item.planType, `过期：${expires}`].filter(Boolean).join(" · "))}</small>
      </span>
      <span class="import-reason">${escapeHtml(item.reason || "")}</span>
    </div>
  `;
}

function bindEvents() {
  root.querySelectorAll("[data-action='select-provider']").forEach((button) => {
    button.addEventListener("click", () => selectProviderFromList(button.dataset.id));
  });

  bindProviderReorder();

  root.querySelectorAll("[data-action='toggle-enabled']").forEach((input) => {
    input.addEventListener("change", () => {
      updateProvider(input.dataset.id, { enabled: input.checked });
    });
  });

  root.querySelector("[data-action='toggle-templates']")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.showTemplates) {
      closeTemplates();
      return;
    }
    openTemplates(event.currentTarget);
  });

  root.querySelector("[data-action='import-accounts']")?.addEventListener("click", (event) => openPasteImport(event.currentTarget));
  root.querySelector("[data-action='latest-import']")?.addEventListener("click", (event) => chooseLatestImportAccounts(event.currentTarget));
  root.querySelector("[data-action='account-search']")?.addEventListener("input", (event) => {
    state.accountQuery = event.target.value;
    state.view = "providers";
    syncSelectedProviderWithFilters();
    refreshProviderListOnly();
    replaceEditorForSelectedProvider();
  });
  root.querySelectorAll("[data-action='account-filter']").forEach((button) => {
    button.addEventListener("click", () => {
      state.accountFilter = button.dataset.filter || "all";
      state.view = "providers";
      render();
    });
  });
  root.querySelectorAll("[data-action='cancel-import-preview']").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest(".import-popover") && !event.target.closest(".icon-close")) return;
      closeImportPreview();
    });
  });
  root.querySelector("[data-action='confirm-import-preview']")?.addEventListener("click", confirmImportAccounts);
  root.querySelectorAll("[data-action='cancel-paste-import']").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest(".paste-popover") && !event.target.closest(".icon-close")) return;
      closePasteImport();
    });
  });
  root.querySelector("[data-action='preview-paste-import']")?.addEventListener("click", previewPasteImport);
  root.querySelector("[data-action='choose-import-file']")?.addEventListener("click", chooseImportAccounts);
  bindImportDropZone();
  const pasteInput = root.querySelector("[data-field='importRaw']");
  if (pasteInput) pasteInput.value = state.importRaw;
  pasteInput?.addEventListener("input", (event) => {
    state.importRaw = event.target.value;
  });

  bindProviderEditorEvents(root);
  bindDirtyActions();
  root.querySelector("[data-action='refresh']")?.addEventListener("click", load);
  root.querySelectorAll("[data-action='open-json']").forEach((button) => {
    button.addEventListener("click", openAdvancedJson);
  });
  root.querySelector("[data-action='refresh-quota']")?.addEventListener("click", () => window.codingPlanBar.refresh());
  root.querySelectorAll("[data-action='set-density']").forEach((button) => {
    button.addEventListener("click", () => setPanelDensity(button.dataset.density));
  });
  root.querySelectorAll("[data-action='set-theme']").forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.theme));
  });
  root.querySelectorAll("[data-action='set-proxy-mode']").forEach((button) => {
    button.addEventListener("click", () => setProxyMode(button.dataset.mode));
  });
  root.querySelector("[data-field='proxyUrl']")?.addEventListener("input", (event) => {
    state.config.proxy = { ...(state.config.proxy || { mode: "manual" }), mode: "manual", url: event.target.value };
    markDirty();
    updateStatusText();
  });
  root.querySelector("[data-action='backup-config']")?.addEventListener("click", backupConfig);
  root.querySelector("[data-action='restore-config']")?.addEventListener("click", restoreConfig);
  root.querySelector("[data-field='suppressBackupWarning']")?.addEventListener("change", (event) => {
    state.config.privacy = { ...(state.config.privacy || {}), suppressBackupWarning: event.target.checked, suppressAdvancedJsonWarning: event.target.checked };
    markDirty();
    render();
  });

  bindUpdateEvents();
}

function bindDirtyActions(scope = root) {
  scope.querySelector("[data-action='save']")?.addEventListener("click", save);
  scope.querySelector("[data-action='reset']")?.addEventListener("click", load);
}

function refreshDirtyActions() {
  const actions = root.querySelector(".dirty-actions");
  if (!actions) return;
  const isVisible = Boolean(actions.querySelector("[data-action='save']"));
  if (isVisible === state.dirty) return;
  actions.innerHTML = renderDirtyActions();
  bindDirtyActions(actions);
}

function bindImportDropZone() {
  const zone = root.querySelector(".import-drop-zone");
  if (!zone) return;
  const setDragging = (active) => zone.classList.toggle("is-dragging", active);
  ["dragenter", "dragover"].forEach((name) => {
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    });
  });
  ["dragleave", "dragend"].forEach((name) => zone.addEventListener(name, () => setDragging(false)));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    setDragging(false);
    previewDroppedImport(event.dataTransfer?.files?.[0]);
  });
  zone.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    root.querySelector("[data-action='choose-import-file']")?.click();
  });
  zone.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    root.querySelector("[data-action='choose-import-file']")?.click();
  });
}

function bindProviderEditorEvents(scope = root) {
  scope.querySelector("[data-action='delete-provider']")?.addEventListener("click", () => deleteSelectedProvider());

  const testBtn = scope.querySelector("[data-action='test-codex']");
  if (testBtn) {
    testBtn.addEventListener("click", () => runCodexConnectionTest(testBtn));
  }

  const chatProbeCard = scope.querySelector(".chat-probe-card");
  if (chatProbeCard) {
    bindChatProbeEvents(chatProbeCard);
  }

  scope.querySelectorAll("[data-action='toggle-dropdown']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.openDropdown === button.dataset.field) {
        closeDropdown({ restoreFocus: true });
        return;
      }
      openDropdown(button.dataset.field);
    });
    button.addEventListener("keydown", (event) => handleDropdownTriggerKeydown(event, button));
  });

  scope.querySelectorAll("[data-action='select-option']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectDropdownOption(button);
    });
    button.addEventListener("keydown", (event) => handleDropdownOptionKeydown(event, button));
  });

  scope.querySelectorAll("input[data-field]").forEach((field) => {
    if (["suppressBackupWarning", "proxyUrl"].includes(field.dataset.field)) return;
    if (field.type === "checkbox") {
      field.addEventListener("change", () => {
        pulseToggle(field);
        if (field.dataset.field === "enabled") {
          updateProvider(state.selectedId, { enabled: field.checked });
          return;
        }
        updateSelectedFromField(field, true);
      });
      return;
    }
    field.addEventListener("input", () => updateSelectedFromField(field, false));
    field.addEventListener("change", () => updateSelectedFromField(field, true));
  });
}

function pulseToggle(field) {
  const node = field && field.parentElement ? field.parentElement : field;
  if (!node || !node.classList) return;
  node.classList.remove("is-pulsing");
  void node.offsetWidth;
  node.classList.add("is-pulsing");
  window.setTimeout(() => node.classList.remove("is-pulsing"), 240);
}

function bindProviderReorder() {
  const list = root.querySelector(".provider-list");
  if (!list) return;

  root.querySelectorAll("[data-action='drag-provider']").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => event.stopPropagation());
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("keydown", (event) => {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      moveProviderByOffset(handle.dataset.id, event.key === "ArrowUp" ? -1 : 1);
    });
    handle.addEventListener("dragstart", (event) => {
      const sourceId = handle.dataset.id;
      const row = handle.closest(".provider-item");
      providerDrag = { sourceId, targetId: null, position: null };
      row?.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", sourceId);
        if (row) event.dataTransfer.setDragImage(row, 18, Math.round(row.offsetHeight / 2));
      }
    });
    handle.addEventListener("dragend", clearProviderDrag);
  });

  list.querySelectorAll(".provider-item").forEach((row) => {
    row.addEventListener("dragover", (event) => {
      if (!providerDrag.sourceId || providerDrag.sourceId === row.dataset.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      showProviderDropTarget(row.dataset.id, position);
      autoScrollProviderList(list, event.clientY);
    });
    row.addEventListener("drop", (event) => {
      if (!providerDrag.sourceId || providerDrag.sourceId === row.dataset.id) return;
      event.preventDefault();
      const sourceId = providerDrag.sourceId;
      const position = providerDrag.position || "before";
      const targetId = row.dataset.id;
      clearProviderDrag();
      reorderProviders(sourceId, targetId, position);
    });
  });

}

function showProviderDropTarget(targetId, position) {
  if (providerDrag.targetId === targetId && providerDrag.position === position) return;
  root.querySelectorAll(".provider-item.is-drop-before, .provider-item.is-drop-after").forEach((row) => {
    row.classList.remove("is-drop-before", "is-drop-after");
  });
  providerDrag.targetId = targetId;
  providerDrag.position = position;
  const target = root.querySelector(`.provider-item[data-id="${cssEscape(targetId)}"]`);
  target?.classList.add(position === "before" ? "is-drop-before" : "is-drop-after");
}

function clearProviderDrag() {
  root.querySelectorAll(".provider-item.is-dragging, .provider-item.is-drop-before, .provider-item.is-drop-after").forEach((row) => {
    row.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  });
  providerDrag = { sourceId: null, targetId: null, position: null };
}

function autoScrollProviderList(list, pointerY) {
  const rect = list.getBoundingClientRect();
  const edge = 36;
  if (pointerY < rect.top + edge) list.scrollTop -= 10;
  else if (pointerY > rect.bottom - edge) list.scrollTop += 10;
}

function moveProviderByOffset(sourceId, offset) {
  const index = state.config.providers.findIndex((provider) => provider.id === sourceId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= state.config.providers.length) return;
  const target = state.config.providers[targetIndex];
  reorderProviders(sourceId, target.id, offset < 0 ? "before" : "after", true);
}

function reorderProviders(sourceId, targetId, position, restoreFocus = false) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const sourceIndex = state.config.providers.findIndex((provider) => provider.id === sourceId);
  if (sourceIndex < 0) return false;

  const list = root.querySelector(".provider-list");
  const scrollTop = list?.scrollTop || 0;
  const firstPositions = captureListPositions();
  const providers = [...state.config.providers];
  const [source] = providers.splice(sourceIndex, 1);
  let targetIndex = providers.findIndex((provider) => provider.id === targetId);
  if (targetIndex < 0) return false;
  if (position === "after") targetIndex += 1;
  providers.splice(targetIndex, 0, source);
  if (providers.every((provider, index) => provider === state.config.providers[index])) return false;
  state.config.providers = providers;
  markDirty();
  state.status = "顺序已调整，保存后同步到额度页面";
  render();

  const nextList = root.querySelector(".provider-list");
  if (nextList) nextList.scrollTop = scrollTop;
  positionSelectionBar();
  flipList(firstPositions);
  if (restoreFocus) {
    requestAnimationFrame(() => {
      root.querySelector(`.drag-handle[data-id="${cssEscape(sourceId)}"]`)?.focus();
    });
  }
  return true;
}

/* Wire up the auto-update page. Kept separate so the provider editor's
   event binding stays focused and the update view is easy to reason about. */
function bindUpdateEvents() {
  root.querySelector("[data-action='show-usage']")?.addEventListener("click", () => {
    state.view = "usage";
    render();
    if ((!state.agentUsage.data || state.agentUsage.stale) && !state.agentUsage.loading) loadAgentUsage();
  });
  root.querySelectorAll("[data-action='refresh-agent-usage']").forEach((button) => {
    button.addEventListener("click", () => loadAgentUsage({ force: true }));
  });
  root.querySelectorAll("[data-action='set-agent-usage-source']").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.source;
      state.agentUsageSource = next === "claude" || next === "zcode" ? next : "codex";
      render();
    });
  });
  root.querySelector("[data-action='show-health']")?.addEventListener("click", () => {
    state.view = "health";
    render();
  });
  root.querySelector("[data-action='show-backup']")?.addEventListener("click", () => {
    state.view = "backup";
    render();
  });
  root.querySelector("[data-action='show-update']")?.addEventListener("click", () => {
    state.view = "update";
    render();
  });

  root.querySelector("[data-action='check-update']")?.addEventListener("click", () => {
    window.codingPlanBar.checkForUpdates();
  });
  root.querySelector("[data-action='download-update']")?.addEventListener("click", () => {
    window.codingPlanBar.downloadUpdate();
  });
  root.querySelector("[data-action='install-update']")?.addEventListener("click", () => {
    window.codingPlanBar.installUpdate();
  });

  root.querySelector("[data-action='toggle-auto-check']")?.addEventListener("change", (event) => {
    state.config.autoUpdate = { enabled: event.target.checked };
    markDirty();
    render();
  });

  // Release / manual-download links open the GitHub page in the browser.
  root.querySelectorAll("[data-action='open-release']").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const url = state.updater.result && state.updater.result.releaseUrl;
      if (url && typeof window.codingPlanBar.openRelease === "function") {
        window.codingPlanBar.openRelease(url);
      }
    });
  });
}

function updateSelectedFromField(field, shouldRender) {
  const value = field.type === "checkbox" ? field.checked : field.value;
  updateSelectedField(field.dataset.field, value, shouldRender);
}

function updateSelectedField(field, rawValue, shouldRender) {
  const provider = selectedProvider();
  if (!provider) return;
  const oldId = provider.id;
  let value = rawValue;
  if (field === "apiKeyEnv") value = textToApiKeyEnv(value);
  provider[field] = value;
  sanitizeProvider(provider);
  if (field === "id") state.selectedId = value || oldId;
  markDirty();
  if (field === "kind" || field === "tool") state.openDropdown = field;
  if (shouldRender) {
    const scrollTop = captureProviderListScroll();
    render();
    restoreProviderListScroll(scrollTop);
  } else {
    updateStatusText();
    refreshProviderListItem(state.selectedId || oldId);
    if (field === "id" && state.selectedId !== oldId) updateProviderSelection(state.selectedId);
  }
}

function updateProvider(id, patch) {
  const provider = state.config.providers.find((item) => item.id === id);
  if (!provider) return;
  Object.assign(provider, patch);
  markDirty();
  if (state.view === "providers" && !matchesAccountFilter(provider)) {
    syncSelectedProviderWithFilters();
    refreshProviderListOnly();
    replaceEditorForSelectedProvider();
  } else {
    refreshProviderListItem(id);
    refreshSelectedEnabledControl(id);
    refreshSelectedProviderPreview(id);
    refreshSelectedAccountDetail(id);
    positionSelectionBar();
  }
  updateStatusText();
}

function selectProviderFromList(id) {
  if (!id) return;
  const viewChanged = state.view !== "providers";
  const selectedChanged = state.selectedId !== id;
  state.selectedId = id;
  state.view = "providers";
  dismissTemplates();
  if (viewChanged) {
    const scrollTop = captureProviderListScroll();
    render();
    restoreProviderListScroll(scrollTop);
    return;
  }
  if (!selectedChanged) return;
  updateProviderSelection(id);
  replaceEditorForSelectedProvider();
}

function refreshProviderRuntimeState() {
  const beforeSelected = state.selectedId;
  syncSelectedProviderWithFilters();
  refreshProviderListOnly();
  if (beforeSelected !== state.selectedId) {
    replaceEditorForSelectedProvider();
  } else if (state.selectedId) {
    refreshSelectedAccountDetail(state.selectedId);
  }
}

function refreshProviderListOnly() {
  const list = root.querySelector(".provider-list");
  if (!list) return;
  const scrollTop = list.scrollTop;
  list.innerHTML = `<div class="selection-bar" aria-hidden="true"></div>${renderProviderList()}`;
  list.scrollTop = scrollTop;
  bindProviderListEvents();
  positionSelectionBar();
}

function bindProviderListEvents() {
  const list = root.querySelector(".provider-list");
  if (list && !list.dataset.reorderBound) {
    list.dataset.reorderBound = "true";
    list.addEventListener("dragover", (event) => {
      if (providerDrag.sourceId) event.preventDefault();
    });
  }
  root.querySelectorAll("[data-action='select-provider']").forEach((button) => {
    button.addEventListener("click", () => selectProviderFromList(button.dataset.id));
  });
  root.querySelectorAll("[data-action='toggle-enabled']").forEach((input) => {
    input.addEventListener("change", () => {
      updateProvider(input.dataset.id, { enabled: input.checked });
    });
  });
  bindProviderReorder();
}

function refreshProviderListItem(id) {
  const provider = state.config.providers.find((item) => item.id === id);
  const row = root.querySelector(`.provider-item[data-id="${cssEscape(id)}"]`);
  if (!provider || !row) return;
  const badge = providerBadge(provider);
  row.classList.toggle("is-selected", provider.id === state.selectedId);
  row.classList.toggle("is-attention", providerNeedsAttention(provider));
  const dot = row.querySelector(".dot");
  if (dot) {
    dot.className = `dot ${provider.enabled === false ? "is-off" : badge.tone === "danger" ? "is-danger" : badge.tone === "warn" ? "is-warn" : ""}`;
  }
  const badgeNode = row.querySelector(".provider-badge");
  if (badgeNode) {
    badgeNode.className = `provider-badge is-${badge.tone}`;
    badgeNode.textContent = badge.label;
  }
  const input = row.querySelector("[data-action='toggle-enabled']");
  if (input) input.checked = provider.enabled !== false;
}

function refreshSelectedEnabledControl(id) {
  if (state.selectedId !== id || state.view !== "providers") return;
  const provider = selectedProvider();
  const input = root.querySelector(".editor [data-field='enabled']");
  if (provider && input) input.checked = provider.enabled !== false;
}

function refreshSelectedProviderPreview(id) {
  if (state.selectedId !== id || state.view !== "providers") return;
  const provider = selectedProvider();
  const preview = root.querySelector(".editor .json-preview");
  if (provider && preview) preview.textContent = JSON.stringify(safeProviderPreview(provider), null, 2);
}

function refreshSelectedAccountDetail(id) {
  if (state.selectedId !== id || state.view !== "providers") return;
  const provider = selectedProvider();
  const card = root.querySelector(".editor .account-detail-card");
  if (provider && card) {
    card.outerHTML = renderAccountDetailCard(provider);
  }
  const badge = provider ? providerBadge(provider) : null;
  const headBadge = root.querySelector(".editor-head .provider-badge");
  if (badge && headBadge) {
    headBadge.className = `provider-badge is-${badge.tone}`;
    headBadge.textContent = badge.label;
  }
}

function updateProviderSelection(id) {
  root.querySelectorAll("[data-action='select-provider']").forEach((button) => {
    const selected = button.dataset.id === id;
    button.closest(".provider-item")?.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  positionSelectionBar();
}

function replaceEditorForSelectedProvider() {
  const editor = root.querySelector(".editor");
  const selected = selectedProvider();
  if (!editor) return;
  editor.innerHTML = selected
    ? renderEditor(selected)
    : `<div class="empty"><div><strong>没有供应商</strong><p class="hint">点击左侧“添加”创建一个供应商。</p></div></div>`;
  bindProviderEditorEvents(editor);
  flashFormSwap();
  lastSelectedId = state.selectedId;
}

async function runCodexConnectionTest(button) {
  const provider = selectedProvider();
  if (!provider || button.disabled) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "测试中…";
  state.status = `正在测试 ${provider.name || provider.id} 的连通性…`;
  state.statusIsError = false;
  state.statusTone = "loading";
  updateStatusText();
  try {
    const result = await window.codingPlanBar.testCodexConnection(provider.id);
    state.testCodexResult = { providerId: provider.id, result };
    refreshSelectedAccountDetail(provider.id);
    if (result.ok) {
      const tiers = (result.tiers || [])
        .filter((tier) => typeof tier.utilization === "number")
        .map((tier) => `${tier.name || "窗口"} ${Math.round(Number(tier.utilization || 0))}%`)
        .join(" · ");
      state.status = `连通正常 · ${result.latencyMs}ms · HTTP ${result.httpStatus}${tiers ? " · " + tiers : ""}`;
      state.statusIsError = false;
      state.statusTone = "success";
    } else {
      state.status = `测试失败：${(result.failure && result.failure.label) || result.message || "未知错误"}`;
      state.statusIsError = true;
      state.statusTone = "error";
    }
  } catch (error) {
    state.status = `测试失败：${String(error?.message || error)}`;
    state.statusIsError = true;
    state.statusTone = "error";
  } finally {
    updateStatusText();
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function bindChatProbeEvents(scope) {
  const provider = selectedProvider();
  if (!provider) return;
  ensureChatProbeForProvider(provider);

  const modelSelect = scope.querySelector("[data-action='select-chat-model']");
  modelSelect?.addEventListener("change", () => {
    state.chatProbe.selectedModel = modelSelect.value;
  });

  const promptInput = scope.querySelector("[data-action='edit-chat-prompt']");
  promptInput?.addEventListener("input", () => {
    state.chatProbe.prompt = promptInput.value;
  });

  scope.querySelector("[data-action='load-chat-models']")?.addEventListener("click", () => {
    loadChatProbeModels(provider);
  });

  scope.querySelector("[data-action='send-chat-probe']")?.addEventListener("click", () => {
    runChatProbe(provider);
  });
}

function ensureChatProbeForProvider(provider) {
  if (state.chatProbe.providerId !== provider.id) {
    state.chatProbe = {
      providerId: provider.id,
      models: state.chatProbe.models,
      modelsLoading: false,
      modelsLoaded: state.chatProbe.modelsLoaded,
      selectedModel: "",
      prompt: "hi",
      status: "idle",
      streamingText: "",
      meta: null,
      error: null,
    };
  }
  if (!state.chatProbe.modelsLoaded && !state.chatProbe.modelsLoading) {
    loadChatProbeModels(provider);
  }
}

async function loadChatProbeModels(provider) {
  state.chatProbe.modelsLoading = true;
  state.chatProbe.providerId = provider.id;
  patchChatProbeCard(provider);
  try {
    const models = await window.codingPlanBar.listCodexModels();
    state.chatProbe.models = Array.isArray(models) ? models : [];
    state.chatProbe.modelsLoaded = true;
    if (!state.chatProbe.selectedModel && state.chatProbe.models.length) {
      const preferred = ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"];
      const found = preferred.map((s) => state.chatProbe.models.find((m) => m.slug === s)).find(Boolean);
      state.chatProbe.selectedModel = (found && found.slug) || state.chatProbe.models[0].slug;
    }
  } catch (error) {
    state.chatProbe.error = `加载模型失败：${String(error?.message || error)}`;
  } finally {
    state.chatProbe.modelsLoading = false;
    patchChatProbeCard(provider);
  }
}

async function runChatProbe(provider) {
  if (!provider) return;
  ensureChatProbeForProvider(provider);
  const probe = state.chatProbe;
  if (probe.status === "loading" || probe.status === "streaming") return;

  probe.status = "loading";
  probe.streamingText = "";
  probe.meta = null;
  probe.error = null;
  patchChatProbeCard(provider);
  updateStatusTextForChat("正在发送对话探测…", "loading", false);

  try {
    const result = await window.codingPlanBar.probeCodexChat({
      provider: provider.id,
      model: probe.selectedModel,
      prompt: probe.prompt,
    });
    if (state.chatProbe.providerId !== provider.id) return;
    if (result && result.ok) {
      probe.status = "success";
      probe.meta = { httpStatus: result.httpStatus || 200, latencyMs: result.latencyMs, model: result.model || probe.selectedModel };
      updateStatusTextForChat(`对话成功 · ${result.latencyMs}ms · ${escapeHtml(result.model || probe.selectedModel || "")}`, "success", false);
    } else {
      probe.status = "error";
      probe.error = (result && (result.error || (result.failure && result.failure.label))) || "未知错误";
      const tip = result?.failure?.action ? `：${result.failure.action}` : "";
      updateStatusTextForChat(`对话失败：${probe.error}${tip}`, "error", true);
    }
  } catch (error) {
    if (state.chatProbe.providerId !== provider.id) return;
    probe.status = "error";
    probe.error = String(error?.message || error);
    updateStatusTextForChat(`对话失败：${probe.error}`, "error", true);
  } finally {
    if (state.chatProbe.providerId === provider.id) {
      patchChatProbeCard(provider);
    }
  }
}

function handleProbeEvent(payload) {
  const provider = selectedProvider();
  if (!provider || !state.chatProbe || state.chatProbe.providerId !== provider.id) return;
  const probe = state.chatProbe;
  if (!payload || typeof payload !== "object") return;

  if (payload.type === "started") {
    probe.status = "streaming";
    probe.streamingText = "";
    probe.meta = null;
    probe.error = null;
    patchChatProbeCard(provider);
  } else if (payload.type === "delta") {
    probe.streamingText = (probe.streamingText || "") + (payload.text || "");
    patchChatReplyArea();
  } else if (payload.type === "complete") {
    if (probe.status !== "success" && probe.status !== "error") {
      probe.status = "success";
    }
  } else if (payload.type === "error") {
    probe.status = "error";
    probe.error = payload.error || "未知错误";
  }
}

function patchChatReplyArea() {
  const replyArea = root.querySelector(".editor [data-role='chat-reply']");
  if (!replyArea || !state.chatProbe) return;
  const text = state.chatProbe.streamingText || "";
  const streaming = state.chatProbe.status === "streaming";
  replyArea.innerHTML = text
    ? escapeHtml(text) + (streaming ? '<span class="chat-cursor">▋</span>' : "")
    : `<span class="chat-reply-placeholder">${streaming ? "等待回复…" : ""}</span>`;
}

function patchChatProbeCard(provider) {
  if (state.selectedId !== provider.id || state.view !== "providers") return;
  const card = root.querySelector(".editor .chat-probe-card");
  if (!card) return;
  const fresh = renderChatProbeCard(provider);
  if (fresh) {
    card.outerHTML = fresh;
    const newCard = root.querySelector(".editor .chat-probe-card");
    if (newCard) bindChatProbeEvents(newCard);
  }
}

function updateStatusTextForChat(message, tone, isError) {
  state.status = message;
  state.statusTone = tone;
  state.statusIsError = isError;
  updateStatusText();
}

function addTemplate(templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;
  const provider = uniqueProvider(sanitizeProvider(clone(template.provider)));
  const firstPositions = captureListPositions();
  state.config.providers.push(provider);
  state.selectedId = provider.id;
  dismissTemplates();
  dialogOrigin = null;
  markDirty();
  render();
  flipList(firstPositions);
}

function deleteSelectedProvider() {
  const provider = selectedProvider();
  if (!provider) return;
  // Capture sibling positions before the list mutates, then play the leave
  // animation on the doomed row before re-rendering with a FLIP glide.
  const list = root.querySelector(".provider-list");
  const row = list?.querySelector(`.provider-item[data-id="${cssEscape(provider.id)}"]`);
  const firstPositions = captureListPositions();
  const proceed = () => {
    state.config.providers = state.config.providers.filter((item) => item !== provider);
    state.selectedId = state.config.providers[0]?.id || null;
    markDirty();
    render();
    flipList(firstPositions);
  };
  if (row) {
    row.classList.add("is-leaving");
    window.setTimeout(proceed, 210);
  } else {
    proceed();
  }
}

async function chooseImportAccounts() {
  try {
    state.status = "请选择 Claude 或 CPA 账号 JSON 文件...";
    state.statusIsError = false;
    state.statusTone = "loading";
    updateStatusText();
    const preview = await window.codingPlanBar.chooseImportAccounts();
    if (!preview || preview.canceled) {
      state.status = "已取消导入";
      state.statusIsError = false;
      state.statusTone = "success";
      updateStatusText();
      return;
    }
    showImportPreview(preview);
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
    updateStatusText();
  }
}

async function previewDroppedImport(file) {
  try {
    if (!file) throw new Error("请拖入一个 JSON 文件");
    if (!/\.json$/i.test(file.name || "")) throw new Error("仅支持 JSON 文件");
    const filePath = window.codingPlanBar.getPathForFile(file);
    if (!filePath) throw new Error("无法读取拖入文件的本机路径");
    state.status = `正在读取 ${file.name || "JSON 文件"}...`;
    state.statusIsError = false;
    state.statusTone = "loading";
    updateStatusText();
    const preview = await window.codingPlanBar.previewImportFile(filePath);
    showImportPreview(preview);
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
    updateStatusText();
  }
}

function showImportPreview(preview, raw = null) {
  state.pasteOpen = false;
  state.importPreview = raw ? { ...preview, raw, sourceType: "paste" } : preview;
  state.importPreviewClosing = false;
  state.status = preview.message || "已生成导入预览，请确认";
  state.statusIsError = false;
  state.statusTone = (preview.importedCount || preview.updatedCount) ? "dirty" : "success";
  render();
  focusDialog(root.querySelector(".import-popover"), "[data-action='confirm-import-preview']:not([disabled])");
}

async function chooseLatestImportAccounts(originElement) {
  rememberDialogOrigin(originElement);
  try {
    state.status = "正在查找 Downloads 中最新的 Claude 或 CPA 账号 JSON...";
    state.statusIsError = false;
    state.statusTone = "loading";
    updateStatusText();
    const preview = await window.codingPlanBar.latestImportAccounts();
    if (!preview || preview.canceled) {
      state.status = preview?.message || "没有找到可导入文件";
      state.statusIsError = true;
      state.statusTone = "error";
      updateStatusText();
      return;
    }
    state.importPreview = preview;
    state.importPreviewClosing = false;
    state.status = preview.message || "已生成导入预览，请确认";
    state.statusIsError = false;
    state.statusTone = (preview.importedCount || preview.updatedCount) ? "dirty" : "success";
    render();
    focusDialog(root.querySelector(".import-popover"), "[data-action='confirm-import-preview']:not([disabled])");
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
    updateStatusText();
  }
}

function openPasteImport(originElement) {
  rememberDialogOrigin(originElement);
  state.pasteOpen = true;
  state.importRaw = "";
  dismissDropdown();
  render();
  focusDialog(root.querySelector(".paste-popover"), ".import-drop-zone");
}

function closePasteImport() {
  state.pasteOpen = false;
  state.importRaw = "";
  render();
  restoreDialogFocus();
}

async function previewPasteImport() {
  try {
    if (!state.importRaw.trim()) throw new Error("请先粘贴 JSON 内容");
    const preview = await window.codingPlanBar.previewImport(state.importRaw);
    showImportPreview(preview, state.importRaw);
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
    updateStatusText();
  }
}

async function confirmImportAccounts() {
  if (!state.importPreview?.filePath && !state.importPreview?.raw) return;
  try {
    state.status = "正在导入账号...";
    state.statusIsError = false;
    state.statusTone = "loading";
    updateStatusText();
    const firstPositions = captureListPositions();
    const result = state.importPreview.raw
      ? await window.codingPlanBar.importAccountsRaw(state.importPreview.raw)
      : await window.codingPlanBar.importAccounts(state.importPreview.filePath);
    state.importPreview = null;
    state.importRaw = "";
    state.importPreviewClosing = false;
    dialogOrigin = null;
    state.config = sanitizeConfig(cloneConfig(result.config));
    state.configPath = result.configPath || state.configPath;
    state.selectedId = result.selectedId || result.affectedIds?.[0] || state.selectedId || state.config.providers[0]?.id || null;
    state.view = "providers";
    state.dirty = false;
    state.status = result.message || "账号导入完成";
    state.statusIsError = false;
    state.statusTone = (result.importedCount || result.updatedCount) ? "success" : "dirty";
    render();
    flipList(firstPositions);
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
    updateStatusText();
  }
}

function setPanelDensity(value) {
  state.config.panelDensity = value === "compact" ? "compact" : "comfortable";
  markDirty();
  render();
}

function setTheme(value) {
  state.config.theme = value === "dark" ? "dark" : "light";
  applyTheme();
  markDirty();
  render();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.config.theme === "dark" ? "dark" : "light";
}

function setProxyMode(value) {
  const mode = value === "direct" || value === "manual" ? value : "system";
  const previous = state.config.proxy || { mode: "system", url: "" };
  state.config.proxy = {
    mode,
    url: mode === "manual" ? String(previous.url || "") : String(previous.url || ""),
  };
  markDirty();
  render();
}

function openAdvancedJson() {
  if (!state.config.privacy?.suppressAdvancedJsonWarning) {
    const ok = window.confirm("高级 JSON 里可能包含明文 token/API Key。请不要复制到聊天、Issue 或公共仓库。继续打开吗？");
    if (!ok) return;
  }
  window.codingPlanBar.openConfigJson();
}

async function backupConfig() {
  try {
    if (!state.config.privacy?.suppressBackupWarning) {
      const ok = window.confirm("备份文件会包含明文 token/API Key，只应保存到可信位置。继续备份吗？");
      if (!ok) return;
    }
    const result = await window.codingPlanBar.backupConfig();
    state.status = result?.message || "配置已备份";
    state.statusIsError = false;
    state.statusTone = "success";
    updateStatusText();
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
    updateStatusText();
  }
}

async function restoreConfig() {
  try {
    if (!state.config.privacy?.suppressBackupWarning) {
      const ok = window.confirm("恢复备份会覆盖当前配置，备份内可能包含明文 token/API Key。继续选择备份文件吗？");
      if (!ok) return;
    }
    const result = await window.codingPlanBar.restoreConfig();
    if (!result || result.canceled) {
      state.status = "已取消恢复";
      state.statusIsError = false;
      state.statusTone = "success";
      updateStatusText();
      return;
    }
    const ok = window.confirm(`将恢复 ${result.providerCount || 0} 个供应商，当前配置会被覆盖。确认恢复吗？`);
    if (!ok) return;
    const applied = await window.codingPlanBar.confirmRestoreConfig(result.restoreToken);
    state.config = sanitizeConfig(cloneConfig(applied.config));
    state.configPath = applied.configPath || state.configPath;
    state.selectedId = state.config.providers[0]?.id || null;
    state.status = applied.message || "配置已恢复";
    state.statusIsError = false;
    state.statusTone = "success";
    state.dirty = false;
    render();
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
    updateStatusText();
  }
}

function closeImportPreview() {
  if (!state.importPreview) return;
  window.clearTimeout(importPreviewCloseTimer);
  state.importPreviewClosing = true;
  render();
  importPreviewCloseTimer = window.setTimeout(() => {
    state.importPreview = null;
    state.importPreviewClosing = false;
    render();
    restoreDialogFocus();
  }, motionDelay(180));
}

function captureProviderListScroll() {
  return root.querySelector(".provider-list")?.scrollTop || 0;
}

function restoreProviderListScroll(scrollTop) {
  requestAnimationFrame(() => {
    const list = root.querySelector(".provider-list");
    if (list) list.scrollTop = scrollTop;
    positionSelectionBar();
  });
}

/* Record each list row's position keyed by provider id. */
function captureListPositions() {
  const list = root.querySelector(".provider-list");
  if (!list) return {};
  const map = {};
  list.querySelectorAll(".provider-item").forEach((item) => {
    const id = item.dataset.id;
    if (id) map[id] = item.getBoundingClientRect();
  });
  return map;
}

/* First-Last-Invert-Play: after re-render, slide rows that moved back into
   place using a transform that we release on the next frame. */
function flipList(firstPositions) {
  const list = root.querySelector(".provider-list");
  if (!list || !firstPositions) return;
  const rows = list.querySelectorAll(".provider-item");
  rows.forEach((row) => {
    const id = row.dataset.id;
    const first = firstPositions[id];
    if (!first) {
      // New row: play the spawn entrance instead of a FLIP.
      row.classList.add("is-spawning");
      window.setTimeout(() => row.classList.remove("is-spawning"), 380);
      return;
    }
    const last = row.getBoundingClientRect();
    const dy = first.top - last.top;
    if (Math.abs(dy) < 1) return;
    row.classList.add("is-flipping");
    row.style.transform = `translateY(${dy}px)`;
    row.style.transition = "none";
    requestAnimationFrame(() => {
      row.style.transition = "";
      row.style.transform = "";
    });
    window.setTimeout(() => row.classList.remove("is-flipping"), 320);
  });
}

async function save() {
  try {
    state.status = "正在保存...";
    state.statusIsError = false;
    state.statusTone = "loading";
    state.config = sanitizeConfig(state.config);
    render();
    const payload = await window.codingPlanBar.saveConfig(state.config);
    state.config = cloneConfig(payload.config);
    state.configPath = payload.configPath;
    state.selectedId = state.config.providers.find((item) => item.id === state.selectedId)?.id || state.config.providers[0]?.id || null;
    state.status = "已保存并刷新额度";
    state.statusIsError = false;
    state.statusTone = "success";
    state.dirty = false;
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
  }
  render();
}

function selectedProvider() {
  return state.config.providers.find((provider) => provider.id === state.selectedId) || null;
}

function openTemplates(originElement) {
  if (state.showTemplates && !state.templatesClosing) return;
  window.clearTimeout(templatesCloseTimer);
  templatesCloseTimer = null;
  rememberDialogOrigin(originElement);
  state.templateOrigin = elementCenter(originElement) || state.templateOrigin;
  state.showTemplates = true;
  state.templatesClosing = false;
  dismissDropdown();
  root.querySelector(".template-backdrop")?.remove();
  root.querySelector(".settings-shell")?.insertAdjacentHTML("beforeend", renderTemplatePopover());
  bindTemplateEvents();
  focusDialog(root.querySelector(".template-popover"), "[data-action='add-template']");
}

function closeTemplates() {
  if (!state.showTemplates) return;
  window.clearTimeout(templatesCloseTimer);
  state.templatesClosing = true;
  const backdrop = root.querySelector(".template-backdrop");
  const popover = root.querySelector(".template-popover");
  backdrop?.classList.add("is-leaving");
  popover?.classList.add("is-leaving");
  templatesCloseTimer = window.setTimeout(() => {
    backdrop?.remove();
    dismissTemplates({ restoreFocus: true });
  }, motionDelay(210));
}

function dismissTemplates({ restoreFocus = false } = {}) {
  window.clearTimeout(templatesCloseTimer);
  templatesCloseTimer = null;
  root.querySelector(".template-backdrop")?.remove();
  state.showTemplates = false;
  state.templatesClosing = false;
  if (restoreFocus) restoreDialogFocus();
}

function bindTemplateEvents() {
  root.querySelectorAll("[data-action='cancel-templates']").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest(".template-popover") && !event.target.closest(".icon-close")) return;
      closeTemplates();
    });
  });

  root.querySelector(".template-popover")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  root.querySelectorAll("[data-action='add-template']").forEach((button) => {
    button.addEventListener("click", () => addTemplate(button.dataset.template));
  });
}

function openDropdown(field) {
  window.clearTimeout(dropdownCloseTimer);
  dropdownCloseTimer = null;
  if (state.openDropdown && state.openDropdown !== field) dismissDropdown();
  const select = root.querySelector(`.custom-select[data-field="${cssEscape(field)}"]`);
  if (!select) return;
  select.classList.remove("is-closing");
  select.classList.add("is-open");
  const trigger = select.querySelector(".custom-select-trigger");
  trigger?.setAttribute("aria-expanded", "true");
  state.openDropdown = field;
  state.closingDropdown = null;
  const selected = select.querySelector(".custom-select-option.is-selected") || select.querySelector(".custom-select-option");
  selected?.focus();
}

function closeDropdown(options = {}) {
  if (!state.openDropdown) return;
  window.clearTimeout(dropdownCloseTimer);
  const { renderAfterClose = false, restoreFocus = false } = options;
  const field = state.openDropdown;
  const select = root.querySelector(`.custom-select[data-field="${cssEscape(field)}"]`);
  const trigger = select?.querySelector(".custom-select-trigger");
  select?.classList.remove("is-open");
  select?.classList.add("is-closing");
  trigger?.setAttribute("aria-expanded", "false");
  state.openDropdown = null;
  state.closingDropdown = field;
  if (restoreFocus) trigger?.focus();
  dropdownCloseTimer = window.setTimeout(() => {
    dismissDropdown();
    if (renderAfterClose) {
      render();
      if (restoreFocus) {
        root.querySelector(`.custom-select[data-field="${cssEscape(field)}"] .custom-select-trigger`)?.focus();
      }
    }
  }, motionDelay(190));
}

function dismissDropdown() {
  window.clearTimeout(dropdownCloseTimer);
  dropdownCloseTimer = null;
  root.querySelectorAll(".custom-select.is-open, .custom-select.is-closing").forEach((select) => {
    select.classList.remove("is-open", "is-closing");
    select.querySelector(".custom-select-trigger")?.setAttribute("aria-expanded", "false");
  });
  state.openDropdown = null;
  state.closingDropdown = null;
}

function selectDropdownOption(button) {
  updateSelectedField(button.dataset.field, button.dataset.value, false);
  closeDropdown({ renderAfterClose: true, restoreFocus: true });
}

function handleDropdownTriggerKeydown(event, trigger) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  if (state.openDropdown !== trigger.dataset.field) openDropdown(trigger.dataset.field);
  const options = dropdownOptions(trigger.dataset.field);
  if (!options.length) return;
  const target = event.key === "ArrowUp" || event.key === "End" ? options.at(-1) : options[0];
  target?.focus();
}

function handleDropdownOptionKeydown(event, option) {
  const options = dropdownOptions(option.dataset.field);
  const index = options.indexOf(option);
  if (event.key === "Escape") {
    event.preventDefault();
    closeDropdown({ restoreFocus: true });
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectDropdownOption(option);
    return;
  }
  let target = null;
  if (event.key === "ArrowDown") target = options[index + 1] || options[0];
  if (event.key === "ArrowUp") target = options[index - 1] || options.at(-1);
  if (event.key === "Home") target = options[0];
  if (event.key === "End") target = options.at(-1);
  if (!target) return;
  event.preventDefault();
  target.focus();
}

function dropdownOptions(field) {
  return [...root.querySelectorAll(`.custom-select[data-field="${cssEscape(field)}"] .custom-select-option`)];
}

function elementCenter(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replaceAll('"', '\\"');
}

function markDirty() {
  state.dirty = true;
  state.status = "有未保存修改";
  state.statusIsError = false;
  state.statusTone = "dirty";
  refreshDirtyActions();
}

function updateStatusText() {
  const status = root.querySelector(".status");
  if (!status) return;
  status.textContent = state.status;
  status.className = `status ${state.statusIsError ? "is-error" : ""} ${state.statusTone ? `is-${state.statusTone}` : ""}`;
}

function sanitizeConfig(config) {
  return {
    ...config,
    providers: (config.providers || []).map((provider) => sanitizeProvider(provider)),
  };
}

function sanitizeProvider(provider) {
  if (provider.kind === "official-subscription") {
    if (!provider.tool) provider.tool = "codex";
    delete provider.baseUrl;
    delete provider.apiKey;
    delete provider.apiKeyEnv;
    delete provider.tiers;
  } else {
    delete provider.tool;
    delete provider.authPath;
    delete provider.credentialsPath;
    delete provider.accessToken;
    delete provider.accountId;
    delete provider.accountEmail;
    delete provider.accountUserId;
    delete provider.expiresAt;
    delete provider.planType;
    delete provider.importedFrom;
    delete provider.importedAt;
    delete provider.importPath;
    delete provider.importKey;
  }
  return provider;
}

function uniqueProvider(provider) {
  const baseId = provider.id || "provider";
  let id = baseId;
  let index = 2;
  while (state.config.providers.some((item) => item.id === id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }
  provider.id = id;
  if (id !== baseId) provider.name = `${provider.name} ${index - 1}`;
  return provider;
}

function cloneConfig(config) {
  const proxy = config.proxy || {};
  return {
    refreshIntervalSeconds: Number(config.refreshIntervalSeconds || 300),
    showOnHover: config.showOnHover !== false,
    panelDensity: config.panelDensity === "compact" ? "compact" : "comfortable",
    theme: config.theme === "dark" ? "dark" : "light",
    privacy: {
      suppressAdvancedJsonWarning: Boolean((config.privacy || {}).suppressAdvancedJsonWarning),
      suppressBackupWarning: Boolean((config.privacy || {}).suppressBackupWarning),
      suppressImportWarning: Boolean((config.privacy || {}).suppressImportWarning),
    },
    proxy: {
      mode: proxy.mode === "direct" || proxy.mode === "manual" ? proxy.mode : "system",
      url: String(proxy.url || ""),
    },
    autoUpdate: {
      enabled: (config.autoUpdate || {}).enabled !== false,
    },
    importHistory: Array.isArray(config.importHistory) ? config.importHistory.map(clone) : [],
    providers: Array.isArray(config.providers) ? config.providers.map(clone) : [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function apiKeyEnvToText(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value || "";
}

function textToApiKeyEnv(value) {
  const parts = String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : parts;
}

