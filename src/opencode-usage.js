const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { calculateCostUsd } = require("./model-pricing");

const OPEN_CODE_MODEL_LIMIT = 12;
const OPEN_CODE_TIMEOUT_MS = 30_000;
const OPEN_CODE_DB_CANDIDATES = [
  path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"),
  path.join(process.env.XDG_DATA_HOME || "", "opencode", "opencode.db"),
];

/**
 * Collect OpenCode usage for today / 7d / 30d.
 *
 * Prefer the local opencode.db so every window can be cut consistently and
 * priced per model via public API list prices. CLI stats remain a fallback
 * when the database is missing or unreadable.
 */
async function collectOpenCodeAgentUsage(options = {}) {
  const now = Number(options.now) || Date.now();
  const runStats = options.runStats || runOpenCodeStats;
  const resolveDbPath = options.resolveDbPath || resolveOpenCodeDatabasePath;
  const collectFromDatabase = options.collectFromDatabase || collectOpenCodeUsageFromDatabase;

  try {
    const dbPath = resolveDbPath(options);
    if (dbPath) {
      const dayStart = localDayStartMs(now);
      const sevenStart = now - 7 * 24 * 60 * 60 * 1000;
      const thirtyStart = now - 30 * 24 * 60 * 60 * 1000;
      // One scan from the earliest bound; derive all windows in memory.
      const scanned = collectFromDatabase({
        now,
        startMs: thirtyStart,
        dbPath,
        resolveDbPath: () => dbPath,
      });
      const today = sliceOpenCodeAggregate(scanned, dayStart, now, { calendarDay: true });
      const sevenDays = sliceOpenCodeAggregate(scanned, sevenStart, now, { calendarDay: false });
      const thirtyDays = sliceOpenCodeAggregate(scanned, thirtyStart, now, { calendarDay: false });
      // sliceOpenCodeAggregate already applies public-API estimates once.
      const models = (thirtyDays.models || []).slice(0, OPEN_CODE_MODEL_LIMIT);

      return {
        available: true,
        generatedAt: now,
        windows: {
          today: today.summary,
          sevenDays: sevenDays.summary,
          thirtyDays: thirtyDays.summary,
        },
        models,
        todaySource: "database",
        source: "database",
        error: null,
      };
    }

    return collectOpenCodeAgentUsageFromCli({ now, runStats });
  } catch (error) {
    try {
      return await collectOpenCodeAgentUsageFromCli({ now, runStats, fallbackError: error });
    } catch (cliError) {
      return {
        available: false,
        generatedAt: now,
        windows: {},
        models: [],
        error: formatOpenCodeError(cliError),
      };
    }
  }
}

async function collectOpenCodeAgentUsageFromCli(options = {}) {
  const now = Number(options.now) || Date.now();
  const runStats = options.runStats || runOpenCodeStats;
  const windowsSpec = [
    { key: "today", days: 1 },
    { key: "sevenDays", days: 7 },
    { key: "thirtyDays", days: 30 },
  ];
  const outputs = await Promise.all(windowsSpec.map(async ({ key, days }) => {
    const models = key === "thirtyDays" ? OPEN_CODE_MODEL_LIMIT : 0;
    const output = await runStats(days, models);
    return [key, parseOpenCodeStats(output)];
  }));
  const windows = {};
  for (const [key, parsed] of outputs) {
    windows[key] = applyEstimatedCostToSummary(parsed.summary);
    if (key === "today") windows[key] = { ...windows[key], calendarDay: false };
  }
  const thirty = outputs.find(([key]) => key === "thirtyDays")?.[1] || { models: [] };
  const models = applyEstimatedCostsToModels(thirty.models || []);
  if (models.length) {
    windows.thirtyDays = mergeSummaryWithModelEstimates(windows.thirtyDays, models);
    windows.sevenDays = mergeSummaryWithModelEstimates(windows.sevenDays, models);
    // today has no model breakdown from CLI without --models; keep summary-only.
  }
  return {
    available: true,
    generatedAt: now,
    windows,
    models,
    todaySource: "cli-fallback",
    source: "cli-fallback",
    error: null,
  };
}

