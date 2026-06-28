/**
 * 群黑话观察：捕获候选词 → 过滤日常口语 → AI 分类审核（黑话/梗/口头禅等）
 */
import { upsertSlang, SLANG_TYPES } from './slang-library.mjs';

/** 日常口语 / 常见碎片 — 不应入库 */
const COMMON_TERMS = new Set([
  '好的', '谢谢', '哈哈', '就是', '这个', '那个', '可以', '没有', '什么', '怎么', '为什么',
  '大家', '我们', '你们', '他们', '今天', '明天', '现在', '然后', '还是', '知道', '觉得', '感觉',
  '一下', '一个', '一种', '不会', '不是', '真的', '可能', '应该', '已经', '自己', '这么', '那么',
  '怎么了', '咋了', '咋回事', '什么情况', '什么意思', '啥意思', '行不行', '可以吗', '有没有',
  '是不是', '能不能', '要不要', '会不会', '在哪里', '在这里', '在那里', '成本', '资源', '精品',
  '视频', '发现', '刷视频', '用了就', '为啥', '为啥高', '知道为啥', '不会封', '封吗', '吗',
  '好吧', '行了', '算了', '没事', '没事的', '哈哈哈', '笑死', '确实', '真的吗', '是吗', '对啊',
  '不对', '不是吧', '好吧', '嗯嗯', '哦哦', '啊啊', '额', '呃', '好吧', '来了', '走了', '去了',
  '看看', '试试', '说说', '讲讲', '问问', '等等', '马上', '刚刚', '刚才', '之前', '之后', '以后',
  '东西', '事情', '问题', '情况', '时候', '地方', '方式', '方法', '结果', '原因', '意思', '意思',
  '有人', '没人', '大家', '各位', '兄弟', '姐妹', '朋友', '群友', '老板', '大佬', '萌新'
]);

const COMMON_PREFIX = /^(什么|怎么|为什么|是不是|有没有|能不能|要不要|会不会|可以|不能|不要|需要|应该|已经|还是|就是|这个|那个|一下|一点|不会|不是|真的|可能|觉得|感觉|知道|看到|听到|说到|回答|提问|因为|所以|但是|如果|虽然|然后|现在|今天|明天|刚才|刚刚|有人|没人|各位|大家)/;
const COMMON_SUFFIX = /(了吗|么吗|呢吗|是吧|对吧|好吧|行吧|可以吧|怎么办|啥情况|什么情况|在这里|在那里|多少钱|怎么样|为什么|啥意思)$/;
const SENTENCE_LIKE = /[，。！？；：、,.!?]{1}|因为|所以|但是|如果|虽然|而且|或者|然后|已经|可以|不能|不会|应该|需要|知道|觉得|还是|这个|那个/;

/** @param {string} term */
export function isCommonSpeech(term) {
  const t = String(term || '').trim();
  if (!t || t.length < 2) return true;
  if (COMMON_TERMS.has(t)) return true;
  if (COMMON_PREFIX.test(t)) return true;
  if (COMMON_SUFFIX.test(t)) return true;
  if (t.length >= 7 && SENTENCE_LIKE.test(t)) return true;
  if (/^[\u4e00-\u9fff]{2,3}[吗呢吧啊呀哦]$/.test(t)) return true;
  if (/^(很|太|真|挺|蛮|超|特别|非常)[\u4e00-\u9fff]{1,4}$/.test(t)) return true;
  return false;
}

/** @param {string} term */
function shouldObserveChineseTerm(term) {
  const t = String(term || '').trim();
  if (t.length < 2 || t.length > 12) return false;
  if (isCommonSpeech(t)) return false;
  if (/^[\u4e00-\u9fff]+$/.test(t)) {
    if (t.length === 2 && !/[喵酱哥姐弟妹狗猫]/u.test(t)) return false;
    return true;
  }
  return false;
}

function addTerm(set, raw) {
  const t = String(raw || '').trim().slice(0, 40);
  if (!t || t.length < 2) return;
  if (isCommonSpeech(t)) return;
  set.add(t);
}

