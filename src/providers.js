const fs = require("fs");
const os = require("os");
const path = require("path");
const { readConfigFile, normalizeConfig } = require("./config-store");
const { classifyFailure } = require("./failure-classifier");
const { appFetch } = require("./http-client");
const { collectLocalUsage, attachUsageToProvider } = require("./session-usage");
const { fetchGrokBillingViaCli } = require("./grok-rpc");
const { fetchGrokWebBilling } = require("./grok-web-billing");

const TIER_LABELS = {
  five_hour: "5h",
  seven_day: "周额度",
  weekly_limit: "周额度",
  seven_day_opus: "Opus 周额度",
  seven_day_sonnet: "Sonnet 周额度",
  gemini_pro: "Gemini Pro",
  gemini_flash: "Gemini Flash",
  gemini_flash_lite: "Flash Lite",
  grok_limit: "周期限额",
  grok_build: "GrokBuild 使用",
  grok_monthly_credits: "月度积分",
};

function loadConfig(configPath) {
  return readConfigFile(configPath);
}

function normalizeProviderConfig(config) {
  return normalizeConfig(config);
}

async function refreshProviders(config, options = {}) {
  const enabled = config.providers.filter((provider) => provider.enabled !== false);
  const collectUsage = options.collectLocalUsage || collectLocalUsage;
  const refreshOne = options.refreshProvider || refreshProvider;
  const localUsagePromise = collectUsage(enabled).catch(() => []);
  const snapshots = new Array(enabled.length);
  await Promise.all(
    enabled.map(async (provider, index) => {
      const snapshot = await refreshOne(provider);
      snapshots[index] = snapshot;
      if (typeof options.onProvider === "function") {
        try {
          options.onProvider(snapshot, index, enabled, { phase: "quota" });
        } catch (_error) {
          // Rendering callbacks must not turn a successful provider query into a failed refresh.
        }
      }
    }),
  );
  const localUsage = await localUsagePromise;
  return snapshots.map((snapshot, index) => {
    const attached = attachUsageToProvider(enabled[index], snapshot, localUsage, Date.now(), enabled);
    if (typeof options.onProvider === "function") {
      try {
        options.onProvider(attached, index, enabled, { phase: "usage" });
      } catch (_error) {
        // Usage enrichment is best-effort and must not fail the refresh.
      }
    }
    return attached;
  });
}

async function refreshProvider(provider) {
  try {
    if (provider.kind === "official-subscription") {
      return normalizeSubscriptionProvider(provider, await queryOfficialSubscription(provider));
    }
    if (provider.kind === "coding-plan") {
      return normalizeSubscriptionProvider(provider, await queryCodingPlan(provider));
    }
    if (provider.kind === "balance") {
      return normalizeBalanceProvider(provider, await queryBalance(provider));
    }
    if (provider.kind === "manual") {
      return normalizeManualProvider(provider);
    }
    return errorProvider(provider, `Unsupported provider kind: ${provider.kind}`);
  } catch (error) {
    return errorProvider(provider, error.message || String(error));
  }
}

function normalizeSubscriptionProvider(provider, quota) {
  const tiers = (quota.tiers || []).map((tier) => ({
    name: tier.name,
    label: TIER_LABELS[tier.name] || tier.name,
    utilization: clamp(Number(tier.utilization || 0), 0, 100),
    remaining: clamp(100 - Number(tier.utilization || 0), 0, 100),
    resetsAt: tier.resetsAt || null,
    usedValueUsd: tier.usedValueUsd ?? null,
    maxValueUsd: tier.maxValueUsd ?? null,
  }));

  const worst = tiers.reduce((max, tier) => Math.max(max, tier.utilization), 0);
  const failure = !quota.success ? classifyFailure(quota.error || quota.credentialMessage, quota.httpStatus) : null;
  let status = "ok";
  if (!quota.success) status = quota.credentialStatus === "not_found" ? "missing" : "error";
  if (quota.credentialStatus === "expired") status = "expired";
  if (quota.success && worst >= 90) status = "danger";
  else if (quota.success && worst >= 70) status = "warn";

  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    tool: quota.tool || provider.tool || provider.id,
    status,
    statusText: failure ? failure.label : statusText(status),
    message: quota.error || quota.credentialMessage || null,
    failure,
    planLabel: quota.planLabel || quota.credentialMessage || null,
    queriedAt: quota.queriedAt || Date.now(),
    tiers,
    extraUsage: quota.extraUsage || null,
    usageHistory: quota.usageHistory || null,
    mcpQuota: quota.mcpQuota || null,
    resetCredits: quota.resetCredits || null,
    billingDetails: quota.billingDetails || null,
    diagnostics: quota.diagnostics || null,
  };
}

function normalizeBalanceProvider(provider, result) {
  if (!result.success) {
    const failure = classifyFailure(result.error || "余额查询失败");
    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      status: "error",
      statusText: failure.label,
      message: result.error || "余额查询失败",
      failure,
      queriedAt: Date.now(),
      tiers: [],
      balance: null,
    };
  }

  const balances = result.data || [];
  const byUnit = (unit) => balances.find((item) => String(item.unit || "").toUpperCase() === unit);
  const isDeepSeek = String(provider.baseUrl || "").toLowerCase().includes("api.deepseek.com");
  const preferred = isDeepSeek
    ? byUnit("CNY") || balances[0] || null
    : byUnit("USD") || byUnit("CNY") || balances[0] || null;
  const remaining = preferred?.remaining ?? null;
  const isValid = preferred?.isValid !== false && (remaining == null || remaining > 0);
  const usage = parseBalanceUsage(preferred?.extra, preferred?.unit);

  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    status: isValid ? "ok" : "danger",
    statusText: isValid ? "可用" : "余额不足",
    message: preferred?.invalidMessage || null,
    queriedAt: Date.now(),
    tiers: [],
    balance: preferred,
    balances,
    usage,
  };
}

function normalizeManualProvider(provider) {
  const tiers = (provider.tiers || []).map((tier) => ({
    name: tier.name,
    label: tier.label || TIER_LABELS[tier.name] || tier.name,
    utilization: clamp(Number(tier.utilization || 0), 0, 100),
    remaining: clamp(100 - Number(tier.utilization || 0), 0, 100),
    resetsAt: tier.resetsAt || null,
  }));
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    status: "manual",
    statusText: "手动",
    message: provider.message || null,
    queriedAt: Date.now(),
    tiers,
  };
}

