/**
 * Bilibili API 网关：目录检索 + 通用 HTTP 调用 + 自动注入 Cookies
 */
import { BILI_API_CATALOG, BILI_API_DOC_URL, classifyBiliRisk } from './bili-api-catalog.mjs';
import { buildCookieHeaderForUrl, hasCookiesForUrl } from '../agent/agent-cookies.mjs';
import { buildCookieHeaderForUser, describeCookieSource } from './bili-auth.mjs';

const ACTION_INDEX = new Map();
for (const item of BILI_API_CATALOG) {
  if (!ACTION_INDEX.has(item.action)) ACTION_INDEX.set(item.action, item);
}

export const BILI_DEFAULT_BASE = 'https://api.bilibili.com';
export const BILI_DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/** @param {string} action */
export function getBiliApiEntry(action) {
  return ACTION_INDEX.get(String(action || '').trim()) || null;
}

/**
 * @param {{ category?: string, keyword?: string, limit?: number }} opts
 */
export function searchBiliCatalog(opts = {}) {
  const category = String(opts.category || '').trim();
  const keyword = String(opts.keyword || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(80, Number(opts.limit) || 30));
  let list = BILI_API_CATALOG;
  if (category) list = list.filter((e) => e.category === category || e.category.includes(category));
  if (keyword) {
    list = list.filter((e) =>
      e.action.toLowerCase().includes(keyword)
      || e.title.toLowerCase().includes(keyword)
      || (e.desc && e.desc.toLowerCase().includes(keyword))
      || e.category.toLowerCase().includes(keyword)
      || (e.path && e.path.toLowerCase().includes(keyword)));
  }
  return list.slice(0, limit);
}

/** @returns {string[]} */
export function listBiliCategories() {
  return [...new Set(BILI_API_CATALOG.map((e) => e.category).filter(Boolean))].sort();
}

/** @param {object[]} list */
export function formatBiliCatalogList(list) {
  if (!list?.length) return '（未找到匹配接口）';
  return list.map((e, i) =>
    `${i + 1}. [${e.category}] ${e.action} — ${e.title}\n   ${e.method} ${e.path}${e.desc ? ` (${e.desc})` : ''} [${e.risk}]`
  ).join('\n');
}

/** @param {unknown} data @param {number} maxLen */
export function formatBiliResult(data, maxLen = 12000) {
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

/**
 * @param {string} path
 * @param {string} [baseUrl]
 */
export function resolveBiliUrl(path, baseUrl = BILI_DEFAULT_BASE) {
  const p = String(path || '').trim();
  if (!p) return BILI_DEFAULT_BASE;
  if (/^https?:\/\//i.test(p)) return p;
  const base = String(baseUrl || BILI_DEFAULT_BASE).replace(/\/$/, '');
  return base + (p.startsWith('/') ? p : `/${p}`);
}

/**
 * @param {object} params
 */
function buildQueryString(params) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    out.set(k, String(v));
  }
  return out.toString();
}

/**
 * @param {object} cfg
 * @param {string} url
 */
export function buildBiliRequestHeaders(cfg, url, opts = {}) {
  const referer = String(opts.referer || 'https://www.bilibili.com/').trim();
  const ua = cfg?.agentBrowserAdvancedEnabled === false
    ? BILI_DEFAULT_UA
    : (String(cfg?.agentBrowserUserAgent || '').trim() || BILI_DEFAULT_UA);
  const headers = {
    'User-Agent': ua,
    Accept: 'application/json, text/plain, */*',
    Referer: referer,
    Origin: 'https://www.bilibili.com'
  };
  const runtime = opts.runtime || {};
  const qqUserId = String(opts.qqUserId || runtime.qqUserId || runtime.qqApi?.getSession?.()?.userId || '').trim();
  const db = opts.db || runtime.db || null;
  const cookieHeader = db
    ? buildCookieHeaderForUser(cfg, url, qqUserId, db)
    : buildCookieHeaderForUrl(cfg, url);
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (cfg?.agentBrowserAdvancedEnabled !== false && cfg?.agentBrowserExtraHeaders && typeof cfg.agentBrowserExtraHeaders === 'object') {
    for (const [k, v] of Object.entries(cfg.agentBrowserExtraHeaders)) {
      const key = String(k || '').trim();
      const val = String(v ?? '').trim();
      if (key && val) headers[key] = val;
    }
  }
  return headers;
}

/**
 * @param {object} opts
 */
