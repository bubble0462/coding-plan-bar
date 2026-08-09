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
  normalizeGrokBilling,
  queryZhipuCoding,
  readCodexCredentials,
  readClaudeCredentials,
  refreshProviders,
} = require("../src/providers");
const {
  DEFAULT_TTL_MS,
  providerFingerprint,
  readProviderCache,
  writeProviderCache,
} = require("../src/provider-cache");
const {
  providerTemplates,
  validateConfig,
  normalizeConfig,
  readConfigFile,
  writeConfigFile,
  configureSecretStorage,
  configForRenderer,
  mergeRendererConfig,
} = require("../src/config-store");
const { SECRET_MASK } = require("../src/secret-store");
const {
  importAccountsIntoConfig,
  parseAccountImport,
  previewAccountsImport,
  isCpaAccountFileName,
  isCpaAccountShape,
  isClaudeAccountFileName,
  isClaudeAccountShape,
} = require("../src/account-importer");
const { classifyFailure } = require("../src/failure-classifier");
const { parseGrokWebBilling } = require("../src/grok-web-billing");
const { computePopupHeight } = require("../src/layout");
const { normalizeModelId, findModelPricing, calculateCostUsd } = require("../src/model-pricing");
const {
  parseCodexJsonl,
  parseClaudeJsonl,
  aggregateTierUsage,
  matchesProvider,
  matchingUsageEvents,
  summarizeCodexUsage,
} = require("../src/session-usage");
const {
  parseVersion,
  normalizeVersionLabel,
  compareVersions,
  findInstallerAsset,
  buildUpdateResult,
  extractTagFromReleaseUrl,
  buildRedirectRelease,
  verifyDownloadedFile,
} = require("../src/updater");
const {
  readAgentUsageCache,
  writeAgentUsageCache,
} = require("../src/agent-usage-cache");
const {
  DEFAULT_WINDOWS_DATA_DIRECTORY,
  initializeApplicationDataDirectory,
  resolveApplicationDataDirectory,
} = require("../src/app-storage");


assert.strictEqual(windowSecondsToTierName(18000), "five_hour");
assert.strictEqual(windowSecondsToTierName(604800), "seven_day");
assert.strictEqual(classifyFailure("Grok billing 响应缺少可识别的额度字段").kind, "parse_error");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-plan-bar-"));
const atomicPath = path.join(tempDir, "auth.json");
writeJsonFileAtomic(atomicPath, { account: { key: "new-access-token", refresh_token: "new-refresh-token" } });
assert.deepStrictEqual(JSON.parse(fs.readFileSync(atomicPath, "utf8")), {
  account: { key: "new-access-token", refresh_token: "new-refresh-token" },
});
assert(!fs.readdirSync(tempDir).some((name) => name.endsWith(".tmp")));
const agentUsageCachePath = path.join(tempDir, "agent-usage-cache.json");
const cachedAgentUsage = {
  generatedAt: 1_740_000_000_000,
  codex: { generatedAt: 1_740_000_000_000, windows: {}, daily: [], models: [] },
};
assert.strictEqual(writeAgentUsageCache(agentUsageCachePath, cachedAgentUsage, { savedAt: 1_740_000_000_000 }), true);
assert.deepStrictEqual(readAgentUsageCache(agentUsageCachePath, { now: 1_950_000_000_000 }), {
  savedAt: 1_740_000_000_000,
  snapshot: cachedAgentUsage,
});
assert(!fs.readdirSync(tempDir).some((name) => name.includes("agent-usage-cache.json") && name.endsWith(".tmp")));

const legacyStorage = path.join(tempDir, "legacy-storage");
const targetStorage = path.join(tempDir, "target-storage");
fs.mkdirSync(path.join(legacyStorage, "logs"), { recursive: true });
fs.writeFileSync(path.join(legacyStorage, "config.json"), "{\"providers\":[]}", "utf8");
fs.writeFileSync(path.join(legacyStorage, "quota-cache.json"), "{}", "utf8");
const oldLogPath = path.join(legacyStorage, "logs", "old.log");
fs.writeFileSync(oldLogPath, "old", "utf8");
fs.utimesSync(oldLogPath, new Date(1_000), new Date(1_000));
const initializedStorage = initializeApplicationDataDirectory({
  legacyUserDataPath: legacyStorage,
  dataDirectory: targetStorage,
  previousWindowsDataDirectory: null,
  now: 1_740_000_000_000,
});
assert.strictEqual(initializedStorage.dataDirectory, path.resolve(targetStorage));
assert.strictEqual(initializedStorage.migrated, true);
assert.strictEqual(fs.existsSync(path.join(targetStorage, "config.json")), true);
assert.strictEqual(fs.existsSync(path.join(targetStorage, "quota-cache.json")), true);
assert.strictEqual(fs.existsSync(legacyStorage), false);
assert.strictEqual(resolveApplicationDataDirectory({
  legacyUserDataPath: targetStorage,
  environment: {},
  platform: "win32",
  exists: () => true,
}), DEFAULT_WINDOWS_DATA_DIRECTORY);