function errorProvider(provider, message) {
  const failure = classifyFailure(message);
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    status: "error",
    statusText: failure.label,
    message,
    failure,
    queriedAt: Date.now(),
    tiers: [],
  };
}

async function queryOfficialSubscription(provider) {
  if (provider.tool === "codex") {
    const credentials = readCodexCredentials(provider);
    if (credentials.status !== "valid" && !credentials.accessToken) {
      return subscriptionError("codex", credentials.status, credentials.message);
    }
    const result = await queryCodexQuota(credentials.accessToken, credentials.accountId, "codex");
    // A successful quota response is authoritative. Do not surface a stale local
    // expiry hint after the token has been accepted by the Codex API.
    if (result.success && credentials.status === "valid" && credentials.message) {
      result.credentialMessage = credentials.message;
    }
    return result;
  }

  if (provider.tool === "claude") {
    const credentials = readClaudeCredentials(provider);
    if (credentials.status !== "valid" && !credentials.accessToken) {
      return subscriptionError("claude", credentials.status, credentials.message);
    }
    return queryClaudeQuota(credentials.accessToken);
  }

  if (provider.tool === "grok") {
    const credentials = readGrokCredentials(provider);
    return queryGrokQuota(credentials);
  }

  return subscriptionError(provider.tool || provider.id, "not_found", "不支持的官方工具");
}

function isRedactedSecret(value) {
  const text = String(value || "");
  // Renderer uses SECRET_MASK "••••••••••••" (U+2022). Never send that as a real token.
  return !text || text.includes("\u2022") || text === "********" || /^•+$/u.test(text);
}

function readCodexCredentials(provider) {
  if (provider.accessToken) {
    if (isRedactedSecret(provider.accessToken)) {
      return {
        accessToken: null,
        accountId: provider.accountId || null,
        status: "missing",
        message: "token 已脱敏，请从本机配置重新读取",
      };
    }
    const expired = provider.expiresAt ? isExpired(provider.expiresAt) : false;
    const label = provider.accountEmail || provider.planType || null;
    return {
      accessToken: provider.accessToken,
      accountId: provider.accountId || null,
      status: expired ? "expired" : "valid",
      message: expired ? "导入的 OpenAI OAuth token 已过期" : label,
    };
  }

  const authPath = provider.authPath || path.join(os.homedir(), ".codex", "auth.json");
  if (!fs.existsSync(authPath)) {
    return { accessToken: null, accountId: null, status: "not_found", message: null };
  }

  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (auth.auth_mode !== "chatgpt") {
      return {
        accessToken: null,
        accountId: null,
        status: "not_found",
        message: "Codex 当前不是 ChatGPT 登录模式",
      };
    }
    const accessToken = auth.tokens?.access_token;
    if (!accessToken) {
      return {
        accessToken: null,
        accountId: null,
        status: "parse_error",
        message: "缺少 Codex access_token",
      };
    }
    return {
      accessToken,
      accountId: auth.tokens?.account_id || null,
      // Codex's last_refresh is not the access token expiry time. The usage
      // endpoint response, including HTTP 401/403, is the source of truth.
      status: "valid",
      message: null,
    };
  } catch (error) {
    return { accessToken: null, accountId: null, status: "parse_error", message: error.message };
  }
}

function readClaudeCredentials(provider) {
  if (provider.accessToken) {
    if (isRedactedSecret(provider.accessToken)) {
      return { accessToken: null, status: "missing", message: "token 已脱敏，请从本机配置重新读取" };
    }
    const expired = provider.expiresAt ? isExpired(provider.expiresAt) : false;
    return {
      accessToken: expired ? null : provider.accessToken,
      status: expired ? "expired" : "valid",
      message: expired ? "导入的 Claude OAuth token 已过期" : provider.accountEmail || null,
    };
  }

  const credPath = provider.credentialsPath || path.join(os.homedir(), ".claude", ".credentials.json");
  if (!fs.existsSync(credPath)) {
    return { accessToken: null, status: "not_found", message: null };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(credPath, "utf8"));
    const entry = parsed.claudeAiOauth || parsed["claude.ai_oauth"];
    if (!entry?.accessToken) {
      return {
        accessToken: null,
        status: "parse_error",
        message: "缺少 Claude accessToken",
      };
    }
    const expired = entry.expiresAt ? isExpired(entry.expiresAt) : false;
    return {
      accessToken: entry.accessToken,
      status: expired ? "expired" : "valid",
      message: expired ? "Claude OAuth token 已过期" : null,
    };
  } catch (error) {
    return { accessToken: null, status: "parse_error", message: error.message };
  }
}

function readGrokCredentials(provider) {
  if (provider.accessToken) {
    const expired = provider.expiresAt ? isExpired(provider.expiresAt) : false;
    return {
      accessToken: provider.accessToken,
      status: expired ? "expired" : "valid",
      message: expired ? "Grok token 已过期" : provider.accountEmail || null,
    };
  }

  const authPath = provider.authPath || path.join(os.homedir(), ".grok", "auth.json");
  if (!fs.existsSync(authPath)) {
    return { accessToken: null, status: "not_found", message: null };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const entries = Object.entries(parsed || {}).filter(([, entry]) => entry && typeof entry === "object");
    const [entryKey, entry] = entries.find(([, item]) => item.key) || entries[0] || [];
    if (!entry?.key && !entry?.refresh_token) {
      return {
        accessToken: null,
        status: "parse_error",
        message: "缺少 Grok Build 授权 key",
      };
    }
    const expired = entry.expires_at ? isExpired(entry.expires_at) : false;
    return {
      accessToken: entry.key || null,
      refreshToken: entry.refresh_token || null,
      clientId: entry.oidc_client_id || null,
      issuer: entry.oidc_issuer || "https://auth.x.ai",
      authPath,
      authDocument: parsed,
      authEntryKey: entryKey,
      status: expired && !entry.refresh_token ? "expired" : "valid",
      shouldRefresh: expired,
      message: entry.email || null,
      accountEmail: entry.email || null,
      loginMethod: grokLoginMethod(entry, entryKey),
    };
  } catch (error) {
    return { accessToken: null, status: "parse_error", message: error.message };
  }
}

