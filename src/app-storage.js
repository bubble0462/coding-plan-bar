const fs = require("fs");
const path = require("path");

const DATA_DIRECTORY_ENV = "CODING_PLAN_BAR_DATA_DIR";
// Keep app data on D: next to the install tree, but NEVER inside the install
// directory itself — NSIS upgrade/reinstall wipes the install folder.
const DEFAULT_WINDOWS_DATA_DIRECTORY = "D:\\Apps\\Coding Plan Bar Data";
// Historical locations that may still hold config after path changes.
const PREVIOUS_WINDOWS_DATA_DIRECTORIES = [
  "D:\\Apps\\Coding Plan Bar\\Data",
  "D:\\Coding Plan Bar\\Data",
];
const STALE_TEMP_FILE_AGE_MS = 24 * 60 * 60 * 1000;
const LOG_RETENTION_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const LOG_RETENTION_BYTES = 10 * 1024 * 1024;

function resolveApplicationDataDirectory(options = {}) {
  const legacyInput = String(options.legacyUserDataPath || "").trim();
  if (!legacyInput) throw new Error("Missing legacy user data path");
  const legacyUserDataPath = path.resolve(legacyInput);

  const environment = options.environment || process.env;
  const configured = String(environment[DATA_DIRECTORY_ENV] || "").trim();
  if (configured) return path.resolve(configured);

  const platform = options.platform || process.platform;
  const exists = options.exists || fs.existsSync;
  const defaultRoot = path.parse(DEFAULT_WINDOWS_DATA_DIRECTORY).root;
  if (platform === "win32" && exists(defaultRoot)) return DEFAULT_WINDOWS_DATA_DIRECTORY;

  return legacyUserDataPath;
}

function initializeApplicationDataDirectory(options = {}) {
  const legacyInput = String(options.legacyUserDataPath || "").trim();
  const dataInput = String(options.dataDirectory || legacyInput).trim();
  if (!legacyInput || !dataInput) throw new Error("Missing application data directory");
  const legacyUserDataPath = path.resolve(legacyInput);
  const dataDirectory = path.resolve(dataInput);

  // `previousWindowsDataDirectories: null` disables auto previous-path
  // migration (tests). Omitting the option uses the default historical list.
  let previousWindowsDataDirectories;
  if (Object.prototype.hasOwnProperty.call(options, "previousWindowsDataDirectories")) {
    previousWindowsDataDirectories = Array.isArray(options.previousWindowsDataDirectories)
      ? options.previousWindowsDataDirectories.map((item) => path.resolve(item))
      : [];
  } else if (Object.prototype.hasOwnProperty.call(options, "previousWindowsDataDirectory")) {
    previousWindowsDataDirectories = options.previousWindowsDataDirectory
      ? [path.resolve(options.previousWindowsDataDirectory)]
      : [];
  } else {
    previousWindowsDataDirectories = PREVIOUS_WINDOWS_DATA_DIRECTORIES.map((item) => path.resolve(item));
  }

  fs.mkdirSync(dataDirectory, { recursive: true });
  let migrated = false;
  let migrationError = null;
  let legacyCleanupError = null;
  const migrationSources = [];
  if (!options.skipMigration) {
    // Prefer historical D: data sets (newest-path first), then APPDATA.
    const candidates = [...previousWindowsDataDirectories, legacyUserDataPath];
    for (const source of candidates) {
      if (samePath(source, dataDirectory)) continue;
      if (!fs.existsSync(source)) continue;
      if (migrationSources.some((item) => samePath(item, source))) continue;
      migrationSources.push(source);
    }
  }

  if (migrationSources.length) {
    const copy = options.copyDirectoryContents || copyDirectoryContents;
    const removeLegacyDirectory = options.removeLegacyDirectory || ((directory) => {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 80 });
    });
    // Prefer richer configs: copy install-internal Data / old D: Data before APPDATA.
    // Within previous paths, keep the declared order (install Data first).
    const ordered = migrationSources.slice().sort((left, right) => {
      const leftRank = previousWindowsDataDirectories.findIndex((item) => samePath(item, left));
      const rightRank = previousWindowsDataDirectories.findIndex((item) => samePath(item, right));
      const leftScore = leftRank >= 0 ? leftRank : 1000;
      const rightScore = rightRank >= 0 ? rightRank : 1000;
      return leftScore - rightScore;
    });
    try {
      for (const source of ordered) copy(source, dataDirectory);
      migrated = true;
    } catch (error) {
      // Keep legacy directories intact if migration was incomplete. Destination
      // files are never overwritten, so the next startup can retry safely.
      migrationError = error.message || String(error);
    }
    if (migrated) {
      for (const source of ordered) {
        // Never delete the Electron install directory parent; only remove
        // known historical data folders after a successful copy.
        if (samePath(source, legacyUserDataPath)) {
          try {
            removeLegacyDirectory(source);
          } catch (error) {
            legacyCleanupError = error.message || String(error);
          }
          continue;
        }
        try {
          removeLegacyDirectory(source);
        } catch (error) {
          legacyCleanupError = error.message || String(error);
        }
      }
    }
  }

  const cleanup = cleanupApplicationDataDirectory(dataDirectory, options.now);
  return {
    dataDirectory,
    migrated,
    migrationError,
    legacyCleanupError,
    migrationSources,
    cleanup,
  };
}

