"use strict";

/**
 * 统一「获取模型 + 对话测试」传输层。
 *
 * 按供应商类型分发到三个通道：
 * - codex：ChatGPT 后端 Responses API（SSE 流式，沿用 chat-probe.js），
 *   模型列表改为实时请求 /backend-api/codex/models，本地缓存仅作兜底；
 * - antigravity：cloudcode-pa v1internal 网关（generateContent，非流式）；
 * - coding-plan / balance：OpenAI 兼容 /chat/completions（SSE 流式），
 *   各家端点与认证头按 detectCodingPlanProvider 的识别结果决定。
 *
 * 对外只暴露两个入口，事件协议与 codex 探测一致：
 * yield {type:"started"|"delta"|"complete"|"error", ...}
 */

const { appFetch } = require("./http-client");
const { listCodexModels, probeCodexStream } = require("./chat-probe");
const { buildModelListCandidates, extractModelIds } = require("./endpoint-probe");
const {
  resolveApiKey,
  detectCodingPlanProvider,
  readCodexCredentials,
  listAntigravityModels,
  probeAntigravityChat,
} = require("./providers");

const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const CODEX_CLI_USER_AGENT = "codex_cli_rs/0.144.1 (Ubuntu 22.4.0; x86_64) xterm-256color";
const CHAT_DEFAULT_PROMPT = "hi";
const CHAT_MAX_TOKENS = 1024;

