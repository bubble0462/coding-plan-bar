const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { calculateCostUsd, normalizeModelId } = require("./model-pricing");

const MAX_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const fileCache = new Map();

async function collectLocalUsage(providers, now = Date.now()) {
  const requirements = usageRequirements(providers);
  const jobs = [];
  for (const dir of requirements.codexDirs) jobs.push(readSessionTree(dir, "codex", now));
  for (const dir of requirements.claudeDirs) jobs.push(readSessionTree(dir, "claude", now));
  const groups = await Promise.all(jobs);
  return dedupeEvents(groups.flat());
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

    // Coding-plan model families may appear in either CLI's local history.
    codexDirs.add(defaultCodex);
    claudeDirs.add(defaultClaude);
  }

  return { codexDirs, claudeDirs };
}

async function readSessionTree(rootDir, source, now) {
  const scanRoots = source === "codex"
    ? [path.join(rootDir, "sessions"), path.join(rootDir, "archived_sessions")]
    : [path.join(rootDir, "projects")];
  const cutoff = now - MAX_WINDOW_MS;
  const files = [];
  for (const scanRoot of scanRoots) await collectRecentJsonl(scanRoot, cutoff, files);
  return mapLimit(files, 8, (file) => readUsageFile(file, source));
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

async function readUsageFile(file, source) {
  const key = `${source}:${file.path}`;
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
  let sessionId = path.basename(fileKey, path.extname(fileKey));
  let model = "unknown";
  let previous = null;
  let eventIndex = 0;

  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line || (!line.includes("session_meta") && !line.includes("turn_context") && !line.includes("token_count"))) continue;
    const value = safeJson(line);
    if (!value) continue;
    const payload = value.payload || {};

    if (value.type === "session_meta") {
      sessionId = String(payload.id || payload.session_id || payload.sessionId || sessionId);
      continue;
    }
    if (value.type === "turn_context") {
      model = normalizeModelId(payload.model || payload.info?.model || model);
      continue;
    }
    if (value.type !== "event_msg" || payload.type !== "token_count" || !payload.info) continue;

    model = normalizeModelId(payload.info.model || payload.info.model_name || payload.model || model);
    const total = tokenShape(payload.info.total_token_usage);
    const last = tokenShape(payload.info.last_token_usage);
    if (!total && !last) continue;

    const delta = total ? subtractTokens(total, previous) : last;
    if (total) previous = total;
    if (!hasTokens(delta)) continue;
    eventIndex += 1;
    events.push(usageEvent({
      id: `codex:${sessionId}:${eventIndex}`,
      source: "codex",
      model,
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

function attachUsageToProvider(provider, normalizedProvider, events, now = Date.now()) {
  if (!supportsUsage(provider) || !normalizedProvider?.tiers?.length) return normalizedProvider;
  const matching = (events || []).filter((event) => matchesProvider(provider, event));

  return {
    ...normalizedProvider,
    tiers: normalizedProvider.tiers.map((tier) => ({
      ...tier,
      usage: aggregateTierUsage(tier, matching, now),
    })),
  };
}

function aggregateTierUsage(tier, events, now = Date.now()) {
  const duration = tierDurationMs(tier.name);
  if (!duration) return null;
  const resetAt = Date.parse(tier.resetsAt || "");
  const start = Number.isFinite(resetAt) && resetAt > now - duration && resetAt < now + duration * 2
    ? resetAt - duration
    : now - duration;
  const selected = events.filter((event) => event.timestampMs >= start && event.timestampMs <= now + 60_000);
  if (!selected.length) return { requests: 0, totalTokens: 0, costUsd: 0, partialCost: false };

  const priced = selected.filter((event) => event.costUsd != null);
  return {
    requests: selected.length,
    totalTokens: selected.reduce((sum, event) => sum + event.totalTokens, 0),
    costUsd: priced.length ? priced.reduce((sum, event) => sum + event.costUsd, 0) : null,
    partialCost: priced.length > 0 && priced.length < selected.length,
  };
}

function supportsUsage(provider) {
  return provider?.kind === "official-subscription" || provider?.kind === "coding-plan";
}

function matchesProvider(provider, event) {
  const model = event.model || "";
  if (provider.kind === "official-subscription") {
    if (provider.tool === "codex") return event.source === "codex" && /^(?:gpt-|o\d|codex)/.test(model);
    if (provider.tool === "claude") return event.source === "claude" && /^claude-/.test(model);
    return false;
  }

  const url = String(provider.baseUrl || "").toLowerCase();
  if (url.includes("kimi") || url.includes("moonshot")) return /^(?:kimi-|moonshot-)/.test(model);
  if (url.includes("bigmodel") || url.includes("z.ai")) return /^(?:glm-|zhipu-)/.test(model);
  if (url.includes("minimax")) return /^minimax-/.test(model);
  return false;
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
  parseCodexJsonl,
  parseClaudeJsonl,
  attachUsageToProvider,
  aggregateTierUsage,
  matchesProvider,
  tierDurationMs,
};
