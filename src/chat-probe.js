const fs = require("fs");
const os = require("os");
const path = require("path");
const { appFetch } = require("./http-client");

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_CLI_USER_AGENT = "codex_cli_rs/0.144.1 (Ubuntu 22.4.0; x86_64) xterm-256color";
const CODEX_DEFAULT_MODEL = "gpt-5.4";
const CODEX_DEFAULT_PROMPT = "hi";
const CODEX_FALLBACK_INSTRUCTIONS = "You are a helpful coding assistant. Respond briefly.";

const FALLBACK_MODELS = [
  { slug: "gpt-5.4-nano", label: "gpt-5.4-nano" },
  { slug: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { slug: "gpt-5.4", label: "gpt-5.4" },
  { slug: "gpt-5.5", label: "gpt-5.5" },
  { slug: "gpt-5.6-luna", label: "gpt-5.6-luna" },
  { slug: "gpt-5.6-sol", label: "gpt-5.6-sol" },
  { slug: "gpt-5.6-terra", label: "gpt-5.6-terra" },
];

function listCodexModels() {
  const cachePath = path.join(os.homedir(), ".codex", "models_cache.json");
  try {
    if (!fs.existsSync(cachePath)) return FALLBACK_MODELS.slice();
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const models = Array.isArray(cache?.models) ? cache.models : [];
    const picked = models
      .filter((m) => m && typeof m.slug === "string" && m.visibility !== "hide")
      .sort((a, b) => (a.priority || 999) - (b.priority || 999))
      .map((m) => ({ slug: m.slug, label: m.name || m.slug }));
    return picked.length ? picked : FALLBACK_MODELS.slice();
  } catch (_error) {
    return FALLBACK_MODELS.slice();
  }
}

function pickDefaultModel(models) {
  if (!Array.isArray(models) || !models.length) return CODEX_DEFAULT_MODEL;
  const preferred = ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"];
  for (const slug of preferred) {
    const found = models.find((m) => m.slug === slug);
    if (found) return found.slug;
  }
  return models[0].slug;
}

async function* probeCodexStream({ credentials, model, prompt }) {
  const accessToken = credentials.accessToken;
  const accountId = credentials.accountId;
  if (!accessToken) {
    yield { type: "error", error: "缺少 access_token" };
    return;
  }

  const useModel = (model && String(model).trim()) || CODEX_DEFAULT_MODEL;
  const usePrompt = (prompt && String(prompt).trim()) || CODEX_DEFAULT_PROMPT;

  const headers = {
    "Content-Type": "application/json",
    accept: "text/event-stream",
    Authorization: `Bearer ${accessToken}`,
    "OpenAI-Beta": "responses=experimental",
    Originator: "codex_cli_rs",
    "User-Agent": CODEX_CLI_USER_AGENT,
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  const body = JSON.stringify({
    model: useModel,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: usePrompt }],
      },
    ],
    stream: true,
    store: false,
    instructions: CODEX_FALLBACK_INSTRUCTIONS,
  });

  let response;
  try {
    response = await appFetch(CODEX_RESPONSES_URL, { method: "POST", headers, body });
  } catch (error) {
    yield { type: "error", error: String(error?.message || error) };
    return;
  }

  if (response.status === 401 || response.status === 403) {
    yield { type: "error", error: `Authentication failed (HTTP ${response.status})`, httpStatus: response.status };
    return;
  }
  if (!response.ok) {
    let text = "";
    try { text = await response.text(); } catch (_e) { /* ignore */ }
    const excerpt = String(text || "").slice(0, 200);
    yield {
      type: "error",
      error: `API error (HTTP ${response.status})${excerpt ? `: ${excerpt}` : ""}`,
      httpStatus: response.status,
    };
    return;
  }
  if (!response.body) {
    yield { type: "error", error: "响应没有 body" };
    return;
  }

  yield { type: "started", httpStatus: response.status, model: useModel };

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
        const eventType = data?.type;
        if (eventType === "response.output_text.delta") {
          const delta = typeof data.delta === "string" ? data.delta : "";
          if (delta) {
            fullText += delta;
            yield { type: "delta", text: delta };
          }
        } else if (eventType === "response.completed" || eventType === "response.done") {
          yield { type: "complete", text: fullText };
          return;
        } else if (eventType === "response.failed") {
          let msg = "OpenAI response failed";
          const errData = data?.response?.error;
          if (errData?.message) msg = errData.message;
          yield { type: "error", error: msg };
          return;
        } else if (eventType === "error") {
          let msg = "Unknown error";
          if (data?.error?.message) msg = data.error.message;
          yield { type: "error", error: msg };
          return;
        }
      }
    }
    yield { type: "complete", text: fullText };
  } finally {
    try { reader.releaseLock(); } catch (_e) { /* ignore */ }
  }
}

module.exports = {
  listCodexModels,
  pickDefaultModel,
  probeCodexStream,
  CODEX_DEFAULT_MODEL,
  CODEX_DEFAULT_PROMPT,
};
