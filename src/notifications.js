"use strict";

/**
 * Pure quota-event detection shared by system notifications and the weekly
 * reset celebration. Consumes two consecutive provider arrays (as delivered
 * in snapshot payloads) plus a caller-held `armed` map that suppresses
 * duplicate threshold notifications for the same quota window.
 */

const QUOTA_THRESHOLD_DEFAULTS = [80, 95];
const RESET_MIN_PRIOR_UTILIZATION = 20;

function normalizeThresholds(thresholds) {
  const list = (Array.isArray(thresholds) ? thresholds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 50 && value <= 100);
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : [...QUOTA_THRESHOLD_DEFAULTS];
}

function tierWindowKey(providerId, tierName, resetsAt) {
  return `${providerId}|${tierName}|${resetsAt || "none"}`;
}

function isWeeklyTierName(name) {
  return /^(weekly_limit|seven_day|grok_limit)/.test(String(name || ""));
}

function providerTierIndex(providers) {
  const map = new Map();
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!provider || typeof provider !== "object") continue;
    const id = String(provider.id || provider.name || "");
    if (!id) continue;
    const tiers = new Map();
    for (const tier of Array.isArray(provider.tiers) ? provider.tiers : []) {
      const name = String(tier?.name || tier?.label || "");
      if (!name) continue;
      tiers.set(name, {
        utilization: Number(tier.utilization) || 0,
        resetsAt: tier.resetsAt ? new Date(tier.resetsAt).getTime() : null,
        label: String(tier.label || tier.name || name),
      });
    }
    map.set(id, {
      name: String(provider.name || id),
      status: String(provider.status || ""),
      tiers,
    });
  }
  return map;
}

function isServiceErrorStatus(status) {
  return ["error", "expired", "missing"].includes(status);
}

function detectQuotaEvents(prevProviders, nextProviders, options = {}) {
  const thresholds = normalizeThresholds(options.thresholds);
  const armed = options.armed instanceof Map ? options.armed : new Map();
  const prev = providerTierIndex(prevProviders);
  const next = providerTierIndex(nextProviders);
  const events = [];
  const liveKeys = new Set();

  for (const [id, nextProvider] of next) {
    const prevProvider = prev.get(id);

    const errorKey = `${id}|service-error`;
    if (isServiceErrorStatus(nextProvider.status)) {
      if (prevProvider && !isServiceErrorStatus(prevProvider.status) && !armed.has(errorKey)) {
        armed.set(errorKey, true);
        events.push({ type: "service-error", providerId: id, providerName: nextProvider.name });
      }
    } else {
      armed.delete(errorKey);
    }

    for (const [tierName, nextTier] of nextProvider.tiers) {
      const prevTier = prevProvider?.tiers.get(tierName);
      if (!prevTier) continue;

      for (const threshold of thresholds) {
        const key = `${tierWindowKey(id, tierName, nextTier.resetsAt)}|${threshold}`;
        liveKeys.add(key);
        if (prevTier.utilization < threshold && nextTier.utilization >= threshold && !armed.has(key)) {
          armed.set(key, true);
          events.push({
            type: "threshold",
            providerId: id,
            providerName: nextProvider.name,
            tierName,
            tierLabel: nextTier.label,
            threshold,
            utilization: nextTier.utilization,
          });
        }
      }

      const windowRolled =
        prevTier.resetsAt && nextTier.resetsAt && prevTier.resetsAt !== nextTier.resetsAt;
      if (windowRolled && prevTier.utilization > RESET_MIN_PRIOR_UTILIZATION) {
        events.push({
          type: "reset",
          providerId: id,
          providerName: nextProvider.name,
          tierName,
          tierLabel: nextTier.label,
          scope: isWeeklyTierName(tierName) ? "weekly" : "window",
        });
      }
    }
  }

  for (const key of [...armed.keys()]) {
    if (key.endsWith("|service-error")) continue;
    if (!liveKeys.has(key)) armed.delete(key);
  }

  return events;
}

function quotaEventMessage(event) {
  if (event.type === "threshold") {
    const used = Math.round(event.utilization);
    return {
      title: `${event.providerName} ${event.tierLabel}已用 ${used}%`,
      body:
        event.threshold >= 95
          ? "额度即将耗尽，请注意控制用量。"
          : `已越过 ${event.threshold}% 提醒线，请留意剩余额度。`,
    };
  }
  if (event.type === "reset") {
    return {
      title: `${event.providerName} ${event.tierLabel}已重置`,
      body: "额度窗口已更新，剩余额度已恢复。",
    };
  }
  return {
    title: `${event.providerName} 服务异常`,
    body: "额度查询失败，请在弹窗中查看详情。",
  };
}

module.exports = {
  QUOTA_THRESHOLD_DEFAULTS,
  detectQuotaEvents,
  isWeeklyTierName,
  normalizeThresholds,
  quotaEventMessage,
};
