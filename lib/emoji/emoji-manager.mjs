/**
 * MaiBot 风格表情包管理：群聊缓存 → VLM 打标 → 注册占为己有
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveEmojiStatus, setEmojiStatus, emojiHasTags, resolveEmojiLocalPath } from './emoji-library.mjs';
import { selectStickerWithVision } from './emoji-grid-select.mjs';
import { DEFAULT_STICKER_SELECTION_PROMPT } from '../maisaka/emoji-prompts.mjs';

export const DEFAULT_EMOJI_VLM_PROMPT = `请分析这张表情包/图片，输出 JSON 对象，不要其他内容：
{"description":"20字内描述","emotions":["情绪1","情绪2"],"is_emoji":true}
- description：内容简述，若有文字请概括
- emotions：2-5 个中文情绪/场景标签，如：开心、安慰、阴阳怪气、无语、摸头
- is_emoji：是否为表情包（非截图/非照片则为 true）`;

/** @param {object} store */
export function ensureEmojiRegistry(store) {
  if (!Array.isArray(store.emojiRegistry)) store.emojiRegistry = [];
  if (!store.emojiCacheStats) store.emojiCacheStats = { captured: 0, registered: 0, skipped: 0 };
  return store;
}

/** @param {Buffer} buf */
export function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** @param {object} store @param {string} hash */
export function findEmojiByHash(store, hash) {
  return (store.emojiRegistry || []).find((e) => e.hash === hash);
}

/**
 * @param {object} store
 * @param {object} item
 */
export function upsertEmojiRecord(store, item) {
  ensureEmojiRegistry(store);
  const idx = store.emojiRegistry.findIndex((e) => e.hash === item.hash || e.id === item.id);
  if (idx >= 0) {
    store.emojiRegistry[idx] = { ...store.emojiRegistry[idx], ...item, updatedAt: Date.now() };
    return store.emojiRegistry[idx];
  }
  const rec = { ...item, id: item.id || `em_${Date.now()}`, createdAt: Date.now(), queryCount: 0 };
  store.emojiRegistry.push(rec);
  if (store.emojiRegistry.length > 2000) store.emojiRegistry.splice(0, store.emojiRegistry.length - 2000);
  return rec;
}

/** @param {object} store @param {string} id */
export function touchEmojiUsage(store, id) {
  const e = (store.emojiRegistry || []).find((x) => x.id === id || x.hash === id);
  if (e) {
    e.queryCount = (Number(e.queryCount) || 0) + 1;
    e.lastUsedAt = Date.now();
  }
}