export async function executeBiliApiCall(opts) {
  const {
    action,
    path: pathOverride,
    method: methodOverride,
    params = {},
    body,
    baseUrl = BILI_DEFAULT_BASE,
    cfg = {},
    runtime = {},
    allowWrite = true,
    referer
  } = opts;

  const act = String(action || '').trim();
  const entry = act ? getBiliApiEntry(act) : null;
  const apiPath = String(pathOverride || entry?.path || '').trim();
  if (!apiPath) return '错误：未指定 path 或未知 action';

  const method = String(methodOverride || entry?.method || 'GET').toUpperCase();
  const risk = entry?.risk || classifyBiliRisk(act || apiPath);

  if (risk === 'write' || risk === 'danger') {
    if (allowWrite === false || cfg.agentToolBiliAllowWrite === false) {
      return `错误：写操作 ${act || apiPath} 已禁用（agentToolBiliAllowWrite=false）`;
    }
    if (cfg.agentToolBiliDangerGuard !== false && typeof runtime.requestRiskApproval === 'function') {
      const approval = await runtime.requestRiskApproval({
        operationType: 'bili_api',
        riskLevel: risk,
        reason: `Bilibili API：${entry?.title || act || apiPath}`,
        preview: `${method} ${apiPath}`
      });
      if (!approval?.approved) {
        return `已拒绝高危 B站操作：${approval?.reason || '需要管理员确认'}`;
      }
    }
  }

  const urlBase = resolveBiliUrl(apiPath, baseUrl);
  const qqUserId = String(runtime.qqUserId || runtime.qqApi?.getSession?.()?.userId || '').trim();
  const db = runtime.db || null;
  const headers = buildBiliRequestHeaders(cfg, urlBase, { referer, qqUserId, db, runtime });
  const cookieAttached = !!headers.Cookie;

  let fetchUrl = urlBase;
  let fetchOpts = { method, headers, signal: AbortSignal.timeout(Math.max(5000, Number(cfg.agentToolBiliTimeoutMs) || 30000)) };

  if (method === 'GET' || method === 'HEAD') {
    const qs = buildQueryString(params);
    if (qs) fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + qs;
  } else {
    const contentType = String(body?.contentType || 'application/x-www-form-urlencoded');
    headers['Content-Type'] = contentType;
    if (body?.json != null) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(body.json);
    } else if (body?.raw != null) {
      fetchOpts.body = String(body.raw);
    } else {
      fetchOpts.body = buildQueryString(params);
    }
  }

  try {
    const res = await fetch(fetchUrl, fetchOpts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    const maxLen = Math.max(2000, Math.min(50000, Number(cfg.agentToolBiliMaxResultChars) || 12000));
    const label = entry ? `[${entry.action}] ${entry.title}` : `${method} ${apiPath}`;
    const cookieNote = cookieAttached
      ? (db ? describeCookieSource(cfg, urlBase, qqUserId, db) : '（已附加 Cookie）')
      : '（未配置 Cookie，部分接口可能 -101 未登录）';
    const statusLine = `HTTP ${res.status} ${cookieNote}`;

    const payload = { httpStatus: res.status, cookieAttached, data, label, statusLine };

    if (opts.raw === true) return payload;

    if (typeof data === 'object' && data !== null && data.code != null && data.code !== 0) {
      return `${label}\n${statusLine}\n业务 code=${data.code} message=${data.message || data.msg || ''}\n${formatBiliResult(data, maxLen)}`;
    }
    return `${label}\n${statusLine}\n${formatBiliResult(data, maxLen)}`;
  } catch (e) {
    if (opts.raw === true) return { error: e.message };
    return `Bilibili API 调用失败 [${act || apiPath}]：${e.message}`;
  }
}

export function buildBiliCatalogSummary() {
  const cats = listBiliCategories();
  return `Bilibili API 网关（共 ${BILI_API_CATALOG.length} 个常用接口，文档 ${BILI_API_DOC_URL}）。`
    + ` 分类：${cats.join('、')}。`
    + ' Cookie 来自「自定义域名 Cookies」编辑器（如 bilibili.com）；有配置则自动附加。'
    + ' 先用 builtin_bili_catalog 搜索，再用 builtin_bili_call 调用。';
}

/** @param {object} cfg @param {string} [url] @param {string} [qqUserId] @param {object} [db] */
export function describeBiliCookieStatus(cfg, url = BILI_DEFAULT_BASE, qqUserId = '', db = null) {
  if (db) return describeCookieSource(cfg, url, qqUserId, db);
  if (hasCookiesForUrl(cfg, url)) return '已配置 bilibili 相关 Cookie，请求将自动携带';
  return '未配置 bilibili Cookie（可在 Agent 页「自定义域名 Cookies」添加 bilibili.com）';
}
