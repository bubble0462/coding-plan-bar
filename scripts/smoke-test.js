const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseGenericBalanceResponse,
  parseBalanceUsage,
  parseMiniMaxTiers,
  parseZhipuTokenTiers,
  windowSecondsToTierName,
  writeJsonFileAtomic,
  queryGrokQuota,
} = require("../src/providers");
const { providerTemplates, validateConfig, normalizeConfig } = require("../src/config-store");
const { computePopupHeight } = require("../src/layout");
const { normalizeModelId, findModelPricing, calculateCostUsd } = require("../src/model-pricing");
const {
  parseCodexJsonl,
  parseClaudeJsonl,
  aggregateTierUsage,
  matchesProvider,
} = require("../src/session-usage");
const {
  parseVersion,
  normalizeVersionLabel,
  compareVersions,
  findInstallerAsset,
  buildUpdateResult,
  extractTagFromReleaseUrl,
  buildRedirectRelease,
} = require("../src/updater");

assert.strictEqual(windowSecondsToTierName(18000), "five_hour");
assert.strictEqual(windowSecondsToTierName(604800), "seven_day");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-plan-bar-"));
const atomicPath = path.join(tempDir, "auth.json");
writeJsonFileAtomic(atomicPath, { account: { key: "new-access-token", refresh_token: "new-refresh-token" } });
assert.deepStrictEqual(JSON.parse(fs.readFileSync(atomicPath, "utf8")), {
  account: { key: "new-access-token", refresh_token: "new-refresh-token" },
});
assert(!fs.readdirSync(tempDir).some((name) => name.endsWith(".tmp")));
fs.rmSync(tempDir, { recursive: true, force: true });

// ===== Local token usage and API-equivalent cost estimates =====
assert.strictEqual(normalizeModelId("openai/GPT-5.4-20260305"), "gpt-5.4");
assert.strictEqual(findModelPricing("gpt-5.4").output, 15);
assert.deepStrictEqual(
  (({ input, output, cacheRead }) => ({ input, output, cacheRead }))(findModelPricing("glm-5-turbo")),
  { input: 1.2, output: 4, cacheRead: 0.24 },
);
assert.strictEqual(findModelPricing("glm-4.7-flash").output, 0);
assert.strictEqual(findModelPricing("claude-mythos-5").output, 50);
assert.strictEqual(findModelPricing("claude-sonnet-5").input, 2);
assert.deepStrictEqual(
  (({ input, output, cacheRead }) => ({ input, output, cacheRead }))(findModelPricing("deepseek-v4-pro")),
  { input: 0.435, output: 0.87, cacheRead: 0.003625 },
);
assert.strictEqual(findModelPricing("unknown-model"), null);
assert(Math.abs(calculateCostUsd({
  model: "gpt-5.4",
  inputTokens: 1_000,
  outputTokens: 100,
  cacheReadTokens: 200,
  cacheCreationTokens: 0,
}) - 0.00355) < 1e-10);

const usageNow = Date.parse("2026-07-05T12:00:00Z");
const codexEvents = parseCodexJsonl([
  JSON.stringify({ type: "session_meta", payload: { id: "session-1" }, timestamp: "2026-07-05T10:00:00Z" }),
  JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.4" }, timestamp: "2026-07-05T10:00:00Z" }),
  JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 100 } } }, timestamp: "2026-07-05T10:01:00Z" }),
  JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1600, cached_input_tokens: 300, output_tokens: 160 } } }, timestamp: "2026-07-05T10:02:00Z" }),
].join("\n"));
assert.strictEqual(codexEvents.length, 2);
assert.strictEqual(codexEvents[1].inputTokens, 600);
assert.strictEqual(codexEvents[1].cacheReadTokens, 100);
assert.strictEqual(codexEvents[1].totalTokens, 660);

const codexWindow = aggregateTierUsage(
  { name: "five_hour", resetsAt: "2026-07-05T15:00:00Z" },
  codexEvents,
  usageNow,
);
assert.strictEqual(codexWindow.requests, 2);
assert.strictEqual(codexWindow.totalTokens, 1760);
assert(codexWindow.costUsd > 0);

const claudeEvents = parseClaudeJsonl(JSON.stringify({
  type: "assistant",
  message: {
    id: "msg-1",
    model: "claude-sonnet-4-6",
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 30,
    },
  },
  timestamp: "2026-07-05T11:00:00Z",
}));
assert.strictEqual(claudeEvents[0].totalTokens, 160);
assert(matchesProvider({ kind: "official-subscription", tool: "claude" }, claudeEvents[0]));
assert(matchesProvider({ kind: "coding-plan", baseUrl: "https://api.kimi.com/coding" }, { model: "kimi-k2.5" }));
assert(matchesProvider(
  { kind: "balance", baseUrl: "https://api.deepseek.com" },
  { model: "deepseek-v4-flash" },
));

