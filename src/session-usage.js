const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { calculateCostUsd, normalizeModelId } = require("./model-pricing");

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const fileCache = new Map();

async function collectLocalUsage(providers, now = Date.now()) {
  const requirements = usageRequirements(providers);
  const activeFileKeys = new Set();
  const jobs = [];
  for (const dir of requirements.codexDirs) jobs.push(readSessionTree(dir, "codex", now, activeFileKeys));
  for (const dir of requirements.claudeDirs) jobs.push(readSessionTree(dir, "claude", now, activeFileKeys));
  const groups = await Promise.all(jobs);
  for (const key of fileCache.keys()) {
    if (!activeFileKeys.has(key)) fileCache.delete(key);
  }
  return dedupeEvents(groups.flat());
}

async function collectCodexAgentUsage(providers = [], now = Date.now()) {
  const requirements = usageRequirements(providers);
  requirements.codexDirs.add(path.join(os.homedir(), ".codex"));
  const activeFileKeys = new Set();
  const groups = await Promise.all(
    [...requirements.codexDirs].map((dir) => readSessionTree(dir, "codex", now, activeFileKeys)),
  );
  return summarizeCodexUsage(dedupeEvents(groups.flat()), now);
}

function usageRequirements(providers) {
  const codexDirs = new Set();
  const claudeDirs = new Set();
  const defaultCodex = path.join(os.homedir(), ".codex");
  const defaultClaude = path.join(os.homedir(), ".claude");

  for (const provider of providers || []) {
    if (provider.enabled === false || !supportsUsage(provider)) continue;
    if (provider.kind === "official-subscription" && provider.tool === "codex") {
      codexDirs.add(provider.authPath ? path.dirname(provider.authPath) : defaultCodex);
      continue;
    }
    if (provider.kind === "official-subscription" && provider.tool === "claude") {
      claudeDirs.add(provider.credentialsPath ? path.dirname(provider.credentialsPath) : defaultClaude);
      continue;
    }
    if (provider.kind === "official-subscription" && provider.tool === "grok") {
      continue;
    }

    // Coding-plan model families may appear in either CLI's local history.
    codexDirs.add(defaultCodex);
    claudeDirs.add(defaultClaude);
  }

  return { codexDirs, claudeDirs };
}

async function readSessionTree(rootDir, source, now, activeFileKeys) {
  const scanRoots = source === "codex"
    ? [path.join(rootDir, "sessions"), path.join(rootDir, "archived_sessions")]
    : [path.join(rootDir, "projects")];
  const cutoff = now - MAX_WINDOW_MS;
  const files = [];
  for (const scanRoot of scanRoots) await collectRecentJsonl(scanRoot, cutoff, files);
  return mapLimit(files, 8, (file) => readUsageFile(file, source, activeFileKeys));
}

async function collectRecentJsonl(dir, cutoff, files) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_error) {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRecentJsonl(entryPath, cutoff, files);
      return;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".jsonl") return;
    try {
      const stat = await fsp.stat(entryPath);
      if (stat.mtimeMs >= cutoff) files.push({ path: entryPath, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch (_error) {
      // A session can disappear while Codex or Claude rotates its history.
    }
  }));
}

async function readUsageFile(file, source, activeFileKeys) {
  const key = `${source}:${file.path}`;
  activeFileKeys?.add(key);
  const cached = fileCache.get(key);
  if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) return cached.events;

  try {
    const content = await fsp.readFile(file.path, "utf8");
    const events = source === "codex"
      ? parseCodexJsonl(content, file.path)
      : parseClaudeJsonl(content, file.path);
    fileCache.set(key, { mtimeMs: file.mtimeMs, size: file.size, events });
    return events;
  } catch (_error) {
    return [];
  }
}

