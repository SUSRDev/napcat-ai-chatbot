/**
 * SQLite 数据库连接、Schema、迁移
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { detectSqliteDriver } from './sqlite-setup.mjs';

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT '',
  user_id TEXT DEFAULT '',
  impression TEXT DEFAULT '',
  text TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  created_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_group ON memories(group_id);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);

CREATE TABLE IF NOT EXISTS expressions (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT '',
  situation TEXT DEFAULT '',
  style TEXT DEFAULT '',
  review_status TEXT DEFAULT 'pending',
  enabled INTEGER DEFAULT 1,
  count INTEGER DEFAULT 1,
  score REAL DEFAULT 1,
  source TEXT DEFAULT 'learned',
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0,
  reviewed_at INTEGER DEFAULT 0,
  reviewed_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_expressions_group ON expressions(group_id);
CREATE INDEX IF NOT EXISTS idx_expressions_review ON expressions(review_status);

CREATE TABLE IF NOT EXISTS behaviors (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT '',
  action TEXT DEFAULT '',
  outcome TEXT DEFAULT '',
  actor_type TEXT DEFAULT '',
  score REAL DEFAULT 1,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_behaviors_group ON behaviors(group_id);

CREATE TABLE IF NOT EXISTS slangs (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT '',
  term TEXT DEFAULT '',
  meaning TEXT DEFAULT '',
  usage TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  type TEXT DEFAULT 'slang',
  review_status TEXT DEFAULT 'pending',
  enabled INTEGER DEFAULT 1,
  count INTEGER DEFAULT 1,
  score REAL DEFAULT 1,
  source TEXT DEFAULT 'learned',
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0,
  reviewed_at INTEGER DEFAULT 0,
  reviewed_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_slangs_group ON slangs(group_id);

CREATE TABLE IF NOT EXISTS recall_state (
  group_key TEXT PRIMARY KEY,
  last_at INTEGER DEFAULT 0,
  last_msg_count INTEGER DEFAULT 0,
  cached_block TEXT DEFAULT '',
  msg_counter INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_profiles (
  qq_user_id TEXT PRIMARY KEY,
  nickname TEXT DEFAULT '',
  card TEXT DEFAULT '',
  group_id TEXT DEFAULT '',
  group_name TEXT DEFAULT '',
  sex TEXT DEFAULT '',
  age TEXT DEFAULT '',
  sign TEXT DEFAULT '',
  qid TEXT DEFAULT '',
  qq_level TEXT DEFAULT '',
  bili_mid TEXT DEFAULT '',
  bili_uname TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',
  last_seen_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_group ON user_profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_bili ON user_profiles(bili_mid);

CREATE TABLE IF NOT EXISTS bili_sessions (
  qq_user_id TEXT PRIMARY KEY,
  bili_mid TEXT DEFAULT '',
  bili_uname TEXT DEFAULT '',
  cookies_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER DEFAULT 0,
  login_method TEXT DEFAULT 'qr',
  updated_at INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bili_qr_pending (
  session_key TEXT PRIMARY KEY,
  qq_user_id TEXT DEFAULT '',
  qrcode_key TEXT DEFAULT '',
  qrcode_url TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT 0,
  expires_at INTEGER DEFAULT 0,
  login_api TEXT DEFAULT 'web_v2',
  poll_cookies_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS emoji_registry (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL
);
`;

let dbInstance = null;
let dbPathCache = '';
let driverType = '';

/** @param {string} configDir */
export function getDbPath(configDir) {
  return path.join(configDir, 'agent-data.db');
}

