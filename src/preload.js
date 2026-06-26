const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codingPlanBar", {
  onSnapshot(callback) {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("quota:snapshot", listener);
    return () => ipcRenderer.removeListener("quota:snapshot", listener);
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
  resize(height, layoutKey) {
    return ipcRenderer.invoke("quota:resize", height, layoutKey);
  },
  quit() {
    return ipcRenderer.invoke("quota:quit");
  },
  getConfig() {
    return ipcRenderer.invoke("config:get");
  },
  saveConfig(config) {
    return ipcRenderer.invoke("config:save", config);
  },
  openConfigJson() {
    return ipcRenderer.invoke("config:open-json");
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
