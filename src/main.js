const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  dialog,
  nativeImage,
  screen,
  safeStorage,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
const {
  readConfigFile,
  writeConfigFile,
  providerTemplates,
  configureSecretStorage,
  migrateConfigSecrets,
  normalizeStoredConfig,
  configForRenderer,
  mergeRendererConfig,
} = require("./config-store");
const { importAccountsIntoConfig, previewAccountsImport } = require("./account-importer");
const { POPUP_WIDTH, computePopupHeight } = require("./layout");
const { loadConfig, refreshProviders } = require("./providers");
const { buildUpdateResult, fetchLatestRelease, downloadAsset } = require("./updater");
const {
  DEFAULT_TTL_MS,
  providerFingerprint,
  readProviderCache,
  writeProviderCache,
} = require("./provider-cache");

const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_TEXT_LENGTH = 20 * 1024 * 1024;
const MAX_IMPORTED_ACCOUNTS = 5000;

let tray = null;
let popupWindow = null;
let settingsWindow = null;
let refreshTimer = null;
let hideTimer = null;
let revealTimer = null;
let configPath = null;
let providerCachePath = null;
let refreshGeneration = 0;
let refreshInFlight = null;
let pendingRefreshReason = null;
let isPopupHovered = false;
let measuredPopupHeight = 0;
let measuredPopupKey = "";
let currentState = {
  loading: false,
  configPath: null,
  updatedAt: null,
  refreshIntervalSeconds: 300,
  panelDensity: "comfortable",
  errorCount: 0,
  providers: [],
};
let lastSuccessfulProviders = new Map();

function createTrayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, "assets", "tray-icon.png"));
}

function ensureConfigFile() {
  const userData = app.getPath("userData");
  configPath = path.join(userData, "config.json");
  providerCachePath = path.join(userData, "quota-cache.json");
  if (!fs.existsSync(configPath)) {
    const examplePath = path.join(__dirname, "..", "config.example.json");
    fs.mkdirSync(userData, { recursive: true });
    fs.copyFileSync(examplePath, configPath);
  }
  migrateConfigSecrets(configPath);
  lastSuccessfulProviders = readProviderCache(providerCachePath);
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
    // Hide the default File/Edit/View/Window menu bar for a normal app feel.
    // setMenu(null) below prevents Alt from bringing the menu back.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.setMenu(null);
  settingsWindow.setMenuBarVisibility(false);
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
  resizePopupForState();
  if (popupWindow && !popupWindow.webContents.isDestroyed()) {
    if (popupWindow.isVisible()) positionPopup();
    popupWindow.webContents.send("quota:snapshot", snapshotPayload());
  }
  if (settingsWindow && !settingsWindow.webContents.isDestroyed()) {
    settingsWindow.webContents.send("quota:snapshot", snapshotPayload());
  }
}

function snapshotPayload() {
  return {
    ...currentState,
    layoutKey: providerLayoutKey(currentState.providers),
  };
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
  const density = currentState.panelDensity || "comfortable";
  return `${density}|${providers
    .map((provider) => {
      const tierCount = Array.isArray(provider.tiers) ? provider.tiers.length : 0;
      const usageCount = Array.isArray(provider.tiers) ? provider.tiers.filter((tier) => tier.usage).length : 0;
      const staleCount = provider.lastSuccess ? 1 : 0;
      const shape = provider.balance ? `balance:${provider.usage ? 1 : 0}` : `tiers:${tierCount}`;
      return `${provider.id || provider.name}:${provider.kind || ""}:${shape}:usage:${usageCount}:stale:${staleCount}:${provider.message ? 1 : 0}`;
    })
    .join("|")}`;
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
  tray.setToolTip("Coding Plan Bar\n悬停查看额度，右键打开菜单");
}

async function refreshAll(reason = "timer") {
  if (refreshInFlight) {
    pendingRefreshReason = reason;
    return refreshInFlight;
  }

  const task = refreshAllNow(reason);
  refreshInFlight = task;
  try {
    return await task;
  } finally {
    if (refreshInFlight !== task) return;
    refreshInFlight = null;
    const nextReason = pendingRefreshReason;
    pendingRefreshReason = null;
    if (nextReason) void refreshAll(nextReason);
  }
}

