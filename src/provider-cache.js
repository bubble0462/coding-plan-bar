const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CACHE_VERSION = 2;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function providerFingerprint(provider = {}, secretOverride) {
  const secret = secretOverride === undefined ? provider.apiKey : secretOverride;
  const identity = {
    id: String(provider.id || ""),
    kind: String(provider.kind || ""),
    tool: String(provider.tool || ""),
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    apiKeyHash: secret ? secretFingerprint(secret) : "",
    platformTokenHash: provider.platformToken ? secretFingerprint(provider.platformToken) : "",
    apiKeyEnv: Array.isArray(provider.apiKeyEnv)
      ? provider.apiKeyEnv.map(String).sort()
      : String(provider.apiKeyEnv || ""),
    accountId: String(provider.accountId || ""),
    importKey: String(provider.importKey || ""),
    authPath: String(provider.authPath || ""),
    credentialsPath: String(provider.credentialsPath || ""),
  };
  return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function readProviderCache(filePath, options = {}) {
  const now = Number(options.now || Date.now());
  const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
  const entries = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) return entries;
    for (const entry of parsed.entries) {
      const savedAt = Number(entry?.savedAt || 0);
      if (!entry?.key || !entry.provider || !savedAt || now - savedAt > ttlMs) continue;
      entries.set(entry.key, { savedAt, provider: entry.provider });
    }
  } catch (_error) {
    // Missing or malformed cache files are disposable and must not block startup.
  }
  return entries;
}

function writeProviderCache(filePath, entries, activeKeys, options = {}) {
  const now = Number(options.now || Date.now());
  const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
  const allowed = activeKeys instanceof Set ? activeKeys : new Set(activeKeys || []);
  const payload = {
    version: CACHE_VERSION,
    entries: [...entries.entries()]
      .filter(([key, entry]) => allowed.has(key) && now - Number(entry?.savedAt || 0) <= ttlMs)
      .map(([key, entry]) => ({ key, savedAt: entry.savedAt, provider: entry.provider })),
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fd = fs.openSync(tempPath, "wx");
  try {
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_cleanupError) {
      // Ignore cleanup failures and report the original rename error.
    }
    throw error;
  }
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function secretFingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

module.exports = {
  CACHE_VERSION,
  DEFAULT_TTL_MS,
  providerFingerprint,
  readProviderCache,
  writeProviderCache,
};
