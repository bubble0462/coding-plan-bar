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
  run("npm", ["run", "dist"]);
  if (!fs.existsSync(asset)) throw new Error(`未找到安装包：${asset}`);

  const sha = sha256File(asset);
  run("git", ["push", "origin", "main"]);
  const notes = [
    `Coding Plan Bar ${tag}`,
    "",
    "## 导入体验",
    "",
    "- 合并原“粘贴”和“导入”按钮，统一为一个导入入口。",
    "- 新导入卡片支持拖放 JSON 文件、选择本机文件和直接粘贴 JSON 内容。",
    "- 继续保留导入前的安全预览，不显示 OAuth token 或 API Key 原文。",
    "- 明确提示确认导入后会立即加密保存，无需再次点击保存。",
    "",
    "## Bug 修复",
    "",
    "- 修复供应商编辑页产生未保存修改后，右下角保存按钮不立即显示的问题。",
    "- 保存与撤销按钮现在随脏状态局部更新，不需要切换到诊断中心触发整页渲染。",
    "- 增加统一导入、真实文件拖放和供应商编辑页保存按钮回归测试。",
    "",
    "升级不会删除现有供应商、账号或 API Key 配置。",
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