// Historical install-internal / old D: data must migrate into the new default
// (outside the install directory so NSIS upgrades cannot wipe accounts).
const previousStorage = path.join(tempDir, "previous-d-storage");
const installInternalStorage = path.join(tempDir, "install-internal-data");
const appsStorage = path.join(tempDir, "apps-storage");
fs.mkdirSync(previousStorage, { recursive: true });
fs.mkdirSync(installInternalStorage, { recursive: true });
fs.writeFileSync(path.join(previousStorage, "quota-cache.json"), "{}\n", "utf8");
fs.writeFileSync(path.join(installInternalStorage, "config.json"), "{\"providers\":[{\"id\":\"glm\"}]}\n", "utf8");
fs.writeFileSync(path.join(installInternalStorage, "agent-usage-cache.json"), "{\"savedAt\":1}\n", "utf8");
const previousMigrated = initializeApplicationDataDirectory({
  legacyUserDataPath: path.join(tempDir, "empty-appdata"),
  dataDirectory: appsStorage,
  previousWindowsDataDirectories: [installInternalStorage, previousStorage],
});
assert.strictEqual(previousMigrated.migrated, true);
assert.strictEqual(fs.existsSync(path.join(appsStorage, "config.json")), true);
assert.strictEqual(fs.existsSync(path.join(appsStorage, "agent-usage-cache.json")), true);
assert.strictEqual(fs.existsSync(path.join(appsStorage, "quota-cache.json")), true);
assert.strictEqual(fs.existsSync(previousStorage), false);
assert.strictEqual(fs.existsSync(installInternalStorage), false);
assert.strictEqual(fs.existsSync(path.join(targetStorage, "logs", "old.log")), false);
assert.strictEqual(resolveApplicationDataDirectory({
  legacyUserDataPath: targetStorage,
  environment: {},
  platform: "win32",
  exists: () => false,
}), path.resolve(targetStorage));
assert.strictEqual(resolveApplicationDataDirectory({
  legacyUserDataPath: targetStorage,
  environment: { CODING_PLAN_BAR_DATA_DIR: path.join(tempDir, "override-storage") },
  platform: "win32",
  exists: () => false,
}), path.resolve(path.join(tempDir, "override-storage")));

const cpaFixture = {
  type: "codex",
  account_id: "cpa-account-id",
  chatgpt_account_id: "cpa-account-id",
  email: "cpa@example.com",
  name: "cpa@example.com",
  plan_type: "plus",
  chatgpt_plan_type: "plus",
  access_token: "cpa-access-token-v1",
  id_token: "must-not-be-persisted",
  session_token: "must-not-be-persisted",
  expired: "2027-01-02T03:04:05Z",
};
assert.strictEqual(isCpaAccountFileName("cpa@example.com.cpa.2026-07-18.json"), true);
assert.strictEqual(isCpaAccountFileName("codex-powellssportplake@gmail.com-plus.json"), true);
assert.strictEqual(isCpaAccountFileName("powellssportplake@gmail.com-plus.json"), true);
assert.strictEqual(isCpaAccountFileName("random-notes.json"), false);
assert.strictEqual(isCpaAccountShape(cpaFixture), true);
assert.strictEqual(isCpaAccountShape({ access_token: "x" }), false);

const parsedCpa = parseAccountImport(cpaFixture, "cpa@example.com.cpa.2026-07-18.json");
assert.strictEqual(parsedCpa.format, "cpa");
assert.strictEqual(parsedCpa.accounts.length, 1);
assert.strictEqual(parsedCpa.accounts[0].accountId, "cpa-account-id");
assert.strictEqual(parsedCpa.accounts[0].planType, "plus");
assert.strictEqual(parsedCpa.accounts[0].expiresAt, "2027-01-02T03:04:05.000Z");

const parsedCodexNamedCpa = parseAccountImport(cpaFixture, "codex-powellssportplake@gmail.com-plus.json");
assert.strictEqual(parsedCodexNamedCpa.format, "cpa");
assert.strictEqual(parsedCodexNamedCpa.accounts.length, 1);

const cpaPreview = previewAccountsImport({ providers: [] }, cpaFixture, "cpa@example.com.cpa.2026-07-18.json");
assert.strictEqual(cpaPreview.format, "cpa");
assert.strictEqual(cpaPreview.importedCount, 1);
assert(cpaPreview.items[0].identityLabel.includes("CPA accountId"));

