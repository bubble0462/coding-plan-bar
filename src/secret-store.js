const SECRET_FIELDS = ["apiKey", "accessToken"];
const SECRET_MASK = "••••••••••••";
const ENCRYPTED_SUFFIX = "Encrypted";
const ENCRYPTED_PREFIX = "dpapi:";

function createSecretCodec(safeStorage) {
  if (
    !safeStorage ||
    typeof safeStorage.isEncryptionAvailable !== "function" ||
    !safeStorage.isEncryptionAvailable()
  ) {
    return null;
  }
  return {
    encrypt(value) {
      const encrypted = safeStorage.encryptString(String(value));
      return `${ENCRYPTED_PREFIX}${Buffer.from(encrypted).toString("base64")}`;
    },
    decrypt(value) {
      const encoded = String(value || "");
      if (!encoded.startsWith(ENCRYPTED_PREFIX)) throw new Error("不支持的凭据密文格式");
      return safeStorage.decryptString(Buffer.from(encoded.slice(ENCRYPTED_PREFIX.length), "base64"));
    },
  };
}

function normalizeUnavailableSecretFields(provider) {
  const unavailable = Array.isArray(provider?.unavailableSecretFields)
    ? provider.unavailableSecretFields
    : [];
  return [...new Set(unavailable.filter((field) => SECRET_FIELDS.includes(field)))];
}

function hasUnavailableSecret(provider, field) {
  return normalizeUnavailableSecretFields(provider).includes(field);
}

function protectConfigSecrets(config, codec) {
  const copy = clone(config);
  if (!codec) return copy;
  copy.providers = (copy.providers || []).map((provider) => {
    const next = { ...provider };
    const unavailable = normalizeUnavailableSecretFields(next);
    for (const field of SECRET_FIELDS) {
      const encryptedField = `${field}${ENCRYPTED_SUFFIX}`;
      const value = next[field];
      if (typeof value === "string" && value && value !== SECRET_MASK) {
        next[encryptedField] = codec.encrypt(value);
        delete next[field];
        const index = unavailable.indexOf(field);
        if (index >= 0) unavailable.splice(index, 1);
      } else if (next[encryptedField]) {
        // Keep the original ciphertext when the secret is missing or marked
        // unavailable, so a later re-auth can replace it without wiping peers.
        delete next[field];
      } else if (!value) {
        delete next[field];
        delete next[encryptedField];
      }
    }
    if (unavailable.length) next.unavailableSecretFields = unavailable;
    else delete next.unavailableSecretFields;
    return next;
  });
  return copy;
}

function revealConfigSecrets(config, codec) {
  const copy = clone(config);
  copy.providers = (copy.providers || []).map((provider) => {
    const next = { ...provider };
    const unavailable = normalizeUnavailableSecretFields(next);
    for (const field of SECRET_FIELDS) {
      const encryptedField = `${field}${ENCRYPTED_SUFFIX}`;
      const encryptedValue = next[encryptedField];
      if (!encryptedValue) {
        delete next[encryptedField];
        continue;
      }
      try {
        if (!codec) throw new Error("当前系统无法解密 Coding Plan Bar 凭据");
        next[field] = codec.decrypt(encryptedValue);
        delete next[encryptedField];
        const index = unavailable.indexOf(field);
        if (index >= 0) unavailable.splice(index, 1);
      } catch (_error) {
        // Isolate per-credential DPAPI failures so one stale key cannot take
        // down tray startup for every other provider. Keep the ciphertext so a
        // later save does not wipe the original secret blob.
        if (!unavailable.includes(field)) unavailable.push(field);
        delete next[field];
      }
    }
    if (unavailable.length) next.unavailableSecretFields = unavailable;
    else delete next.unavailableSecretFields;
    return next;
  });
  return copy;
}

function redactConfigSecrets(config) {
  const copy = clone(config);
  copy.providers = (copy.providers || []).map((provider) => {
    const next = { ...provider };
    for (const field of SECRET_FIELDS) {
      if (next[field]) next[field] = SECRET_MASK;
      delete next[`${field}${ENCRYPTED_SUFFIX}`];
    }
    return next;
  });
  return copy;
}

function mergeMaskedSecrets(incoming, current) {
  const copy = clone(incoming);
  const currentById = new Map((current?.providers || []).map((provider) => [provider.id, provider]));
  copy.providers = (copy.providers || []).map((provider) => {
    const next = { ...provider };
    const existing = currentById.get(provider.id);
    for (const field of SECRET_FIELDS) {
      if (next[field] !== SECRET_MASK) continue;
      if (existing?.[field]) next[field] = existing[field];
      else delete next[field];
    }
    return next;
  });
  return copy;
}

function hasPlaintextSecrets(config) {
  return (config?.providers || []).some((provider) =>
    SECRET_FIELDS.some((field) => typeof provider?.[field] === "string" && provider[field] && provider[field] !== SECRET_MASK),
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

module.exports = {
  SECRET_FIELDS,
  SECRET_MASK,
  createSecretCodec,
  normalizeUnavailableSecretFields,
  hasUnavailableSecret,
  protectConfigSecrets,
  revealConfigSecrets,
  redactConfigSecrets,
  mergeMaskedSecrets,
  hasPlaintextSecrets,
};
