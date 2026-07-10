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

function protectConfigSecrets(config, codec) {
  const copy = clone(config);
  if (!codec) return copy;
  copy.providers = (copy.providers || []).map((provider) => {
    const next = { ...provider };
    for (const field of SECRET_FIELDS) {
      const value = next[field];
      if (typeof value === "string" && value && value !== SECRET_MASK) {
        next[`${field}${ENCRYPTED_SUFFIX}`] = codec.encrypt(value);
        delete next[field];
      } else if (!value) {
        delete next[field];
        delete next[`${field}${ENCRYPTED_SUFFIX}`];
      }
    }
    return next;
  });
  return copy;
}

function revealConfigSecrets(config, codec) {
  const copy = clone(config);
  copy.providers = (copy.providers || []).map((provider) => {
    const next = { ...provider };
    for (const field of SECRET_FIELDS) {
      const encryptedField = `${field}${ENCRYPTED_SUFFIX}`;
      if (next[encryptedField]) {
        if (!codec) throw new Error("当前系统无法解密 Coding Plan Bar 凭据");
        next[field] = codec.decrypt(next[encryptedField]);
      }
      delete next[encryptedField];
    }
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
  protectConfigSecrets,
  revealConfigSecrets,
  redactConfigSecrets,
  mergeMaskedSecrets,
  hasPlaintextSecrets,
};
