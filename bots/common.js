const DB_URL = (process.env.FIREBASE_DATABASE_URL || "https://kzl-crm-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/+$/, "");

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// RTDB тепер пускає на запис лише з входом. Боти входять анонімно через
// REST Firebase Auth (той самий публічний apiKey, що й у браузері).
// Локальний симулятор (127.0.0.1) токена не потребує.
const fs = require("node:fs");
const pathModule = require("node:path");
let authToken = null, authExpiresAt = 0;
function apiKey() {
  if (process.env.FIREBASE_API_KEY) return process.env.FIREBASE_API_KEY;
  const cfg = fs.readFileSync(pathModule.resolve(__dirname, "..", "js", "core", "firebase-config.js"), "utf8");
  const m = cfg.match(/apiKey:\s*"([^"]+)"/);
  if (!m) throw new Error("apiKey not found in js/core/firebase-config.js");
  return m[1];
}
async function getAuthToken() {
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(DB_URL)) return null;
  if (authToken && Date.now() < authExpiresAt) return authToken;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anonymous sign-in failed: ${(data.error && data.error.message) || res.status} (увімкни Anonymous у Firebase Authentication)`);
  authToken = data.idToken;
  authExpiresAt = Date.now() + (Number(data.expiresIn || 3600) - 300) * 1000;
  return authToken;
}

async function request(path, method = "GET", body) {
  const token = await getAuthToken();
  const response = await fetch(`${DB_URL}/${encodePath(path)}.json${token ? `?auth=${encodeURIComponent(token)}` : ""}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Firebase returned invalid JSON for ${method} ${path}`);
  }
  if (!response.ok) {
    const detail = result && result.error ? result.error : response.statusText;
    throw new Error(`Firebase ${method} ${path} failed (${response.status}): ${detail}`);
  }
  return result;
}

async function patch(path, updates) {
  if (Object.keys(updates).length) await request(path, "PATCH", updates);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { DB_URL, request, patch, wait, getAuthToken };
