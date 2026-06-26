const fs = require("fs");
const path = require("path");

function readConfigFile(configPath) {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return normalizeConfig(parsed);
}

function normalizeConfig(config) {
  return {
    refreshIntervalSeconds: Number(config.refreshIntervalSeconds || 300),
    showOnHover: config.showOnHover !== false,
    autoUpdate: normalizeAutoUpdate(config.autoUpdate),
    providers: Array.isArray(config.providers) ? config.providers.map(normalizeProvider) : [],
  };
}

function normalizeAutoUpdate(autoUpdate) {
  const value = autoUpdate || {};
  return {
    // Check for a new version on app launch. Only notifies — never downloads
    // or installs without explicit user action.
    enabled: value.enabled !== false,
  };
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
    delete normalized.baseUrl;
    delete normalized.apiKey;
    delete normalized.apiKeyEnv;
    delete normalized.tiers;
  } else {
    delete normalized.tool;
  }

  return normalized;
}

function writeConfigFile(configPath, config) {
  const normalized = normalizeConfig(config);
  validateConfig(normalized);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, configPath);
  return normalized;
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
};
