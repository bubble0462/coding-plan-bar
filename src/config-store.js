const fs = require("fs");
const path = require("path");
const {
  createSecretCodec,
  protectConfigSecrets,
  revealConfigSecrets,
  redactConfigSecrets,
  mergeMaskedSecrets,
  hasPlaintextSecrets,
} = require("./secret-store");

let secretCodec = null;

function configureSecretStorage(safeStorage) {
  secretCodec = createSecretCodec(safeStorage);
  return Boolean(secretCodec);
}

function readConfigFile(configPath) {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return normalizeConfig(revealConfigSecrets(parsed, secretCodec));
}

function normalizeConfig(config) {
  return {
    refreshIntervalSeconds: Number(config.refreshIntervalSeconds || 300),
    showOnHover: config.showOnHover !== false,
    panelDensity: normalizePanelDensity(config.panelDensity),
    privacy: normalizePrivacy(config.privacy),
    autoUpdate: normalizeAutoUpdate(config.autoUpdate),
    importHistory: normalizeImportHistory(config.importHistory),
    providers: Array.isArray(config.providers) ? config.providers.map(normalizeProvider) : [],
  };
}

function normalizePanelDensity(value) {
  return value === "compact" ? "compact" : "comfortable";
}

function normalizePrivacy(privacy) {
  const value = privacy || {};
  return {
    suppressAdvancedJsonWarning: Boolean(value.suppressAdvancedJsonWarning),
    suppressBackupWarning: Boolean(value.suppressBackupWarning),
    suppressImportWarning: Boolean(value.suppressImportWarning),
  };
}

function normalizeImportHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(0, 20).map((entry) => ({
    id: String(entry.id || entry.importedAt || Date.now()),
    importedAt: entry.importedAt || new Date().toISOString(),
    sourceType: entry.sourceType || "file",
    sourceLabel: String(entry.sourceLabel || entry.fileName || "账号 JSON").slice(0, 180),
    format: entry.format || "accounts",
    accountCount: Number(entry.accountCount || 0),
    importedCount: Number(entry.importedCount || 0),
    updatedCount: Number(entry.updatedCount || 0),
    skippedCount: Number(entry.skippedCount || 0),
    identityMethods: Array.isArray(entry.identityMethods) ? entry.identityMethods.slice(0, 6).map(String) : [],
  }));
}

function normalizeAutoUpdate(autoUpdate) {
  const value = autoUpdate || {};
  return {
    // Check for a new version on app launch. Only notifies — never downloads
    // or installs without explicit user action.
    enabled: value.enabled !== false,
  };
}

function inferImportedFrom(importedFrom, importPath) {
  const fileName = path.basename(String(importPath || "")).toLowerCase();
  if (/(?:^|[._-])cpa(?:[._-].*)?\.json$/i.test(fileName)) return "cpa";
  if (/(?:^|[._-])sub2api(?:[._-].*)?\.json$/i.test(fileName)) return "sub2api";
  return importedFrom || undefined;
}

function normalizeProvider(provider) {
  const normalized = {
    id: String(provider.id || "").trim(),
    name: String(provider.name || "").trim(),
    kind: provider.kind || "coding-plan",
    tool: provider.tool || undefined,
    baseUrl: provider.baseUrl || undefined,
    apiKey: provider.apiKey || undefined,
    apiKeyEnv: provider.apiKeyEnv || undefined,
    enabled: provider.enabled !== false,
    tiers: provider.tiers || undefined,
  };

  if (normalized.kind === "official-subscription") {
    if (!normalized.tool) normalized.tool = "codex";
    if (provider.authPath) normalized.authPath = provider.authPath;
    if (provider.credentialsPath) normalized.credentialsPath = provider.credentialsPath;
    if (provider.accessToken) normalized.accessToken = provider.accessToken;
    if (provider.accountId) normalized.accountId = provider.accountId;
    if (provider.accountEmail) normalized.accountEmail = provider.accountEmail;
    if (provider.accountUserId) normalized.accountUserId = provider.accountUserId;
    if (provider.expiresAt) normalized.expiresAt = provider.expiresAt;
    if (provider.planType) normalized.planType = provider.planType;
    const importedFrom = inferImportedFrom(provider.importedFrom, provider.importPath);
    if (importedFrom) normalized.importedFrom = importedFrom;
    if (provider.importedAt) normalized.importedAt = provider.importedAt;
    if (provider.importPath) normalized.importPath = provider.importPath;
    if (provider.importKey) normalized.importKey = provider.importKey;
    delete normalized.baseUrl;
    delete normalized.apiKey;
    delete normalized.apiKeyEnv;
    delete normalized.tiers;
  } else {
    delete normalized.tool;
    delete normalized.authPath;
    delete normalized.credentialsPath;
  }

  return normalized;
}

