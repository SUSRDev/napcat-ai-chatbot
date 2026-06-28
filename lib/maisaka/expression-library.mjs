/**
 * 表达方式库：AI 学习 + 人工/AI 审核
 */
export const EXPRESSION_REVIEW_STATUSES = ['pending', 'ai_passed', 'manual_passed', 'passed', 'rejected'];

export const REVIEW_PASS_STATUSES = new Set(['passed', 'ai_passed', 'manual_passed']);

/** @param {object} store */
export function getExpressionSettings(store) {
  if (!store.expressionSettings) {
    store.expressionSettings = { learningEnabled: true, usageEnabled: true, autoAiPass: true };
  }
  return store.expressionSettings;
}

/** @param {object} exp */
export function normalizeReviewStatus(exp) {
  const s = String(exp?.reviewStatus || 'pending').trim();
  if (REVIEW_PASS_STATUSES.has(s)) return s === 'passed' ? 'manual_passed' : s;
  if (s === 'rejected') return 'rejected';
  return 'pending';
}

/** @param {object} exp */
export function isExpressionUsable(exp, settings = {}) {
  if (settings.usageEnabled === false) return false;
  if (exp.enabled === false) return false;
  return REVIEW_PASS_STATUSES.has(normalizeReviewStatus(exp));
}

/** @param {object} store */
export function getExpressionStats(store) {
  const list = store.expressions || [];
  const counts = { all: 0, pending: 0, passed: 0, rejected: 0 };
  for (const e of list) {
    counts.all += 1;
    const rs = normalizeReviewStatus(e);
    if (rs === 'pending') counts.pending += 1;
    else if (rs === 'rejected') counts.rejected += 1;
    else counts.passed += 1;
  }
  const weekAgo = Date.now() - 7 * 86400000;
  counts.recent7d = list.filter((e) => (e.createdAt || 0) >= weekAgo).length;
  return counts;
}

/** @param {object} store @param {object} opts */
export function listExpressions(store, opts = {}) {
  const status = String(opts.status || 'all').trim();
  const groupId = String(opts.groupId || '').trim();
  const q = String(opts.q || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);

  let list = (store.expressions || []).map((e) => ({
    id: e.id,
    groupId: e.groupId || '',
    situation: e.situation || '',
    style: e.style || '',
    reviewStatus: normalizeReviewStatus(e),
    enabled: e.enabled !== false,
    count: Number(e.count) || 0,
    score: Number(e.score) || 0,
    source: e.source || 'learned',
    createdAt: e.createdAt || 0,
    updatedAt: e.updatedAt || 0,
    reviewedAt: e.reviewedAt || 0,
    reviewedBy: e.reviewedBy || ''
  }));

  if (status === 'pending') list = list.filter((e) => e.reviewStatus === 'pending');
  else if (status === 'passed') list = list.filter((e) => REVIEW_PASS_STATUSES.has(e.reviewStatus));
  else if (status === 'rejected') list = list.filter((e) => e.reviewStatus === 'rejected');

  if (groupId) list = list.filter((e) => String(e.groupId) === groupId);
  if (q) {
    list = list.filter((e) =>
      e.situation.toLowerCase().includes(q)
      || e.style.toLowerCase().includes(q));
  }

  list.sort((a, b) => (Number(b.updatedAt) || Number(b.createdAt)) - (Number(a.updatedAt) || Number(a.createdAt)));
  return { total: list.length, data: list.slice(offset, offset + limit) };
}

/** @param {object} store @param {string} id */
export function findExpression(store, id) {
  return (store.expressions || []).find((e) => e.id === id);
}

