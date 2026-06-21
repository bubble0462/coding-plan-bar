const fs = require("fs");
const os = require("os");
const path = require("path");
const { readConfigFile } = require("./config-store");

const TIER_LABELS = {
  five_hour: "5h",
  seven_day: "周额度",
  weekly_limit: "周额度",
  seven_day_opus: "Opus 周额度",
  seven_day_sonnet: "Sonnet 周额度",
  gemini_pro: "Gemini Pro",
  gemini_flash: "Gemini Flash",
  gemini_flash_lite: "Flash Lite",
};

function loadConfig(configPath) {
  return readConfigFile(configPath);
}

async function refreshProviders(config) {
  const enabled = config.providers.filter((provider) => provider.enabled !== false);
  return Promise.all(enabled.map((provider) => refreshProvider(provider)));
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
    statusText: statusText(status),
    message: quota.error || quota.credentialMessage || null,
    planLabel: quota.credentialMessage || null,
    queriedAt: quota.queriedAt || Date.now(),
    tiers,
    extraUsage: quota.extraUsage || null,
  };
}

function normalizeBalanceProvider(provider, result) {
  if (!result.success) {
    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      status: "error",
      statusText: "错误",
      message: result.error || "余额查询失败",
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
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    status: "error",
    statusText: "错误",
    message,
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
    return queryCodexQuota(credentials.accessToken, credentials.accountId, "codex");
  }

  if (provider.tool === "claude") {
    const credentials = readClaudeCredentials(provider);
    if (credentials.status !== "valid" && !credentials.accessToken) {
      return subscriptionError("claude", credentials.status, credentials.message);
    }
    return queryClaudeQuota(credentials.accessToken);
  }

  return subscriptionError(provider.tool || provider.id, "not_found", "不支持的官方工具");
}

function readCodexCredentials(provider) {
  if (provider.accessToken) {
    return {
      accessToken: provider.accessToken,
      accountId: provider.accountId || null,
      status: "valid",
      message: null,
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
    const stale = auth.last_refresh ? isOlderThanDays(auth.last_refresh, 8) : false;
    return {
      accessToken,
      accountId: auth.tokens?.account_id || null,
      status: stale ? "expired" : "valid",
      message: stale ? "Codex token 可能已过期" : null,
    };
  } catch (error) {
    return { accessToken: null, accountId: null, status: "parse_error", message: error.message };
  }
}

function readClaudeCredentials(provider) {
  if (provider.accessToken) {
    return { accessToken: provider.accessToken, status: "valid", message: null };
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
    return subscriptionError("claude", "valid", `API error (HTTP ${response.status}): ${response.text}`);
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
    return subscriptionError(tool, "valid", `API error (HTTP ${response.status}): ${response.text}`);
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

  return {
    tool,
    credentialStatus: "valid",
    credentialMessage: null,
    success: true,
    tiers,
    extraUsage: null,
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
    return subscriptionError("coding_plan", "valid", `API error (HTTP ${response.status}): ${response.text}`);
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
  const response = await fetchJson(`${quotaBase}/api/monitor/usage/quota/limit`, {
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      "Accept-Language": "en-US,en",
    },
  });

  if (response.status === 401 || response.status === 403) {
    return subscriptionError("coding_plan", "expired", `Authentication failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    return subscriptionError("coding_plan", "valid", `API error (HTTP ${response.status}): ${response.text}`);
  }
  if (response.json?.success === false) {
    return subscriptionError("coding_plan", "valid", response.json?.msg || "API error");
  }

  const data = response.json?.data;
  if (!data) return subscriptionError("coding_plan", "valid", "响应缺少 data 字段");
  return okSubscription("coding_plan", parseZhipuTokenTiers(data), data.level || null);
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
    return subscriptionError("coding_plan", "valid", `API error (HTTP ${response.status}): ${response.text}`);
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
    return subscriptionError("coding_plan", "valid", `API error (HTTP ${response.status}): ${response.text}`);
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
  if (!response.ok) return { success: false, data: null, error: `API error (HTTP ${response.status}): ${response.text}` };

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
  if (!response.ok) return { success: false, data: null, error: `API error (HTTP ${response.status}): ${response.text}` };

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
  if (!response.ok) return { success: false, data: null, error: `API error (HTTP ${response.status}): ${response.text}` };
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
  if (!response.ok) return { success: false, data: null, error: `API error (HTTP ${response.status}): ${response.text}` };
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

    const entry = {
      resetMs: typeof item.nextResetTime === "number" ? item.nextResetTime : null,
      utilization: typeof item.percentage === "number" ? item.percentage : 0,
      resetsAt: typeof item.nextResetTime === "number" ? millisToIso(item.nextResetTime) : null,
    };

    if (item.unit === 3 && !fiveHour) fiveHour = entry;
    else if (item.unit === 6 && !weekly) weekly = entry;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return { ok: response.ok, status: response.status, text, json };
  } finally {
    clearTimeout(timeout);
  }
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

function subscriptionError(tool, status, message) {
  return {
    tool,
    credentialStatus: status || "valid",
    credentialMessage: message || null,
    success: false,
    tiers: [],
    extraUsage: null,
    error: message || null,
    queriedAt: Date.now(),
  };
}

function okSubscription(tool, tiers, credentialMessage) {
  return {
    tool,
    credentialStatus: "valid",
    credentialMessage,
    success: true,
    tiers,
    extraUsage: null,
    error: null,
    queriedAt: Date.now(),
  };
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
  if (typeof value === "string") return value;
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

function isOlderThanDays(value, days) {
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) return false;
  return Date.now() - timestampMs > days * 24 * 60 * 60 * 1000;
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

module.exports = {
  loadConfig,
  refreshProviders,
  parseZhipuTokenTiers,
  parseMiniMaxTiers,
  parseGenericBalanceResponse,
  windowSecondsToTierName,
};
