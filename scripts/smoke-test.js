const assert = require("assert");
const {
  parseGenericBalanceResponse,
  parseMiniMaxTiers,
  parseZhipuTokenTiers,
  windowSecondsToTierName,
} = require("../src/providers");
const { providerTemplates, validateConfig, normalizeConfig } = require("../src/config-store");
const { computePopupHeight } = require("../src/layout");

assert.strictEqual(windowSecondsToTierName(18000), "five_hour");
assert.strictEqual(windowSecondsToTierName(604800), "seven_day");

const zhipuTiers = parseZhipuTokenTiers({
  limits: [
    { type: "TOKENS_LIMIT", unit: 6, number: 7, percentage: 42, nextResetTime: 2000000000000 },
    { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 11, nextResetTime: 1000000000000 },
  ],
});
assert.deepStrictEqual(
  zhipuTiers.map((tier) => [tier.name, tier.utilization]),
  [
    ["five_hour", 11],
    ["weekly_limit", 42],
  ],
);

const minimaxTiers = parseMiniMaxTiers({
  model_remains: [
    { model_name: "video", current_interval_remaining_percent: 50 },
    {
      model_name: "general",
      current_interval_remaining_percent: 80,
      current_weekly_status: 1,
      current_weekly_remaining_percent: 60,
    },
  ],
});
assert.deepStrictEqual(
  minimaxTiers.map((tier) => [tier.name, tier.utilization]),
  [
    ["five_hour", 20],
    ["weekly_limit", 40],
  ],
);

const twoTierProvider = { tiers: [{}, {}] };
const oneProviderHeight = computePopupHeight([twoTierProvider]);
const threeProviderHeight = computePopupHeight([twoTierProvider, twoTierProvider, twoTierProvider]);
const fourProviderHeight = computePopupHeight([twoTierProvider, twoTierProvider, twoTierProvider, twoTierProvider]);
assert(oneProviderHeight < threeProviderHeight);
assert.strictEqual(fourProviderHeight, threeProviderHeight);

const templates = providerTemplates();
assert(templates.some((template) => template.id === "deepseek"));
assert(templates.some((template) => template.id === "generic-balance"));
assert(templates.some((template) => template.id === "kimi-coding"));
assert(!templates.some((template) => template.id === "openrouter"));
assert.deepStrictEqual(
  parseGenericBalanceResponse({
    remaining: "12.34",
    quota: { unit: "CNY" },
    is_active: true,
  }),
  {
    planName: "通用余额",
    remaining: 12.34,
    total: null,
    used: null,
    unit: "CNY",
    isValid: true,
    invalidMessage: null,
    extra: {
      remaining: "12.34",
      quota: { unit: "CNY" },
      is_active: true,
    },
  },
);
assert.deepStrictEqual(
  normalizeConfig({
    refreshIntervalSeconds: 300,
    showOnHover: true,
    providers: [
      {
        id: "codex",
        name: "Codex",
        kind: "official-subscription",
        tool: "codex",
        baseUrl: "https://api.kimi.com/coding/",
        apiKey: "wrong",
        apiKeyEnv: "WRONG",
      },
    ],
  }).providers[0],
  {
    id: "codex",
    name: "Codex",
    kind: "official-subscription",
    tool: "codex",
    enabled: true,
  },
);
assert.doesNotThrow(() =>
  validateConfig({
    refreshIntervalSeconds: 300,
    showOnHover: true,
    providers: [
      {
        id: "codex",
        name: "Codex",
        kind: "official-subscription",
        tool: "codex",
        enabled: true,
      },
    ],
  }),
);
assert.throws(() =>
  validateConfig({
    refreshIntervalSeconds: 10,
    showOnHover: true,
    providers: [],
  }),
);

console.log("Smoke tests passed");
