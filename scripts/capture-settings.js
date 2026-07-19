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
const showDirty = process.argv.includes("--dirty");
const showHealth = process.argv.includes("--health");
const showBackup = process.argv.includes("--backup");
const showUsage = process.argv.includes("--usage");
const outputPath = path.join(
  __dirname,
  "..",
  "tmp",
  showTemplates
    ? "settings-screenshot-templates.png"
    : showUpdate
      ? "settings-screenshot-update.png"
      : showReorder
        ? "settings-screenshot-reorder.png"
        : showImport
          ? "settings-screenshot-import.png"
          : showImportSource
            ? "settings-screenshot-import-source.png"
            : showImportDrop
              ? "settings-screenshot-import-drop.png"
              : showImportPaste
                ? "settings-screenshot-import-paste.png"
              : showDirty
                ? "settings-screenshot-dirty.png"
                : showHealth
                  ? "settings-screenshot-health.png"
                  : showBackup
                    ? "settings-screenshot-backup.png"
                    : showUsage
                      ? "settings-screenshot-usage.png"
                      : "settings-screenshot.png",
);
const captureUserDataPath = path.join(__dirname, "..", "tmp", `electron-settings-${process.pid}`);
app.setPath("userData", captureUserDataPath);

const sampleConfig = {
  refreshIntervalSeconds: 300,
  showOnHover: true,
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
const sampleImportPath = path.join(__dirname, "..", "tmp", "demo.cpa.2026-07-18.json");

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

const mockAgentUsage = {
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  ipcMain.handle("config:get", () => ({
    config: sampleConfig,
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
    templates: providerTemplates(),
  }));
  ipcMain.handle("config:save", (_event, config) => ({
    config,
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
  }));
  ipcMain.handle("config:open-json", () => {});
  ipcMain.handle("config:choose-import-accounts", () => ({
    ...previewAccountsImport(sampleConfig, sampleImportJson, sampleImportPath),
    filePath: sampleImportPath,
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
  }));
  ipcMain.handle("config:preview-import-file", () => ({
    ...previewAccountsImport(sampleConfig, sampleImportJson, sampleImportPath),
    filePath: sampleImportPath,
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
  }));
  ipcMain.handle("config:import-accounts", () => ({
    ...importAccountsIntoConfig(sampleConfig, sampleImportJson, sampleImportPath),
    configPath: "C:\\Users\\bubble\\AppData\\Roaming\\coding-plan-bar\\config.json",
    filePath: sampleImportPath,
  }));
  ipcMain.handle("config:preview-import", (_event, raw) => previewAccountsImport(sampleConfig, JSON.parse(raw), "pasted-json"));
  ipcMain.handle("quota:refresh", () => {});
  ipcMain.handle("usage:get-codex-agent", () => mockAgentUsage);
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
    show: showTemplates || showUpdate || showReorder || showImport || showHealth || showBackup || showUsage,
    x: showTemplates || showUpdate || showReorder || showImport || showHealth || showBackup || showUsage ? -2200 : undefined,
    y: showTemplates || showUpdate || showReorder || showImport || showHealth || showBackup || showUsage ? 80 : undefined,
    frame: true,
    backgroundColor: "#f6f8fb",
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
      .template-card {
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

      .template-card {
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
    const usageRendered = await window.webContents.executeJavaScript(`(() => {
      const page = document.querySelector(".usage-page");
      if (!page) return false;
      const text = page.textContent || "";
      return text.includes("今天") && text.includes("最近 7 天") && text.includes("最近 30 天") &&
        text.includes("gpt-5.6-sol") && text.includes("1.25B") && text.includes("≥ $876");
    })()`);
    if (!usageRendered) {
      const usageText = await window.webContents.executeJavaScript(`document.querySelector(".usage-page")?.textContent || "NO_PAGE"`);
      throw new Error(`Agent usage page did not render expected metrics: ${usageText.slice(0, 800)}`);
    }
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
      if (text.includes("全部正常")) {
        return text.includes("已检查") && text.includes("上次刷新");
      }
      return text.includes("需要处理");
    })()`);
    if (!healthSummary) throw new Error("Health page did not show actionable or freshness summary");
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

  if (showImport || showImportSource || showImportDrop || showImportPaste) {
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

  if (showImport) {
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

  if (showImport || showImportPaste) {
    await wait(450);
    const rendered = await window.webContents.executeJavaScript(
      `(() => {
        const popover = document.querySelector(".import-popover");
        if (!popover) return false;
        const text = popover.textContent || "";
        return text.includes("导入账号预览") && text.includes("检测账号") && text.includes("新增") && text.includes("CPA accountId");
      })()`,
    );
    if (!rendered) throw new Error("Import preview did not render expected summary");
    const importFocus = await window.webContents.executeJavaScript(`(() => {
      const popover = document.querySelector(".import-popover");
      if (!popover) return { hasFocus: false };
      const target = popover.querySelector("[data-action='confirm-import-preview']:not([disabled])") || popover.querySelector(".icon-close");
      target?.focus();
      const cpaLabels = [...popover.querySelectorAll('.import-row small')]
        .filter((node) => node.textContent.includes('CPA accountId'));
      const zeroStats = [...popover.querySelectorAll('.import-summary > div')]
        .filter((node) => node.querySelector('strong')?.textContent.trim() === '0');
      return {
        hasFocus: popover.contains(document.activeElement),
        cpaLabelCount: cpaLabels.length,
        zeroStatsMuted: zeroStats.length > 0 && zeroStats.every((node) => node.classList.contains('is-zero')),
      };
    })()`);
    if (!importFocus.hasFocus) throw new Error("Import preview did not receive keyboard focus");
    if (importFocus.cpaLabelCount !== 1) {
      throw new Error(`Import preview did not show one CPA identity label: ${JSON.stringify(importFocus)}`);
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

  app.exit(0);
}

app.on("window-all-closed", () => {});

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
