const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { readConfigFile, writeConfigFile, providerTemplates } = require("./config-store");
const { POPUP_WIDTH, computePopupHeight } = require("./layout");
const { loadConfig, refreshProviders } = require("./providers");

let tray = null;
let popupWindow = null;
let settingsWindow = null;
let refreshTimer = null;
let hideTimer = null;
let revealTimer = null;
let configPath = null;
let isPopupHovered = false;
let measuredPopupHeight = 0;
let measuredPopupKey = "";
let currentState = {
  loading: false,
  configPath: null,
  updatedAt: null,
  refreshIntervalSeconds: 300,
  errorCount: 0,
  providers: [],
};

function createTrayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, "assets", "tray-icon.png"));
}

function ensureConfigFile() {
  const userData = app.getPath("userData");
  configPath = path.join(userData, "config.json");
  if (!fs.existsSync(configPath)) {
    const examplePath = path.join(__dirname, "..", "config.example.json");
    fs.mkdirSync(userData, { recursive: true });
    fs.copyFileSync(examplePath, configPath);
  }
  currentState.configPath = configPath;
}

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: computePopupHeight(currentState.providers),
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popupWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  popupWindow.on("blur", () => scheduleHide(400));
  popupWindow.webContents.on("did-finish-load", () => {
    resizePopupForState();
    sendSnapshot();
  });
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 940,
    height: 660,
    minWidth: 860,
    minHeight: 580,
    show: false,
    title: "设置 - Coding Plan Bar",
    backgroundColor: "#f6f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, "settings", "index.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function positionPopup() {
  if (!tray || !popupWindow) return;

  const trayBounds = tray.getBounds();
  const windowBounds = popupWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });
  const workArea = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width + 42);
  let y = Math.round(trayBounds.y - windowBounds.height - 10);

  if (y < workArea.y) {
    y = Math.round(trayBounds.y + trayBounds.height + 10);
  }
  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - windowBounds.width - 8));
  y = Math.max(workArea.y + 8, Math.min(y, workArea.y + workArea.height - windowBounds.height - 8));

  popupWindow.setPosition(x, y, false);
}

function showPopup() {
  if (!popupWindow) createPopupWindow();
  cancelHide();
  resizePopupForState();
  positionPopup();

  const wasVisible = popupWindow.isVisible();
  if (!wasVisible) {
    popupWindow.setOpacity(0);
  }

  popupWindow.show();
  popupWindow.moveTop();
  sendSnapshot();

  if (!wasVisible) {
    scheduleReveal();
  }
}

function hidePopup() {
  if (popupWindow && popupWindow.isVisible()) {
    isPopupHovered = false;
    cancelHide();
    cancelReveal();
    popupWindow.setOpacity(1);
    popupWindow.hide();
  }
}

function scheduleHide(delay = 500) {
  cancelHide();
  hideTimer = setTimeout(() => {
    if (isPopupHovered || isCursorInsidePopup()) {
      cancelHide();
      return;
    }
    hidePopup();
  }, delay);
}

function cancelHide() {
  clearTimeout(hideTimer);
  hideTimer = null;
}

function scheduleReveal() {
  cancelReveal();
  revealTimer = setTimeout(() => {
    if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return;
    resizePopupForState();
    positionPopup();
    popupWindow.setOpacity(1);
    revealTimer = null;
  }, 80);
}

function cancelReveal() {
  clearTimeout(revealTimer);
  revealTimer = null;
}

function keepPopupOpen() {
  isPopupHovered = true;
  cancelHide();
}

function leavePopup() {
  isPopupHovered = false;
  scheduleHide(180);
}

function isCursorInsidePopup(margin = 8) {
  if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return false;
  const point = screen.getCursorScreenPoint();
  const bounds = popupWindow.getBounds();
  return (
    point.x >= bounds.x - margin &&
    point.x <= bounds.x + bounds.width + margin &&
    point.y >= bounds.y - margin &&
    point.y <= bounds.y + bounds.height + margin
  );
}

function sendSnapshot() {
  if (!popupWindow || popupWindow.webContents.isDestroyed()) return;
  resizePopupForState();
  if (popupWindow.isVisible()) positionPopup();
  popupWindow.webContents.send("quota:snapshot", {
    ...currentState,
    layoutKey: providerLayoutKey(currentState.providers),
  });
}

function resizePopupForState() {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  const layoutKey = providerLayoutKey(currentState.providers);
  // Prefer the renderer's measured height when the provider count is unchanged,
  // so re-showing the popup doesn't re-apply the (taller) estimate and leave a gap.
  const targetHeight =
    measuredPopupHeight > 0 && measuredPopupKey === layoutKey
      ? measuredPopupHeight
      : computePopupHeight(currentState.providers);
  resizePopupToHeight(targetHeight);
}

function invalidateMeasuredPopupHeight() {
  measuredPopupHeight = 0;
  measuredPopupKey = "";
}

function providerLayoutKey(providers = []) {
  return providers
    .map((provider) => {
      const tierCount = Array.isArray(provider.tiers) ? provider.tiers.length : 0;
      const shape = provider.balance ? "balance" : `tiers:${tierCount}`;
      return `${provider.id || provider.name}:${provider.kind || ""}:${shape}:${provider.message ? 1 : 0}`;
    })
    .join("|");
}

