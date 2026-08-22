const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { providerTemplates } = require("../src/config-store");
const { importAccountsIntoConfig, previewAccountsImport } = require("../src/account-importer");

const showTemplates = process.argv.includes("--templates");
const showUpdate = process.argv.includes("--update");
const showReorder = process.argv.includes("--reorder");
const showImport = process.argv.includes("--import");
const showImportSource = process.argv.includes("--import-source");
const showImportDrop = process.argv.includes("--import-drop");
const showImportPaste = process.argv.includes("--import-paste");
const showImportClaude = process.argv.includes("--import-claude");
const showDirty = process.argv.includes("--dirty");
const showHealth = process.argv.includes("--health");
const showBackup = process.argv.includes("--backup");
const showUsage = process.argv.includes("--usage");
const showNotifications = process.argv.includes("--notifications");
const darkMode = process.argv.includes("--dark");
const baseOutputName = showTemplates
  ? "settings-screenshot-templates"
  : showUpdate
    ? "settings-screenshot-update"
    : showReorder
      ? "settings-screenshot-reorder"
      : showImport
        ? "settings-screenshot-import"
        : showImportSource
          ? "settings-screenshot-import-source"
          : showImportDrop
            ? "settings-screenshot-import-drop"
            : showImportPaste
              ? "settings-screenshot-import-paste"
            : showImportClaude
              ? "settings-screenshot-import-claude"
            : showDirty
              ? "settings-screenshot-dirty"
              : showHealth
                ? "settings-screenshot-health"
                : showBackup
                  ? "settings-screenshot-backup"
                    : showUsage
                      ? "settings-screenshot-usage"
                      : showNotifications
                        ? "settings-screenshot-notifications"
                        : "settings-screenshot";
const outputPath = path.join(
  __dirname,
  "..",
  "tmp",
  `${baseOutputName}${darkMode ? "-dark" : ""}.png`,
);
const captureUserDataPath = path.join(__dirname, "..", "tmp", `electron-settings-${process.pid}`);
app.setPath("userData", captureUserDataPath);

const sampleConfig = {
  refreshIntervalSeconds: 300,
  showOnHover: true,
  panelDensity: "comfortable",
  theme: darkMode ? "dark" : "light",
  autoUpdate: { enabled: true },
  providers: [
    {
      id: "codex",
      name: "Codex",
      kind: "official-subscription",
      tool: "codex",
      baseUrl: "https://api.kimi.com/coding/",
      apiKey: "should-not-render",
      enabled: true,
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      kind: "balance",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      enabled: true,
    },
  ],
};

const healthThresholdSnapshot = {
  updatedAt: Date.parse("2026-07-25T10:00:00+08:00"),
  refreshIntervalSeconds: 300,
  providers: [
    {
      id: "codex",
      name: "Codex",
      kind: "official-subscription",
      status: "warn",
      statusText: "使用偏高",
      tiers: [{ name: "weekly_limit", label: "周额度", utilization: 70 }],
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      kind: "balance",
      status: "danger",
      statusText: "接近上限",
      tiers: [{ name: "monthly", label: "月额度", utilization: 90 }],
    },
  ],
};

const sampleImportJson = {
  type: "codex",
  account_id: "acct-cpa-sample",
  chatgpt_account_id: "acct-cpa-sample",
  email: "demo.cpa@example.com",
  name: "demo.cpa@example.com",
  plan_type: "plus",
  chatgpt_plan_type: "plus",
  access_token: "sample-cpa-access-token",
  session_token: "sample-session-token-not-persisted",
  expired: "2027-01-01T00:00:00Z",
};
const sampleClaudeImportJson = {
  type: "claude",
  access_token: "sample-claude-access-token-not-for-network-use",
  refresh_token: "sample-refresh-token-must-not-render",
  id_token: "sample-id-token-must-not-render",
  disabled: false,
  email: "demo.claude@example.com",
  expired: "2027-01-01T00:00:00Z",
};
const sampleImportPath = path.join(__dirname, "..", "tmp", "demo.cpa.2026-07-18.json");
const activeImportJson = showImportClaude ? sampleClaudeImportJson : sampleImportJson;
const activeImportPath = showImportClaude
  ? path.join(__dirname, "..", "tmp", "claude-demo.claude@example.com.json")
  : sampleImportPath;

