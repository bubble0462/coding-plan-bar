#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const requested = process.argv[2] || `v${pkg.version}`;
const tag = requested.startsWith("v") ? requested : `v${requested}`;
const plain = tag.slice(1);
const asset = path.join(root, "release", `Coding Plan Bar-Setup-${plain}-x64.exe`);

function displayCommand(command, args) {
  return [command, ...args].map((value) => (/\s/.test(String(value)) ? JSON.stringify(String(value)) : String(value))).join(" ");
}

function run(command, args, options = {}) {
  const useWindowsCommandShell = process.platform === "win32" && ["npm", "npx"].includes(command);
  const executable = useWindowsCommandShell ? process.env.ComSpec || "cmd.exe" : command;
  const childArgs = useWindowsCommandShell
    ? ["/d", "/s", "/c", [`${command}.cmd`, ...args].map(quoteCmdArgument).join(" ")]
    : args;
  console.log(`> ${displayCommand(command, args)}`);
  return execFileSync(executable, childArgs, {
    cwd: root,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    windowsHide: true,
  });
}

function quoteCmdArgument(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function succeeds(command, args) {
  try {
    run(command, args, { capture: true });
    return true;
  } catch (_error) {
    return false;
  }
}

function main() {
  if (!/^\d+\.\d+\.\d+$/.test(plain)) throw new Error(`无效版本号：${tag}`);
  if (plain !== pkg.version) throw new Error(`package.json 是 ${pkg.version}，不能发布 ${tag}`);

  const status = run("git", ["status", "--short"], { capture: true }).trim();
  if (status) throw new Error(`工作区不干净，请先提交当前修改。\n${status}`);
  const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
  if (branch !== "main") throw new Error(`当前分支是 ${branch}，发布必须从 main 执行`);
  if (succeeds("git", ["rev-parse", "--verify", `refs/tags/${tag}`])) {
    throw new Error(`Tag ${tag} 已存在，禁止覆盖已有版本`);
  }
  if (succeeds("gh", ["release", "view", tag])) {
    throw new Error(`GitHub Release ${tag} 已存在，禁止覆盖已有版本`);
  }

  run("npm", ["run", "check"]);
  run("npm", ["run", "smoke"]);
  run("npm", ["run", "smoke:electron"]);
  run("npm", ["run", "screenshot:grok"]);
  run("npm", ["run", "screenshot:reorder"]);
  run("npm", ["run", "screenshot:settings:import-drop"]);
  run("npm", ["run", "screenshot:settings:import-paste"]);
  run("npm", ["run", "screenshot:settings:dirty"]);
  run("npm", ["run", "screenshot:settings:usage"]);
  run("npm", ["run", "dist"]);
  if (!fs.existsSync(asset)) throw new Error(`未找到安装包：${asset}`);

  const sha = sha256File(asset);
  run("git", ["push", "origin", "main"]);
  const notes = [
    `Coding Plan Bar ${tag}`,
    "",
    "## 账号连通性测试与对话探测",
    "",
    "- 设置页 Codex 账号编辑器新增「测试连通」按钮，调用 wham/usage 端点快速诊断 token 是否有效、网络是否通、accountId 是否正确，返回 HTTP 状态、延迟和 5 小时 / 7 天窗口利用率。",
    "- 新增「对话探测」卡片，调用 ChatGPT 后端 Codex Responses API 实际发送一条消息（默认 hi），流式增量显示模型回复，用于验证账号能否真正对话。",
    "- 模型下拉自动读取本机 ~/.codex/models_cache.json，默认选择 gpt-5.4-mini 等较便宜模型；也可手动输入自定义测试消息。",
    "- 失败原因走统一的 failure-classifier，给出登录过期、网络异常、请求过快等可读提示与处置建议。",
    "- 本次仅覆盖 Codex 账号；Claude / Grok / 余额查询等其它供应商类型不显示探测入口。",
    "",
    "升级前请从系统托盘完全退出旧版本，再运行新安装包。",
    "",
    `SHA256: ${sha}`,
  ].join("\n");
  run("gh", [
    "release",
    "create",
    tag,
    asset,
    "--target",
    "main",
    "--title",
    tag,
    "--notes",
    notes,
  ]);
  const release = verifyRelease(tag, sha);
  console.log(`\n发布完成：${release.url}`);
  console.log(`安装包：${asset}`);
  console.log(`SHA256：${sha}`);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifyRelease(expectedTag, expectedSha) {
  const raw = run("gh", ["release", "view", expectedTag, "--json", "url,tagName,isDraft,assets"], { capture: true });
  const release = JSON.parse(raw);
  if (release.tagName !== expectedTag || release.isDraft) throw new Error("Release 状态校验失败");
  const uploaded = (release.assets || []).find((item) => assetNameCandidates(path.basename(asset)).includes(item.name));
  if (!uploaded || (uploaded.state && uploaded.state !== "uploaded")) {
    throw new Error("Release 安装包上传校验失败");
  }
  const digest = String(uploaded.digest || "").toLowerCase();
  if (!digest || digest !== `sha256:${expectedSha.toLowerCase()}`) {
    throw new Error(`Release SHA256 校验失败：${digest || "缺少 digest"}`);
  }
  return release;
}

function assetNameCandidates(name) {
  return [name, name.replace(/ /g, ".")];
}

main();
