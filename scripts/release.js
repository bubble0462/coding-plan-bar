#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const version = process.argv[2] || `v${pkg.version}`;
const tag = version.startsWith("v") ? version : `v${version}`;
const plain = tag.slice(1);
const asset = path.join(root, "release", `Coding Plan Bar-Setup-${plain}-x64.exe`);

function shellQuote(value) {
  const text = String(value);
  if (!/[\s"'()&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function run(command, args, options = {}) {
  const line = [command, ...args].map(shellQuote).join(" ");
  console.log(`> ${line}`);
  return execFileSync(line, {
    cwd: root,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: true,
  });
}

function main() {
  const status = run("git", ["status", "--short"], { capture: true }).trim();
  if (status) throw new Error("工作区不干净，请先提交或暂存当前修改。\n" + status);
  const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
  if (branch !== "main") throw new Error(`当前分支是 ${branch}，此项目默认从 main 发布。`);

  run("npm", ["run", "check"]);
  run("npm", ["run", "dist"]);
  if (!fs.existsSync(asset)) throw new Error(`未找到安装包：${asset}`);

  const sha = crypto.createHash("sha256").update(fs.readFileSync(asset)).digest("hex");
  run("git", ["tag", "-f", tag]);
  run("git", ["push", "origin", "main"]);
  run("git", ["push", "--force", "origin", tag]);

  const notes = [`Coding Plan Bar ${tag}`, "", `SHA256: ${sha}`].join("\n");
  try {
    run("gh", ["release", "view", tag], { capture: true });
    run("gh", ["release", "edit", tag, "--title", tag, "--notes", notes]);
  } catch (_error) {
    run("gh", ["release", "create", tag, "--target", "main", "--title", tag, "--notes", notes]);
  }
  run("gh", ["release", "upload", tag, asset, "--clobber"]);
  run("gh", ["release", "edit", tag, "--draft=false"]);
  const release = verifyRelease(tag, sha);
  console.log(`\n发布完成：${release.url}`);
  console.log(`安装包：${asset}`);
  console.log(`SHA256：${sha}`);
}

function verifyRelease(expectedTag, expectedSha) {
  const raw = run("gh", ["release", "view", expectedTag, "--json", "url,tagName,isDraft,assets"], { capture: true });
  const release = JSON.parse(raw);
  if (release.tagName !== expectedTag) {
    throw new Error(`Release tag 校验失败：期望 ${expectedTag}，实际 ${release.tagName || "空"}`);
  }
  if (release.isDraft) throw new Error(`${expectedTag} 仍是 draft，未公开发布。`);
  if (!String(release.url || "").endsWith(`/releases/tag/${expectedTag}`)) {
    throw new Error(`Release URL 异常：${release.url || "空"}`);
  }

  const expectedNames = assetNameCandidates(path.basename(asset));
  const uploaded = (release.assets || []).find((item) => expectedNames.includes(item.name));
  if (!uploaded) {
    throw new Error(`Release 缺少安装包 asset：${[...expectedNames].join(" 或 ")}`);
  }

  const digest = String(uploaded.digest || "").toLowerCase();
  if (digest && digest !== `sha256:${expectedSha.toLowerCase()}`) {
    throw new Error(`安装包 SHA256 校验失败：${digest}`);
  }
  if (uploaded.state && uploaded.state !== "uploaded") {
    throw new Error(`安装包 asset 状态异常：${uploaded.state}`);
  }
  return release;
}

function assetNameCandidates(name) {
  return [name, name.replace(/ /g, ".")];
}

main();