const firstCpaImport = importAccountsIntoConfig({ providers: [] }, cpaFixture, "codex-powellssportplake@gmail.com-plus.json");
assert.strictEqual(firstCpaImport.format, "cpa");
assert.strictEqual(firstCpaImport.importedCount, 1);
assert.strictEqual(firstCpaImport.updatedCount, 0);
assert.strictEqual(firstCpaImport.config.providers[0].importedFrom, "cpa");
assert.strictEqual(firstCpaImport.config.providers[0].accessToken, "cpa-access-token-v1");
assert.strictEqual(firstCpaImport.config.providers[0].sessionToken, undefined);
assert.strictEqual(firstCpaImport.config.providers[0].idToken, undefined);

const secondCpaImport = importAccountsIntoConfig(
  firstCpaImport.config,
  { ...cpaFixture, access_token: "cpa-access-token-v2" },
  "cpa@example.com.cpa.2026-07-18_2.json",
);
assert.strictEqual(secondCpaImport.importedCount, 0);
assert.strictEqual(secondCpaImport.updatedCount, 1);
assert.strictEqual(secondCpaImport.config.providers.length, 1);
assert.strictEqual(secondCpaImport.config.providers[0].accessToken, "cpa-access-token-v2");

const claudeFixture = {
  type: "claude",
  access_token: "claude-access-token-v1",
  refresh_token: "must-not-be-persisted",
  id_token: "must-not-be-persisted",
  disabled: false,
  email: "claude@example.com",
  expired: "2099-07-26T21:03:08+08:00",
  last_refresh: "2099-07-26T13:03:08+08:00",
};
assert.strictEqual(isClaudeAccountFileName("claude-claude@example.com.json"), true);
assert.strictEqual(isClaudeAccountFileName("claude_example.json"), true);
assert.strictEqual(isClaudeAccountFileName("notes-claude-export.json"), false);
assert.strictEqual(isClaudeAccountFileName("codex-example@gmail.com-plus.json"), false);
assert.strictEqual(isClaudeAccountShape(claudeFixture), true);
assert.strictEqual(isClaudeAccountShape({ ...claudeFixture, type: "anthropic" }), true);
assert.strictEqual(isClaudeAccountShape({ type: "claude", access_token: "x" }), false);
const wrongTypeClaudeName = parseAccountImport({ ...claudeFixture, type: "codex" }, "claude-wrong-type.json");
assert.strictEqual(wrongTypeClaudeName.format, "accounts");
assert.strictEqual(wrongTypeClaudeName.accounts[0].tool, "codex");

const parsedClaude = parseAccountImport(claudeFixture, "claude-claude@example.com.json");
assert.strictEqual(parsedClaude.format, "claude");
assert.strictEqual(parsedClaude.accounts.length, 1);
assert.strictEqual(parsedClaude.accounts[0].tool, "claude");
assert.strictEqual(parsedClaude.accounts[0].email, "claude@example.com");
assert.strictEqual(parsedClaude.accounts[0].expiresAt, "2099-07-26T13:03:08.000Z");

const claudePreview = previewAccountsImport({ providers: [] }, claudeFixture, "claude-claude@example.com.json");
assert.strictEqual(claudePreview.format, "claude");
assert.strictEqual(claudePreview.importedCount, 1);
assert.strictEqual(claudePreview.items[0].identityLabel, "Claude 邮箱");
assert.strictEqual(JSON.stringify(claudePreview).includes("claude-access-token-v1"), false);
assert.strictEqual(JSON.stringify(claudePreview).includes("must-not-be-persisted"), false);

const firstClaudeImport = importAccountsIntoConfig({ providers: [] }, claudeFixture, "claude-claude@example.com.json");
assert.strictEqual(firstClaudeImport.format, "claude");
assert.strictEqual(firstClaudeImport.importedCount, 1);
assert.strictEqual(firstClaudeImport.updatedCount, 0);
assert.strictEqual(firstClaudeImport.config.providers[0].tool, "claude");
assert.strictEqual(firstClaudeImport.config.providers[0].importedFrom, "claude");
assert.strictEqual(firstClaudeImport.config.providers[0].accessToken, "claude-access-token-v1");
assert.strictEqual(firstClaudeImport.config.providers[0].refreshToken, undefined);
assert.strictEqual(firstClaudeImport.config.providers[0].idToken, undefined);
assert.strictEqual(normalizeConfig({
  providers: [{ ...firstClaudeImport.config.providers[0], importPath: "pasted-json" }],
}).providers[0].importedFrom, "claude");

const secondClaudeImport = importAccountsIntoConfig(
  firstClaudeImport.config,
  { ...claudeFixture, access_token: "claude-access-token-v2" },
  "claude-claude@example.com.json",
);
assert.strictEqual(secondClaudeImport.importedCount, 0);
assert.strictEqual(secondClaudeImport.updatedCount, 1);
assert.strictEqual(secondClaudeImport.config.providers.length, 1);
assert.strictEqual(secondClaudeImport.config.providers[0].accessToken, "claude-access-token-v2");