/** Levenshtein 距离（MaiBot 情绪匹配简化版） */
function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = s[i - 1] === t[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** @param {string} emotion @param {string[]} tags */
function emotionMatchScore(emotion, tags) {
  const e = String(emotion || '').trim();
  if (!e || !tags?.length) return 0;
  let best = 0;
  for (const tag of tags) {
    const t = String(tag || '').trim();
    if (!t) continue;
    if (e.includes(t) || t.includes(e)) return 10;
    const dist = levenshtein(e, t);
    const sim = 1 - dist / Math.max(e.length, t.length, 1);
    best = Math.max(best, sim * 8);
  }
  return best;
}

/** @param {object} store @param {string} [cacheDir] */
export function listOwnedEmojisWithTags(store, cacheDir = '') {
  return (store.emojiRegistry || []).filter((e) => {
    if (resolveEmojiStatus(e) !== 'owned' || !emojiHasTags(e)) return false;
    return Boolean(resolveEmojiLocalPath(e, cacheDir));
  });
}

/** 根据描述/标签与当前语境打分（越高越贴合） */
export function scoreEmojiForScene(rec, { userText = '', replyText = '', emotion = '', contextLines = '' } = {}) {
  const scene = `${emotion} ${replyText} ${userText} ${contextLines}`.trim();
  if (!scene || !rec) return 0;
  const tags = [
    ...(Array.isArray(rec.emotions) ? rec.emotions : []),
    String(rec.description || '').trim()
  ].filter(Boolean);
  if (!tags.length) return 0;

  let score = 0;
  for (const tag of tags) {
    const t = String(tag).trim();
    if (!t) continue;
    if (scene.includes(t)) score += 14;
    score += emotionMatchScore(scene, [t]);
    for (const part of scene.split(/[\s,，。！？；;、\n]+/).filter((x) => x.length >= 2)) {
      if (t.includes(part) || part.includes(t)) score += 6;
    }
  }
  return score + (Number(rec.queryCount) || 0) * 0.02;
}

/** @param {object} store @param {string} [emotion] @param {string} [context] @param {string} [cacheDir] @param {number} [minScore] */
export function getRegisteredEmojis(store, emotion = '', context = '', cacheDir = '', minScore = 0) {
  const list = listOwnedEmojisWithTags(store, cacheDir);
  const ctx = `${emotion} ${context}`.trim();
  if (!ctx) {
    return minScore > 0 ? [] : list.sort((a, b) => (Number(b.queryCount) || 0) - (Number(a.queryCount) || 0));
  }
  return list
    .map((e) => {
      const score = scoreEmojiForScene(e, { emotion, replyText: ctx, userText: ctx, contextLines: ctx });
      return { ...e, _score: score };
    })
    .filter((e) => e._score >= minScore)
    .sort((a, b) => b._score - a._score);
}

/** @param {unknown} text */
export function parseEmojiVlmJson(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return {
      description: String(o.description || '').trim().slice(0, 120),
      emotions: (Array.isArray(o.emotions) ? o.emotions : String(o.emotions || '').split(/[,，、]/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 8),
      is_emoji: o.is_emoji !== false
    };
  } catch {
    return { description: raw.slice(0, 100), emotions: [], is_emoji: true };
  }
}

/**
 * 对已有缓存文件运行 VLM 打标
 * @param {object} rec 表情记录
 * @param {object} opts
 */
export async function runEmojiVlmOnRecord(rec, opts = {}) {
  const { callVision, promptTemplate = DEFAULT_EMOJI_VLM_PROMPT } = opts;
  if (!rec?.localPath || !fs.existsSync(rec.localPath)) {
    return { ok: false, reason: 'no_file' };
  }
  if (typeof callVision !== 'function') {
    return { ok: false, reason: 'no_vision_api' };
  }
  const ext = path.extname(rec.localPath).toLowerCase();
  const mime = ext === '.png' ? 'png' : ext === '.gif' ? 'gif' : 'jpeg';
  let buf;
  try {
    buf = fs.readFileSync(rec.localPath);
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  const dataUrl = `data:image/${mime};base64,${buf.toString('base64')}`;
  let raw = '';
  try {
    raw = await callVision({ systemPrompt: promptTemplate, userText: '请分析这张图片。', imageUrls: [dataUrl] });
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  if (!String(raw || '').trim()) {
    return { ok: false, reason: 'vlm_empty' };
  }
  const vlm = parseEmojiVlmJson(raw);
  if (!vlm) {
    return { ok: false, reason: 'vlm_parse_fail' };
  }
  return { ok: true, vlm };
}

/** @param {object} store @param {object} rec @param {object} vlm */
export function applyEmojiVlmToRecord(store, rec, vlm) {
  ensureEmojiRegistry(store);
  if (vlm.is_emoji === false) {
    store.emojiCacheStats = store.emojiCacheStats || {};
    store.emojiCacheStats.skipped = (Number(store.emojiCacheStats.skipped) || 0) + 1;
    rec.description = vlm.description || '';
    rec.emotions = vlm.emotions || [];
    rec.vlmProcessed = true;
    rec.rejectedReason = 'not_emoji';
    setEmojiStatus(rec, 'discarded');
    return { status: 'discarded', reason: 'not_emoji' };
  }
  rec.description = vlm.description || rec.description || '';
  rec.emotions = vlm.emotions?.length ? vlm.emotions : (rec.emotions || []);
  rec.vlmProcessed = true;
  rec.rejectedReason = '';
  if (rec.emotions?.length || rec.description) {
    rec.recognizeCount = Math.max(1, Number(rec.recognizeCount) || 1);
    setEmojiStatus(rec, 'recognized');
  } else {
    setEmojiStatus(rec, 'pending');
  }
  rec.updatedAt = Date.now();
  return { status: resolveEmojiStatus(rec), emoji: rec };
}

/**
 * 从群消息缓存表情：下载 → VLM 打标 → 注册
 * @param {object} opts
 */
export async function captureAndRegisterEmoji(opts) {
  const {
    store,
    cacheDir,
    imageUrl,
    groupId = '',
    callVision,
    promptTemplate = DEFAULT_EMOJI_VLM_PROMPT,
    autoRegister = true,
    maxSizeMb = 5
  } = opts;

  ensureEmojiRegistry(store);
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return { status: 'skipped', reason: 'no_url' };

  let buf;
  try {
    const res = await fetch(url.replace(/&amp;/g, '&'), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { status: 'failed', reason: `http_${res.status}` };
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { status: 'failed', reason: e.message };
  }

  const maxBytes = Math.max(1, Number(maxSizeMb) || 5) * 1024 * 1024;
  if (buf.length > maxBytes) {
    store.emojiCacheStats.skipped = (Number(store.emojiCacheStats.skipped) || 0) + 1;
    return { status: 'skipped', reason: 'too_large' };
  }

  const hash = hashBuffer(buf);
  const existing = findEmojiByHash(store, hash);
  if (existing?.registered && existing.localPath && fs.existsSync(existing.localPath)) {
    return { status: 'skipped', reason: 'duplicate', emoji: existing };
  }

  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const ext = url.includes('.png') ? '.png' : url.includes('.gif') ? '.gif' : '.jpg';
  const localPath = path.join(cacheDir, `${hash.slice(0, 16)}${ext}`);
  if (!fs.existsSync(localPath)) fs.writeFileSync(localPath, buf);

  store.emojiCacheStats.captured = (Number(store.emojiCacheStats.captured) || 0) + 1;

  let vlm = null;
  let vlmReason = '';
  if (typeof callVision === 'function') {
    const vlmRes = await runEmojiVlmOnRecord({ localPath }, { callVision, promptTemplate });
    if (vlmRes.ok) vlm = vlmRes.vlm;
    else vlmReason = vlmRes.reason || 'vlm_failed';
  } else {
    vlmReason = 'no_vision_api';
  }

  if (vlm && vlm.is_emoji === false) {
    store.emojiCacheStats.skipped = (Number(store.emojiCacheStats.skipped) || 0) + 1;
    const rec = upsertEmojiRecord(store, {
      hash,
      localPath,
      sourceUrl: url,
      sourceGroupId: String(groupId),
      description: vlm.description,
      emotions: vlm.emotions,
      registered: false,
      vlmProcessed: true,
      rejectedReason: 'not_emoji'
    });
    setEmojiStatus(rec, 'discarded');
    return { status: 'skipped', reason: 'not_emoji' };
  }

  const rec = upsertEmojiRecord(store, {
    hash,
    localPath,
    sourceUrl: url,
    sourceGroupId: String(groupId),
    description: vlm?.description || '',
    emotions: vlm?.emotions || [],
    registered: false,
    vlmProcessed: !!vlm
  });
  // MaiBot 流程：VLM 识别后进入「待处理」，人工打标 → 已认识 → 占为己有
  if (vlm) setEmojiStatus(rec, 'pending');
  else setEmojiStatus(rec, 'unknown');

  return { status: 'cached', emoji: rec, vlmReason };
}

function emojiToStickerCandidate(rec, cacheDir = '') {
  const localPath = resolveEmojiLocalPath(rec, cacheDir);
  if (!localPath) return null;
  return {
    id: localPath,
    preview: rec.preview || `file:///${String(localPath).replace(/\\/g, '/')}`,
    name: (rec.description || rec.emotions?.[0] || rec.hash || '').slice(0, 40),
    weight: 1 + Math.min(10, Number(rec.queryCount) || 0),
    hash: rec.hash,
    emotions: rec.emotions || [],
    description: rec.description || ''
  };
}

/** 转为 stickerPool 候选格式（仅占为己有） */
export function registeredEmojisToStickerCandidates(store, cacheDir = '') {
  return listOwnedEmojisWithTags(store, cacheDir)
    .map((e) => emojiToStickerCandidate(e, cacheDir))
    .filter(Boolean);
}

/**
 * 拼图视觉选表情（MaiBot send_emoji）——仅「占为己有」且场景匹配
 * @param {object} opts
 */
export async function pickRegisteredEmojiWithGrid(opts) {
  const { store, cfg, userText, replyText, contextLines, emotion = '', callVisionChat, cacheDir = '' } = opts;
  const minScore = Math.max(0, Number(cfg?.emojiSceneMinScore ?? 2));
  const owned = listOwnedEmojisWithTags(store, cacheDir);
  if (!owned.length) return null;

  const scored = owned
    .map((rec) => ({
      rec,
      score: scoreEmojiForScene(rec, { userText, replyText, emotion, contextLines })
    }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  const topN = scored.slice(0, Math.min(Number(cfg?.stickerSendNum) || 20, 25));
  const candidates = topN.map(({ rec }) => emojiToStickerCandidate(rec, cacheDir)).filter(Boolean);
  if (!candidates.length) return null;

  if (candidates.length === 1) {
    touchEmojiUsage(store, candidates[0].hash);
    return { id: candidates[0].id, reason: 'scene_text_match', score: topN[0].score };
  }

  const pick = await selectStickerWithVision({
    cfg: { ...cfg, stickerSendNum: candidates.length },
    candidates,
    userText,
    replyText,
    contextLines,
    callVisionChat,
    promptTemplate: cfg.stickerSelectionPrompt || DEFAULT_STICKER_SELECTION_PROMPT,
    preserveOrder: true
  });
  if (pick?.id) {
    const hit = candidates.find((c) => c.id === pick.id);
    touchEmojiUsage(store, hit?.hash || pick.id);
    return pick;
  }
  return null;
}

/** @param {object} event @param {Function} extractImages */
export function extractEmojiUrlsFromEvent(event, extractImages) {
  const urls = [];
  const msg = event?.message;
  if (Array.isArray(msg)) {
    for (const seg of msg) {
      if (!seg || typeof seg !== 'object') continue;
      const t = String(seg.type || '').toLowerCase();
      if (t === 'image' || t === 'face') {
        const url = seg.data?.url || seg.data?.file;
        if (url && /^https?:\/\//i.test(String(url))) urls.push(String(url).replace(/&amp;/g, '&'));
      }
    }
  }
  if (typeof extractImages === 'function') {
    for (const u of extractImages(event) || []) {
      if (u && !urls.includes(u)) urls.push(u);
    }
  }
  return urls.slice(0, 3);
}
