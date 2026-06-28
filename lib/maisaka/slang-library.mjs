/**
 * 黑话 / 梗库：群聊惯用语、网络梗、缩写 — AI 学习 + 人工/AI 审核
 */
export const SLANG_TYPES = ['slang', 'meme', 'abbrev', 'inside_joke', 'catchphrase'];
export const SLANG_REVIEW_STATUSES = ['pending', 'ai_passed', 'manual_passed', 'passed', 'rejected'];
export const SLANG_PASS_STATUSES = new Set(['passed', 'ai_passed', 'manual_passed']);

/** @param {object} store */
export function getSlangSettings(store) {
  if (!store.slangSettings) {
    store.slangSettings = { learningEnabled: true, usageEnabled: true, autoAiPass: false };
  }
  return store.slangSettings;
}

/** @param {object} item */
export function normalizeSlangReviewStatus(item) {
  const s = String(item?.reviewStatus || 'pending').trim();
  if (SLANG_PASS_STATUSES.has(s)) return s === 'passed' ? 'manual_passed' : s;
  if (s === 'rejected') return 'rejected';
  return 'pending';
}

/** @param {object} item @param {object} [settings] */
export function isSlangUsable(item, settings = {}) {
  if (settings.usageEnabled === false) return false;
  if (item.enabled === false) return false;
  return SLANG_PASS_STATUSES.has(normalizeSlangReviewStatus(item));
}

/** @param {object} store */
export function getSlangStats(store) {
  const list = store.slangs || [];
  const counts = { all: 0, pending: 0, passed: 0, rejected: 0 };
  for (const s of list) {
    counts.all += 1;
    const rs = normalizeSlangReviewStatus(s);
    if (rs === 'pending') counts.pending += 1;
    else if (rs === 'rejected') counts.rejected += 1;
    else counts.passed += 1;
  }
  const weekAgo = Date.now() - 7 * 86400000;
  counts.recent7d = list.filter((s) => (s.createdAt || 0) >= weekAgo).length;
  return counts;
}

/** @param {object} store @param {object} opts */
export function listSlangs(store, opts = {}) {
  const status = String(opts.status || 'all').trim();
  const groupId = String(opts.groupId || '').trim();
  const type = String(opts.type || '').trim();
  const q = String(opts.q || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);

  let list = (store.slangs || []).map((s) => ({
    id: s.id,
    groupId: s.groupId || '',
    term: s.term || '',
    meaning: s.meaning || '',
    usage: s.usage || '',
    tags: Array.isArray(s.tags) ? s.tags : [],
    type: SLANG_TYPES.includes(s.type) ? s.type : 'slang',
    reviewStatus: normalizeSlangReviewStatus(s),
    enabled: s.enabled !== false,
    count: Number(s.count) || 0,
    score: Number(s.score) || 0,
    source: s.source || 'learned',
    createdAt: s.createdAt || 0,
    updatedAt: s.updatedAt || 0,
    reviewedAt: s.reviewedAt || 0,
    reviewedBy: s.reviewedBy || ''
  }));

  if (status === 'pending') list = list.filter((s) => s.reviewStatus === 'pending');
  else if (status === 'passed') list = list.filter((s) => SLANG_PASS_STATUSES.has(s.reviewStatus));
  else if (status === 'rejected') list = list.filter((s) => s.reviewStatus === 'rejected');

  if (groupId) list = list.filter((s) => String(s.groupId) === groupId);
  if (type) list = list.filter((s) => s.type === type);
  if (q) {
    list = list.filter((s) =>
      s.term.toLowerCase().includes(q)
      || s.meaning.toLowerCase().includes(q)
      || s.usage.toLowerCase().includes(q)
      || s.tags.some((t) => String(t).toLowerCase().includes(q)));
  }

  list.sort((a, b) => (Number(b.updatedAt) || Number(b.createdAt)) - (Number(a.updatedAt) || Number(a.createdAt)));
  return { total: list.length, data: list.slice(offset, offset + limit) };
}

/** @param {object} store @param {string} id */
export function findSlang(store, id) {
  return (store.slangs || []).find((s) => s.id === id);
}