async function queryClaudeQuota(accessToken) {
  const response = await fetchJson("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    return subscriptionError("claude", "expired", `Authentication failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    return subscriptionError("claude", "valid", `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}`);
  }

  const known = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];
  const tiers = [];
  for (const key of Object.keys(response.json || {})) {
    if (key === "extra_usage") continue;
    const value = response.json[key];
    if (value && typeof value === "object" && typeof value.utilization === "number") {
      tiers.push({
        name: known.includes(key) ? key : key,
        utilization: value.utilization,
        resetsAt: value.resets_at || null,
      });
    }
  }

  return {
    tool: "claude",
    credentialStatus: "valid",
    credentialMessage: null,
    success: true,
    tiers,
    extraUsage: camelExtraUsage(response.json?.extra_usage),
    error: null,
    queriedAt: Date.now(),
  };
}

async function queryGrokQuota(credentials, options = {}) {
  const diagnostics = { source: null, fallbacks: [] };
  if (!options.skipCli) {
    try {
      const rpcBilling = await (options.rpcFetcher || fetchGrokBillingViaCli)();
      diagnostics.source = "grok-cli";
      return normalizeGrokBilling(rpcBilling, credentials, diagnostics);
    } catch (error) {
      diagnostics.fallbacks.push({ source: "grok-cli", error: safeResponseExcerpt(error.message) });
    }
  }

  let accessToken = credentials.accessToken;
  if (credentials.shouldRefresh) {
    const refreshed = await refreshGrokToken(credentials);
    if (refreshed.success) accessToken = refreshed.accessToken;
    else if (!accessToken) return subscriptionError("grok", "expired", refreshed.error);
  }

  if (accessToken && !options.skipWeb) {
    try {
      const webBilling = await (options.webFetcher || fetchGrokWebBilling)(accessToken);
      diagnostics.source = "grok-web";
      return normalizeGrokBilling(webBilling, credentials, diagnostics);
    } catch (error) {
      diagnostics.fallbacks.push({ source: "grok-web", error: safeResponseExcerpt(error.message) });
    }
  }

  if (!accessToken) {
    return subscriptionError(
      "grok",
      credentials.status || "not_found",
      credentials.message || "未找到 Grok 登录授权，请安装 Grok Build CLI 并运行 grok login",
      null,
      diagnostics,
    );
  }

  let response = await fetchGrokBilling(accessToken);
  if ((response.status === 401 || response.status === 403) && credentials.refreshToken) {
    const refreshed = await refreshGrokToken(credentials);
    if (refreshed.success) {
      accessToken = refreshed.accessToken;
      response = await fetchGrokBilling(accessToken);
    }
  }

  if (response.status === 401 || response.status === 403) {
    return subscriptionError("grok", "expired", `Authentication failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    return subscriptionError(
      "grok",
      "valid",
      `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}`,
      response.status,
      diagnostics,
    );
  }

  const config = response.json?.config || response.json || {};
  diagnostics.source = "grok-json";
  return normalizeGrokBilling(config, credentials, diagnostics);
}

function fetchGrokBilling(accessToken) {
  return fetchJson("https://cli-chat-proxy.grok.com/v1/billing?format=credits", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-XAI-Token-Auth": "xai-grok-cli",
      Accept: "application/json",
      "User-Agent": "grok-cli",
    },
  });
}

async function refreshGrokToken(credentials) {
  if (!credentials.refreshToken || !credentials.clientId) {
    return { success: false, error: "Grok Build 授权已过期，请重新登录 Grok Build" };
  }
  const response = await fetchJson(`${String(credentials.issuer || "https://auth.x.ai").replace(/\/$/, "")}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "grok-cli",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
    }).toString(),
  });
  if (!response.ok) {
    return { success: false, error: `Grok token 刷新失败 (HTTP ${response.status})` };
  }
  const accessToken = response.json?.access_token;
  if (!accessToken) return { success: false, error: "Grok token 刷新响应缺少 access_token" };
  persistGrokToken(credentials, response.json);
  return { success: true, accessToken };
}

function persistGrokToken(credentials, token) {
  if (!credentials.authPath || !credentials.authDocument || !credentials.authEntryKey) return;
  const entry = credentials.authDocument[credentials.authEntryKey];
  if (!entry || typeof entry !== "object") return;
  entry.key = token.access_token;
  if (token.refresh_token) entry.refresh_token = token.refresh_token;
  const expiresIn = Number(token.expires_in || 0);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    entry.expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  writeJsonFileAtomic(credentials.authPath, credentials.authDocument);
}

function writeJsonFileAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fs.openSync(tempPath, "wx");
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_cleanupError) {
      // Preserve the original write failure.
    }
    throw error;
  }
}

