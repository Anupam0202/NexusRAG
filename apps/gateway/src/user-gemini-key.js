import { serviceHeaders } from "./supabase-keys.js";
const VAULT_TABLE = "nexus_user_provider_keys";

function keyError(code, status = 503) {
  return Object.assign(new Error(`Gemini API key operation unavailable: ${code}.`), { code, status });
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw keyError("KEY_VAULT_UNAVAILABLE");
  }
}

function encodeBase64(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Users' own Gemini keys are sealed with AES-GCM (NX-24). Version 2 binds each ciphertext, through its associated
// data, to its user, the provider and the secret that sealed it, so a ciphertext copied into another user's row does
// not open. It is stored as `v2:<secret id>:<base64>`, the id being the first 16 hex digits of the secret's SHA-256.
// Keys sealed before version 2 (no prefix) still open. To rotate the secret, put the new one in
// GEMINI_USER_KEY_ENCRYPTION_SECRET and the old one in GEMINI_USER_KEY_ENCRYPTION_SECRET_PREVIOUS; the daily cron
// re-seals every key with the new secret (reencryptUserGeminiKeys), after which the old one can go.
const V1_ASSOCIATED_DATA = "nexusrag-user-gemini-key-v1";
const v2AssociatedData = (userId, secretId) => `nexusrag-user-gemini-key/v2|${userId}|gemini|${secretId}`;
const encode = (value) => new TextEncoder().encode(value);

async function sealingSecret(value) {
  const raw = decodeBase64(value);
  if (raw.length !== 32) throw keyError("KEY_VAULT_UNAVAILABLE");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const id = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { id, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]) };
}

async function sealingSecrets(env) {
  if (!env.GEMINI_USER_KEY_ENCRYPTION_SECRET) throw keyError("KEY_VAULT_UNAVAILABLE");
  return {
    current: await sealingSecret(env.GEMINI_USER_KEY_ENCRYPTION_SECRET),
    previous: env.GEMINI_USER_KEY_ENCRYPTION_SECRET_PREVIOUS ? await sealingSecret(env.GEMINI_USER_KEY_ENCRYPTION_SECRET_PREVIOUS) : null,
  };
}

async function encryptGeminiKey(env, value, userId) {
  if (typeof userId !== "string" || !userId) throw keyError("KEY_VAULT_UNAVAILABLE");
  const { current } = await sealingSecrets(env);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encode(v2AssociatedData(userId, current.id)) }, current.key, encode(value));
  return { ciphertext: `v2:${current.id}:${encodeBase64(new Uint8Array(sealed))}`, nonce: encodeBase64(nonce) };
}

async function decryptGeminiKey(env, record, userId) {
  try {
    const { current, previous } = await sealingSecrets(env);
    const open = (secret, associatedData, body) => crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(record.nonce), additionalData: encode(associatedData) }, secret.key, decodeBase64(body));
    const versioned = /^v2:([0-9a-f]{16}):(.+)$/.exec(record.ciphertext || "");
    let opened;
    if (versioned) {
      const secret = [current, previous].find((candidate) => candidate?.id === versioned[1]);
      if (!secret) throw keyError("KEY_VAULT_UNAVAILABLE");
      opened = await open(secret, v2AssociatedData(userId, secret.id), versioned[2]);
    } else {
      opened = await open(current, V1_ASSOCIATED_DATA, record.ciphertext)
        .catch((error) => (previous ? open(previous, V1_ASSOCIATED_DATA, record.ciphertext) : Promise.reject(error)));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(opened);
  } catch {
    throw keyError("KEY_VAULT_UNAVAILABLE");
  }
}