const sameEmailAcrossServices = importAccountsIntoConfig(
  {
    providers: [{
      id: "openai-claude-at-example-com",
      name: "claude@example.com",
      kind: "official-subscription",
      tool: "codex",
      accessToken: "codex-token",
      accountEmail: "claude@example.com",
      importedFrom: "cpa",
      importKey: "openai:codex-account-id",
    }],
  },
  claudeFixture,
  "claude-claude@example.com.json",
);
assert.strictEqual(sameEmailAcrossServices.importedCount, 1);
assert.strictEqual(sameEmailAcrossServices.updatedCount, 0);
assert.deepStrictEqual(sameEmailAcrossServices.config.providers.map((provider) => provider.tool), ["codex", "claude"]);

assert.deepStrictEqual(readClaudeCredentials({
  accessToken: "expired-claude-token",
  accountEmail: "claude@example.com",
  expiresAt: "2000-01-01T00:00:00.000Z",
}), {
  accessToken: null,
  status: "expired",
  message: "导入的 Claude OAuth token 已过期",
});
assert.deepStrictEqual(readClaudeCredentials({
  accessToken: "valid-claude-token",
  accountEmail: "claude@example.com",
  expiresAt: "2099-01-01T00:00:00.000Z",
}), {
  accessToken: "valid-claude-token",
  status: "valid",
  message: "claude@example.com",
});

const legacySub2api = parseAccountImport(
  { exported_at: "2026-07-01T00:00:00Z", accounts: [{ credentials: { access_token: "legacy-token" } }] },
  "sub2api-account.json",
);
assert.strictEqual(legacySub2api.format, "sub2api");
assert.strictEqual(legacySub2api.accounts.length, 1);

const migratedImportSources = normalizeConfig({
  providers: [
    {
      id: "legacy-cpa",
      name: "Legacy CPA",
      kind: "official-subscription",
      accessToken: "cpa-token",
      importedFrom: "accounts",
      importPath: "D:/Downloads/legacy@example.com.cpa.2026-07-18.json",
    },
    {
      id: "legacy-sub2api",
      name: "Legacy sub2api",
      kind: "official-subscription",
      accessToken: "sub2api-token",
      importedFrom: "accounts",
      importPath: "D:/Downloads/legacy@example.com.sub2api.2026-07-18.json",
    },
    {
      id: "generic-account",
      name: "Generic account",
      kind: "official-subscription",
      accessToken: "generic-token",
      importedFrom: "accounts",
      importPath: "D:/Downloads/accounts.json",
    },
  ],
});
assert.strictEqual(migratedImportSources.providers[0].importedFrom, "cpa");
assert.strictEqual(migratedImportSources.providers[1].importedFrom, "sub2api");
assert.strictEqual(migratedImportSources.providers[2].importedFrom, "accounts");

const staleCodexAuthPath = path.join(tempDir, "codex-auth.json");
writeJsonFileAtomic(staleCodexAuthPath, {
  auth_mode: "chatgpt",
  last_refresh: "2020-01-01T00:00:00.000Z",
  tokens: {
    access_token: "codex-access-token",
    account_id: "account-id",
  },
});
const codexCredentials = readCodexCredentials({ authPath: staleCodexAuthPath });
assert.strictEqual(codexCredentials.status, "valid");
assert.strictEqual(codexCredentials.message, null);

const cachePath = path.join(tempDir, "quota-cache.json");
const cacheProvider = { id: "glm", kind: "coding-plan", baseUrl: "https://open.bigmodel.cn/" };
const cacheKey = providerFingerprint(cacheProvider);
writeProviderCache(
  cachePath,
  new Map([[cacheKey, { savedAt: Date.now(), provider: { id: "glm", status: "ok", tiers: [{ name: "five_hour" }] } }]]),
  new Set([cacheKey]),
);
assert.strictEqual(readProviderCache(cachePath).get(cacheKey).provider.id, "glm");
assert.notStrictEqual(
  cacheKey,
  providerFingerprint({ ...cacheProvider, baseUrl: "https://api.z.ai" }),
);
assert.notStrictEqual(
  providerFingerprint({ ...cacheProvider, apiKey: "first-key" }),
  providerFingerprint({ ...cacheProvider, apiKey: "second-key" }),
);
assert.notStrictEqual(
  providerFingerprint(cacheProvider, "first-env-key"),
  providerFingerprint(cacheProvider, "second-env-key"),
);
assert.strictEqual(
  readProviderCache(cachePath, { now: Date.now() + DEFAULT_TTL_MS + 1 }).size,
  0,
);
fs.rmSync(tempDir, { recursive: true, force: true });