async function queryCodexQuota(accessToken, accountId, tool = "codex") {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "codex-cli",
    Accept: "application/json",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  const response = await fetchJson("https://chatgpt.com/backend-api/wham/usage", { headers });
  if (response.status === 401 || response.status === 403) {
    return subscriptionError(tool, "expired", `Authentication failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    return subscriptionError(tool, "valid", `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}`);
  }

  const windows = [
    response.json?.rate_limit?.primary_window,
    response.json?.rate_limit?.secondary_window,
  ].filter(Boolean);
  const tiers = windows
    .filter((window) => typeof window.used_percent === "number")
    .map((window) => ({
      name: windowSecondsToTierName(window.limit_window_seconds),
      utilization: window.used_percent,
      resetsAt: window.reset_at ? new Date(window.reset_at * 1000).toISOString() : null,
    }));

  const resetCreditsRaw = response.json?.rate_limit_reset_credits;
  const resetCreditsAvailable = Number(resetCreditsRaw?.available_count);
  const resetCredits =
    resetCreditsRaw && Number.isFinite(resetCreditsAvailable) && resetCreditsAvailable >= 0
      ? { available: resetCreditsAvailable }
      : null;

  return {
    tool,
    credentialStatus: "valid",
    credentialMessage: null,
    success: true,
    tiers,
    extraUsage: null,
    resetCredits,
    error: null,
    queriedAt: Date.now(),
  };
}

async function queryCodingPlan(provider) {
  const apiKey = resolveApiKey(provider);
  if (!apiKey) return subscriptionError("coding_plan", "not_found", "缺少 API Key");

  const detected = detectCodingPlanProvider(provider.baseUrl || "");
  if (detected === "kimi") return queryKimiCoding(apiKey);
  if (detected === "zhipu") return queryZhipuCoding(provider.baseUrl || "", apiKey);
  if (detected === "minimax-cn") return queryMiniMaxCoding(apiKey, true);
  if (detected === "minimax-en") return queryMiniMaxCoding(apiKey, false);
  if (detected === "zenmux") return queryZenMux(provider.baseUrl, apiKey);

  return subscriptionError("coding_plan", "not_found", "无法识别的 Coding Plan 供应商");
}

function detectCodingPlanProvider(baseUrl) {
  const url = baseUrl.toLowerCase();
  if (url.includes("api.kimi.com/coding")) return "kimi";
  if (url.includes("open.bigmodel.cn") || url.includes("bigmodel.cn")) return "zhipu";
  if (url.includes("api.z.ai")) return "zhipu";
  if (url.includes("api.minimaxi.com")) return "minimax-cn";
  if (url.includes("api.minimax.io")) return "minimax-en";
  if (url.includes("zenmux")) return "zenmux";
  return null;
}

async function queryKimiCoding(apiKey) {
  const response = await fetchJson("https://api.kimi.com/coding/v1/usages", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (response.status === 401 || response.status === 403) {
    return subscriptionError("coding_plan", "expired", `Authentication failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    return subscriptionError("coding_plan", "valid", `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}`);
  }

  const tiers = [];
  for (const limitItem of response.json?.limits || []) {
    const detail = limitItem.detail;
    if (!detail) continue;
    const limit = parseNumber(detail.limit, 1);
    const remaining = parseNumber(detail.remaining, 0);
    tiers.push({
      name: "five_hour",
      utilization: limit > 0 ? ((limit - remaining) / limit) * 100 : 0,
      resetsAt: extractResetTime(detail.resetTime),
    });
  }

  const usage = response.json?.usage;
  if (usage) {
    const limit = parseNumber(usage.limit, 1);
    const remaining = parseNumber(usage.remaining, 0);
    tiers.push({
      name: "weekly_limit",
      utilization: limit > 0 ? ((limit - remaining) / limit) * 100 : 0,
      resetsAt: extractResetTime(usage.resetTime),
    });
  }

  return okSubscription("coding_plan", tiers, null);
}

async function queryZhipuCoding(baseUrl, apiKey) {
  const quotaBase = baseUrl.toLowerCase().includes("bigmodel.cn")
    ? "https://open.bigmodel.cn"
    : "https://api.z.ai";
  // Fire the 24h usage-history request concurrently with the quota request so
  // the extra detail never adds latency; failures degrade to no chart.
  const usageHistoryPromise = fetchZhipuUsageHistory(quotaBase, apiKey);
  const response = await fetchJson(`${quotaBase}/api/monitor/usage/quota/limit`, {
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      "Accept-Language": "en-US,en",
    },
    timeoutMs: 8000,
    retries: 2,
    retryBaseDelayMs: 180,
  });
  const diagnostics = {
    endpoint: `${quotaBase}/api/monitor/usage/quota/limit`,
    attempts: response.attempts || 1,
    durationMs: response.durationMs || null,
    httpStatus: response.status,
  };

  if (response.status === 401 || response.status === 403) {
    return subscriptionError("coding_plan", "expired", `Authentication failed (HTTP ${response.status})`, response.status, diagnostics);
  }
  if (!response.ok) {
    return subscriptionError(
      "coding_plan",
      "valid",
      `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}`,
      response.status,
      diagnostics,
    );
  }
  if (response.json?.success === false) {
    return subscriptionError("coding_plan", "valid", response.json?.msg || "API error", response.status, diagnostics);
  }

  const data = response.json?.data;
  if (!data) return subscriptionError("coding_plan", "parse_error", "响应缺少 data 字段", response.status, diagnostics);
  const tiers = parseZhipuTokenTiers(data);
  if (!tiers.length) {
    return subscriptionError("coding_plan", "parse_error", "响应中没有可识别的 GLM 额度档位", response.status, diagnostics);
  }
  const usageHistory = await usageHistoryPromise.catch(() => null);
  return okSubscription("coding_plan", tiers, data.level || null, diagnostics, {
    usageHistory,
    mcpQuota: parseZhipuMcpQuota(data),
  });
}

async function fetchZhipuUsageHistory(quotaBase, apiKey) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 1);
  start.setMinutes(0, 0, 0);
  const end = new Date(now);
  end.setMinutes(59, 59, 999);
  const format = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ` +
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
  const query = `?startTime=${encodeURIComponent(format(start))}&endTime=${encodeURIComponent(format(end))}`;
  const response = await fetchJson(`${quotaBase}/api/monitor/usage/model-usage${query}`, {
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      "Accept-Language": "en-US,en",
    },
    timeoutMs: 8000,
    retries: 1,
    retryBaseDelayMs: 200,
  });
  if (!response.ok || response.json?.success === false) return null;
  return parseZhipuUsageHistory(response.json);
}

function parseZhipuUsageHistory(json) {
  const data = json?.data;
  if (!Array.isArray(data?.x_time) || !Array.isArray(data?.modelCallCount)) return null;
  const points = data.x_time
    .map((time, index) => ({
      hour: String(time || "").split(" ")[1]?.split(":")[0] || "",
      calls: parseNumber(data.modelCallCount[index], 0),
    }))
    .slice(-24);
  if (!points.length) return null;
  while (points.length < 24) points.unshift({ hour: "", calls: 0 });
  return {
    hourly: points,
    todayCalls: parseNumber(data.totalUsage?.totalModelCallCount, 0),
    todayTokens: parseNumber(data.totalUsage?.totalTokensUsage, 0),
  };
}

function parseZhipuMcpQuota(data) {
  const entry = (data?.limits || []).find((item) => String(item.type || "").toLowerCase() === "time_limit");
  if (!entry) return null;
  const used = parseNumber(entry.currentValue, 0);
  const total = parseNumber(entry.usage, 0);
  if (total <= 0) return null;
  return {
    used,
    total,
    utilization: clamp((used / total) * 100, 0, 100),
    resetsAt: extractResetTime(entry.nextResetTime),
  };
}

async function queryMiniMaxCoding(apiKey, isCn) {
  const domain = isCn ? "api.minimaxi.com" : "api.minimax.io";
  const response = await fetchJson(`https://${domain}/v1/api/openplatform/coding_plan/remains`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    return subscriptionError("coding_plan", "expired", `Authentication failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    return subscriptionError("coding_plan", "valid", `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}`);
  }

  const baseResp = response.json?.base_resp;
  if (baseResp && baseResp.status_code !== 0) {
    return subscriptionError(
      "coding_plan",
      "valid",
      `API error (${baseResp.status_code}): ${baseResp.status_msg || "Unknown error"}`,
    );
  }

  return okSubscription("coding_plan", parseMiniMaxTiers(response.json), null);
}

