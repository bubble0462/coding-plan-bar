const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 512 * 1024;
const MAX_CACHE_AGE_MS = 0;

function readAgentUsageCache(filePath, options = {}) {
  const now = Number(options.now ?? Date.now());
  const maxAgeMs = Number(options.maxAgeMs ?? MAX_CACHE_AGE_MS);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CACHE_BYTES) return null;
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const savedAt = Number(payload?.savedAt || 0);
    if (
      payload?.version !== CACHE_VERSION ||
      !savedAt ||
      (maxAgeMs > 0 && now - savedAt > maxAgeMs) ||
      !isAgentUsageSnapshot(payload.snapshot)
    ) {
      return null;
    }
    return { savedAt, snapshot: payload.snapshot };
  } catch (_error) {
    // This is an optional cache. Missing or malformed data must not block startup.
    return null;
  }
}

function writeAgentUsageCache(filePath, snapshot, options = {}) {
  if (!isAgentUsageSnapshot(snapshot)) return false;
  const savedAt = Number(options.savedAt ?? Date.now());
  const payload = {
    version: CACHE_VERSION,
    savedAt,
    snapshot,
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_CACHE_BYTES) {
    throw new Error("Agent usage cache exceeds its size limit");
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fd = fs.openSync(tempPath, "wx");
  try {
    fs.writeFileSync(fd, body, "utf8");
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
      // Preserve the original atomic-write error.
    }
    throw error;
  }
  return true;
}

function isAgentUsageSnapshot(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.codex &&
    typeof value.codex === "object",
  );
}

module.exports = {
  CACHE_VERSION,
  MAX_CACHE_AGE_MS,
  MAX_CACHE_BYTES,
  isAgentUsageSnapshot,
  readAgentUsageCache,
  writeAgentUsageCache,
};
