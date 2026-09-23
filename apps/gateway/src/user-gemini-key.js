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

async function encryptionKey(env) {
  if (!env.GEMINI_USER_KEY_ENCRYPTION_SECRET) throw keyError("KEY_VAULT_UNAVAILABLE");
  const raw = decodeBase64(env.GEMINI_USER_KEY_ENCRYPTION_SECRET);
  if (raw.length !== 32) throw keyError("KEY_VAULT_UNAVAILABLE");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptGeminiKey(env, value) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode("nexusrag-user-gemini-key-v1") },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  );
  return { ciphertext: encodeBase64(new Uint8Array(encrypted)), nonce: encodeBase64(nonce) };
}

async function decryptGeminiKey(env, record) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64(record.nonce),
        additionalData: new TextEncoder().encode("nexusrag-user-gemini-key-v1"),
      },
      await encryptionKey(env),
      decodeBase64(record.ciphertext),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  } catch {
    throw keyError("KEY_VAULT_UNAVAILABLE");
  }
}

async function vaultRequest(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    signal: AbortSignal.timeout(8_000),
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
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
    `${VAULT_TABLE}?user_id=eq.${encodeURIComponent(userId)}&provider=eq.gemini&is_active=eq.true&select=ciphertext,nonce,key_fingerprint&limit=1`,
  );
  return rows?.[0] || null;
}

async function loadUserGeminiKey(env, userId) {
  const record = await getUserGeminiKeyRecord(env, userId);
  return record ? decryptGeminiKey(env, record) : null;
}

async function saveUserGeminiKey(env, userId, apiKey) {
  const encrypted = await encryptGeminiKey(env, apiKey);
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
      updated_at: new Date().toISOString(),
    }]),
  });
  return fingerprint;
}

async function deleteUserGeminiKey(env, userId) {
  await vaultRequest(env, `${VAULT_TABLE}?user_id=eq.${encodeURIComponent(userId)}&provider=eq.gemini`, {
    method: "PATCH",
    body: JSON.stringify({ ciphertext: null, nonce: null, key_fingerprint: null, is_active: false, updated_at: new Date().toISOString() }),
  });
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
  saveUserGeminiKey,
  validateGeminiKey,
};