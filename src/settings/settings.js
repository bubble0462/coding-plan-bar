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
    autoUpdate: { enabled: true },
    providers: [],
  },
  templates: [],
  selectedId: null,
  // "providers" shows the provider editor; "update" shows the auto-update page.
  view: "providers",
  updater: {
    status: "idle",
    result: null,
    progress: null,
    error: null,
    checkedAt: null,
  },
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
};

let templatesCloseTimer = null;
let importPreviewCloseTimer = null;
let dropdownCloseTimer = null;
let hasRenderedSettingsShell = false;
let providerDrag = { sourceId: null, targetId: null, position: null };

window.addEventListener("click", (event) => {
  // Only re-render when we actually need to close an open provider picker.
  // Re-rendering on every click destroys <select> dropdowns and input focus.
  if (state.openDropdown && !event.target.closest(".custom-select")) {
    closeDropdown();
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

load();

// Subscribe to update state pushed from the main process, and pull the current
// state once on load so the update page reflects any background auto-check.
let lastUpdaterStatus = "idle";
window.codingPlanBar.onUpdaterState((next) => {
  const statusChanged = next.status !== lastUpdaterStatus;
  lastUpdaterStatus = next.status;
  state.updater = next;
  // On the update view we always re-render (progress ticks, status changes).
  // On the provider view we only re-render when the availability badge flips,
  // to avoid disturbing an in-progress form edit.
  if (state.view === "update") {
    render();
  } else if (statusChanged) {
    render();
  }
});
// Best-effort initial state pull; guarded so environments without the updater
// IPC (e.g. capture scripts) don't crash.
if (typeof window.codingPlanBar.getUpdaterState === "function") {
  window.codingPlanBar
    .getUpdaterState()
    .then((initial) => {
      state.updater = initial;
      if (root.childElementCount) render();
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
    state.templates = payload.templates || [];
    state.selectedId = state.config.providers[0]?.id || null;
    state.status = "设置已载入";
    state.statusIsError = false;
    state.statusTone = "success";
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
  }
  render();
}

function render() {
  const selected = selectedProvider();
  const enterClass = hasRenderedSettingsShell ? "" : "is-entering";
  root.innerHTML = `
    <section class="settings-shell ${enterClass}">
      <header class="topbar">
        <div>
          <h1>设置</h1>
          <p>${escapeHtml(state.configPath || "配置文件尚未载入")}</p>
        </div>
        <div class="top-actions">
          <button class="btn" data-action="refresh">重新读取</button>
          <button class="btn" data-action="open-json">高级 JSON</button>
        </div>
      </header>

      <section class="settings-body">
        <aside class="sidebar">
          <div class="sidebar-head">
            <strong>供应商</strong>
            <div class="sidebar-head-actions">
              <button class="btn small" data-action="import-accounts">导入账号</button>
              <button class="btn small primary" data-action="toggle-templates">添加</button>
            </div>
          </div>
          <div class="provider-list has-bar ${state.view === "providers" ? "" : "is-dimmed"}">
            <div class="selection-bar" aria-hidden="true"></div>
            ${renderProviderList()}
          </div>
          <nav class="sidebar-nav">
            <button class="nav-item ${state.view === "update" ? "is-active" : ""}" data-action="show-update">
              <span class="nav-dot ${state.updater.status === "available" ? "has-update" : ""}"></span>
              关于与更新
              ${state.updater.status === "available" ? '<span class="nav-badge">新版本</span>' : ""}
            </button>
          </nav>
        </aside>

        <section class="editor">
          ${
            state.view === "update"
              ? renderUpdatePage()
              : selected
                ? renderEditor(selected)
                : `<div class="empty"><div><strong>没有供应商</strong><p class="hint">点击左侧“添加”创建一个供应商。</p></div></div>`
          }
        </section>
      </section>

      <footer class="bottom-bar">
        <span class="status ${state.statusIsError ? "is-error" : ""} ${state.statusTone ? `is-${state.statusTone}` : ""}">${escapeHtml(state.status)}</span>
        <div class="bottom-actions">
          <button class="btn" data-action="reset">撤销未保存修改</button>
          <button class="btn primary" data-action="save">保存并刷新额度</button>
        </div>
      </footer>

      ${renderImportPreview()}
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
  const listRect = list.getBoundingClientRect();
  const itemRect = selected.getBoundingClientRect();
  bar.style.transform = `translateY(${itemRect.top - listRect.top}px)`;
  bar.style.width = `${itemRect.width}px`;
  bar.style.height = `${itemRect.height + 6}px`;
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

function renderProviderList() {
  if (!state.config.providers.length) return renderEmptyList();
  return providerGroups()
    .map(
      (group) => `
        <div class="provider-group">
          <div class="provider-group-title">
            <span>${escapeHtml(group.label)}</span>
            <em>${group.providers.length}</em>
          </div>
          ${group.providers.map(renderProviderItem).join("")}
        </div>
      `,
    )
    .join("");
}

function providerGroups() {
  const groups = [
    { key: "accounts", label: "官方账号", providers: [] },
    { key: "balance", label: "余额接口", providers: [] },
    { key: "other", label: "其他供应商", providers: [] },
  ];
  for (const provider of state.config.providers) {
    if (provider.kind === "official-subscription") groups[0].providers.push(provider);
    else if (provider.kind === "balance" || provider.kind === "coding-plan") groups[1].providers.push(provider);
    else groups[2].providers.push(provider);
  }
  return groups.filter((group) => group.providers.length);
}

function renderProviderItem(provider) {
  const selected = provider.id === state.selectedId ? "is-selected" : "";
  const detail = providerDetail(provider);
  return `
    <div class="provider-item ${selected}" data-action="select-provider" data-id="${escapeAttr(provider.id)}" role="button" tabindex="0">
      <button class="drag-handle" type="button" draggable="true" data-action="drag-provider" data-id="${escapeAttr(provider.id)}" title="拖动调整顺序" aria-label="拖动 ${escapeAttr(provider.name || provider.id)} 调整顺序">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
      </button>
      <span class="dot ${provider.enabled === false ? "is-off" : ""}"></span>
      <span class="provider-name">
        <strong>${escapeHtml(provider.name || provider.id)}</strong>
        <span>${escapeHtml(detail)}</span>
      </span>
      <label class="switch" title="启用">
        <input type="checkbox" data-action="toggle-enabled" data-id="${escapeAttr(provider.id)}" ${provider.enabled !== false ? "checked" : ""} />
        <span></span>
      </label>
    </div>
  `;
}

function providerDetail(provider) {
  if (provider.kind === "official-subscription") {
    const parts = [KIND_LABELS[provider.kind]];
    if (provider.importedFrom) parts.push(provider.importedFrom);
    if (provider.planType) parts.push(provider.planType);
    return parts.join(" · ");
  }
  return `${KIND_LABELS[provider.kind] || provider.kind}${provider.baseUrl ? ` · ${provider.baseUrl}` : ""}`;
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
    statusLine = `发现新版本 ${escapeHtml(latestVersion)}。`;
    primary = `<button class="btn primary" data-action="download-update">下载更新</button>`;
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

function safeProviderPreview(provider) {
  const clone = { ...provider };
  if (clone.accessToken) clone.accessToken = maskSecret(clone.accessToken);
  if (clone.apiKey) clone.apiKey = maskSecret(clone.apiKey);
  if (clone.importPath) clone.importPath = "<local file>";
  return clone;
}

function maskSecret(value) {
  const text = String(value || "");
  if (text.length <= 12) return "********";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function displayVersion(value) {
  if (!value) return "—";
  return String(value).trim().replace(/^v(?=\d)/i, "");
}

function releaseNotesPreview(value) {
  const text = String(value || "")
    .replace(/[#>*_`-]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function renderEditor(provider) {
  const showEndpointFields = provider.kind !== "official-subscription";
  return `
    <div class="editor-head">
      <div class="section-title">
        <strong>${escapeHtml(provider.name || provider.id)}</strong>
        <span>${escapeHtml(KIND_LABELS[provider.kind] || provider.kind)}</span>
      </div>
      <div class="row-actions">
        <label class="switch" title="启用">
          <input type="checkbox" data-field="enabled" ${provider.enabled !== false ? "checked" : ""} />
          <span></span>
        </label>
        <button class="btn danger" data-action="delete-provider">删除</button>
      </div>
    </div>
    <form class="form">
      <div class="form-grid">
        <div class="field">
          <label>供应商 ID</label>
          <input data-field="id" value="${escapeAttr(provider.id)}" />
          <p class="hint">用于配置识别，只能包含字母、数字、下划线和短横线。</p>
        </div>
        <div class="field">
          <label>显示名称</label>
          <input data-field="name" value="${escapeAttr(provider.name)}" />
        </div>
        <div class="field">
          <label>供应商类型</label>
          ${renderCustomSelect("kind", provider.kind, [
            ["official-subscription", "官方订阅"],
            ["coding-plan", "Coding Plan 额度"],
            ["balance", "余额查询"],
            ["manual", "手动额度"],
          ])}
        </div>
        ${
          provider.kind === "official-subscription"
            ? `
              <div class="field">
                <label>官方工具</label>
                ${renderCustomSelect("tool", provider.tool || "codex", [
                  ["codex", "Codex"],
                  ["claude", "Claude"],
                ])}
              </div>
            `
            : ""
        }
        ${
          showEndpointFields
            ? `
              <div class="field full">
                <label>请求地址 / Base URL</label>
                <input data-field="baseUrl" value="${escapeAttr(provider.baseUrl || "")}" placeholder="例如：https://api.deepseek.com" />
                <p class="hint">Coding Plan 和余额查询需要填写官方接口地址。</p>
              </div>
              <div class="field">
                <label>API Key</label>
                <input data-field="apiKey" type="password" value="${escapeAttr(provider.apiKey || "")}" placeholder="可留空，优先建议使用环境变量" />
              </div>
              <div class="field">
                <label>API Key 环境变量</label>
                <input data-field="apiKeyEnv" value="${escapeAttr(apiKeyEnvToText(provider.apiKeyEnv))}" placeholder="例如：DEEPSEEK_API_KEY" />
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

function renderOfficialNotice(provider) {
  const imported = provider.importedFrom || provider.accessToken;
  const email = provider.accountEmail || provider.name || "";
  const expires = provider.expiresAt ? new Date(provider.expiresAt).toLocaleString("zh-CN") : "未知";
  if (imported) {
    return `
      <div class="notice-box import-notice">
        <strong>已导入 OpenAI OAuth 账号</strong>
        <span>${escapeHtml(email)}${provider.planType ? ` · ${escapeHtml(provider.planType)}` : ""}</span>
        <span>过期时间：${escapeHtml(expires)}。导入的 token 会保存在本机 config.json，请不要分享配置文件。</span>
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

function renderCustomSelect(field, value, options) {
  const open = state.openDropdown === field;
  const closing = state.closingDropdown === field;
  const selected = options.find(([optionValue]) => optionValue === value) || options[0];
  return `
    <div class="custom-select ${open ? "is-open" : ""} ${closing ? "is-closing" : ""}" data-field="${escapeAttr(field)}" data-open="${open ? "true" : "false"}">
      <button class="custom-select-trigger" type="button" data-action="toggle-dropdown" data-field="${escapeAttr(field)}" aria-haspopup="listbox" aria-expanded="${open ? "true" : "false"}">
        <span>${escapeHtml(selected?.[1] || value || "请选择")}</span>
        <svg class="select-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      <div class="custom-select-options" role="listbox">
        ${options
          .map(
            ([optionValue, label]) => `
              <button class="custom-select-option ${optionValue === value ? "is-selected" : ""}" type="button" role="option" aria-selected="${optionValue === value ? "true" : "false"}" data-action="select-option" data-field="${escapeAttr(field)}" data-value="${escapeAttr(optionValue)}">
                ${escapeHtml(label)}
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
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
        <div class="import-summary">
          <div><strong>${Number(preview.accountCount || 0)}</strong><span>检测账号</span></div>
          <div class="is-add"><strong>${Number(preview.importedCount || 0)}</strong><span>新增</span></div>
          <div class="is-update"><strong>${Number(preview.updatedCount || 0)}</strong><span>更新</span></div>
          <div class="is-skip"><strong>${Number(preview.skippedCount || 0)}</strong><span>跳过</span></div>
        </div>
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

function renderImportDuplicateNotes(preview) {
  const groups = preview.duplicateGroups || [];
  if (!groups.length) return "";
  return `
    <div class="import-notes">
      ${groups
        .map(
          (group) => `
            <div class="import-note">
              <strong>同主邮箱多账号</strong>
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
  root.querySelectorAll("[data-action='select-provider']").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest(".switch, .drag-handle")) return;
      state.selectedId = row.dataset.id;
      state.view = "providers";
      dismissTemplates();
      render();
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest(".drag-handle")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedId = row.dataset.id;
      state.view = "providers";
      dismissTemplates();
      render();
    });
  });

  bindProviderReorder();

  root.querySelectorAll("[data-action='toggle-enabled']").forEach((input) => {
    input.addEventListener("change", () => {
      pulseToggle(input);
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

  root.querySelector("[data-action='import-accounts']")?.addEventListener("click", chooseImportAccounts);
  root.querySelectorAll("[data-action='cancel-import-preview']").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest(".import-popover") && !event.target.closest(".icon-close")) return;
      closeImportPreview();
    });
  });
  root.querySelector("[data-action='confirm-import-preview']")?.addEventListener("click", confirmImportAccounts);

  root.querySelector("[data-action='delete-provider']")?.addEventListener("click", () => deleteSelectedProvider());
  root.querySelector("[data-action='save']")?.addEventListener("click", save);
  root.querySelector("[data-action='reset']")?.addEventListener("click", load);
  root.querySelector("[data-action='refresh']")?.addEventListener("click", load);
  root.querySelector("[data-action='open-json']")?.addEventListener("click", () => window.codingPlanBar.openConfigJson());

  root.querySelectorAll("[data-action='toggle-dropdown']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.openDropdown === button.dataset.field) {
        closeDropdown();
        return;
      }
      openDropdown(button.dataset.field);
    });
  });

  root.querySelectorAll("[data-action='select-option']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      updateSelectedField(button.dataset.field, button.dataset.value, false);
      closeDropdown({ renderAfterClose: true });
    });
  });

  root.querySelectorAll("input[data-field]").forEach((field) => {
    if (field.type === "checkbox") {
      field.addEventListener("change", () => {
        pulseToggle(field);
        updateSelectedFromField(field, true);
      });
      return;
    }
    field.addEventListener("input", () => updateSelectedFromField(field, false));
    field.addEventListener("change", () => updateSelectedFromField(field, true));
  });

  bindUpdateEvents();
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
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
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

  list.addEventListener("dragover", (event) => {
    if (providerDrag.sourceId) event.preventDefault();
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

/* Add a one-shot bounce class to the toggle's wrapper for springy feedback. */
function pulseToggle(input) {
  const sw = input.closest(".switch");
  if (!sw) return;
  sw.classList.remove("is-just-toggled");
  void sw.offsetWidth;
  sw.classList.add("is-just-toggled");
  window.setTimeout(() => sw.classList.remove("is-just-toggled"), 340);
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
  if (shouldRender) render();
  else updateStatusText();
}

function updateProvider(id, patch) {
  const provider = state.config.providers.find((item) => item.id === id);
  if (!provider) return;
  Object.assign(provider, patch);
  markDirty();
  render();
}

function addTemplate(templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;
  const provider = uniqueProvider(sanitizeProvider(clone(template.provider)));
  const firstPositions = captureListPositions();
  state.config.providers.push(provider);
  state.selectedId = provider.id;
  dismissTemplates();
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
    state.status = "请选择 sessions.json 或 sub2api 导出的 JSON 文件...";
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
    state.importPreview = preview;
    state.importPreviewClosing = false;
    state.status = preview.message || "已生成导入预览，请确认";
    state.statusIsError = false;
    state.statusTone = (preview.importedCount || preview.updatedCount) ? "dirty" : "success";
    render();
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
    state.statusTone = "error";
    updateStatusText();
  }
}

async function confirmImportAccounts() {
  if (!state.importPreview?.filePath) return;
  try {
    state.status = "正在导入账号...";
    state.statusIsError = false;
    state.statusTone = "loading";
    updateStatusText();
    const firstPositions = captureListPositions();
    const result = await window.codingPlanBar.importAccounts(state.importPreview.filePath);
    state.importPreview = null;
    state.importPreviewClosing = false;
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

function closeImportPreview() {
  if (!state.importPreview) return;
  window.clearTimeout(importPreviewCloseTimer);
  state.importPreviewClosing = true;
  render();
  importPreviewCloseTimer = window.setTimeout(() => {
    state.importPreview = null;
    state.importPreviewClosing = false;
    render();
  }, 180);
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
  state.templateOrigin = elementCenter(originElement) || state.templateOrigin;
  state.showTemplates = true;
  state.templatesClosing = false;
  dismissDropdown();
  root.querySelector(".template-backdrop")?.remove();
  root.querySelector(".settings-shell")?.insertAdjacentHTML("beforeend", renderTemplatePopover());
  bindTemplateEvents();
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
    dismissTemplates();
  }, 210);
}

function dismissTemplates() {
  window.clearTimeout(templatesCloseTimer);
  templatesCloseTimer = null;
  root.querySelector(".template-backdrop")?.remove();
  state.showTemplates = false;
  state.templatesClosing = false;
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
  select.querySelector(".custom-select-trigger")?.setAttribute("aria-expanded", "true");
  state.openDropdown = field;
  state.closingDropdown = null;
}

function closeDropdown(options = {}) {
  if (!state.openDropdown) return;
  window.clearTimeout(dropdownCloseTimer);
  const { renderAfterClose = false } = options;
  const field = state.openDropdown;
  const select = root.querySelector(`.custom-select[data-field="${cssEscape(field)}"]`);
  select?.classList.remove("is-open");
  select?.classList.add("is-closing");
  select?.querySelector(".custom-select-trigger")?.setAttribute("aria-expanded", "false");
  state.openDropdown = null;
  state.closingDropdown = field;
  dropdownCloseTimer = window.setTimeout(() => {
    dismissDropdown();
    if (renderAfterClose) render();
  }, 190);
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
  return {
    refreshIntervalSeconds: Number(config.refreshIntervalSeconds || 300),
    showOnHover: config.showOnHover !== false,
    autoUpdate: {
      enabled: (config.autoUpdate || {}).enabled !== false,
    },
    providers: Array.isArray(config.providers) ? config.providers.map(clone) : [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function option(value, label, selected) {
  return `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
