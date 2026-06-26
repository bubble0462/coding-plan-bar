// Self-contained update helpers for Coding Plan Bar.
//
// Pure logic lives here so it can be unit-tested and mocked by the capture
// scripts without spinning up a real network request. The main process wires
// these helpers to IPC and pushes progress to the settings window.

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const REPO = "bubble0462/coding-plan-bar";
const API_HOST = "api.github.com";

// Accepted Windows x64 NSIS installer asset name patterns.
const ASSET_PATTERNS = [
  /^Coding\.Plan\.Bar-Setup-[\d.]+-x64\.exe$/i,
  /^Coding Plan Bar-Setup-[\d.]+-x64\.exe$/i,
];

/**
 * Parse a version string like "v0.3.6" or "0.3.6" into a comparable tuple.
 * Non-numeric segments are dropped. Returns null when nothing parses, so the
 * caller can degrade to "unable to determine" instead of guessing.
 */
function parseVersion(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(/^v/i, "");
  const parts = cleaned.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 0) return null;
  return parts;
}

/**
 * Compare two version tuples. Returns:
 *   -1 if a < b, 0 if equal, 1 if a > b.
 * Shorter tuples are zero-padded (1.2 === 1.2.0).
 */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  const length = Math.max(va.length, vb.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (va[index] || 0) - (vb[index] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Find the Windows x64 installer asset in a GitHub release payload.
 * Returns the matching asset object or null.
 */
function findInstallerAsset(release) {
  if (!release || !Array.isArray(release.assets)) return null;
  return (
    release.assets.find((asset) =>
      ASSET_PATTERNS.some((pattern) => pattern.test(asset.name || "")),
    ) || null
  );
}

/**
 * Transform a raw GitHub release JSON into the structured result consumed by
 * the UI: current vs latest version, whether an update exists, and the asset
 * to download. Pure function — safe to call with mock data in tests.
 */
function buildUpdateResult(currentVersion, release) {
  if (!release || !release.tag_name) {
    return {
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: null,
      publishedAt: null,
      releaseNotes: null,
      asset: null,
      error: "无法解析发布信息",
    };
  }

  const latestVersion = release.tag_name;
  const asset = findInstallerAsset(release);
  const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;

  return {
    currentVersion,
    latestVersion,
    hasUpdate,
    releaseUrl: release.html_url || null,
    publishedAt: release.published_at || release.created_at || null,
    releaseNotes: release.body || null,
    asset: asset
      ? {
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
        }
      : null,
    error: null,
  };
}

/**
 * Fetch the latest release JSON from GitHub. Resolves with the parsed object.
 * Throws a readable Error on non-2xx status or network failure.
 */
function fetchLatestRelease({ token, fetcher } = {}) {
  const request = (resolve, reject) => {
    const headers = {
      "User-Agent": "coding-plan-bar-updater",
      Accept: "application/vnd.github+json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = https.get(
      {
        host: API_HOST,
        path: `/repos/${REPO}/releases/latest`,
        headers,
      },
      (res) => {
        // Follow a single redirect (GitHub occasionally redirects).
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          https
            .get(res.headers.location, { headers }, (redirected) => collect(redirected, resolve, reject))
            .on("error", reject);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`GitHub 返回状态 ${res.statusCode}`));
          return;
        }
        collect(res, resolve, reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("检查更新超时")));
  };

  // Allow tests to inject a fake transport.
  if (typeof fetcher === "function") return fetcher();
  return new Promise(request);
}

function collect(res, resolve, reject) {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (chunk) => {
    body += chunk;
  });
  res.on("end", () => {
    try {
      resolve(JSON.parse(body));
    } catch (error) {
      reject(new Error("无法解析 GitHub 响应"));
    }
  });
  res.on("error", reject);
}

/**
 * Download an asset to a temp file, reporting progress via onProgress.
 * Resolves with the final file path. The file is written to a .part path and
 * only renamed to .exe once the download completes, so a partial file can
 * never be mistaken for a ready installer.
 *
 * onProgress receives { percent, downloadedBytes, totalBytes }.
 */
function downloadAsset(assetUrl, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(os.tmpdir(), "coding-plan-bar-update");
    fs.mkdirSync(tempDir, { recursive: true });
    const fileName = decodeURIComponent(assetUrl.split("/").pop() || "update.part");
    const finalPath = path.join(tempDir, fileName);
    const partPath = `${finalPath}.part`;

    // If a previous complete download exists, reuse it instead of re-downloading.
    if (fs.existsSync(finalPath)) {
      resolve(finalPath);
      return;
    }

    const file = fs.createWriteStream(partPath);
    let received = 0;
    let total = 0;

    const handleResponse = (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          https.get(res.headers.location, handleResponse).on("error", fail);
          return;
        }
        res.resume();
        fail(new Error(`下载失败，状态 ${res.statusCode}`));
        return;
      }
      total = Number(res.headers["content-length"] || 0);
      res.on("data", (chunk) => {
        received += chunk.length;
        const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        onProgress({ percent, downloadedBytes: received, totalBytes: total });
      });
      res.pipe(file);
    };

    const fail = (error) => {
      file.destroy();
      try {
        fs.unlinkSync(partPath);
      } catch {
        /* ignore cleanup errors */
      }
      reject(error);
    };

    file.on("finish", () => {
      file.close((closeError) => {
        if (closeError) {
          fail(closeError);
          return;
        }
        // Sanity check: reject obviously empty or tiny downloads.
        const stats = fs.statSync(partPath);
        if (stats.size === 0) {
          fail(new Error("下载的文件为空"));
          return;
        }
        fs.renameSync(partPath, finalPath);
        onProgress({ percent: 100, downloadedBytes: received, totalBytes: total });
        resolve(finalPath);
      });
    });

    const req = https.get(assetUrl, handleResponse);
    req.on("error", fail);
    req.setTimeout(120000, () => req.destroy(new Error("下载超时")));
  });
}

module.exports = {
  REPO,
  parseVersion,
  compareVersions,
  findInstallerAsset,
  buildUpdateResult,
  fetchLatestRelease,
  downloadAsset,
};