async function queryZenMux(baseUrl, apiKey) {
  const response = await fetchJson(baseUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (response.status === 401 || response.status === 403) {
    return subscriptionError("coding_plan", "expired", `Authentication failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    return subscriptionError("coding_plan", "valid", `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}`);
  }
  if (response.json?.success !== true) {
    return subscriptionError("coding_plan", "valid", response.json?.message || "API error");
  }

  const data = response.json.data || {};
  const tiers = [];
  if (data.quota_5_hour) {
    tiers.push(zenMuxTier("five_hour", data.quota_5_hour));
  }
  if (data.quota_7_day) {
    tiers.push(zenMuxTier("weekly_limit", data.quota_7_day));
  }
  const plan = data.plan?.tier ? `${data.plan.tier} (${data.account_status || "active"})` : null;
  return okSubscription("coding_plan", tiers, plan);
}

async function queryBalance(provider) {
  const apiKey = resolveApiKey(provider);
  if (!apiKey) return { success: false, data: null, error: "缺少 API Key" };
  if (!provider.baseUrl) return { success: false, data: null, error: "缺少请求地址" };

  const detected = detectBalanceProvider(provider.baseUrl || "");
  if (detected === "deepseek") return queryDeepSeekBalance(apiKey);
  if (detected === "moonshot") return queryMoonshotBalance(provider.baseUrl, apiKey);
  if (detected === "openrouter") return queryOpenRouterBalance(apiKey);
  if (detected === "siliconflow-cn") return querySiliconFlowBalance(apiKey, true);
  if (detected === "siliconflow-en") return querySiliconFlowBalance(apiKey, false);

  return queryGenericBalance(provider.baseUrl, apiKey);
}

function detectBalanceProvider(baseUrl) {
  const url = baseUrl.toLowerCase();
  if (url.includes("api.deepseek.com")) return "deepseek";
  if (url.includes("api.moonshot.ai") || url.includes("api.moonshot.cn")) return "moonshot";
  if (url.includes("openrouter.ai")) return "openrouter";
  if (url.includes("api.siliconflow.cn")) return "siliconflow-cn";
  if (url.includes("api.siliconflow.com")) return "siliconflow-en";
  return null;
}

async function queryDeepSeekBalance(apiKey) {
  const response = await fetchJson("https://api.deepseek.com/user/balance", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return { success: false, data: null, error: `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}` };

  const isAvailable = response.json?.is_available !== false;
  const data = (response.json?.balance_infos || []).map((info) => ({
    planName: info.currency || "Balance",
    remaining: parseNumber(info.total_balance, 0),
    total: null,
    used: null,
    unit: info.currency || "CNY",
    isValid: isAvailable,
    invalidMessage: isAvailable ? null : "余额不足",
    extra: {
      grantedBalance: parseNumber(info.granted_balance, 0),
      toppedUpBalance: parseNumber(info.topped_up_balance, 0),
    },
  }));
  return { success: true, data, error: null };
}

async function queryMoonshotBalance(baseUrl, apiKey) {
  const root = baseUrl.toLowerCase().includes("moonshot.cn")
    ? "https://api.moonshot.cn"
    : "https://api.moonshot.ai";
  const response = await fetchJson(`${root}/v1/users/me/balance`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return { success: false, data: null, error: `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}` };

  const data = response.json?.data || response.json || {};
  const available = parseNumber(data.available_balance ?? data.balance, 0);
  return {
    success: true,
    data: [
      {
        planName: "Kimi API",
        remaining: available,
        total: null,
        used: null,
        unit: "CNY",
        isValid: available > 0,
        invalidMessage: available > 0 ? null : "余额不足",
        extra: data,
      },
    ],
    error: null,
  };
}

async function queryOpenRouterBalance(apiKey) {
  const response = await fetchJson("https://openrouter.ai/api/v1/credits", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return { success: false, data: null, error: `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}` };
  const data = response.json?.data || response.json || {};
  const total = parseNumber(data.total_credits, 0);
  const used = parseNumber(data.total_usage, 0);
  return {
    success: true,
    data: [
      {
        planName: "OpenRouter",
        remaining: total - used,
        total,
        used,
        unit: "USD",
        isValid: total - used > 0,
        invalidMessage: total - used > 0 ? null : "余额不足",
      },
    ],
    error: null,
  };
}

async function querySiliconFlowBalance(apiKey, isCn) {
  const domain = isCn ? "api.siliconflow.cn" : "api.siliconflow.com";
  const response = await fetchJson(`https://${domain}/v1/user/info`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return { success: false, data: null, error: `API error (HTTP ${response.status}): ${safeResponseExcerpt(response.text)}` };
  const data = response.json?.data || {};
  const total = parseNumber(data.totalBalance, 0);
  return {
    success: true,
    data: [
      {
        planName: isCn ? "SiliconFlow" : "SiliconFlow EN",
        remaining: total,
        total: null,
        used: null,
        unit: isCn ? "CNY" : "USD",
        isValid: total > 0,
        invalidMessage: total > 0 ? null : "余额不足",
      },
    ],
    error: null,
  };
}