/** @param {string} text */
export function extractCandidateTerms(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return [];

  const terms = new Set();

  for (const m of t.matchAll(/[「『"'【]([^」』"'\n【】]{2,24})[」』"'\]】]/g)) {
    addTerm(terms, m[1]);
  }

  for (const w of (t.match(/[A-Za-z][A-Za-z0-9_\-]{1,24}|[A-Za-z0-9]{2,16}/g) || [])) {
    if (!/^\d+$/.test(w)) addTerm(terms, w);
  }

  const segments = t.split(/[\s，。！？、,.!?;；：:\[\]()（）【】\n]+/).filter(Boolean);
  for (const seg of segments) {
    const clean = seg.trim();
    if (shouldObserveChineseTerm(clean)) addTerm(terms, clean);
    for (const w of (clean.match(/[\u4e00-\u9fff]{3,8}/g) || [])) {
      if (w !== clean && shouldObserveChineseTerm(w)) addTerm(terms, w);
    }
  }

  return [...terms].slice(0, 6);
}

/**
 * 记录群消息中的候选黑话/梗
 * @param {object} store
 * @param {string} groupId
 * @param {string} text
 */
export function observeGroupSlangFromMessage(store, groupId, text) {
  const settings = store.slangSettings || {};
  if (settings.learningEnabled === false) return [];

  const gid = String(groupId || '').trim();
  if (!gid) return [];
  const terms = extractCandidateTerms(text);
  const touched = [];
  for (const term of terms) {
    if (isCommonSpeech(term)) continue;
    const key = `${gid}\t${term}`;
    const existing = (store.slangs || []).find((s) => `${s.groupId || ''}\t${s.term}` === key);
    if (existing) {
      if (existing.inferenceStatus === 'not_slang' || existing.reviewStatus === 'rejected') continue;
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
      type: 'unclassified',
      source: 'observed',
      inferenceStatus: 'pending',
      reviewStatus: 'pending'
    });
    touched.push(rec);
  }
  return touched;
}

/** 规则清理已有垃圾词条（常见口语 → 标记为非黑话） */
export function sanitizeObservedSlangs(store) {
  let rejected = 0;
  let removed = 0;
  for (const s of store.slangs || []) {
    if (s.source !== 'observed' && s.source !== 'learned') continue;
    if (s.reviewStatus === 'rejected' || s.inferenceStatus === 'not_slang') continue;
    if (!isCommonSpeech(s.term)) continue;
    s.inferenceStatus = 'not_slang';
    s.reviewStatus = 'rejected';
    s.enabled = false;
    s.meaning = '';
    s.type = 'unclassified';
    s.updatedAt = Date.now();
    s.reviewedBy = 'heuristic';
    s.reviewedAt = Date.now();
    rejected += 1;
  }
  return { rejected, removed };
}

/** @param {object} item */
export function slangInferenceLabel(item) {
  const inf = String(item?.inferenceStatus || '').trim();
  if (inf === 'not_slang') return '非黑话';
  if (inf === 'is_slang' && item?.meaning) return '已分类';
  if (inf === 'is_slang' && !item?.meaning) return '待补含义';
  if (item?.meaning && item?.reviewStatus !== 'rejected') return '已分类';
  if (item?.reviewStatus === 'pending' && item?.inferenceStatus === 'pending') return '待AI审核';
  if ((Number(item?.count) || 0) >= 1 && !item?.meaning) return '待AI审核';
  return '观察中';
}

/** @param {object} store */
export function getSlangObserveStats(store) {
  const list = store.slangs || [];
  let confirmed = 0;
  let notSlang = 0;
  let inferred = 0;
  let observed = 0;
  const byType = { slang: 0, meme: 0, abbrev: 0, inside_joke: 0, catchphrase: 0, unclassified: 0 };
  for (const s of list) {
    if (s.source === 'observed' || s.inferenceStatus) observed += 1;
    const inf = String(s.inferenceStatus || '');
    if (inf === 'not_slang' || s.reviewStatus === 'rejected') notSlang += 1;
    else if (inf === 'is_slang') {
      if (s.meaning) inferred += 1;
      if (['ai_passed', 'manual_passed', 'passed'].includes(String(s.reviewStatus))) confirmed += 1;
      const tp = SLANG_TYPES.includes(s.type) ? s.type : 'unclassified';
      byType[tp] += 1;
    }
  }
  const pendingInfer = list.filter((s) => {
    if (s.meaning) return false;
    if (s.inferenceStatus === 'not_slang' || s.reviewStatus === 'rejected') return false;
    return s.inferenceStatus === 'pending' || s.reviewStatus === 'pending';
  }).length;
  return { observed, confirmed, notSlang, inferred, pendingInfer, byType };
}

