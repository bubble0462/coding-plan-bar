const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const OPEN_CODE_WINDOWS = [
  { key: "today", days: 1 },
  { key: "sevenDays", days: 7 },
  { key: "thirtyDays", days: 30 },
];
const OPEN_CODE_MODEL_LIMIT = 12;
const OPEN_CODE_TIMEOUT_MS = 30_000;

async function collectOpenCodeAgentUsage(options = {}) {
  const now = Number(options.now) || Date.now();
  const runStats = options.runStats || runOpenCodeStats;

  try {
    const outputs = await Promise.all(OPEN_CODE_WINDOWS.map(async ({ key, days }) => {
      const models = key === "thirtyDays" ? OPEN_CODE_MODEL_LIMIT : 0;
      const output = await runStats(days, models);
      return [key, parseOpenCodeStats(output)];
    }));
    const windows = Object.fromEntries(outputs.map(([key, parsed]) => [key, parsed.summary]));
    const thirtyDays = outputs.find(([key]) => key === "thirtyDays")?.[1] || { models: [] };

    return {
      available: true,
      generatedAt: now,
      windows,
      models: thirtyDays.models,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      generatedAt: now,
      windows: {},
      models: [],
      error: formatOpenCodeError(error),
    };
  }
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
    return "\u672a\u68c0\u6d4b\u5230 OpenCode CLI\u3002\u8bf7\u5b89\u88c5 OpenCode \u540e\u91cd\u65b0\u7edf\u8ba1\u3002";
  }
  if (error?.code === "ETIMEDOUT") return "OpenCode \u7edf\u8ba1\u8d85\u65f6\uff0c\u8bf7\u786e\u8ba4 OpenCode \u53ef\u4ee5\u6b63\u5e38\u8fd0\u884c\u540e\u91cd\u8bd5\u3002";
  return "OpenCode \u7edf\u8ba1\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u672c\u673a OpenCode CLI \u53ef\u4ee5\u6b63\u5e38\u8fd0\u884c\u540e\u91cd\u8bd5\u3002";
}
module.exports = {
  OPEN_CODE_MODEL_LIMIT,
  collectOpenCodeAgentUsage,
  parseCompactMoney,
  parseCompactNumber,
  parseOpenCodeStats,
  runOpenCodeStats,
};