/** @param {object} store @param {object} item */
export function createExpression(store, item) {
  store.expressions = store.expressions || [];
  const rec = {
    id: item.id || `exp_${Date.now()}`,
    groupId: String(item.groupId || ''),
    situation: String(item.situation || '').slice(0, 80),
    style: String(item.style || '').slice(0, 80),
    reviewStatus: item.reviewStatus || 'pending',
    enabled: item.enabled !== false,
    count: 1,
    score: 1,
    source: item.source || 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  store.expressions.push(rec);
  return rec;
}

/** @param {object} store @param {string} id @param {object} patch */
export function updateExpression(store, id, patch) {
  const rec = findExpression(store, id);
  if (!rec) return null;
  if (patch.situation != null) rec.situation = String(patch.situation).slice(0, 80);
  if (patch.style != null) rec.style = String(patch.style).slice(0, 80);
  if (patch.enabled != null) rec.enabled = !!patch.enabled;
  if (patch.reviewStatus != null) rec.reviewStatus = normalizeReviewStatus({ reviewStatus: patch.reviewStatus });
  rec.updatedAt = Date.now();
  return rec;
}

/** @param {object} store @param {string} id @param {string} action @param {string} [reviewer] */
export function reviewExpression(store, id, action, reviewer = 'manual') {
  const rec = findExpression(store, id);
  if (!rec) return null;
  const act = String(action || '').toLowerCase();
  if (act === 'pass' || act === 'manual_pass') {
    rec.reviewStatus = 'manual_passed';
    rec.reviewedBy = reviewer;
  } else if (act === 'ai_pass') {
    rec.reviewStatus = 'ai_passed';
    rec.reviewedBy = 'ai';
  } else if (act === 'reject') {
    rec.reviewStatus = 'rejected';
    rec.enabled = false;
    rec.reviewedBy = reviewer;
  } else if (act === 'pending') {
    rec.reviewStatus = 'pending';
  }
  rec.reviewedAt = Date.now();
  rec.updatedAt = Date.now();
  return rec;
}

/** @param {object} store @param {string} id */
export function deleteExpression(store, id) {
  const before = (store.expressions || []).length;
  store.expressions = (store.expressions || []).filter((e) => e.id !== id);
  return before > (store.expressions || []).length;
}

/** @param {object} store @param {string} [status] */
export function clearExpressions(store, status) {
  if (!status || status === 'all') {
    const n = (store.expressions || []).length;
    store.expressions = [];
    return n;
  }
  const before = (store.expressions || []).length;
  store.expressions = (store.expressions || []).filter((e) => {
    const rs = normalizeReviewStatus(e);
    if (status === 'pending') return rs !== 'pending';
    if (status === 'passed') return !REVIEW_PASS_STATUSES.has(rs);
    if (status === 'rejected') return rs !== 'rejected';
    return true;
  });
  return before - (store.expressions || []).length;
}

/** @param {object} store */
export function listExpressionGroups(store) {
  const map = new Map();
  for (const e of store.expressions || []) {
    const gid = String(e.groupId || 'global').trim() || 'global';
    map.set(gid, (map.get(gid) || 0) + 1);
  }
  return [...map.entries()].map(([groupId, count]) => ({ groupId, count })).sort((a, b) => b.count - a.count);
}

/** MaiBot 风格默认表达习惯（库为空时注入，便于伪人立即有参考） */
export const DEFAULT_MAISAKA_EXPRESSIONS = [
  { situation: '表示赞同或觉得厉害', style: '用「6」「牛啊」「确实」短句' },
  { situation: '觉得离谱或无语', style: '用「啊？」「离谱」「笑死」' },
  { situation: '敷衍或结束话题', style: '用「好好好」「行吧」「懂了」' },
  { situation: '安慰对方', style: '先共情再一句「没事的」「抱抱」' },
  { situation: '接梗或玩梗', style: '顺着对方梗接半句，不要解释梗' },
  { situation: '不确定时', style: '用「可能吧」「不好说」「感觉像」' },
  { situation: '被 @ 或点名', style: '先简短回应再展开，别太长' },
  { situation: '群里冷场', style: '抛一句短评或反问，别硬聊' },
  { situation: '表示开心或觉得有趣', style: '句末加颜文字如 (＾∀＾) (=´▽`=)' },
  { situation: '安慰或关心对方', style: '用 (´；ω；`) 或 (づ｡◕‿◕｡)づ 等颜文字，语气软一点' },
  { situation: '表示无语或离谱', style: '用 (￣ヘ￣) 或 啊？ 短句' },
  { situation: '接群内黑话或梗', style: '用群内同款说法接半句，不要解释梗是什么意思' }
];

/** @param {object} store */
export function ensureDefaultExpressions(store) {
  store.expressions = store.expressions || [];
  const hasPassed = store.expressions.some((e) => REVIEW_PASS_STATUSES.has(normalizeReviewStatus(e)));
  if (hasPassed) return 0;
  const now = Date.now();
  for (const item of DEFAULT_MAISAKA_EXPRESSIONS) {
    store.expressions.push({
      id: `exp_seed_${item.situation.slice(0, 8)}_${now}`,
      groupId: '',
      situation: item.situation.slice(0, 80),
      style: item.style.slice(0, 80),
      reviewStatus: 'ai_passed',
      enabled: true,
      count: 1,
      score: 2,
      source: 'seed',
      reviewedBy: 'system',
      reviewedAt: now,
      createdAt: now,
      updatedAt: now
    });
  }
  return DEFAULT_MAISAKA_EXPRESSIONS.length;
}