const INFER_SYSTEM = `你是群聊用语分类审核器。必须严格区分：

类型（is_slang=true 时必填 type）：
- slang：圈内黑话、游戏术语、行话（ outsiders 听不懂的专有用语）
- meme：网络梗、热梗、整活、抽象话
- abbrev：字母/数字缩写（如 yyds、3A、DPS）
- inside_joke：本群特有的梗、群内才懂的玩笑
- catchphrase：群友高频口头禅、但有特定含义或用法

以下必须 is_slang=false（日常口语，不是黑话/梗）：
- 普通问句：怎么了、啥情况、可以吗
- 完整句子片段、常识词汇、连接词
- 任何人都能理解的普通中文

只输出 JSON，不要其它文字：
{"is_slang":true/false,"meaning":"20字内含义","type":"slang|meme|abbrev|inside_joke|catchphrase","usage":"可选例句"}`;

/**
 * AI 分类 + 审核待处理词条
 * @param {object} opts
 */
export async function inferPendingGroupSlangs(opts) {
  const { cfg, store, groupId, contextLines, llmText, minCount = 1, limit = 10 } = opts;
  const gid = String(groupId || '').trim();
  const pending = (store.slangs || [])
    .filter((s) => {
      if (gid && String(s.groupId) !== gid) return false;
      if (s.meaning && s.inferenceStatus === 'is_slang') return false;
      if (s.inferenceStatus === 'not_slang' || s.reviewStatus === 'rejected') return false;
      if (isCommonSpeech(s.term)) return false;
      return (Number(s.count) || 0) >= minCount;
    })
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, Math.max(1, limit));

  const results = [];
  for (const rec of pending) {
    if (isCommonSpeech(rec.term)) {
      rec.inferenceStatus = 'not_slang';
      rec.reviewStatus = 'rejected';
      rec.enabled = false;
      rec.updatedAt = Date.now();
      rec.reviewedBy = 'heuristic';
      rec.reviewedAt = Date.now();
      results.push({ term: rec.term, ok: true, is_slang: false, reason: 'common_speech' });
      continue;
    }

    const term = rec.term;
    const prompt = `群 ${rec.groupId || gid} 中出现「${term}」，遇见 ${rec.count || 0} 次。
最近群聊上下文：
${String(contextLines || '').slice(0, 1500)}

请判断这是否属于黑话/梗/缩写/群内梗/口头禅（而非日常口语）。`;
    let raw = '';
    try {
      raw = await llmText({ systemPrompt: INFER_SYSTEM, userPrompt: prompt, maxTokens: 220, temperature: 0.15 });
    } catch (e) {
      results.push({ term, ok: false, error: e.message });
      continue;
    }
    const parsed = parseInferJson(raw);
    if (!parsed) {
      results.push({ term, ok: false, error: 'parse_fail', raw: raw.slice(0, 120) });
      continue;
    }
    rec.inferenceStatus = parsed.is_slang ? 'is_slang' : 'not_slang';
    rec.inferredAt = Date.now();
    if (parsed.is_slang) {
      rec.meaning = String(parsed.meaning || term).slice(0, 120);
      rec.usage = String(parsed.usage || '').slice(0, 80);
      rec.type = SLANG_TYPES.includes(parsed.type) ? parsed.type : 'slang';
      const autoPass = store.slangSettings?.autoAiPass === true || cfg?.slangAutoPassInferred !== false;
      if (autoPass) {
        rec.reviewStatus = 'ai_passed';
        rec.reviewedBy = 'ai';
        rec.reviewedAt = Date.now();
      } else {
        rec.reviewStatus = 'pending';
      }
      rec.enabled = true;
    } else {
      rec.reviewStatus = 'rejected';
      rec.enabled = false;
      rec.meaning = '';
      rec.type = 'unclassified';
      rec.reviewedBy = 'ai';
      rec.reviewedAt = Date.now();
    }
    rec.updatedAt = Date.now();
    results.push({ term, ok: true, is_slang: parsed.is_slang, type: rec.type, meaning: rec.meaning || '' });
  }
  return results;
}

function parseInferJson(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const isSlang = o.is_slang === true || o.is_slang === 'true' || o.is_slang === 1;
    let type = String(o.type || 'slang').trim();
    if (!SLANG_TYPES.includes(type)) type = 'slang';
    return {
      is_slang: isSlang,
      meaning: String(o.meaning || '').trim(),
      usage: String(o.usage || '').trim(),
      type
    };
  } catch {
    return null;
  }
}
