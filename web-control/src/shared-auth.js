const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const AUTH_DB_ENV = "SHARED_AUTH_DB";
const SESSION_COOKIE_NAME = "projects_lan_session";
const DEFAULT_AUTH_DB = path.join(os.homedir(), ".local-webapps", "auth.db");

function authDbPath(env = process.env) {
  return path.resolve(expandHome(env[AUTH_DB_ENV] || DEFAULT_AUTH_DB));
}

function sessionTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function getSessionToken(request, cookieName = SESSION_COOKIE_NAME) {
  return parseCookies(request.headers.cookie || "")[cookieName] || "";
}

function getUserBySessionToken(token, options = {}) {
  if (!token) return null;
  const dbPath = options.dbPath || authDbPath(options.env);
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare(`
      SELECT users.id, users.username, users.username_key, users.created_at, users.updated_at,
             auth_sessions.expires_at
      FROM auth_sessions
      JOIN users ON users.id = auth_sessions.user_id
      WHERE auth_sessions.token_hash = ?
        AND auth_sessions.revoked_at IS NULL
    `).get(sessionTokenHash(token));
    if (!row || !isFutureTimestamp(row.expires_at, options.now)) return null;
    return {
      id: row.id,
      username: row.username,
      usernameKey: row.username_key || normalizeUsername(row.username),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (error) {
    if (isMissingAuthDbError(error)) return null;
    throw error;
  } finally {
    if (db) db.close();
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) continue;
    const decoded = safeDecodeCookieValue(value);
    if (decoded === null) continue;
    cookies[key] = decoded;
  }
  return cookies;
}

function safeDecodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isFutureTimestamp(value, now = new Date()) {
  const expiresAt = Date.parse(String(value || ""));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  return Number.isFinite(expiresAt) && Number.isFinite(nowMs) && expiresAt > nowMs;
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\u00df/g, "ss")
    .replace(/\u03c2/g, "\u03c3")
    .replace(/\u017f/g, "s");
}

function isMissingAuthDbError(error) {
  const message = String(error.message || "");
  return error.code === "ERR_INVALID_ARG_VALUE"
    || error.code === "SQLITE_CANTOPEN"
    || error.errcode === 14
    || message.includes("unable to open database file")
    || message.includes("no such table");
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") return os.homedir();
  if (text.startsWith(`~${path.sep}`) || text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

module.exports = {
  AUTH_DB_ENV,
  DEFAULT_AUTH_DB,
  SESSION_COOKIE_NAME,
  authDbPath,
  getSessionToken,
  getUserBySessionToken,
  isFutureTimestamp,
  normalizeUsername,
  parseCookies,
  sessionTokenHash
};
