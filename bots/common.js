const DB_URL = (process.env.FIREBASE_DATABASE_URL || "https://kzl-crm-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/+$/, "");

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function request(path, method = "GET", body) {
  const response = await fetch(`${DB_URL}/${encodePath(path)}.json`, {
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

module.exports = { DB_URL, request, patch, wait };