// Mock updater state injected into the settings page. For --update we report a
// newer release is available so the screenshot exercises the download path.
const mockUpdaterState = {
  status: "available",
  result: {
    currentVersion: "0.3.9",
    latestVersion: "v0.3.10",
    hasUpdate: true,
    releaseUrl: "https://github.com/bubble0462/coding-plan-bar/releases/latest",
    publishedAt: new Date().toISOString(),
    releaseNotes: "示例更新日志",
    asset: {
      name: "Coding Plan Bar-Setup-0.3.10-x64.exe",
      url: "https://github.com/bubble0462/coding-plan-bar/releases/download/v0.3.10/Coding.Plan.Bar-Setup-0.3.10-x64.exe",
      size: 98000000,
    },
    error: null,
  },
  downloadedPath: null,
  progress: null,
  error: null,
  checkedAt: Date.now(),
  lastPublishedAt: new Date().toISOString(),
};

const mockCodexAgentUsage = {
  generatedAt: Date.parse("2026-07-19T11:50:00+08:00"),
  lastEventAt: Date.parse("2026-07-19T11:48:00+08:00"),
  windows: {
    today: { requests: 241, sessions: 6, inputTokens: 48200421, outputTokens: 166902, cacheReadTokens: 43721600, cacheCreationTokens: 0, totalTokens: 48367323, costUsd: 45.2819, partialCost: false },
    sevenDays: { requests: 3123, sessions: 13, inputTokens: 459447914, outputTokens: 1862684, cacheReadTokens: 427806450, cacheCreationTokens: 0, totalTokens: 461310598, costUsd: 330.775, partialCost: true },
    thirtyDays: { requests: 9120, sessions: 42, inputTokens: 1240820000, outputTokens: 4780000, cacheReadTokens: 1149210000, cacheCreationTokens: 0, totalTokens: 1245600000, costUsd: 876.42, partialCost: true },
  },
  daily: [
    { date: "2026-07-13", totalTokens: 41200000 }, { date: "2026-07-14", totalTokens: 68000000 },
    { date: "2026-07-15", totalTokens: 28700000 }, { date: "2026-07-16", totalTokens: 104000000 },
    { date: "2026-07-17", totalTokens: 73500000 }, { date: "2026-07-18", totalTokens: 97300000 },
    { date: "2026-07-19", totalTokens: 48367323 },
  ],
  models: [
    { model: "gpt-5.6-sol", requests: 2253, totalTokens: 335210922, costUsd: 290.2766, partialCost: false },
    { model: "gpt-5.6-luna", requests: 656, totalTokens: 88374236, costUsd: 19.0717, partialCost: false },
    { model: "gpt-5.6-terra", requests: 209, totalTokens: 37539145, costUsd: 20.7717, partialCost: false },
    { model: "gemini-3.5-flash-low", requests: 3, totalTokens: 53120, costUsd: null, partialCost: false },
  ],
};

const mockClaudeAgentUsage = {
  generatedAt: Date.parse("2026-07-19T11:50:00+08:00"),
  lastEventAt: Date.parse("2026-07-19T11:46:00+08:00"),
  windows: {
    today: { requests: 58, sessions: 4, inputTokens: 980000, outputTokens: 42100, cacheReadTokens: 8200000, cacheCreationTokens: 120000, totalTokens: 9342100, costUsd: 6.18, partialCost: false },
    sevenDays: { requests: 742, sessions: 22, inputTokens: 12400000, outputTokens: 682000, cacheReadTokens: 98000000, cacheCreationTokens: 1400000, totalTokens: 112522000, costUsd: 78.44, partialCost: true },
    thirtyDays: { requests: 2810, sessions: 88, inputTokens: 41000000, outputTokens: 2100000, cacheReadTokens: 318000000, cacheCreationTokens: 4600000, totalTokens: 365700000, costUsd: 248.92, partialCost: true },
  },
  daily: [
    { date: "2026-07-13", totalTokens: 38400000 }, { date: "2026-07-14", totalTokens: 52100000 },
    { date: "2026-07-15", totalTokens: 29800000 }, { date: "2026-07-16", totalTokens: 61200000 },
    { date: "2026-07-17", totalTokens: 44600000 }, { date: "2026-07-18", totalTokens: 58800000 },
    { date: "2026-07-19", totalTokens: 9342100 },
  ],
  models: [
    { model: "claude-opus-4-8", requests: 1240, totalTokens: 210400000, costUsd: 188.42, partialCost: false },
    { model: "claude-sonnet-4-6", requests: 1022, totalTokens: 98300000, costUsd: 42.18, partialCost: false },
    { model: "claude-haiku-4-5", requests: 548, totalTokens: 57000000, costUsd: 18.32, partialCost: true },
  ],
};

