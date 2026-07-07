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

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    cwd: root,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
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
    run("gh", ["release", "create", tag, asset, "--target", "main", "--title", tag, "--notes", notes]);
  }
  run("gh", ["release", "upload", tag, asset, "--clobber"]);
  const url = run("gh", ["release", "view", tag, "--json", "url", "-q", ".url"], { capture: true }).trim();
  console.log(`\n发布完成：${url}`);
  console.log(`安装包：${asset}`);
  console.log(`SHA256：${sha}`);
}

main();