// ===== Local token usage and API-equivalent cost estimates =====
assert.strictEqual(normalizeModelId("openai/GPT-5.4-20260305"), "gpt-5.4");
assert.strictEqual(findModelPricing("gpt-5.4").output, 15);
assert.deepStrictEqual(
  (({ input, output, cacheRead, cacheCreation, preview }) => ({ input, output, cacheRead, cacheCreation, preview }))(findModelPricing("gpt-5.6-sol")),
  { input: 5, output: 30, cacheRead: 0.5, cacheCreation: 6.25, preview: true },
);
assert.strictEqual(findModelPricing("gpt-5.6-codex-terra-2026-07-01").output, 15);
assert.strictEqual(findModelPricing("gpt-5.6-luna").cacheRead, 0.1);
assert.deepStrictEqual(
  (({ input, output, cacheRead }) => ({ input, output, cacheRead }))(findModelPricing("glm-5-turbo")),
  { input: 1.2, output: 4, cacheRead: 0.24 },
);

const zhipuStringTiers = parseZhipuTokenTiers({
  limits: [
    { type: "TOKENS_LIMIT", unit: "3", percentage: "12.5", nextResetTime: "2000000000" },
    { type: "TOKENS_LIMIT", unit: "6", percentage: "44", nextResetTime: "2033-05-18T03:33:20.000Z" },
  ],
});
assert.deepStrictEqual(
  zhipuStringTiers.map((tier) => [tier.name, tier.utilization, Boolean(tier.resetsAt)]),
  [
    ["five_hour", 12.5, true],
    ["weekly_limit", 44, true],
  ],
);
assert.strictEqual(findModelPricing("glm-4.7-flash").output, 0);
assert.strictEqual(findModelPricing("claude-mythos-5").output, 50);
assert.strictEqual(findModelPricing("claude-sonnet-5").input, 2);
assert.strictEqual(findModelPricing("claude-sonnet-5", Date.parse("2026-09-01T00:00:00Z")), null);
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

const forkedCodexEvents = parseCodexJsonl([
  JSON.stringify({ type: "session_meta", payload: { id: "child-session", session_id: "parent-session", source: { subagent: {} } }, timestamp: "2026-07-05T10:00:00Z" }),
  JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.6-sol" }, timestamp: "2026-07-05T10:00:01Z" }),
  JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10_000, cached_input_tokens: 2_000, output_tokens: 1_000 } } }, timestamp: "2026-07-05T10:00:02Z" }),
  JSON.stringify({ type: "event_msg", payload: { type: "thread_settings_applied" }, timestamp: "2026-07-05T10:00:03Z" }),
  JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10_600, cached_input_tokens: 2_100, output_tokens: 1_060 } } }, timestamp: "2026-07-05T10:01:00Z" }),
].join("\n"));
assert.strictEqual(forkedCodexEvents.length, 1);
assert.strictEqual(forkedCodexEvents[0].sessionId, "child-session");
assert.strictEqual(forkedCodexEvents[0].inputTokens, 600);
assert.strictEqual(forkedCodexEvents[0].cacheReadTokens, 100);
assert.strictEqual(forkedCodexEvents[0].outputTokens, 60);

const olderCodexEvent = {
  ...codexEvents[0],
  id: "codex:older-session:1",
  sessionId: "older-session",
  timestampMs: usageNow - 15 * 24 * 60 * 60 * 1000,
  timestamp: new Date(usageNow - 15 * 24 * 60 * 60 * 1000).toISOString(),
};
const agentUsage = summarizeCodexUsage([...codexEvents, ...forkedCodexEvents, olderCodexEvent], usageNow);
assert.strictEqual(agentUsage.windows.today.requests, 3);
assert.strictEqual(agentUsage.windows.sevenDays.requests, 3);
assert.strictEqual(agentUsage.windows.thirtyDays.requests, 4);
assert.strictEqual(agentUsage.windows.thirtyDays.sessions, 3);
assert.strictEqual(agentUsage.daily.length, 7);
assert.strictEqual(agentUsage.models[0].model, "gpt-5.4");
assert(agentUsage.windows.thirtyDays.costUsd > agentUsage.windows.sevenDays.costUsd);

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

