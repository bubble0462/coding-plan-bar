const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { POPUP_WIDTH, computePopupHeight } = require("../src/layout");

const countArg = process.argv.find((arg) => arg.startsWith("--count="));
const sequenceArg = process.argv.find((arg) => arg.startsWith("--sequence="));
const debugLayout = process.argv.includes("--debug-layout");
const balanceOnly = process.argv.includes("--balance-only");
const reorderTest = process.argv.includes("--reorder");
const grokOnly = process.argv.includes("--grok");
const darkMode = process.argv.includes("--dark");
const detailMode = process.argv.includes("--detail");
const deepSeekMode = process.argv.includes("--deepseek");
const providerCount = countArg ? Number(countArg.split("=")[1]) : null;
const providerSequence = sequenceArg
  ? sequenceArg
      .split("=")[1]
      .split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite)
  : null;
const outputSuffix = balanceOnly
  ? "-balance"
  : grokOnly
    ? "-grok"
  : reorderTest
    ? "-reorder"
  : providerSequence?.length
  ? `-${providerSequence.join("-to-")}`
  : Number.isFinite(providerCount)
    ? `-${providerCount}`
    : "";
const outputPath = path.join(
  __dirname,
  "..",
  "tmp",
  `popup-screenshot${outputSuffix}${detailMode ? "-detail" : ""}${deepSeekMode ? "-deepseek" : ""}${darkMode ? "-dark" : ""}.png`,
);
const captureUserDataPath = path.join(__dirname, "..", "tmp", `electron-capture-${process.pid}`);
app.setPath("userData", captureUserDataPath);