// 每家供应商的模型列表与对话端点。模型列表可给多个候选（逐个尝试），
// 对话端点只有一个；authStyle 决定 Authorization 头的拼法。
function chatTargets(provider, detected) {
  const baseUrl = String(provider?.baseUrl || "").trim().replace(/\/+$/, "");
  const url = baseUrl.toLowerCase();
  switch (detected) {
    case "zhipu": {
      const origin = url.includes("api.z.ai") ? "https://api.z.ai" : "https://open.bigmodel.cn";
      const prefix = url.includes("open.bigmodel.cn") || url.includes("api.z.ai/api/coding")
        ? `${origin}/api/coding/paas/v4`
        : `${origin}/api/paas/v4`;
      return { modelsUrls: [`${prefix}/models`], chatUrl: `${prefix}/chat/completions`, authStyle: "bearer", id: detected };
    }
    case "kimi":
      return { modelsUrls: ["https://api.kimi.com/coding/v1/models"], chatUrl: "https://api.kimi.com/coding/v1/chat/completions", authStyle: "bearer", id: detected };
    case "qwen":
      return {
        modelsUrls: ["https://dashscope.aliyuncs.com/compatible-mode/v1/models"],
        chatUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        authStyle: "bearer",
        id: detected,
      };
    case "minimax-cn":
      return { modelsUrls: ["https://api.minimaxi.com/v1/models"], chatUrl: "https://api.minimaxi.com/v1/chat/completions", authStyle: "bearer", id: detected };
    case "minimax-en":
      return { modelsUrls: ["https://api.minimax.io/v1/models"], chatUrl: "https://api.minimax.io/v1/chat/completions", authStyle: "bearer", id: detected };
    case "zenmux": {
      const withVersion = /\/v\d+$/.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
      return { modelsUrls: [`${withVersion}/models`, `${baseUrl}/models`], chatUrl: `${withVersion}/chat/completions`, authStyle: "bearer", id: detected };
    }
    default: {
      if (!/^https?:\/\//i.test(baseUrl)) return null;
      const withVersion = /\/v\d+$/.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
      return { modelsUrls: buildModelListCandidates(baseUrl), chatUrl: `${withVersion}/chat/completions`, authStyle: "bearer", id: "generic" };
    }
  }
}

function authHeaders(authStyle, apiKey) {
  if (authStyle === "raw") return { Authorization: apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}

// OpenAI 兼容的模型列表响应 → {id,label}（复用 endpoint-probe 的解析）。
function parseOpenAiModelList(json) {
  return extractModelIds(json).map((id) => ({ id, label: id }));
}

// Codex /models 实时响应 → {id,label}。响应形状与 CLI 的 models_cache.json
// 同构（{models:[{slug,name,priority,visibility}]}），同时兼容 {data:[...]}。
function parseCodexModelsResponse(json) {
  const list = Array.isArray(json?.models)
    ? json.models
    : Array.isArray(json?.data)
      ? json.data
      : [];
  const picked = list
    .map((entry) => {
      if (typeof entry === "string") return { slug: entry, label: entry };
      return {
        slug: entry?.slug ?? entry?.id ?? entry?.model ?? null,
        label: entry?.name ?? entry?.slug ?? entry?.id ?? entry?.model ?? null,
        visibility: entry?.visibility,
        priority: entry?.priority,
      };
    })
    .filter((entry) => entry.slug && entry.visibility !== "hide")
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .map((entry) => ({ id: entry.slug, label: entry.label || entry.slug }));
  return picked;
}

function codexModelsFallback(note) {
  return {
    ok: true,
    models: listCodexModels().map((m) => ({ id: m.slug, label: m.label })),
    source: "cache",
    note: note || null,
  };
}

async function listCodexModelsLive(provider) {
  let credentials;
  try {
    credentials = readCodexCredentials(provider);
  } catch (_error) {
    return codexModelsFallback();
  }
  if (credentials.status !== "valid" && !credentials.accessToken) {
    return { ok: false, models: [], error: credentials.message || "缺少 Codex 登录凭据" };
  }
  const headers = {
    Authorization: `Bearer ${credentials.accessToken}`,
    Accept: "application/json",
    "User-Agent": CODEX_CLI_USER_AGENT,
    Originator: "codex_cli_rs",
  };
  if (credentials.accountId) headers["chatgpt-account-id"] = credentials.accountId;

  const startedAt = Date.now();
  let response;
  try {
    response = await appFetch(CODEX_MODELS_URL, { method: "GET", headers });
  } catch (error) {
    return codexModelsFallback(`在线获取失败（${error?.message || error}），已使用本地缓存`);
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, models: [], httpStatus: response.status, error: `登录凭据无效 (HTTP ${response.status})，请重新登录 Codex CLI` };
  }
  if (!response.ok) {
    return codexModelsFallback(`在线获取失败 (HTTP ${response.status})，已使用本地缓存`);
  }
  let json = null;
  try {
    json = await response.json();
  } catch (_error) {
    return codexModelsFallback("在线响应无法解析，已使用本地缓存");
  }
  const models = parseCodexModelsResponse(json);
  if (!models.length) return codexModelsFallback("在线响应为空，已使用本地缓存");
  return { ok: true, models, httpStatus: response.status, latencyMs: Date.now() - startedAt, source: "live" };
}

async function listOpenAiCompatibleModels(provider) {
  const apiKey = resolveApiKey(provider);
  if (!apiKey) return { ok: false, models: [], error: "缺少 API Key（也未找到可用环境变量）" };
  const detected = detectCodingPlanProvider(provider.baseUrl || "");
  const target = chatTargets(provider, detected);
  if (!target) return { ok: false, models: [], error: "请求地址无效，需要以 http(s):// 开头" };

  const errors = [];
  for (const url of target.modelsUrls) {
    const startedAt = Date.now();
    let response;
    try {
      response = await appFetch(url, {
        method: "GET",
        headers: { ...authHeaders(target.authStyle, apiKey), Accept: "application/json" },
      });
    } catch (error) {
      errors.push(`${url}：${error?.message || error}`);
      continue;
    }
    // 智谱的配额接口用裸 key；模型接口对 Bearer 未授权时降级重试一次。
    if ((response.status === 401 || response.status === 403) && target.id === "zhipu") {
      try {
        response = await appFetch(url, { method: "GET", headers: { ...authHeaders("raw", apiKey), Accept: "application/json" } });
      } catch (_error) {
        /* 保留原响应 */
      }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, models: [], httpStatus: response.status, error: `API Key 无效或无权限 (HTTP ${response.status})` };
    }
    if (!response.ok) {
      errors.push(`${url}：HTTP ${response.status}`);
      continue;
    }
    let json = null;
    try {
      json = await response.json();
    } catch (_error) {
      errors.push(`${url}：响应不是 JSON`);
      continue;
    }
    const models = parseOpenAiModelList(json);
    if (!models.length) {
      errors.push(`${url}：没有返回模型列表`);
      continue;
    }
    return { ok: true, models, httpStatus: response.status, latencyMs: Date.now() - startedAt, url, source: "live" };
  }
  return { ok: false, models: [], error: errors.join("；").slice(0, 300) || "没有可用的模型接口" };
}

async function listProviderModels(provider) {
  const kind = provider?.kind;
  if (kind === "official-subscription") {
    const tool = provider.tool || "codex";
    if (tool === "codex") return listCodexModelsLive(provider);
    if (tool === "antigravity") return listAntigravityModels(provider);
    return { ok: false, models: [], error: `「${tool}」暂不支持获取模型列表` };
  }
  if (kind === "coding-plan" || kind === "balance") {
    return listOpenAiCompatibleModels(provider);
  }
  return { ok: false, models: [], error: "该类型供应商不支持获取模型" };
}