const mockAgentUsage = {
  generatedAt: Date.parse("2026-07-19T11:50:00+08:00"),
  codex: mockCodexAgentUsage,
  claude: mockClaudeAgentUsage,
};
const mockAgentUsageEnvelope = {
  data: mockAgentUsage,
  refreshing: false,
  stale: false,
  savedAt: mockAgentUsage.generatedAt,
  error: null,
};


function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  ipcMain.handle("config:get", () => ({
    config: sampleConfig,
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
    templates: providerTemplates(),
    agentUsage: mockAgentUsageEnvelope,
    snapshot: showHealth ? healthThresholdSnapshot : undefined,
  }));
  ipcMain.handle("config:save", (_event, config) => ({
    config,
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
  }));
  ipcMain.handle("config:open-json", () => {});
  ipcMain.handle("config:choose-import-accounts", () => ({
    ...previewAccountsImport(sampleConfig, activeImportJson, activeImportPath),
    filePath: activeImportPath,
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
  }));
  ipcMain.handle("config:preview-import-file", () => ({
    ...previewAccountsImport(sampleConfig, activeImportJson, activeImportPath),
    filePath: activeImportPath,
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
  }));
  ipcMain.handle("config:import-accounts", () => ({
    ...importAccountsIntoConfig(sampleConfig, activeImportJson, activeImportPath),
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
    filePath: activeImportPath,
  }));
  ipcMain.handle("config:preview-import", (_event, raw) => previewAccountsImport(sampleConfig, JSON.parse(raw), "pasted-json"));
  ipcMain.handle("quota:refresh", () => {});
  ipcMain.handle("usage:get-codex-agent", () => mockCodexAgentUsage);
  ipcMain.handle("usage:get-agent", () => mockAgentUsageEnvelope);
  // Must match chat-probe listCodexModels shape ({ slug, label }[]).
  // An empty array used to leave the probe card in a reload loop during capture.
  const mockCodexModels = [
    { slug: "gpt-5.4-nano", label: "gpt-5.4-nano" },
    { slug: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    { slug: "gpt-5.4", label: "gpt-5.4" },
    { slug: "gpt-5.6-sol", label: "gpt-5.6-sol" },
  ];
  for (const channel of ["chat:list-codex-models", "chat:probe-codex"]) {
    try {
      ipcMain.removeHandler(channel);
    } catch (_error) {
      // Channel may not exist yet on first registration.
    }
  }
  ipcMain.handle("chat:list-codex-models", () => mockCodexModels.slice());
  ipcMain.handle("chat:probe-codex", () => ({
    ok: true,
    text: "Capture probe reply.",
    latencyMs: 42,
    model: "gpt-5.4-nano",
    httpStatus: 200,
  }));
  ipcMain.handle("quota:open-config", () => {});
  ipcMain.handle("quota:hide", () => {});
  ipcMain.handle("quota:keep-open", () => {});
  ipcMain.handle("quota:leave-popup", () => {});
  ipcMain.handle("quota:visibility-complete", () => {});
  ipcMain.handle("quota:resize", () => {});
  ipcMain.handle("quota:quit", () => {});

  // Updater mocks — no real network. State is static; check/download/install
  // are no-ops so the capture is deterministic.
  ipcMain.handle("updater:get-state", () => mockUpdaterState);
  ipcMain.handle("updater:check", () => mockUpdaterState);
  ipcMain.handle("updater:download", () => mockUpdaterState);
  ipcMain.handle("updater:install", () => {});
  ipcMain.handle("updater:open-release", () => {});

  await app.whenReady();

  const window = new BrowserWindow({
    width: 940,
    height: 660,
    show: showTemplates || showUpdate || showReorder || showImport || showImportClaude || showHealth || showBackup || showUsage,
    x: showTemplates || showUpdate || showReorder || showImport || showImportClaude || showHealth || showBackup || showUsage ? -2200 : undefined,
    y: showTemplates || showUpdate || showReorder || showImport || showImportClaude || showHealth || showBackup || showUsage ? 80 : undefined,
    frame: true,
    backgroundColor: darkMode ? "#0f172a" : "#f6f8fb",
    webPreferences: {
      preload: path.join(__dirname, "..", "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(path.join(__dirname, "..", "src", "settings", "index.html"));
  await wait(800);
  if (showTemplates) {
    window.showInactive();
    await wait(120);
    // Hidden capture windows do not always advance CSS animations, so force
    // the template overlay into its settled visible state before asserting
    // and taking the screenshot.
    await window.webContents.insertCSS(`
      .template-backdrop,
      .template-popover,
      .template-row {
        animation: none !important;
      }

      .template-backdrop {
        opacity: 1 !important;
        background: rgba(15, 23, 42, 0.12) !important;
        backdrop-filter: blur(6px) !important;
      }

      .template-popover {
        opacity: 1 !important;
        left: 80px !important;
        top: 40px !important;
        width: calc(100vw - 160px) !important;
        max-height: calc(100vh - 80px) !important;
        transform: none !important;
        filter: none !important;
        z-index: 1 !important;
      }

      .template-row {
        opacity: 1 !important;
        transform: none !important;
      }
    `);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="toggle-templates"]')?.click();
    `);
    await wait(120);
    // Assert the popover is visibly open so a silent failure (e.g. a timing
    // miss or a selector change) cannot produce a misleading "passing" shot.
    const opened = await window.webContents.executeJavaScript(
      `(() => {
        const popover = document.querySelector(".template-popover");
        if (!popover) return false;
        const rect = popover.getBoundingClientRect();
        const style = getComputedStyle(popover);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0.99 &&
          rect.width > 200 &&
          rect.height > 120
        );
      })()`,
    );
    if (!opened) throw new Error("Template popover did not become visibly open");
    // Split selector: grouped menu rows + a live preview panel that follows
    // the selection, including the new Qwen template and its env hint.
    const splitAssertions = await window.webContents.executeJavaScript(`(() => {
      const rows = Array.from(document.querySelectorAll(".template-row"));
      const preview = document.querySelector(".template-preview");
      const selected = document.querySelector(".template-row.is-selected");
      return {
        menuGroups: document.querySelectorAll(".template-group").length,
        rowCount: rows.length,
        selectedTemplate: selected?.dataset.template || "",
        previewLabel: preview?.querySelector(".template-preview-head strong")?.textContent || "",
        previewRequirements: Array.from(preview?.querySelectorAll(".template-requirement") || []).map((node) => node.textContent.trim()),
        hasQwen: rows.some((row) => row.dataset.template === "qwen-coding"),
      };
    })()`);
    if (splitAssertions.menuGroups < 3) {
      throw new Error(`Template menu groups missing: ${JSON.stringify(splitAssertions)}`);
    }
    if (splitAssertions.rowCount !== providerTemplates().length) {
      throw new Error(`Template menu rows incomplete: ${splitAssertions.rowCount} of ${providerTemplates().length}`);
    }
    if (!splitAssertions.hasQwen) throw new Error("Template menu must include qwen-coding");
    if (!splitAssertions.previewLabel) throw new Error("Template preview did not render a label");
    if (!splitAssertions.selectedTemplate) throw new Error("Template menu must have a selected row");
    await window.webContents.executeJavaScript(
      `document.querySelector(".template-row[data-template='qwen-coding']")?.click()`,
    );
    await wait(120);
    const qwenPreview = await window.webContents.executeJavaScript(
      `(() => document.querySelector(".template-preview")?.textContent || "")()`,
    );
    if (!qwenPreview.includes("DASHSCOPE_API_KEY") || !qwenPreview.includes("bailian.console.aliyun.com")) {
      throw new Error(`Qwen template preview missing credential/baseUrl info: ${qwenPreview.slice(0, 160)}`);
    }
    const qwenSelected = await window.webContents.executeJavaScript(
      `(() => document.querySelector(".template-row.is-selected")?.dataset.template || "")()`,
    );
    if (qwenSelected !== "qwen-coding") throw new Error(`Qwen row selection state did not update: ${qwenSelected}`);
    // Template dialog must move keyboard focus into itself so it is operable
    // without the mouse, and Escape must close it back to the trigger.
    const templateFocus = await window.webContents.executeJavaScript(`(() => {
      const popover = document.querySelector(".template-popover");
      if (!popover) return { hasFocus: false };
      const firstCard = popover.querySelector("[data-action='add-template']");
      firstCard?.focus();
      return { hasFocus: popover.contains(document.activeElement) };
    })()`);
    if (!templateFocus.hasFocus) throw new Error("Template popover did not receive keyboard focus");
    await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await wait(260);
    const templateEscFocus = await window.webContents.executeJavaScript(`(() => {
      const trigger = document.querySelector('[data-action="toggle-templates"]');
      return {
        closed: !document.querySelector(".template-popover"),
        focusOnTrigger: document.activeElement === trigger,
      };
    })()`);
    if (!templateEscFocus.closed) throw new Error("Template popover Escape did not close the dialog");
    if (!templateEscFocus.focusOnTrigger) throw new Error("Template popover Escape did not restore focus to the trigger");
    await window.webContents.executeJavaScript(`document.querySelector('[data-action="toggle-templates"]')?.click()`);
    await wait(160);
  }

  if (showUpdate) {
    window.showInactive();
    await wait(120);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="show-update"]')?.click();
    `);
    await wait(200);
    // Assert the update page rendered with the expected content so a selector
    // or state bug can't slip through as a blank "passing" screenshot.
    const rendered = await window.webContents.executeJavaScript(
      `(() => {
        const page = document.querySelector(".update-page");
        if (!page) return false;
        const text = page.textContent || "";
        return text.includes("v0.3.9") && text.includes("v0.3.10") && !text.includes("vv0.3.10") && text.includes("下载更新");
      })()`,
    );
    if (!rendered) throw new Error("Update page did not render with version info");
  }

  if (showUsage) {
    window.showInactive();
    await wait(120);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="show-usage"]')?.click();
    `);
    await wait(260);
    const codexRendered = await window.webContents.executeJavaScript(`(() => {
      const page = document.querySelector(".usage-page");
      const text = page?.textContent || "";
      return text.includes("gpt-5.6-sol") && text.includes("1.25B");
    })()`);
    if (!codexRendered) throw new Error("Agent usage did not render Codex statistics");

    const usageLoading = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector(".usage-loading"))`,
    );
    if (usageLoading) throw new Error("Cached agent usage rendered a blocking loading state");

    await window.webContents.executeJavaScript(`document.querySelector('[data-action="set-agent-usage-source"][data-source="claude"]')?.click()`);
    await wait(120);
    const claudeRendered = await window.webContents.executeJavaScript(`(() => {
      const page = document.querySelector(".usage-page");
      const text = page?.textContent || "";
      return text.includes("claude-opus-4-8") && text.includes("365.7M");
    })()`);
    if (!claudeRendered) throw new Error("Agent usage did not switch to Claude Code statistics");
  }

  if (showHealth) {
    window.showInactive();
    await wait(120);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="show-health"]')?.click();
    `);
    await wait(200);
    const rendered = await window.webContents.executeJavaScript(
      `(() => {
        const page = document.querySelector(".health-page");
        if (!page) return false;
        const text = page.textContent || "";
        // Healthy state shows "全部正常" + freshness info; unhealthy state
        // shows "N 个项目需要处理". Either is valid.
        return text.includes("全部正常") || text.includes("需要处理");
      })()`,
    );
    if (!rendered) throw new Error("Health page did not render expected summary");
    const healthSummary = await window.webContents.executeJavaScript(`(() => {
      const hero = document.querySelector(".diagnostic-hero");
      if (!hero) return false;
      const text = hero.textContent || "";
      const refreshActions = document.querySelectorAll('[data-action="refresh-quota"]');
      if (refreshActions.length !== 1) return false;
      const rows = [...document.querySelectorAll(".health-row")];
      const codexItem = document.querySelector('.provider-item[data-id="codex"]');
      const deepseekItem = document.querySelector('.provider-item[data-id="deepseek"]');
      return text.includes("1 个项目需要处理") &&
        rows.length === 1 &&
        (rows[0].textContent || "").includes("DeepSeek") &&
        !(rows[0].textContent || "").includes("Codex") &&
        codexItem?.querySelector(".provider-badge")?.textContent === "关注" &&
        !codexItem.classList.contains("is-attention") &&
        deepseekItem?.classList.contains("is-attention");
    })()`);
    if (!healthSummary) throw new Error("Health page quota threshold regression failed");
  }

  if (showBackup) {
    window.showInactive();
    await wait(120);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="show-backup"]')?.click();
    `);
    await wait(200);
    const rendered = await window.webContents.executeJavaScript(
      `(() => {
        const page = document.querySelector(".backup-page");
        if (!page) return false;
        const text = page.textContent || "";
        return text.includes("备份 config.json") && text.includes("最近导入") && text.includes("隐私提醒");
      })()`,
    );
    if (!rendered) throw new Error("Backup page did not render expected controls");
  }

  if (showNotifications) {
    window.showInactive();
    await wait(120);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="show-notifications"]')?.click();
    `);
    await wait(200);
    const rendered = await window.webContents.executeJavaScript(
      `(() => {
        const page = document.querySelector(".notifications-page");
        if (!page) return false;
        const text = page.textContent || "";
        return (
          page.querySelectorAll(".segment").length === 2 &&
          page.querySelectorAll("[data-field='notificationsReset']").length === 1 &&
          page.querySelectorAll("[data-field='notificationsServiceError']").length === 1 &&
          text.includes("阈值") && text.includes("80%") && text.includes("95%") && text.includes("专注助手")
        );
      })()`,
    );
    if (!rendered) throw new Error("Notifications page did not render expected controls");
    // Turning the master switch off must dirty the config and reflect in the UI.
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action=' + JSON.stringify("set-notifications-enabled") + '][data-value="off"]')?.click();
    `);
    await wait(200);
    const toggled = await window.webContents.executeJavaScript(
      `(() => ({
        offActive: Boolean(document.querySelector('.segment[data-value="off"]')?.classList.contains("is-active")),
        dirty: document.querySelector(".dirty-actions")?.textContent.includes("保存") || false,
      }))()`,
    );
    if (!toggled.offActive || !toggled.dirty) {
      throw new Error(`Notifications toggle did not dirty the config: ${JSON.stringify(toggled)}`);
    }
  }

  if (showImport || showImportSource || showImportDrop || showImportPaste || showImportClaude) {
    window.showInactive();
    await wait(120);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="import-accounts"]')?.click();
    `);
    await wait(220);
    const sourceRendered = await window.webContents.executeJavaScript(`(() => {
      const popover = document.querySelector(".paste-popover");
      const latest = document.querySelector('[data-action="latest-import"]');
      if (!popover || !latest) return false;
      const text = popover.textContent || "";
      return text.includes("将 JSON 文件拖到这里") &&
        text.includes("选择文件") &&
        text.includes("粘贴内容") &&
        latest.textContent.includes("最新文件") &&
        latest.title.includes("Downloads") &&
        latest.title.includes("Claude") &&
        latest.title.includes("CPA");
    })()`);
    if (!sourceRendered) throw new Error("Unified import source dialog did not render expected controls");
  }

  if (showImportDrop) {
    const point = await window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.import-drop-zone')?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    })()`);
    if (!point) throw new Error("Import drop zone was not measurable");
    window.webContents.debugger.attach("1.3");
    const dragData = { items: [], files: [sampleImportPath], dragOperationsMask: 1 };
    await window.webContents.debugger.sendCommand("Input.dispatchDragEvent", { type: "dragEnter", ...point, data: dragData });
    await window.webContents.debugger.sendCommand("Input.dispatchDragEvent", { type: "dragOver", ...point, data: dragData });
    await window.webContents.debugger.sendCommand("Input.dispatchDragEvent", { type: "drop", ...point, data: dragData });
    window.webContents.debugger.detach();
    await wait(450);
    const dropped = await window.webContents.executeJavaScript(`Boolean(document.querySelector('.import-popover'))`);
    if (!dropped) throw new Error("Dropped JSON file did not open the import preview");
  }

  if (showImport || showImportClaude) {
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="choose-import-file"]')?.click();
    `);
  }

  if (showImportPaste) {
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('[data-field="importRaw"]');
      if (!input) return;
      input.value = ${JSON.stringify(JSON.stringify(sampleImportJson))};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('[data-action="preview-paste-import"]')?.click();
    })()`);
  }

  if (showImport || showImportPaste || showImportClaude) {
    await wait(450);
    const rendered = await window.webContents.executeJavaScript(
      `(() => {
        const popover = document.querySelector(".import-popover");
        if (!popover) return false;
        const text = popover.textContent || "";
        const expectedIdentity = ${JSON.stringify(showImportClaude ? "Claude 邮箱" : "CPA accountId")};
        const secretsHidden = !text.includes("sample-claude-access-token") &&
          !text.includes("sample-refresh-token") &&
          !text.includes("sample-id-token");
        return text.includes("导入账号预览") && text.includes("检测账号") && text.includes("新增") && text.includes(expectedIdentity) && secretsHidden;
      })()`,
    );
    if (!rendered) throw new Error("Import preview did not render expected summary");
    const importFocus = await window.webContents.executeJavaScript(`(() => {
      const popover = document.querySelector(".import-popover");
      if (!popover) return { hasFocus: false };
      const target = popover.querySelector("[data-action='confirm-import-preview']:not([disabled])") || popover.querySelector(".icon-close");
      target?.focus();
      const expectedIdentity = ${JSON.stringify(showImportClaude ? "Claude 邮箱" : "CPA accountId")};
      const identityLabels = [...popover.querySelectorAll('.import-row small')]
        .filter((node) => node.textContent.includes(expectedIdentity));
      const zeroStats = [...popover.querySelectorAll('.import-summary > div')]
        .filter((node) => node.querySelector('strong')?.textContent.trim() === '0');
      return {
        hasFocus: popover.contains(document.activeElement),
        identityLabelCount: identityLabels.length,
        zeroStatsMuted: zeroStats.length > 0 && zeroStats.every((node) => node.classList.contains('is-zero')),
      };
    })()`);
    if (!importFocus.hasFocus) throw new Error("Import preview did not receive keyboard focus");
    if (importFocus.identityLabelCount !== 1) {
      throw new Error(`Import preview did not show one expected identity label: ${JSON.stringify(importFocus)}`);
    }
    if (!importFocus.zeroStatsMuted) {
      throw new Error(`Import preview zero statistics were not visually muted: ${JSON.stringify(importFocus)}`);
    }
  }

  if (showDirty) {
    window.showInactive();
    await wait(120);
    const dirtyResult = await window.webContents.executeJavaScript(`(() => {
      const field = document.querySelector('.editor input[data-field="name"]');
      if (!field) return { missing: true };
      field.value = field.value + " Test";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        status: document.querySelector(".status")?.textContent || "",
        hasSave: Boolean(document.querySelector('[data-action="save"]')),
        hasReset: Boolean(document.querySelector('[data-action="reset"]')),
        view: Boolean(document.querySelector(".provider-form")),
      };
    })()`);
    if (!dirtyResult.hasSave || !dirtyResult.hasReset || !dirtyResult.status.includes("未保存")) {
      throw new Error(`Dirty actions did not appear in the provider view: ${JSON.stringify(dirtyResult)}`);
    }
    await wait(220);
  }

  if (showReorder) {
    window.showInactive();
    await window.webContents.insertCSS(`.drag-handle { opacity: 1 !important; }`);
    const reorderResult = await window.webContents.executeJavaScript(`
      (() => {
        const handle = document.querySelector('.drag-handle[data-id="codex"]');
        const target = document.querySelector('.provider-item[data-id="deepseek"]');
        if (!handle || !target) return { missing: true };
        const dataTransfer = new DataTransfer();
        handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        const rect = target.getBoundingClientRect();
        target.dispatchEvent(new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientY: rect.bottom - 2,
          dataTransfer,
        }));
        target.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientY: rect.bottom - 2,
          dataTransfer,
        }));
        const ids = [...document.querySelectorAll('.provider-item')].map((row) => row.dataset.id);
        return {
          ids: ids.join(','),
          status: document.querySelector('.status')?.textContent || '',
        };
      })()
    `);
    if (reorderResult.ids !== "deepseek,codex" || !reorderResult.status.includes("保存后同步")) {
      throw new Error(`Provider drag reorder did not update the provider array and status: ${JSON.stringify(reorderResult)}`);
    }
    await wait(380);

    // Keyboard reorder: Alt+ArrowDown on the first handle should move it past
    // the second provider. The grid is now [deepseek, codex], so moving codex
    // down restores [deepseek, codex] ordering is invalid — verify that plain
    // ArrowDown (without Alt) does NOT reorder, ensuring switch rows can be
    // navigated by keyboard without triggering drag.
    const keyboardGuard = await window.webContents.executeJavaScript(`(() => {
      const handle = document.querySelector('.drag-handle[data-id="codex"]');
      if (!handle) return { missing: true };
      handle.focus();
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const ids = [...document.querySelectorAll('.provider-item')].map((row) => row.dataset.id).join(',');
      const switchFocus = document.querySelector('[data-action="toggle-enabled"]');
      return { ids, switchReachable: Boolean(switchFocus) };
    })()`);
    if (keyboardGuard.ids !== "deepseek,codex") {
      throw new Error(`Provider list reordered on plain ArrowDown without Alt: ${keyboardGuard.ids}`);
    }
    // Restore original order with Alt+ArrowUp so the screenshot matches prior
    // captures.
    await window.webContents.executeJavaScript(`
      const handle = document.querySelector('.drag-handle[data-id="codex"]');
      handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    `);
    await wait(260);
    const restoredOrder = await window.webContents.executeJavaScript(
      `[...document.querySelectorAll('.provider-item')].map((row) => row.dataset.id).join(',')`,
    );
    if (restoredOrder !== "codex,deepseek") {
      throw new Error(`Alt+ArrowUp did not restore provider order: ${restoredOrder}`);
    }
  }

  const image = await window.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());

  const controlAssertions = await window.webContents.executeJavaScript(`(() => {
    // Only the provider editor renders a custom select and switches; skip the
    // assertion on update/health/backup pages where those controls don't exist.
    if (!document.querySelector('.editor .form-grid')) {
      return { editorPresent: false, hasSelectTrigger: true, hasSelectAriaControls: true, switchFocusRuleExists: true };
    }
    const trigger = document.querySelector('.custom-select-trigger');
    const switchInput = document.querySelector('[data-action="toggle-enabled"]') || document.querySelector('.switch input');

    // The switch input is visually hidden, so a runtime :focus-visible check is
    // unreliable in a hidden capture window. Instead verify the stylesheet
    // actually declares a focus ring for the switch's visual span.
    let switchFocusRuleExists = true;
    if (switchInput) {
      switchFocusRuleExists = false;
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules || [];
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (typeof rule.selectorText === 'string' && rule.selectorText.includes('.switch input:focus-visible')) {
            switchFocusRuleExists = true;
            break;
          }
        }
        if (switchFocusRuleExists) break;
      }
    }
    return {
      editorPresent: true,
      hasSelectTrigger: Boolean(trigger),
      hasSelectAriaControls: trigger ? Boolean(trigger.getAttribute('aria-controls')) : false,
      switchFocusRuleExists,
    };
  })()`);
  if (controlAssertions.editorPresent) {
    if (!controlAssertions.hasSelectTrigger) throw new Error("Custom select trigger was not rendered");
    if (!controlAssertions.hasSelectAriaControls) throw new Error("Custom select trigger must expose aria-controls");
    if (!controlAssertions.switchFocusRuleExists) throw new Error("Switch must declare a visible focus ring");
  }

  if (darkMode) {
    const rootTheme = await window.webContents.executeJavaScript(`document.documentElement.dataset.theme || ''`);
    if (rootTheme !== "dark") {
      throw new Error(`Settings dark theme was not applied to root element: ${JSON.stringify(rootTheme)}`);
    }
  }

  app.exit(0);
}

app.on("window-all-closed", () => {});

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
