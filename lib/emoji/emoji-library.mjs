/**
 * 表情库状态：不认识 / 已认识 / 占为己有 / 待处理 / 抛弃
 */
import fs from 'fs';
import path from 'path';
import { ensureEmojiRegistry } from './emoji-manager.mjs';

export const EMOJI_STATUSES = ['unknown', 'recognized', 'owned', 'pending', 'discarded'];

/** @param {object} rec */
export function emojiHasTags(rec) {
  const tags = Array.isArray(rec?.emotions) ? rec.emotions : [];
  return tags.length > 0 || Boolean(String(rec?.description || '').trim());
}

/** MaiBot 风格状态流转校验 */
export function canTransitionEmojiStatus(rec, nextStatus) {
  const cur = resolveEmojiStatus(rec);
  const next = EMOJI_STATUSES.includes(nextStatus) ? nextStatus : '';
  if (!next || cur === next) return { ok: true };
  if (next === 'discarded' || next === 'unknown') return { ok: true };
  if (next === 'pending') return { ok: cur === 'unknown' || cur === 'discarded' };
  if (next === 'recognized') {
    if (cur === 'owned') return { ok: true };
    if (!emojiHasTags(rec)) return { ok: false, error: '请先添加标签或描述后再标记为「已认识」' };
    if (cur !== 'pending' && cur !== 'unknown') return { ok: false, error: '仅「待处理」或「不认识」可标记为已认识' };
    return { ok: true };
  }
  if (next === 'owned') {
    if (!emojiHasTags(rec)) return { ok: false, error: '请先添加标签后再「占为己有」' };
    if (cur !== 'recognized') return { ok: false, error: '请先标记为「已认识」，再占为己有（MaiBot 流程）' };
    return { ok: true };
  }
  return { ok: false, error: '无效状态' };
}

/** 修正历史数据：无标签却占为己有的条目回到待处理 */
export function normalizeEmojiRegistry(store) {
  ensureEmojiRegistry(store);
  let fixed = 0;
  for (const rec of store.emojiRegistry || []) {
    const s = resolveEmojiStatus(rec);
    if (s === 'owned' && !emojiHasTags(rec)) {
      setEmojiStatus(rec, 'pending');
      fixed += 1;
    } else if (s === 'owned' && rec.registered !== true) {
      rec.registered = true;
    }
  }
  if (store.emojiCacheStats) {
    store.emojiCacheStats.registered = (store.emojiRegistry || []).filter((e) => resolveEmojiStatus(e) === 'owned').length;
  }
  return fixed;
}

/** @param {object} rec */
export function resolveEmojiStatus(rec) {
  if (rec?.emojiStatus && EMOJI_STATUSES.includes(rec.emojiStatus)) return rec.emojiStatus;
  if (rec?.registered === true) return 'owned';
  if (rec?.rejectedReason === 'discarded' || rec?.rejectedReason === 'not_emoji') return 'discarded';
  if (!rec?.vlmProcessed) return 'unknown';
  if (rec?.reviewStatus === 'pending') return 'pending';
  return 'recognized';
}

/** @param {object} rec @param {string} status */
export function setEmojiStatus(rec, status) {
  const s = EMOJI_STATUSES.includes(status) ? status : 'pending';
  rec.emojiStatus = s;
  rec.registered = s === 'owned';
  if (s === 'discarded') rec.rejectedReason = 'discarded';
  else if (s === 'owned' || s === 'recognized' || s === 'pending') rec.rejectedReason = '';
  rec.updatedAt = Date.now();
  return rec;
}

/** @param {object} store @param {object} rec */
export function serializeEmojiItem(store, rec, { imageBase = '' } = {}) {
  const status = resolveEmojiStatus(rec);
  const id = rec.id || rec.hash;
  let preview = '';
  if (rec.localPath && fs.existsSync(rec.localPath) && imageBase) {
    preview = `${imageBase}/${encodeURIComponent(String(id))}`;
  }
  return {
    id,
    hash: rec.hash,
    status,
    description: rec.description || '',
    emotions: Array.isArray(rec.emotions) ? rec.emotions : [],
    tags: Array.isArray(rec.emotions) ? rec.emotions : [],
    sourceGroupId: rec.sourceGroupId || '',
    sourceUrl: rec.sourceUrl || '',
    preview,
    hasLocalFile: Boolean(rec.localPath && fs.existsSync(rec.localPath)),
    registered: status === 'owned',
    vlmProcessed: !!rec.vlmProcessed,
    rejectedReason: rec.rejectedReason || '',
    queryCount: Number(rec.queryCount) || 0,
    createdAt: rec.createdAt || 0,
    updatedAt: rec.updatedAt || 0
  };
}

