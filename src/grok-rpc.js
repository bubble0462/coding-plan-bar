const { spawn, execFileSync } = require("child_process");

const DEFAULT_INITIALIZE_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const MAX_STDERR_CHARS = 4000;

async function fetchGrokBillingViaCli(options = {}) {
  const executable = options.executable || resolveGrokExecutable(options);
  if (!executable) throw grokError("GROK_CLI_NOT_FOUND", "未找到 Grok Build CLI");

  const spawnImpl = options.spawnImpl || spawn;
  const child = spawnImpl(executable, ["agent", "stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: options.env || process.env,
  });
  const pending = new Map();
  let nextId = 1;
  let stdoutBuffer = "";
  let stderr = "";
  let closedError = null;

  function rejectPending(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) handleLine(line);
      newline = stdoutBuffer.indexOf("\n");
    }
  });
  child.stderr?.setEncoding?.("utf8");
  child.stderr?.on?.("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
  });
  child.on("error", (error) => {
    closedError = grokError("GROK_CLI_START_FAILED", `Grok CLI 启动失败：${error.message}`);
    rejectPending(closedError);
  });
  child.on("exit", (code) => {
    if (pending.size) {
      closedError ||= grokError(
        "GROK_CLI_EXITED",
        `Grok CLI 已退出（${code == null ? "未知状态" : `code ${code}`}）${stderr.trim() ? `：${safeStderr(stderr)}` : ""}`,
      );
      rejectPending(closedError);
    }
  });

  function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (_error) {
      return;
    }
    if (message?.id == null) return;
    const entry = pending.get(Number(message.id));
    if (!entry) return;
    pending.delete(Number(message.id));
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(grokError(
        Number(message.error.code) === -32601 ? "GROK_RPC_UNAVAILABLE" : "GROK_RPC_FAILED",
        safeRpcMessage(message.error.message || "Grok RPC 返回错误"),
      ));
      return;
    }
    entry.resolve(message.result);
  }

  function request(method, params, timeoutMs) {
    if (closedError) return Promise.reject(closedError);
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(grokError("GROK_RPC_TIMEOUT", `Grok RPC ${method} 超时`));
        stopChild(child);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      child.stdin.write(`${payload}\n`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(grokError("GROK_RPC_WRITE_FAILED", `无法写入 Grok RPC：${error.message}`));
      });
    });
  }

  try {
    await request(
      "initialize",
      {
        protocolVersion: "1",
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      options.initializeTimeoutMs || DEFAULT_INITIALIZE_TIMEOUT_MS,
    );
    const result = await request("x.ai/billing", {}, options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
    if (!result || typeof result !== "object") {
      throw grokError("GROK_RPC_INVALID", "Grok RPC billing 响应无效");
    }
    return result;
  } finally {
    rejectPending(grokError("GROK_RPC_CANCELLED", "Grok RPC 已结束"));
    stopChild(child);
  }
}

let resolvedGrokExecutable = null;
let hasResolvedGrokExecutable = false;

function resolveGrokExecutable(options = {}) {
  const env = options.env || process.env;
  if (env.GROK_CLI_PATH) return env.GROK_CLI_PATH;
  // Memoize the resolved path on the production path (no injected env/impl).
  // Grok install locations don't move; a not-found result stays uncached so a
  // later install is picked up.
  const canUseCache = !options.env && !options.execFileSyncImpl;
  if (canUseCache && hasResolvedGrokExecutable) return resolvedGrokExecutable;
  const command = process.platform === "win32" ? "where.exe" : "which";
  try {
    const lookup = options.execFileSyncImpl || execFileSync;
    const output = lookup(command, ["grok"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const found = String(output || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
    if (canUseCache && found) {
      hasResolvedGrokExecutable = true;
      resolvedGrokExecutable = found;
    }
    return found;
  } catch (_error) {
    return null;
  }
}

function stopChild(child) {
  if (!child || child.killed) return;
  try {
    child.stdin?.end?.();
  } catch (_error) {
    // Ignore a pipe that was already closed by the CLI.
  }
  try {
    child.kill();
  } catch (_error) {
    // Process already exited.
  }
}

function grokError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeRpcMessage(value) {
  return String(value || "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[a-zA-Z0-9._-]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function safeStderr(value) {
  return safeRpcMessage(value).slice(0, 180);
}

module.exports = {
  fetchGrokBillingViaCli,
  resolveGrokExecutable,
};