function parseCodexJsonl(content, fileKey = "codex") {
  const events = [];
  const lines = String(content || "").split(/\r?\n/);
  let sessionId = path.basename(fileKey, path.extname(fileKey));
  let model = "unknown";
  let accountId = null;
  let accountEmail = null;
  let previous = null;
  let eventIndex = 0;
  let carriesHistorySnapshot = false;
  let historyReplayBoundary = -1;

  for (const line of lines) {
    if (!line || !line.includes("session_meta")) continue;
    const value = safeJson(line);
    if (value?.type !== "session_meta") continue;
    const payload = value.payload || {};
    const currentId = firstString([payload.id, payload.thread_id, payload.threadId, payload.session_id, payload.sessionId]);
    const parentId = firstString([payload.session_id, payload.sessionId]);
    if (currentId) sessionId = currentId;
    carriesHistorySnapshot = Boolean(
      firstString([payload.forked_from_id]) ||
      payload.source?.subagent ||
      (parentId && currentId && parentId !== currentId)
    );
    break;
  }

  if (carriesHistorySnapshot) {
    historyReplayBoundary = lines.findIndex((line) => {
      if (!line || (!line.includes("thread_settings_applied") && !line.includes("inter_agent_communication"))) return false;
      const value = safeJson(line);
      if (!value) return false;
      return String(value.type || "").startsWith("inter_agent_communication") ||
        (value.type === "event_msg" && value.payload?.type === "thread_settings_applied");
    });
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line || (!line.includes("session_meta") && !line.includes("turn_context") && !line.includes("token_count"))) continue;
    const value = safeJson(line);
    if (!value) continue;
    const payload = value.payload || {};

    if (value.type === "session_meta") {
      sessionId = String(payload.id || payload.thread_id || payload.threadId || payload.session_id || payload.sessionId || sessionId);
      accountId = firstString([payload.account_id, payload.accountId, payload.chatgpt_account_id, payload.info?.account_id, payload.info?.accountId]) || accountId;
      accountEmail = firstString([payload.email, payload.account_email, payload.accountEmail, payload.info?.email, payload.info?.account_email]) || accountEmail;
      continue;
    }
    if (value.type === "turn_context") {
      model = normalizeModelId(payload.model || payload.info?.model || model);
      accountId = firstString([payload.account_id, payload.accountId, payload.chatgpt_account_id, payload.info?.account_id, payload.info?.accountId]) || accountId;
      accountEmail = firstString([payload.email, payload.account_email, payload.accountEmail, payload.info?.email, payload.info?.account_email]) || accountEmail;
      continue;
    }
    if (value.type !== "event_msg" || payload.type !== "token_count" || !payload.info) continue;

    model = normalizeModelId(payload.info.model || payload.info.model_name || payload.model || model);
    accountId = firstString([payload.info.account_id, payload.info.accountId, payload.info.chatgpt_account_id, payload.account_id, payload.accountId]) || accountId;
    accountEmail = firstString([payload.info.email, payload.info.account_email, payload.info.accountEmail, payload.email, payload.account_email]) || accountEmail;
    const total = tokenShape(payload.info.total_token_usage);
    const last = tokenShape(payload.info.last_token_usage);
    if (!total && !last) continue;

    const delta = total ? subtractTokens(total, previous) : last;
    if (total) previous = total;
    if (historyReplayBoundary >= 0 && lineIndex < historyReplayBoundary) continue;
    if (!hasTokens(delta)) continue;
    eventIndex += 1;
    events.push(usageEvent({
      id: `codex:${sessionId}:${eventIndex}`,
      source: "codex",
      sessionId,
      model,
      accountId,
      accountEmail,
      timestamp: value.timestamp,
      ...delta,
    }));
  }
  return events;
}

