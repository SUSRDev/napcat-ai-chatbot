/**
 * 群黑话观察：从群消息捕获候选词 → 累计遇见次数 → AI 推断含义（MaiBot 黑话管理思路）
 */
import { upsertSlang, findSlang } from './slang-library.mjs';

const STOP_TERMS = new Set([
  '好的', '谢谢', '哈哈', '就是', '这个', '那个', '可以', '没有', '什么', '怎么', '为什么',
  '大家', '我们', '你们', '他们', '今天', '明天', '现在', '然后', '还是', '知道', '觉得', '感觉',
  '一下', '一个', '一种', '不会', '不是', '真的', '可能', '应该', '已经', '自己', '这么', '那么'
]);

/** @param {string} text */
export function extractCandidateTerms(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return [];
  const terms = new Set();
  for (const w of (t.match(/[\u4e00-\u9fff]{2,8}/g) || [])) {
    if (STOP_TERMS.has(w)) continue;
    terms.add(w);
  }
  for (const w of (t.match(/[A-Za-z0-9]{2,12}/g) || [])) {
    if (/^\d+$/.test(w) && w.length < 2) continue;
    terms.add(w);
  }
  return [...terms].slice(0, 10);
}

/**
 * 记录群消息中的候选黑话/梗（仅观察，不立即注入回复）
 * @param {object} store
 * @param {string} groupId
 * @param {string} text
 */
export function observeGroupSlangFromMessage(store, groupId, text) {
  const gid = String(groupId || '').trim();
  if (!gid) return [];
  const terms = extractCandidateTerms(text);
  const touched = [];
  for (const term of terms) {
    const key = `${gid}\t${term}`;
    const existing = (store.slangs || []).find((s) => `${s.groupId || ''}\t${s.term}` === key);
    if (existing) {
      existing.count = (Number(existing.count) || 0) + 1;
      existing.updatedAt = Date.now();
      if (!existing.inferenceStatus) existing.inferenceStatus = existing.meaning ? 'is_slang' : 'pending';
      touched.push(existing);
      continue;
    }
    const rec = upsertSlang(store, {
      id: `obs_${gid}_${term}_${Date.now().toString(36)}`,
      groupId: gid,
      term,
      meaning: '',
      usage: '',
      tags: [],
      type: 'slang',
      source: 'observed',
      inferenceStatus: 'pending',
      reviewStatus: 'pending'
    });
    touched.push(rec);
  }
  return touched;
}

/** @param {object} item */
export function slangInferenceLabel(item) {
  const inf = String(item?.inferenceStatus || '').trim();
  if (inf === 'is_slang') return item?.meaning ? '已推断' : '待推断';
  if (inf === 'not_slang') return '无黑话';
  if (item?.meaning && item?.reviewStatus !== 'rejected') return '已推断';
  if ((Number(item?.count) || 0) >= 2 && !item?.meaning) return '待推断';
  return '观察中';
}

/** @param {object} store */
export function getSlangObserveStats(store) {
  const list = store.slangs || [];
  let confirmed = 0;
  let notSlang = 0;
  let inferred = 0;
  let observed = 0;
  for (const s of list) {
    if (s.source === 'observed' || s.inferenceStatus) observed += 1;
    const inf = String(s.inferenceStatus || '');
    if (inf === 'not_slang') notSlang += 1;
    else if (inf === 'is_slang' && s.meaning) {
      inferred += 1;
      if (['ai_passed', 'manual_passed', 'passed'].includes(String(s.reviewStatus))) confirmed += 1;
    }
  }
  return { observed, confirmed, notSlang, inferred, pendingInfer: list.filter((s) => s.inferenceStatus === 'pending' && (s.count || 0) >= 2 && !s.meaning).length };
}

/**
 * 对遇见 ≥ minCount 且无含义的词条做 AI 推断
 * @param {object} opts
 */
export async function inferPendingGroupSlangs(opts) {
  const { cfg, store, groupId, contextLines, llmText, minCount = 2, limit = 6 } = opts;
  const gid = String(groupId || '').trim();
  const pending = (store.slangs || [])
    .filter((s) => {
      if (gid && String(s.groupId) !== gid) return false;
      if (s.meaning) return false;
      if (s.inferenceStatus === 'not_slang' || s.inferenceStatus === 'is_slang') return false;
      return (Number(s.count) || 0) >= minCount;
    })
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, Math.max(1, limit));

  const results = [];
  for (const rec of pending) {
    const term = rec.term;
    const prompt = `群号 ${rec.groupId || gid} 中多次出现词「${term}」，遇见 ${rec.count || 0} 次。
最近群聊：
${String(contextLines || '').slice(0, 1200)}

请判断这是否为黑话/梗/圈内用语/游戏术语/口头禅。
只输出 JSON：{"is_slang":true/false,"meaning":"20字内含义","type":"slang|meme|abbrev|inside_joke|catchphrase","usage":"例句可选"}`;
    let raw = '';
    try {
      raw = await llmText({ systemPrompt: '你是群聊黑话推断器。', userPrompt: prompt, maxTokens: 200, temperature: 0.2 });
    } catch (e) {
      results.push({ term, ok: false, error: e.message });
      continue;
    }
    const parsed = parseInferJson(raw);
    if (!parsed) {
      rec.inferenceStatus = 'pending';
      results.push({ term, ok: false, error: 'parse_fail', raw: raw.slice(0, 120) });
      continue;
    }
    rec.inferenceStatus = parsed.is_slang ? 'is_slang' : 'not_slang';
    rec.inferredAt = Date.now();
    if (parsed.is_slang) {
      rec.meaning = String(parsed.meaning || '').slice(0, 120);
      rec.usage = String(parsed.usage || '').slice(0, 80);
      if (parsed.type) rec.type = parsed.type;
      if (cfg?.slangSettings?.autoAiPass === true || cfg?.slangAutoPassInferred !== false) {
        rec.reviewStatus = 'ai_passed';
        rec.reviewedBy = 'ai';
        rec.reviewedAt = Date.now();
      }
    } else {
      rec.reviewStatus = 'rejected';
      rec.enabled = false;
    }
    rec.updatedAt = Date.now();
    results.push({ term, ok: true, is_slang: parsed.is_slang, meaning: rec.meaning || '' });
  }
  return results;
}

function parseInferJson(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return {
      is_slang: o.is_slang === true || o.is_slang === 'true',
      meaning: String(o.meaning || '').trim(),
      usage: String(o.usage || '').trim(),
      type: String(o.type || 'slang').trim()
    };
  } catch {
    return null;
  }
}
