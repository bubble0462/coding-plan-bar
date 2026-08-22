"use strict";

/**
 * Endpoint connectivity + model-list probe for API-key providers.
 * Best-effort: tries the OpenAI-compatible `/models` conventions and a few
 * known-host paths, reporting whichever endpoint answers first.
 */

const { appFetch } = require("./http-client");

const PROBE_TIMEOUT_MS = 8000;

// Hosts whose model-list endpoint is not derivable from the generic rules.
function knownHostCandidates(baseUrl) {
  const url = String(baseUrl || "").toLowerCase();
  if (url.includes("bailian.console.aliyun.com") || url.includes("modelstudio.console.alibabacloud.com")) {
    return ["https://dashscope.aliyuncs.com/compatible-mode/v1/models"];
  }
  if (url.includes("bigmodel.cn") || url.includes("api.z.ai")) {
    const origin = url.includes("api.z.ai") ? "https://api.z.ai" : "https://open.bigmodel.cn";
    const coding = url.includes("/coding");
    return [
      `${origin}/api/${coding ? "coding/" : ""}paas/v4/models`,
      `${origin}/api/paas/v4/models`,
    ];
  }
  return [];
}

function buildModelListCandidates(baseUrl) {
  const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) return [];
  const seen = new Set();
  const candidates = [];
  const push = (value) => {
    if (value && !seen.has(value)) {
      seen.add(value);
      candidates.push(value);
    }
  };
  for (const value of knownHostCandidates(raw)) push(value);
  if (/\/v\d+(?=\/?$)/i.test(raw)) {
    push(`${raw}/models`);
  } else {
    push(`${raw}/models`);
    push(`${raw}/v1/models`);
  }
  return candidates;
}

function extractModelIds(json) {
  const data = json?.data ?? json?.models;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const id = entry?.id ?? entry?.model ?? entry?.name;
      return typeof id === "string" ? id : null;
    })
    .filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

async function probeProviderEndpoint({ baseUrl, apiKey }) {
  const candidates = buildModelListCandidates(baseUrl);
  if (!candidates.length) {
    return { status: "invalid-url", httpStatus: null, latencyMs: null, url: null, models: [], error: "请求地址无效，需要以 http(s):// 开头" };
  }
  const key = String(apiKey || "").trim();
  const attempts = [];
  let lastReachable = null;

  for (const url of candidates) {
    const startedAt = Date.now();
    let response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        response = await appFetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            ...(key
              ? {
                  Authorization: `Bearer ${key}`,
                  "x-api-key": key,
                  "api-key": key,
                }
              : {}),
            Accept: "application/json",
          },
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      attempts.push({ url, httpStatus: null, error: String(error?.message || error) });
      continue;
    }
    const latencyMs = Date.now() - startedAt;
    lastReachable = { url, httpStatus: response.status, latencyMs };

    if (response.status === 401 || response.status === 403) {
      return {
        status: "auth-error",
        httpStatus: response.status,
        latencyMs,
        url,
        models: [],
        error: `API Key 无效或无权限 (HTTP ${response.status})`,
      };
    }
    if (!response.ok) {
      attempts.push({ url, httpStatus: response.status, error: `HTTP ${response.status}` });
      continue;
    }
    let json = null;
    try {
      json = await response.json();
    } catch {
      attempts.push({ url, httpStatus: response.status, error: "响应不是 JSON" });
      continue;
    }
    const models = extractModelIds(json);
    return {
      status: models.length ? "ok" : "reachable-no-models",
      httpStatus: response.status,
      latencyMs,
      url,
      models,
      error: models.length ? null : "连接成功，但该端点没有返回模型列表（不影响额度查询）",
    };
  }

  if (lastReachable) {
    return {
      status: "reachable-no-models",
      httpStatus: lastReachable.httpStatus,
      latencyMs: lastReachable.latencyMs,
      url: lastReachable.url,
      models: [],
      error: "服务器可达，但没有可识别的模型列表接口",
    };
  }
  return {
    status: "network-error",
    httpStatus: null,
    latencyMs: null,
    url: candidates[0],
    models: [],
    error: `连接失败：${attempts[0]?.error || "网络错误或地址不可达"}`,
  };
}

module.exports = {
  buildModelListCandidates,
  extractModelIds,
  probeProviderEndpoint,
};