function parseClaudeJsonl(content, fileKey = "claude") {
  const events = [];
  let fallbackIndex = 0;
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line || !line.includes('"assistant"')) continue;
    const value = safeJson(line);
    const message = value?.type === "assistant" ? value.message : null;
    if (!message?.usage) continue;
    const tokens = {
      inputTokens: numberOrZero(message.usage.input_tokens),
      outputTokens: numberOrZero(message.usage.output_tokens),
      cacheReadTokens: numberOrZero(message.usage.cache_read_input_tokens),
      cacheCreationTokens: numberOrZero(message.usage.cache_creation_input_tokens),
    };
    if (!hasTokens(tokens)) continue;
    fallbackIndex += 1;
    events.push(usageEvent({
      id: `claude:${message.id || `${path.basename(fileKey)}:${fallbackIndex}`}`,
      source: "claude",
      model: normalizeModelId(message.model),
      accountEmail: firstString([value.account_email, value.accountEmail, value.email, value.user_email, value.userEmail]),
      timestamp: value.timestamp,
      ...tokens,
    }));
  }
  return events;
}

function usageEvent(event) {
  const timestampMs = Date.parse(event.timestamp || "");
  const normalized = {
    ...event,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
    cacheIncludedInInput: event.source === "codex",
  };
  normalized.costUsd = calculateCostUsd(normalized);
  normalized.totalTokens =
    normalized.inputTokens +
    normalized.outputTokens +
    normalized.cacheCreationTokens +
    (normalized.cacheIncludedInInput ? 0 : normalized.cacheReadTokens);
  return normalized;
}

function attachUsageToProvider(provider, normalizedProvider, events, now = Date.now(), allProviders = []) {
  if (provider?.kind === "balance") {
    if (normalizedProvider?.usage || !supportsUsage(provider)) return normalizedProvider;
    const matching = matchingUsageEvents(provider, events || [], allProviders);
    return {
      ...normalizedProvider,
      usage: matching == null
        ? null
        : aggregateWindowUsage(matching, now - 7 * 24 * 60 * 60 * 1000, now, {
          scope: "近 7 天",
          estimated: true,
          source: "local",
          currency: "USD",
        }),
    };
  }

  if (!supportsUsage(provider) || !normalizedProvider?.tiers?.length) return normalizedProvider;
  const matching = matchingUsageEvents(provider, events || [], allProviders);

  return {
    ...normalizedProvider,
    tiers: normalizedProvider.tiers.map((tier) => ({
      ...tier,
      usage: matching == null ? null : aggregateTierUsage(tier, matching, now),
    })),
  };
}

function aggregateTierUsage(tier, events, now = Date.now()) {
  const duration = tierDurationMs(tier.name);
  if (!duration) return null;
  const resetAt = Date.parse(tier.resetsAt || "");
  const nominalStart = now - duration;
  const cycleStart = Number.isFinite(resetAt) && resetAt > nominalStart && resetAt < now + duration * 2
    ? resetAt - duration
    : nominalStart;
  const start = Math.min(cycleStart, nominalStart);
  return aggregateWindowUsage(events, start, now, { estimated: true, source: "local" });
}

function aggregateWindowUsage(events, start, end, metadata = {}) {
  const selected = events.filter((event) => event.timestampMs >= start && event.timestampMs <= end + 60_000);
  if (!selected.length) {
    return { ...metadata, requests: 0, totalTokens: 0, costUsd: 0, partialCost: false };
  }

  const priced = selected.filter((event) => event.costUsd != null);
  return {
    ...metadata,
    requests: selected.length,
    totalTokens: selected.reduce((sum, event) => sum + event.totalTokens, 0),
    costUsd: priced.length ? priced.reduce((sum, event) => sum + event.costUsd, 0) : null,
    partialCost: priced.length > 0 && priced.length < selected.length,
  };
}

function supportsUsage(provider) {
  if (provider?.kind === "official-subscription") return provider.tool !== "grok";
  if (provider?.kind === "coding-plan") return true;
  if (provider?.kind !== "balance") return false;
  const url = String(provider.baseUrl || "").toLowerCase();
  return url.includes("api.deepseek.com") || url.includes("api.moonshot") || url.includes("api.kimi");
}