async function queryGenericBalance(baseUrl, apiKey) {
  const urls = genericBalanceUrls(baseUrl);
  const errors = [];

  for (const url of urls) {
    const response = await fetchJson(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      errors.push(`${url} HTTP ${response.status}`);
      continue;
    }

    const parsed = parseGenericBalanceResponse(response.json);
    if (!parsed) {
      errors.push(`${url} 响应缺少 remaining/balance/quota 字段`);
      continue;
    }
    return { success: true, data: [parsed], error: null };
  }

  return {
    success: false,
    data: null,
    error: errors.length ? `通用余额查询失败：${errors.join("；")}` : "通用余额查询失败",
  };
}

function genericBalanceUrls(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return [];

  const urls = [];
  if (/\/v1\/usage$/i.test(trimmed) || /\/usage$/i.test(trimmed)) urls.push(trimmed);
  else urls.push(`${trimmed}/v1/usage`, `${trimmed}/usage`);
  urls.push(trimmed);
  return Array.from(new Set(urls));
}

function parseGenericBalanceResponse(body) {
  const source = body?.data && typeof body.data === "object" ? body.data : body;
  const remaining = firstNumber([
    source?.remaining,
    source?.balance,
    source?.available_balance,
    source?.availableBalance,
    source?.credit,
    source?.credits,
    source?.quota?.remaining,
    source?.quota?.balance,
    body?.quota?.remaining,
    body?.quota?.balance,
  ]);
  if (remaining == null) return null;

  const total = firstNumber([
    source?.total,
    source?.total_balance,
    source?.totalBalance,
    source?.quota?.total,
    body?.quota?.total,
  ]);
  const used = firstNumber([
    source?.used,
    source?.used_balance,
    source?.usedBalance,
    source?.usage,
    source?.quota?.used,
    body?.quota?.used,
  ]);
  const unit = String(
    source?.unit ||
      source?.currency ||
      source?.quota?.unit ||
      body?.unit ||
      body?.currency ||
      body?.quota?.unit ||
      "USD",
  ).toUpperCase();

  return {
    planName: source?.planName || source?.plan_name || source?.name || "通用余额",
    remaining,
    total,
    used,
    unit,
    isValid: source?.is_active ?? source?.isActive ?? source?.isValid ?? remaining > 0,
    invalidMessage: remaining > 0 ? null : "余额不足",
    extra: body,
  };
}

function parseBalanceUsage(body, unit = "USD") {
  const source = body?.data && typeof body.data === "object" ? body.data : body;
  const today = source?.usage?.today || body?.usage?.today;
  if (!today || typeof today !== "object") return null;

  const requests = firstNumber([today.requests, today.request_count, today.requestCount]);
  const inputTokens = firstNumber([today.input_tokens, today.inputTokens]) || 0;
  const outputTokens = firstNumber([today.output_tokens, today.outputTokens]) || 0;
  const cacheReadTokens = firstNumber([today.cache_read_tokens, today.cacheReadTokens]) || 0;
  const cacheCreationTokens = firstNumber([
    today.cache_creation_tokens,
    today.cache_write_tokens,
    today.cacheCreationTokens,
  ]) || 0;
  const totalTokens = firstNumber([today.total_tokens, today.totalTokens]) ??
    inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  const costUsd = firstNumber([today.actual_cost, today.account_cost, today.actualCost, today.cost]);

  if (requests == null && totalTokens === 0 && costUsd == null) return null;
  return {
    scope: "今日",
    requests: Math.max(0, requests || 0),
    totalTokens: Math.max(0, totalTokens),
    costUsd: costUsd == null ? null : Math.max(0, costUsd),
    partialCost: false,
    estimated: false,
    source: "provider",
    currency: String(unit || "USD").toUpperCase(),
  };
}

function firstNumber(values) {
  for (const value of values) {
    const parsed = parseNumber(value, null);
    if (parsed != null) return parsed;
  }
  return null;
}

function parseZhipuTokenTiers(data) {
  let fiveHour = null;
  let weekly = null;
  const unclassified = [];

  for (const item of data.limits || []) {
    if (String(item.type || "").toLowerCase() !== "tokens_limit") continue;

    const resetsAt = extractResetTime(item.nextResetTime);
    const entry = {
      resetMs: resetsAt ? Date.parse(resetsAt) : null,
      utilization: clamp(parseNumber(item.percentage, 0), 0, 100),
      resetsAt,
    };
    const unit = parseNumber(item.unit, null);

    if (unit === 3 && !fiveHour) fiveHour = entry;
    else if (unit === 6 && !weekly) weekly = entry;
    else unclassified.push(entry);
  }

  unclassified.sort((a, b) => {
    if (a.resetMs == null && b.resetMs != null) return -1;
    if (a.resetMs != null && b.resetMs == null) return 1;
    return (a.resetMs ?? Number.MIN_SAFE_INTEGER) - (b.resetMs ?? Number.MIN_SAFE_INTEGER);
  });

  for (const entry of unclassified) {
    if (!fiveHour) fiveHour = entry;
    else if (!weekly) weekly = entry;
  }

  const tiers = [];
  if (fiveHour) tiers.push({ name: "five_hour", utilization: fiveHour.utilization, resetsAt: fiveHour.resetsAt });
  if (weekly) tiers.push({ name: "weekly_limit", utilization: weekly.utilization, resetsAt: weekly.resetsAt });
  return tiers;
}

function parseMiniMaxTiers(body) {
  const item = (body?.model_remains || []).find((entry) => entry.model_name === "general");
  if (!item) return [];

  const tiers = [];
  if (typeof item.current_interval_remaining_percent === "number") {
    tiers.push({
      name: "five_hour",
      utilization: 100 - item.current_interval_remaining_percent,
      resetsAt: typeof item.end_time === "number" ? millisToIso(item.end_time) : null,
    });
  }
  if (item.current_weekly_status === 1 && typeof item.current_weekly_remaining_percent === "number") {
    tiers.push({
      name: "weekly_limit",
      utilization: 100 - item.current_weekly_remaining_percent,
      resetsAt: typeof item.weekly_end_time === "number" ? millisToIso(item.weekly_end_time) : null,
    });
  }
  return tiers;
}

