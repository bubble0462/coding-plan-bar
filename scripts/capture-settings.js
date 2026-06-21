const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { providerTemplates } = require("../src/config-store");

const showTemplates = process.argv.includes("--templates");
const outputPath = path.join(
  __dirname,
  "..",
  "tmp",
  showTemplates ? "settings-screenshot-templates.png" : "settings-screenshot.png",
);
const captureUserDataPath = path.join(__dirname, "..", "tmp", `electron-settings-${process.pid}`);
app.setPath("userData", captureUserDataPath);

const sampleConfig = {
  refreshIntervalSeconds: 300,
  showOnHover: true,
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

  await app.whenReady();

  const window = new BrowserWindow({
    width: 940,
    height: 660,
    show: false,
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
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="toggle-templates"]')?.click();
    `);
    await wait(450);
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
