const crypto = require("crypto");
const path = require("path");
const { normalizeConfig } = require("./config-store");

function importAccountsIntoConfig(config, parsedJson, sourcePath) {
  const normalized = normalizeConfig(config);
  const parsed = parseAccountImport(parsedJson, sourcePath);
  if (parsed.accounts.length === 0) {
    return emptyImportResult(normalized, parsed);
  }

  const applied = applyAccountsToProviders(normalized.providers, parsed.accounts, sourcePath);
  const historyEntry = importHistoryEntry(parsed, applied, sourcePath);
  return {
    config: {
      ...normalized,
      providers: applied.providers,
      importHistory: [historyEntry, ...(normalized.importHistory || [])].slice(0, 20),
    },
    importedCount: applied.importedCount,
    updatedCount: applied.updatedCount,
    skippedCount: parsed.skippedCount,
    accountCount: parsed.accounts.length,
    affectedIds: applied.affectedIds,
    selectedId: applied.affectedIds[0] || null,
    format: parsed.format,
    historyEntry,
    message: importMessage(parsed.format, applied.importedCount, applied.updatedCount, parsed.skippedCount),
  };
}

function previewAccountsImport(config, parsedJson, sourcePath = "") {
  const normalized = normalizeConfig(config);
  const parsed = parseAccountImport(parsedJson, sourcePath);
  if (parsed.accounts.length === 0) {
    const empty = emptyImportResult(normalized, parsed);
    return {
      importedCount: empty.importedCount,
      updatedCount: empty.updatedCount,
      skippedCount: empty.skippedCount,
      format: empty.format,
      message: empty.message,
      fileName: path.basename(sourcePath || ""),
      accountCount: 0,
      affectedIds: [],
      selectedId: null,
      items: [],
      duplicateGroups: [],
    };
  }

  const applied = applyAccountsToProviders(normalized.providers, parsed.accounts, sourcePath);
  return {
    importedCount: applied.importedCount,
    updatedCount: applied.updatedCount,
    skippedCount: parsed.skippedCount,
    affectedIds: applied.affectedIds,
    selectedId: applied.affectedIds[0] || null,
    format: parsed.format,
    fileName: path.basename(sourcePath || ""),
    accountCount: parsed.accounts.length,
    message: importMessage(parsed.format, applied.importedCount, applied.updatedCount, parsed.skippedCount),
    items: applied.items,
    duplicateGroups: duplicateImportedGroups(applied.providers),
  };
}

function emptyImportResult(config, parsed) {
  return {
    config,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: parsed.skippedCount,
    format: parsed.format,
    message: parsed.skippedCount > 0 ? "没有找到可导入的 OAuth 账号" : "文件中没有账号数据",
  };
}

function applyAccountsToProviders(currentProviders, accounts, sourcePath) {
  const providers = currentProviders.map((provider) => ({ ...provider }));
  let importedCount = 0;
  let updatedCount = 0;
  const affectedIds = [];
  const items = [];

  for (const [index, account] of accounts.entries()) {
    const provider = accountToProvider(account, sourcePath);
    const existingIndex = providers.findIndex((item) => sameImportedAccount(item, provider));
    if (existingIndex >= 0) {
      const existing = providers[existingIndex];
      const next = {
        ...existing,
        ...provider,
        id: existing.id,
        name: shouldRefreshImportedName(existing, provider) ? provider.name : existing.name || provider.name,
        enabled: existing.enabled !== false,
      };
      providers[existingIndex] = next;
      affectedIds.push(existing.id);
      updatedCount += 1;
      items.push(importPreviewItem(account, next, {
        index,
        action: "update",
        existing,
        reason: updateReason(existing, provider),
      }));
    } else {
      provider.id = uniqueId(provider.id, providers);
      if (hasSameEmailDifferentAccount(providers, provider) || hasSameSub2apiAccountDifferentRecord(providers, provider)) {
        provider.name = providerDisplayNameWithIdentity(provider);
      }
      providers.push(provider);
      affectedIds.push(provider.id);
      importedCount += 1;
      items.push(importPreviewItem(account, provider, {
        index,
        action: "add",
        existing: null,
        reason: identityReason(provider),
      }));
    }
  }
  labelDuplicateImportedAccounts(providers);
  refreshPreviewNames(items, providers);

  return { providers, importedCount, updatedCount, affectedIds, items };
}

function parseAccountImport(parsedJson, sourcePath = "") {
  const candidates = collectCandidates(parsedJson);
  const format = detectFormat(parsedJson, sourcePath);
  const accounts = [];
  let skippedCount = 0;

  for (const candidate of candidates) {
    const account = normalizeImportedAccount(candidate, format);
    if (account) accounts.push(account);
    else skippedCount += 1;
  }

  return { format, accounts, skippedCount };
}