function zenMuxTier(name, value) {
  return {
    name,
    utilization: parseNumber(value.usage_percentage, 0) * 100,
    resetsAt: value.resets_at || null,
    usedValueUsd: value.used_value_usd ?? null,
    maxValueUsd: value.max_value_usd ?? null,
  };
}

async function fetchJson(url, options = {}) {
  const {
    timeoutMs = 10000,
    retryBaseDelayMs = 250,
    maxResponseBytes = 2 * 1024 * 1024,
    ...requestOptions
  } = options;
  const retries = Number.isFinite(Number(options.retries))
    ? Math.max(0, Number(options.retries))
    : isIdempotentMethod(requestOptions.method) ? 1 : 0;
  delete requestOptions.retries;
  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const response = await fetchJsonOnce(url, requestOptions, timeoutMs, maxResponseBytes);
      response.attempts = attempt;
      response.durationMs = Date.now() - startedAt;
      if (!isRetryableStatus(response.status) || attempt > retries) return response;
      await delay(retryDelayMs(response, attempt, retryBaseDelayMs));
    } catch (error) {
      lastError = error;
      if (attempt > retries) break;
      await delay(retryDelayMs(null, attempt, retryBaseDelayMs));
    }
  }

  const attempts = retries + 1;
  const elapsed = Date.now() - startedAt;
  const reason = lastError?.name === "AbortError" ? "请求超时" : safeResponseExcerpt(lastError?.message || "网络异常");
  const error = new Error(`请求 ${safeRequestTarget(url)} 失败（尝试 ${attempts} 次，${elapsed}ms）：${reason}`);
  error.cause = lastError;
  error.attempts = attempts;
  throw error;
}

