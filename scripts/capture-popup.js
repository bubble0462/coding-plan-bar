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
const outputPath = path.join(__dirname, "..", "tmp", `popup-screenshot${outputSuffix}${detailMode ? "-detail" : ""}${darkMode ? "-dark" : ""}.png`);
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
  ipcMain.handle("quota:select-provider", (_event, providerId) => ({ providerId }));
  ipcMain.handle("quota:resize", (_event, height) => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      if (debugLayout) console.log(`resize:${height}`);
      captureWindow.setResizable(true);
      captureWindow.setSize(POPUP_WIDTH, Math.round(Number(height)), false);
      captureWindow.setResizable(false);
    }
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
    const serviceErrorCard = providerCardFromMarkup(renderProvider({
      id: 'service-error-fixture',
      name: 'Service Error Fixture',
      kind: 'official-subscription',
      status: 'error',
      statusText: '查询失败',
      failure: { label: '查询失败', action: '检查网络设置' },
      tiers: [],
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
        quotaRiskCard.dataset.needsAttention === 'true' &&
        !quotaRiskCard.classList.contains('is-service-attention') &&
        quotaRiskCard.querySelector('.status-pill')?.textContent === '可用' &&
        quotaRiskCard.querySelector('.tier.is-quota-danger .tier-risk-label')?.textContent === '接近上限'
      ),
      quotaWatchIsVisualOnly: Boolean(
        quotaWatchCard?.classList.contains('is-quota-watch') &&
        quotaWatchCard.dataset.needsAttention === 'false' &&
        quotaWatchCard.querySelector('.tier.is-quota-watch .tier-risk-label')?.textContent === '需要关注'
      ),
      serviceErrorSeparated: Boolean(
        serviceErrorCard?.classList.contains('is-service-attention') &&
        !serviceErrorCard.classList.contains('is-quota-danger')
      ),
      resetCreditsText: document.querySelector('.provider[data-provider-id="codex"] .reset-credits-row strong')?.textContent || '',
      rootTheme: document.documentElement.dataset.theme || '',
      selectorChips: Array.from(document.querySelectorAll('.selector-chip')).map((chip) => chip.textContent.trim()),
      activeSelection: document.querySelector('.selector-chip.is-active')?.dataset.selectProvider || '',
    };
  })()`);
  if (assertions.refreshHasBusy === 'missing') throw new Error('Popup refresh control was not rendered');
  if (assertions.cardCount !== firstSnapshot.providers.length) {
    throw new Error(`Popup card count assertion failed: ${assertions.cardCount}`);
  }
  if (!assertions.cardIdsStable) throw new Error('Popup provider cards must keep stable data-provider-id');
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
    throw new Error('Popup quota risk must not present a healthy service as a service error');
  }
  if (!assertions.quotaWatchIsVisualOnly) {
    throw new Error('Popup quota watch state must remain visual without becoming actionable');
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

  if (detailMode) {
    await captureWindow.webContents.executeJavaScript(
      `document.querySelector('[data-select-provider="glm"]')?.click()`,
    );
    await wait(400);
    const detailAssertions = await captureWindow.webContents.executeJavaScript(`(() => {
      const line = document.querySelector('.detail-chart polyline');
      return {
        detailCard: Boolean(document.querySelector('.provider-detail .provider[data-provider-id="glm"]')),
        linePoints: line ? line.getAttribute('points').trim().split(/\\s+/).length : 0,
        statChips: document.querySelectorAll('.usage-detail .stat-chip').length,
        mcpTier: Boolean(document.querySelector('.usage-detail .mcp-tier')),
        activeChip: document.querySelector('.selector-chip.is-active')?.dataset.selectProvider || '',
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
    const afterRerender = await captureWindow.webContents.executeJavaScript(
      `(() => { render(false); return document.querySelector('.selector-chip.is-active')?.dataset.selectProvider || ''; })()`,
    );
    if (afterRerender !== 'glm') {
      throw new Error(`Popup selection did not survive a re-render: ${JSON.stringify(afterRerender)}`);
    }
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
