/**
 * Centralized timer registry. Replaces the loose collection of module-level
 * `let refreshTimer / hideTimer / revealTimer` variables in main.js with a
 * single object that:
 *   - guarantees every scheduled timer is tracked by name,
 *   - clears the previous timer when the same name is rescheduled,
 *   - exposes clearAll() for shutdown / tests.
 *
 * Only long-lived named timers belong here; one-shot locals can still use
 * plain setTimeout/setTimeout directly.
 */
class AppTimers {
  constructor() {
    this._entries = new Map();
  }

  setTimeout(name, handler, delayMs) {
    this.clear(name);
    const id = setTimeout(() => {
      this._entries.delete(name);
      handler();
    }, delayMs);
    this._entries.set(name, { kind: "timeout", id });
    return id;
  }

  setInterval(name, handler, intervalMs) {
    this.clear(name);
    const id = setInterval(handler, intervalMs);
    this._entries.set(name, { kind: "interval", id });
    return id;
  }

  has(name) {
    return this._entries.has(name);
  }

  clear(name) {
    const entry = this._entries.get(name);
    if (!entry) return;
    if (entry.kind === "interval") clearInterval(entry.id);
    else clearTimeout(entry.id);
    this._entries.delete(name);
  }

  clearAll() {
    for (const name of [...this._entries.keys()]) this.clear(name);
  }
}

module.exports = { AppTimers };
