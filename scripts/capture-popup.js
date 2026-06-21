const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { POPUP_WIDTH, computePopupHeight } = require("../src/layout");

const countArg = process.argv.find((arg) => arg.startsWith("--count="));
const sequenceArg = process.argv.find((arg) => arg.startsWith("--sequence="));
const debugLayout = process.argv.includes("--debug-layout");
const providerCount = countArg ? Number(countArg.split("=")[1]) : null;
const providerSequence = sequenceArg
  ? sequenceArg
      .split("=")[1]
      .split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite)
  : null;
const outputSuffix = providerSequence?.length
  ? `-${providerSequence.join("-to-")}`
  : Number.isFinite(providerCount)
    ? `-${providerCount}`
    : "";
const outputPath = path.join(__dirname, "..", "tmp", `popup-screenshot${outputSuffix}.png`);
const captureUserDataPath = path.join(__dirname, "..", "tmp", `electron-capture-${process.pid}`);
app.setPath("userData", captureUserDataPath);

const now = Date.now();
const sampleProviders = [
  {
    name: "Codex",
    kind: "official-subscription",
    kindLabel: "官方订阅",
    planLabel: "ChatGPT Pro",
    status: "warn",
    statusText: "偏高",
    tiers: [
      {
        name: "five_hour",
        label: "5h",
        utilization: 68,
        resetsAt: new Date(now + 78 * 60 * 1000).toISOString(),
      },
      {
        name: "weekly_limit",
        label: "周额度",
        utilization: 34,
        resetsAt: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    name: "Claude",
    kind: "official-subscription",
    kindLabel: "官方订阅",
    planLabel: "Max",
    status: "ok",
    statusText: "可用",
    tiers: [
      {
        name: "five_hour",
        label: "5h",
        utilization: 22,
        resetsAt: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: "seven_day_sonnet",
        label: "Sonnet 周额度",
        utilization: 41,
        usedValueUsd: 14.7,
        maxValueUsd: 35,
        resetsAt: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    name: "GLM Coding Plan",
    kind: "coding-plan",
    kindLabel: "Coding Plan",
    planLabel: "Z.AI",
    status: "danger",
    statusText: "接近上限",
    tiers: [
      {
        name: "five_hour",
        label: "5h Token",
        utilization: 91,
        resetsAt: new Date(now + 31 * 60 * 1000).toISOString(),
      },
      {
        name: "weekly_limit",
        label: "周 Token",
        utilization: 57,
        resetsAt: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    name: "Kimi Coding",
    kind: "coding-plan",
    kindLabel: "Coding Plan",
    planLabel: "Moonshot",
    status: "ok",
    statusText: "可用",
    tiers: [
      {
        name: "five_hour",
        label: "5h",
        utilization: 49,
        resetsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: "weekly_limit",
        label: "周额度",
        utilization: 28,
        resetsAt: new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    name: "DeepSeek",
    kind: "balance",
    kindLabel: "API 余额",
    planLabel: "Direct balance",
    status: "ok",
    statusText: "可用",
    balance: {
        planName: "账户余额",
      remaining: 18.42,
      unit: "CNY",
      extra: {
        toppedUpBalance: 15,
        grantedBalance: 3.42,
      },
    },
  },
];

function sampleSnapshotFor(count) {
  const providers = Number.isFinite(count) ? sampleProviders.slice(0, count) : sampleProviders;
  return {
    loading: false,
    updatedAt: now - 42_000,
    elapsedMs: 386,
    refreshIntervalSeconds: 300,
    errorCount: providers.filter((provider) => provider.status === "danger" || provider.status === "error").length,
    providers,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let captureWindow = null;
  const snapshots = providerSequence?.length
    ? providerSequence.map(sampleSnapshotFor)
    : [sampleSnapshotFor(providerCount)];
  const firstSnapshot = snapshots[0];

  ipcMain.handle("quota:refresh", () => {});
  ipcMain.handle("quota:open-config", () => {});
  ipcMain.handle("quota:hide", () => {});
  ipcMain.handle("quota:keep-open", () => {});
  ipcMain.handle("quota:leave-popup", () => {});
  ipcMain.handle("quota:resize", (_event, height) => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      if (debugLayout) console.log(`resize:${height}`);
      captureWindow.setResizable(true);
      captureWindow.setSize(POPUP_WIDTH, Math.round(Number(height)), false);
      captureWindow.setResizable(false);
    }
  });
  ipcMain.handle("quota:quit", () => {});
  ipcMain.handle("config:get", () => ({}));
  ipcMain.handle("config:save", () => ({}));
  ipcMain.handle("config:open-json", () => {});

  await app.whenReady();

  captureWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: computePopupHeight(firstSnapshot.providers),
    show: false,
    frame: false,
    resizable: false,
    transparent: false,
    backgroundColor: "#eef2f7",
    webPreferences: {
      preload: path.join(__dirname, "..", "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await captureWindow.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
  await captureWindow.webContents.insertCSS(`
    #app.is-entering .panel-shell,
    .provider,
    .provider.is-fresh {
      animation: none !important;
      opacity: 1 !important;
      transform: none !important;
    }
  `);
  const measuredHeights = [];
  for (const snapshot of snapshots) {
    const renderSnapshotScript = `
      var nextSnapshot = ${JSON.stringify(snapshot)};
      var nextLayoutKey = nextSnapshot.layoutKey || providerLayoutKey(nextSnapshot.providers);
      if (nextLayoutKey !== lastLayoutKey) {
        lastReportedHeight = 0;
        lastLayoutKey = nextLayoutKey;
      }
      snapshot = nextSnapshot;
      render();
      reportLayoutHeight();
    `;
    let renderedProviderCount = -1;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await captureWindow.webContents.executeJavaScript(renderSnapshotScript);
      await wait(150);
      renderedProviderCount = await captureWindow.webContents.executeJavaScript(
        "document.querySelectorAll('.provider').length",
      );
      if (renderedProviderCount === snapshot.providers.length) break;
    }
    if (renderedProviderCount !== snapshot.providers.length) {
      throw new Error(
        `Popup screenshot expected ${snapshot.providers.length} providers, rendered ${renderedProviderCount}`,
      );
    }
    await wait(250);
    if (debugLayout) {
      const debug = await captureWindow.webContents.executeJavaScript(`(() => {
        const shell = document.querySelector(".panel-shell");
        const root = document.querySelector("#app");
        const providerList = document.querySelector(".provider-list");
        const footer = document.querySelector(".footer");
        const rootStyle = getComputedStyle(root);
        const rootRect = root.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        return {
          innerHeight,
          className: providerList.className,
          providerCount: document.querySelectorAll(".provider").length,
          cardHeights: Array.from(document.querySelectorAll(".provider")).map((card) => Math.ceil(card.getBoundingClientRect().height)),
          providerListHeight: Math.ceil(providerList.getBoundingClientRect().height),
          providerListScrollHeight: providerList.scrollHeight,
          footerBottom: Math.ceil(footerRect.bottom - rootRect.top),
          desiredStatic: Math.ceil(footerRect.bottom - rootRect.top) + parseFloat(rootStyle.paddingBottom),
          lastReportedHeight,
          shellHeight: Math.ceil(shell.getBoundingClientRect().height),
        };
      })()`);
      console.log(JSON.stringify(debug));
    }
    measuredHeights.push(captureWindow.getSize()[1]);
  }

  const [finalWidth] = captureWindow.getSize();
  const firstHeight = measuredHeights[0];
  const finalHeight = measuredHeights[measuredHeights.length - 1];
  if (providerSequence?.length > 1 && finalHeight >= firstHeight - 80) {
    throw new Error(
      `Popup screenshot did not shrink after provider sequence: first=${firstHeight}, final=${finalHeight}`,
    );
  }
  if (Math.abs(finalWidth - POPUP_WIDTH) > 2) {
    throw new Error(`Popup width changed unexpectedly: ${finalWidth}`);
  }
  await wait(400);

  const image = await captureWindow.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  app.exit(0);
}

app.on("window-all-closed", () => {});

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
