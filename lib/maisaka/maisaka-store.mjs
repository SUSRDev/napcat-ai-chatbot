/**
 * MaiBot 风格长期记忆 / 表达 / 行为 本地存储
 */
import fs from 'fs';
import path from 'path';

function emptyStore() {
  return {
    version: 1,
    memories: [],
    expressions: [],
    behaviors: [],
    slangs: [],
    recallState: {}
  };
}

/** @param {string} storePath */
export function loadMaisakaStore(storePath) {
  try {
    if (!storePath || !fs.existsSync(storePath)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    return {
      ...emptyStore(),
      ...raw,
      memories: Array.isArray(raw?.memories) ? raw.memories : [],
      expressions: Array.isArray(raw?.expressions) ? raw.expressions : [],
      behaviors: Array.isArray(raw?.behaviors) ? raw.behaviors : [],
      slangs: Array.isArray(raw?.slangs) ? raw.slangs : [],
      recallState: raw?.recallState && typeof raw.recallState === 'object' ? raw.recallState : {}
    };
  } catch {
    return emptyStore();
  }
}

/** @param {string} storePath @param {object} store */
export function saveMaisakaStore(storePath, store) {
  if (!storePath) return;
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
}

/** @param {string} groupId */
export function getRecallState(store, groupId) {
  const key = String(groupId || 'global');
  if (!store.recallState[key]) {
    store.recallState[key] = { lastAt: 0, lastMsgCount: 0, cachedBlock: '', msgCounter: 0 };
  }
  return store.recallState[key];
}

let idSeq = Date.now();
export function nextMaisakaId(prefix = 'm') {
  idSeq += 1;
  return `${prefix}${idSeq}`;
}

/** 简易语义检索：词重叠打分 */
function scoreText(query, text) {
  const q = String(query || '').toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!q || !t) return 0;
  if (t.includes(q) || q.includes(t)) return 10;
  const qw = [...new Set(q.split(/[\s，。！？、,.!?;；]+/).filter((w) => w.length >= 2))];
  if (!qw.length) return 0;
  let hit = 0;
  for (const w of qw) if (t.includes(w)) hit += 1;
  return hit / qw.length;
}

/** @param {object} store @param {string} groupId @param {string} impression @param {number} limit */
export function searchMemories(store, groupId, impression, limit = 3) {
  const gid = String(groupId || '');
  const list = (store.memories || [])
    .filter((m) => !m.groupId || m.groupId === gid || m.groupId === 'global')
    .map((m) => ({ ...m, _score: scoreText(impression, `${m.impression || ''} ${m.text || ''} ${(m.tags || []).join(' ')}`) }))
    .filter((m) => m._score > 0)
    .sort((a, b) => (b._score - a._score) || (b.createdAt - a.createdAt));
  return list.slice(0, Math.max(1, limit));
}

/** @param {object} store @param {string} groupId @param {string} context @param {number} limit */
export function selectExpressions(store, groupId, context, limit = 4) {
  const gid = String(groupId || '');
  const settings = store.expressionSettings || {};
  if (settings.usageEnabled === false) return [];
  return (store.expressions || [])
    .filter((e) => {
      if (e.enabled === false) return false;
      const rs = String(e.reviewStatus || 'pending');
      if (!['passed', 'ai_passed', 'manual_passed'].includes(rs)) return false;
      return !e.groupId || e.groupId === gid;
    })
    .map((e) => ({ ...e, _score: scoreText(context, `${e.situation || ''} ${e.style || ''}`) + (Number(e.score) || 0) * 0.01 }))
    .filter((e) => e._score > 0.05)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

/** @param {object} store @param {string} groupId @param {string} context */
export function selectBehaviors(store, groupId, context, limit = 3) {
  const gid = String(groupId || '');
  return (store.behaviors || [])
    .filter((b) => !b.groupId || b.groupId === gid)
    .map((b) => ({ ...b, _score: scoreText(context, `${b.action || ''} ${b.outcome || ''}`) + (Number(b.score) || 0) * 0.02 }))
    .filter((b) => b._score > 0.05)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

/** @param {object} store @param {object} item */
export function upsertMemory(store, item) {
  store.memories = store.memories || [];
  store.memories.push(item);
  if (store.memories.length > 500) store.memories.splice(0, store.memories.length - 500);
}

/** @param {object} store @param {object} item */
export function upsertExpression(store, item) {
  store.expressions = store.expressions || [];
  const key = `${item.groupId || ''}\t${item.situation}\t${item.style}`;
  const idx = store.expressions.findIndex((e) => `${e.groupId || ''}\t${e.situation}\t${e.style}` === key);
  if (idx >= 0) {
    store.expressions[idx].count = (Number(store.expressions[idx].count) || 0) + 1;
    store.expressions[idx].score = (Number(store.expressions[idx].score) || 0) + 0.1;
    store.expressions[idx].updatedAt = Date.now();
    return;
  }
  const autoPass = store.expressionSettings?.autoAiPass === true;
  store.expressions.push({
    ...item,
    reviewStatus: item.reviewStatus || (autoPass ? 'ai_passed' : 'pending'),
    enabled: item.enabled !== false,
    source: item.source || 'learned',
    reviewedBy: autoPass ? 'ai' : '',
    reviewedAt: autoPass ? Date.now() : 0
  });
  if (store.expressions.length > 300) store.expressions.splice(0, store.expressions.length - 300);
}

/** @param {object} store @param {object} item */
export function upsertBehavior(store, item) {
  store.behaviors = store.behaviors || [];
  const idx = store.behaviors.findIndex((b) => b.id === item.id);
  if (idx >= 0) {
    store.behaviors[idx] = { ...store.behaviors[idx], ...item, updatedAt: Date.now() };
    return;
  }
  store.behaviors.push(item);
  if (store.behaviors.length > 200) store.behaviors.splice(0, store.behaviors.length - 200);
}

/** @param {object} store @param {number} behaviorId @param {number} delta */
export function applyBehaviorScoreDelta(store, behaviorId, delta) {
  const b = (store.behaviors || []).find((x) => x.id === behaviorId);
  if (!b) return;
  b.score = (Number(b.score) || 0) + Number(delta || 0);
  if (delta >= 0.5) b.successCount = (Number(b.successCount) || 0) + 1;
  if (delta < 0) b.failureCount = (Number(b.failureCount) || 0) + 1;
  b.updatedAt = Date.now();
}