function resizePopupToHeight(requestedHeight) {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  const numericHeight = Math.round(Number(requestedHeight));
  if (!Number.isFinite(numericHeight)) return;

  const bounds = popupWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: bounds.x || 0,
    y: bounds.y || 0,
  });
  const maxHeight = Math.max(300, display.workArea.height - 16);
  const targetHeight = Math.max(180, Math.min(numericHeight, maxHeight));
  const [width, height] = popupWindow.getSize();
  if (width !== POPUP_WIDTH || height !== targetHeight) {
    const wasResizable = popupWindow.isResizable();
    if (!wasResizable) popupWindow.setResizable(true);
    popupWindow.setSize(POPUP_WIDTH, targetHeight, false);
    if (!wasResizable) popupWindow.setResizable(false);
    if (popupWindow.isVisible()) positionPopup();
  }
}

function updateTrayTooltip() {
  if (!tray) return;
  const enabled = currentState.providers.length;
  const errors = currentState.errorCount;
  tray.setToolTip(`Coding Plan Bar\n${enabled} 个供应商，${errors} 个提醒`);
}

async function refreshAll(reason = "timer") {
  if (!configPath) return;

  const startedAt = Date.now();
  currentState = {
    ...currentState,
    loading: true,
    reason,
  };
  sendSnapshot();

  try {
    const config = loadConfig(configPath);
    const providers = await refreshProviders(config);
    const errorCount = providers.filter((provider) =>
      ["error", "expired", "missing"].includes(provider.status),
    ).length;

    currentState = {
      loading: false,
      configPath,
      updatedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      refreshIntervalSeconds: config.refreshIntervalSeconds,
      errorCount,
      providers,
    };
  } catch (error) {
    currentState = {
      ...currentState,
      loading: false,
      updatedAt: Date.now(),
      errorCount: currentState.errorCount + 1,
      fatalError: error.message || String(error),
    };
  }

  updateTrayTooltip();
  sendSnapshot();
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  const seconds = Math.max(30, Number(currentState.refreshIntervalSeconds || 300));
  refreshTimer = setInterval(() => refreshAll("timer"), seconds * 1000);
}

function openConfig() {
  if (!settingsWindow) createSettingsWindow();
  settingsWindow.show();
  settingsWindow.focus();
}

function openConfigJson() {
  if (configPath) shell.openPath(configPath);
}

function getConfigForSettings() {
  return {
    config: readConfigFile(configPath),
    configPath,
    templates: providerTemplates(),
  };
}

async function saveConfigFromSettings(_event, config) {
  const saved = writeConfigFile(configPath, config);
  syncPopupProvidersToConfig(saved);
  await refreshAll("config");
  scheduleRefresh();
  return { config: saved, configPath };
}

// Drop deleted/disabled providers from the popup immediately so its height
// shrinks without waiting for the network refresh to finish.
function syncPopupProvidersToConfig(config) {
  if (!popupWindow) return;
  const enabledIds = new Set(
    config.providers
      .filter((provider) => provider.enabled !== false)
      .map((provider) => provider.id),
  );
  const next = currentState.providers.filter((provider) => enabledIds.has(provider.id));
  if (next.length === currentState.providers.length) return;
  invalidateMeasuredPopupHeight();
  currentState = { ...currentState, providers: next };
  sendSnapshot();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Coding Plan Bar");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示额度", click: showPopup },
      { label: "立即刷新", click: () => refreshAll("manual") },
      { label: "设置", click: openConfig },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ]),
  );

  tray.on("mouse-enter", () => {
    try {
      if (loadConfig(configPath).showOnHover) showPopup();
    } catch (error) {
      currentState = {
        ...currentState,
        fatalError: error.message || String(error),
      };
      showPopup();
    }
  });
  tray.on("mouse-leave", () => scheduleHide(700));
  tray.on("click", showPopup);
  tray.on("right-click", () => tray.popUpContextMenu());
}

async function startApp() {
  ensureConfigFile();

  if (process.argv.includes("--smoke-startup")) {
    const icon = createTrayIcon();
    if (icon.isEmpty()) {
      throw new Error("Tray icon image is empty");
    }
    loadConfig(configPath);
    app.exit(0);
    return;
  }

  createTray();
  createPopupWindow();

  ipcMain.handle("quota:refresh", () => refreshAll("manual"));
  ipcMain.handle("quota:open-config", openConfig);
  ipcMain.handle("config:get", getConfigForSettings);
  ipcMain.handle("config:save", saveConfigFromSettings);
  ipcMain.handle("config:open-json", openConfigJson);
  ipcMain.handle("quota:hide", hidePopup);
  ipcMain.handle("quota:keep-open", keepPopupOpen);
  ipcMain.handle("quota:leave-popup", leavePopup);
  ipcMain.handle("quota:resize", (_event, height, layoutKey) => {
    const numeric = Math.round(Number(height));
    const currentLayoutKey = providerLayoutKey(currentState.providers);
    if (layoutKey && layoutKey !== currentLayoutKey) return;
    if (Number.isFinite(numeric) && numeric > 0) {
      measuredPopupHeight = numeric;
      measuredPopupKey = currentLayoutKey;
    }
    resizePopupToHeight(height);
  });
  ipcMain.handle("quota:quit", () => app.quit());

  await refreshAll("startup");
  scheduleRefresh();
}

if (process.platform === "win32") {
  app.setAppUserModelId("com.bubble.coding-plan-bar");
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showPopup);
  app.whenReady().then(startApp).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  clearInterval(refreshTimer);
  clearTimeout(hideTimer);
  clearTimeout(revealTimer);
});
