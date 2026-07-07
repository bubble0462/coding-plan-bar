function classifyFailure(message, status) {
  const text = String(message || "").toLowerCase();
  const code = Number(status || httpStatusFromMessage(text));

  if (code === 401 || text.includes("unauthorized") || text.includes("authentication failed")) {
    return {
      kind: "auth_expired",
      label: "登录过期",
      action: "重新登录或重新导入账号 token 后再刷新。",
    };
  }
  if (code === 403 || text.includes("forbidden") || text.includes("permission")) {
    return {
      kind: "permission",
      label: "权限不足",
      action: "检查账号订阅、API 权限或当前 accountId 是否可用。",
    };
  }
  if (code === 429 || text.includes("rate limit") || text.includes("too many")) {
    return {
      kind: "rate_limited",
      label: "请求过快",
      action: "稍后再试，或把刷新间隔调大一些。",
    };
  }
  if (text.includes("abort") || text.includes("timeout") || text.includes("timed out")) {
    return {
      kind: "timeout",
      label: "请求超时",
      action: "检查网络连接，或稍后重新刷新。",
    };
  }
  if (text.includes("failed to fetch") || text.includes("network") || text.includes("econn") || text.includes("enotfound")) {
    return {
      kind: "network",
      label: "网络异常",
      action: "检查代理、网络或接口地址是否能访问。",
    };
  }
  if (text.includes("json") || text.includes("parse") || text.includes("解析")) {
    return {
      kind: "parse_error",
      label: "响应异常",
      action: "接口返回格式无法识别，确认是否仍兼容当前版本。",
    };
  }
  if (text.includes("缺少") || text.includes("not_found")) {
    return {
      kind: "missing_config",
      label: "缺少配置",
      action: "补全 API Key、登录凭据或请求地址后保存刷新。",
    };
  }
  if (code >= 500) {
    return {
      kind: "server_error",
      label: "服务异常",
      action: "服务端暂时不可用，稍后再刷新。",
    };
  }
  if (code >= 400) {
    return {
      kind: "api_error",
      label: "接口错误",
      action: "检查接口地址、账号权限和请求配置。",
    };
  }
  return {
    kind: "unknown",
    label: "查询失败",
    action: "查看错误详情，确认配置后重新刷新。",
  };
}

function httpStatusFromMessage(text) {
  const match = String(text || "").match(/http\s*(\d{3})|\b(\d{3})\b/i);
  if (!match) return null;
  return Number(match[1] || match[2]);
}

module.exports = { classifyFailure };