function collectCandidates(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.accounts)) return value.accounts;
  if (Array.isArray(value.sessions)) return value.sessions;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data)) return value.data;
  if (hasToken(value)) return [value];
  return [];
}

function detectFormat(value, sourcePath = "") {
  const base = path.basename(sourcePath || "").toLowerCase();
  if (isClaudeAccount(value, base)) return "claude";
  if (isCpaAccount(value, base)) return "cpa";
  if (base.includes("sub2api") || (value && typeof value === "object" && Array.isArray(value.accounts) && value.exported_at)) {
    return "sub2api";
  }
  if (base.includes("session") || (value && typeof value === "object" && (value.accessToken || value.sessionToken || value.sessions))) {
    return "sessions";
  }
  return "accounts";
}

function normalizeImportedAccount(candidate, format) {
  if (!candidate || typeof candidate !== "object") return null;
  const credentials = candidate.credentials && typeof candidate.credentials === "object" ? candidate.credentials : {};
  const extra = candidate.extra && typeof candidate.extra === "object" ? candidate.extra : {};
  const user = candidate.user && typeof candidate.user === "object" ? candidate.user : {};
  const account = candidate.account && typeof candidate.account === "object" ? candidate.account : {};

  const platform = String(candidate.platform || credentials.platform || candidate.authProvider || (format === "claude" ? "claude" : "openai")).toLowerCase();
  const supportedPlatforms = format === "claude" ? ["anthropic", "claude"] : ["openai", "chatgpt", "codex"];
  if (platform && !supportedPlatforms.includes(platform)) return null;

  const accessToken = firstString([
    credentials.access_token,
    credentials.accessToken,
    candidate.accessToken,
    candidate.access_token,
    candidate.token,
  ]);
  if (!accessToken) return null;

  const email = firstString([
    credentials.email,
    extra.email,
    user.email,
    candidate.email,
    looksLikeEmail(candidate.name) ? candidate.name : null,
  ]);
  const accountId = firstString([
    credentials.chatgpt_account_id,
    credentials.account_id,
    credentials.accountId,
    account.id,
    candidate.accountId,
    candidate.account_id,
    candidate.chatgpt_account_id,
  ]);
  const userId = firstString([
    credentials.chatgpt_user_id,
    credentials.user_id,
    user.id,
    candidate.userId,
    candidate.user_id,
  ]);
  const expiresAt = normalizeDateString(firstString([
    credentials.expires_at,
    credentials.expiresAt,
    candidate.expired,
    candidate.expires,
    candidate.expires_at,
    candidate.expiresAt,
  ]));
  const planType = firstString([
    credentials.plan_type,
    credentials.planType,
    account.planType,
    account.plan_type,
    candidate.chatgpt_plan_type,
    candidate.planType,
    candidate.plan_type,
  ]);
  const name = firstString([candidate.name, email, userId, accountId]) || (format === "claude" ? "Claude OAuth" : "OpenAI OAuth");

  return {
    format,
    tool: format === "claude" ? "claude" : "codex",
    name,
    email,
    accountId,
    userId,
    accessToken,
    expiresAt,
    planType,
  };
}

function accountToProvider(account, sourcePath) {
  const tool = account.tool || (account.format === "claude" ? "claude" : "codex");
  const identity = account.email || account.name || account.accountId || account.userId || `${tool}-account`;
  const importKey = importedAccountKey(account);
  const idBase = `${tool}-${slug(identity) || tokenHash(account.accessToken).slice(0, 8)}`;
  const displayName = account.email || account.name || `${tool === "claude" ? "Claude" : "OpenAI"} OAuth ${account.accountId ? shortId(account.accountId) : ""}`.trim();
  return {
    id: idBase,
    name: displayName,
    kind: "official-subscription",
    tool,
    enabled: true,
    accessToken: account.accessToken,
    accountId: account.accountId || undefined,
    accountEmail: account.email || undefined,
    accountUserId: account.userId || undefined,
    expiresAt: account.expiresAt || undefined,
    planType: account.planType || undefined,
    importedFrom: account.format,
    importedAt: new Date().toISOString(),
    importPath: sourcePath || undefined,
    importKey,
  };
}

