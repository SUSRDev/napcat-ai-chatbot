/**
 * NapCat API 统一网关：目录检索 + 通用 callAction 调用
 */
import { NAPCAT_API_CATALOG, NAPCAT_API_DOC_URL } from './napcat-api-catalog.mjs';

const ACTION_INDEX = new Map();
for (const item of NAPCAT_API_CATALOG) {
  if (!ACTION_INDEX.has(item.action)) ACTION_INDEX.set(item.action, item);
}

/** @param {string} action */
export function getNapCatApiEntry(action) {
  return ACTION_INDEX.get(String(action || '').trim()) || null;
}

/** @param {string} action */
export function classifyNapCatRisk(action) {
  const entry = getNapCatApiEntry(action);
  if (entry?.risk) return entry.risk;
  const a = String(action || '').toLowerCase();
  if (/kick|delete_friend|bot_exit|set_restart|send_packet|set_group_leave|kick_members|del_group|delete_group_file|delete_group_folder|delete_custom_face|delete_essence|_del_group_notice/.test(a)) return 'danger';
  if (/^send_|^set_|^upload_|^create_|^add_|^delete_|^del_|^move_|^rename_|^trans_|^forward_|^complete_|^cancel_|^receive_|^refuse_|^mark_|^do_group|^click_/.test(a)) return 'write';
  return 'read';
}

/**
 * @param {{ category?: string, keyword?: string, limit?: number }} opts
 */
export function searchNapCatCatalog(opts = {}) {
  const category = String(opts.category || '').trim();
  const keyword = String(opts.keyword || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(80, Number(opts.limit) || 30));
  let list = NAPCAT_API_CATALOG;
  if (category) list = list.filter((e) => e.category === category || e.category.includes(category));
  if (keyword) {
    list = list.filter((e) =>
      e.action.toLowerCase().includes(keyword)
      || e.title.toLowerCase().includes(keyword)
      || (e.desc && e.desc.toLowerCase().includes(keyword))
      || e.category.toLowerCase().includes(keyword));
  }
  return list.slice(0, limit);
}

/** @returns {string[]} */
export function listNapCatCategories() {
  return [...new Set(NAPCAT_API_CATALOG.map((e) => e.category).filter(Boolean))].sort();
}

/** @param {unknown} data @param {number} maxLen */
export function formatNapCatResult(data, maxLen = 12000) {
  const cap = Math.max(500, Math.min(50000, Number(maxLen) || 12000));
  let text;
  if (data == null) text = '(空响应)';
  else if (typeof data === 'string') text = data;
  else {
    try { text = JSON.stringify(data, null, 2); } catch { text = String(data); }
  }
  if (text.length > cap) text = text.slice(0, cap) + `\n...(已截断，共 ${text.length} 字符)`;
  return text;
}

/** @param {object[]} list */
export function formatCatalogList(list) {
  if (!list?.length) return '（未找到匹配接口）';
  return list.map((e, i) => `${i + 1}. [${e.category}] ${e.action} — ${e.title}${e.desc ? ` (${e.desc})` : ''} [${e.risk}]`).join('\n');
}

/**
 * 自动补全会话上下文参数
 * @param {string} action
 * @param {object} params
 * @param {{ groupId?: string, userId?: string }} session
 */
export function enrichNapCatParams(action, params, session = {}) {
  const out = { ...(params && typeof params === 'object' ? params : {}) };
  const a = String(action || '').toLowerCase();
  if (session.groupId && out.group_id == null && /group|qun|guild|essence|notice|album|todo|sign|honor|at_all|forward_group|group_/.test(a)) {
    out.group_id = String(session.groupId);
  }
  if (session.userId && out.user_id == null && /member|ban|kick|card|poke|private|friend|stranger|like|profile|remark|title|avatar/.test(a)) {
    out.user_id = String(session.userId);
  }
  return out;
}

/**
 * @param {object} opts
 */
export async function executeNapCatApiCall(opts) {
  const {
    action,
    params = {},
    callAction,
    session = {},
    cfg = {},
    runtime = {},
    allowWrite = true
  } = opts;

  const act = String(action || '').trim();
  if (!act) return '错误：action 不能为空';
  if (typeof callAction !== 'function') return '错误：NapCat 未就绪';

  const entry = getNapCatApiEntry(act);
  const risk = classifyNapCatRisk(act);

  if (risk === 'write' || risk === 'danger') {
    if (allowWrite === false || cfg.agentToolQqNapcatAllowWrite === false) {
      return `错误：写操作 ${act} 已禁用（agentToolQqNapcatAllowWrite=false）`;
    }
    if (cfg.agentToolQqNapcatDangerGuard !== false && typeof runtime.requestRiskApproval === 'function') {
      const approval = await runtime.requestRiskApproval({
        operationType: 'napcat_api',
        riskLevel: risk,
        reason: `NapCat API：${entry?.title || act}`,
        preview: `${act}(${JSON.stringify(params).slice(0, 200)})`
      });
      if (!approval?.approved) {
        return `已拒绝高危 NapCat 操作：${approval?.reason || '需要管理员确认'}`;
      }
    }
  }

  const payload = enrichNapCatParams(act, params, session);
  try {
    const raw = await callAction(act, payload);
    const data = raw?.data !== undefined ? raw : { data: raw, status: 'ok' };
    const maxLen = Math.max(2000, Math.min(50000, Number(cfg.agentToolQqNapcatMaxResultChars) || 12000));
    const header = `[${act}] ${entry?.title || ''}`.trim();
    if (raw?.status === 'failed' || (raw?.retcode != null && raw.retcode !== 0)) {
      return `${header}\n状态：失败 retcode=${raw?.retcode ?? '?'}\n${formatNapCatResult(raw, maxLen)}`;
    }
    return `${header}\n${formatNapCatResult(data, maxLen)}`;
  } catch (e) {
    return `NapCat API 调用失败 [${act}]：${e.message}`;
  }
}

export function buildNapCatCatalogSummary() {
  const cats = listNapCatCategories();
  return `NapCat 全量 API 网关（共 ${NAPCAT_API_CATALOG.length} 个接口，文档 ${NAPCAT_API_DOC_URL}）。`
    + ` 分类：${cats.join('、')}。`
    + ' 先用 builtin_qq_napcat_catalog 搜索 action 名，再用 builtin_qq_napcat_call 调用。';
}
