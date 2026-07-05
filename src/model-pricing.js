// Estimated standard API prices in USD per 1M tokens.
// Updated 2026-07-05. Unknown models deliberately remain unpriced.
const MODEL_PRICING = [
  [/^gpt-5\.5(?:-|$)/, price(5, 30, 0.5)],
  [/^gpt-5\.4-pro(?:-|$)/, price(30, 180)],
  [/^gpt-5\.4-mini(?:-|$)/, price(0.75, 4.5, 0.075)],
  [/^gpt-5\.4-nano(?:-|$)/, price(0.2, 1.25, 0.02)],
  [/^gpt-5\.4(?:-|$)/, price(2.5, 15, 0.25)],
  [/^gpt-5\.3-codex(?:-|$)/, price(1.75, 14, 0.175)],
  [/^gpt-5\.2-pro(?:-|$)/, price(21, 168)],
  [/^gpt-5\.2(?:-|$)/, price(1.75, 14, 0.175)],
  [/^gpt-5\.1(?:-|$)/, price(1.25, 10, 0.125)],
  [/^gpt-5(?:-|$)/, price(1.25, 10, 0.125)],

  [/^claude-(?:fable-5|mythos-5)(?:-|$)/, price(10, 50, 1, 12.5)],
  [/^claude-opus-4-(?:8|7|6|5)(?:-|$)/, price(5, 25, 0.5, 6.25)],
  // Introductory Sonnet 5 pricing is valid through 2026-08-31.
  [/^claude-sonnet-5(?:-|$)/, price(2, 10, 0.2, 2.5)],
  [/^claude-sonnet-4-(?:6|5)(?:-|$)/, price(3, 15, 0.3, 3.75)],
  [/^claude-haiku-4-5(?:-|$)/, price(1, 5, 0.1, 1.25)],
  [/^claude-opus-4(?:-1)?(?:-|$)/, price(15, 75, 1.5, 18.75)],
  [/^claude-sonnet-4(?:-|$)/, price(3, 15, 0.3, 3.75)],
  [/^claude-3-5-sonnet(?:-|$)/, price(3, 15, 0.3, 3.75)],
  [/^claude-3-5-haiku(?:-|$)/, price(0.8, 4, 0.08, 1)],

  [/^kimi-for-coding$/, price(1.2, 5, 0.2)],
  [/^kimi-k2\.7-code(?:-|$)/, price(1.2, 5, 0.2)],
  [/^kimi-k2\.6(?:-|$)/, price(0.95, 4, 0.16)],
  [/^kimi-k2\.5(?:-|$)/, price(0.6, 3, 0.1)],
  [/^kimi-k2-turbo(?:-|$)/, price(1.11, 8.06, 0.14)],
  [/^kimi-k2(?:-|$)/, price(0.55, 2.2, 0.1)],
  [/^moonshot-v1(?:-|$)/, price(1.7, 1.7, 0.17)],

  [/^glm-5-turbo(?:-|$)/, price(1.2, 4, 0.24)],
  [/^glm-5\.[12](?:-|$)/, price(1.4, 4.4, 0.26)],
  [/^glm-5(?:-|$)/, price(1, 3.2, 0.2)],
  [/^glm-4\.7-flashx(?:-|$)/, price(0.07, 0.4, 0.01)],
  [/^glm-4\.7-flash(?:-|$)/, price(0, 0, 0)],
  [/^glm-4\.[67](?:-|$)/, price(0.6, 2.2, 0.11)],
  [/^glm-4\.5-airx(?:-|$)/, price(1.1, 4.5, 0.22)],
  [/^glm-4\.5-air(?:-|$)/, price(0.2, 1.1, 0.03)],
  [/^glm-4\.5-x(?:-|$)/, price(2.2, 8.9, 0.45)],
  [/^glm-4\.5-flash(?:-|$)/, price(0, 0, 0)],
  [/^glm-4\.5(?:-|$)/, price(0.6, 2.2, 0.11)],

  [/^minimax-m3(?:-|$)/, price(0.6, 2.4, 0.12)],
  [/^minimax-m2\.7(?:-|$)/, price(0.3, 1.2, 0.06)],
  [/^minimax-m2\.5(?:-|$)/, price(0.15, 0.95, 0.03)],
  [/^minimax-m2(?:-|$)/, price(0.27, 0.95, 0.03)],
];

function price(input, output, cacheRead = input, cacheCreation = input) {
  return { input, output, cacheRead, cacheCreation };
}

function normalizeModelId(raw) {
  let model = String(raw || "unknown").trim().toLowerCase();
  if (model.includes("/")) model = model.slice(model.lastIndexOf("/") + 1);
  if (model.includes(":")) model = model.slice(0, model.indexOf(":"));
  model = model.replace(/@/g, "-");
  model = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  model = model.replace(/-\d{8}$/, "");
  return model;
}

function findModelPricing(model) {
  const normalized = normalizeModelId(model);
  const match = MODEL_PRICING.find(([pattern]) => pattern.test(normalized));
  return match ? { model: normalized, ...match[1] } : null;
}

function calculateCostUsd(usage) {
  const pricing = findModelPricing(usage.model);
  if (!pricing) return null;

  const input = finiteTokenCount(usage.inputTokens);
  const output = finiteTokenCount(usage.outputTokens);
  const cacheRead = finiteTokenCount(usage.cacheReadTokens);
  const cacheCreation = finiteTokenCount(usage.cacheCreationTokens);
  const uncachedInput = usage.cacheIncludedInInput === false ? input : Math.max(0, input - Math.min(input, cacheRead));

  return (
    uncachedInput * pricing.input +
    output * pricing.output +
    cacheRead * pricing.cacheRead +
    cacheCreation * pricing.cacheCreation
  ) / 1_000_000;
}

function finiteTokenCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

module.exports = {
  MODEL_PRICING,
  normalizeModelId,
  findModelPricing,
  calculateCostUsd,
};