function sameImportedAccount(existing, incoming) {
  if (!existing || !incoming) return false;
  if ((existing.tool || "codex") !== (incoming.tool || "codex")) return false;

  const existingSub2api = sub2apiIdentity(existing);
  const incomingSub2api = sub2apiIdentity(incoming);
  if (existingSub2api || incomingSub2api) {
    return Boolean(existingSub2api && incomingSub2api && existingSub2api === incomingSub2api);
  }

  if (existing.importKey && incoming.importKey && existing.importKey === incoming.importKey) return true;
  // OpenAI can expose multiple ChatGPT accounts/workspaces under the same login
  // email. When account ids are present, treat them as the stronger identity and
  // do not collapse distinct accounts just because their email matches.
  if (existing.accountId && incoming.accountId) return existing.accountId === incoming.accountId;
  if (!existing.accountId && !incoming.accountId && existing.accountEmail && incoming.accountEmail) {
    return canonicalEmail(existing.accountEmail) === canonicalEmail(incoming.accountEmail);
  }
  return false;
}

function hasSameEmailDifferentAccount(providers, incoming) {
  if (!incoming.accountEmail || !incoming.accountId) return false;
  const email = canonicalEmail(incoming.accountEmail);
  return providers.some(
    (provider) =>
      provider.kind === "official-subscription" &&
      provider.accountId &&
      provider.accountId !== incoming.accountId &&
      canonicalEmail(provider.accountEmail) === email,
  );
}

function hasSameSub2apiAccountDifferentRecord(providers, incoming) {
  if (incoming.importedFrom !== "sub2api" || !incoming.accountEmail || !incoming.accountId) return false;
  const email = normalizeEmail(incoming.accountEmail);
  return providers.some(
    (provider) =>
      provider.kind === "official-subscription" &&
      provider.importedFrom === "sub2api" &&
      normalizeEmail(provider.accountEmail) === email &&
      provider.accountId === incoming.accountId &&
      sub2apiIdentity(provider) !== sub2apiIdentity(incoming),
  );
}

function providerDisplayNameWithIdentity(provider) {
  const baseName = provider.accountEmail || provider.name || (provider.tool === "claude" ? "Claude OAuth" : "OpenAI OAuth");
  const suffix = provider.importedFrom === "sub2api" ? shortToken(provider.importKey) : shortId(provider.accountId);
  return baseName.includes(suffix) ? baseName : `${baseName} · ${suffix}`;
}

function shouldRefreshImportedName(existing, incoming) {
  if (!existing.importedFrom) return false;
  if (!existing.accountEmail || !incoming.accountEmail) return false;
  return canonicalEmail(existing.accountEmail) === canonicalEmail(incoming.accountEmail);
}

function labelDuplicateImportedAccounts(providers) {
  const groups = new Map();
  for (const provider of providers) {
    if (provider.kind !== "official-subscription" || !provider.accountEmail || !provider.accountId) continue;
    const key = canonicalEmail(provider.accountEmail);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(provider);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const provider of group) {
      provider.name = providerDisplayNameWithIdentity(provider);
    }
  }
}

function duplicateImportedGroups(providers) {
  const groups = new Map();
  for (const provider of providers) {
    if (provider.kind !== "official-subscription" || !provider.accountEmail || !provider.accountId) continue;
    const key = canonicalEmail(provider.accountEmail);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(provider);
  }
  return [...groups.entries()]
    .filter(([, providersInGroup]) => providersInGroup.length > 1)
    .map(([email, providersInGroup]) => {
      const hasSub2api = providersInGroup.some((provider) => provider.importedFrom === "sub2api");
      return {
        email,
        count: providersInGroup.length,
        accountIds: providersInGroup.map((provider) => shortId(provider.accountId)),
        message: hasSub2api
          ? "同邮箱/同 accountId 可能对应多个 sub2api 独立额度条目，已按独立额度分开保留。"
          : "同一个 Gmail 主邮箱下存在多个不同 accountId，已按 accountId 分开保留。",
      };
    });
}

function importHistoryEntry(parsed, applied, sourcePath) {
  return {
    id: `import-${Date.now()}`,
    importedAt: new Date().toISOString(),
    sourceType: sourcePath === "pasted-json" ? "paste" : "file",
    sourceLabel: sourcePath === "pasted-json" ? "粘贴 JSON" : path.basename(sourcePath || "账号 JSON"),
    format: parsed.format,
    accountCount: parsed.accounts.length,
    importedCount: applied.importedCount,
    updatedCount: applied.updatedCount,
    skippedCount: parsed.skippedCount,
    identityMethods: [...new Set((applied.items || []).map((item) => item.identityMethod).filter(Boolean))],
  };
}

