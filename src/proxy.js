const PROXY_MODES = new Set(["system", "direct", "manual"]);

function normalizeProxy(proxy) {
  const value = proxy && typeof proxy === "object" ? proxy : {};
  const mode = PROXY_MODES.has(value.mode) ? value.mode : "system";
  const url = String(value.url || "").trim();
  return {
    mode,
    url: mode === "manual" ? url : url || "",
  };
}

function proxyRulesFromUrl(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) throw new Error("手动代理地址不能为空");

  let parsed;
  try {
    parsed = new URL(text.includes("://") ? text : `http://${text}`);
  } catch (_error) {
    throw new Error(`无效的代理地址：${text}`);
  }

  if (!["http:", "https:", "socks5:", "socks4:"].includes(parsed.protocol)) {
    throw new Error(`不支持的代理协议：${parsed.protocol.replace(":", "")}`);
  }
  if (!parsed.hostname) throw new Error("代理地址缺少主机名");

  // Electron fixed_servers expects host:port (optionally with scheme for socks).
  if (parsed.protocol.startsWith("socks")) {
    return `${parsed.protocol}//${parsed.host}`;
  }
  return parsed.host;
}

function toElectronProxyConfig(proxy) {
  const normalized = normalizeProxy(proxy);
  if (normalized.mode === "direct") {
    return { mode: "direct" };
  }
  if (normalized.mode === "manual") {
    const rules = proxyRulesFromUrl(normalized.url);
    return {
      mode: "fixed_servers",
      proxyRules: rules,
      proxyBypassRules: "<local>",
    };
  }
  return { mode: "system" };
}

function applyProcessProxyEnv(proxy) {
  const normalized = normalizeProxy(proxy);
  if (normalized.mode === "manual" && normalized.url) {
    const value = normalized.url.includes("://") ? normalized.url : `http://${normalized.url}`;
    process.env.HTTP_PROXY = value;
    process.env.HTTPS_PROXY = value;
    process.env.http_proxy = value;
    process.env.https_proxy = value;
    return;
  }
  if (normalized.mode === "direct") {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    process.env.NO_PROXY = "*";
    process.env.no_proxy = "*";
    return;
  }
  // system: leave env alone so child processes can still inherit OS/user proxy env.
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
}

async function applyProxySettings(proxy) {
  const electronConfig = toElectronProxyConfig(proxy);
  applyProcessProxyEnv(proxy);

  try {
    const { app, session } = require("electron");
    if (!app || !session?.defaultSession) return normalizeProxy(proxy);
    if (!app.isReady()) {
      await app.whenReady();
    }
    await session.defaultSession.setProxy(electronConfig);
    // Force PAC/system proxy resolution to refresh after mode change.
    if (typeof session.defaultSession.closeAllConnections === "function") {
      session.defaultSession.closeAllConnections();
    }
  } catch (_error) {
    // Non-Electron / unit contexts ignore session wiring.
  }
  return normalizeProxy(proxy);
}

function describeProxy(proxy) {
  const normalized = normalizeProxy(proxy);
  if (normalized.mode === "manual") {
    return normalized.url ? `手动代理 ${normalized.url}` : "手动代理（未填写地址）";
  }
  if (normalized.mode === "direct") return "直连（不使用代理）";
  return "跟随系统代理";
}

module.exports = {
  PROXY_MODES,
  normalizeProxy,
  toElectronProxyConfig,
  applyProxySettings,
  describeProxy,
  proxyRulesFromUrl,
};
