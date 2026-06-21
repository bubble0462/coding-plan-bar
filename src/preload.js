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
});
