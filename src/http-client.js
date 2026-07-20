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

module.exports = { appFetch };
