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
  dirty: false,
  showTemplates: false,
};

window.addEventListener("click", (event) => {
  // Only re-render when we actually need to close an open provider picker.
  // Re-rendering on every click destroys <select> dropdowns and input focus.
  if (!state.showTemplates) return;
  if (event.target.closest(".template-popover") || event.target.closest("[data-action='toggle-templates']")) {
    return;
  }
  state.showTemplates = false;
  render();
});

load();

async function load() {
  try {
    const payload = await window.codingPlanBar.getConfig();
    state.configPath = payload.configPath;
    state.config = sanitizeConfig(cloneConfig(payload.config));
    state.templates = payload.templates || [];
    state.selectedId = state.config.providers[0]?.id || null;
    state.status = "设置已载入";
    state.statusIsError = false;
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
  }
  render();
}

function render() {
  const selected = selectedProvider();
  root.innerHTML = `
    <section class="settings-shell">
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
          <div class="provider-list">
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
        <span class="status ${state.statusIsError ? "is-error" : ""}">${escapeHtml(state.status)}</span>
        <div class="bottom-actions">
          <button class="btn" data-action="reset">撤销未保存修改</button>
          <button class="btn primary" data-action="save">保存并刷新额度</button>
        </div>
      </footer>

      ${state.showTemplates ? renderTemplatePopover() : ""}
    </section>
  `;

  bindEvents();
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
          <select data-field="kind">
            ${option("official-subscription", "官方订阅", provider.kind)}
            ${option("coding-plan", "Coding Plan 额度", provider.kind)}
            ${option("balance", "余额查询", provider.kind)}
            ${option("manual", "手动额度", provider.kind)}
          </select>
        </div>
        ${
          provider.kind === "official-subscription"
            ? `
              <div class="field">
                <label>官方工具</label>
                <select data-field="tool">
                  ${option("codex", "Codex", provider.tool || "")}
                  ${option("claude", "Claude", provider.tool || "")}
                </select>
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
  return `
    <div class="template-backdrop" data-action="cancel-templates">
      <div class="template-popover" role="dialog" aria-modal="true" aria-label="添加供应商">
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

function renderTemplateCard(template) {
  return `
    <button class="template-card" data-action="add-template" data-template="${escapeAttr(template.id)}">
      <span class="template-logo">${escapeHtml(template.short || template.label.slice(0, 2))}</span>
      <span class="template-copy">
        <strong>${escapeHtml(template.label)}</strong>
        <small>${escapeHtml(template.category || KIND_LABELS[template.provider?.kind] || "供应商")}</small>
        <em>${escapeHtml(template.description || "")}</em>
      </span>
    </button>
  `;
}

function bindEvents() {
  root.querySelectorAll("[data-action='select-provider']").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest(".switch")) return;
      state.selectedId = row.dataset.id;
      state.showTemplates = false;
      render();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedId = row.dataset.id;
      state.showTemplates = false;
      render();
    });
  });

  root.querySelectorAll("[data-action='toggle-enabled']").forEach((input) => {
    input.addEventListener("change", () => {
      updateProvider(input.dataset.id, { enabled: input.checked });
    });
  });

  root.querySelector("[data-action='toggle-templates']")?.addEventListener("click", (event) => {
    event.stopPropagation();
    state.showTemplates = !state.showTemplates;
    render();
  });

  root.querySelectorAll("[data-action='cancel-templates']").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest(".template-popover") && !event.target.closest(".icon-close")) return;
      state.showTemplates = false;
      render();
    });
  });

  root.querySelector(".template-popover")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  root.querySelectorAll("[data-action='add-template']").forEach((button) => {
    button.addEventListener("click", () => addTemplate(button.dataset.template));
  });

  root.querySelector("[data-action='delete-provider']")?.addEventListener("click", () => deleteSelectedProvider());
  root.querySelector("[data-action='save']")?.addEventListener("click", save);
  root.querySelector("[data-action='reset']")?.addEventListener("click", load);
  root.querySelector("[data-action='refresh']")?.addEventListener("click", load);
  root.querySelector("[data-action='open-json']")?.addEventListener("click", () => window.codingPlanBar.openConfigJson());

  root.querySelectorAll("[data-field]").forEach((field) => {
    if (field.type === "checkbox" || field.tagName === "SELECT") {
      field.addEventListener("change", () => updateSelectedFromField(field, true));
      return;
    }
    field.addEventListener("input", () => updateSelectedFromField(field, false));
    field.addEventListener("change", () => updateSelectedFromField(field, true));
  });
}

function updateSelectedFromField(field, shouldRender) {
  const provider = selectedProvider();
  if (!provider) return;
  const oldId = provider.id;
  let value = field.type === "checkbox" ? field.checked : field.value;
  if (field.dataset.field === "apiKeyEnv") value = textToApiKeyEnv(value);
  provider[field.dataset.field] = value;
  sanitizeProvider(provider);
  if (field.dataset.field === "id") state.selectedId = value || oldId;
  markDirty();
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
  state.config.providers.push(provider);
  state.selectedId = provider.id;
  state.showTemplates = false;
  markDirty();
  render();
}

function deleteSelectedProvider() {
  const provider = selectedProvider();
  if (!provider) return;
  state.config.providers = state.config.providers.filter((item) => item !== provider);
  state.selectedId = state.config.providers[0]?.id || null;
  markDirty();
  render();
}

async function save() {
  try {
    state.status = "正在保存...";
    state.statusIsError = false;
    state.config = sanitizeConfig(state.config);
    render();
    const payload = await window.codingPlanBar.saveConfig(state.config);
    state.config = cloneConfig(payload.config);
    state.configPath = payload.configPath;
    state.selectedId = state.config.providers.find((item) => item.id === state.selectedId)?.id || state.config.providers[0]?.id || null;
    state.status = "已保存并刷新额度";
    state.statusIsError = false;
    state.dirty = false;
  } catch (error) {
    state.status = error.message || String(error);
    state.statusIsError = true;
  }
  render();
}

function selectedProvider() {
  return state.config.providers.find((provider) => provider.id === state.selectedId) || null;
}

function markDirty() {
  state.dirty = true;
  state.status = "有未保存修改";
  state.statusIsError = false;
}

function updateStatusText() {
  const status = root.querySelector(".status");
  if (!status) return;
  status.textContent = state.status;
  status.classList.toggle("is-error", state.statusIsError);
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
