/* eslint-disable no-unused-vars -- this file only declares globals consumed by settings.js */
/* exported motionDelay, formatUsageInteger, formatUsageTokens,
   formatUsageMoney, formatBytes, formatDuration, displayVersion, releaseNotesPreview,
   maskSecret, safeProviderPreview, shortId, normalizeText, escapeHtml, escapeAttr,
   expiryState, computeCacheShare */

/**
 * Pure formatting / helper utilities split out of settings.js.
 *
 * Loaded as a plain <script> before settings.js so every top-level
 * function declared here is in the same global scope and callable from
 * settings.js without import/export wiring.
 *
 * Rules for living in this file:
 *   - no access to the `state` / `root` / `popupDrag` module-level variables,
 *   - no DOM mutation, no event handlers, no IPC calls.
 * If you need any of those, the function belongs in settings.js (or a
 * dedicated feature module) instead.
 */

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function motionDelay(milliseconds) {
  return prefersReducedMotion() ? 0 : milliseconds;
}

function formatUsageInteger(value) {
  return Math.max(0, Number(value) || 0).toLocaleString("zh-CN");
}

function formatUsageTokens(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(amount >= 10_000_000_000 ? 1 : 2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(amount >= 10_000 ? 1 : 2)}K`;
  return String(Math.round(amount));
}

function formatUsageMoney(value, partial = false) {
  if (value == null || !Number.isFinite(Number(value))) return "未定价";
  const amount = Math.max(0, Number(value));
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${partial ? "≥ " : ""}$${amount.toFixed(digits)}`;
}

/**
 * Cache share for Agent usage cards.
 *
 * - "included" (Codex): cache_read is typically already counted inside input,
 *   so the bar is cache / input (capped at 100%).
 * - "separate" (Anthropic-style): input is fresh tokens only and
 *   cache is tracked separately. Hit rate is cache / (input + cache).
 */
function computeCacheShare(windowData = {}, mode = "included") {
  const input = Math.max(0, Number(windowData?.inputTokens) || 0);
  const cached = Math.max(0, Number(windowData?.cacheReadTokens) || 0);
  if (mode === "separate") {
    const prompt = input + cached;
    if (prompt <= 0) return { rate: 0, label: "缓存命中率" };
    return {
      rate: Math.min(100, Math.round((cached / prompt) * 100)),
      label: "缓存命中率",
    };
  }
  if (input <= 0) return { rate: 0, label: "缓存占输入" };
  return {
    rate: Math.min(100, Math.round((Math.min(cached, input) / input) * 100)),
    label: "缓存占输入",
  };
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(ms) {
  const minutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

function displayVersion(value) {
  if (!value) return "—";
  return String(value).trim().replace(/^v(?=\d)/i, "");
}

function releaseNotesPreview(value) {
  const text = String(value || "")
    .replace(/[#>*_`-]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function maskSecret(value) {
  const text = String(value || "");
  if (text.length <= 12) return "********";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function safeProviderPreview(provider) {
  const clone = { ...provider };
  if (clone.accessToken) clone.accessToken = maskSecret(clone.accessToken);
  if (clone.apiKey) clone.apiKey = maskSecret(clone.apiKey);
  if (clone.importPath) clone.importPath = "<local file>";
  return clone;
}

function shortId(value) {
  const text = String(value || "");
  return text.length <= 8 ? text : `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function expiryState(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  const diff = time - Date.now();
  return {
    expired: diff <= 0,
    soon: diff > 0 && diff <= 7 * 24 * 60 * 60 * 1000,
    relative: formatDuration(diff),
    absolute: new Date(time).toLocaleString("zh-CN"),
  };
}