function resolveOpenCodeDatabasePath(options = {}) {
  const configured = String(options.dbPath || process.env.OPENCODE_DB_PATH || "").trim();
  if (configured && fs.existsSync(configured)) return configured;
  for (const candidate of OPEN_CODE_DB_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function localDayStartMs(now = Date.now()) {
  const date = new Date(Number(now) || Date.now());
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Scan completed assistant messages from opencode.db since startMs.
 * Returns raw per-message events for further window slicing.
 */
function collectOpenCodeUsageFromDatabase(options = {}) {
  const now = Number(options.now) || Date.now();
  const startMs = Number.isFinite(options.startMs) ? Number(options.startMs) : localDayStartMs(now);
  const resolveDbPath = options.resolveDbPath || resolveOpenCodeDatabasePath;
  const dbPath = resolveDbPath(options);
  if (!dbPath) {
    const error = new Error("OpenCode database not found");
    error.code = "OPENCODE_DB_MISSING";
    throw error;
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (error) {
    error.code = "OPENCODE_SQLITE_UNAVAILABLE";
    throw error;
  }

  let database;
  try {
    database = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    error.code = "OPENCODE_DB_OPEN_FAILED";
    throw error;
  }

  try {
    // Prefilter by row time_created for speed; final cut uses message.time.completed.
    const lowerBound = Math.max(0, startMs - 6 * 60 * 60 * 1000);
    const rows = database
      .prepare("SELECT session_id, time_created, data FROM message WHERE time_created >= ?")
      .all(lowerBound);

    const events = [];
    for (const row of rows) {
      let payload;
      try {
        payload = JSON.parse(row.data);
      } catch (_error) {
        continue;
      }
      if (payload?.role !== "assistant" || !payload.tokens) continue;
      const time = payload.time || {};
      if (time.completed == null) continue;
      const stamp = Number(time.completed || time.created || row.time_created || 0);
      if (!Number.isFinite(stamp) || stamp < startMs || stamp > now + 60_000) continue;

      const tokens = payload.tokens || {};
      const cache = tokens.cache || {};
      const input = Math.max(0, Number(tokens.input) || 0);
      const output = Math.max(0, (Number(tokens.output) || 0) + (Number(tokens.reasoning) || 0));
      const cacheRead = Math.max(0, Number(cache.read) || 0);
      const cacheWrite = Math.max(0, Number(cache.write) || 0);
      if (input + output + cacheRead + cacheWrite <= 0) continue;

      const recordedCost = Number(payload.cost);
      events.push({
        sessionId: String(row.session_id || ""),
        stamp,
        model: String(payload.modelID || payload.model || "unknown"),
        providerId: payload.providerID || null,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheWrite,
        recordedCostUsd: Number.isFinite(recordedCost) && recordedCost > 0 ? recordedCost : 0,
      });
    }

    return { events, dbPath, startMs, now, source: "database" };
  } finally {
    try {
      database.close();
    } catch (_error) {
      // Ignore close errors on a read-only handle.
    }
  }
}

/** Back-compat wrapper used by older tests. */
function collectOpenCodeTodayFromDatabase(options = {}) {
  const now = Number(options.now) || Date.now();
  const startMs = Number.isFinite(options.startMs) ? Number(options.startMs) : localDayStartMs(now);
  const scanned = collectOpenCodeUsageFromDatabase({ ...options, now, startMs });
  const sliced = sliceOpenCodeAggregate(scanned, startMs, now, { calendarDay: true });
  return {
    summary: sliced.summary,
    models: sliced.models,
    source: "database",
    dbPath: scanned.dbPath,
  };
}

function sliceOpenCodeAggregate(scanned, startMs, endMs, flags = {}) {
  const events = (scanned.events || []).filter((event) => event.stamp >= startMs && event.stamp <= endMs + 60_000);
  const sessions = new Set();
  const byModel = new Map();
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let recordedCostUsd = 0;

  for (const event of events) {
    requests += 1;
    if (event.sessionId) sessions.add(event.sessionId);
    inputTokens += event.inputTokens;
    outputTokens += event.outputTokens;
    cacheReadTokens += event.cacheReadTokens;
    cacheCreationTokens += event.cacheCreationTokens;
    recordedCostUsd += event.recordedCostUsd || 0;

    const key = event.model || "unknown";
    const current = byModel.get(key) || {
      model: key,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      recordedCostUsd: 0,
      costUsd: 0,
      partialCost: false,
    };
    current.requests += 1;
    current.inputTokens += event.inputTokens;
    current.outputTokens += event.outputTokens;
    current.cacheReadTokens += event.cacheReadTokens;
    current.cacheCreationTokens += event.cacheCreationTokens;
    current.recordedCostUsd += event.recordedCostUsd || 0;
    byModel.set(key, current);
  }

  const rawModels = [...byModel.values()].map((item) => ({
    ...item,
    totalTokens: item.inputTokens + item.outputTokens + item.cacheReadTokens + item.cacheCreationTokens,
    // Feed recorded cost into estimator; $0 falls through to public API pricing.
    costUsd: item.recordedCostUsd > 0 ? item.recordedCostUsd : 0,
  }));
  const models = applyEstimatedCostsToModels(rawModels)
    .sort((left, right) => right.totalTokens - left.totalTokens || right.requests - left.requests);

  const priced = models.filter((item) => item.costUsd != null && Number.isFinite(Number(item.costUsd)));
  const estimatedTotal = priced.reduce((sum, item) => sum + Number(item.costUsd), 0);
  const partialCost = priced.length > 0 && priced.length < models.length;
  const hasPriced = priced.length > 0;

  const summary = {
    sessions: sessions.size,
    requests,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    costUsd: hasPriced ? estimatedTotal : recordedCostUsd > 0 ? recordedCostUsd : null,
    partialCost: hasPriced ? partialCost : false,
    costSource: hasPriced ? "estimated" : recordedCostUsd > 0 ? "recorded" : "unpriced",
    rangeStartAt: startMs,
    rangeEndAt: endMs,
    calendarDay: Boolean(flags.calendarDay),
  };

  return { summary, models };
}

async function runOpenCodeStats(days, models = 0, options = {}) {
  const parsedDays = Number(days);
  if (!Number.isInteger(parsedDays) || parsedDays <= 0) throw new Error("Invalid OpenCode stats day range");

  const args = ["stats", "--pure", "--days", String(parsedDays)];
  if (Number.isInteger(Number(models)) && Number(models) > 0) {
    args.push("--models", String(Math.min(100, Number(models))));
  }
  const command = resolveOpenCodeCommand();
  const timeoutMs = Number(options.timeoutMs) || OPEN_CODE_TIMEOUT_MS;

  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    const cmdLine = [command, ...args].map(quoteWindowsArgument).join(" ");
    return runProcess(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmdLine], timeoutMs);
  }
  return runProcess(command, args, timeoutMs);
}

function resolveOpenCodeCommand() {
  const configured = String(process.env.OPENCODE_BIN || "").trim();
  if (configured && fs.existsSync(configured)) return configured;

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const npmBinary = path.join(appData, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (fs.existsSync(npmBinary)) return npmBinary;
    const npmCommand = path.join(appData, "npm", "opencode.cmd");
    if (fs.existsSync(npmCommand)) return npmCommand;
  }

  return process.platform === "win32" ? "opencode.cmd" : "opencode";
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error("OpenCode stats timed out");
      error.code = "ETIMEDOUT";
      finish(() => reject(error));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      if (code === 0) {
        finish(() => resolve(stdout));
        return;
      }
      const error = new Error(`OpenCode stats exited with code ${code ?? "unknown"}`);
      error.code = "OPENCODE_EXIT";
      error.stderr = stderr;
      finish(() => reject(error));
    });
  });
}