/** @param {object} store @param {object} item */
export function createSlang(store, item) {
  store.slangs = store.slangs || [];
  const autoPass = store.slangSettings?.autoAiPass === true;
  const rec = {
    id: item.id || `slang_${Date.now()}`,
    groupId: String(item.groupId || ''),
    term: String(item.term || '').slice(0, 40),
    meaning: String(item.meaning || '').slice(0, 120),
    usage: String(item.usage || '').slice(0, 80),
    tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 8) : [],
    type: SLANG_TYPES.includes(item.type) ? item.type : 'slang',
    reviewStatus: item.reviewStatus || (autoPass ? 'ai_passed' : 'pending'),
    enabled: item.enabled !== false,
    count: 1,
    score: 1,
    source: item.source || 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reviewedBy: autoPass ? 'ai' : '',
    reviewedAt: autoPass ? Date.now() : 0
  };
  store.slangs.push(rec);
  if (store.slangs.length > 400) store.slangs.splice(0, store.slangs.length - 400);
  return rec;
}

/** @param {object} store @param {string} id @param {object} patch */
export function updateSlang(store, id, patch) {
  const rec = findSlang(store, id);
  if (!rec) return null;
  if (patch.term != null) rec.term = String(patch.term).slice(0, 40);
  if (patch.meaning != null) rec.meaning = String(patch.meaning).slice(0, 120);
  if (patch.usage != null) rec.usage = String(patch.usage).slice(0, 80);
  if (patch.tags != null) rec.tags = Array.isArray(patch.tags) ? patch.tags.map(String).slice(0, 8) : rec.tags;
  if (patch.type != null && SLANG_TYPES.includes(patch.type)) rec.type = patch.type;
  if (patch.enabled != null) rec.enabled = !!patch.enabled;
  if (patch.reviewStatus != null) rec.reviewStatus = normalizeSlangReviewStatus({ reviewStatus: patch.reviewStatus });
  rec.updatedAt = Date.now();
  return rec;
}

/** @param {object} store @param {string} id @param {string} action @param {string} [reviewer] */
export function reviewSlang(store, id, action, reviewer = 'manual') {
  const rec = findSlang(store, id);
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
export function deleteSlang(store, id) {
  const before = (store.slangs || []).length;
  store.slangs = (store.slangs || []).filter((s) => s.id !== id);
  return before > (store.slangs || []).length;
}

/** @param {object} store @param {string} [status] */
export function clearSlangs(store, status) {
  if (!status || status === 'all') {
    const n = (store.slangs || []).length;
    store.slangs = [];
    return n;
  }
  const before = (store.slangs || []).length;
  store.slangs = (store.slangs || []).filter((s) => {
    const rs = normalizeSlangReviewStatus(s);
    if (status === 'pending') return rs !== 'pending';
    if (status === 'passed') return !SLANG_PASS_STATUSES.has(rs);
    if (status === 'rejected') return rs !== 'rejected';
    return true;
  });
  return before - (store.slangs || []).length;
}

/** @param {object} store */
export function listSlangGroups(store) {
  const map = new Map();
  for (const s of store.slangs || []) {
    const gid = String(s.groupId || 'global').trim() || 'global';
    map.set(gid, (map.get(gid) || 0) + 1);
  }
  return [...map.entries()].map(([groupId, count]) => ({ groupId, count })).sort((a, b) => b.count - a.count);
}

/**
 * 解析导入文件（txt / json）
 * TXT 格式（每行一条）：
 *   词条|含义|用法|类型|标签1,标签2
 *   词条<Tab>含义
 *   词条：含义
 * JSON：数组或 { slangs: [] }，字段 term/meaning/usage/type/tags/groupId
 * OpenIE JSON：{ docs: [{ passage, extracted_entities, extracted_triples }] }（梗指南 / 游戏术语等）
 * @param {string} raw
 * @param {string} [format] auto|txt|json
 */
export function parseSlangImport(raw, format = 'auto') {
  const text = String(raw || '').trim();
  if (!text) return { items: [], errors: ['文件内容为空'] };

  let fmt = String(format || 'auto').toLowerCase();
  if (fmt === 'auto') {
    const t = text.trimStart();
    fmt = (t.startsWith('[') || t.startsWith('{')) ? 'json' : 'txt';
  }

  const items = [];
  const errors = [];

  if (fmt === 'json') {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { items: [], errors: ['JSON 解析失败：' + e.message] };
    }
    if (Array.isArray(data?.docs) && data.docs.length) {
      return parseOpenIeSlangDocs(data.docs, errors);
    }
    const list = Array.isArray(data) ? data : (Array.isArray(data?.slangs) ? data.slangs : (Array.isArray(data?.items) ? data.items : []));
    if (!list.length) {
      return { items: [], errors: ['JSON 中未找到词条（支持 slangs/items 数组、OpenIE docs 数组，或顶层数组）'] };
    }
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row || typeof row !== 'object') {
        errors.push(`第 ${i + 1} 条：无效对象`);
        continue;
      }
      const term = String(row.term || row.word || row.name || '').trim();
      if (!term) {
        errors.push(`第 ${i + 1} 条：缺少 term`);
        continue;
      }
      items.push(normalizeImportRow(row, term));
    }
    return { items, errors };
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parsed = parseSlangTxtLine(line);
    if (!parsed) {
      errors.push(`第 ${i + 1} 行：无法解析「${line.slice(0, 40)}」`);
      continue;
    }
    items.push(parsed);
  }
  return { items, errors };
}

