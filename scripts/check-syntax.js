#!/usr/bin/env node
/**
 * Walk src/ and scripts/ and run `node --check` on every .js file.
 * Fails fast on the first syntax error. Replaces the hand-maintained
 * list in package.json so new files are picked up automatically.
 */
const { readdirSync } = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TARGETS = ["src", "scripts"];

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const target of TARGETS) {
  const abs = path.join(ROOT, target);
  files.push(...listJsFiles(abs));
}

if (files.length === 0) {
  console.error("check: no .js files found under", TARGETS.join(", "));
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  try {
    execSync(`node --check "${file}"`, { stdio: "pipe" });
  } catch (err) {
    failed++;
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    console.error(`\u00d7 ${rel}`);
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    if (stderr) console.error(stderr);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}

console.log(`check: ${files.length} file(s) OK`);