function parseOpenCodeStats(output) {
  const lines = normalizeStatsLines(output);
  const overview = findSection(lines, "OVERVIEW", ["COST & TOKENS"]);
  const costAndTokens = findSection(lines, "COST & TOKENS", ["MODEL USAGE"]);
  if (!overview.length || !costAndTokens.length) {
    throw new Error("无法识别 OpenCode stats 输出");
  }

  const summary = {
    sessions: metricNumber(overview, "Sessions") ?? 0,
    requests: metricNumber(overview, "Messages") ?? 0,
    inputTokens: metricNumber(costAndTokens, "Input") ?? 0,
    outputTokens: metricNumber(costAndTokens, "Output") ?? 0,
    cacheReadTokens: metricNumber(costAndTokens, "Cache Read") ?? 0,
    cacheCreationTokens: metricNumber(costAndTokens, "Cache Write") ?? 0,
    costUsd: metricMoney(costAndTokens, "Total Cost"),
    partialCost: false,
  };
  summary.totalTokens = summary.inputTokens + summary.outputTokens + summary.cacheReadTokens + summary.cacheCreationTokens;

  return {
    summary,
    models: parseOpenCodeModels(findSection(lines, "MODEL USAGE", ["TOOL USAGE"])),
  };
}

function normalizeStatsLines(output) {
  return stripAnsi(String(output || ""))
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\x20-\x7e]/g, " ").trim())
    .filter(Boolean);
}

