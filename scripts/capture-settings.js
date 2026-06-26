const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { providerTemplates } = require("../src/config-store");

const showTemplates = process.argv.includes("--templates");
const showUpdate = process.argv.includes("--update");
const outputPath = path.join(
  __dirname,
  "..",
  "tmp",
  showTemplates ? "settings-screenshot-templates.png" : showUpdate ? "settings-screenshot-update.png" : "settings-screenshot.png",
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

// Mock updater state injected into the settings page. For --update we report a
// newer release is available so the screenshot exercises the download path.
const mockUpdaterState = {
  status: "available",
  result: {
    currentVersion: "0.3.6",
    latestVersion: "0.3.7",
    hasUpdate: true,
    releaseUrl: "https://github.com/bubble0462/coding-plan-bar/releases/latest",
    publishedAt: new Date().toISOString(),
    releaseNotes: "示例更新日志",
    asset: {
      name: "Coding Plan Bar-Setup-0.3.7-x64.exe",
      url: "https://github.com/bubble0462/coding-plan-bar/releases/download/v0.3.7/Coding.Plan.Bar-Setup-0.3.7-x64.exe",
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
  ipcMain.handle("quota:refresh", () => {});
  ipcMain.handle("quota:open-config", () => {});
  ipcMain.handle("quota:hide", () => {});
  ipcMain.handle("quota:keep-open", () => {});
  ipcMain.handle("quota:leave-popup", () => {});
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
    show: showTemplates || showUpdate,
    x: showTemplates || showUpdate ? -2200 : undefined,
    y: showTemplates || showUpdate ? 80 : undefined,
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
        return text.includes("0.3.6") && text.includes("0.3.7") && text.includes("下载更新");
      })()`,
    );
    if (!rendered) throw new Error("Update page did not render with version info");
  }

  const image = await window.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  app.exit(0);
}

app.on("window-all-closed", () => {});

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