const identifiedCodexEvent = { source: "codex", model: "gpt-5.6-sol", accountId: "acct-1" };
const singleCodexProvider = { id: "codex", kind: "official-subscription", tool: "codex" };
assert.deepStrictEqual(
  matchingUsageEvents(singleCodexProvider, [identifiedCodexEvent], [singleCodexProvider]),
  [identifiedCodexEvent],
);
assert.strictEqual(
  matchingUsageEvents(
    singleCodexProvider,
    [identifiedCodexEvent],
    [singleCodexProvider, { id: "codex-2", kind: "official-subscription", tool: "codex" }],
  ),
  null,
);

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
  html_url: "https://github.com/bubble0462/coding-plan-bar/releases/tag/v0.3.7",
  published_at: "2024-01-01T00:00:00Z",
  body: "fixes",
  assets: [{ name: "Coding Plan Bar-Setup-0.3.7-x64.exe", browser_download_url: "https://github.com/bubble0462/coding-plan-bar/releases/download/v0.3.7/Coding%20Plan%20Bar-Setup-0.3.7-x64.exe", size: 100, digest: "sha256:" + "a".repeat(64) }],
});
assert.strictEqual(available.hasUpdate, true);
assert.strictEqual(available.latestVersion, "0.3.7");
assert.strictEqual(
  available.asset.url,
  "https://github.com/bubble0462/coding-plan-bar/releases/download/v0.3.7/Coding%20Plan%20Bar-Setup-0.3.7-x64.exe",
);

// Same current version means no update.
const latest = buildUpdateResult("0.3.6", {
  tag_name: "0.3.6",
  assets: [{ name: "Coding Plan Bar-Setup-0.3.6-x64.exe", browser_download_url: "https://github.com/bubble0462/coding-plan-bar/releases/download/v0.3.6/Coding%20Plan%20Bar-Setup-0.3.6-x64.exe", size: 100 }],
});
assert.strictEqual(latest.hasUpdate, false);
assert.strictEqual(latest.asset, null);

// Malformed release degrades gracefully instead of throwing.
assert.strictEqual(buildUpdateResult("0.3.6", null).hasUpdate, false);
const untrustedAsset = buildUpdateResult("0.3.6", {
  tag_name: "v0.3.7",
  assets: [{ name: "Coding Plan Bar-Setup-0.3.7-x64.exe", browser_download_url: "https://example.com/exe", size: 100 }],
});
const unsignedAsset = buildUpdateResult("0.3.6", {
  tag_name: "v0.3.7",
  html_url: "https://github.com/bubble0462/coding-plan-bar/releases/tag/v0.3.7",
  assets: [{ name: "Coding Plan Bar-Setup-0.3.7-x64.exe", browser_download_url: "https://github.com/bubble0462/coding-plan-bar/releases/download/v0.3.7/Coding%20Plan%20Bar-Setup-0.3.7-x64.exe", size: 100 }],
});
assert.strictEqual(unsignedAsset.asset, null);
assert(unsignedAsset.error.includes("SHA256"));
assert.strictEqual(untrustedAsset.asset, null);
assert.strictEqual(untrustedAsset.error, "安装包下载地址不受信任");

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
    }, { skipCli: true, skipWeb: true });
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
    }, { skipCli: true, skipWeb: true });
    assert.strictEqual(retryResult.success, true);
    assert.strictEqual(retryResult.tiers[0].utilization, 9);
    assert.strictEqual(billingAttempts, 2);
  } finally {
    global.fetch = previousFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function runGrokSourceSmoke() {
  const omittedZeroFixture = Buffer.from(
    "00000000480a4612001a00220c08fcccd2d2061080ddcad4022a0c08fcc1f7d2061080ddcad402421e0802120c08fcccd2d2061080ddcad4021a0c08fcc1f7d2061080ddcad402580162006801800000000f677270632d7374617475733a300d0a",
    "hex",
  );
  const omittedZero = parseGrokWebBilling(omittedZeroFixture, Date.parse("2026-07-15T00:00:00Z"));
  assert.strictEqual(omittedZero.creditUsagePercent, 0);
  assert.strictEqual(omittedZero.usagePercentOmitted, true);
  assert.strictEqual(omittedZero.billingPeriodEnd, "2026-07-20T08:49:00.000Z");

  const rpcResult = await queryGrokQuota(
    { loginMethod: "SuperGrok", accountEmail: "user@example.com" },
    {
      rpcFetcher: async () => ({
        billingCycle: {
          billingPeriodStart: "2026-07-01T00:00:00Z",
          billingPeriodEnd: "2026-08-01T00:00:00Z",
        },
        monthlyLimit: { val: 15000 },
        onDemandCap: { val: 3000 },
        on_demand_enabled: false,
        usage: {
          includedUsed: { val: 14003 },
          onDemandUsed: { val: 0 },
          totalUsed: { val: 14003 },
        },
      }),
      webFetcher: async () => {
        throw new Error("web fallback should not run");
      },
    },
  );
  assert.strictEqual(rpcResult.success, true);
  assert.strictEqual(rpcResult.planLabel, "SuperGrok");
  assert.strictEqual(rpcResult.diagnostics.source, "grok-cli");
  assert.strictEqual(rpcResult.tiers[0].name, "grok_monthly_credits");
  assert.strictEqual(rpcResult.tiers[0].usedValueUsd, 140.03);
  assert.strictEqual(rpcResult.tiers[0].maxValueUsd, 150);
  assert.strictEqual(rpcResult.extraUsage.isEnabled, false);

  const webResult = await queryGrokQuota(
    { accessToken: "valid", loginMethod: "SuperGrok" },
    {
      rpcFetcher: async () => {
        throw new Error("method not found");
      },
      webFetcher: async () => ({
        creditUsagePercent: 25,
        billingPeriodEnd: "2026-07-15T07:20:00Z",
      }),
    },
  );
  assert.strictEqual(webResult.success, true);
  assert.strictEqual(webResult.diagnostics.source, "grok-web");
  assert.strictEqual(webResult.tiers[0].name, "grok_build");
  assert.strictEqual(webResult.tiers[0].utilization, 25);

  const normalized = normalizeGrokBilling(
    {
      weeklyUsagePercent: 25,
      creditUsagePercent: 25,
      monthlyLimit: { val: 15000 },
      usage: { totalUsed: { val: 14003 } },
      billingPeriodEnd: "2026-08-01T00:00:00Z",
    },
    { loginMethod: "SuperGrok" },
    { source: "fixture", fallbacks: [] },
  );
  assert.deepStrictEqual(normalized.tiers.map((tier) => tier.name), [
    "grok_limit",
    "grok_build",
    "grok_monthly_credits",
  ]);

  const zeroFromJson = normalizeGrokBilling(
    {
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-07-13T08:49:00Z",
        end: "2099-07-20T08:49:00Z",
      },
    },
    { loginMethod: "SuperGrok" },
    { source: "grok-json", fallbacks: [] },
  );
  assert.strictEqual(zeroFromJson.success, true);
  assert.strictEqual(zeroFromJson.tiers[0].name, "grok_build");
  assert.strictEqual(zeroFromJson.tiers[0].utilization, 0);
}