function importedAccountKey(account) {
  if (account.format === "claude") {
    if (account.email) return `claude:${canonicalEmail(account.email)}`;
    if (account.userId) return `claude:${account.userId}`;
    return `claude:${tokenHash(account.accessToken)}`;
  }
  if (account.format === "sub2api") return `sub2api:${sub2apiRecordKey(account)}`;
  if (account.accountId) return `openai:${account.accountId}`;
  if (account.email) return `openai:${canonicalEmail(account.email)}`;
  if (account.userId) return `openai:${account.userId}`;
  return `openai:${tokenHash(account.accessToken)}`;
}

function sub2apiIdentity(provider) {
  if (provider.importedFrom !== "sub2api") return null;
  if (provider.importKey && provider.importKey.startsWith("sub2api:")) return provider.importKey;
  if (!provider.accessToken) return null;
  return `sub2api:${sub2apiRecordKey({
    email: provider.accountEmail || provider.name,
    accountId: provider.accountId,
    userId: provider.accountUserId,
    accessToken: provider.accessToken,
  })}`;
}

function sub2apiRecordKey(account) {
  const email = normalizeEmail(account.email || account.name);
  if (email && account.accountId) return [email, account.accountId].map((part) => slug(part) || "x").join(":");
  if (email && account.userId) return [email, account.userId].map((part) => slug(part) || "x").join(":");
  return [email || "no-email", account.accountId || account.userId || tokenHash(account.accessToken).slice(0, 16)]
    .map((part) => slug(part) || "x")
    .join(":");
}

function importPreviewItem(account, provider, context) {
  const identity = previewIdentity(account, provider);
  return {
    index: context.index + 1,
    action: context.action,
    actionLabel: context.action === "add" ? "新增" : "更新",
    id: provider.id,
    existingId: context.existing?.id || null,
    name: provider.name,
    email: account.email || provider.accountEmail || "",
    accountIdShort: account.accountId ? shortId(account.accountId) : "",
    userIdShort: account.userId ? shortId(account.userId) : "",
    planType: account.planType || provider.planType || "",
    expiresAt: account.expiresAt || provider.expiresAt || "",
    identityMethod: identity.method,
    identityLabel: identity.label,
    reason: context.reason,
  };
}

function refreshPreviewNames(items, providers) {
  const names = new Map(providers.map((provider) => [provider.id, provider.name]));
  for (const item of items) {
    if (names.has(item.id)) item.name = names.get(item.id);
  }
}

function previewIdentity(account, provider) {
  if (account.format === "claude" || provider.importedFrom === "claude") {
    return { method: account.email || provider.accountEmail ? "email" : "token", label: account.email || provider.accountEmail ? "Claude 邮箱" : "Claude token 指纹" };
  }
  if (account.format === "cpa" || provider.importedFrom === "cpa") {
    return { method: "accountId", label: `CPA accountId · ${shortId(account.accountId || provider.accountId)}` };
  }
  if (account.format === "sub2api" || provider.importedFrom === "sub2api") {
    return { method: "sub2api", label: `sub2api 独立额度 · ${shortId(account.accountId || provider.accountId || provider.importKey)}` };
  }
  if (account.accountId || provider.accountId) {
    return { method: "accountId", label: `accountId · ${shortId(account.accountId || provider.accountId)}` };
  }
  if (account.email || provider.accountEmail) {
    const email = account.email || provider.accountEmail;
    return { method: isGmail(email) ? "gmail" : "email", label: isGmail(email) ? "Gmail 主邮箱" : "邮箱" };
  }
  if (account.userId || provider.accountUserId) return { method: "userId", label: "userId" };
  return { method: "token", label: "token 指纹" };
}

function updateReason(existing, incoming) {
  const existingSub2api = sub2apiIdentity(existing);
  const incomingSub2api = sub2apiIdentity(incoming);
  if (existingSub2api && incomingSub2api && existingSub2api === incomingSub2api) {
    return "sub2api 独立额度身份相同，将更新对应条目";
  }
  if (existing.accountId && incoming.accountId && existing.accountId === incoming.accountId) {
    if (existing.accountEmail && incoming.accountEmail && normalizeEmail(existing.accountEmail) !== normalizeEmail(incoming.accountEmail)) {
      return "accountId 相同，邮箱/别名变化，将更新已有账号";
    }
    return "accountId 相同，将更新已有账号";
  }
  if (existing.importKey && incoming.importKey && existing.importKey === incoming.importKey) return "导入身份键相同，将更新已有账号";
  if (existing.accountEmail && incoming.accountEmail) return "未提供 accountId，按邮箱兜底匹配";
  return "匹配到已有账号，将更新";
}