/** OpenIE 导出：docs[].extracted_triples / extracted_entities / passage */
function parseOpenIeSlangDocs(docs, errors = []) {
  const map = new Map();

  function upsert(termRaw, meaningRaw, extra = {}) {
    const term = String(termRaw || '').trim();
    if (!term || term.length < 1) return;
    let meaning = String(meaningRaw || '').replace(/\s+/g, ' ').trim();
    if (meaning.length > 120) meaning = meaning.slice(0, 120);
    const key = term.slice(0, 40);
    const prev = map.get(key);
    const row = normalizeImportRow({ ...extra, meaning: meaning || prev?.meaning || '' }, key);
    if (!prev || (meaning && meaning.length > (prev.meaning || '').length)) {
      map.set(key, row);
    }
  }

  for (let di = 0; di < docs.length; di++) {
    const doc = docs[di];
    if (!doc || typeof doc !== 'object') {
      errors.push(`docs[${di}]：无效对象`);
      continue;
    }
    const passage = String(doc.passage || '').replace(/\r/g, '').trim();
    const baseExtra = { type: 'meme', source: 'openie-import' };

    const contentLine = passage.split('\n').map((l) => l.trim()).find((l) => l && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(l)) || '';
    const colonLine = contentLine.match(/^([^：:\n]{1,40})[：:]\s*(.+)$/);
    if (colonLine && !/^\d+$/.test(colonLine[1].trim())) {
      upsert(colonLine[1], colonLine[2], baseExtra);
    }

    const memeTitle = passage.match(/(.{1,40}?)是什么梗/);
    if (memeTitle) {
      upsert(memeTitle[1].replace(/^[\d:]+\s*/, '').trim(), passage.slice(0, 120).replace(/\n/g, ' '), baseExtra);
    }

    for (const triple of doc.extracted_triples || []) {
      if (!Array.isArray(triple) || triple.length < 2) continue;
      const term = String(triple[0] || '').trim();
      const meaning = triple.length >= 3
        ? `${triple[1]}：${triple[2]}`
        : String(triple[1] || '');
      upsert(term, meaning, baseExtra);
    }

    for (const entity of doc.extracted_entities || []) {
      const term = String(entity || '').trim();
      if (!term) continue;
      let meaning = '';
      const idx = passage.indexOf(term);
      if (idx >= 0) {
        const chunk = passage.slice(idx, idx + 160);
        const sent = chunk.split(/[。！？\n]/)[0] || chunk;
        meaning = sent.replace(/\n/g, ' ').trim();
      }
      upsert(term, meaning, baseExtra);
    }
  }

  const items = [...map.values()];
  if (!items.length) errors.push('OpenIE JSON 中未解析到有效词条');
  return { items, errors };
}