async function fetchJsonOnce(url, options, timeoutMs, maxResponseBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await appFetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await readResponseText(response, maxResponseBytes, controller);
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return { ok: response.ok, status: response.status, text, json, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseText(response, maxBytes, controller) {
  const limit = Math.max(1024, Number(maxBytes) || 2 * 1024 * 1024);
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > limit) {
    controller.abort();
    throw new Error(`响应体超过限制（${Math.ceil(limit / 1024)} KB）`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > limit) throw new Error(`响应体超过限制（${Math.ceil(limit / 1024)} KB）`);
    return text;
  }
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      controller.abort();
      throw new Error(`响应体超过限制（${Math.ceil(limit / 1024)} KB）`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isIdempotentMethod(method) {
  return ["GET", "HEAD"].includes(String(method || "GET").toUpperCase());
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function retryDelayMs(response, attempt, baseDelay) {
  const retryAfter = response?.headers?.get?.("retry-after");
  const retryAfterSeconds = parseNumber(retryAfter, null);
  if (retryAfterSeconds != null) return Math.min(5000, Math.max(0, retryAfterSeconds * 1000));
  const exponential = Math.max(0, Number(baseDelay || 0)) * 2 ** Math.max(0, attempt - 1);
  return Math.min(5000, exponential + Math.floor(Math.random() * Math.max(25, exponential * 0.25)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRequestTarget(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.host}${parsed.pathname}`;
  } catch (_error) {
    return "远程接口";
  }
}

function safeResponseExcerpt(value) {
  return (
    String(value || "")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "sk-[REDACTED]")
      .replace(/\beyJ[a-zA-Z0-9._-]{20,}\b/g, "[REDACTED_TOKEN]")
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || "空响应"
  );
}

function resolveApiKey(provider) {
  if (provider.apiKey) return provider.apiKey;
  const names = Array.isArray(provider.apiKeyEnv)
    ? provider.apiKeyEnv
    : provider.apiKeyEnv
      ? [provider.apiKeyEnv]
      : [];
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

function subscriptionError(tool, status, message, httpStatus = null, diagnostics = null) {
  return {
    tool,
    credentialStatus: status || "valid",
    credentialMessage: message || null,
    success: false,
    tiers: [],
    extraUsage: null,
    error: message || null,
    httpStatus,
    diagnostics,
    queriedAt: Date.now(),
  };
}

function okSubscription(tool, tiers, credentialMessage, diagnostics = null, extras = {}) {
  return {
    tool,
    credentialStatus: "valid",
    credentialMessage,
    success: true,
    tiers,
    extraUsage: null,
    usageHistory: extras.usageHistory || null,
    mcpQuota: extras.mcpQuota || null,
    error: null,
    diagnostics,
    queriedAt: Date.now(),
  };
}

function parseGrokExtraUsage(config) {
  const usage = config.usage || {};
  const enabled = config.onDemandEnabled ?? config.on_demand_enabled ?? config.isUnifiedBillingUser;
  return {
    isEnabled: Boolean(enabled),
    monthlyLimit: centsToUsd(firstNumber([config.onDemandCap?.val, config.on_demand_cap?.val])),
    usedCredits: centsToUsd(firstNumber([usage.onDemandUsed?.val, config.onDemandUsed?.val])),
    utilization: percentOf(
      firstNumber([usage.onDemandUsed?.val, config.onDemandUsed?.val]),
      firstNumber([config.onDemandCap?.val, config.on_demand_cap?.val]),
    ),
    currency: "USD",
    prepaidBalance: centsToUsd(firstNumber([config.prepaidBalance?.val])),
  };
}

function normalizeGrokBilling(config, credentials = {}, diagnostics = null) {
  const source = config?.config || config || {};
  const usage = source.usage || {};
  const periodStart = source.billingCycle?.billingPeriodStart || source.currentPeriod?.start || source.billingPeriodStart || null;
  const periodEnd = source.billingCycle?.billingPeriodEnd || source.currentPeriod?.end || source.billingPeriodEnd || null;
  const monthlyLimitCents = firstNumber([source.monthlyLimit?.val, source.monthly_limit?.val]);
  const totalUsedCents = firstNumber([usage.totalUsed?.val, usage.total_used?.val, source.totalUsed?.val]);
  const weeklyUtilization = firstNumber([source.limitUsagePercent, source.weeklyUsagePercent]);
  const buildUtilization = firstNumber([source.creditUsagePercent, source.usagePercent]);
  const monthlyUtilization = percentOf(totalUsedCents, monthlyLimitCents);
  const tiers = [];

  if (weeklyUtilization != null) {
    tiers.push({ name: "grok_limit", utilization: weeklyUtilization, resetsAt: periodEnd });
  }
  if (buildUtilization != null) {
    tiers.push({ name: "grok_build", utilization: buildUtilization, resetsAt: periodEnd });
  }
  if (monthlyUtilization != null) {
    tiers.push({
      name: "grok_monthly_credits",
      utilization: monthlyUtilization,
      resetsAt: periodEnd,
      usedValueUsd: centsToUsd(totalUsedCents),
      maxValueUsd: centsToUsd(monthlyLimitCents),
    });
  }
  if (!tiers.length && source.creditUsagePercent != null) {
    tiers.push({ name: "weekly_limit", utilization: source.creditUsagePercent, resetsAt: periodEnd });
  }
  const periodEndMs = Date.parse(periodEnd || "");
  if (!tiers.length && source.currentPeriod && Number.isFinite(periodEndMs) && periodEndMs > Date.now()) {
    // The current Grok API omits creditUsagePercent when it is zero.
    tiers.push({ name: "grok_build", utilization: 0, resetsAt: periodEnd });
  }
  if (!tiers.length) {
    return subscriptionError("grok", "parse_error", "Grok billing 响应缺少可识别的额度字段", null, diagnostics);
  }

  const loginMethod = credentials.loginMethod || source.planName || source.plan || "Grok Build";
  return {
    tool: "grok",
    credentialStatus: "valid",
    credentialMessage: null,
    planLabel: loginMethod,
    success: true,
    tiers,
    extraUsage: parseGrokExtraUsage(source),
    billingDetails: {
      source: diagnostics?.source || source.source || "grok",
      periodStart,
      periodEnd,
      accountEmail: credentials.accountEmail || credentials.message || null,
    },
    diagnostics,
    error: null,
    queriedAt: Date.now(),
  };
}

function grokLoginMethod(entry, entryKey) {
  const raw = String(entry?.auth_mode || "").trim();
  if (/supergrok|oauth|oidc/i.test(raw) || /auth\.x\.ai/i.test(String(entryKey || ""))) return "SuperGrok";
  return raw || "Grok Build";
}

function centsToUsd(value) {
  return value == null ? null : Number(value) / 100;
}

function percentOf(used, limit) {
  if (used == null || limit == null || Number(limit) <= 0) return null;
  return clamp((Number(used) / Number(limit)) * 100, 0, 100);
}

function camelExtraUsage(extra) {
  if (!extra) return null;
  return {
    isEnabled: Boolean(extra.is_enabled),
    monthlyLimit: extra.monthly_limit ?? null,
    usedCredits: extra.used_credits ?? null,
    utilization: extra.utilization ?? null,
    currency: extra.currency ?? null,
  };
}

function windowSecondsToTierName(seconds) {
  if (seconds === 18000) return "five_hour";
  if (seconds === 604800) return "seven_day";
  if (!seconds) return "unknown";
  const hours = Math.floor(seconds / 3600);
  return hours >= 24 ? `${Math.floor(hours / 24)}_day` : `${hours}_hour`;
}

function extractResetTime(value) {
  if (typeof value === "string") {
    const numeric = parseNumber(value, null);
    if (numeric != null) return extractResetTime(numeric);
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  }
  if (typeof value === "number") return value < 1_000_000_000_000 ? new Date(value * 1000).toISOString() : millisToIso(value);
  return null;
}

function millisToIso(ms) {
  return new Date(ms).toISOString();
}

function parseNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isExpired(value) {
  let timestampMs = null;
  if (typeof value === "number") timestampMs = value > 1_000_000_000_000 ? value : value * 1000;
  if (typeof value === "string") timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) && timestampMs < Date.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function statusText(status) {
  return {
    ok: "可用",
    warn: "偏高",
    danger: "接近上限",
    error: "错误",
    expired: "已过期",
    missing: "缺少配置",
    manual: "手动",
  }[status] || status;
}

async function testCodexConnection(provider) {
  const testedAt = new Date().toISOString();
  const credentials = readCodexCredentials(provider);

  if (credentials.status !== "valid" && !credentials.accessToken) {
    const failure = classifyFailure(credentials.message || credentials.status, null);
    return {
      ok: false,
      stage: "credentials",
      httpStatus: null,
      latencyMs: 0,
      credentialStatus: credentials.status,
      tiers: [],
      resetCredits: null,
      failure,
      message: credentials.message || failure.label,
      testedAt,
    };
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await queryCodexQuota(credentials.accessToken, credentials.accountId, "codex");
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = String(error?.message || error);
    const failure = classifyFailure(message);
    return {
      ok: false,
      stage: "network",
      httpStatus: null,
      latencyMs,
      credentialStatus: "valid",
      tiers: [],
      resetCredits: null,
      failure,
      message,
      testedAt,
    };
  }
  const latencyMs = Date.now() - startedAt;

  if (result && result.success) {
    return {
      ok: true,
      stage: "parsed",
      httpStatus: 200,
      latencyMs,
      credentialStatus: result.credentialStatus || "valid",
      tiers: result.tiers || [],
      resetCredits: result.resetCredits || null,
      failure: null,
      message: null,
      testedAt,
    };
  }

  const message = (result && (result.error || result.credentialMessage)) || "查询失败";
  const httpStatus = (result && result.httpStatus) || null;
  const failure = classifyFailure(message, httpStatus);
  return {
    ok: false,
    stage: "http",
    httpStatus,
    latencyMs,
    credentialStatus: (result && result.credentialStatus) || "valid",
    tiers: [],
    resetCredits: null,
    failure,
    message,
    testedAt,
  };
}

module.exports = {
  loadConfig,
  normalizeProviderConfig,
  refreshProviders,
  parseZhipuTokenTiers,
  parseZhipuUsageHistory,
  parseZhipuMcpQuota,
  parseMiniMaxTiers,
  parseGenericBalanceResponse,
  parseBalanceUsage,
  windowSecondsToTierName,
  writeJsonFileAtomic,
  readCodexCredentials,
  readClaudeCredentials,
  queryGrokQuota,
  normalizeGrokBilling,
  queryZhipuCoding,
  testCodexConnection,
};