assert.deepStrictEqual(
  parseBalanceUsage({
    usage: {
      today: {
        requests: 17,
        input_tokens: 1_000,
        output_tokens: 200,
        cache_read_tokens: 4_000,
        cache_creation_tokens: 300,
        total_tokens: 5_500,
        cost: 1.18,
        actual_cost: 0.94,
      },
    },
  }),
  {
    scope: "今日",
    requests: 17,
    totalTokens: 5_500,
    costUsd: 0.94,
    partialCost: false,
    estimated: false,
    source: "provider",
    currency: "USD",
  },
);

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
assert.deepStrictEqual(
  normalizeConfig({
    providers: [
      { id: "second", name: "Second", kind: "balance" },
      { id: "first", name: "First", kind: "balance" },
    ],
  }).providers.map((provider) => provider.id),
  ["second", "first"],
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

// ===== Updater logic =====
assert.deepStrictEqual(parseVersion("v0.3.6"), [0, 3, 6]);
assert.strictEqual(normalizeVersionLabel("v0.3.9"), "0.3.9");
assert.strictEqual(normalizeVersionLabel("0.3.9"), "0.3.9");
assert.deepStrictEqual(parseVersion("1.2"), [1, 2]);
assert.strictEqual(parseVersion("not-a-version"), null);
assert.strictEqual(compareVersions("0.3.6", "0.3.7"), -1);
assert.strictEqual(compareVersions("0.3.7", "0.3.6"), 1);
assert.strictEqual(compareVersions("1.0.0", "1"), 0);

// autoUpdate normalizes to a stable shape with a default of enabled.
assert.deepStrictEqual(normalizeConfig({ refreshIntervalSeconds: 300 }).autoUpdate, { enabled: true });
assert.deepStrictEqual(normalizeConfig({ refreshIntervalSeconds: 300, autoUpdate: { enabled: false } }).autoUpdate, {
  enabled: false,
});

// Installer asset matching accepts both tolerated naming variants.
assert.strictEqual(
  findInstallerAsset({ assets: [{ name: "Coding Plan Bar-Setup-0.3.7-x64.exe" }] }).name,
  "Coding Plan Bar-Setup-0.3.7-x64.exe",
);
assert.strictEqual(
  findInstallerAsset({ assets: [{ name: "Coding.Plan.Bar-Setup-0.3.7-x64.exe" }] }).name,
  "Coding.Plan.Bar-Setup-0.3.7-x64.exe",
);
assert.strictEqual(findInstallerAsset({ assets: [{ name: "source.zip" }] }), null);
assert.strictEqual(extractTagFromReleaseUrl("https://github.com/bubble0462/coding-plan-bar/releases/tag/v0.3.7"), "v0.3.7");
assert.strictEqual(buildRedirectRelease("v0.3.7").assets[0].name, "Coding.Plan.Bar-Setup-0.3.7-x64.exe");

// buildUpdateResult flags a newer release and surfaces the asset.
const available = buildUpdateResult("0.3.6", {
  tag_name: "v0.3.7",
  html_url: "https://example.com/release",
  published_at: "2024-01-01T00:00:00Z",
  body: "fixes",
  assets: [{ name: "Coding Plan Bar-Setup-0.3.7-x64.exe", browser_download_url: "https://example.com/exe", size: 100 }],
});
assert.strictEqual(available.hasUpdate, true);
assert.strictEqual(available.latestVersion, "0.3.7");
assert.strictEqual(available.asset.url, "https://example.com/exe");

// Same current version means no update.
const latest = buildUpdateResult("0.3.6", {
  tag_name: "0.3.6",
  assets: [{ name: "Coding Plan Bar-Setup-0.3.6-x64.exe", browser_download_url: "https://example.com/exe", size: 100 }],
});
assert.strictEqual(latest.hasUpdate, false);

// Malformed release degrades gracefully instead of throwing.
assert.strictEqual(buildUpdateResult("0.3.6", null).hasUpdate, false);

async function runGrokRefreshSmoke() {
  const previousFetch = global.fetch;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "coding-plan-bar-grok-"));
  try {
    const authPath = path.join(temp, "auth.json");
    const authDocument = {
      account: {
        key: "expired-access-token",
        refresh_token: "refresh-token",
        oidc_client_id: "grok-client-id",
        oidc_issuer: "https://auth.x.ai",
        expires_at: "2000-01-01T00:00:00.000Z",
      },
    };
    fs.writeFileSync(authPath, JSON.stringify(authDocument, null, 2));

    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).endsWith("/oauth2/token")) {
        assert.strictEqual(options.method, "POST");
        assert(String(options.body).includes("grant_type=refresh_token"));
        return jsonResponse(200, {
          access_token: "fresh-access-token",
          refresh_token: "fresh-refresh-token",
          expires_in: 3600,
        });
      }
      assert.strictEqual(options.headers.Authorization, "Bearer fresh-access-token");
      return jsonResponse(200, {
        config: {
          creditUsagePercent: 12,
          currentPeriod: { end: "2026-07-12T00:00:00.000Z" },
        },
      });
    };

    const result = await queryGrokQuota({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      clientId: "grok-client-id",
      issuer: "https://auth.x.ai",
      authPath,
      authDocument,
      authEntryKey: "account",
      shouldRefresh: true,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.tiers[0].utilization, 12);
    assert.strictEqual(calls.length, 2);
    const persisted = JSON.parse(fs.readFileSync(authPath, "utf8"));
    assert.strictEqual(persisted.account.key, "fresh-access-token");
    assert.strictEqual(persisted.account.refresh_token, "fresh-refresh-token");

    let billingAttempts = 0;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes("/v1/billing")) {
        billingAttempts += 1;
        if (billingAttempts === 1) {
          assert.strictEqual(options.headers.Authorization, "Bearer stale-access-token");
          return jsonResponse(401, { error: "unauthorized" });
        }
        assert.strictEqual(options.headers.Authorization, "Bearer retry-access-token");
        return jsonResponse(200, { config: { creditUsagePercent: 9 } });
      }
      return jsonResponse(200, { access_token: "retry-access-token", expires_in: 3600 });
    };

    const retryResult = await queryGrokQuota({
      accessToken: "stale-access-token",
      refreshToken: "refresh-token",
      clientId: "grok-client-id",
      issuer: "https://auth.x.ai",
      shouldRefresh: false,
    });
    assert.strictEqual(retryResult.success, true);
    assert.strictEqual(retryResult.tiers[0].utilization, 9);
    assert.strictEqual(billingAttempts, 2);
  } finally {
    global.fetch = previousFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

runGrokRefreshSmoke()
  .then(() => console.log("Smoke tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