async function runIncrementalRefreshSmoke() {
  let finishUsage;
  const usageReady = new Promise((resolve) => {
    finishUsage = resolve;
  });
  const phases = [];
  const task = refreshProviders(
    {
      providers: [{ id: "manual", name: "Manual", kind: "manual", enabled: true, tiers: [] }],
    },
    {
      refreshProvider: async () => ({
        id: "manual",
        name: "Manual",
        kind: "manual",
        status: "manual",
        tiers: [],
      }),
      collectLocalUsage: () => usageReady,
      onProvider: (_snapshot, _index, _enabled, metadata) => phases.push(metadata.phase),
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(phases, ["quota"]);
  finishUsage([]);
  await task;
  assert.deepStrictEqual(phases, ["quota", "usage"]);
}

async function runSecretStorageSmoke() {
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-plan-bar-secret-"));
  const secretPath = path.join(secretDir, "config.json");
  const claudeSecretPath = path.join(secretDir, "claude-config.json");
  const brokenPath = path.join(secretDir, "broken.json");
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith("protected:")) throw new Error("invalid secret ciphertext");
      return text.slice("protected:".length);
    },
  };
  try {
    configureSecretStorage(fakeSafeStorage);
    writeConfigFile(secretPath, {
      refreshIntervalSeconds: 300,
      providers: [{
        id: "proxy",
        name: "Proxy",
        kind: "balance",
        baseUrl: "https://example.com",
        apiKey: "super-secret-key",
        enabled: true,
      }],
    });
    const stored = fs.readFileSync(secretPath, "utf8");
    assert(!stored.includes("super-secret-key"));
    assert(stored.includes("apiKeyEncrypted"));
    const revealed = readConfigFile(secretPath);
    assert.strictEqual(revealed.providers[0].apiKey, "super-secret-key");
    const rendererConfig = configForRenderer(revealed);
    assert.strictEqual(rendererConfig.providers[0].apiKey, SECRET_MASK);
    assert.strictEqual(
      mergeRendererConfig(rendererConfig, revealed).providers[0].apiKey,
      "super-secret-key",
    );

    writeConfigFile(claudeSecretPath, firstClaudeImport.config);
    const storedClaude = fs.readFileSync(claudeSecretPath, "utf8");
    assert(!storedClaude.includes("claude-access-token-v1"));
    assert(!storedClaude.includes("must-not-be-persisted"));
    assert(storedClaude.includes("accessTokenEncrypted"));
    const revealedClaude = readConfigFile(claudeSecretPath);
    assert.strictEqual(revealedClaude.providers[0].accessToken, "claude-access-token-v1");
    assert.strictEqual(revealedClaude.providers[0].tool, "claude");
    assert.strictEqual(revealedClaude.providers[0].importedFrom, "claude");
    assert.strictEqual(configForRenderer(revealedClaude).providers[0].accessToken, SECRET_MASK);

    // One undecryptable credential must not crash boot, and its ciphertext
    // must survive a subsequent write so peers remain intact.
    fs.writeFileSync(
      brokenPath,
      `${JSON.stringify({
        refreshIntervalSeconds: 300,
        providers: [
          {
            id: "broken",
            name: "Broken",
            kind: "balance",
            baseUrl: "https://example.com",
            apiKeyEncrypted: "dpapi:not-valid-ciphertext",
            enabled: true,
          },
          {
            id: "healthy",
            name: "Healthy",
            kind: "balance",
            baseUrl: "https://example.com",
            apiKey: "healthy-secret",
            enabled: true,
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    const tolerant = readConfigFile(brokenPath);
    assert.strictEqual(tolerant.providers[0].apiKey, undefined);
    assert.deepStrictEqual(tolerant.providers[0].unavailableSecretFields, ["apiKey"]);
    assert.strictEqual(tolerant.providers[1].apiKey, "healthy-secret");
    writeConfigFile(brokenPath, tolerant);
    const rewritten = JSON.parse(fs.readFileSync(brokenPath, "utf8"));
    assert.strictEqual(rewritten.providers[0].apiKeyEncrypted, "dpapi:not-valid-ciphertext");
    assert(!rewritten.providers[1].apiKey);
    assert(rewritten.providers[1].apiKeyEncrypted);
  } finally {
    configureSecretStorage(null);
    fs.rmSync(secretDir, { recursive: true, force: true });
  }
}

async function runUpdaterIntegritySmoke() {
  const file = path.join(os.tmpdir(), `coding-plan-bar-update-${process.pid}.exe`);
  fs.writeFileSync(file, "installer");
  try {
    await assert.rejects(() => verifyDownloadedFile(file, 9, null), /SHA256/);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

async function runZhipuRequestSmoke() {
  const previousFetch = global.fetch;
  try {
    let attempts = 0;
    global.fetch = async (_url, options = {}) => {
      attempts += 1;
      assert.strictEqual(options.headers.Authorization, "glm-api-key");
      if (attempts === 1) return jsonResponse(503, { message: "temporary" });
      return jsonResponse(200, {
        success: true,
        data: {
          level: "pro",
          limits: [
            { type: "TOKENS_LIMIT", unit: "3", percentage: "15", nextResetTime: "2000000000" },
            { type: "TOKENS_LIMIT", unit: "6", percentage: "35", nextResetTime: "2033-05-18T03:33:20.000Z" },
          ],
        },
      });
    };
    const recovered = await queryZhipuCoding("https://open.bigmodel.cn", "glm-api-key");
    assert.strictEqual(recovered.success, true);
    assert.strictEqual(recovered.diagnostics.attempts, 2);
    assert.deepStrictEqual(recovered.tiers.map((tier) => tier.utilization), [15, 35]);

    global.fetch = async () => jsonResponse(200, { success: true, data: { limits: [] } });
    const empty = await queryZhipuCoding("https://open.bigmodel.cn", "glm-api-key");
    assert.strictEqual(empty.success, false);
    assert.strictEqual(empty.credentialStatus, "parse_error");

    global.fetch = async () => jsonResponse(401, { message: "expired" });
    const unauthorized = await queryZhipuCoding("https://open.bigmodel.cn", "glm-api-key");
    assert.strictEqual(unauthorized.success, false);
    assert.strictEqual(unauthorized.httpStatus, 401);
  } finally {
    global.fetch = previousFetch;
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

async function runFetchTimeoutSmoke() {
  const { fetchWithTimeout } = require("../src/http-client");
  const previousFetch = global.fetch;
  try {
    // 1) Happy path: response resolves before timeout, timer is cleared.
    global.fetch = async (url, options) => {
      assert.strictEqual(url, "https://example.test/ok");
      assert.ok(options && options.signal, "fetch options should carry an AbortSignal");
      return { ok: true, status: 200, headers: new Map(), text: async () => "ok" };
    };
    const ok = await fetchWithTimeout("https://example.test/ok", {}, 1000);
    assert.strictEqual(ok.status, 200);

    // 2) Timeout path: never-resolving fetch + 10ms timeout must reject via AbortController.
    global.fetch = (url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    let caught = null;
    try {
      await fetchWithTimeout("https://example.test/slow", {}, 10);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "fetchWithTimeout should reject when the timeout elapses");
  } finally {
    global.fetch = previousFetch;
  }
}

runZhipuRequestSmoke()
  .then(runGrokRefreshSmoke)
  .then(runGrokSourceSmoke)
  .then(runIncrementalRefreshSmoke)
  .then(runSecretStorageSmoke)
  .then(runUpdaterIntegritySmoke)
  .then(runFetchTimeoutSmoke)
  .then(() => console.log("Smoke tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
