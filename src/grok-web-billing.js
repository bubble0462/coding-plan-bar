const DEFAULT_ENDPOINT = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
const MAX_BODY_BYTES = 1024 * 1024;

async function fetchGrokWebBilling(accessToken, options = {}) {
  if (!accessToken) throw new Error("缺少 Grok Web Billing 授权");
  const fetchImpl =
    options.fetchImpl ||
    ((url, opts) => {
      const { fetchWithTimeout } = require("./http-client");
      return fetchWithTimeout(url, opts, options.timeoutMs || 15000);
    });
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Origin: "https://grok.com",
          Referer: "https://grok.com/?_s=usage",
          Accept: "*/*",
          "Content-Type": "application/grpc-web+proto",
          "x-grpc-web": "1",
          "x-user-agent": "connect-es/2.1.1",
          "User-Agent": "Coding Plan Bar",
        },
        body: Buffer.from([0, 0, 0, 0, 0]),
      });
      if (!response.ok) {
        const error = new Error(`Grok Web Billing HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.length || data.length > MAX_BODY_BYTES) {
        throw new Error(data.length ? "Grok Web Billing 响应过大" : "Grok Web Billing 返回空响应");
      }
      validateGrpcStatus(response.headers, data);
      return parseGrokWebBilling(data, options.now || Date.now());
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || !isRetryable(error)) throw error;
    }
  }
  throw lastError;
}

function parseGrokWebBilling(data, now = Date.now()) {
  let payloads = grpcDataFrames(data);
  if (!payloads.length && looksLikeProtobuf(data)) payloads = [Buffer.from(data)];
  if (!payloads.length) throw new Error("无法解析 Grok Web Billing 数据帧");

  const scan = { fixed32: [], varints: [] };
  for (const payload of payloads) scanProtobuf(payload, 0, [], scan);
  const percent = scan.fixed32
    .filter((field) => field.path.at(-1) === 1 && Number.isFinite(field.value) && field.value >= 0 && field.value <= 100)
    .sort((a, b) => a.path.length - b.path.length || a.order - b.order)[0]?.value;
  const resetFields = scan.varints
    .filter((field) => field.value >= 1_700_000_000 && field.value <= 2_100_000_000)
    .map((field) => ({ path: field.path, value: Number(field.value) * 1000 }))
    .filter((field) => field.value > Number(now));
  const resetsAtMs = resetFields
    .filter((field) => samePath(field.path, [1, 5, 1]))
    .map((field) => field.value)
    .sort((a, b) => a - b)[0]
    || resetFields.map((field) => field.value).sort((a, b) => a - b)[0]
    || null;
  const hasUsagePeriod = scan.varints.some((field) =>
    pathStartsWith(field.path, [1, 6])
      || (samePath(field.path, [1, 8, 1]) && (field.value === 1 || field.value === 2)));
  // proto3 omits scalar fields set to their zero value. A valid current period
  // with a reset time and no fixed32 fields therefore means 0% used.
  const noUsageYet = percent == null && scan.fixed32.length === 0 && resetsAtMs != null && hasUsagePeriod;
  if (percent == null && !noUsageYet) throw new Error("Grok Web Billing 响应缺少使用率");
  return {
    creditUsagePercent: Number(percent ?? 0),
    billingPeriodEnd: resetsAtMs ? new Date(resetsAtMs).toISOString() : null,
    usagePercentOmitted: noUsageYet,
    source: "grok-web",
  };
}

function samePath(actual, expected) {
  return actual.length === expected.length && expected.every((value, index) => actual[index] === value);
}

function pathStartsWith(actual, prefix) {
  return actual.length >= prefix.length && prefix.every((value, index) => actual[index] === value);
}

function grpcDataFrames(data) {
  const bytes = Buffer.from(data);
  const payloads = [];
  let offset = 0;
  while (offset + 5 <= bytes.length) {
    const flags = bytes[offset];
    const length = bytes.readUInt32BE(offset + 1);
    const start = offset + 5;
    const end = start + length;
    if (end > bytes.length) return [];
    if ((flags & 0x80) === 0) payloads.push(bytes.subarray(start, end));
    offset = end;
  }
  return offset === bytes.length ? payloads : [];
}

function scanProtobuf(data, depth, path, scan) {
  if (depth > 4) return;
  const bytes = Buffer.from(data);
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key) break;
    offset = key.next;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (!field) break;
    const fieldPath = [...path, field];
    if (wire === 0) {
      const value = readVarint(bytes, offset);
      if (!value) break;
      scan.varints.push({ path: fieldPath, value: Number(value.value) });
      offset = value.next;
    } else if (wire === 1) {
      if (offset + 8 > bytes.length) break;
      offset += 8;
    } else if (wire === 2) {
      const length = readVarint(bytes, offset);
      if (!length) break;
      offset = length.next;
      const size = Number(length.value);
      if (!Number.isSafeInteger(size) || offset + size > bytes.length) break;
      scanProtobuf(bytes.subarray(offset, offset + size), depth + 1, fieldPath, scan);
      offset += size;
    } else if (wire === 5) {
      if (offset + 4 > bytes.length) break;
      scan.fixed32.push({ path: fieldPath, value: bytes.readFloatLE(offset), order: scan.fixed32.length });
      offset += 4;
    } else {
      break;
    }
  }
}

function readVarint(bytes, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < bytes.length && shift < 64n) {
    const byte = bytes[offset];
    offset += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: offset };
    shift += 7n;
  }
  return null;
}

function looksLikeProtobuf(data) {
  const first = Buffer.from(data)[0];
  if (first == null) return false;
  const field = first >> 3;
  const wire = first & 7;
  return field > 0 && [0, 1, 2, 5].includes(wire);
}

function validateGrpcStatus(headers, data) {
  const headerStatus = Number(headers?.get?.("grpc-status") || 0);
  if (headerStatus) throw new Error(`Grok Web Billing gRPC ${headerStatus}`);
  const bytes = Buffer.from(data);
  let offset = 0;
  while (offset + 5 <= bytes.length) {
    const flags = bytes[offset];
    const length = bytes.readUInt32BE(offset + 1);
    const start = offset + 5;
    const end = start + length;
    if (end > bytes.length) break;
    if (flags & 0x80) {
      const text = bytes.subarray(start, end).toString("utf8");
      const match = text.match(/(?:^|\r?\n)grpc-status:\s*(\d+)/i);
      if (match && Number(match[1])) throw new Error(`Grok Web Billing gRPC ${match[1]}`);
    }
    offset = end;
  }
}

function isRetryable(error) {
  if (error?.name === "AbortError") return true;
  if ([408, 425, 429, 500, 502, 503, 504].includes(Number(error?.status))) return true;
  return /timeout|network|socket|fetch failed/i.test(String(error?.message || ""));
}

module.exports = {
  DEFAULT_ENDPOINT,
  fetchGrokWebBilling,
  parseGrokWebBilling,
  grpcDataFrames,
};