function normalizeImportRow(row, term) {
  return {
    term: term.slice(0, 40),
    meaning: String(row.meaning || row.desc || row.description || '').slice(0, 120),
    usage: String(row.usage || row.example || '').slice(0, 80),
    type: SLANG_TYPES.includes(row.type) ? row.type : 'slang',
    tags: Array.isArray(row.tags) ? row.tags.map(String).slice(0, 8) : String(row.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    groupId: String(row.groupId || row.group_id || '').trim(),
    reviewStatus: row.reviewStatus || row.review_status || 'pending',
    source: row.source || 'import'
  };
}

function parseSlangTxtLine(line) {
  let parts = [];
  if (line.includes('|')) parts = line.split('|').map((s) => s.trim());
  else if (line.includes('\t')) parts = line.split('\t').map((s) => s.trim());
  else if (/[:：]/.test(line)) {
    const idx = line.search(/[:：]/);
    parts = [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
  }
  else return { term: line.slice(0, 40), meaning: '', usage: '', type: 'slang', tags: [], groupId: '', reviewStatus: 'pending', source: 'import' };

  const term = (parts[0] || '').trim();
  if (!term) return null;
  const tagsRaw = parts[4] || '';
  return {
    term: term.slice(0, 40),
    meaning: (parts[1] || '').slice(0, 120),
    usage: (parts[2] || '').slice(0, 80),
    type: SLANG_TYPES.includes(parts[3]) ? parts[3] : 'slang',
    tags: tagsRaw ? tagsRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 8) : [],
    groupId: '',
    reviewStatus: 'pending',
    source: 'import'
  };
}

/** @param {object} store @param {object[]} items @param {object} [opts] */
export function importSlangs(store, items, opts = {}) {
  const skipDup = opts.skipDuplicate !== false;
  let imported = 0;
  let skipped = 0;
  for (const item of items || []) {
    const term = String(item.term || '').trim();
    if (!term) { skipped += 1; continue; }
    const gid = String(item.groupId || opts.groupId || '').trim();
    if (skipDup) {
      const exists = (store.slangs || []).some((s) => s.term === term && String(s.groupId || '') === gid);
      if (exists) { skipped += 1; continue; }
    }
    createSlang(store, { ...item, groupId: gid });
    imported += 1;
  }
  return { imported, skipped, total: (items || []).length };
}

/** 简易语义检索黑话 */
function scoreSlang(query, item) {
  const q = String(query || '').toLowerCase();
  const blob = `${item.term} ${item.meaning} ${item.usage} ${(item.tags || []).join(' ')}`.toLowerCase();
  if (!q || !blob) return 0;
  if (blob.includes(q)) return 10;
  const qw = [...new Set(q.split(/[\s，。！？、,.!?;；]+/).filter((w) => w.length >= 2))];
  if (!qw.length) return 0;
  let hit = 0;
  for (const w of qw) if (blob.includes(w)) hit += 1;
  return hit / qw.length;
}

/** @param {object} store @param {string} groupId @param {string} context @param {number} limit */
export function selectSlangs(store, groupId, context, limit = 6) {
  const settings = store.slangSettings || {};
  if (settings.usageEnabled === false) return [];
  const gid = String(groupId || '');
  return (store.slangs || [])
    .filter((s) => isSlangUsable(s, settings) && (!s.groupId || s.groupId === gid))
    .map((s) => ({ ...s, _score: scoreSlang(context, s) + (Number(s.score) || 0) * 0.01 }))
    .filter((s) => s._score > 0.02)
    .sort((a, b) => b._score - a._score)
    .slice(0, Math.max(1, limit));
}

/** @param {object} store @param {object} item */
export function upsertSlang(store, item) {
  store.slangs = store.slangs || [];
  const key = `${item.groupId || ''}\t${item.term}`;
  const idx = store.slangs.findIndex((s) => `${s.groupId || ''}\t${s.term}` === key);
  if (idx >= 0) {
    store.slangs[idx].count = (Number(store.slangs[idx].count) || 0) + 1;
    store.slangs[idx].score = (Number(store.slangs[idx].score) || 0) + 0.1;
    if (item.meaning && !store.slangs[idx].meaning) store.slangs[idx].meaning = item.meaning;
    if (item.usage && !store.slangs[idx].usage) store.slangs[idx].usage = item.usage;
    store.slangs[idx].updatedAt = Date.now();
    return store.slangs[idx];
  }
  const autoPass = store.slangSettings?.autoAiPass === true;
  const rec = {
    ...item,
    reviewStatus: item.reviewStatus || (autoPass ? 'ai_passed' : 'pending'),
    enabled: item.enabled !== false,
    source: item.source || 'learned',
    reviewedBy: autoPass ? 'ai' : '',
    reviewedAt: autoPass ? Date.now() : 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  store.slangs.push(rec);
  if (store.slangs.length > 400) store.slangs.splice(0, store.slangs.length - 400);
  return rec;
}