/** @param {object} store */
export function getEmojiLibraryStats(store) {
  ensureEmojiRegistry(store);
  const counts = { all: 0, unknown: 0, recognized: 0, owned: 0, pending: 0, discarded: 0 };
  for (const rec of store.emojiRegistry || []) {
    counts.all += 1;
    const s = resolveEmojiStatus(rec);
    if (counts[s] != null) counts[s] += 1;
  }
  const weekAgo = Date.now() - 7 * 86400000;
  counts.recent7d = (store.emojiRegistry || []).filter((e) => (e.createdAt || 0) >= weekAgo).length;
  return { ...counts, cacheStats: store.emojiCacheStats || {} };
}

/**
 * @param {object} store
 * @param {{ status?: string, groupId?: string, q?: string, limit?: number, offset?: number }} opts
 */
export function listEmojiLibrary(store, opts = {}) {
  ensureEmojiRegistry(store);
  const status = String(opts.status || 'all').trim();
  const groupId = String(opts.groupId || '').trim();
  const q = String(opts.q || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);

  let list = (store.emojiRegistry || []).map((rec) => serializeEmojiItem(store, rec, opts));
  if (status && status !== 'all') list = list.filter((e) => e.status === status);
  if (groupId) list = list.filter((e) => String(e.sourceGroupId) === groupId);
  if (q) {
    list = list.filter((e) =>
      e.description.toLowerCase().includes(q)
      || e.hash.includes(q)
      || e.emotions.some((t) => String(t).toLowerCase().includes(q)));
  }
  list.sort((a, b) => (Number(b.updatedAt) || Number(b.createdAt)) - (Number(a.updatedAt) || Number(a.createdAt)));
  const total = list.length;
  return { total, data: list.slice(offset, offset + limit) };
}

/** @param {object} store @param {string} id */
export function findEmojiRecord(store, id) {
  const key = String(id || '').trim();
  return (store.emojiRegistry || []).find((e) => e.id === key || e.hash === key || e.hash?.startsWith(key));
}

/** @param {object} store */
export function listEmojiSourceGroups(store) {
  ensureEmojiRegistry(store);
  const map = new Map();
  for (const rec of store.emojiRegistry || []) {
    const gid = String(rec.sourceGroupId || '').trim();
    if (!gid) continue;
    map.set(gid, (map.get(gid) || 0) + 1);
  }
  return [...map.entries()].map(([groupId, count]) => ({ groupId, count })).sort((a, b) => b.count - a.count);
}

/** @param {object} store @param {string} id @param {string} status */
export function updateEmojiStatus(store, id, status) {
  const rec = findEmojiRecord(store, id);
  if (!rec) return null;
  const check = canTransitionEmojiStatus(rec, status);
  if (!check.ok) {
    const err = new Error(check.error || '状态不允许');
    err.code = 'invalid_transition';
    throw err;
  }
  setEmojiStatus(rec, status);
  if (status === 'owned') {
    store.emojiCacheStats = store.emojiCacheStats || {};
    store.emojiCacheStats.registered = (store.emojiRegistry || []).filter((e) => resolveEmojiStatus(e) === 'owned').length;
  }
  return rec;
}

/** @param {object} store @param {string} id @param {{ description?: string, emotions?: string[], tags?: string[] }} patch */
export function updateEmojiMeta(store, id, patch = {}) {
  const rec = findEmojiRecord(store, id);
  if (!rec) return null;
  if (patch.description !== undefined) rec.description = String(patch.description || '').trim().slice(0, 120);
  const rawTags = patch.emotions ?? patch.tags;
  if (rawTags !== undefined) {
    rec.emotions = (Array.isArray(rawTags) ? rawTags : String(rawTags || '').split(/[,，、/]/))
      .map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  }
  rec.updatedAt = Date.now();
  return rec;
}

/** @param {object} store @param {string[]} ids @param {string} status */
export function batchUpdateEmojiStatus(store, ids, status) {
  const updated = [];
  for (const id of ids || []) {
    const rec = updateEmojiStatus(store, id, status);
    if (rec) updated.push(rec);
  }
  return updated;
}

/** @param {object} store @param {string} id */
export function deleteEmojiRecord(store, id, cacheDir) {
  const rec = findEmojiRecord(store, id);
  if (!rec) return false;
  if (rec.localPath && fs.existsSync(rec.localPath)) {
    try { fs.unlinkSync(rec.localPath); } catch { /* ignore */ }
  }
  store.emojiRegistry = (store.emojiRegistry || []).filter((e) => e.id !== rec.id && e.hash !== rec.hash);
  return true;
}

/** @param {object} store @param {string} status */
export function clearEmojiByStatus(store, status, cacheDir) {
  const toRemove = (store.emojiRegistry || []).filter((e) => resolveEmojiStatus(e) === status);
  for (const rec of toRemove) deleteEmojiRecord(store, rec.id || rec.hash, cacheDir);
  return toRemove.length;
}
