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

/**
 * Pull the section for `version` from CHANGELOG.md (Keep a Changelog style).
 * Falls back to a short default note when the section is missing.
 */
function releaseNotesFromChangelog(version, sha) {
  const changelogPath = path.join(root, "CHANGELOG.md");
  let body = "";
  if (fs.existsSync(changelogPath)) {
    const text = fs.readFileSync(changelogPath, "utf8");
    const re = new RegExp(
      `## \\[${escapeRegExp(version)}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`,
    );
    const match = text.match(re);
    if (match) body = match[1].trim();
  }
  if (!body) {
    body = [
      "### Notes",
      "",
      "详见仓库 CHANGELOG.md。",
      "",
      "升级前请从系统托盘完全退出旧版本，再运行新安装包。",
    ].join("\n");
  }
  return [`Coding Plan Bar ${tag}`, "", body, "", `SHA256: ${sha}`].join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const notes = releaseNotesFromChangelog(plain, sha);
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