function matchesProvider(provider, event) {
  const model = event.model || "";
  if (provider.kind === "official-subscription") {
    if (provider.tool === "codex") return event.source === "codex" && /^(?:gpt-|o\d|codex)/.test(model);
    if (provider.tool === "claude") return event.source === "claude" && /^claude-/.test(model);
    if (provider.tool === "grok") return false;
    return false;
  }

  const url = String(provider.baseUrl || "").toLowerCase();
  if (provider.kind === "balance") {
    if (url.includes("api.deepseek.com")) return /^deepseek-/.test(model);
    if (url.includes("api.moonshot") || url.includes("api.kimi")) return /^(?:kimi-|moonshot-)/.test(model);
    return false;
  }
  if (url.includes("kimi") || url.includes("moonshot")) return /^(?:kimi-|moonshot-)/.test(model);
  if (url.includes("bigmodel") || url.includes("z.ai")) return /^(?:glm-|zhipu-)/.test(model);
  if (url.includes("minimax")) return /^minimax-/.test(model);
  return false;
}

function summarizeCodexUsage(events, now = Date.now()) {
  const codexEvents = (events || []).filter((event) => event.source === "codex" && event.timestampMs > 0);
  const todayStart = startOfLocalDay(now);
  const sevenDayStart = startOfLocalDay(now - 6 * 24 * 60 * 60 * 1000);
  const thirtyDayStart = startOfLocalDay(now - 29 * 24 * 60 * 60 * 1000);
  const windows = {
    today: summarizeUsageWindow(codexEvents, todayStart, now),
    sevenDays: summarizeUsageWindow(codexEvents, sevenDayStart, now),
    thirtyDays: summarizeUsageWindow(codexEvents, thirtyDayStart, now),
  };

  const thirtyDayEvents = codexEvents.filter((event) => event.timestampMs >= thirtyDayStart && event.timestampMs <= now + 60_000);
  const byModel = new Map();
  for (const event of thirtyDayEvents) {
    const key = event.model || "unknown";
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push(event);
  }

  const models = [...byModel.entries()]
    .map(([model, modelEvents]) => ({ model, ...summarizeUsageWindow(modelEvents, thirtyDayStart, now) }))
    .sort((left, right) => right.totalTokens - left.totalTokens || right.requests - left.requests);

  const daily = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const dayStart = startOfLocalDay(now - offset * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    daily.push({
      date: localDateKey(dayStart),
      ...summarizeUsageWindow(codexEvents, dayStart, Math.min(now, dayEnd.getTime() - 1)),
    });
  }

  return {
    generatedAt: now,
    lastEventAt: codexEvents.reduce((latest, event) => Math.max(latest, event.timestampMs), 0) || null,
    windows,
    daily,
    models,
  };
}