/** @param {string} configDir @param {string} pluginRoot */
export async function openDatabase(configDir, pluginRoot = '') {
  if (dbInstance && dbPathCache === getDbPath(configDir)) {
    return { db: dbInstance, driver: driverType, path: dbPathCache };
  }

  const detected = await detectSqliteDriver(pluginRoot);
  if (!detected.ok) return { db: null, driver: '', path: '', error: detected.error };

  const dbPath = getDbPath(configDir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (detected.driver === 'better-sqlite3') {
    const req = createRequire(path.join(detected.moduleDir, 'package.json'));
    const Database = req('better-sqlite3');
    dbInstance = new Database(dbPath);
    driverType = 'better-sqlite3';
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    dbInstance = new DatabaseSync(dbPath);
    driverType = 'node:sqlite';
  }

  dbInstance.exec(SCHEMA_SQL);
  migrateBiliQrPending(dbInstance);
  dbPathCache = dbPath;
  return { db: dbInstance, driver: driverType, path: dbPath };
}

/** 旧库补列：B 站扫码 pending 的 login_api / poll_cookies_json */
function migrateBiliQrPending(db) {
  const cols = db.prepare('PRAGMA table_info(bili_qr_pending)').all().map((r) => r.name);
  if (!cols.includes('login_api')) {
    try { db.exec(`ALTER TABLE bili_qr_pending ADD COLUMN login_api TEXT DEFAULT 'web_v2'`); } catch { /* ignore */ }
  }
  if (!cols.includes('poll_cookies_json')) {
    try { db.exec(`ALTER TABLE bili_qr_pending ADD COLUMN poll_cookies_json TEXT DEFAULT '[]'`); } catch { /* ignore */ }
  }
}

export function closeDatabase() {
  try {
    if (dbInstance?.close) dbInstance.close();
  } catch { /* ignore */ }
  dbInstance = null;
  dbPathCache = '';
  driverType = '';
}

/** better-sqlite3 有 db.transaction；node:sqlite DatabaseSync 无此方法，用 BEGIN/COMMIT 兼容 */
function runInTransaction(db, fn) {
  if (typeof db.transaction === 'function') {
    return db.transaction(fn)();
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export function getMeta(db, key, defaultVal = '') {
  const row = db.prepare('SELECT value FROM store_meta WHERE key = ?').get(String(key));
  return row ? row.value : defaultVal;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO store_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(String(key), String(value));
}

/** @param {object} db @param {string} jsonPath */
export function migrateFromJson(db, jsonPath) {
  if (getMeta(db, 'json_migrated') === '1') return { migrated: false, reason: 'already_migrated' };
  if (!jsonPath || !fs.existsSync(jsonPath)) return { migrated: false, reason: 'no_json' };

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (e) {
    return { migrated: false, reason: e.message };
  }

  runInTransaction(db, () => {
    for (const m of raw.memories || []) {
      db.prepare(`INSERT OR IGNORE INTO memories(id, group_id, user_id, impression, text, tags, created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(m.id, m.groupId || '', m.userId || '', m.impression || '', m.text || '', JSON.stringify(m.tags || []), m.createdAt || 0);
    }
    for (const e of raw.expressions || []) {
      db.prepare(`INSERT OR IGNORE INTO expressions(id, group_id, situation, style, review_status, enabled, count, score, source, created_at, updated_at, reviewed_at, reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(e.id, e.groupId || '', e.situation || '', e.style || '', e.reviewStatus || 'pending', e.enabled === false ? 0 : 1, e.count || 1, e.score || 1, e.source || '', e.createdAt || 0, e.updatedAt || 0, e.reviewedAt || 0, e.reviewedBy || '');
    }
    for (const b of raw.behaviors || []) {
      db.prepare(`INSERT OR IGNORE INTO behaviors(id, group_id, action, outcome, actor_type, score, success_count, failure_count, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(b.id, b.groupId || '', b.action || '', b.outcome || '', b.actorType || '', b.score || 1, b.successCount || 0, b.failureCount || 0, b.createdAt || 0, b.updatedAt || 0);
    }
    for (const s of raw.slangs || []) {
      db.prepare(`INSERT OR IGNORE INTO slangs(id, group_id, term, meaning, usage, tags, type, review_status, enabled, count, score, source, created_at, updated_at, reviewed_at, reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(s.id, s.groupId || '', s.term || '', s.meaning || '', s.usage || '', JSON.stringify(s.tags || []), s.type || 'slang', s.reviewStatus || 'pending', s.enabled === false ? 0 : 1, s.count || 1, s.score || 1, s.source || '', s.createdAt || 0, s.updatedAt || 0, s.reviewedAt || 0, s.reviewedBy || '');
    }
    const rs = raw.recallState || {};
    for (const [k, v] of Object.entries(rs)) {
      db.prepare(`INSERT OR IGNORE INTO recall_state(group_key, last_at, last_msg_count, cached_block, msg_counter) VALUES(?,?,?,?,?)`)
        .run(k, v.lastAt || 0, v.lastMsgCount || 0, v.cachedBlock || '', v.msgCounter || 0);
    }
    if (raw.expressionSettings) setMeta(db, 'expressionSettings', JSON.stringify(raw.expressionSettings));
    if (raw.slangSettings) setMeta(db, 'slangSettings', JSON.stringify(raw.slangSettings));
    for (const em of raw.emojiRegistry || []) {
      db.prepare('INSERT OR IGNORE INTO emoji_registry(id, data_json) VALUES(?, ?)').run(em.id, JSON.stringify(em));
    }
    setMeta(db, 'json_migrated', '1');
    setMeta(db, 'json_migrated_from', jsonPath);
    setMeta(db, 'json_migrated_at', String(Date.now()));
  });

  const backup = jsonPath + '.bak-' + Date.now();
  try { fs.renameSync(jsonPath, backup); } catch { /* keep original */ }

  return { migrated: true, backup, counts: {
    memories: (raw.memories || []).length,
    expressions: (raw.expressions || []).length,
    behaviors: (raw.behaviors || []).length,
    slangs: (raw.slangs || []).length
  }};
}

/** 从 SQLite 加载为 legacy store 对象 */
export function loadStoreFromDb(db) {
  const store = {
    version: 2,
    memories: [],
    expressions: [],
    behaviors: [],
    slangs: [],
    recallState: {},
    emojiRegistry: []
  };

  store.memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT 500').all().map((r) => ({
    id: r.id, groupId: r.group_id, userId: r.user_id || '', impression: r.impression, text: r.text,
    tags: JSON.parse(r.tags || '[]'), createdAt: r.created_at
  }));

  store.expressions = db.prepare('SELECT * FROM expressions ORDER BY updated_at DESC LIMIT 300').all().map((r) => ({
    id: r.id, groupId: r.group_id, situation: r.situation, style: r.style,
    reviewStatus: r.review_status, enabled: r.enabled !== 0, count: r.count, score: r.score,
    source: r.source, createdAt: r.created_at, updatedAt: r.updated_at,
    reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by
  }));

  store.behaviors = db.prepare('SELECT * FROM behaviors ORDER BY updated_at DESC LIMIT 200').all().map((r) => ({
    id: r.id, groupId: r.group_id, action: r.action, outcome: r.outcome,
    actorType: r.actor_type, score: r.score, successCount: r.success_count,
    failureCount: r.failure_count, createdAt: r.created_at, updatedAt: r.updated_at
  }));

  store.slangs = db.prepare('SELECT * FROM slangs ORDER BY updated_at DESC LIMIT 400').all().map((r) => ({
    id: r.id, groupId: r.group_id, term: r.term, meaning: r.meaning, usage: r.usage,
    tags: JSON.parse(r.tags || '[]'), type: r.type, reviewStatus: r.review_status,
    enabled: r.enabled !== 0, count: r.count, score: r.score, source: r.source,
    createdAt: r.created_at, updatedAt: r.updated_at, reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by
  }));

  for (const r of db.prepare('SELECT * FROM recall_state').all()) {
    store.recallState[r.group_key] = {
      lastAt: r.last_at, lastMsgCount: r.last_msg_count, cachedBlock: r.cached_block, msgCounter: r.msg_counter
    };
  }

  try {
    store.expressionSettings = JSON.parse(getMeta(db, 'expressionSettings', '{}')) || {};
  } catch { store.expressionSettings = {}; }
  try {
    store.slangSettings = JSON.parse(getMeta(db, 'slangSettings', '{}')) || {};
  } catch { store.slangSettings = {}; }

  store.emojiRegistry = db.prepare('SELECT data_json FROM emoji_registry').all().map((r) => {
    try { return JSON.parse(r.data_json); } catch { return null; }
  }).filter(Boolean);

  return store;
}

/** 将 legacy store 写回 SQLite */
export function persistStoreToDb(db, store) {
  runInTransaction(db, () => {
    db.prepare('DELETE FROM memories').run();
    db.prepare('DELETE FROM expressions').run();
    db.prepare('DELETE FROM behaviors').run();
    db.prepare('DELETE FROM slangs').run();
    db.prepare('DELETE FROM recall_state').run();
    db.prepare('DELETE FROM emoji_registry').run();

    const insMem = db.prepare('INSERT INTO memories(id, group_id, user_id, impression, text, tags, created_at) VALUES(?,?,?,?,?,?,?)');
    for (const m of store.memories || []) {
      insMem.run(m.id, m.groupId || '', m.userId || '', m.impression || '', m.text || '', JSON.stringify(m.tags || []), m.createdAt || 0);
    }

    const insExp = db.prepare('INSERT INTO expressions(id, group_id, situation, style, review_status, enabled, count, score, source, created_at, updated_at, reviewed_at, reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const e of store.expressions || []) {
      insExp.run(e.id, e.groupId || '', e.situation || '', e.style || '', e.reviewStatus || 'pending', e.enabled === false ? 0 : 1, e.count || 1, e.score || 1, e.source || '', e.createdAt || 0, e.updatedAt || 0, e.reviewedAt || 0, e.reviewedBy || '');
    }

    const insBeh = db.prepare('INSERT INTO behaviors(id, group_id, action, outcome, actor_type, score, success_count, failure_count, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    for (const b of store.behaviors || []) {
      insBeh.run(b.id, b.groupId || '', b.action || '', b.outcome || '', b.actorType || '', b.score || 1, b.successCount || 0, b.failureCount || 0, b.createdAt || 0, b.updatedAt || 0);
    }

    const insSlang = db.prepare('INSERT INTO slangs(id, group_id, term, meaning, usage, tags, type, review_status, enabled, count, score, source, created_at, updated_at, reviewed_at, reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const s of store.slangs || []) {
      insSlang.run(s.id, s.groupId || '', s.term || '', s.meaning || '', s.usage || '', JSON.stringify(s.tags || []), s.type || 'slang', s.reviewStatus || 'pending', s.enabled === false ? 0 : 1, s.count || 1, s.score || 1, s.source || '', s.createdAt || 0, s.updatedAt || 0, s.reviewedAt || 0, s.reviewedBy || '');
    }

    const insRecall = db.prepare('INSERT INTO recall_state(group_key, last_at, last_msg_count, cached_block, msg_counter) VALUES(?,?,?,?,?)');
    for (const [k, v] of Object.entries(store.recallState || {})) {
      insRecall.run(k, v.lastAt || 0, v.lastMsgCount || 0, v.cachedBlock || '', v.msgCounter || 0);
    }

    if (store.expressionSettings) setMeta(db, 'expressionSettings', JSON.stringify(store.expressionSettings));
    if (store.slangSettings) setMeta(db, 'slangSettings', JSON.stringify(store.slangSettings));

    const insEm = db.prepare('INSERT INTO emoji_registry(id, data_json) VALUES(?, ?)');
    for (const em of store.emojiRegistry || []) {
      if (em?.id) insEm.run(em.id, JSON.stringify(em));
    }
  });
}

export function searchMemoriesDb(db, groupId, impression, limit = 3) {
  const gid = String(groupId || '');
  const q = String(impression || '').trim().slice(0, 80);
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE (group_id = ? OR group_id = '' OR group_id = 'global')
      AND (impression LIKE ? OR text LIKE ?)
    ORDER BY created_at DESC LIMIT ?
  `).all(gid, like, like, Math.max(1, limit * 3));
  return rows.map((r) => ({
    id: r.id, groupId: r.group_id, userId: r.user_id, impression: r.impression, text: r.text,
    tags: JSON.parse(r.tags || '[]'), createdAt: r.created_at
  })).slice(0, limit);
}