// OpenAI 兼容 /chat/completions 的 SSE 解析（choices[].delta.content），
// 兼容非流式 JSON 响应（choices[].message.content）。
async function* probeOpenAiCompatibleStream({ target, apiKey, model, prompt, zhipuRawKeyRetry }) {
  const headers = {
    ...authHeaders(target.authStyle, apiKey),
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    stream: true,
    max_tokens: CHAT_MAX_TOKENS,
  });

  let response;
  try {
    response = await appFetch(target.chatUrl, { method: "POST", headers, body });
  } catch (error) {
    yield { type: "error", error: String(error?.message || error) };
    return;
  }
  if ((response.status === 401 || response.status === 403) && zhipuRawKeyRetry) {
    try {
      response = await appFetch(target.chatUrl, {
        method: "POST",
        headers: { ...authHeaders("raw", apiKey), "Content-Type": "application/json", Accept: "text/event-stream" },
        body,
      });
    } catch (_error) {
      /* 保留原响应 */
    }
  }
  if (response.status === 401 || response.status === 403) {
    yield { type: "error", error: `Authentication failed (HTTP ${response.status})`, httpStatus: response.status };
    return;
  }
  if (response.status === 429) {
    yield { type: "error", error: "请求过于频繁或额度已用尽（HTTP 429）", httpStatus: 429 };
    return;
  }
  if (!response.ok) {
    let text = "";
    try { text = await response.text(); } catch (_e) { /* ignore */ }
    yield {
      type: "error",
      error: `API error (HTTP ${response.status})${text ? `: ${String(text).slice(0, 200)}` : ""}`,
      httpStatus: response.status,
    };
    return;
  }
  if (!response.body) {
    yield { type: "error", error: "响应没有 body" };
    return;
  }

  yield { type: "started", httpStatus: response.status, model };

  const contentType = String(response.headers?.get?.("content-type") || "");
  if (!contentType.includes("event-stream")) {
    // 部分网关忽略 stream 参数，直接返回完整 JSON。
    let json = null;
    try { json = await response.json(); } catch (_e) { /* ignore */ }
    const text = json?.choices?.[0]?.message?.content;
    const message = typeof text === "string" ? text : "";
    if (json?.error) {
      yield { type: "error", error: json.error?.message || JSON.stringify(json.error).slice(0, 200) };
      return;
    }
    yield { type: "delta", text: message };
    yield { type: "complete", text: message };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;
        if (jsonStr === "[DONE]") {
          yield { type: "complete", text: fullText };
          return;
        }
        let data;
        try { data = JSON.parse(jsonStr); } catch (_e) { continue; }
        if (data?.error) {
          yield { type: "error", error: data.error?.message || JSON.stringify(data.error).slice(0, 200) };
          return;
        }
        const delta = data?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          fullText += delta;
          yield { type: "delta", text: delta };
        }
        const finish = data?.choices?.[0]?.finish_reason;
        if (finish && finish !== "null") {
          yield { type: "complete", text: fullText };
          return;
        }
      }
    }
    yield { type: "complete", text: fullText };
  } finally {
    try { reader.releaseLock(); } catch (_e) { /* ignore */ }
  }
}

async function* probeProviderChatStream(provider, { model, prompt } = {}) {
  const kind = provider?.kind;
  const useModel = String(model || "").trim();
  const usePrompt = String(prompt || "").trim() || CHAT_DEFAULT_PROMPT;

  if (kind === "official-subscription") {
    const tool = provider.tool || "codex";
    if (tool === "codex") {
      let credentials;
      try {
        credentials = readCodexCredentials(provider);
      } catch (error) {
        yield { type: "error", error: String(error?.message || error) };
        return;
      }
      if (credentials.status !== "valid" && !credentials.accessToken) {
        yield { type: "error", error: credentials.message || "缺少 Codex 登录凭据" };
        return;
      }
      yield* probeCodexStream({ credentials, model: useModel, prompt: usePrompt });
      return;
    }
    if (tool === "antigravity") {
      if (!useModel) {
        yield { type: "error", error: "请先获取并选择模型" };
        return;
      }
      let result;
      try {
        result = await probeAntigravityChat(provider, { model: useModel, prompt: usePrompt });
      } catch (error) {
        yield { type: "error", error: error?.message || String(error) };
        return;
      }
      if (!result.ok) {
        yield { type: "error", error: result.error, httpStatus: result.httpStatus };
        return;
      }
      yield { type: "started", httpStatus: result.httpStatus, model: result.model || useModel };
      if (result.text) yield { type: "delta", text: result.text };
      yield { type: "complete", text: result.text };
      return;
    }
    yield { type: "error", error: `「${tool}」暂不支持对话测试` };
    return;
  }

  if (kind === "coding-plan" || kind === "balance") {
    if (!useModel) {
      yield { type: "error", error: "请先获取并选择模型" };
      return;
    }
    const apiKey = resolveApiKey(provider);
    if (!apiKey) {
      yield { type: "error", error: "缺少 API Key（也未找到可用环境变量）" };
      return;
    }
    const detected = detectCodingPlanProvider(provider.baseUrl || "");
    const target = chatTargets(provider, detected);
    if (!target) {
      yield { type: "error", error: "请求地址无效，需要以 http(s):// 开头" };
      return;
    }
    yield* probeOpenAiCompatibleStream({
      target,
      apiKey,
      model: useModel,
      prompt: usePrompt,
      zhipuRawKeyRetry: target.id === "zhipu",
    });
    return;
  }

  yield { type: "error", error: "该类型供应商不支持对话测试" };
}

module.exports = {
  chatTargets,
  authHeaders,
  parseCodexModelsResponse,
  parseOpenAiModelList,
  listProviderModels,
  probeProviderChatStream,
};