function summarizeUsageWindow(events, start, end) {
  const selected = (events || []).filter((event) => event.timestampMs >= start && event.timestampMs <= end + 60_000);
  const priced = selected.filter((event) => event.costUsd != null);
  return {
    requests: selected.length,
    sessions: new Set(selected.map((event) => event.sessionId || event.id.split(":").slice(0, 2).join(":"))).size,
    inputTokens: selected.reduce((sum, event) => sum + event.inputTokens, 0),
    outputTokens: selected.reduce((sum, event) => sum + event.outputTokens, 0),
    cacheReadTokens: selected.reduce((sum, event) => sum + event.cacheReadTokens, 0),
    cacheCreationTokens: selected.reduce((sum, event) => sum + event.cacheCreationTokens, 0),
    totalTokens: selected.reduce((sum, event) => sum + event.totalTokens, 0),
    costUsd: priced.length ? priced.reduce((sum, event) => sum + event.costUsd, 0) : selected.length ? null : 0,
    partialCost: priced.length > 0 && priced.length < selected.length,
  };
}

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function localDateKey(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function matchingUsageEvents(provider, events, allProviders = []) {
  const providerMatches = (events || []).filter((event) => matchesProvider(provider, event));
  if (!providerMatches.length) return [];

  const sameFamilyProviders = (allProviders || []).filter(
    (item) => supportsUsage(item) && providerFamilyKey(item) === providerFamilyKey(provider),
  );
  // A single configured account owns every matching event in its provider family,
  // even when the local log has a richer identity than config.json.
  if (sameFamilyProviders.length <= 1) return providerMatches;

  const ownMatches = providerMatches.filter((event) => matchesProviderIdentity(provider, event));
  if (ownMatches.length) return ownMatches;

  const providerIdentity = providerUsageIdentity(provider);
  // Multiple accounts without a usable identity are ambiguous. Returning null
  // deliberately renders no estimate instead of duplicating or silently losing usage.
  if (!providerIdentity) return null;
  return null;
}

function matchesProviderIdentity(provider, event) {
  const providerIdentity = providerUsageIdentity(provider);
  const eventIdentity = eventUsageIdentity(event);
  return Boolean(providerIdentity && eventIdentity && providerIdentity === eventIdentity);
}

function providerUsageIdentity(provider) {
  const accountId = normalizeIdentity(provider?.accountId);
  if (accountId) return `id:${accountId}`;
  const email = normalizeEmail(provider?.accountEmail || provider?.email);
  return email ? `email:${email}` : null;
}

function eventUsageIdentity(event) {
  const accountId = normalizeIdentity(event?.accountId);
  if (accountId) return `id:${accountId}`;
  const email = normalizeEmail(event?.accountEmail || event?.email);
  return email ? `email:${email}` : null;
}

function providerFamilyKey(provider) {
  if (provider?.kind === "official-subscription") return `official:${provider.tool || ""}`;
  if (provider?.kind === "balance") return `balance:${String(provider.baseUrl || "").toLowerCase()}`;
  return `${provider?.kind || ""}:${String(provider?.baseUrl || "").toLowerCase()}`;
}

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function firstString(values) {
  for (const value of values || []) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function tierDurationMs(name) {
  if (name === "five_hour") return 5 * 60 * 60 * 1000;
  if (["seven_day", "weekly_limit", "seven_day_opus", "seven_day_sonnet"].includes(name)) {
    return 7 * 24 * 60 * 60 * 1000;
  }
  const hour = /^(\d+)_hour$/.exec(name || "");
  if (hour) return Number(hour[1]) * 60 * 60 * 1000;
  const day = /^(\d+)_day$/.exec(name || "");
  return day ? Number(day[1]) * 24 * 60 * 60 * 1000 : null;
}

function tokenShape(value) {
  if (!value || typeof value !== "object") return null;
  return {
    inputTokens: numberOrZero(value.input_tokens),
    outputTokens: numberOrZero(value.output_tokens),
    cacheReadTokens: numberOrZero(value.cached_input_tokens ?? value.cache_read_input_tokens),
    cacheCreationTokens: numberOrZero(value.cache_creation_input_tokens),
  };
}

function subtractTokens(current, previous) {
  if (!previous) return current;
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    cacheReadTokens: Math.max(0, current.cacheReadTokens - previous.cacheReadTokens),
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens - previous.cacheCreationTokens),
  };
}

function hasTokens(tokens) {
  return tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens > 0;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch (_error) {
    return null;
  }
}

function dedupeEvents(events) {
  const byId = new Map();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (!existing || event.totalTokens > existing.totalTokens) byId.set(event.id, event);
  }
  return [...byId.values()];
}

async function mapLimit(items, limit, worker) {
  const result = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      result[current] = await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return result.flat();
}

module.exports = {
  collectLocalUsage,
  collectCodexAgentUsage,
  parseCodexJsonl,
  parseClaudeJsonl,
  attachUsageToProvider,
  aggregateTierUsage,
  aggregateWindowUsage,
  matchesProvider,
  matchingUsageEvents,
  summarizeCodexUsage,
  tierDurationMs,
};