function copyDirectoryContents(sourceDirectory, targetDirectory) {
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || fs.existsSync(targetPath)) continue;
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  }
}

function cleanupApplicationDataDirectory(dataDirectory, now = Date.now()) {
  const root = path.resolve(dataDirectory);
  const temporaryFiles = removeFiles(root, (file) => {
    return file.name.includes(".tmp") && now - file.stat.mtimeMs > STALE_TEMP_FILE_AGE_MS;
  });
  const logs = pruneDirectory(path.join(root, "logs"), {
    now,
    maxAgeMs: LOG_RETENTION_AGE_MS,
    maxBytes: LOG_RETENTION_BYTES,
  });
  return { temporaryFiles, logs };
}

function pruneDirectory(directory, options = {}) {
  if (!fs.existsSync(directory)) return { removedFiles: 0, removedBytes: 0 };
  const now = Number(options.now || Date.now());
  const maxAgeMs = Number(options.maxAgeMs || 0);
  const maxBytes = Number(options.maxBytes || 0);
  const files = listFiles(directory);
  let removedFiles = 0;
  let removedBytes = 0;
  const remove = (file) => {
    try {
      fs.unlinkSync(file.path);
      removedFiles += 1;
      removedBytes += file.stat.size;
      return true;
    } catch (_error) {
      return false;
    }
  };

  const retained = [];
  for (const file of files) {
    if (maxAgeMs > 0 && now - file.stat.mtimeMs > maxAgeMs) remove(file);
    else retained.push(file);
  }

  if (maxBytes > 0) {
    let totalBytes = retained.reduce((sum, file) => sum + file.stat.size, 0);
    for (const file of retained.sort((left, right) => left.stat.mtimeMs - right.stat.mtimeMs)) {
      if (totalBytes <= maxBytes) break;
      if (remove(file)) totalBytes -= file.stat.size;
    }
  }
  return { removedFiles, removedBytes };
}

function removeFiles(directory, predicate) {
  let removed = 0;
  for (const file of listFiles(directory)) {
    if (!predicate(file)) continue;
    try {
      fs.unlinkSync(file.path);
      removed += 1;
    } catch (_error) {
      // Disposable cache artifacts must never block app startup.
    }
  }
  return removed;
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        files.push({ path: filePath, name: entry.name, stat: fs.statSync(filePath) });
      } catch (_error) {
        // Ignore files that rotate while cleanup runs.
      }
    }
  };
  visit(directory);
  return files;
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, "");
  const first = normalize(left);
  const second = normalize(right);
  return process.platform === "win32" ? first.toLowerCase() === second.toLowerCase() : first === second;
}

module.exports = {
  DATA_DIRECTORY_ENV,
  DEFAULT_WINDOWS_DATA_DIRECTORY,
  PREVIOUS_WINDOWS_DATA_DIRECTORIES,
  // Back-compat alias used by older tests/docs.
  PREVIOUS_WINDOWS_DATA_DIRECTORY: PREVIOUS_WINDOWS_DATA_DIRECTORIES[1],
  LOG_RETENTION_AGE_MS,
  LOG_RETENTION_BYTES,
  cleanupApplicationDataDirectory,
  initializeApplicationDataDirectory,
  resolveApplicationDataDirectory,
};