function writeConfigFile(configPath, config) {
  const normalized = normalizeConfig(config);
  validateConfig(normalized);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.tmp`;
  const stored = protectConfigSecrets(normalized, secretCodec);
  fs.writeFileSync(tempPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, configPath);
  return normalized;
}

function migrateConfigSecrets(configPath) {
  if (!secretCodec || !fs.existsSync(configPath)) return false;
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!hasPlaintextSecrets(raw)) return false;
  writeConfigFile(configPath, normalizeConfig(revealConfigSecrets(raw, secretCodec)));
  return true;
}

function normalizeStoredConfig(config) {
  return normalizeConfig(revealConfigSecrets(config, secretCodec));
}

function configForRenderer(config) {
  return redactConfigSecrets(config);
}

function mergeRendererConfig(config, current) {
  return mergeMaskedSecrets(config, current);
}

function validateConfig(config) {
  if (!Number.isFinite(config.refreshIntervalSeconds) || config.refreshIntervalSeconds < 30) {
    throw new Error("刷新间隔不能小于 30 秒");
  }

  const ids = new Set();
  for (const provider of config.providers) {
    if (!provider.id) throw new Error("供应商 ID 不能为空");
    if (!/^[a-zA-Z0-9_-]+$/.test(provider.id)) {
      throw new Error(`供应商 ID 只能包含字母、数字、下划线和短横线：${provider.id}`);
    }
    if (ids.has(provider.id)) throw new Error(`供应商 ID 重复：${provider.id}`);
    ids.add(provider.id);
    if (!provider.name) throw new Error(`供应商名称不能为空：${provider.id}`);
    if (!["official-subscription", "coding-plan", "balance", "manual"].includes(provider.kind)) {
      throw new Error(`不支持的供应商类型：${provider.kind}`);
    }
  }
}

function providerTemplates() {
  return [
    {
      id: "codex",
      label: "Codex 官方订阅",
      short: "Cx",
      category: "官方订阅",
      description: "读取本机 Codex 的 ChatGPT 登录额度，不需要 Base URL 或 API Key。",
      homepage: "https://chatgpt.com",
      provider: {
        id: "codex",
        name: "Codex",
        kind: "official-subscription",
        tool: "codex",
        enabled: true,
      },
    },
    {
      id: "claude",
      label: "Claude Official",
      short: "Cl",
      category: "官方订阅",
      description: "读取本机 Claude OAuth 额度，不需要 Base URL 或 API Key。",
      homepage: "https://claude.ai",
      provider: {
        id: "claude",
        name: "Claude Official",
        kind: "official-subscription",
        tool: "claude",
        enabled: true,
      },
    },
    {
      id: "grok",
      label: "Grok 官方订阅",
      short: "Gk",
      category: "官方订阅",
      description: "读取本机 Grok Build 登录授权，显示周期额度、月度积分和按量付费状态。",
      homepage: "https://grok.com/build",
      provider: {
        id: "grok",
        name: "Grok Build",
        kind: "official-subscription",
        tool: "grok",
        enabled: true,
      },
    },
    {
      id: "glm",
      label: "Zhipu GLM",
      short: "GLM",
      category: "Coding Plan",
      description: "智谱 GLM / BigModel 官方 Coding Plan 额度。",
      homepage: "https://open.bigmodel.cn",
      provider: {
        id: "glm",
        name: "Zhipu GLM",
        kind: "coding-plan",
        baseUrl: "https://open.bigmodel.cn",
        apiKeyEnv: "ZAI_API_KEY",
        enabled: true,
      },
    },
    {
      id: "zai-glm",
      label: "Zhipu GLM en",
      short: "Z.AI",
      category: "Coding Plan",
      description: "Z.AI 国际站 Coding Plan 额度。",
      homepage: "https://z.ai",
      provider: {
        id: "zai-glm",
        name: "Zhipu GLM en",
        kind: "coding-plan",
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
        apiKeyEnv: "ZAI_API_KEY",
        enabled: true,
      },
    },
    {
      id: "kimi-coding",
      label: "Kimi For Coding",
      short: "K",
      category: "Coding Plan",
      description: "Kimi 官方 Coding 订阅额度。",
      homepage: "https://www.kimi.com/code/docs",
      provider: {
        id: "kimi-coding",
        name: "Kimi For Coding",
        kind: "coding-plan",
        baseUrl: "https://api.kimi.com/coding/",
        apiKeyEnv: ["KIMI_CODING_API_KEY", "KIMI_API_KEY"],
        enabled: true,
      },
    },
    {
      id: "deepseek",
      label: "DeepSeek 余额",
      short: "DS",
      category: "API 余额",
      description: "DeepSeek 官方平台余额，金额按人民币显示。",
      homepage: "https://platform.deepseek.com",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        kind: "balance",
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        enabled: true,
      },
    },
    {
      id: "generic-balance",
      label: "通用余额查询",
      short: "通",
      category: "通用模板",
      description: "适合兼容 /v1/usage 的中转站，填写 Base URL 和 API Key 即可。",
      provider: {
        id: "generic-balance",
        name: "通用余额查询",
        kind: "balance",
        baseUrl: "",
        apiKey: "",
        enabled: true,
      },
    },
    {
      id: "minimax",
      label: "MiniMax",
      short: "MM",
      category: "Coding Plan",
      description: "MiniMax 中国站 Coding Plan 额度。",
      homepage: "https://platform.minimaxi.com",
      provider: {
        id: "minimax",
        name: "MiniMax",
        kind: "coding-plan",
        baseUrl: "https://api.minimaxi.com",
        apiKeyEnv: "MINIMAX_API_KEY",
        enabled: true,
      },
    },
    {
      id: "minimax-en",
      label: "MiniMax en",
      short: "MM",
      category: "Coding Plan",
      description: "MiniMax 国际站 Coding Plan 额度。",
      homepage: "https://platform.minimax.io",
      provider: {
        id: "minimax-en",
        name: "MiniMax en",
        kind: "coding-plan",
        baseUrl: "https://api.minimax.io",
        apiKeyEnv: "MINIMAX_API_KEY",
        enabled: true,
      },
    },
    {
      id: "custom",
      label: "自定义供应商",
      short: "+",
      category: "自定义",
      description: "用于手动接入其它已兼容的官方接口。",
      provider: {
        id: "custom-provider",
        name: "自定义供应商",
        kind: "balance",
        baseUrl: "",
        apiKey: "",
        enabled: true,
      },
    },
  ];
}

module.exports = {
  readConfigFile,
  writeConfigFile,
  normalizeConfig,
  validateConfig,
  providerTemplates,
  configureSecretStorage,
  migrateConfigSecrets,
  normalizeStoredConfig,
  configForRenderer,
  mergeRendererConfig,
};