function identityReason(provider) {
  if (provider.importedFrom === "claude") return "新的 Claude 邮箱，将新增官方订阅账号";
  if (provider.importedFrom === "cpa") return "新的 CPA accountId，将新增官方订阅账号";
  if (provider.importedFrom === "sub2api") return "新的 sub2api 独立额度条目，将新增账号";
  if (provider.accountId) return "新的 accountId，将新增官方订阅账号";
  if (provider.accountEmail) return "未提供 accountId，将按邮箱新增账号";
  return "未提供稳定账号标识，将按 token 指纹新增账号";
}

function uniqueId(base, providers) {
  const used = new Set(providers.map((provider) => provider.id));
  let id = base || "openai-account";
  let index = 2;
  while (used.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function importMessage(format, importedCount, updatedCount, skippedCount) {
  const pieces = [];
  if (importedCount) pieces.push(`新增 ${importedCount} 个账号`);
  if (updatedCount) pieces.push(`更新 ${updatedCount} 个账号`);
  if (skippedCount) pieces.push(`跳过 ${skippedCount} 项`);
  return `${formatLabel(format)} 导入完成：${pieces.join("，") || "没有变化"}`;
}

function formatLabel(format) {
  return format === "claude" ? "Claude" : format === "cpa" ? "CPA" : format === "sub2api" ? "sub2api" : format === "sessions" ? "sessions.json" : "账号 JSON";
}

function isClaudeAccountFileName(fileName = "") {
  const base = path.basename(String(fileName || "")).toLowerCase();
  return /^claude[._-].+\.json$/i.test(base);
}

function isClaudeAccountShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const provider = String(value.type || value.platform || value.authProvider || "").toLowerCase();
  return Boolean(
    value.access_token &&
    value.email &&
    ["anthropic", "claude"].includes(provider),
  );
}

function isClaudeAccount(value, baseName = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (isClaudeAccountShape(value)) return true;
  const provider = String(value.type || value.platform || value.authProvider || "").toLowerCase();
  if (provider && !["anthropic", "claude"].includes(provider)) return false;
  return isClaudeAccountFileName(baseName) && Boolean(value.access_token && value.email);
}

/**
 * Recognize CPA export filenames. Historical exports used
 * `name@gmail.cpa.2026-07-18.json`; newer exports often look like
 * `codex-name@gmail.com-plus.json` without a literal "cpa" token.
 */
function isCpaAccountFileName(fileName = "") {
  const base = path.basename(String(fileName || "")).toLowerCase();
  if (!base.endsWith(".json")) return false;
  if (/(?:^|[._-])cpa(?:[._-].*)?\.json$/i.test(base)) return true;
  if (/^codex[-_].+\.json$/i.test(base)) return true;
  if (/\.cpa\.json$/i.test(base)) return true;
  // email + plan-tier exports: user@domain-plus.json / user@domain-team.json
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}.*\.(?:plus|team|pro|free|edu)\.json$/i.test(base)) return true;
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}.*-(?:plus|team|pro|free|edu)\.json$/i.test(base)) return true;
  return false;
}

function isCpaAccountShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Boolean(
    value.access_token &&
    value.email &&
    (value.chatgpt_account_id || value.account_id) &&
    (value.type === "codex" || value.chatgpt_plan_type || value.session_token || value.plan_type),
  );
}

function isCpaAccount(value, baseName = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cpaFileName = isCpaAccountFileName(baseName);
  if (cpaFileName) {
    return Boolean(value.access_token && (value.chatgpt_account_id || value.account_id || value.email));
  }
  return isCpaAccountShape(value);
}

function hasToken(value) {
  if (!value || typeof value !== "object") return false;
  return Boolean(value.accessToken || value.access_token || value.token || value.credentials?.access_token);
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeDateString(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function looksLikeEmail(value) {
  return typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function canonicalEmail(value) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const canonicalLocal = domain === "gmail.com" || domain === "googlemail.com" ? local.split("+")[0].replace(/\./g, "") : local;
  return `${canonicalLocal}@${domain}`;
}

function isGmail(value) {
  const domain = normalizeEmail(value).split("@")[1];
  return domain === "gmail.com" || domain === "googlemail.com";
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/@/g, "-at-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function shortId(value) {
  const text = String(value || "");
  return text.length <= 8 ? text : text.slice(0, 4) + "…" + text.slice(-4);
}

function shortToken(value) {
  return tokenHash(value || "").slice(0, 8);
}

module.exports = {
  importAccountsIntoConfig,
  parseAccountImport,
  previewAccountsImport,
  isCpaAccountFileName,
  isCpaAccountShape,
  isCpaAccount,
  isClaudeAccountFileName,
  isClaudeAccountShape,
  isClaudeAccount,
};
