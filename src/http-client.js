/**
 * Prefer Electron's Chromium network stack so requests follow the same
 * system / manual proxy rules as the browser. Fall back to global fetch
 * when Electron is unavailable (plain Node / unit tests).
 */
function appFetch(url, options = {}) {
  try {
    const electron = require("electron");
    const sessionFetch = electron.session?.defaultSession?.fetch;
    if (typeof sessionFetch === "function") {
      return sessionFetch.call(electron.session.defaultSession, url, options);
    }
    if (typeof electron.net?.fetch === "function") {
      return electron.net.fetch(url, options);
    }
  } catch (_error) {
    // fall through
  }
  return fetch(url, options);
}

/**
 * Run appFetch with an AbortController-based timeout. The timeout timer is
 * always cleared on settlement so it cannot outlive the request. Returns the
 * active controller via options.signal ownership transferred in; throws an
 * AbortError (just like fetch) when the timeout elapses.
 *
 * Prefer this helper over hand-rolled `setTimeout(() => controller.abort(), ms)`
 * blocks so future call sites cannot forget the clearTimeout step.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const externalSignal = options && options.signal ? options.signal : null;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    return await appFetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { appFetch, fetchWithTimeout };