const now = Date.now();
const sampleProviders = [
  {
    id: "codex",
    name: "Codex",
    kind: "official-subscription",
    kindLabel: "官方订阅",
    planLabel: "ChatGPT Pro",
    status: "warn",
    statusText: "偏高",
    resetCredits: { available: 5 },
    tiers: [
      {
        name: "five_hour",
        label: "5h",
        utilization: 68,
        usage: { requests: 17, totalTokens: 1_248_000, costUsd: 1.18, partialCost: false },
        resetsAt: new Date(now + 78 * 60 * 1000).toISOString(),
      },
      {
        name: "weekly_limit",
        label: "周额度",
        utilization: 34,
        usage: { requests: 42, totalTokens: 3_840_000, costUsd: 4.72, partialCost: false },
        resetsAt: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    id: "claude",
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
        usage: { requests: 8, totalTokens: 486_000, costUsd: 2.14, partialCost: false },
        resetsAt: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: "seven_day_sonnet",
        label: "Sonnet 周额度",
        utilization: 41,
        usage: { requests: 31, totalTokens: 2_610_000, costUsd: 9.83, partialCost: false },
        usedValueUsd: 14.7,
        maxValueUsd: 35,
        resetsAt: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    id: "glm",
    name: "GLM Coding Plan",
    kind: "coding-plan",
    kindLabel: "Coding Plan",
    planLabel: "Z.AI",
    status: "danger",
    statusText: "接近上限",
    usageHistory: {
      hourly: Array.from({ length: 24 }, (_, index) => ({
        hour: String((index + 10) % 24).padStart(2, "0"),
        calls: [2, 1, 0, 0, 0, 0, 0, 0, 3, 8, 14, 21, 34, 47, 52, 41, 38, 44, 61, 48, 32, 19, 9, 4][index],
      })),
      todayCalls: 802,
      todayTokens: 313_000_000,
    },
    mcpQuota: {
      used: 402,
      total: 2000,
      utilization: 20.1,
      resetsAt: new Date(now + 21 * 24 * 60 * 60 * 1000).toISOString(),
    },
    tiers: [
      {
        name: "five_hour",
        label: "5h Token",
        utilization: 91,
        usage: { requests: 12, totalTokens: 816_000, costUsd: 0.76, partialCost: false },
        resetsAt: new Date(now + 31 * 60 * 1000).toISOString(),
      },
      {
        name: "weekly_limit",
        label: "周 Token",
        utilization: 57,
        usage: { requests: 38, totalTokens: 2_930_000, costUsd: 3.42, partialCost: true },
        resetsAt: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    id: "kimi",
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
        usage: { requests: 6, totalTokens: 372_000, costUsd: 0.39, partialCost: false },
        resetsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: "weekly_limit",
        label: "周额度",
        utilization: 28,
        usage: { requests: 24, totalTokens: 1_760_000, costUsd: 1.94, partialCost: false },
        resetsAt: new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "balance",
    kindLabel: "API 余额",
    planLabel: "Direct balance",
    status: "ok",
    statusText: "可用",
    platformUsage: {
      month: "2026-08",
      daily: Array.from({ length: 20 }, (_, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        costCny: [0.42, 0.18, 0, 0.05, 0.66, 1.24, 2.1, 1.8, 0.9, 0.32, 0.12, 0.48, 1.05, 2.4, 3.2, 2.8, 1.6, 0.7, 0.25, 0.55][index],
        tokens: {
          hit: 180_000 + index * 12_000,
          miss: 24_000 + index * 1_800,
          output: 9_000 + index * 700,
        },
      })),
      totals: { costCny: 19.86, totalTokens: 6_282_000, hit: 5_544_000, miss: 606_000, output: 132_000 },
      error: null,
    },
    balance: {
        planName: "账户余额",
      remaining: 18.42,
      unit: "CNY",
      extra: {
        toppedUpBalance: 15,
        grantedBalance: 3.42,
      },
    },
    usage: {
      scope: "近 7 天",
      requests: 186,
      totalTokens: 13_075_724,
      costUsd: 0.17,
      partialCost: false,
      estimated: true,
      source: "local",
      currency: "USD",
    },
  },
  {
    id: "grok",
    name: "Grok Build",
    kind: "official-subscription",
    tool: "grok",
    kindLabel: "官方订阅",
    planLabel: "SuperGrok",
    status: "ok",
    statusText: "可用",
    tiers: [
      {
        name: "grok_limit",
        label: "周期限额",
        utilization: 25,
        resetsAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: "grok_build",
        label: "GrokBuild 使用",
        utilization: 25,
        resetsAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: "grok_monthly_credits",
        label: "月度积分",
        utilization: 93.35,
        usedValueUsd: 140.03,
        maxValueUsd: 150,
        resetsAt: new Date(now + 21 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    extraUsage: {
      isEnabled: false,
      monthlyLimit: 30,
      usedCredits: 0,
      currency: "USD",
    },
  },
  {
    id: "antigravity",
    name: "Antigravity · pro-user@gmail.com",
    kind: "official-subscription",
    tool: "antigravity",
    kindLabel: "官方订阅",
    planLabel: "Google AI Pro",
    status: "ok",
    statusText: "可用",
    tiers: [
      {
        name: "five_hour",
        label: "5h",
        utilization: 62,
        resetsAt: new Date(now + 1.4 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: "weekly_limit",
        label: "周额度",
        utilization: 25,
        resetsAt: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
];

function sampleSnapshotFor(count) {
  const providers = balanceOnly
    ? sampleProviders.slice(-1)
    : grokOnly
      ? sampleProviders.filter((provider) => provider.id === "grok")
    : Number.isFinite(count)
      ? sampleProviders.slice(0, count)
      : sampleProviders;
  return {
    loading: false,
    updatedAt: now - 42_000,
    elapsedMs: 386,
    refreshIntervalSeconds: 300,
    theme: darkMode ? "dark" : "light",
    popupSelectedProvider: "all",
    errorCount: providers.filter((provider) => provider.status === "danger" || provider.status === "error").length,
    providers,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 解析 CSS 颜色（hex 或 rgb）的最大通道值，用于判断深色主题下表面是否仍是浅色。
function channelOf(color) {
  const value = String(color).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    return Math.max(parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16));
  }
  const match = /rgba?\((\d+), (\d+), (\d+)/.exec(value);
  return match ? Math.max(Number(match[1]), Number(match[2]), Number(match[3])) : 0;
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
  ipcMain.handle("quota:visibility-complete", () => {});
  ipcMain.handle("quota:select-provider", (_event, providerId) => {
    // Mirror production: the snapshot is sent immediately and the renderer's
    // measured-height report drives the single window resize.
    firstSnapshot.popupSelectedProvider = String(providerId);
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.webContents.send("quota:snapshot", firstSnapshot);
    }
    return { providerId };
  });
  ipcMain.handle("quota:resize", (_event, height) => {
    if (!captureWindow || captureWindow.isDestroyed()) return;
    if (debugLayout) console.log(`resize:${height}`);
    const bounds = captureWindow.getBounds();
    captureWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: POPUP_WIDTH,
      height: Math.round(Number(height)),
    });
  });
  ipcMain.handle("quota:reorder-providers", (_event, ids) => {
    const order = new Map(ids.map((id, index) => [id, index]));
    firstSnapshot.providers.sort((a, b) => order.get(a.id) - order.get(b.id));
    captureWindow?.webContents.send("quota:snapshot", firstSnapshot);
    return { providerIds: ids };
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
    // Match the production popup window: transparent surface, no background.
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "..", "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  captureWindow.webContents.on("console-message", (_event, _level, message) => {
    if (/\berror\b/i.test(message)) console.log(`[renderer] ${message}`);
  });

  await captureWindow.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
  await captureWindow.webContents.insertCSS(`
    #app.is-entering .panel-shell,
    .panel-shell.is-entering,
    .panel-shell.is-leaving,
    .provider,
    .provider.is-fresh {
      animation: none !important;
      opacity: 1 !important;
      transform: none !important;
    }
  `);
  const measuredHeights = [];
  let reorderCompleted = false;
  for (const snapshot of snapshots) {
    const renderSnapshotScript = `
      var nextSnapshot = ${JSON.stringify(snapshot)};
      var nextLayoutKey = nextSnapshot.layoutKey || providerLayoutKey(nextSnapshot.providers);
      if (nextLayoutKey !== lastLayoutKey) {
        lastReportedHeight = 0;
        lastLayoutKey = nextLayoutKey;
      }
      prevSnapshotUpdatedAt = nextSnapshot.updatedAt;
      hasEntered = true;
      snapshot = nextSnapshot;
      render(false);
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
    if (reorderTest && !reorderCompleted) {
      const triggered = await captureWindow.webContents.executeJavaScript(`
        (() => {
          const handles = document.querySelectorAll('[data-provider-drag]');
          const target = document.querySelector('[data-provider-id="glm"]');
          if (handles.length < 3 || !target) return false;
          const transfer = new DataTransfer();
          handles[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
          target.dispatchEvent(new DragEvent('dragover', {
            bubbles: true,
            clientY: target.getBoundingClientRect().bottom - 1,
            dataTransfer: transfer,
          }));
          target.dispatchEvent(new DragEvent('drop', {
            bubbles: true,
            clientY: target.getBoundingClientRect().bottom - 1,
            dataTransfer: transfer,
          }));
          handles[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
          return true;
        })()
      `);
      if (!triggered) throw new Error("Popup provider reorder controls were not rendered");
      await wait(180);
      const order = await captureWindow.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('[data-provider-id]')).map((node) => node.dataset.providerId).join(',')`,
      );
      if (!order.startsWith("claude,glm,codex")) throw new Error(`Popup provider reorder failed: ${order}`);
      reorderCompleted = true;
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
  if (reorderTest) {
    const finalOrder = await captureWindow.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('[data-provider-id]')).map((node) => node.dataset.providerId).join(',')`,
    );
    if (!finalOrder.startsWith("claude,glm,codex")) {
      throw new Error(`Popup provider order was not persistent: ${finalOrder}`);
    }
  }

  const image = await captureWindow.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());

  const assertions = await captureWindow.webContents.executeJavaScript(`(() => {
    const refresh = document.querySelector('[data-action="refresh"]');
    const list = document.querySelector('.provider-list');
    const cards = [...document.querySelectorAll('.provider[data-provider-id]')];
    const firstCardId = cards[0]?.dataset.providerId || null;
    const attentionSummary = document.querySelector('[data-action="focus-attention"]');
    const hasAttentionSummary = Boolean(attentionSummary && !attentionSummary.hidden);
    attentionSummary?.click();
    const focusedCard = document.activeElement?.matches?.('.provider[data-needs-attention="true"]')
      ? document.activeElement
      : null;
    const quotaRiskCard = providerCardFromMarkup(renderProvider({
      id: 'quota-risk-fixture',
      name: 'Quota Risk Fixture',
      kind: 'official-subscription',
      status: 'danger',
      statusText: '接近上限',
      tiers: [{ name: 'monthly', label: '月额度', utilization: 93 }],
    }, 0, false, false, false));
    const quotaWatchCard = providerCardFromMarkup(renderProvider({
      id: 'quota-watch-fixture',
      name: 'Quota Watch Fixture',
      kind: 'official-subscription',
      status: 'warn',
      statusText: '使用偏高',
      tiers: [{ name: 'monthly', label: '月额度', utilization: 75 }],
    }, 0, false, false, false));
    const emptyBalanceCard = providerCardFromMarkup(renderProvider({
      id: 'empty-balance-fixture',
      name: 'Empty Balance Fixture',
      kind: 'balance',
      status: 'danger',
      statusText: '余额不足',
      tiers: [],
      balance: { remaining: 0, unit: 'CNY' },
    }, 0, false, false, false));
    const serviceErrorCard = providerCardFromMarkup(renderProvider({
      id: 'service-error-fixture',
      name: 'Service Error Fixture',
      kind: 'official-subscription',
      status: 'error',
      statusText: '查询失败',
      failure: { label: '查询失败', action: '检查网络设置' },
      tiers: [],
    }, 0, false, false, false));
    const codexDetailCard = providerCardFromMarkup(renderProvider({
      id: 'codex',
      name: 'Codex',
      kind: 'official-subscription',
      status: 'ok',
      statusText: '可用',
      resetCredits: { available: 5 },
      tiers: [{ name: 'five_hour', label: '5h', utilization: 40 }],
    }, 0, false, false, false));
    return {
      refreshHasBusy: refresh ? refresh.getAttribute('aria-busy') : 'missing',
      listScrollable: list ? list.classList.contains('is-scrollable') : false,
      cardCount: cards.length,
      firstCardId,
      cardIdsStable: cards.every((card) => Boolean(card.dataset.providerId)),
      pointerClass: document.querySelector('.pointer')?.className || 'missing',
      hasAttentionSummary,
      attentionFocusId: focusedCard?.dataset.providerId || null,
      attentionFocusLabel: focusedCard?.getAttribute('aria-label') || '',
      quotaRiskSeparated: Boolean(
        quotaRiskCard?.classList.contains('is-quota-danger') &&
        quotaRiskCard.dataset.needsAttention === 'false' &&
        !quotaRiskCard.classList.contains('is-service-attention') &&
        quotaRiskCard.querySelector('.status-pill')?.textContent === '可用' &&
        quotaRiskCard.querySelector('.tier.is-quota-danger .tier-risk-label')?.textContent === '接近上限'
      ),
      quotaWatchIsVisualOnly: Boolean(
        quotaWatchCard?.classList.contains('is-quota-watch') &&
        quotaWatchCard.dataset.needsAttention === 'false' &&
        quotaWatchCard.querySelector('.tier.is-quota-watch .tier-risk-label')?.textContent === '需要关注'
      ),
      emptyBalanceIsVisualOnly: Boolean(
        emptyBalanceCard?.dataset.needsAttention === 'false' &&
        !emptyBalanceCard.classList.contains('is-service-attention') &&
        emptyBalanceCard.querySelector('.status-pill')?.textContent === '余额不足'
      ),
      serviceErrorSeparated: Boolean(
        serviceErrorCard?.classList.contains('is-service-attention') &&
        !serviceErrorCard.classList.contains('is-quota-danger')
      ),
      resetCreditsText: codexDetailCard?.querySelector('.reset-credits-row strong')?.textContent || '',
      rootTheme: document.documentElement.dataset.theme || '',
      selectorChips: Array.from(document.querySelectorAll('.selector-chip')).map((chip) => chip.textContent.trim()),
      activeSelection: document.querySelector('.selector-chip.is-active')?.dataset.selectProvider || '',
      overviewRowCount: document.querySelectorAll('.provider.overview-row').length,
      overviewRows: Array.from(document.querySelectorAll('.provider.overview-row')).map((row) => ({
        id: row.dataset.providerId || '',
        value: row.querySelector('.overview-value')?.textContent.trim() || '',
        tierChips: Array.from(row.querySelectorAll('.overview-tier')).map((chip) => ({
          label: chip.querySelector('.overview-tier-label')?.textContent.trim() || '',
          value: chip.querySelector('.overview-tier-value')?.textContent.trim() || '',
          barWidth: chip.querySelector('.progress-bar')?.style.width || '',
          trackRenderedWidth: Math.round(chip.querySelector('.progress-track')?.getBoundingClientRect().width || 0),
          barRenderedWidth: Math.round(chip.querySelector('.progress-bar')?.getBoundingClientRect().width || 0),
        })),
      })),
    };
  })()`);
  if (assertions.refreshHasBusy === 'missing') throw new Error('Popup refresh control was not rendered');
  if (assertions.cardCount !== firstSnapshot.providers.length) {
    throw new Error(`Popup card count assertion failed: ${assertions.cardCount}`);
  }
  if (!assertions.cardIdsStable) throw new Error('Popup provider cards must keep stable data-provider-id');
  if (assertions.overviewRowCount !== firstSnapshot.providers.length) {
    throw new Error(`Popup overview rows incomplete: ${assertions.overviewRowCount} of ${firstSnapshot.providers.length}`);
  }
  for (const row of assertions.overviewRows) {
    if (!row.value && !row.tierChips.length) {
      throw new Error(`Popup overview rows must all show a metric: ${JSON.stringify(assertions.overviewRows)}`);
    }
    for (const chip of row.tierChips) {
      if (chip.trackRenderedWidth < 30 || chip.barRenderedWidth < 2) {
        throw new Error(
          `Popup overview tier chip bar is not visibly filled for ${row.id} ${chip.label}: ${JSON.stringify(chip)}`,
        );
      }
    }
  }
  for (const provider of firstSnapshot.providers) {
    const row = assertions.overviewRows.find((entry) => entry.id === provider.id);
    if (!row) throw new Error(`Popup overview row missing for ${provider.id}`);
    const tierCount = Array.isArray(provider.tiers) ? provider.tiers.length : 0;
    if (tierCount > 1 && row.tierChips.length !== 2) {
      throw new Error(`Popup overview row ${provider.id} must show both tier chips: ${JSON.stringify(row)}`);
    }
    if (tierCount === 1 && (!row.value.startsWith("剩余") || row.tierChips.length)) {
      throw new Error(`Popup overview row ${provider.id} must keep the single-tier metric: ${JSON.stringify(row)}`);
    }
    if (!tierCount && !provider.balance && !row.value) {
      throw new Error(`Popup overview row ${provider.id} must show a status label: ${JSON.stringify(row)}`);
    }
  }
  const glmRow = assertions.overviewRows.find((entry) => entry.id === "glm");
  if (glmRow && !(glmRow.tierChips.some((chip) => chip.label === "5h") && glmRow.tierChips.some((chip) => chip.label === "周"))) {
    throw new Error(`Popup GLM overview row must show 5h and weekly chips: ${JSON.stringify(glmRow)}`);
  }
  const antigravityRow = assertions.overviewRows.find((entry) => entry.id === "antigravity");
  if (antigravityRow && !(antigravityRow.tierChips.some((chip) => chip.label === "5h") && antigravityRow.tierChips.some((chip) => chip.label === "周"))) {
    throw new Error(`Popup Antigravity overview row must show 5h and weekly chips: ${JSON.stringify(antigravityRow)}`);
  }
  const snapshotIds = firstSnapshot.providers.map((provider) => provider.id);
  if (snapshotIds.includes("deepseek") && !assertions.overviewRows.some((row) => row.id === "deepseek" && row.value.startsWith("￥"))) {
    throw new Error(`Popup overview must show a CNY balance for DeepSeek: ${JSON.stringify(assertions.overviewRows)}`);
  }
  if (firstSnapshot.providers.some((provider) => provider.id !== "deepseek" && (!provider.balance || provider.tiers?.length)) &&
      !assertions.overviewRows.some((row) => row.value.startsWith("剩余") || row.tierChips.length)) {
    throw new Error(`Popup overview must show remaining percent for tier providers: ${JSON.stringify(assertions.overviewRows)}`);
  }
  if (!assertions.selectorChips.includes('全部') || assertions.selectorChips.length !== firstSnapshot.providers.length + 1) {
    throw new Error(`Popup provider selector chips incomplete: ${JSON.stringify(assertions.selectorChips)}`);
  }
  if (assertions.activeSelection !== 'all') {
    throw new Error(`Popup default selection should be the all view: ${JSON.stringify(assertions.activeSelection)}`);
  }
  if (assertions.hasAttentionSummary && (!assertions.attentionFocusId || !assertions.attentionFocusLabel)) {
    throw new Error(`Popup attention summary did not focus an accessible provider card: ${JSON.stringify(assertions)}`);
  }
  if (!assertions.quotaRiskSeparated) {
    throw new Error('Popup quota risk must remain visual without becoming actionable');
  }
  if (!assertions.quotaWatchIsVisualOnly) {
    throw new Error('Popup quota watch state must remain visual without becoming actionable');
  }
  if (!assertions.emptyBalanceIsVisualOnly) {
    throw new Error('Popup exhausted balance must remain visual without becoming actionable');
  }
  if (!assertions.serviceErrorSeparated) {
    throw new Error('Popup service error must retain a distinct card-level warning');
  }
  if (!grokOnly && !/剩余\s*5\s*次/.test(assertions.resetCreditsText)) {
    throw new Error(`Popup codex reset credits row was not rendered: ${JSON.stringify(assertions.resetCreditsText)}`);
  }
  if (darkMode && assertions.rootTheme !== "dark") {
    throw new Error(`Popup dark theme was not applied to root element: ${JSON.stringify(assertions.rootTheme)}`);
  }
  if (darkMode) {
    // 深色主题回归门禁：卡片必须比面板亮（亮度阶梯），否则卡片会沉进背景。
    const darkLadder = await captureWindow.webContents.executeJavaScript(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const card = document.querySelector(".provider");
      return {
        surface: cs.getPropertyValue("--surface").trim(),
        panel: cs.getPropertyValue("--panel").trim(),
        cardBg: card ? getComputedStyle(card).backgroundColor : "",
        chartBg: cs.getPropertyValue("--chart-bg").trim(),
      };
    })()`);
    if (channelOf(darkLadder.surface) <= channelOf(darkLadder.panel)) {
      throw new Error(`Popup dark surface must be lighter than panel: ${JSON.stringify(darkLadder)}`);
    }
    if (channelOf(darkLadder.chartBg) > 80) {
      throw new Error(`Popup dark chart card must not stay white: ${JSON.stringify(darkLadder)}`);
    }
  }

  // Regression: overview tier chips must re-render bar width and risk color when
  // utilization changes, and the changed row must flash.
  if (!detailMode && !deepSeekMode) {
    const refreshSnapshot = structuredClone(firstSnapshot);
    const glmRefresh = refreshSnapshot.providers.find((provider) => provider.id === "glm");
    const codexRefresh = refreshSnapshot.providers.find((provider) => provider.id === "codex");
    if (glmRefresh) {
      glmRefresh.tiers[0].utilization = 96;
      glmRefresh.tiers[1].utilization = 78;
    }
    if (codexRefresh) codexRefresh.tiers[1].utilization = 12;
    refreshSnapshot.updatedAt = Date.now();
    await captureWindow.webContents.executeJavaScript(`
      var nextSnapshot = ${JSON.stringify(refreshSnapshot)};
      var nextLayoutKey = nextSnapshot.layoutKey || providerLayoutKey(nextSnapshot.providers);
      if (nextLayoutKey !== lastLayoutKey) {
        lastReportedHeight = 0;
        lastLayoutKey = nextLayoutKey;
      }
      prevSnapshotUpdatedAt = nextSnapshot.updatedAt;
      hasEntered = true;
      snapshot = nextSnapshot;
      render(false);
      reportLayoutHeight();
    `);
    await wait(150);
    const refreshAssertions = await captureWindow.webContents.executeJavaScript(`(() => {
      const chips = (id) => Array.from(document.querySelectorAll(".provider.overview-row[data-provider-id=" + JSON.stringify(id) + "] .overview-tier"));
      const read = (chip) => ({
        width: chip.querySelector(".progress-bar")?.style.width || "",
        cls: chip.querySelector(".progress-bar")?.className || "",
        rendered: Math.round(chip.querySelector(".progress-bar")?.getBoundingClientRect().width || 0),
      });
      return {
        glm: chips("glm").map(read),
        codexWeekly: chips("codex").map(read)[1] || null,
        glmFlashed: Boolean(document.querySelector('.provider.overview-row[data-provider-id="glm"]')?.classList.contains("is-changed")),
      };
    })()`);
    if (glmRefresh) {
      if (refreshAssertions.glm[0].width !== "96%" || !refreshAssertions.glm[0].cls.includes("bar-danger")) {
        throw new Error(`Popup GLM 5h chip did not update after refresh: ${JSON.stringify(refreshAssertions.glm[0])}`);
      }
      if (refreshAssertions.glm[1].width !== "78%" || !refreshAssertions.glm[1].cls.includes("bar-warn")) {
        throw new Error(`Popup GLM weekly chip did not switch to warn color after refresh: ${JSON.stringify(refreshAssertions.glm[1])}`);
      }
      if (refreshAssertions.glm.some((chip) => chip.rendered < 4)) {
        throw new Error(`Popup GLM chip fills must stay visible after refresh: ${JSON.stringify(refreshAssertions.glm)}`);
      }
      if (!refreshAssertions.glmFlashed) {
        throw new Error("Popup changed overview rows must flash after a data refresh");
      }
    }
    if (codexRefresh && (!refreshAssertions.codexWeekly || refreshAssertions.codexWeekly.width !== "12%")) {
      throw new Error(`Popup codex weekly chip did not update after refresh: ${JSON.stringify(refreshAssertions.codexWeekly)}`);
    }

    // count-up：数值刷新后百分比数字从旧值滚动到新值，最终必须精确落位。
    await wait(900);
    const countUpResult = await captureWindow.webContents.executeJavaScript(`(() => ({
      glmFiveHour: document.querySelector('.provider.overview-row[data-provider-id="glm"] .overview-tier:nth-child(1) .overview-tier-value')?.textContent || "",
      glmWeekly: document.querySelector('.provider.overview-row[data-provider-id="glm"] .overview-tier:nth-child(2) .overview-tier-value')?.textContent || "",
      refreshTip: document.querySelector('[data-action="refresh"]')?.getAttribute("data-tip") || "",
      tipCss: getComputedStyle(document.documentElement).getPropertyValue("--tip-bg").trim(),
    }))()`);
    if (!grokOnly && (countUpResult.glmFiveHour !== "4%" || countUpResult.glmWeekly !== "22%")) {
      throw new Error(`Popup count-up did not settle on the refreshed values: ${JSON.stringify(countUpResult)}`);
    }
    if (countUpResult.refreshTip !== "立即刷新额度" || !countUpResult.tipCss) {
      throw new Error(`Popup tooltip wiring missing: ${JSON.stringify(countUpResult)}`);
    }

    // Celebration overlay: one confetti burst + toast per reset event key.
    await captureWindow.webContents.executeJavaScript(
      `handleCelebrations([{ key: "celebrate-test-1", providerId: "glm", providerName: "GLM Coding Plan", tierLabel: "周额度" }])`,
    );
    await wait(200);
    const celebrationAssertions = await captureWindow.webContents.executeJavaScript(`(() => ({
      confettiPieces: document.querySelectorAll(".confetti-piece").length,
      toastText: document.querySelector(".reset-toast")?.textContent || "",
    }))()`);
    if (celebrationAssertions.confettiPieces < 20 || !celebrationAssertions.toastText.includes("周额度已重置")) {
      throw new Error(`Popup celebration overlay missing: ${JSON.stringify(celebrationAssertions)}`);
    }
    // The same key must not replay; a second, different key replays fine.
    await captureWindow.webContents.executeJavaScript(
      `handleCelebrations([{ key: "celebrate-test-1", providerId: "glm", providerName: "GLM Coding Plan", tierLabel: "周额度" }])`,
    );
    const dedupOk = await captureWindow.webContents.executeJavaScript(
      `(() => document.querySelectorAll(".confetti-piece").length)()`,
    );
    if (dedupOk !== celebrationAssertions.confettiPieces) {
      throw new Error(`Popup celebration dedup failed: ${dedupOk} vs ${celebrationAssertions.confettiPieces}`);
    }
  }

  if (deepSeekMode) {
    // Entering the detail view by clicking the compact overview row.
    await captureWindow.webContents.executeJavaScript(
      `document.querySelector('.provider.overview-row[data-provider-id="deepseek"]')?.click()`,
    );
    await wait(400);
    const deepSeekAssertions = await captureWindow.webContents.executeJavaScript(`(() => {
      const line = document.querySelector('.detail-chart polyline');
      const footer = document.querySelector('.footer');
      const footerRect = footer?.getBoundingClientRect();
      return {
        detailCard: Boolean(document.querySelector('.provider-detail .provider[data-provider-id="deepseek"]')),
        statChips: document.querySelectorAll('.usage-detail .stat-chip').length,
        linePoints: line ? line.getAttribute('points').trim().split(/\\s+/).length : 0,
        pricingBadge: document.querySelector('.usage-detail .pricing-badge')?.textContent || '',
        sourceNote: document.querySelector('.usage-detail .usage-source')?.textContent || '',
        breakdown: document.querySelector('.usage-detail .usage-breakdown')?.textContent || '',
        footerVisible: Boolean(footerRect && footerRect.bottom <= window.innerHeight + 1),
      };
    })()`);
    if (!deepSeekAssertions.detailCard) throw new Error('DeepSeek detail view did not render the provider card');
    if (deepSeekAssertions.statChips !== 2) {
      throw new Error(`DeepSeek detail must show cost and token chips: ${deepSeekAssertions.statChips}`);
    }
    if (deepSeekAssertions.linePoints !== 20) {
      throw new Error(`DeepSeek month chart must have 20 points: ${deepSeekAssertions.linePoints}`);
    }
    if (!/空闲 5 折|高峰时段/.test(deepSeekAssertions.pricingBadge)) {
      throw new Error(`DeepSeek pricing badge missing: ${JSON.stringify(deepSeekAssertions.pricingBadge)}`);
    }
    if (!deepSeekAssertions.sourceNote.includes("平台控制台")) {
      throw new Error(`DeepSeek source note missing: ${JSON.stringify(deepSeekAssertions.sourceNote)}`);
    }
    if (!deepSeekAssertions.breakdown.includes("缓存命中")) {
      throw new Error(`DeepSeek token breakdown missing: ${JSON.stringify(deepSeekAssertions.breakdown)}`);
    }
    if (!deepSeekAssertions.footerVisible) throw new Error('DeepSeek detail view footer is clipped');
    const deepSeekImage = await captureWindow.capturePage();
    fs.writeFileSync(outputPath, deepSeekImage.toPNG());
  }

  if (detailMode) {
    const overviewHeight = captureWindow.getBounds().height;
    await captureWindow.webContents.executeJavaScript(
      `document.querySelector('[data-select-provider="glm"]')?.click()`,
    );
    await wait(400);
    const detailHeight = captureWindow.getBounds().height;
    const detailAssertions = await captureWindow.webContents.executeJavaScript(`(() => {
      const line = document.querySelector('.detail-chart polyline');
      const selector = document.querySelector('.provider-selector');
      const rect = selector?.getBoundingClientRect();
      const activeChip = document.querySelector('.selector-chip.is-active');
      const activeChipRect = activeChip?.getBoundingClientRect();
      const listRect = document.querySelector('.provider-list')?.getBoundingClientRect();
      const detailRect = document.querySelector('.provider-detail')?.getBoundingClientRect();
      const footer = document.querySelector('.footer');
      const footerRect = footer?.getBoundingClientRect();
      return {
        detailCard: Boolean(document.querySelector('.provider-detail .provider[data-provider-id="glm"]')),
        linePoints: line ? line.getAttribute('points').trim().split(/\\s+/).length : 0,
        statChips: document.querySelectorAll('.usage-detail .stat-chip').length,
        mcpTier: Boolean(document.querySelector('.usage-detail .mcp-tier')),
        activeChip: document.querySelector('.selector-chip.is-active')?.dataset.selectProvider || '',
        selectorHeight: rect ? Math.round(rect.height) : 0,
        activeChipFullyVisible: Boolean(
          rect && activeChipRect &&
          activeChipRect.top >= rect.top - 0.5 &&
          activeChipRect.bottom <= rect.bottom + 0.5
        ),
        detailBelowSelector: Boolean(
          rect && listRect && detailRect &&
          listRect.top >= rect.bottom - 0.5 &&
          detailRect.top >= rect.bottom - 0.5
        ),
        selectorVisible: Boolean(
          rect && rect.height > 4 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1,
        ),
        footerVisible: Boolean(
          footerRect && footerRect.height > 4 && footerRect.bottom <= window.innerHeight + 1,
        ),
        selectorTop: rect ? Math.round(rect.top) : null,
        footerBottom: footerRect ? Math.round(footerRect.bottom) : null,
        viewportHeight: window.innerHeight,
      };
    })()`);
    if (!detailAssertions.detailCard) throw new Error('Popup detail view did not render the selected provider card');
    if (detailAssertions.linePoints !== 24) {
      throw new Error(`Popup 24h line chart must have 24 points: ${detailAssertions.linePoints}`);
    }
    if (detailAssertions.statChips !== 2) {
      throw new Error(`Popup detail view must show today call and token chips: ${detailAssertions.statChips}`);
    }
    if (!detailAssertions.mcpTier) throw new Error('Popup detail view must render the MCP monthly quota row');
    if (detailAssertions.activeChip !== 'glm') {
      throw new Error(`Popup selection chip should be glm: ${JSON.stringify(detailAssertions.activeChip)}`);
    }
    if (!detailAssertions.selectorVisible) {
      throw new Error(
        `Popup provider selector is not visible in detail view: top=${detailAssertions.selectorTop} viewport=${detailAssertions.viewportHeight}`,
      );
    }
    if (detailAssertions.selectorHeight < 34 || !detailAssertions.activeChipFullyVisible) {
      throw new Error(
        `Popup GLM selector was flex-shrunk or clipped: ${JSON.stringify(detailAssertions)}`,
      );
    }
    if (!detailAssertions.detailBelowSelector) {
      throw new Error(
        `Popup GLM detail overlapped the provider selector: ${JSON.stringify(detailAssertions)}`,
      );
    }
    if (!detailAssertions.footerVisible) {
      throw new Error(
        `Popup footer is clipped in detail view: bottom=${detailAssertions.footerBottom} viewport=${detailAssertions.viewportHeight}`,
      );
    }
    if (detailHeight <= overviewHeight + 80) {
      throw new Error(`Popup GLM detail did not expand to its natural height: overview=${overviewHeight}, detail=${detailHeight}`);
    }
    await captureWindow.webContents.executeJavaScript(`(() => {
      render(true);
      reportLayoutHeight();
    })()`);
    await wait(200);
    const afterRerender = await captureWindow.webContents.executeJavaScript(`(() => {
      const selector = document.querySelector('.provider-selector')?.getBoundingClientRect();
      const chip = document.querySelector('.selector-chip.is-active')?.getBoundingClientRect();
      const detail = document.querySelector('.provider-detail')?.getBoundingClientRect();
      return {
        active: document.querySelector('.selector-chip.is-active')?.dataset.selectProvider || '',
        selectorHeight: selector ? Math.round(selector.height) : 0,
        chipVisible: Boolean(selector && chip && chip.top >= selector.top - 0.5 && chip.bottom <= selector.bottom + 0.5),
        detailBelow: Boolean(selector && detail && detail.top >= selector.bottom - 0.5),
      };
    })()`);
    if (afterRerender.active !== 'glm') {
      throw new Error(`Popup selection did not survive a refresh render: ${JSON.stringify(afterRerender)}`);
    }
    if (afterRerender.selectorHeight < 34 || !afterRerender.chipVisible || !afterRerender.detailBelow) {
      throw new Error(`Popup GLM refresh clipped or overlapped the selector: ${JSON.stringify(afterRerender)}`);
    }
    if (captureWindow.getBounds().height !== detailHeight) {
      throw new Error(`Popup GLM refresh changed detail height: before=${detailHeight}, after=${captureWindow.getBounds().height}`);
    }

    // Transition back to the all view must not leave any detail markup behind.
    await captureWindow.webContents.executeJavaScript(
      `document.querySelector('[data-select-provider="all"]')?.click()`,
    );
    await wait(400);
    const backAssertions = await captureWindow.webContents.executeJavaScript(`(() => ({
      leftoverDetail: Boolean(document.querySelector('.provider-detail')),
      leftoverUsage: Boolean(document.querySelector('.usage-detail')),
      leftoverMcp: Boolean(document.querySelector('.mcp-tier')),
      cardCount: document.querySelectorAll('.provider[data-provider-id]').length,
      activeChip: document.querySelector('.selector-chip.is-active')?.dataset.selectProvider || '',
    }))()`);
    if (backAssertions.leftoverDetail || backAssertions.leftoverUsage || backAssertions.leftoverMcp) {
      throw new Error(`Popup all view retained detail leftovers: ${JSON.stringify(backAssertions)}`);
    }
    if (backAssertions.activeChip !== 'all') {
      throw new Error(`Popup back-to-all chip should be active: ${JSON.stringify(backAssertions.activeChip)}`);
    }

    await captureWindow.webContents.executeJavaScript(
      `document.querySelector('[data-select-provider="glm"]')?.click()`,
    );
    await wait(400);
    const detailImage = await captureWindow.capturePage();
    fs.writeFileSync(outputPath, detailImage.toPNG());
  }

  app.exit(0);
}

app.on("window-all-closed", () => {});

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
