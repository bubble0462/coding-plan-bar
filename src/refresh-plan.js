"use strict";

/**
 * Adaptive refresh planning. The pure function maps the current provider
 * state to the next polling delay; process detection is best-effort and
 * silently degrades to plain timed refresh when the OS helpers are missing.
 */

const { execFile } = require("child_process");

const MIN_INTERVAL_SECONDS = 30;
const RESET_WINDOW_SECONDS = 5 * 60;
const RESET_POLL_SECONDS = 30;
const AGENT_ACTIVE_SECONDS = 90;
const AGENT_CACHE_MS = 5 * 60 * 1000;

// Substrings matched against full process command lines (wmic) or image
// names (tasklist fallback) to detect a local coding agent in use.
const AGENT_PROCESS_PATTERN = /codex|claude|zcode|kimi-code|kimi_code|qwen/i;

let agentActivityCache = { at: 0, value: false };

function nextRefreshDelayMs({ now = Date.now(), providers = [], baseSeconds = 300, agentActive = false } = {}) {
  const base = Math.max(MIN_INTERVAL_SECONDS, Math.round(Number(baseSeconds) || 300));
  let seconds = base;
  const nowMs = Number(now) || Date.now();

  for (const provider of Array.isArray(providers) ? providers : []) {
    for (const tier of Array.isArray(provider?.tiers) ? provider.tiers : []) {
      const resetsAt = tier?.resetsAt ? new Date(tier.resetsAt).getTime() : NaN;
      if (!Number.isFinite(resetsAt)) continue;
      const deltaMs = resetsAt - nowMs;
      // Poll tightly while a quota window is minutes away from resetting so
      // the fresh window (plus its notification/celebration) lands promptly.
      if (deltaMs > 0 && deltaMs <= RESET_WINDOW_SECONDS * 1000) {
        seconds = Math.min(seconds, RESET_POLL_SECONDS);
      }
    }
  }

  if (agentActive) seconds = Math.min(seconds, AGENT_ACTIVE_SECONDS);
  return seconds * 1000;
}

function commandOutputMatchesAgent(output) {
  return AGENT_PROCESS_PATTERN.test(String(output || ""));
}

function detectAgentActivity(force = false) {
  return new Promise((resolve) => {
    const now = Date.now();
    if (!force && now - agentActivityCache.at < AGENT_CACHE_MS) {
      resolve(agentActivityCache.value);
      return;
    }
    execFile(
      "wmic",
      ["process", "get", "commandline", "/format:csv"],
      { windowsHide: true, timeout: 8000 },
      (error, stdout) => {
        if (!error && typeof stdout === "string") {
          agentActivityCache = { at: now, value: commandOutputMatchesAgent(stdout) };
          resolve(agentActivityCache.value);
          return;
        }
        execFile(
          "tasklist",
          ["/FO", "CSV", "/NH"],
          { windowsHide: true, timeout: 8000 },
          (fallbackError, names) => {
            const value = !fallbackError && commandOutputMatchesAgent(names);
            agentActivityCache = { at: now, value };
            resolve(value);
          },
        );
      },
    );
  });
}

module.exports = {
  AGENT_ACTIVE_SECONDS,
  MIN_INTERVAL_SECONDS,
  RESET_POLL_SECONDS,
  RESET_WINDOW_SECONDS,
  commandOutputMatchesAgent,
  detectAgentActivity,
  nextRefreshDelayMs,
};