async function refreshAllNow(reason = "timer") {
  if (!configPath) return;

  const generation = ++refreshGeneration;
  const startedAt = Date.now();
  currentState = {
    ...currentState,
    loading: true,
    reason,
  };
  sendSnapshot();

  try {
    const config = loadConfig(configPath);
    const enabled = config.providers.filter((provider) => provider.enabled !== false);
    const refreshedProviders = await refreshProviders(config, {
        onProvider(snapshot, index) {
          if (generation !== refreshGeneration) return;
          const provider = applyLastSuccessProvider(snapshot, enabled[index]);
          currentState = {
            ...currentState,
            providers: mergeProviderSnapshot(currentState.providers, provider, enabled),
          };
          sendSnapshot();
        },
      });
    if (generation !== refreshGeneration) return snapshotPayload();
    const providers = applyLastSuccessCache(refreshedProviders, config);
    const errorCount = providers.filter((provider) =>
      ["error", "expired", "missing"].includes(provider.status),
    ).length;

    currentState = {
      loading: false,
      configPath,
      updatedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      refreshIntervalSeconds: config.refreshIntervalSeconds,
      panelDensity: config.panelDensity,
      errorCount,
      providers,
    };
    persistLastSuccessCache(enabled);
  } catch (error) {
    if (generation !== refreshGeneration) return snapshotPayload();
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
  return snapshotPayload();
}

function applyLastSuccessCache(providers, config) {
  const byId = new Map((config?.providers || []).map((provider) => [provider.id, provider]));
  return (providers || []).map((provider) => applyLastSuccessProvider(provider, byId.get(provider.id)));
}

function applyLastSuccessProvider(provider, configuredProvider) {
  if (!configuredProvider) return provider;
  const key = cacheProviderFingerprint(configuredProvider);
  if (isSuccessfulProvider(provider)) {
    lastSuccessfulProviders.set(key, { savedAt: Date.now(), provider: cloneProvider(provider) });
    return provider;
  }

  const cached = lastSuccessfulProviders.get(key);
  if (cached && Date.now() - Number(cached.savedAt || 0) > DEFAULT_TTL_MS) {
    lastSuccessfulProviders.delete(key);
    return provider;
  }
  const previous = cached?.provider;
  if (!previous || !hasDisplayData(previous)) return provider;
  return {
    ...provider,
    tiers: previous.tiers || provider.tiers,
    balance: previous.balance || provider.balance,
    balances: previous.balances || provider.balances,
    usage: previous.usage || provider.usage,
    extraUsage: previous.extraUsage || provider.extraUsage,
    lastSuccess: {
      queriedAt: previous.queriedAt || cached.savedAt,
      statusText: previous.statusText,
    },
  };
}

function mergeProviderSnapshot(existing, provider, enabled) {
  const snapshots = new Map((existing || []).map((item) => [item.id, item]));
  snapshots.set(provider.id, provider);
  return enabled.map((item) => snapshots.get(item.id)).filter(Boolean);
}

function persistLastSuccessCache(enabled) {
  if (!providerCachePath) return;
  const activeKeys = new Set((enabled || []).map(cacheProviderFingerprint));
  try {
    writeProviderCache(providerCachePath, lastSuccessfulProviders, activeKeys);
  } catch (error) {
    console.warn(`Unable to persist quota cache: ${error.message || error}`);
  }
}

function cacheProviderFingerprint(provider) {
  return providerFingerprint(provider, resolveProviderSecret(provider));
}

function resolveProviderSecret(provider = {}) {
  if (provider.apiKey) return provider.apiKey;
  const names = Array.isArray(provider.apiKeyEnv)
    ? provider.apiKeyEnv
    : provider.apiKeyEnv
      ? [provider.apiKeyEnv]
      : [];
  return names.map((name) => process.env[name]).find(Boolean) || "";
}

function isSuccessfulProvider(provider) {
  return ["ok", "warn", "danger", "manual"].includes(provider?.status);
}

function hasDisplayData(provider) {
  return Boolean(provider?.balance || provider?.tiers?.length);
}

function cloneProvider(provider) {
  return JSON.parse(JSON.stringify(provider));
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

async function chooseImportAccountsFile() {
  const result = await dialog.showOpenDialog(settingsWindow || undefined, {
    title: "导入账号 JSON",
    properties: ["openFile"],
    filters: [
      { name: "JSON 文件", extensions: ["json"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return previewImportFile(result.filePaths[0]);
}

function previewImportFile(filePath) {
  const parsed = readImportJson(filePath);
  const current = readConfigFile(configPath);
  return {
    ...previewAccountsImport(current, parsed, filePath),
    filePath,
    sourceType: "file",
    configPath,
  };
}

async function previewLatestImportFile() {
  const filePath = latestDownloadsImportFile();
  if (!filePath) {
    return {
      canceled: true,
      message: "Downloads 中没有找到 sub2api*.json 或 sub2api-account*.json",
    };
  }
  return {
    ...previewImportFile(filePath),
    pickedLatest: true,
  };
}

function latestDownloadsImportFile() {
  const downloads = app.getPath("downloads");
  if (!downloads || !fs.existsSync(downloads)) return null;
  const candidates = fs
    .readdirSync(downloads, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^sub2api(?:-account)?[\w.-]*\.json$/i.test(entry.name))
    .map((entry) => {
      const filePath = path.join(downloads, entry.name);
      const stat = fs.statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath || null;
}

async function importAccountsFromFile(_event, filePath) {
  if (!filePath) throw new Error("缺少导入文件路径");
  const parsed = readImportJson(filePath);
  const current = readConfigFile(configPath);
  const imported = importAccountsIntoConfig(current, parsed, filePath);
  if (imported.importedCount > 0 || imported.updatedCount > 0) {
    const saved = writeConfigFile(configPath, imported.config);
    syncPopupProvidersToConfig(saved);
    await refreshAll("import");
    scheduleRefresh();
    return {
      ...imported,
      config: configForRenderer(saved),
      selectedId: imported.selectedId,
      configPath,
      filePath,
    };
  }

  return {
    ...imported,
    config: current,
    configPath,
    filePath,
  };
}

function readImportJson(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("导入路径不是文件");
  if (stat.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`导入文件过大，不能超过 ${Math.round(MAX_IMPORT_FILE_BYTES / 1024 / 1024)} MB`);
  }
  const text = fs.readFileSync(filePath, "utf8");
  try {
    const parsed = JSON.parse(text);
    validateImportPayload(parsed);
    return parsed;
  } catch (error) {
    if (error.message.includes("导入数据过大")) throw error;
    throw new Error(`JSON 解析失败：${error.message}`);
  }
}

function parseImportRaw(raw) {
  if (typeof raw === "string" && raw.length > MAX_IMPORT_TEXT_LENGTH) {
    throw new Error(`粘贴内容过大，不能超过 ${Math.round(MAX_IMPORT_TEXT_LENGTH / 1024 / 1024)} MB`);
  }
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }
  validateImportPayload(parsed);
  return parsed;
}

function validateImportPayload(parsed) {
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? [parsed.accounts, parsed.sessions, parsed.items, parsed.data].find(Array.isArray)
      : null;
  if (candidates && candidates.length > MAX_IMPORTED_ACCOUNTS) {
    throw new Error(`导入数据过大，账号数量不能超过 ${MAX_IMPORTED_ACCOUNTS}`);
  }
}

async function previewImportedAccounts(_event, raw) {
  const parsed = parseImportRaw(raw);
  const current = readConfigFile(configPath);
  return {
    ...previewAccountsImport(current, parsed, "pasted-json"),
    sourceType: "paste",
  };
}

async function importAccountsFromRaw(_event, raw) {
  const parsed = parseImportRaw(raw);
  const current = readConfigFile(configPath);
  const imported = importAccountsIntoConfig(current, parsed, "pasted-json");
  if (imported.importedCount > 0 || imported.updatedCount > 0) {
    const saved = writeConfigFile(configPath, imported.config);
    syncPopupProvidersToConfig(saved);
    await refreshAll("import");
    scheduleRefresh();
    return {
      ...imported,
      config: configForRenderer(saved),
      selectedId: imported.selectedId,
      configPath,
      sourceType: "paste",
    };
  }
  return {
    ...imported,
    config: current,
    configPath,
    sourceType: "paste",
  };
}

// ===== Updater =====
// In-flight update state shared between IPC handlers. Only one check or
// download may run at a time to keep the UI state machine coherent.
let updaterState = {
  status: "idle", // idle | checking | available | latest | downloading | ready | error
  result: null, // structured buildUpdateResult payload
  downloadedPath: null,
  progress: null, // { percent, downloadedBytes, totalBytes }
  error: null,
  checkedAt: null,
  lastPublishedAt: null,
};
let updateCheckInFlight = false;
let downloadInFlight = false;
let pendingRestore = null;

function sendUpdaterState() {
  const target = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null;
  if (!target || target.webContents.isDestroyed()) return;
  target.webContents.send("updater:state", { ...updaterState });
}

function setUpdaterStatus(status, patch = {}) {
  updaterState = { ...updaterState, status, ...patch };
  sendUpdaterState();
}

async function checkForUpdates({ silent = false } = {}) {
  if (updateCheckInFlight) return updaterState;
  updateCheckInFlight = true;
  if (!silent) setUpdaterStatus("checking", { error: null });
  try {
    const release = await fetchLatestRelease();
    const result = buildUpdateResult(app.getVersion(), release);
    let status = result.error ? "error" : result.hasUpdate ? "available" : "latest";
    if (
      status === "available" &&
      updaterState.downloadedPath &&
      updaterState.result &&
      updaterState.result.latestVersion === result.latestVersion
    ) {
      status = "ready";
    }
    updaterState = {
      ...updaterState,
      status,
      result,
      error: result.error,
      checkedAt: Date.now(),
      lastPublishedAt: result.publishedAt,
      // A previous downloaded installer is only valid for the release we just
      // found; clear it if the version changed.
      downloadedPath:
        result.latestVersion && updaterState.result && result.latestVersion !== updaterState.result.latestVersion
          ? null
          : updaterState.downloadedPath,
    };
    sendUpdaterState();
    return updaterState;
  } catch (error) {
    updaterState = {
      ...updaterState,
      status: silent ? updaterState.status : "error",
      error: error.message || String(error),
      checkedAt: Date.now(),
    };
    sendUpdaterState();
    return updaterState;
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadUpdate() {
  if (downloadInFlight) return;
  const asset = updaterState.result && updaterState.result.asset;
  if (!asset || !asset.url) {
    setUpdaterStatus("error", { error: "没有可下载的安装包" });
    return;
  }
  downloadInFlight = true;
  setUpdaterStatus("downloading", { error: null, progress: { percent: 0, downloadedBytes: 0, totalBytes: asset.size || 0 } });
  try {
    const downloadedPath = await downloadAsset(asset.url, (progress) => {
      updaterState = { ...updaterState, progress };
      sendUpdaterState();
    }, asset);
    setUpdaterStatus("ready", { downloadedPath, progress: { percent: 100, downloadedBytes: asset.size || 0, totalBytes: asset.size || 0 } });
  } catch (error) {
    setUpdaterStatus("error", { error: error.message || String(error) });
  } finally {
    downloadInFlight = false;
  }
}

async function installUpdate() {
  const installerPath = updaterState.downloadedPath;
  if (!installerPath) {
    setUpdaterStatus("error", { error: "安装包尚未下载完成" });
    return;
  }
  try {
    // Open the NSIS installer. It runs as a separate process; the current app
    // should quit so the installer can replace files.
    const error = await shell.openPath(installerPath);
    if (error) {
      setUpdaterStatus("error", { error: `无法启动安装程序：${error}` });
      return;
    }
    app.quit();
  } catch (error) {
    setUpdaterStatus("error", { error: error.message || String(error) });
  }
}

async function backupConfigFile() {
  const current = fs.readFileSync(configPath, "utf8");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const result = await dialog.showSaveDialog(settingsWindow || undefined, {
    title: "备份加密配置文件",
    defaultPath: path.join(app.getPath("documents"), `coding-plan-bar-config-${stamp}.json`),
    filters: [{ name: "JSON 文件", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, current, "utf8");
  return { filePath: result.filePath, message: "配置已加密备份；凭据仅能由当前 Windows 用户解密" };
}

async function chooseRestoreConfigFile() {
  const result = await dialog.showOpenDialog(settingsWindow || undefined, {
    title: "选择配置备份文件",
    properties: ["openFile"],
    filters: [{ name: "JSON 文件", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const filePath = result.filePaths[0];
  const parsed = readImportJson(filePath);
  const normalized = readConfigObject(parsed);
  pendingRestore = { token: `restore-${Date.now()}`, config: normalized, filePath };
  return {
    restoreToken: pendingRestore.token,
    providerCount: normalized.providers.length,
    importHistoryCount: normalized.importHistory.length,
    fileName: path.basename(filePath),
  };
}

async function confirmRestoreConfig(_event, token) {
  if (!pendingRestore || pendingRestore.token !== token) throw new Error("恢复会话已失效，请重新选择备份文件");
  const saved = writeConfigFile(configPath, pendingRestore.config);
  pendingRestore = null;
  syncPopupProvidersToConfig(saved);
  await refreshAll("restore");
  scheduleRefresh();
  return { config: configForRenderer(saved), configPath, message: "配置已恢复并刷新额度" };
}

function readConfigObject(parsed) {
  return normalizeStoredConfig(parsed);
}

async function openReleaseUrl(_event, url) {
  try {
    const parsed = new URL(String(url || ""));
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.toLowerCase() !== "github.com" ||
      parsed.pathname !== "/bubble0462/coding-plan-bar/releases/latest" &&
      !parsed.pathname.startsWith("/bubble0462/coding-plan-bar/releases/tag/")
    ) {
      throw new Error("不支持的链接地址");
    }
    return shell.openExternal(parsed.toString());
  } catch (error) {
    setUpdaterStatus("error", { error: error.message || String(error) });
    return null;
  }
}

async function maybeAutoCheckOnStartup() {
  try {
    const config = loadConfig(configPath);
    if (config.autoUpdate && config.autoUpdate.enabled !== false) {
      // Silent: only populates state for the settings page. Never downloads.
      await checkForUpdates({ silent: true });
    }
  } catch {
    /* Auto-check is best-effort; swallow errors on startup. */
  }
}

function getConfigForSettings() {
  return {
    config: configForRenderer(readConfigFile(configPath)),
    configPath,
    templates: providerTemplates(),
    snapshot: snapshotPayload(),
  };
}

async function saveConfigFromSettings(_event, config) {
  const current = readConfigFile(configPath);
  const saved = writeConfigFile(configPath, mergeRendererConfig(config, current));
  syncPopupProvidersToConfig(saved);
  await refreshAll("config");
  scheduleRefresh();
  return { config: configForRenderer(saved), configPath };
}

// Drop deleted/disabled providers from the popup immediately so its height
// shrinks without waiting for the network refresh to finish.
function syncPopupProvidersToConfig(config) {
  if (!popupWindow) return;
  const enabled = config.providers.filter((provider) => provider.enabled !== false);
  const snapshots = new Map(currentState.providers.map((provider) => [provider.id, provider]));
  const next = enabled.map((provider) => snapshots.get(provider.id)).filter(Boolean);
  const currentIds = currentState.providers.map((provider) => provider.id).join("|");
  const nextIds = next.map((provider) => provider.id).join("|");
  if (nextIds === currentIds) return;
  invalidateMeasuredPopupHeight();
  currentState = { ...currentState, providers: next };
  sendSnapshot();
}

function reorderPopupProviders(_event, providerIds) {
  const requested = Array.isArray(providerIds) ? providerIds.map(String) : [];
  const config = readConfigFile(configPath);
  const enabled = config.providers.filter((provider) => provider.enabled !== false);
  const enabledIds = enabled.map((provider) => provider.id);
  if (
    requested.length !== enabledIds.length ||
    new Set(requested).size !== requested.length ||
    requested.some((id) => !enabledIds.includes(id))
  ) {
    throw new Error("供应商顺序数据无效，请刷新后重试");
  }

  const ordered = requested.map((id) => enabled.find((provider) => provider.id === id));
  let enabledIndex = 0;
  config.providers = config.providers.map((provider) =>
    provider.enabled === false ? provider : ordered[enabledIndex++],
  );
  const saved = writeConfigFile(configPath, config);
  const snapshots = new Map(currentState.providers.map((provider) => [provider.id, provider]));
  currentState = {
    ...currentState,
    providers: requested.map((id) => snapshots.get(id)).filter(Boolean),
  };
  invalidateMeasuredPopupHeight();
  sendSnapshot();
  if (settingsWindow && !settingsWindow.webContents.isDestroyed()) {
    settingsWindow.webContents.send("config:changed", {
      config: configForRenderer(saved),
      configPath,
    });
  }
  return { providerIds: requested };
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
  configureSecretStorage(safeStorage);
  ensureConfigFile();
  Menu.setApplicationMenu(null);

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
  ipcMain.handle("config:backup", backupConfigFile);
  ipcMain.handle("config:restore", chooseRestoreConfigFile);
  ipcMain.handle("config:confirm-restore", confirmRestoreConfig);
  ipcMain.handle("config:choose-import-accounts", chooseImportAccountsFile);
  ipcMain.handle("config:latest-import-accounts", previewLatestImportFile);
  ipcMain.handle("config:import-accounts", importAccountsFromFile);
  ipcMain.handle("config:import-accounts-raw", importAccountsFromRaw);
  ipcMain.handle("config:preview-import", previewImportedAccounts);
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
  ipcMain.handle("quota:reorder-providers", reorderPopupProviders);
  ipcMain.handle("quota:quit", () => app.quit());

  ipcMain.handle("updater:check", () => checkForUpdates({ silent: false }));
  ipcMain.handle("updater:download", () => downloadUpdate());
  ipcMain.handle("updater:install", () => installUpdate());
  ipcMain.handle("updater:open-release", openReleaseUrl);
  ipcMain.handle("updater:get-state", () => ({ ...updaterState }));

  await refreshAll("startup");
  scheduleRefresh();
  maybeAutoCheckOnStartup();
}

if (process.platform === "win32") {
  app.setAppUserModelId("com.bubble.coding-plan-bar");
}

const singleInstanceLock = process.argv.includes("--smoke-startup") || app.requestSingleInstanceLock();
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
