const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const {
  getUserBySessionToken,
  isFutureTimestamp,
  normalizeUsername,
  parseCookies,
  sessionTokenHash
} = require("../src/shared-auth");

test("shared auth validates non-revoked projects.lan sessions against users", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-auth-"));
  const dbPath = path.join(tempDir, "auth.db");
  createAuthDb(dbPath, {
    token: "valid-session",
    username: "Chris Chang",
    expiresAt: futureIso()
  });

  const user = getUserBySessionToken("valid-session", { dbPath });

  assert.deepEqual(user, {
    id: 1,
    username: "Chris Chang",
    usernameKey: "chris chang",
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  });
  assert.equal(getUserBySessionToken("wrong-session", { dbPath }), null);
});

test("shared auth rejects expired or revoked sessions", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-auth-"));
  const expiredDb = path.join(tempDir, "expired.db");
  const revokedDb = path.join(tempDir, "revoked.db");
  createAuthDb(expiredDb, {
    token: "expired-session",
    username: "Chris Chang",
    expiresAt: "2026-01-01T00:00:00.000Z"
  });
  createAuthDb(revokedDb, {
    token: "revoked-session",
    username: "Chris Chang",
    expiresAt: futureIso(),
    revokedAt: "2026-06-02T00:05:00.000Z"
  });

  assert.equal(getUserBySessionToken("expired-session", { dbPath: expiredDb }), null);
  assert.equal(getUserBySessionToken("revoked-session", { dbPath: revokedDb }), null);
});

test("shared auth treats a missing database as no authenticated user", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-auth-"));
  const dbPath = path.join(tempDir, "missing", "auth.db");

  assert.equal(getUserBySessionToken("missing-db-session", { dbPath }), null);
});

test("shared auth parses cookies and timestamp freshness", () => {
  assert.deepEqual(parseCookies("projects_lan_session=abc%20123; theme=light"), {
    projects_lan_session: "abc 123",
    theme: "light"
  });
  assert.deepEqual(parseCookies("projects_lan_session=%E0%A4%A; theme=light"), {
    theme: "light"
  });
  assert.equal(isFutureTimestamp("2026-06-02T12:00:00.000Z", new Date("2026-06-02T11:59:59.000Z")), true);
  assert.equal(isFutureTimestamp("2026-06-02T12:00:00.000Z", new Date("2026-06-02T12:00:01.000Z")), false);
});

test("shared auth username normalization matches common Python casefold behavior", () => {
  assert.equal(normalizeUsername(" Straße "), "strasse");
  assert.equal(normalizeUsername("STRASSE"), "strasse");
});

function createAuthDb(dbPath, options) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.prepare(`
    INSERT INTO users (username, username_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(options.username, "chris chang", "2026-06-02T00:00:00.000Z", "2026-06-02T00:00:00.000Z");
  db.prepare(`
    INSERT INTO auth_sessions (user_id, token_hash, created_at, expires_at, revoked_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(sessionTokenHash(options.token), "2026-06-02T00:01:00.000Z", options.expiresAt, options.revokedAt || null);
  db.close();
}

function futureIso() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}
