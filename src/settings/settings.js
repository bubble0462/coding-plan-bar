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
    providers: [],
  },
  templates: [],
  selectedId: null,
  status: "正在读取设置...",
  statusIsError: false,
  statusTone: "loading",
  dirty: false,
  showTemplates: false,
  templatesClosing: false,
  templateOrigin: null,
  openDropdown: null,
  closingDropdown: null,
};

let templatesCloseTimer = null;
let dropdownCloseTimer = null;
let hasRenderedSettingsShell = false;

window.addEventListener("click", (event) => {
  // Only re-render when we actually need to close an open provider picker.
  // Re-rendering on every click destroys <select> dropdowns and input focus.
  if (state.openDropdown && !event.target.closest(".custom-select")) {
    closeDropdown();
    return;
  }
  if (!state.showTemplates || state.templatesClosing) return;
  if (event.target.closest(".template-popover") || event.target.closest("[data-action='toggle-templates']")) {
    return;
  }
  closeTemplates();
});

load();

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
            <button class="btn small primary" data-action="toggle-templates">添加</button>
          </div>
          <div class="provider-list has-bar">
            <div class="selection-bar" aria-hidden="true"></div>
            ${state.config.providers.length ? state.config.providers.map(renderProviderItem).join("") : renderEmptyList()}
          </div>
        </aside>

        <section class="editor">
          ${
            selected
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

function renderProviderItem(provider) {
  const selected = provider.id === state.selectedId ? "is-selected" : "";
  const detail =
    provider.kind === "official-subscription"
      ? KIND_LABELS[provider.kind]
      : `${KIND_LABELS[provider.kind] || provider.kind}${provider.baseUrl ? ` · ${provider.baseUrl}` : ""}`;
  return `
    <div class="provider-item ${selected}" data-action="select-provider" data-id="${escapeAttr(provider.id)}" role="button" tabindex="0">
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

function renderEmptyList() {
  return `<div class="empty"><p class="hint">还没有供应商。</p></div>`;
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
                <div class="notice-box">
                  <strong>官方订阅不使用请求地址或 API Key</strong>
                  <span>Codex 读取本机 Codex 登录状态，Claude 读取本机 Claude OAuth 登录状态。</span>
                </div>
              </div>
            `
        }
      </div>

      <div class="section">
        <div class="section-title">
          <strong>当前 JSON 预览</strong>
          <span>保存时会写入同一个 config.json。</span>
        </div>
        <pre class="json-preview">${escapeHtml(JSON.stringify(provider, null, 2))}</pre>
      </div>
    </form>
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

function bindEvents() {
  root.querySelectorAll("[data-action='select-provider']").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest(".switch")) return;
      state.selectedId = row.dataset.id;
      dismissTemplates();
      render();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedId = row.dataset.id;
      dismissTemplates();
      render();
    });
  });

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
