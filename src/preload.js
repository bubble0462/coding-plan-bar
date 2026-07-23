const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("codingPlanBar", {
  onSnapshot(callback) {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("quota:snapshot", listener);
    return () => ipcRenderer.removeListener("quota:snapshot", listener);
  },
  onConfigChanged(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("config:changed", listener);
    return () => ipcRenderer.removeListener("config:changed", listener);
  },
  onAgentUsageSnapshot(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent-usage:snapshot", listener);
    return () => ipcRenderer.removeListener("agent-usage:snapshot", listener);
  },
  refresh() {
    return ipcRenderer.invoke("quota:refresh");
  },
  openConfig() {
    return ipcRenderer.invoke("quota:open-config");
  },
  hide() {
    return ipcRenderer.invoke("quota:hide");
  },
  keepOpen() {
    return ipcRenderer.invoke("quota:keep-open");
  },
  leavePopup() {
    return ipcRenderer.invoke("quota:leave-popup");
  },
  onPopupVisibility(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("quota:visibility", listener);
    return () => ipcRenderer.removeListener("quota:visibility", listener);
  },
  popupVisibilityComplete(visible) {
    return ipcRenderer.invoke("quota:visibility-complete", Boolean(visible));
  },
  resize(height, layoutKey) {
    return ipcRenderer.invoke("quota:resize", height, layoutKey);
  },
  reorderProviders(providerIds) {
    return ipcRenderer.invoke("quota:reorder-providers", providerIds);
  },
  quit() {
    return ipcRenderer.invoke("quota:quit");
  },
  getConfig() {
    return ipcRenderer.invoke("config:get");
  },
  getCodexAgentUsage() {
    return ipcRenderer.invoke("usage:get-codex-agent");
  },
  getAgentUsage(options = {}) {
    return ipcRenderer.invoke("usage:get-agent", options);
  },
  testCodexConnection(providerOrId) {
    return ipcRenderer.invoke("quota:test-codex", providerOrId);
  },
  listCodexModels() {
    return ipcRenderer.invoke("chat:list-codex-models");
  },
  probeCodexChat(args) {
    return ipcRenderer.invoke("chat:probe-codex", args);
  },
  onProbeEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("chat:probe-event", listener);
    return () => ipcRenderer.removeListener("chat:probe-event", listener);
  },
  saveConfig(config) {
    return ipcRenderer.invoke("config:save", config);
  },
  openConfigJson() {
    return ipcRenderer.invoke("config:open-json");
  },
  backupConfig() {
    return ipcRenderer.invoke("config:backup");
  },
  restoreConfig() {
    return ipcRenderer.invoke("config:restore");
  },
  confirmRestoreConfig(token) {
    return ipcRenderer.invoke("config:confirm-restore", token);
  },
  chooseImportAccounts() {
    return ipcRenderer.invoke("config:choose-import-accounts");
  },
  previewImportFile(filePath) {
    return ipcRenderer.invoke("config:preview-import-file", filePath);
  },
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
  },
  latestImportAccounts() {
    return ipcRenderer.invoke("config:latest-import-accounts");
  },
  importAccounts(filePath) {
    return ipcRenderer.invoke("config:import-accounts", filePath);
  },
  importAccountsRaw(raw) {
    return ipcRenderer.invoke("config:import-accounts-raw", raw);
  },
  previewImport(raw) {
    return ipcRenderer.invoke("config:preview-import", raw);
  },
  onUpdaterState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("updater:state", listener);
    return () => ipcRenderer.removeListener("updater:state", listener);
  },
  checkForUpdates() {
    return ipcRenderer.invoke("updater:check");
  },
  downloadUpdate() {
    return ipcRenderer.invoke("updater:download");
  },
  installUpdate() {
    return ipcRenderer.invoke("updater:install");
  },
  openRelease(url) {
    return ipcRenderer.invoke("updater:open-release", url);
  },
  getUpdaterState() {
    return ipcRenderer.invoke("updater:get-state");
  },
});