function stripAnsi(value) {
  const escape = String.fromCharCode(27);
  const csi = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, "g");
  return String(value || "").replace(csi, "");
}

function findSection(lines, title, nextTitles) {
  const start = lines.findIndex((line) => line.toUpperCase() === title);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && nextTitles.includes(line.toUpperCase()));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

function metricNumber(lines, label) {
  const value = metricValue(lines, label);
  return value == null ? null : parseCompactNumber(value);
}

function metricMoney(lines, label) {
  const value = metricValue(lines, label);
  return value == null ? null : parseCompactMoney(value);
}

function metricValue(lines, label) {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\s+(.+?)$`, "i");
  const line = (lines || []).find((item) => pattern.test(item));
  return line ? line.match(pattern)?.[1]?.trim() || null : null;
}

function parseOpenCodeModels(lines) {
  const models = [];
  let current = null;
  const commit = () => {
    if (!current) return;
    current.totalTokens = current.inputTokens + current.outputTokens + current.cacheReadTokens + current.cacheCreationTokens;
    models.push(current);
    current = null;
  };

  for (const line of lines || []) {
    if (isOpenCodeModelId(line)) {
      commit();
      current = {
        model: line,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: null,
        partialCost: false,
      };
      continue;
    }
    if (!current) continue;
    const messages = metricNumber([line], "Messages");
    const input = metricNumber([line], "Input Tokens");
    const output = metricNumber([line], "Output Tokens");
    const cacheRead = metricNumber([line], "Cache Read");
    const cacheWrite = metricNumber([line], "Cache Write");
    const cost = metricMoney([line], "Cost");
    if (messages != null) current.requests = messages;
    else if (input != null) current.inputTokens = input;
    else if (output != null) current.outputTokens = output;
    else if (cacheRead != null) current.cacheReadTokens = cacheRead;
    else if (cacheWrite != null) current.cacheCreationTokens = cacheWrite;
    else if (cost != null) current.costUsd = cost;
  }
  commit();
  return models.sort((left, right) => right.totalTokens - left.totalTokens || right.requests - left.requests);
}

/**
 * OpenCode records provider cost when available; CPA / coding-plan / free models
 * often report $0. Fill gaps with public API list-price estimates (Anthropic-style:
 * input is fresh tokens, cache is separate).
 */
function applyEstimatedCostsToModels(models, now = Date.now()) {
  return (models || []).map((item) => {
    const estimated = estimateOpenCodeUsageCost(item, now);
    const recorded = Number(item?.costUsd);
    const hasRecorded = Number.isFinite(recorded) && recorded > 0;
    if (hasRecorded) {
      return {
        ...item,
        costUsd: recorded,
        estimatedCostUsd: estimated,
        partialCost: false,
        costSource: "recorded",
      };
    }
    if (estimated != null) {
      return {
        ...item,
        costUsd: estimated,
        estimatedCostUsd: estimated,
        partialCost: false,
        costSource: "estimated",
      };
    }
    return {
      ...item,
      costUsd: null,
      estimatedCostUsd: null,
      partialCost: false,
      costSource: "unpriced",
    };
  });
}

function applyEstimatedCostToSummary(summary) {
  if (!summary || typeof summary !== "object") return summary;
  const recorded = Number(summary.costUsd);
  if (Number.isFinite(recorded) && recorded > 0) {
    return { ...summary, costSource: "recorded", partialCost: Boolean(summary.partialCost) };
  }
  if (Number.isFinite(recorded) && recorded === 0) {
    return { ...summary, costUsd: null, costSource: "unpriced", partialCost: false };
  }
  return { ...summary, costSource: summary.costSource || "recorded" };
}

function mergeSummaryWithModelEstimates(summary, models) {
  const base = summary || {};
  const priced = (models || []).filter((item) => item.costUsd != null && Number.isFinite(Number(item.costUsd)));
  if (!priced.length) return applyEstimatedCostToSummary(base);
  const estimatedTotal = priced.reduce((sum, item) => sum + Number(item.costUsd), 0);
  const partial = priced.length < (models || []).length;
  return {
    ...base,
    costUsd: estimatedTotal,
    partialCost: partial,
    costSource: "estimated",
  };
}

function estimateOpenCodeUsageCost(usage, now = Date.now()) {
  return calculateCostUsd({
    model: usage?.model,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cacheReadTokens: usage?.cacheReadTokens,
    cacheCreationTokens: usage?.cacheCreationTokens,
    // OpenCode / Anthropic-style: cache is not included in input.
    cacheIncludedInInput: false,
    now,
  });
}

function isOpenCodeModelId(value) {
  const line = String(value || "").trim();
  return line.includes("/") && !/\s/.test(line) && !line.startsWith("/") && !line.endsWith("/");
}

function parseCompactNumber(value) {
  const match = String(value || "").replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([KMBT])?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const units = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 };
  const multiplier = units[String(match[2] || "").toLowerCase()] || 1;
  return Math.round(amount * multiplier);
}

function parseCompactMoney(value) {
  const match = String(value || "").replace(/,/g, "").match(/\$\s*(-?\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const units = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
  return amount * (units[String(match[2] || "").toLowerCase()] || 1);
}

function quoteWindowsArgument(value) {
  const text = String(value);
  return /[\s"]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatOpenCodeError(error) {
  const detail = `${error?.message || ""}\n${error?.stderr || ""}`.toLowerCase();
  if (error?.code === "ENOENT" || /not recognized|not found|is not recognized/.test(detail)) {
    return "未检测到 OpenCode CLI。请安装 OpenCode 后重新统计。";
  }
  if (error?.code === "ETIMEDOUT") return "OpenCode 统计超时，请确认 OpenCode 可以正常运行后重试。";
  if (error?.code === "OPENCODE_DB_MISSING" || error?.code === "OPENCODE_DB_OPEN_FAILED") {
    return "无法读取本机 OpenCode 数据库，请确认 OpenCode 已产生使用记录后重试。";
  }
  return "OpenCode 统计失败，请确认本机 OpenCode 可以正常运行后重试。";
}

module.exports = {
  OPEN_CODE_MODEL_LIMIT,
  applyEstimatedCostsToModels,
  collectOpenCodeAgentUsage,
  collectOpenCodeTodayFromDatabase,
  collectOpenCodeUsageFromDatabase,
  estimateOpenCodeUsageCost,
  localDayStartMs,
  parseCompactMoney,
  parseCompactNumber,
  parseOpenCodeStats,
  resolveOpenCodeDatabasePath,
  runOpenCodeStats,
  sliceOpenCodeAggregate,
};