async function vaultRequest(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    signal: AbortSignal.timeout(8_000),
    headers: {
      ...serviceHeaders(env),
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw keyError("KEY_VAULT_UNAVAILABLE");
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getUserGeminiKeyRecord(env, userId) {
  const rows = await vaultRequest(
    env,
    `${VAULT_TABLE}?user_id=eq.${encodeURIComponent(userId)}&provider=eq.gemini&is_active=eq.true&cost_consent_at=not.is.null&select=ciphertext,nonce,key_fingerprint,cost_consent_at&limit=1`,
  );
  return rows?.[0] || null;
}

async function loadUserGeminiKey(env, userId) {
  const record = await getUserGeminiKeyRecord(env, userId);
  return record ? decryptGeminiKey(env, record, userId) : null;
}

async function saveUserGeminiKey(env, userId, apiKey, costConsentAt) {
  if (typeof costConsentAt !== "string" || !Number.isFinite(Date.parse(costConsentAt))) {
    throw keyError("COST_CONSENT_REQUIRED", 400);
  }
  const encrypted = await encryptGeminiKey(env, apiKey, userId);
  const fingerprint = `…${apiKey.slice(-4)}`;
  await vaultRequest(env, `${VAULT_TABLE}?on_conflict=user_id,provider`, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{
      user_id: userId,
      provider: "gemini",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      key_fingerprint: fingerprint,
      is_active: true,
      cost_consent_at: costConsentAt,
      updated_at: new Date().toISOString(),
    }]),
  });
  return fingerprint;
}

async function deleteUserGeminiKey(env, userId) {
  await vaultRequest(env, `${VAULT_TABLE}?user_id=eq.${encodeURIComponent(userId)}&provider=eq.gemini`, {
    method: "PATCH",
    body: JSON.stringify({ ciphertext: null, nonce: null, key_fingerprint: null, is_active: false, cost_consent_at: null, updated_at: new Date().toISOString() }),
  });
}

/**
 * Re-seals users' keys that are not sealed with the current secret in version 2: keys from before version 2 and,
 * after a rotation, keys sealed with the previous secret. An update applies only while the stored ciphertext is
 * unchanged, so a key replaced or deleted meanwhile is never written back. Logs counts, never user ids.
 */
async function reencryptUserGeminiKeys(env, { limit = 25 } = {}) {
  if (!env.GEMINI_USER_KEY_ENCRYPTION_SECRET || !env.SUPABASE_URL) return { state: "NOT_CONFIGURED", reencrypted: 0, failed: 0, more: false };
  const { current } = await sealingSecrets(env);
  const rows = await vaultRequest(env, `${VAULT_TABLE}?provider=eq.gemini&is_active=eq.true`
    + `&ciphertext=not.like.${encodeURIComponent(`v2:${current.id}:*`)}&select=user_id,ciphertext,nonce&limit=${limit}`);
  let reencrypted = 0, failed = 0;
  for (const row of rows || []) {
    try {
      const sealed = await encryptGeminiKey(env, await decryptGeminiKey(env, row, row.user_id), row.user_id);
      const updated = await vaultRequest(env, `${VAULT_TABLE}?user_id=eq.${encodeURIComponent(row.user_id)}&provider=eq.gemini`
        + `&ciphertext=eq.${encodeURIComponent(row.ciphertext)}`, { method: "PATCH", body: JSON.stringify({ ...sealed, updated_at: new Date().toISOString() }) });
      if (Array.isArray(updated) && updated.length === 1) reencrypted++;
    } catch {
      failed++;
    }
  }
  const result = { state: "CHECKED", reencrypted, failed, more: (rows?.length || 0) === limit };
  if (reencrypted || failed) (failed ? console.warn : console.log)(JSON.stringify({ event: "byok_reencryption", ...result }));
  return result;
}

function validateGeminiKey(env, apiKey) {
  return fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
    method: "GET",
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
}

export {
  deleteUserGeminiKey,
  encryptGeminiKey,
  getUserGeminiKeyRecord,
  loadUserGeminiKey,
  reencryptUserGeminiKeys,
  saveUserGeminiKey,
  validateGeminiKey,
};